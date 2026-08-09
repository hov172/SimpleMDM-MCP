import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sampleRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/devices-sample.json"), "utf8"),
);
// devices-sample.json is wrapped: { data: [...], has_more: false }
const rawDevices = sampleRaw.data ?? sampleRaw;

const sofaMacos = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/sofa-macos.json"), "utf8"),
);
const sofaIos = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/sofa-ios.json"), "utf8"),
);

function makeMockClient(devicesData) {
  return async (path) => {
    if (path.startsWith("/devices")) {
      return { data: devicesData, has_more: false };
    }
    return { data: [], has_more: false };
  };
}

function makeSpyClient(calls) {
  return async (path) => {
    calls.push(path);
    // Return minimal mock data so each method resolves without error
    if (path.startsWith("/devices")) return { data: rawDevices, has_more: false };
    if (path.startsWith("/apps")) return { data: [{ id: 1, attributes: { name: "TestApp" } }], has_more: false };
    if (path.startsWith("/profiles")) return { data: [{ id: 2, attributes: { name: "TestProfile" } }], has_more: false };
    if (path.startsWith("/users")) return { data: [{ id: 3, attributes: { email: "test@example.com" } }], has_more: false };
    if (path.startsWith("/logs")) return { data: [{ id: 4, attributes: { type: "device.enrolled" } }], has_more: false };
    return { data: [], has_more: false };
  };
}

const { ServerDataSource } = await import("../../dist/reports/data/server-source.js");

test("ServerDataSource.devices resolves a serials scope", async () => {
  const ds = new ServerDataSource(makeMockClient(rawDevices));
  const devs = await ds.devices({ kind: "serials", value: ["C02AAA111"] });
  assert.equal(devs.length, 1);
  assert.equal(devs[0].serial, "C02AAA111");
});

test("ServerDataSource.devices with all scope returns all devices", async () => {
  const ds = new ServerDataSource(makeMockClient(rawDevices));
  const devs = await ds.devices({ kind: "all" });
  assert.ok(devs.length > 0);
});

test("ServerDataSource.devices carries the raw API object (.raw) for dynamic filtering", async () => {
  const ds = new ServerDataSource(makeMockClient(rawDevices));
  const devs = await ds.devices({ kind: "all" });
  const d = devs[0];
  assert.ok(d.raw && typeof d.raw === "object", "each device must carry its raw API object");
  // raw must be the original SimpleMDM shape (id + attributes), enabling raw.attributes.<field> filters
  assert.ok("attributes" in d.raw, "raw must expose the full attributes object");
  assert.equal(String(d.raw.id), String(rawDevices[0].id), "raw must be the original device, untouched");
});

test("ServerDataSource.devices uses an injected deviceFetcher (cache path) instead of paginating /devices", async () => {
  // The 4th ctor arg lets the MCP server hand the report engine its cached,
  // write-invalidated collectDevices() so back-to-back reports don't re-paginate /devices.
  // (The client is still used for the small group-name lists — see paths below.)
  const clientPaths = [];
  const countingClient = async (path) => { clientPaths.push(path); return { data: [], has_more: false }; };
  const cachedRaw = [{ id: 7, type: "device", attributes: { device_name: "Cached Mac", serial_number: "CACHE1" } }];
  let fetcherCalls = 0;
  const deviceFetcher = async () => { fetcherCalls++; return cachedRaw; };

  const ds = new ServerDataSource(countingClient, 200, undefined, deviceFetcher);
  const devs = await ds.devices({ kind: "all" });

  assert.equal(fetcherCalls, 1, "must call the injected fetcher");
  assert.ok(!clientPaths.some((p) => p.startsWith("/devices")), "must NOT paginate /devices via the client when a fetcher is injected");
  assert.equal(devs.length, 1);
  assert.equal(devs[0].raw, cachedRaw[0], "raw passthrough preserved through the cache path");
});

test("ServerDataSource.devices resolves device_group + assignment_group NAMES (not ids)", async () => {
  // Regression: the dynamic report adapter must enrich devices with group names like
  // the inventory bridge does, so the Group column shows "HLAB_Faculty", not blank.
  const rawDev = [{ id: 1, type: "device", attributes: { device_name: "Mac1", name: "Lab Mac", serial_number: "S1" },
    relationships: { device_group: { data: { id: 92181 } }, groups: { data: [{ id: 5 }, { id: 6 }] } } }];
  const client = async (path) => {
    if (path.startsWith("/device_groups")) return { data: [{ id: 92181, attributes: { name: "HLAB_Faculty" } }], has_more: false };
    if (path.startsWith("/assignment_groups")) return { data: [{ id: 5, attributes: { name: "Faculty Managed" } }, { id: 6, attributes: { name: "K2" } }], has_more: false };
    if (path.startsWith("/devices")) return { data: rawDev, has_more: false };
    return { data: [], has_more: false };
  };
  const ds = new ServerDataSource(client);
  const devs = await ds.devices({ kind: "all" });
  assert.equal(devs[0].device_group, "HLAB_Faculty", "device_group must resolve the id to its name");
  assert.deepEqual(devs[0].assignment_groups, ["Faculty Managed", "K2"], "assignment_groups must resolve ids to names");
});

test("ServerDataSource.devices degrades gracefully when group lists fail (blank, not crash)", async () => {
  const rawDev = [{ id: 1, attributes: { serial_number: "S1" }, relationships: { device_group: { data: { id: 99 } } } }];
  const client = async (path) => {
    if (path.startsWith("/device_groups") || path.startsWith("/assignment_groups")) throw new Error("503 overload");
    if (path.startsWith("/devices")) return { data: rawDev, has_more: false };
    return { data: [], has_more: false };
  };
  const ds = new ServerDataSource(client);
  const devs = await ds.devices({ kind: "all" });
  assert.equal(devs.length, 1, "report still generates when group enrichment fails");
  assert.equal(devs[0].device_group, "", "unresolved group is blank, not a thrown error");
});

