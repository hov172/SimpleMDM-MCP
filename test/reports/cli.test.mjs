// CLI entrypoint tests — injected-input plumbing (no live network calls).
// Fixture inputs are built the same way capture.mjs does (domain fns + fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAuditInput, buildInventoryInput, buildLogsInput } from "../../test/golden/capture.mjs";
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

// ── Plumbing test: inventory --all --confirm-all --format md ──────────────────

test("inventory --all --confirm-all --format md writes report.md and returns WriteResult", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-inventory-"));
  try {
    const input = buildInventoryInput();
    const result = await runCli(
      ["inventory", "--all", "--confirm-all", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "report.md")), "report.md must be written");
    assert.strictEqual(result.outDir, tmp, "WriteResult.outDir must match --out");
    assert.ok(Array.isArray(result.files), "WriteResult.files must be an array");
    assert.ok(
      result.files.some((f) => f.name === "report.md"),
      "WriteResult.files must include report.md",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Plumbing test: logs --serial <x> --format md ─────────────────────────────

test("logs --serial ABC --format md writes report.md and returns WriteResult", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-logs-"));
  try {
    const input = buildLogsInput();
    const result = await runCli(
      ["logs", "--serial", "ABC", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "report.md")), "report.md must be written");
    assert.strictEqual(result.outDir, tmp, "WriteResult.outDir must match --out");
    assert.ok(Array.isArray(result.files), "WriteResult.files must be an array");
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

// ── Part A: unknown flags must be rejected ────────────────────────────────────

test("unknown flag rejects with clear error naming the flag", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC123", "--unknown-xyz"], { fetchInput: async () => ({}) }),
    /unknown flag.*--unknown-xyz/i,
  );
});

test("unknown flag rejects even for inventory", async () => {
  await assert.rejects(
    () => runCli(["inventory", "--serial", "ABC", "--typo-flag"], { fetchInput: async () => ({}) }),
    /unknown flag/i,
  );
});

// ── Part A: deferred flags give specific guidance ─────────────────────────────

test("--raw rejects with not-yet-supported message", async () => {
  await assert.rejects(
    () => runCli(["inventory", "--serial", "ABC", "--raw"], { fetchInput: async () => ({}) }),
    /not yet supported.*unified CLI|use node scripts/i,
  );
});

test("--with-security rejects with not-yet-supported message", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--with-security"], { fetchInput: async () => ({}) }),
    /not yet supported.*unified CLI|use node scripts/i,
  );
});

test("--with-inventory rejects with not-yet-supported message", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--with-inventory"], { fetchInput: async () => ({}) }),
    /not yet supported.*unified CLI|use node scripts/i,
  );
});

// ── Part B: --search filters inventory records ────────────────────────────────

test("inventory --search serial:C02FAC111 keeps only the matching device", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-inv-search-"));
  try {
    const input = buildInventoryInput();
    // Fixture has 4 devices: Alice MBP (C02FAC111), Bob iMac, Carol Mini, Library iPad
    await runCli(
      ["inventory", "--all", "--confirm-all", "--format", "md", "--out", tmp, "--search", "serial:C02FAC111"],
      { fetchInput: async () => input },
    );
    const md = readFileSync(join(tmp, "report.md"), "utf8");
    assert.ok(md.includes("Alice MBP"), "filtered report must include the matched device (Alice MBP)");
    assert.ok(!md.includes("Bob iMac"), "filtered report must exclude non-matching device (Bob iMac)");
    assert.ok(!md.includes("Carol Mini"), "filtered report must exclude non-matching device (Carol Mini)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Part B: --no-apps omits apps CSV ─────────────────────────────────────────

test("inventory --no-apps does not write apps.csv or app-catalog.csv", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-inv-noapps-"));
  try {
    const input = buildInventoryInput();
    await runCli(
      ["inventory", "--all", "--confirm-all", "--format", "csv", "--out", tmp, "--no-apps"],
      { fetchInput: async () => input },
    );
    assert.ok(!existsSync(join(tmp, "apps.csv")), "apps.csv must NOT be written with --no-apps");
    assert.ok(!existsSync(join(tmp, "app-catalog.csv")), "app-catalog.csv must NOT be written with --no-apps");
    assert.ok(existsSync(join(tmp, "devices.csv")), "devices.csv must still be written");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Part B: --report-detail is accepted for logs ──────────────────────────────

test("logs --report-detail full is accepted and writes report.md", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-logs-detail-"));
  try {
    const input = buildLogsInput();
    const result = await runCli(
      ["logs", "--serial", "ABC", "--format", "md", "--out", tmp, "--report-detail", "full"],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "report.md")), "report.md must be written");
    assert.strictEqual(result.outDir, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
