import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditCliArgs, buildLogsCliArgs, buildInventoryCliArgs } from "../../dist/reportCliArgs.js";

// ── buildAuditCliArgs ─────────────────────────────────────────────────────────

test("buildAuditCliArgs defaults → [audit, --format, all, --out, <dir>]", () => {
  const result = buildAuditCliArgs({}, "/tmp/out");
  assert.deepStrictEqual(result, ["audit", "--format", "all", "--out", "/tmp/out"]);
});

test("buildAuditCliArgs serial/group/last_seen appended with values", () => {
  const r = buildAuditCliArgs({ serial: "ABC,DEF", group: "Faculty", last_seen: 10 }, "/out");
  assert.ok(r.includes("--serial"), "must include --serial");
  assert.ok(r.includes("ABC,DEF"), "must include serial value");
  assert.ok(r.includes("--group"), "must include --group");
  assert.ok(r.includes("Faculty"), "must include group value");
  assert.ok(r.includes("--last-seen"), "must include --last-seen");
  assert.ok(r.includes("10"), "must include last_seen value");
});

test("buildAuditCliArgs no_network_cache:true → contains --no-network-cache", () => {
  const r = buildAuditCliArgs({ no_network_cache: true }, "/out");
  assert.ok(r.includes("--no-network-cache"), "must include --no-network-cache");
});

test("buildAuditCliArgs no_network_cache:false → NOT --no-network-cache", () => {
  const r = buildAuditCliArgs({ no_network_cache: false }, "/out");
  assert.ok(!r.includes("--no-network-cache"), "must NOT include --no-network-cache");
});
test("buildAuditCliArgs page_size:a4 → contains --page-size a4", () => {
  const r = buildAuditCliArgs({ page_size: "a4" }, "/out");
  const i = r.indexOf("--page-size");
  assert.ok(i >= 0, "must include --page-size");
  assert.strictEqual(r[i + 1], "a4", "value must follow the flag");
});
test("buildAuditCliArgs without page_size → NOT --page-size (A3 default)", () => {
  const r = buildAuditCliArgs({}, "/out");
  assert.ok(!r.includes("--page-size"), "default omits --page-size (engine defaults to A3)");
});

test("buildAuditCliArgs no_network_cache absent → NOT --no-network-cache", () => {
  const r = buildAuditCliArgs({}, "/out");
  assert.ok(!r.includes("--no-network-cache"), "must NOT include --no-network-cache");
});

test("buildAuditCliArgs report_only:true → contains --report-only", () => {
  const r = buildAuditCliArgs({ report_only: true }, "/out");
  assert.ok(r.includes("--report-only"), "must include --report-only");
});

// ── buildLogsCliArgs ─────────────────────────────────────────────────────────

test("buildLogsCliArgs defaults → [logs, --format, all, --report-detail, summary, --out, <dir>]", () => {
  const result = buildLogsCliArgs({}, "/tmp/out");
  assert.deepStrictEqual(result, ["logs", "--format", "all", "--report-detail", "summary", "--out", "/tmp/out"]);
});

test("buildLogsCliArgs all+confirm_all → both flags present", () => {
  const r = buildLogsCliArgs({ all: true, confirm_all: true }, "/out");
  assert.ok(r.includes("--all"), "must include --all");
  assert.ok(r.includes("--confirm-all"), "must include --confirm-all");
});

test("buildLogsCliArgs with_security → --with-security present", () => {
  const r = buildLogsCliArgs({ with_security: true }, "/out");
  assert.ok(r.includes("--with-security"), "must include --with-security");
});

test("buildLogsCliArgs with_inventory → --with-inventory present", () => {
  const r = buildLogsCliArgs({ with_inventory: true }, "/out");
  assert.ok(r.includes("--with-inventory"), "must include --with-inventory");
});

// ── buildInventoryCliArgs ────────────────────────────────────────────────────

test("buildInventoryCliArgs report_style:dossier → NO --report-style", () => {
  const r = buildInventoryCliArgs({ report_style: "dossier" });
  assert.ok(!r.includes("--report-style"), "dossier must NOT emit --report-style");
});

test("buildInventoryCliArgs report_style absent → NO --report-style", () => {
  const r = buildInventoryCliArgs({});
  assert.ok(!r.includes("--report-style"), "absent report_style must NOT emit --report-style");
});

test("buildInventoryCliArgs report_style:flat → --report-style flat", () => {
  const r = buildInventoryCliArgs({ report_style: "flat" });
  const i = r.indexOf("--report-style");
  assert.ok(i >= 0, "must include --report-style");
  assert.strictEqual(r[i + 1], "flat", "value must be flat");
});

test("buildInventoryCliArgs report_style:roster → --report-style roster", () => {
  const r = buildInventoryCliArgs({ report_style: "roster" });
  const i = r.indexOf("--report-style");
  assert.ok(i >= 0, "must include --report-style");
  assert.strictEqual(r[i + 1], "roster", "value must be roster");
});

test("buildInventoryCliArgs no out_dir → NO --out", () => {
  const r = buildInventoryCliArgs({});
  assert.ok(!r.includes("--out"), "must NOT include --out when out_dir absent");
});

test("buildInventoryCliArgs with out_dir → --out <value>", () => {
  const r = buildInventoryCliArgs({ out_dir: "/custom/path" });
  const i = r.indexOf("--out");
  assert.ok(i >= 0, "must include --out");
  assert.strictEqual(r[i + 1], "/custom/path");
});

test("buildInventoryCliArgs search/sort/serial/all/confirm_all/allow_partial/raw/report_only", () => {
  const r = buildInventoryCliArgs({
    search: "model:MacBook",
    sort: "seen:desc",
    serial: "ABC123",
    all: true,
    confirm_all: true,
    allow_partial: true,
    raw: true,
    report_only: true,
  });
  assert.ok(r.includes("--search"), "must include --search");
  assert.ok(r.includes("model:MacBook"), "must include search value");
  assert.ok(r.includes("--sort"), "must include --sort");
  assert.ok(r.includes("seen:desc"), "must include sort value");
  assert.ok(r.includes("--serial"), "must include --serial");
  assert.ok(r.includes("--all"), "must include --all");
  assert.ok(r.includes("--confirm-all"), "must include --confirm-all");
  assert.ok(r.includes("--allow-partial"), "must include --allow-partial");
  assert.ok(r.includes("--raw"), "must include --raw");
  assert.ok(r.includes("--report-only"), "must include --report-only");
});
