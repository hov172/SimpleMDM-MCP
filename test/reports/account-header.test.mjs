// Regression guard: the report header's "Account: <name> · licenses X used of Y"
// line was dropped when the legacy engines were replaced by the unified engine
// (the renderers still supported `account`, but the builders stopped passing it).
// These tests pin the restored behavior for all three report types AND prove the
// line is omitted when no account is supplied (so fixture-driven goldens stay stable).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMajorTables, evaluateDevice, aggregateCveDetail, summarize } from "../../dist/reports/domain/sofa-eval.js";
import { renderAuditMarkdown } from "../../dist/reports/domain/audit-render.js";
import { renderDetailedReport } from "../../dist/reports/domain/logs.js";
import { buildInventoryDossier } from "../../dist/reports/specs/inventory.js";
import { scopeLabelOf } from "../../dist/reports/cli.js";

const macFeed = JSON.parse(readFileSync(new URL("../fixtures/sofa-macos.json", import.meta.url)));
const iosFeed = JSON.parse(readFileSync(new URL("../fixtures/sofa-ios.json", import.meta.url)));
const devices = JSON.parse(readFileSync(new URL("../fixtures/devices.json", import.meta.url)));

const ACCOUNT = { name: "Sarah Lawrence College", total: 500, available: 57 };

// ── scopeLabelOf ──────────────────────────────────────────────────────────────
test("scopeLabelOf maps selectors and search to the legacy header wording", () => {
  assert.equal(scopeLabelOf(null), "whole fleet");
  assert.equal(scopeLabelOf({ kind: "all", value: true }), "--all");
  assert.equal(scopeLabelOf({ kind: "serial", value: ["C02", "D25"] }), "--serial C02,D25");
  assert.equal(scopeLabelOf({ kind: "group", value: "Faculty" }), "--group Faculty");
  assert.equal(scopeLabelOf({ kind: "last-seen", value: 30 }), "--last-seen 30");
  // A whole-fleet search reproduces the legacy "search (whole fleet)" label.
  assert.equal(scopeLabelOf(null, "model:*2015*"), "search (whole fleet)");
  assert.equal(scopeLabelOf({ kind: "all", value: true }, "app:zoom"), "search (--all)");
});

// ── Audit ───────────────────────────────────────────────────────────────────
test("renderAuditMarkdown emits the Account line when account is provided", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map((d) => evaluateDevice(d, t));
  const md = renderAuditMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev, aggregateCveDetail(ev, t)), t, "2026-06-07", { account: ACCOUNT });
  assert.match(md, /Account: \*\*Sarah Lawrence College\*\* · licenses 443 used of 500/);
});

test("renderAuditMarkdown omits the Account line when no account (golden-safe)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map((d) => evaluateDevice(d, t));
  const md = renderAuditMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev, aggregateCveDetail(ev, t)), t, "2026-06-07");
  assert.doesNotMatch(md, /^Account:/m);
});

// ── Logs ──────────────────────────────────────────────────────────────────────
test("renderDetailedReport emits the Account line when account is provided", () => {
  const md = renderDetailedReport([], null, "2026-01-01", {}, { account: ACCOUNT });
  assert.match(md, /Account: \*\*Sarah Lawrence College\*\* • licenses 443 used of 500/);
});

test("renderDetailedReport omits the Account line when no account (golden-safe)", () => {
  const md = renderDetailedReport([], null, "2026-01-01", {}, {});
  assert.doesNotMatch(md, /^Account:/m);
});

// ── Inventory (the report that regressed) ─────────────────────────────────────
function writeInvReport(input, opts) {
  const out = mkdtempSync(join(tmpdir(), "inv-acct-"));
  const d = buildInventoryDossier(input, opts);
  return d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }).then(() => {
    assert.ok(existsSync(join(out, "report.md")));
    return readFileSync(join(out, "report.md"), "utf8");
  });
}

test("inventory flat report shows Account + real scope label + query", async () => {
  const input = { records: [], findings: [], dateStr: "2026-06-11", account: ACCOUNT, scopeLabel: "search (whole fleet)" };
  const md = await writeInvReport(input, { reportStyle: "flat", search: "model:*2015* seen:>=2026-01-01" });
  assert.match(md, /Account: \*\*Sarah Lawrence College\*\* · licenses 443 used of 500/);
  assert.match(md, /Scope: search \(whole fleet\) · Query: `model:\*2015\* seen:>=2026-01-01`/);
});

test("inventory full report shows Account line", async () => {
  const input = { records: [], findings: [], dateStr: "2026-06-11", account: ACCOUNT, scopeLabel: "--all" };
  const md = await writeInvReport(input, {});
  assert.match(md, /Account: \*\*Sarah Lawrence College\*\* · licenses 443 used of 500/);
});

test("inventory omits Account line + falls back to --all when account/scopeLabel absent (golden-safe)", async () => {
  const input = { records: [], findings: [], dateStr: "2026-06-11" };
  const md = await writeInvReport(input, { reportStyle: "flat" });
  assert.doesNotMatch(md, /^Account:/m);
  assert.match(md, /Scope: --all/);
});
