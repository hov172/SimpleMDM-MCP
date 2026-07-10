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

test("get_certificate_expiration_audit uses resultField '' (whole-result adapter) with a conditionValues gate, not plain truthiness", () => {
  const entry = TOOL_MANIFEST["get_certificate_expiration_audit"];
  assert.equal(entry.adapters.length, 1);
  assert.equal(entry.adapters[0].resultField, "");
  assert.equal(entry.adapters[0].conditionField, "warning");
  // warning is a string enum ("ok"|"renew_soon"|"renew_now"|"expired"|"unknown"), never falsy --
  // a review caught that plain truthiness would have fired on every scan. conditionValues fixes this.
  assert.deepStrictEqual(entry.adapters[0].conditionValues, ["renew_soon", "renew_now", "expired"]);
  assert.ok(!entry.adapters[0].conditionValues.includes("ok"), "a healthy cert must not trigger a finding");
  assert.ok(!entry.adapters[0].conditionValues.includes("unknown"), "missing expiry data must not trigger a finding");
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

// Every {field} referenced in an adapter's messageTemplate must actually exist on that
// tool's real row shape (verified against src/index.ts's handlers). A prior review found
// get_dep_drift/get_dep_unassigned templates referencing {name}, a field neither tool's
// row shape has -- this guard prevents that class of bug recurring silently as more
// adapters are added. Fixture rows below are the real per-tool shapes, not made up.
const REAL_ROW_FIXTURES = {
  get_stale_devices: { serial: "C02A", name: "Alice's Mac", days_since: 20 },
  get_storage_health_low_disk: { serial: "C02B", name: "Bob's Mac", available_gb: 3.2 },
  get_storage_health_low_battery: { serial: "C02C", name: "Carol's Mac", battery_level_pct: 8 },
  get_battery_health_report: { serial: "C02D", name: "Dave's Mac", reason: "low_level" },
  get_compliance_violators: { serial: "C02E", name: "Eve's Mac", failures: ["passcode_not_compliant"] },
  get_devices_missing_profile: { serial: "C02F", name: "Frank's Mac" },
  get_supervision_drift: { serial: "C02G", name: "Grace's Mac" },
  get_device_user_count_outliers: { serial: "C02H", name: "Heidi's Mac", user_count: 7 },
  get_os_eligibility: { serial: "C02I", name: "Ivan's Mac", upgrade_available: true },
  get_enrollment_token_audit: { id: "enr_1", stale: true },
  get_certificate_expiration_audit: { apple_id: "admin@example.edu", days_until_expiry: 21, warning: "renew_now" },
  get_app_install_failures: { app_name: "Foo", status: "failed", device_id: "123" },
  get_pending_commands: { pending_count: 2, oldest_sent_at: "2026-07-01T00:00:00Z" },
  get_dep_drift: { serial: "C02J", assigned_profile_uuid: "uuid-a", expected_profile_uuid: "uuid-b" },
  get_dep_unassigned: { model: "MacBookPro18,1", serial: "C02K" },
};

// resultField for get_storage_health has two adapters (two distinct fixtures above); map
// each adapter to its fixture key explicitly since resultField alone isn't unique for it.
function fixtureKeyFor(toolName, adapter) {
  if (toolName === "get_storage_health") {
    return adapter.resultField === "low_disk_devices" ? "get_storage_health_low_disk" : "get_storage_health_low_battery";
  }
  return toolName;
}

test("every {field} referenced in an adapter's messageTemplate exists on that tool's real row fixture", () => {
  for (const [name, entry] of Object.entries(TOOL_MANIFEST)) {
    if (!entry.adapters) continue;
    for (const adapter of entry.adapters) {
      const fixtureKey = fixtureKeyFor(name, adapter);
      const fixture = REAL_ROW_FIXTURES[fixtureKey];
      assert.ok(fixture, `no fixture registered for ${fixtureKey} -- add one to REAL_ROW_FIXTURES so this guard covers it`);
      const fields = [...adapter.messageTemplate.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const field of fields) {
        assert.ok(
          field in fixture,
          `${name} adapter's messageTemplate references {${field}}, which is not in its real row shape (fixture: ${JSON.stringify(fixture)}) -- messageTemplate: "${adapter.messageTemplate}"`,
        );
      }
    }
  }
});
