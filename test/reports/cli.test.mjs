// CLI entrypoint tests — injected-input plumbing (no live network calls).
// Fixture inputs are built the same way capture.mjs does (domain fns + fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAuditInput } from "../../test/golden/capture.mjs";
import { runCli } from "../../dist/reports/cli.js";

// ── Plumbing test: audit --all --confirm-all --format md ──────────────────────

test("audit --all --confirm-all --format md writes full-audit.md and returns WriteResult", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-audit-"));
  try {
    const input = buildAuditInput();
    const result = await runCli(
      ["audit", "--all", "--confirm-all", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "full-audit.md")), "full-audit.md must be written to disk");
    assert.strictEqual(result.outDir, tmp, "WriteResult.outDir must match --out");
    assert.ok(Array.isArray(result.files), "WriteResult.files must be an array");
    assert.ok(
      result.files.some((f) => f.name === "full-audit.md"),
      "WriteResult.files must include full-audit.md",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Arg-parse error cases ─────────────────────────────────────────────────────

test("--all without --confirm-all rejects", async () => {
  await assert.rejects(
    () => runCli(["audit", "--all"], { fetchInput: async () => ({}) }),
    /confirm-all/i,
  );
});

test("invalid --format rejects", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC123", "--format", "xlsx"], { fetchInput: async () => ({}) }),
    /--format/i,
  );
});

test("unknown report name rejects", async () => {
  await assert.rejects(
    () => runCli(["no-such-report", "--serial", "ABC"], { fetchInput: async () => ({}) }),
    /unknown report/i,
  );
});

test("no report name rejects", async () => {
  await assert.rejects(
    () => runCli([], { fetchInput: async () => ({}) }),
    /usage/i,
  );
});
