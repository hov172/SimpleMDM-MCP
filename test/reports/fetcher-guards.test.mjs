// Backfill (Task 6 coverage-diff gate — reviewer Finding 1): the
// missing-apiKey guard on scripts/lib/simplemdm.mjs fetchers.
//
// The guards (reject synchronously before any network call when apiKey is
// null/falsy) were originally the ONLY coverage in the legacy suites:
//   inventory-report.test.mjs:20-23  — fetchAssignmentGroupsRaw, fetchAppCatalog
//   logs-audit.test.mjs:215-217      — fetchDeviceLogs
//
// The fetchers are still live — dist/reports/cli/inputs.js imports them
// directly from scripts/lib/simplemdm.mjs. The original Task 6 report
// incorrectly deferred these as an "architecture change"; the reviewer
// confirmed they remain the only coverage for live code. Every exported
// fetcher in simplemdm.mjs that has the guard is tested below.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAssignmentGroupsRaw,
  fetchAppCatalog,
  fetchDeviceLogs,
  fetchAllDevicesRaw,
  fetchDeviceGroups,
  fetchProfilesRaw,
  fetchDeviceApps,
  fetchDeviceProfiles,
  fetchDeviceUsers,
} from "../../scripts/lib/simplemdm.mjs";

const NULL_KEY_MSG = /Missing SIMPLEMDM_API_KEY/;

// ── originally covered by inventory-report.test.mjs:20-23 ────────────────────

test("fetchAssignmentGroupsRaw(null) rejects before any network call", async () => {
  await assert.rejects(() => fetchAssignmentGroupsRaw(null), NULL_KEY_MSG);
});

test("fetchAppCatalog(null) rejects before any network call", async () => {
  await assert.rejects(() => fetchAppCatalog(null), NULL_KEY_MSG);
});

// ── originally covered by logs-audit.test.mjs:215-217 ────────────────────────

test("fetchDeviceLogs(null, serial) rejects before any network call", async () => {
  await assert.rejects(() => fetchDeviceLogs(null, "C02AAA111"), NULL_KEY_MSG);
});

// ── additional guarded fetchers called by the unified runtime ─────────────────

test("fetchAllDevicesRaw(null) rejects before any network call", async () => {
  await assert.rejects(() => fetchAllDevicesRaw(null), NULL_KEY_MSG);
});

test("fetchDeviceGroups(null) rejects before any network call", async () => {
  await assert.rejects(() => fetchDeviceGroups(null), NULL_KEY_MSG);
});

test("fetchProfilesRaw(null) rejects before any network call", async () => {
  await assert.rejects(() => fetchProfilesRaw(null), NULL_KEY_MSG);
});

test("fetchDeviceApps(null, deviceId) rejects before any network call", async () => {
  await assert.rejects(() => fetchDeviceApps(null, 101), NULL_KEY_MSG);
});

test("fetchDeviceProfiles(null, deviceId) rejects before any network call", async () => {
  await assert.rejects(() => fetchDeviceProfiles(null, 101), NULL_KEY_MSG);
});

test("fetchDeviceUsers(null, deviceId) rejects before any network call", async () => {
  await assert.rejects(() => fetchDeviceUsers(null, 101), NULL_KEY_MSG);
});
