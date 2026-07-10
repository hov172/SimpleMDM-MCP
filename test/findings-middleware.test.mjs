import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.MUNKIREPORT_BASE_URL = "https://munkireport.example.edu";

const rich = [];
globalThis.fetch = async (url, opts) => {
  rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
};

const { afterToolCall } = await import("../dist/findings/middleware.js");

const STALE_DEVICES_RESULT = {
  devices: [
    { serial: "C02AAA111", name: "Alice's Mac", days_since: 20 },
    { serial: "C02BBB222", name: "Bob's Mac", days_since: 45 },
  ],
};

function resetEnv(overrides = {}) {
  delete process.env.MUNKIREPORT_ENABLED;
  delete process.env.MCP_PUBLISH_MODE;
  delete process.env.MCP_PUBLISH_MIN_SEVERITY;
  delete process.env.MCP_PUBLISH_INVENTORY_TOOLS;
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
  Object.assign(process.env, overrides);
}

test("disabled by default (MUNKIREPORT_ENABLED unset) — no publish call", async () => {
  resetEnv();
  rich.length = 0;
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled but mode=manual (default) — no publish call", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true" });
  rich.length = 0;
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled + mode=disabled — no publish call even with a manifest-eligible tool", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "disabled" });
  rich.length = 0;
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled + mode=auto on an eligible tool — publishes both findings", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call, "expected a publish call");
  const body = JSON.parse(call.body);
  assert.equal(body.source, "mcp_auto_get_stale_devices");
  // true is correct here: cross-tool/manual-run isolation is already provided by
  // each tool's own distinct source namespace, so replace:true only resolves stale
  // findings WITHIN this one tool's own source -- required so repeated calls don't
  // accumulate duplicates and previously-flagged-now-fixed devices actually clear.
  assert.equal(body.replace, true);
  assert.equal(body.findings.length, 2);
  assert.equal(body.findings[0].serial_number, "C02AAA111");
  assert.equal(body.findings[0].finding_type, "stale_device");
  assert.match(body.findings[0].message, /Alice's Mac/);
  assert.match(body.findings[0].message, /20 days/);
});

test("enabled + mode=auto on a non-eligible tool (no manifest adapter) — no publish call", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await afterToolCall("list_devices", { data: [] });
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled + mode=dry_run — logs but never calls ingest_mcp_findings", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "dry_run" });
  rich.length = 0;
  const logs = [];
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT, (m) => logs.push(m));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
  assert.ok(logs.some((l) => /dry-run/i.test(l) && /get_stale_devices/.test(l)));
});

test("MCP_PUBLISH_MIN_SEVERITY filters out findings below threshold", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto", MCP_PUBLISH_MIN_SEVERITY: "danger" });
  rich.length = 0;
  // get_stale_devices' adapter severity is "warning" -- below a "danger" threshold, so nothing should publish.
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")), "warning-severity findings must be filtered out when threshold is danger");
});

test("conditionField gates findings on a tool whose result is NOT pre-filtered", async () => {
  // get_os_eligibility's adapter severity is "info" (below the default "warning"
  // threshold) -- explicitly lower the threshold here so this test isolates
  // conditionField behavior and doesn't accidentally also depend on severity filtering.
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto", MCP_PUBLISH_MIN_SEVERITY: "info" });
  rich.length = 0;
  const osEligibilityResult = {
    devices: [
      { serial: "C02CCC333", name: "Carol's Mac", upgrade_available: true },
      { serial: "C02DDD444", name: "Dave's Mac", upgrade_available: false },
    ],
  };
  await afterToolCall("get_os_eligibility", osEligibilityResult);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  assert.equal(body.findings.length, 1, "only the row with upgrade_available:true should become a finding");
  assert.equal(body.findings[0].serial_number, "C02CCC333");
});

test("a serial-less adapter (get_certificate_expiration_audit) publishes with no serial_number key", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  // warning is a string enum ("ok"|"renew_soon"|"renew_now"|"expired"|"unknown"), never a boolean --
  // this adapter uses conditionValues, not plain truthiness (a review caught the truthiness version
  // as a bug: the enum is never falsy, so it would have fired on every scan including "ok").
  const certResult = { apple_id: "admin@example.edu", expires_at: "2026-08-01", days_until_expiry: 21, warning: "renew_now" };
  await afterToolCall("get_certificate_expiration_audit", certResult);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  assert.equal(body.findings.length, 1);
  assert.ok(!("serial_number" in body.findings[0]), "serial_number must be omitted, not sent as null/undefined");
  assert.match(body.findings[0].message, /admin@example\.edu/);
  assert.match(body.findings[0].message, /21 days/);
});

