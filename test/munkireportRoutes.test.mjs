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
