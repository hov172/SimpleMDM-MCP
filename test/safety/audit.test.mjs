import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { redactArgs, writeAuditEntry, readAuditEntries } =
  await import("../../dist/safety/audit.js");

function entry(overrides = {}) {
  return {
    ts: "2026-07-28T12:00:00.000Z", event_id: "e1", tool: "lock_device",
    tier: "high", phase: "execute", args: { device_id: "42" },
    args_hash: "abc", outcome: "success", http_status: 202, duration_ms: 10,
    ...overrides,
  };
}

test("redactArgs masks sensitive keys and preserves the rest", () => {
  const out = redactArgs({ device_id: "42", pin: "123456", admin_password: "x", message: "hi" });
  assert.deepEqual(out, { device_id: "42", pin: "[REDACTED]", admin_password: "[REDACTED]", message: "hi" });
});

test("writeAuditEntry appends JSONL to a UTC-dated file", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  writeAuditEntry(dir, entry());
  writeAuditEntry(dir, entry({ event_id: "e2" }));
  const files = readdirSync(dir);
  assert.deepEqual(files, ["audit-20260728.jsonl"]);
  const lines = readFileSync(join(dir, files[0]), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).event_id, "e1");
});

test("writeAuditEntry never throws on an unwritable dir", () => {
  writeAuditEntry("/dev/null/not-a-dir", entry()); // must not throw
});

test("readAuditEntries merges, filters, sorts newest-first, limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  writeAuditEntry(dir, entry({ event_id: "old", ts: "2026-07-27T09:00:00.000Z" }));
  writeAuditEntry(dir, entry({ event_id: "new", ts: "2026-07-28T09:00:00.000Z", outcome: "error" }));
  writeAuditEntry(dir, entry({ event_id: "newest", ts: "2026-07-28T10:00:00.000Z", tool: "wipe_device", tier: "critical" }));

  const all = readAuditEntries(dir);
  assert.deepEqual(all.map((e) => e.event_id), ["newest", "new", "old"]);
  assert.deepEqual(readAuditEntries(dir, { tool: "wipe_device" }).map((e) => e.event_id), ["newest"]);
  assert.deepEqual(readAuditEntries(dir, { outcome: "error" }).map((e) => e.event_id), ["new"]);
  assert.deepEqual(readAuditEntries(dir, { since: "2026-07-28T00:00:00Z" }).map((e) => e.event_id), ["newest", "new"]);
  assert.deepEqual(readAuditEntries(dir, { limit: 1 }).map((e) => e.event_id), ["newest"]);
});

test("readAuditEntries returns [] for a missing dir", () => {
  assert.deepEqual(readAuditEntries(join(tmpdir(), "does-not-exist-xyz")), []);
});
