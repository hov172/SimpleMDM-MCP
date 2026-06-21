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
