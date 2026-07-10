import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.MUNKIREPORT_BASE_URL = "https://munkireport.example.edu";

const rich = [];
globalThis.fetch = async (url, opts) => {
  rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
};

const { runReport } = await import("../../dist/reports/cli.js");

function evaluatedDevice(overrides = {}) {
  return {
    id: 1, name: "Alice", deviceName: "Alice", serial: "C02ABC123", deviceGroup: "Faculty",
    model: "MacBook Pro", osVersion: "14.5", platform: "macOS", osStatus: "eol",
    latest: "14.5", latestMinor: "14.5", latestMajor: "14", maxMajor: 14,
    recommended: { target: null, path: [], replace: false },
    cvesBehind: 0, exploitedBehind: 0, filevaultOk: true, sipOk: true, firewallOk: true,
    xprotect: { value: "2200", status: "ok" }, hasFilevault: true, findings: [], failCount: 1,
    lastSeen: null, ...overrides,
  };
}

const FAKE_AUDIT_INPUT = {
  ev: [evaluatedDevice()],
  tables: { macOS: new Map(), ios: new Map(), supportedMacMajors: [], supportedIosMajors: [], xprotectLatest: null, modelMaxMajor: new Map() },
  cveDetail: [], summary: {}, dateStr: "2026-07-10", scoped: false, account: null,
};

const baseOpts = (extra) => ({
  report: "audit", scope: null, format: "md", outDir: "/tmp/mcp-publish-test", reportOnly: true,
  ...extra,
});

test("publish:true on an audit run POSTs derived findings to ingest_mcp_findings", async () => {
  rich.length = 0;
  await runReport(baseOpts({ publish: true, scanId: "scan_mcp_audit_20260710" }), {
    fetchInput: async () => FAKE_AUDIT_INPUT,
    log: () => {},
  });
  const call = rich.find((c) => c.url === "https://munkireport.example.edu/module/simplemdm/ingest_mcp_findings");
  assert.ok(call, `expected an ingest_mcp_findings POST; got: ${rich.map((c) => c.url).join(", ")}`);
  const body = JSON.parse(call.body);
  assert.equal(body.source, "sofa_audit");
  assert.equal(body.scan_id, "scan_mcp_audit_20260710");
  assert.equal(body.findings.length, 1);
  assert.equal(body.findings[0].finding_type, "os_eol");
});

test("publish:false (default) does not call ingest_mcp_findings", async () => {
  rich.length = 0;
  await runReport(baseOpts({}), { fetchInput: async () => FAKE_AUDIT_INPUT, log: () => {} });
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("publish:true without scanId auto-generates scan_mcp_audit_<dateStr>", async () => {
  rich.length = 0;
  await runReport(baseOpts({ publish: true }), { fetchInput: async () => FAKE_AUDIT_INPUT, log: () => {} });
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  const body = JSON.parse(call.body);
  assert.match(body.scan_id, /^scan_mcp_audit_/);
});

test("a publish failure logs a warning and does not throw", async () => {
  rich.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  const logs = [];
  const result = await runReport(baseOpts({ publish: true }), { fetchInput: async () => FAKE_AUDIT_INPUT, log: (m) => logs.push(m) });
  assert.ok(result.files.length >= 0, "runReport must still return a result, not throw");
  assert.ok(logs.some((l) => /publish/i.test(l) && /fail/i.test(l)), `expected a publish-failure warning in logs; got: ${logs.join(" | ")}`);
  globalThis.fetch = realFetch;
});
