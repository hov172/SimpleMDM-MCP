import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const { findingsFromAdapters } = await import("../../dist/findings/middleware.js");
const { TOOL_MANIFEST } = await import("../../dist/findings/toolManifest.js");

const adapters = TOOL_MANIFEST["get_dep_token_audit"].adapters;

const result = {
  servers: [
    { server_name: "D-expired",   organization_name: "Org", days_until_expiry: -5,  warning: "expired" },
    { server_name: "A-renewnow",  organization_name: "Org", days_until_expiry: 10,  warning: "renew_now" },
    { server_name: "B-renewsoon", organization_name: "Org", days_until_expiry: 60,  warning: "renew_soon" },
    { server_name: "C-ok",        organization_name: "Org", days_until_expiry: 200, warning: "ok" },
    { server_name: "E-unknown",   organization_name: "Org", days_until_expiry: null, warning: "unknown" },
  ],
};

test("dep token adapters publish only renew_now/expired (danger) and renew_soon (warning)", () => {
  const findings = findingsFromAdapters(adapters, result, "info");

  // ok and unknown must never produce findings
  assert.equal(findings.length, 3);

  const bySeverity = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; }, {});
  assert.equal(bySeverity.danger, 2);   // expired + renew_now
  assert.equal(bySeverity.warning, 1);  // renew_soon

  for (const f of findings) {
    assert.equal(f.category, "DEP Tokens");
    assert.equal(f.finding_type, "dep_token_expiring");
    assert.equal(f.serial_number, undefined); // org-level, no serial
  }

  const expired = findings.find(f => f.message.includes("D-expired"));
  assert.equal(expired.severity, "danger");
  assert.match(expired.message, /expires in -5 days \(expired\)/);

  assert.ok(!findings.some(f => f.message.includes("C-ok")));
  assert.ok(!findings.some(f => f.message.includes("E-unknown")));
});