test("a certificate result with warning:'ok' publishes nothing (conditionValues gate)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const certResult = { apple_id: "admin@example.edu", expires_at: "2027-06-01", days_until_expiry: 200, warning: "ok" };
  await afterToolCall("get_certificate_expiration_audit", certResult);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("a certificate result with warning:'unknown' (no expiry data) publishes nothing (conditionValues gate)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const certResult = { apple_id: null, expires_at: null, days_until_expiry: null, warning: "unknown" };
  await afterToolCall("get_certificate_expiration_audit", certResult);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("get_storage_health's two adapters both fire, each with its own finding_type", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const storageResult = {
    low_disk_devices: [{ serial: "C02EEE555", name: "Eve's Mac", available_gb: 3.2 }],
    low_battery_devices: [{ serial: "C02FFF666", name: "Frank's Mac", battery_level_pct: 8 }],
  };
  await afterToolCall("get_storage_health", storageResult);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  assert.equal(body.findings.length, 2);
  const types = body.findings.map((f) => f.finding_type).sort();
  assert.deepStrictEqual(types, ["low_battery", "low_disk_space"]);
});

test("a publish failure is caught and does not throw", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  const logs = [];
  await assert.doesNotReject(() => afterToolCall("get_stale_devices", STALE_DEVICES_RESULT, (m) => logs.push(m)));
  assert.ok(logs.some((l) => /fail/i.test(l)));
  globalThis.fetch = realFetch;
});

// Persistent on-disk retry queue (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
// §2): a failed publish additionally enqueues the same payload when MCP_FINDINGS_QUEUE_DIR is set,
// and behavior is completely unchanged (log-and-drop only) when it's unset.
const QUEUE_DIR = path.resolve("reports/.scratch/retry-queue-middleware-test");

test("a publish failure enqueues to the retry queue when MCP_FINDINGS_QUEUE_DIR is set", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto", MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  rich.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  globalThis.fetch = realFetch;

  const files = await fs.readdir(QUEUE_DIR);
  assert.equal(files.length, 1, "expected the failed publish payload to be enqueued");
  const enqueued = JSON.parse(await fs.readFile(path.join(QUEUE_DIR, files[0]), "utf8"));
  assert.equal(enqueued.route, "/ingest_mcp_findings");
  assert.equal(enqueued.body.source, "mcp_auto_get_stale_devices");
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
});

test("a publish failure does NOT enqueue anything when MCP_FINDINGS_QUEUE_DIR is unset (unchanged log-and-drop behavior)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  rich.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  globalThis.fetch = realFetch;

  await assert.rejects(() => fs.access(QUEUE_DIR), "no queue dir should be created when MCP_FINDINGS_QUEUE_DIR is unset");
});

// Inventory-tool opt-in publishing (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
// §1): mode=auto alone must not publish an inventory-type tool -- it must also be named
// in MCP_PUBLISH_INVENTORY_TOOLS. get_unmanaged_apps has a real adapter (severity: info),
// so lower MCP_PUBLISH_MIN_SEVERITY to "info" in these cases to isolate the opt-in gate
// from severity filtering.
const UNMANAGED_APPS_RESULT = {
  apps: [{ bundle_identifier: "com.example.foo", name: "Foo", count: 12 }],
};

test("an opted-in inventory tool publishes in auto mode", async () => {
  resetEnv({
    MUNKIREPORT_ENABLED: "true",
    MCP_PUBLISH_MODE: "auto",
    MCP_PUBLISH_MIN_SEVERITY: "info",
    MCP_PUBLISH_INVENTORY_TOOLS: "get_unmanaged_apps",
  });
  rich.length = 0;
  await afterToolCall("get_unmanaged_apps", UNMANAGED_APPS_RESULT);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call, "expected a publish call for an opted-in inventory tool");
  const body = JSON.parse(call.body);
  assert.equal(body.source, "mcp_auto_get_unmanaged_apps");
  assert.equal(body.findings.length, 1);
  assert.equal(body.findings[0].finding_type, "unmanaged_app");
  assert.match(body.findings[0].message, /Foo/);
});

test("a non-opted-in inventory tool does NOT publish in auto mode, even though it has a real adapter", async () => {
  resetEnv({
    MUNKIREPORT_ENABLED: "true",
    MCP_PUBLISH_MODE: "auto",
    MCP_PUBLISH_MIN_SEVERITY: "info",
    // MCP_PUBLISH_INVENTORY_TOOLS deliberately unset/empty -- no inventory tool opted in.
  });
  rich.length = 0;
  await afterToolCall("get_unmanaged_apps", UNMANAGED_APPS_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")), "an inventory tool must not auto-publish unless explicitly opted in");
});

test("an opt-in list naming a DIFFERENT inventory tool does not enable this one", async () => {
  resetEnv({
    MUNKIREPORT_ENABLED: "true",
    MCP_PUBLISH_MODE: "auto",
    MCP_PUBLISH_MIN_SEVERITY: "info",
    MCP_PUBLISH_INVENTORY_TOOLS: "get_orphaned_apps,get_lost_mode_devices",
  });
  rich.length = 0;
  await afterToolCall("get_unmanaged_apps", UNMANAGED_APPS_RESULT);
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")), "opt-in is per-tool-name, not fleet-wide");
});

test("the inventory opt-in gate does not affect a non-inventory tool (get_stale_devices still publishes unconditionally in auto mode)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await afterToolCall("get_stale_devices", STALE_DEVICES_RESULT);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call, "non-inventory tools must be unaffected by MCP_PUBLISH_INVENTORY_TOOLS being unset");
});

test("get_compliance_violators' array-valued {failures} field is joined with ', ' in the message", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const violatorsResult = {
    violators: [{ serial: "C02GGG777", name: "Grace's Mac", failures: ["passcode_not_compliant", "filevault_off"] }],
  };
  await afterToolCall("get_compliance_violators", violatorsResult);
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  assert.match(body.findings[0].message, /passcode_not_compliant, filevault_off/);
});
