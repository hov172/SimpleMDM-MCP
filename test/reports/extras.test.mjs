// Always-on bundle artifacts: manifest.sha256 (pure Node, always) + report-table.xlsx
// and <dir>.zip (python3, best-effort — asserted only when not skipped).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { writeReportExtras } from "../../dist/reports/engine/extras.js";

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "extras-"));
  writeFileSync(join(dir, "report.md"), "# Report\n");
  writeFileSync(join(dir, "devices.csv"), "serial\r\nC02\r\n");
  writeFileSync(join(dir, "report-table.csv"), "model,serial\r\niMac,C02\r\n");
  mkdirSync(join(dir, "raw"), { recursive: true });
  writeFileSync(join(dir, "raw", "devices.json"), "[]");
  return dir;
}

test("writeReportExtras always writes a valid sha256sum-format manifest.sha256", () => {
  const dir = fixtureDir();
  try {
    const r = writeReportExtras(dir);
    assert.ok(existsSync(join(dir, "manifest.sha256")), "manifest.sha256 must exist");
    assert.ok(r.files.some((f) => f.name === "manifest.sha256"));
    const lines = readFileSync(join(dir, "manifest.sha256"), "utf8").trim().split("\n");
    for (const line of lines) {
      assert.match(line, /^[0-9a-f]{64} {2}\S/, `line must be "<64-hex>  <path>": ${line}`);
    }
    // The manifest must hash the subdir file and NOT list itself or the bundle zip.
    assert.ok(lines.some((l) => l.endsWith("raw/devices.json")), "must hash nested files");
    assert.ok(!lines.some((l) => l.endsWith("manifest.sha256")), "must not hash itself");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeReportExtras emits report-table.xlsx + a clean bundle .zip when python3 is available", () => {
  const dir = fixtureDir();
  try {
    const r = writeReportExtras(dir);
    const zipName = `${basename(dir)}.zip`;
    const xlsxSkipped = r.skipped.some((s) => s.artifact === "report-table.xlsx");
    const zipSkipped = r.skipped.some((s) => s.artifact === zipName);

    if (!xlsxSkipped) {
      assert.ok(existsSync(join(dir, "report-table.xlsx")), "report-table.xlsx must exist");
      // xlsx is a zip whose first bytes are the PK signature.
      const head = readFileSync(join(dir, "report-table.xlsx")).subarray(0, 2).toString("latin1");
      assert.strictEqual(head, "PK", "xlsx must be a valid zip container");
    }
    if (!zipSkipped) {
      assert.ok(existsSync(join(dir, zipName)), "bundle zip must exist");
      assert.ok(r.files.some((f) => f.name === zipName));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeReportExtras skips report-table.xlsx when there is no report-table.csv", () => {
  const dir = mkdtempSync(join(tmpdir(), "extras-noflat-"));
  try {
    writeFileSync(join(dir, "report.md"), "# Report\n");
    const r = writeReportExtras(dir);
    assert.ok(!existsSync(join(dir, "report-table.xlsx")), "no xlsx without a report-table.csv");
    assert.ok(!r.files.some((f) => f.name === "report-table.xlsx"));
    assert.ok(existsSync(join(dir, "manifest.sha256")), "manifest.sha256 still written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
