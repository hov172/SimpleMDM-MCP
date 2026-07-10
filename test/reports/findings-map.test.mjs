import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatedDeviceToFindings } from "../../dist/reports/domain/findings-map.js";

function baseDevice(overrides = {}) {
  return {
    id: 1, name: "Alice's MacBook", deviceName: "Alice's MacBook", serial: "C02ABC123",
    deviceGroup: "Faculty", model: "MacBook Pro", osVersion: "14.5", platform: "macOS",
    osStatus: "current", latest: "14.5", latestMinor: "14.5", latestMajor: "14",
    maxMajor: 14, recommended: { target: null, path: [], replace: false },
    cvesBehind: 0, exploitedBehind: 0,
    filevaultOk: true, sipOk: true, firewallOk: true,
    xprotect: { value: "2200", status: "ok" },
    hasFilevault: true, findings: [], failCount: 0, lastSeen: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

test("a fully-passing device produces zero findings", () => {
  const findings = evaluatedDeviceToFindings(baseDevice());
  assert.deepStrictEqual(findings, []);
});

test("filevault disabled → filevault_disabled/FileVault/warning", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ filevaultOk: false }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].serial_number, "C02ABC123");
  assert.equal(findings[0].finding_type, "filevault_disabled");
  assert.equal(findings[0].category, "FileVault");
  assert.equal(findings[0].severity, "warning");
});

test("sip disabled → sip_disabled/SIP/warning", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ sipOk: false }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].finding_type, "sip_disabled");
  assert.equal(findings[0].category, "SIP");
  assert.equal(findings[0].severity, "warning");
});

test("firewall disabled → firewall_disabled/Firewall/warning", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ firewallOk: false }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].finding_type, "firewall_disabled");
  assert.equal(findings[0].category, "Firewall");
  assert.equal(findings[0].severity, "warning");
});

test("xprotect outdated → xprotect_outdated/XProtect/warning", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ xprotect: { value: "2100", status: "outdated" } }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].finding_type, "xprotect_outdated");
  assert.equal(findings[0].category, "XProtect");
  assert.equal(findings[0].severity, "warning");
});

test("cvesBehind > 0, exploitedBehind 0 → cve_exposure/Compliance/warning", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ cvesBehind: 3, exploitedBehind: 0 }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].finding_type, "cve_exposure");
  assert.equal(findings[0].category, "Compliance");
  assert.equal(findings[0].severity, "warning");
});

test("cvesBehind > 0, exploitedBehind > 0 → cve_exposure/Compliance/danger", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ cvesBehind: 3, exploitedBehind: 1 }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "danger");
});

test("osStatus eol → os_eol/OS/danger", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ osStatus: "eol" }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].finding_type, "os_eol");
  assert.equal(findings[0].category, "OS");
  assert.equal(findings[0].severity, "danger");
});

test("osStatus outdated (not eol) → no os_eol finding", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({ osStatus: "outdated" }));
  assert.ok(!findings.some((f) => f.finding_type === "os_eol"));
});

test("multiple simultaneous failures → one finding per failed check, all with the same serial_number", () => {
  const findings = evaluatedDeviceToFindings(baseDevice({
    filevaultOk: false, sipOk: false, cvesBehind: 2, exploitedBehind: 0, osStatus: "eol",
  }));
  assert.equal(findings.length, 4);
  assert.ok(findings.every((f) => f.serial_number === "C02ABC123"));
  const types = findings.map((f) => f.finding_type).sort();
  assert.deepStrictEqual(types, ["cve_exposure", "filevault_disabled", "os_eol", "sip_disabled"]);
});
