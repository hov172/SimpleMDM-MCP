process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "res-audit-"));
process.env.MCP_WRITE_AUDIT_DIR = DIR;

const { RESOURCES, readResource } = await import("../dist/index.js");
const { writeAuditEntry } = await import("../dist/safety/audit.js");

test("the three Phase 3 resources are registered (15 total)", () => {
  const uris = RESOURCES.map((r) => r.uri);
  for (const u of ["simplemdm://fleet/risk", "simplemdm://audit/recent-writes", "simplemdm://recommendations"]) {
    assert.ok(uris.includes(u), u);
  }
  assert.equal(RESOURCES.length, 15);
});

test("audit/recent-writes reads the local audit log without any API call", async () => {
  writeAuditEntry(DIR, { ts: "2026-07-28T10:00:00.000Z", event_id: "r1", tool: "sync_device", tier: "low", phase: "execute", args: {}, args_hash: "h", outcome: "success" });
  const data = await readResource("simplemdm://audit/recent-writes");
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].event_id, "r1");
});
