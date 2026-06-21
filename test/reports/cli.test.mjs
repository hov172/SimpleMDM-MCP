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

// ── Part A: cross-report flag rejections ─────────────────────────────────────

test("--raw on logs rejects naming inventory", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--raw"], { fetchInput: async () => ({}) }),
    /--raw.*inventory|inventory.*--raw/i,
  );
});

test("--raw on audit rejects naming inventory", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--raw"], { fetchInput: async () => ({}) }),
    /--raw.*inventory|inventory.*--raw/i,
  );
});

test("--with-security on inventory rejects naming logs", async () => {
  await assert.rejects(
    () => runCli(["inventory", "--serial", "ABC", "--with-security"], { fetchInput: async () => ({}) }),
    /--with-security.*logs|logs.*--with-security/i,
  );
});

test("--with-security on audit rejects naming logs", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--with-security"], { fetchInput: async () => ({}) }),
    /--with-security.*logs|logs.*--with-security/i,
  );
});

test("--with-inventory on inventory rejects naming logs", async () => {
  await assert.rejects(
    () => runCli(["inventory", "--serial", "ABC", "--with-inventory"], { fetchInput: async () => ({}) }),
    /--with-inventory.*logs|logs.*--with-inventory/i,
  );
});

test("--with-inventory on audit rejects naming logs", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--with-inventory"], { fetchInput: async () => ({}) }),
    /--with-inventory.*logs|logs.*--with-inventory/i,
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

// ── Part C: Per-report flag validation (inventory-only flags rejected on audit/logs) ──

test("--search on audit rejects with clear error naming inventory", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--search", "serial:ABC"], { fetchInput: async () => ({}) }),
    /--search.*inventory|inventory.*--search/i,
  );
});

test("--search on logs rejects with clear error naming inventory", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--search", "serial:ABC"], { fetchInput: async () => ({}) }),
    /--search.*inventory|inventory.*--search/i,
  );
});

test("--no-apps on audit rejects with clear error naming inventory", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--no-apps"], { fetchInput: async () => ({}) }),
    /--no-apps.*inventory|inventory.*--no-apps/i,
  );
});

test("--no-apps on logs rejects with clear error naming inventory", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--no-apps"], { fetchInput: async () => ({}) }),
    /--no-apps.*inventory|inventory.*--no-apps/i,
  );
});

test("--no-profiles on audit rejects", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--no-profiles"], { fetchInput: async () => ({}) }),
    /--no-profiles.*inventory|inventory.*--no-profiles/i,
  );
});

test("--no-users on logs rejects", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--no-users"], { fetchInput: async () => ({}) }),
    /--no-users.*inventory|inventory.*--no-users/i,
  );
});

test("--report-style on audit rejects", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--report-style", "flat"], { fetchInput: async () => ({}) }),
    /--report-style.*inventory|inventory.*--report-style/i,
  );
});

test("--sort on logs rejects", async () => {
  await assert.rejects(
    () => runCli(["logs", "--serial", "ABC", "--sort", "seen"], { fetchInput: async () => ({}) }),
    /--sort.*inventory|inventory.*--sort/i,
  );
});

test("--allow-partial on audit rejects", async () => {
  await assert.rejects(
    () => runCli(["audit", "--serial", "ABC", "--allow-partial"], { fetchInput: async () => ({}) }),
    /--allow-partial.*inventory|inventory.*--allow-partial/i,
  );
});

// ── Regression: inventory-only flags still work on inventory ──────────────────────

test("--search on inventory still works (regression)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-inv-search-regress-"));
  try {
    const input = buildInventoryInput();
    const result = await runCli(
      ["inventory", "--all", "--confirm-all", "--format", "md", "--out", tmp, "--search", "serial:C02FAC111"],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "report.md")), "report.md must be written");
    assert.ok(result.files.some((f) => f.name === "report.md"), "result must include report.md");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Regression: common flags still work on all reports ────────────────────────────

