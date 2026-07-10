import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.MUNKIREPORT_BASE_URL = "https://munkireport.example.edu";

const rich = [];
let fetchImpl = async (url, opts) => {
  rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
};
globalThis.fetch = (...args) => fetchImpl(...args);

const { onToolError } = await import("../../dist/findings/middleware.js");
const { TOOL_MANIFEST } = await import("../../dist/findings/toolManifest.js");

function resetEnv(overrides = {}) {
  delete process.env.MUNKIREPORT_ENABLED;
  delete process.env.MCP_PUBLISH_MODE;
  delete process.env.MCP_PUBLISH_MIN_SEVERITY;
  delete process.env.MCP_PUBLISH_INVENTORY_TOOLS;
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
  Object.assign(process.env, overrides);
}

// ─── Manifest completeness ─────────────────────────────────────────────────

test("every toolType:action entry has an actionFailure field", () => {
  for (const [name, entry] of Object.entries(TOOL_MANIFEST)) {
    if (entry.toolType !== "action") continue;
    assert.ok(entry.actionFailure, `${name}: action tool missing actionFailure`);
    assert.equal(entry.supportsAutoPublish, true, `${name}: action tool should support auto-publish on failure`);
    assert.equal(entry.adapters, undefined, `${name}: action tools have no success-path adapters`);
    const { entityIdField, entityLabel } = entry.actionFailure;
    assert.ok(entityIdField === null || typeof entityIdField === "string", `${name}: entityIdField must be string|null`);
    assert.equal(typeof entityLabel, "string", `${name}: entityLabel must be a string`);
    assert.ok(entityLabel.length > 0, `${name}: entityLabel must not be empty`);
  }
});

// Spot-check a representative sample per entity type against the real inputSchemas
// read from src/index.ts this session (device_id / group_id / job_id / other).
test("spot-check representative entityIdField mapping per entity type", () => {
  assert.deepStrictEqual(TOOL_MANIFEST["lock_device"].actionFailure, { entityIdField: "device_id", entityLabel: "device" });
  assert.deepStrictEqual(TOOL_MANIFEST["wipe_device"].actionFailure, { entityIdField: "device_id", entityLabel: "device" });
  assert.deepStrictEqual(TOOL_MANIFEST["push_apps_to_group"].actionFailure, { entityIdField: "group_id", entityLabel: "assignment group" });
  assert.deepStrictEqual(TOOL_MANIFEST["update_apps_in_group"].actionFailure, { entityIdField: "group_id", entityLabel: "assignment group" });
  assert.deepStrictEqual(TOOL_MANIFEST["sync_profiles_in_group"].actionFailure, { entityIdField: "group_id", entityLabel: "assignment group" });
  assert.deepStrictEqual(TOOL_MANIFEST["cancel_script_job"].actionFailure, { entityIdField: "job_id", entityLabel: "script job" });
  assert.deepStrictEqual(TOOL_MANIFEST["request_app_management"].actionFailure, { entityIdField: "installed_app_id", entityLabel: "installed app" });
  assert.deepStrictEqual(TOOL_MANIFEST["uninstall_app"].actionFailure, { entityIdField: "installed_app_id", entityLabel: "installed app" });
  assert.deepStrictEqual(TOOL_MANIFEST["update_installed_app"].actionFailure, { entityIdField: "installed_app_id", entityLabel: "installed app" });
  // create_script_job's device_ids arg is a plural array, not a single entity id --
  // script_id is the closest single-entity field its real args actually have.
  assert.deepStrictEqual(TOOL_MANIFEST["create_script_job"].actionFailure, { entityIdField: "script_id", entityLabel: "script" });
  // request_munkireport_sync's real inputSchema has no properties at all -- no entity.
  assert.deepStrictEqual(TOOL_MANIFEST["request_munkireport_sync"].actionFailure, { entityIdField: null, entityLabel: "MunkiReport sync job" });
  // refresh_munkireport_supplemental's serial_number arg is optional (fleet-wide when omitted).
  assert.deepStrictEqual(TOOL_MANIFEST["refresh_munkireport_supplemental"].actionFailure, { entityIdField: "serial_number", entityLabel: "device" });
});

// ─── onToolError finding shape ──────────────────────────────────────────────

test("onToolError builds the correct finding shape for a device-scoped tool", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("lock_device", { device_id: "42" }, new Error("SimpleMDM 422: device is offline"));
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call, "expected a publish call");
  const body = JSON.parse(call.body);
  assert.equal(body.source, "mcp_auto_action_lock_device");
  assert.equal(body.replace, true);
  assert.equal(body.findings.length, 1);
  const finding = body.findings[0];
  assert.equal(finding.finding_type, "action_failed_lock_device");
  assert.equal(finding.category, "Action Failure");
  assert.equal(finding.severity, "danger");
  assert.match(finding.message, /device action "lock_device" failed: SimpleMDM 422: device is offline/);
  assert.deepStrictEqual(finding.data, { device_id: "42" });
  assert.ok(!("serial_number" in finding), "no serial_number -- resolving device_id to serial is out of scope");
});

test("onToolError builds the correct finding shape for a group-scoped tool", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("push_apps_to_group", { group_id: "7" }, new Error("SimpleMDM 500: internal error"));
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  assert.equal(body.source, "mcp_auto_action_push_apps_to_group");
  const finding = body.findings[0];
  assert.equal(finding.finding_type, "action_failed_push_apps_to_group");
  assert.match(finding.message, /assignment group action "push_apps_to_group" failed: SimpleMDM 500: internal error/);
  assert.deepStrictEqual(finding.data, { group_id: "7" });
});

