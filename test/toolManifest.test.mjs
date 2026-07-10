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

test("a representative action tool (lock_device) is classified action, publishable, and supports auto-publish on FAILURE via actionFailure (no success-path adapters)", () => {
  const entry = TOOL_MANIFEST["lock_device"];
  assert.equal(entry.toolType, "action");
  assert.equal(entry.publishable, true);
  assert.equal(entry.supportsAutoPublish, true);
  assert.equal(entry.adapters, undefined, "action tools have no 'healthy' finding, only a failure one");
  assert.deepStrictEqual(entry.actionFailure, { entityIdField: "device_id", entityLabel: "device" });
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

// Inventory-tool opt-in publishing (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
// §1): every inventory tool must be classified, but only the ones with a genuine
// pre-filtered per-row shape get a wired adapter. This locks down exactly which
// inventory tools got one, so a future edit can't silently add/drop one without a
// test failure forcing a conscious update.
const INVENTORY_TOOLS_WITH_ADAPTERS = [
  "get_unmanaged_apps",
  "get_app_coverage",
  "get_assignment_group_drift",
  "get_inactive_assignment_groups",
  "get_lost_mode_devices",
  "get_orphaned_apps",
  "get_orphaned_profiles",
  "get_user_attribution",
].sort();

test("only the designed subset of inventory tools have a wired adapter", () => {
  const actualInventoryToolsWithAdapters = Object.entries(TOOL_MANIFEST)
    .filter(([, entry]) => entry.toolType === "inventory" && Array.isArray(entry.adapters) && entry.adapters.length > 0)
    .map(([name]) => name)
    .sort();
  assert.deepStrictEqual(actualInventoryToolsWithAdapters, INVENTORY_TOOLS_WITH_ADAPTERS);
});

test("every inventory tool with an adapter has severity:info (never danger/warning) and supportsAutoPublish:true", () => {
  for (const name of INVENTORY_TOOLS_WITH_ADAPTERS) {
    const entry = TOOL_MANIFEST[name];
    assert.equal(entry.toolType, "inventory");
    assert.equal(entry.supportsAutoPublish, true, `${name} should support auto-publish once opted in`);
    assert.ok(entry.adapters.length > 0, `${name} should have at least one adapter`);
    for (const adapter of entry.adapters) {
      assert.equal(adapter.severity, "info", `${name} inventory adapter must be severity:info`);
    }
  }
});

test("inventory tools deliberately skipped (pure aggregate / no actionable per-row shape) have no adapter", () => {
  const skipped = [
    "get_app_version_drift",
    "get_app_size_footprint",
    "get_apps_by_publisher",
    "get_top_installed_apps",
    "get_network_summary",
    "get_recently_enrolled",
    "get_fleet_summary",
    "get_device_full_profile",
    "get_dep_device_status",
  ];
  for (const name of skipped) {
    const entry = TOOL_MANIFEST[name];
    assert.equal(entry.toolType, "inventory", `${name} should still be classified inventory`);
    assert.equal(entry.publishable, true);
    assert.equal(entry.supportsAutoPublish, false, `${name} should not support auto-publish (no adapter)`);
    assert.equal(entry.adapters, undefined, `${name} should have no adapter`);
  }
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

test("no tool with adapters has supportsAutoPublish:false, and no tool without adapters or actionFailure has supportsAutoPublish:true", () => {
  // Action tools (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
  // §4) gain supportsAutoPublish via `actionFailure` (failure-path only), not via
  // success-path `adapters` -- they have no "healthy" finding. So the invariant is:
  // supportsAutoPublish must be backed by EITHER adapters OR actionFailure, never neither,
  // and never true with neither present.
  for (const [name, entry] of Object.entries(TOOL_MANIFEST)) {
    const hasAdapters = Array.isArray(entry.adapters) && entry.adapters.length > 0;
    const hasActionFailure = !!entry.actionFailure;
    assert.ok(!(hasAdapters && hasActionFailure), `${name}: a tool should not have both adapters and actionFailure`);
    assert.equal(entry.supportsAutoPublish, hasAdapters || hasActionFailure, `${name}: supportsAutoPublish must match adapter/actionFailure presence`);
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
  get_unmanaged_apps: { bundle_identifier: "com.example.foo", name: "Foo", count: 12 },
  get_app_coverage: { id: "1", name: "Liam's Mac", serial: "C02L" },
  get_assignment_group_drift: { group_id: "5", group_name: "Engineering", device_id: "42", missing: ["com.example.bar"] },
  get_inactive_assignment_groups: { id: "9", name: "Stale Group" },
  get_lost_mode_devices: { id: "10", name: "Mona's iPad", serial: "C02M" },
  get_orphaned_apps: { id: "11", name: "Orphan App" },
  get_orphaned_profiles: { id: "12", name: "Orphan Profile" },
  get_user_attribution: { device_id: "13", device_name: "Nora's Mac", serial: "C02N", user: null },
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
