// WRITE_TIERS completeness — every write tool has exactly one risk tier and
// no tier entry names a tool that isn't a write tool. The critical tier must
// cover the full legacy DESTRUCTIVE set so destructiveHint annotations are
// unchanged by the tiers refactor.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const { WRITE_TIERS, CONFIRM_TIERS } = await import("../../dist/safety/tiers.js");
const { WRITE_TOOLS } = await import("../../dist/index.js");

const LEGACY_DESTRUCTIVE = [
  "wipe_device", "disable_activation_lock", "unenroll_device",
  "delete_device", "delete_device_user", "delete_app", "delete_assignment_group",
  "delete_custom_attribute", "delete_custom_configuration_profile",
  "delete_custom_declaration", "delete_enrollment", "delete_managed_app_config",
  "delete_script", "clear_passcode", "clear_restrictions_password",
  "clear_firmware_password", "clear_recovery_lock_password",
];

test("every write tool has a tier and every tier entry is a write tool", () => {
  const missing = [...WRITE_TOOLS].filter((t) => !(t in WRITE_TIERS));
  const extra = Object.keys(WRITE_TIERS).filter((t) => !WRITE_TOOLS.has(t));
  assert.deepEqual(missing, [], `write tools with no tier: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `tier entries that are not write tools: ${extra.join(", ")}`);
});

test("tier values are valid", () => {
  const valid = new Set(["low", "medium", "high", "critical"]);
  const bad = Object.entries(WRITE_TIERS).filter(([, v]) => !valid.has(v));
  assert.deepEqual(bad, []);
});

test("critical tier is exactly the legacy DESTRUCTIVE set", () => {
  const critical = Object.entries(WRITE_TIERS).filter(([, v]) => v === "critical").map(([k]) => k).sort();
  assert.deepEqual(critical, [...LEGACY_DESTRUCTIVE].sort());
});

test("CONFIRM_TIERS is high+critical", () => {
  assert.deepEqual([...CONFIRM_TIERS].sort(), ["critical", "high"]);
});
