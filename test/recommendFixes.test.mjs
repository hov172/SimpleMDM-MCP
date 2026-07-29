process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildRecommendations } = await import("../dist/analytics/recommendations.js");

// Field names below match the REAL result shapes of the four source tools (verified
// against src/index.ts's handlers -- see the citations in src/analytics/recommendations.ts):
//   - get_certificate_expiration_audit: { warning, days_until_expiry, expires_at }
//   - get_dep_token_audit: { servers: [{ server_name, warning, days_until_expiry }] }
//   - get_compliance_violators: { violators: [{ id, failures }], failure_counts }
//   - get_stale_devices: { devices: [{ id, days_since }] }
const INPUTS = {
  certAudit: { warning: "renew_now", days_until_expiry: 12, expires_at: "2026-08-09" },
  depAudit: { servers: [
    { server_name: "SLC-DEP-1", warning: "renew_soon", days_until_expiry: 40 },
    { server_name: "SLC-DEP-2", warning: "expired", days_until_expiry: -3 },
  ]},
  complianceViolators: {
    violators: [
      { id: 1, failures: ["os_mac_majors_behind"] },
      { id: 2, failures: ["os_mac_majors_behind"] },
      { id: 3, failures: ["os_mac_majors_behind"] },
      { id: 4, failures: ["filevault_off"] },
      { id: 5, failures: ["filevault_off"] },
      { id: 6, failures: ["passcode_not_compliant"] },
      { id: 9, failures: ["os_unsupported"] },
    ],
    failure_counts: { os_mac_majors_behind: 3, filevault_off: 2, passcode_not_compliant: 1, os_unsupported: 1 },
  },
  staleDevices: { devices: [{ id: 7, days_since: 45 }, { id: 8, days_since: 16 }] },
};

test("severity mapping and ordering: critical first, then warning, then info", () => {
  const recs = buildRecommendations(INPUTS);
  const sevs = recs.map((r) => r.severity);
  const order = { critical: 0, warning: 1, info: 2 };
  for (let i = 1; i < sevs.length; i++) {
    assert.ok(order[sevs[i]] >= order[sevs[i - 1]], `out of order at ${i}: ${sevs.join(",")}`);
  }
  assert.equal(recs[0].severity, "critical");
});

test("every recommendation maps to a real remediation target", () => {
  const KNOWN_PROMPTS = ["emergency-patching", "stale-devices-cleanup", "compliance-violators-remediation", "profile-coverage-remediation", "device-offboarding"];
  for (const r of buildRecommendations(INPUTS)) {
    assert.ok(["tool", "prompt", "manual"].includes(r.remediation.type), r.id);
    if (r.remediation.type === "prompt") assert.ok(KNOWN_PROMPTS.includes(r.remediation.name), `${r.id}: unknown prompt ${r.remediation.name}`);
    assert.ok(r.affected_count >= 1, r.id);
    assert.ok(r.summary.length > 10, r.id);
    assert.ok(r.source_tool.startsWith("get_"), r.id);
  }
});

test("expired/renew_now certs and DEP tokens are critical; renew_soon is warning", () => {
  const recs = buildRecommendations(INPUTS);
  const apns = recs.find((r) => r.category === "certificates");
  assert.equal(apns.severity, "critical");
  assert.equal(apns.remediation.type, "manual");
  const depCritical = recs.find((r) => r.category === "dep" && r.severity === "critical");
  assert.match(depCritical.summary, /SLC-DEP-2/);
  const depWarning = recs.find((r) => r.category === "dep" && r.severity === "warning");
  assert.match(depWarning.summary, /SLC-DEP-1/);
});

test("compliance groups map to prompts with affected counts", () => {
  const recs = buildRecommendations(INPUTS);
  const os = recs.find((r) => r.id === "compliance-os_mac_majors_behind");
  assert.equal(os.affected_count, 3);
  assert.equal(os.remediation.name, "emergency-patching");
  assert.equal(os.remediation.args_hint, "mac");
  const stale = recs.find((r) => r.category === "stale_devices");
  assert.equal(stale.affected_count, 2);
  assert.equal(stale.remediation.name, "stale-devices-cleanup");
});

test("os_unsupported maps to a critical emergency-patching recommendation", () => {
  const recs = buildRecommendations(INPUTS);
  const unsupported = recs.find((r) => r.id === "compliance-os_unsupported");
  assert.ok(unsupported, "expected a recommendation for os_unsupported");
  assert.equal(unsupported.severity, "critical");
  assert.equal(unsupported.category, "compliance");
  assert.equal(unsupported.affected_count, 1);
  assert.equal(unsupported.remediation.type, "prompt");
  assert.equal(unsupported.remediation.name, "emergency-patching");
  assert.equal(unsupported.remediation.args_hint, undefined, "os_unsupported has no platform capture, so no args_hint");
  assert.match(unsupported.summary, /unsupported OS/);
});

test("a numeric os_*_majors_behind capture (live lag-count data) omits args_hint", () => {
  const recs = buildRecommendations({
    certAudit: null,
    depAudit: null,
    staleDevices: null,
    complianceViolators: {
      violators: [{ id: 1, failures: ["os_2_majors_behind"] }],
      failure_counts: { os_2_majors_behind: 1 },
    },
  });
  const os = recs.find((r) => r.id === "compliance-os_2_majors_behind");
  assert.ok(os);
  assert.equal(os.remediation.name, "emergency-patching");
  assert.equal(os.remediation.args_hint, undefined, "numeric lag capture must not be forwarded as a platform args_hint");
});

test("empty inputs produce an empty list, not throws", () => {
  assert.deepEqual(buildRecommendations({ certAudit: null, depAudit: null, complianceViolators: null, staleDevices: null }), []);
});

test("recommend_fixes is registered read-only with min_severity/categories/limit params", async () => {
  const { TOOLS, WRITE_TOOLS } = await import("../dist/index.js");
  const tool = TOOLS.find((t) => t.name === "recommend_fixes");
  assert.ok(tool, "tool must be registered");
  assert.ok(!WRITE_TOOLS.has("recommend_fixes"));
  assert.ok(tool.inputSchema.properties.min_severity);
  assert.ok(tool.inputSchema.properties.limit);
});