test("onToolError omits `data` for a null-entityIdField tool (request_munkireport_sync)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("request_munkireport_sync", {}, new Error("connection refused"));
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const body = JSON.parse(call.body);
  const finding = body.findings[0];
  assert.equal(finding.finding_type, "action_failed_request_munkireport_sync");
  assert.match(finding.message, /MunkiReport sync job action "request_munkireport_sync" failed: connection refused/);
  assert.ok(!("data" in finding), "data must be omitted entirely when entityIdField is null");
});

test("onToolError omits `data` when the entityIdField is absent from args (e.g. optional serial_number omitted)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("refresh_munkireport_supplemental", {}, new Error("db locked"));
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const finding = JSON.parse(call.body).findings[0];
  assert.ok(!("data" in finding), "data must be omitted when the arg field is not present");
});

test("onToolError safely extracts a message from a non-Error thrown value", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("lock_device", { device_id: "1" }, "a plain string error");
  const call = rich.find((c) => c.url.includes("ingest_mcp_findings"));
  assert.ok(call);
  const finding = JSON.parse(call.body).findings[0];
  assert.match(finding.message, /a plain string error/);
});

test("onToolError never throws even for a wildly malformed error value", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  await assert.doesNotReject(() => onToolError("lock_device", { device_id: "1" }, { weird: "object", circular: undefined }));
  await assert.doesNotReject(() => onToolError("lock_device", { device_id: "1" }, null));
  await assert.doesNotReject(() => onToolError("lock_device", { device_id: "1" }, undefined));
});

// ─── Gating ──────────────────────────────────────────────────────────────────

test("disabled by default (MUNKIREPORT_ENABLED unset) — no publish call", async () => {
  resetEnv();
  rich.length = 0;
  await onToolError("lock_device", { device_id: "1" }, new Error("boom"));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled but mode=manual (default) — no publish call", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true" });
  rich.length = 0;
  await onToolError("lock_device", { device_id: "1" }, new Error("boom"));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled + mode=disabled — no publish call", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "disabled" });
  rich.length = 0;
  await onToolError("lock_device", { device_id: "1" }, new Error("boom"));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

test("enabled + mode=dry_run — logs but never calls ingest_mcp_findings", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "dry_run" });
  rich.length = 0;
  const logs = [];
  await onToolError("lock_device", { device_id: "1" }, new Error("boom"), (m) => logs.push(m));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
  assert.ok(logs.some((l) => /dry-run/i.test(l) && /lock_device/.test(l)));
});

test("a non-action tool with no actionFailure entry is a no-op", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  await onToolError("list_devices", {}, new Error("boom"));
  assert.ok(!rich.some((c) => c.url.includes("ingest_mcp_findings")));
});

// MCP_PUBLISH_MIN_SEVERITY gating: action failures are always severity:"danger", the
// highest rank in SEVERITY_RANK (danger:3 > warning:2 > info:1). loadFindingsConfig's
// VALID_SEVERITIES only accepts danger/warning/info, so minSeverity can never rank above
// "danger" -- this gate is effectively unreachable for action failures today. Documented
// here rather than asserted, since there is no valid config value that would trigger it;
// asserting it would require monkeypatching internals, which isn't worth it for dead code.

// ─── Retry-queue integration ────────────────────────────────────────────────

const QUEUE_DIR = path.resolve("reports/.scratch/retry-queue-action-failure-test");

test("a publish failure enqueues the failure finding to the retry queue when MCP_FINDINGS_QUEUE_DIR is set", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto", MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  rich.length = 0;
  const realFetch = fetchImpl;
  fetchImpl = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  await onToolError("lock_device", { device_id: "99" }, new Error("device unreachable"));
  fetchImpl = realFetch;

  const files = await fs.readdir(QUEUE_DIR);
  assert.equal(files.length, 1, "expected the failed publish payload to be enqueued");
  const enqueued = JSON.parse(await fs.readFile(path.join(QUEUE_DIR, files[0]), "utf8"));
  assert.equal(enqueued.route, "/ingest_mcp_findings");
  assert.equal(enqueued.body.source, "mcp_auto_action_lock_device");
  assert.equal(enqueued.body.findings[0].finding_type, "action_failed_lock_device");
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
});

test("a publish failure does NOT enqueue anything when MCP_FINDINGS_QUEUE_DIR is unset", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
  rich.length = 0;
  const realFetch = fetchImpl;
  fetchImpl = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  await onToolError("lock_device", { device_id: "1" }, new Error("boom"));
  fetchImpl = realFetch;

  await assert.rejects(() => fs.access(QUEUE_DIR), "no queue dir should be created when MCP_FINDINGS_QUEUE_DIR is unset");
});

test("a publish failure is caught and never throws (no queue dir configured)", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  rich.length = 0;
  const realFetch = fetchImpl;
  fetchImpl = async (url) => {
    if (String(url).includes("ingest_mcp_findings")) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return realFetch(url);
  };
  const logs = [];
  await assert.doesNotReject(() => onToolError("lock_device", { device_id: "1" }, new Error("boom"), (m) => logs.push(m)));
  assert.ok(logs.some((l) => /fail/i.test(l)));
  fetchImpl = realFetch;
});
