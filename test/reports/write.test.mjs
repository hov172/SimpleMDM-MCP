import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dossier } from "../../dist/reports/engine/dossier.js";

// Quote-aware CSV field split for a single line (handles "" escaping inside quoted fields).
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

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
  const headers = parseCsvLine(lines[0]);
  const bytesIdx = headers.indexOf("bytes");
  assert.ok(bytesIdx >= 0, "manifest must have a bytes column");
  const devicesRow = lines.find((l) => l.startsWith("devices.csv"));
  assert.ok(devicesRow, "manifest must contain a row for devices.csv");
  // Quote-aware parse: a description field may legitimately contain commas, so a naive
  // split(",") would mis-index the bytes column.
  const bytesVal = Number(parseCsvLine(devicesRow)[bytesIdx]);
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

// Task 1.10: manifest:false suppresses auto-manifest
test("manifest:false suppresses manifest.csv and omits it from files", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  d.dataCsv("d.csv", [{ key: "id", header: "ID" }], [{ id: "1" }], "data");
  const res = await d.write(out, { format: "md", reportOnly: false, manifest: false });

  // body md still written
  assert.ok(existsSync(join(out, "report.md")), "report.md must still exist");
  // data file still written
  assert.ok(existsSync(join(out, "d.csv")), "d.csv must still exist");
  // manifest.csv must NOT be on disk
  assert.ok(!existsSync(join(out, "manifest.csv")), "manifest.csv must NOT exist when manifest:false");
  // files array must not contain manifest.csv
  assert.ok(!res.files.find((f) => f.name === "manifest.csv"), "files must not include manifest.csv entry");
  // manifestSha256 must be empty string
  assert.strictEqual(res.manifestSha256, "", "manifestSha256 must be empty string when suppressed");
});

// Task 1.10: omitting manifest (default true) still writes manifest.csv — backward-compat guard
test("manifest default (omitted) still writes manifest.csv", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", footerTitle: "T", mdName: "report.md" });
  d.dataCsv("d.csv", [{ key: "id", header: "ID" }], [{ id: "1" }], "data");
  const res = await d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" });

  assert.ok(existsSync(join(out, "manifest.csv")), "manifest.csv must exist when manifest is omitted (default true)");
  assert.ok(res.files.find((f) => f.name === "manifest.csv"), "files must include manifest.csv when default");
  assert.ok(res.manifestSha256.length === 64, "manifestSha256 must be a valid sha256 hash when default");
});

// Hardening: a malformed spec must never silently clobber outputs. Any two
// artifacts that would resolve to the same on-disk filename must fail loudly
// BEFORE anything is written.
test("write rejects csvName colliding with mdName (the FileVault-report bug)", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "dup" });
  d.section("S").table([{ key: "a", header: "A" }], [{ a: "1" }], "dup");
  await assert.rejects(
    () => d.write(out, { format: "all", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }),
    /collision/i,
  );
  // Fail-fast: nothing should have been written to the output dir.
  assert.ok(!existsSync(join(out, "dup")), "no artifact may be written when a collision is detected");
});

test("write rejects mdName without .md extension (html/pdf clobber the md)", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "report" });
  await assert.rejects(
    () => d.write(out, { format: "all", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }),
    /collision/i,
  );
});

test("write rejects duplicate csvName across two table blocks", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "report.md" });
  d.section("S1").table([{ key: "a", header: "A" }], [{ a: "1" }], "data.csv");
  d.section("S2").table([{ key: "b", header: "B" }], [{ b: "2" }], "data.csv");
  await assert.rejects(
    () => d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }),
    /collision/i,
  );
});

test("write rejects a dataFile colliding with a table csvName", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "report.md" });
  d.section("S").table([{ key: "a", header: "A" }], [{ a: "1" }], "shared.csv");
  d.dataFile("shared.csv", "x", "dupe");
  await assert.rejects(
    () => d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }),
    /collision/i,
  );
});

test("write rejects a data artifact named manifest.csv (collides with auto manifest)", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "report.md" });
  d.dataFile("manifest.csv", "x", "shadow");
  await assert.rejects(
    () => d.write(out, { format: "md", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" }),
    /collision/i,
  );
});

test("write ALLOWS same base name with distinct extensions (foo.csv + foo.md)", async () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape", mdName: "foo.md" });
  d.section("S").table([{ key: "a", header: "A" }], [{ a: "1" }], "foo.csv");
  await d.write(out, { format: "all", reportOnly: false, generatedIso: "2026-06-20T00:00:00Z" });
  assert.ok(existsSync(join(out, "foo.csv")), "foo.csv must be written");
  assert.ok(existsSync(join(out, "foo.md")), "foo.md must be written");
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