test("--format md on audit still works (regression)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-audit-format-regress-"));
  try {
    const input = buildAuditInput();
    const result = await runCli(
      ["audit", "--serial", "ABC", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "full-audit.md")), "full-audit.md must be written");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--format csv on inventory still works (regression)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-inv-format-regress-"));
  try {
    const input = buildInventoryInput();
    const result = await runCli(
      ["inventory", "--serial", "ABC123", "--format", "csv", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(existsSync(join(tmp, "devices.csv")), "devices.csv must be written");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("--format docx on logs still works (regression)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-test-logs-format-regress-"));
  try {
    const input = buildLogsInput();
    const result = await runCli(
      ["logs", "--serial", "ABC", "--format", "docx", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(result.files.length > 0, "result must include at least one file");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Task 4: --raw / --with-security / --with-inventory wired through the unified CLI ──

test("inventory --raw is accepted and writes raw/devices.json", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-raw-"));
  try {
    await runCli(
      ["inventory", "--all", "--confirm-all", "--raw", "--format", "md", "--out", tmp],
      { fetchInput: async () => buildInventoryInput() },
    );
    assert.ok(existsSync(join(tmp, "raw", "devices.json")), "raw/devices.json must be written with --raw");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("logs --with-security is accepted (no unknown-flag error)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-sec-"));
  try {
    await runCli(
      ["logs", "--serial", "C02", "--with-security", "--format", "csv", "--out", tmp],
      { fetchInput: async () => ({ ...buildLogsInput(), security: { tables: {}, evald: [] } }) },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("logs --with-inventory is accepted (no unknown-flag error)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-inv-"));
  try {
    await runCli(
      ["logs", "--serial", "C02", "--with-inventory", "--format", "csv", "--out", tmp],
      { fetchInput: async () => buildLogsInput() },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── §1: --no-network-cache threads via Ctx ────────────────────────────────────

test("--no-network-cache → ctx.noNetworkCache === true", async () => {
  let capturedCtx;
  const tmp = mkdtempSync(join(tmpdir(), "nc-true-"));
  try {
    await runCli(
      ["audit", "--serial", "ABC", "--format", "md", "--no-network-cache", "--out", tmp],
      { fetchInput: async (_rep, _scope, ctx) => { capturedCtx = ctx; return buildAuditInput(); } },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.strictEqual(capturedCtx?.noNetworkCache, true, "noNetworkCache must be true when --no-network-cache passed");
});

test("--no-network-cache omitted → ctx.noNetworkCache falsy", async () => {
  let capturedCtx;
  const tmp = mkdtempSync(join(tmpdir(), "nc-omit-"));
  try {
    await runCli(
      ["audit", "--serial", "ABC", "--format", "md", "--out", tmp],
      { fetchInput: async (_rep, _scope, ctx) => { capturedCtx = ctx; return buildAuditInput(); } },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(!capturedCtx?.noNetworkCache, "noNetworkCache must be falsy when --no-network-cache omitted");
});

// ── §4: partial result ────────────────────────────────────────────────────────

test("inventory with failures and no --allow-partial → result.partial === true", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "partial-"));
  try {
    const input = { ...buildInventoryInput(), failures: [{ serial: "X", section: "apps", message: "err" }] };
    const result = await runCli(
      ["inventory", "--all", "--confirm-all", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.strictEqual(result.partial, true, "result.partial must be true when failures present and no --allow-partial");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("inventory with failures and --allow-partial → result.partial falsy", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "partial-ap-"));
  try {
    const input = { ...buildInventoryInput(), failures: [{ serial: "X", section: "apps", message: "err" }] };
    const result = await runCli(
      ["inventory", "--all", "--confirm-all", "--allow-partial", "--format", "md", "--out", tmp],
      { fetchInput: async () => input },
    );
    assert.ok(!result.partial, "result.partial must be falsy when --allow-partial is set");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── §8: fleet-wide search confirm guard ──────────────────────────────────────

test("inventory --search <no-prefilter query> no selector no --confirm-all → rejects with /confirm-all/", async () => {
  await assert.rejects(
    () => runCli(
      ["inventory", "--search", "app:zoom", "--format", "md"],
      { fetchInput: async () => ({}) },
    ),
    /confirm.?all/i,
    "fleet-wide search without device-scoped prefilter must require --confirm-all",
  );
});

test("inventory --search <no-prefilter query> with --confirm-all → passes guard", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fleet-search-ok-"));
  try {
    const result = await runCli(
      ["inventory", "--search", "app:zoom", "--confirm-all", "--format", "md", "--out", tmp],
      { fetchInput: async () => buildInventoryInput() },
    );
    assert.ok(result.files.length >= 0, "should complete without guard error");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("inventory --search with device-scoped prefilter no --confirm-all → passes guard", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fleet-search-prefilter-"));
  try {
    const result = await runCli(
      ["inventory", "--search", "serial:ABC", "--format", "md", "--out", tmp],
      { fetchInput: async () => buildInventoryInput() },
    );
    assert.ok(result.files.length >= 0, "device-scoped search without confirm-all should pass guard");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
