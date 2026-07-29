process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "audit-tool-"));
process.env.MCP_WRITE_AUDIT_DIR = DIR;

const { handleTool } = await import("../../dist/index.js");
const { writeAuditEntry } = await import("../../dist/safety/audit.js");

test("get_write_audit_log returns entries newest-first with filters applied", async () => {
  writeAuditEntry(DIR, { ts: "2026-07-28T10:00:00.000Z", event_id: "a", tool: "wipe_device", tier: "critical", phase: "plan", args: {}, args_hash: "h", outcome: "success" });
  writeAuditEntry(DIR, { ts: "2026-07-28T11:00:00.000Z", event_id: "b", tool: "sync_device", tier: "low", phase: "execute", args: {}, args_hash: "h", outcome: "success" });
  const all = await handleTool("get_write_audit_log", {});
  assert.equal(all.count, 2);
  assert.deepEqual(all.entries.map((e) => e.event_id), ["b", "a"]);
  const wipes = await handleTool("get_write_audit_log", { tool: "wipe_device" });
  assert.deepEqual(wipes.entries.map((e) => e.event_id), ["a"]);
});

test("get_write_audit_log is registered and read-only", async () => {
  const { TOOLS, WRITE_TOOLS } = await import("../../dist/index.js");
  const tool = TOOLS.find((t) => t.name === "get_write_audit_log");
  assert.ok(tool, "tool must be registered");
  assert.ok(!WRITE_TOOLS.has("get_write_audit_log"));
  assert.equal(tool.annotations.readOnlyHint, true);
});
