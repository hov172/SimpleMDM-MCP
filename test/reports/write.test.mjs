import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dossier } from "../../dist/reports/engine/dossier.js";

test("write emits md + per-section csv + manifest with hashes", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  d.section("Devices").table([{ key: "serial", header: "serial" }], [{ serial: "C02" }], "devices.csv");
  const res = await d.write(out, { format: "all", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" });
  assert.ok(existsSync(join(out, "report.md")));
  assert.ok(existsSync(join(out, "devices.csv")));
  assert.ok(existsSync(join(out, "manifest.csv")));
  assert.ok(res.files.find((f) => f.name === "devices.csv")?.sha256.length === 64);
  assert.match(readFileSync(join(out, "devices.csv"), "utf8"), /serial\r\nC02/);

  // Guard: manifest bytes column must be the REAL byte length of the written CSV (not 0 or empty)
  const manifestContent = readFileSync(join(out, "manifest.csv"), "utf8");
  const lines = manifestContent.split("\r\n");
  const headers = lines[0].split(",");
  const bytesIdx = headers.indexOf("bytes");
  assert.ok(bytesIdx >= 0, "manifest must have a bytes column");
  const devicesRow = lines.find((l) => l.startsWith("devices.csv"));
  assert.ok(devicesRow, "manifest must contain a row for devices.csv");
  const bytesVal = Number(devicesRow.split(",")[bytesIdx]);
  assert.ok(bytesVal > 0, `manifest bytes for devices.csv must be real (got ${bytesVal})`);
});

test("write honors report-only + csv as an error", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  await assert.rejects(() => d.write(out, { format: "csv", reportOnly: true }), /report-only/);
});

// Task 1.9: data CSVs must be written for md/docx formats (match legacy engines)
test("format:md writes data CSVs alongside report md", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  d.dataCsv("d.csv", [{ key: "id", header: "ID" }], [{ id: "42" }], "test data");
  const res = await d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" });

  // data CSV must exist on disk
  assert.ok(existsSync(join(out, "d.csv")), "d.csv must exist for format:md");
  // report md must exist
  assert.ok(existsSync(join(out, "report.md")), "report.md must exist for format:md");
  // manifest must contain a row for d.csv
  const manifestContent = readFileSync(join(out, "manifest.csv"), "utf8");
  assert.ok(manifestContent.includes("d.csv"), "manifest.csv must list d.csv");
});

test("format:md + reportOnly does NOT write data CSVs", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  d.dataCsv("d.csv", [{ key: "id", header: "ID" }], [{ id: "42" }], "test data");
  await d.write(out, { format: "md", reportOnly: true, generatedIso: "2026-06-20T00:00:00Z" });

  // data CSV must NOT exist for report-only
  assert.ok(!existsSync(join(out, "d.csv")), "d.csv must NOT exist for format:md + reportOnly");
  // report md still written
  assert.ok(existsSync(join(out, "report.md")), "report.md must still exist for report-only:md");
});
