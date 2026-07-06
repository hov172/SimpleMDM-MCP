// INVALIDATION_MAP coverage — every write tool must invalidate the caches its
// mutation can affect, or the canonical agent loop "write → read to verify"
// reads 5-minute-stale data and reports false failures.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const { INVALIDATION_MAP, WRITE_TOOLS } = await import("../dist/index.js");

test("every write tool has an INVALIDATION_MAP entry", () => {
  const missing = [...WRITE_TOOLS].filter((t) => !(t in INVALIDATION_MAP));
  assert.deepEqual(missing, [], `write tools with no invalidation entry: ${missing.join(", ")}`);
});

test("per-device assignment writes invalidate /devices sub-resource caches", () => {
  // These mutate /devices/{id}/profiles or /devices/{id}/installed_apps, which are
  // cached under keys starting with "/devices" — prefix invalidation needs "/devices".
  const perDevice = [
    "assign_profile_to_device", "unassign_profile_from_device",
    "assign_custom_profile_to_device", "unassign_custom_profile_from_device",
    "assign_declaration_to_device", "unassign_declaration_from_device",
    "uninstall_app", "update_installed_app", "request_app_management",
  ];
  for (const tool of perDevice) {
    assert.ok(INVALIDATION_MAP[tool]?.includes("/devices"),
      `${tool} must invalidate "/devices" (covers /devices/{id}/... caches); has: ${JSON.stringify(INVALIDATION_MAP[tool])}`);
  }
});

test("group-level pushes that change device state invalidate /devices too", () => {
  const groupPush = [
    "assign_app_to_group", "unassign_app_from_group",
    "assign_profile_to_group", "unassign_profile_from_group",
    "push_apps_to_group", "update_apps_in_group", "sync_profiles_in_group",
  ];
  for (const tool of groupPush) {
    assert.ok(INVALIDATION_MAP[tool]?.includes("/devices"),
      `${tool} must invalidate "/devices"; has: ${JSON.stringify(INVALIDATION_MAP[tool])}`);
  }
});

test("set_managed_app_config_schema invalidates /apps (managed_configs cache)", () => {
  assert.ok(INVALIDATION_MAP["set_managed_app_config_schema"]?.includes("/apps"),
    `has: ${JSON.stringify(INVALIDATION_MAP["set_managed_app_config_schema"])}`);
});
