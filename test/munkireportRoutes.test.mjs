// The five get_munkireport_* tools must call routes the SimpleMDM-MunkiReport
// module ACTUALLY serves. MunkiReport routes modules as /module/<name>/<public
// method>; the module's controller defines get_compliance_stats,
// get_supplemental_applecare_stats, get_supplemental_overview_stats,
// get_sync_telemetry, get_device_resources. Regression: three routes used a
// phantom "/simplemdm/data/…" shape (doubling the module prefix) and
// sync_health guessed a method name that doesn't exist — 4 of 5 tools 404'd
// against the real module.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.MUNKIREPORT_BASE_URL = "https://munkireport.example.edu";
process.env.SIMPLEMDM_ALLOW_WRITES = "true"; // for the two module-action tools (read at import)
// MUNKIREPORT_MODULE_PREFIX deliberately unset → default /module/simplemdm

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
};

const { handleTool } = await import("../dist/index.js");

const BASE = "https://munkireport.example.edu/module/simplemdm";

test("all five munkireport tools call routes the module actually serves", async () => {
  await handleTool("get_munkireport_compliance", {});
  await handleTool("get_munkireport_apple_care", {});
  await handleTool("get_munkireport_supplemental_overview", {});
  await handleTool("get_munkireport_sync_health", {});
  await handleTool("get_munkireport_device_resources", { serial_number: "C02ABC123" });

  const expected = [
    `${BASE}/get_compliance_stats`,
    `${BASE}/get_supplemental_applecare_stats`,
    `${BASE}/get_supplemental_overview_stats`,
    `${BASE}/get_sync_telemetry`,
    `${BASE}/get_device_resources/C02ABC123`,
  ];
  for (const url of expected) {
    assert.ok(calls.includes(url), `expected ${url}\n  got: ${calls.join("\n       ")}`);
  }
  // No phantom shapes may survive.
  assert.ok(!calls.some((c) => c.includes("/simplemdm/simplemdm/") || c.includes("/data/")),
    `phantom route shape present: ${calls.join(", ")}`);
});

// ── v0.32.0 expansion: nine tools covering the module's full useful surface ──

test("the nine expansion tools call their verified module routes", async () => {
  calls.length = 0;
  await handleTool("get_munkireport_alerts", {});
  await handleTool("get_munkireport_alerts", { serial_number: "C02X", type: "danger", limit: 50 });
  await handleTool("get_munkireport_command_status", {});
  await handleTool("get_munkireport_dashboard_trend", { days: 90 });
  await handleTool("get_munkireport_supplemental_data", { serial_number: "C02X" });
  await handleTool("get_munkireport_supplemental_status", {});
  await handleTool("get_munkireport_client_facts", { serial_number: "C02X" });
  await handleTool("get_munkireport_runner_status", {});
  await handleTool("request_munkireport_sync", {});
  await handleTool("refresh_munkireport_supplemental", {});
  await handleTool("refresh_munkireport_supplemental", { serial_number: "C02X" });

  const expected = [
    `${BASE}/get_events`,
    `${BASE}/get_events/C02X?limit=50&type=danger`,
    `${BASE}/get_command_status_stats`,
    `${BASE}/get_dashboard_trend?days=90`,
    `${BASE}/get_supplemental_data/C02X`,
    `${BASE}/get_supplemental_status`,
    `${BASE}/get_client_facts/C02X`,
    `${BASE}/get_runner_status`,
    `${BASE}/request_sync`,
    `${BASE}/refresh_supplemental_summary`,
    `${BASE}/refresh_supplemental_summary/C02X`,
  ];
  for (const url of expected) {
    assert.ok(calls.includes(url), `expected ${url}\n  got: ${calls.join("\n       ")}`);
  }
});

test("the two module actions are write-gated", async () => {
  const { WRITE_TOOLS } = await import("../dist/index.js");
  assert.ok(WRITE_TOOLS.has("request_munkireport_sync"));
  assert.ok(WRITE_TOOLS.has("refresh_munkireport_supplemental"));
});

// ── v0.33.0: the MCP→module findings channel ──────────────────────────────────
// push_munkireport_findings POSTs MCP-computed findings to the module's
// sync-token-authenticated ingest_mcp_findings; get_munkireport_mcp_findings
// reads them back. The push must carry the X-SimpleMDM-API-Key token header
// and a JSON body; reads must NOT leak the token.

const rich = [];
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body, headers: opts?.headers ?? {} });
  return prevFetch(url, opts);
};

test("push_munkireport_findings POSTs the findings payload with the sync token", async () => {
  rich.length = 0;
  await handleTool("push_munkireport_findings", {
    source: "sofa_audit",
    findings: [
      { serial_number: "C02X", finding_type: "cve-exposure", severity: "danger", message: "3 exploited CVEs unfixed" },
      { finding_type: "fleet-os-lag", severity: "warning", message: "12% of Macs one major behind" },
    ],
  });
  const call = rich.find((c) => c.url === `${BASE}/ingest_mcp_findings`);
  assert.ok(call, `expected POST ${BASE}/ingest_mcp_findings; got: ${rich.map((c) => c.url).join(", ")}`);
  assert.equal(call.method, "POST");
  assert.equal(call.headers["X-SimpleMDM-API-Key"], "dummy-key", "sync token header required");
  const body = JSON.parse(call.body);
  assert.equal(body.source, "sofa_audit");
  assert.equal(body.findings.length, 2);
  assert.equal(body.replace, true, "replace defaults to true");
});

test("push_munkireport_findings forwards scan_id when provided", async () => {
  rich.length = 0;
  await handleTool("push_munkireport_findings", {
    source: "sofa_audit",
    scan_id: "scan_mcp_audit_20260710",
    findings: [{ finding_type: "os_eol", severity: "danger", message: "EOL" }],
  });
  const call = rich.find((c) => c.url === `${BASE}/ingest_mcp_findings`);
  const body = JSON.parse(call.body);
  assert.equal(body.scan_id, "scan_mcp_audit_20260710");
});

test("push_munkireport_findings omits scan_id from the body when not provided", async () => {
  rich.length = 0;
  await handleTool("push_munkireport_findings", {
    source: "sofa_audit",
    findings: [{ finding_type: "os_eol", severity: "danger", message: "EOL" }],
  });
  const call = rich.find((c) => c.url === `${BASE}/ingest_mcp_findings`);
  const body = JSON.parse(call.body);
  assert.ok(!("scan_id" in body), "scan_id must be absent, not null/undefined, when not provided");
});

test("push_munkireport_findings is write-gated and validates input", async () => {
  const { WRITE_TOOLS } = await import("../dist/index.js");
  assert.ok(WRITE_TOOLS.has("push_munkireport_findings"));
  await assert.rejects(() => handleTool("push_munkireport_findings", { source: "x", findings: [] }),
    /at least one finding/i);
  await assert.rejects(() => handleTool("push_munkireport_findings", { source: "Bad Source!", findings: [{ finding_type: "t", message: "m" }] }),
    /source/i);
});

test("get_munkireport_mcp_findings reads back without the token header", async () => {
  rich.length = 0;
  await handleTool("get_munkireport_mcp_findings", { severity: "danger", limit: 25 });
  const call = rich.find((c) => c.url.includes("/get_mcp_findings"));
  assert.ok(call, `got: ${rich.map((c) => c.url).join(", ")}`);
  assert.equal(call.url, `${BASE}/get_mcp_findings?limit=25&severity=danger`);
  assert.equal(call.method, "GET");
  assert.ok(!("X-SimpleMDM-API-Key" in call.headers), "reads must not leak the SimpleMDM key to MunkiReport");
});
