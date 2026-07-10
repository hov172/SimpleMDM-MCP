import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const { TOOLS } = await import("../dist/index.js");
const { TOOL_MANIFEST } = await import("../dist/findings/toolManifest.js");

test("every registered tool has exactly one manifest entry", () => {
  const registered = new Set(TOOLS.map((t) => t.name));
  const manifested = new Set(Object.keys(TOOL_MANIFEST));

  const missing = [...registered].filter((n) => !manifested.has(n));
  assert.deepStrictEqual(missing, [], `tools missing a manifest entry: ${missing.join(", ")}`);

  const stale = [...manifested].filter((n) => !registered.has(n));
  assert.deepStrictEqual(stale, [], `manifest entries for tools no longer registered: ${stale.join(", ")}`);
});

test("run_fleet_audit and run_device_logs_audit are classified audit, no adapters (use findings-map.ts instead)", () => {
  for (const name of ["run_fleet_audit", "run_device_logs_audit"]) {
    const entry = TOOL_MANIFEST[name];
    assert.equal(entry.toolType, "audit");
    assert.equal(entry.publishable, true);
    assert.equal(entry.adapters, undefined, `${name} should not have a middleware adapter`);
  }
});

test("a representative compliance/health-check tool has a real adapter", () => {
  const entry = TOOL_MANIFEST["get_stale_devices"];
  assert.equal(entry.toolType, "health_check");
  assert.equal(entry.publishable, true);
  assert.equal(entry.supportsAutoPublish, true);
  assert.equal(entry.adapters.length, 1);
  assert.equal(entry.adapters[0].resultField, "devices");
  assert.equal(entry.adapters[0].serialField, "serial");
});

test("get_storage_health has two independent adapters (two distinct finding kinds from one tool)", () => {
  const entry = TOOL_MANIFEST["get_storage_health"];
  assert.equal(entry.adapters.length, 2);
  const fields = entry.adapters.map((a) => a.resultField).sort();
  assert.deepStrictEqual(fields, ["low_battery_devices", "low_disk_devices"]);
});

test("get_certificate_expiration_audit uses resultField '' (whole-result adapter) with a conditionField", () => {
  const entry = TOOL_MANIFEST["get_certificate_expiration_audit"];
  assert.equal(entry.adapters.length, 1);
  assert.equal(entry.adapters[0].resultField, "");
  assert.equal(entry.adapters[0].conditionField, "warning");
  assert.equal(entry.adapters[0].serialField, null);
});

test("get_security_posture is classified compliance but has no adapter (pure aggregate, not per-row)", () => {
  const entry = TOOL_MANIFEST["get_security_posture"];
  assert.equal(entry.toolType, "compliance");
  assert.equal(entry.publishable, true);
  assert.equal(entry.supportsAutoPublish, false);
  assert.equal(entry.adapters, undefined);
});

test("a representative action tool (lock_device) is classified action, publishable but auto-publish deferred", () => {
  const entry = TOOL_MANIFEST["lock_device"];
  assert.equal(entry.toolType, "action");
  assert.equal(entry.publishable, true);
  assert.equal(entry.supportsAutoPublish, false, "action-tool adapters are deferred in this slice");
});

test("a representative config-write tool (create_device) is never publishable", () => {
  const entry = TOOL_MANIFEST["create_device"];
  assert.equal(entry.toolType, "config_write");
  assert.equal(entry.publishable, false);
  assert.equal(entry.supportsAutoPublish, false);
});

test("a representative read-only query tool (list_devices) is never publishable", () => {
  const entry = TOOL_MANIFEST["list_devices"];
  assert.equal(entry.toolType, "read_only_query");
  assert.equal(entry.publishable, false);
});

test("a representative inventory tool (get_top_installed_apps) is publishable but not auto-publish by default", () => {
  const entry = TOOL_MANIFEST["get_top_installed_apps"];
  assert.equal(entry.toolType, "inventory");
  assert.equal(entry.publishable, true);
  assert.equal(entry.supportsAutoPublish, false);
});

test("every adapter's resultField is a string and severity is one of danger/warning/info", () => {
  const validSeverities = new Set(["danger", "warning", "info"]);
  for (const [name, entry] of Object.entries(TOOL_MANIFEST)) {
    if (!entry.adapters) continue;
    for (const adapter of entry.adapters) {
      assert.equal(typeof adapter.resultField, "string", `${name} adapter.resultField must be a string`);
      assert.ok(validSeverities.has(adapter.severity), `${name} adapter.severity "${adapter.severity}" invalid`);
      assert.equal(typeof adapter.messageTemplate, "string", `${name} adapter.messageTemplate must be a string`);
    }
  }
});

test("no tool with adapters has supportsAutoPublish:false, and no tool without adapters has supportsAutoPublish:true", () => {
  for (const [name, entry] of Object.entries(TOOL_MANIFEST)) {
    const hasAdapters = Array.isArray(entry.adapters) && entry.adapters.length > 0;
    assert.equal(entry.supportsAutoPublish, hasAdapters, `${name}: supportsAutoPublish must match adapter presence`);
  }
});