test("ServerDataSource.devices falls back to the raw client when no deviceFetcher is injected", async () => {
  let clientCalls = 0;
  const countingClient = async () => { clientCalls++; return { data: rawDevices, has_more: false }; };
  const ds = new ServerDataSource(countingClient); // no fetcher
  const devs = await ds.devices({ kind: "all" });
  assert.ok(clientCalls > 0, "must paginate via the client when no fetcher is provided");
  assert.ok(devs.length > 0);
});

test("no report fetch path calls a mutating client method — all 5 methods", async () => {
  const calls = [];
  const spy = makeSpyClient(calls);
  const ds = new ServerDataSource(spy);
  const scope = { kind: "all" };
  await Promise.all([
    ds.devices(scope).catch(() => {}),
    ds.apps(scope).catch(() => {}),
    ds.profiles(scope).catch(() => {}),
    ds.users(scope).catch(() => {}),
    ds.logs(scope).catch(() => {}),
  ]);
  assert.ok(calls.length > 0, "spy should have been called");
  assert.equal(
    calls.some((m) => /create|update|delete|push|wipe|lock|post|put|patch/i.test(m)),
    false,
    `Mutating call detected: ${calls.join(", ")}`,
  );
});

test("securityPosture uses injected fetchJson — no live network", async () => {
  let fetchCalled = false;
  const stubFetchJson = async (url) => {
    fetchCalled = true;
    if (url.includes("macos")) return sofaMacos;
    if (url.includes("ios")) return sofaIos;
    throw new Error(`Unexpected URL: ${url}`);
  };

  const mockClient = makeMockClient(rawDevices);
  const ds = new ServerDataSource(mockClient, 200, stubFetchJson);
  const results = await ds.securityPosture({ kind: "all" });

  assert.ok(fetchCalled, "injected fetchJson should have been called");
  assert.ok(Array.isArray(results), "should return an array");
  assert.ok(results.length > 0, "should return evaluated devices");
  // Each result should have a serial field (from DeviceRecord / EvaluatedDevice)
  assert.ok(
    results.every((r) => typeof r.serial === "string"),
    "each result should have a serial field",
  );
});

// 2.4a: extend the read-only invariant to securityPosture (the 6th method), which the
// "all 5 methods" test above omits. It must reach SimpleMDM only via GET (no mutation).
test("securityPosture calls no mutating client method (read-only, 6th method)", async () => {
  const calls = [];
  const spy = makeSpyClient(calls);
  const stubFetchJson = async (url) => {
    if (url.includes("macos")) return sofaMacos;
    if (url.includes("ios")) return sofaIos;
    throw new Error(`Unexpected URL: ${url}`);
  };
  const ds = new ServerDataSource(spy, 200, stubFetchJson);
  await ds.securityPosture({ kind: "all" }).catch(() => {});
  assert.ok(calls.length > 0, "spy should have been called for device data");
  assert.equal(
    calls.some((m) => /create|update|delete|push|wipe|lock|post|put|patch/i.test(m)),
    false,
    `Mutating call detected: ${calls.join(", ")}`,
  );
});

// Regression: securityPosture must evaluate the RAW device shape, not the normalized
// DeviceRecord — evaluateDevice reads raw-API keys (product_name, filevault_enabled,
// last_seen_at). Feeding it DeviceRecords made every device "unknown" platform with
// all Mac security checks passing vacuously.
test("securityPosture evaluates real device fields (platform, FileVault, findings)", async () => {
  const stubFetchJson = async (url) => {
    if (url.includes("macos")) return sofaMacos;
    if (url.includes("ios")) return sofaIos;
    throw new Error(`Unexpected URL: ${url}`);
  };
  const ds = new ServerDataSource(makeMockClient(rawDevices), 200, stubFetchJson);
  const results = await ds.securityPosture({ kind: "all" });

  assert.ok(results.every((r) => r.platform === "macOS"),
    `all fixture devices are Macs; got platforms: ${results.map((r) => r.platform).join(", ")}`);
  assert.ok(results.every((r) => r.lastSeen != null), "lastSeen must come through from last_seen_at");

  const imac = results.find((r) => r.serial === "D25BBB222");
  assert.ok(imac, "iMac fixture must be present");
  assert.equal(imac.filevaultOk, false, "FileVault-off iMac must fail the FileVault check");
  assert.ok(imac.findings.includes("FileVault disabled"), `findings: ${imac.findings.join("; ")}`);
  assert.ok(imac.findings.includes("Firewall disabled"), `findings: ${imac.findings.join("; ")}`);

  const mbp = results.find((r) => r.serial === "C02AAA111");
  assert.ok(mbp, "MacBookPro fixture must be present");
  assert.equal(mbp.filevaultOk, true);
  assert.equal(mbp.model, "MacBookPro18,1");
});

// 2.4c: logs() must not silently drop data when it hits the page cap while the API
// still reports has_more — a forensic/legal export should error, not truncate quietly.
test("logs() throws (not silently truncates) when the page cap is hit with has_more", async () => {
  let n = 0;
  const neverEnding = async (path) => {
    if (path.startsWith("/logs")) return { data: [{ id: ++n }], has_more: true };
    return { data: [], has_more: false };
  };
  const ds = new ServerDataSource(neverEnding, 3); // small cap to hit quickly
  await assert.rejects(
    () => ds.logs({ kind: "all" }),
    /cap|page|truncat|has_more/i,
    "logs() must throw when the page cap is exhausted with more data pending",
  );
});
