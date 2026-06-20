import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Dossier } from "../../dist/reports/engine/dossier.js";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "dossier-ext-"));
}

// (a) bodyMarkdown: report.md equals the given text verbatim, no extra title line
test("(a) bodyMarkdown emits body verbatim with no auto-title", async () => {
  const d = new Dossier({ title: "", pageStyle: "letter-portrait" });
  d.bodyMarkdown("# Custom\n\nverbatim");
  const outDir = tmpDir();
  await d.write(outDir, { format: "md", generatedIso: "2026-01-01T00:00:00Z" });
  const md = readFileSync(join(outDir, "report.md"), "utf8");
  assert.equal(md, "# Custom\n\nverbatim");
});

// (b) dataCsv: extra.csv written + in manifest, NOT referenced in report.md
test("(b) dataCsv written and manifested but not in report.md", async () => {
  const cols = [{ key: "id", header: "id" }, { key: "name", header: "name" }];
  const rows = [{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }];
  const d = new Dossier({ title: "T", pageStyle: "letter-portrait" });
  d.dataCsv("extra.csv", cols, rows, "Extra data");
  const outDir = tmpDir();
  await d.write(outDir, { format: "all", generatedIso: "2026-01-01T00:00:00Z" });

  // File written
  assert.ok(existsSync(join(outDir, "extra.csv")), "extra.csv should exist");

  // In manifest
  const manifest = readFileSync(join(outDir, "manifest.csv"), "utf8");
  assert.ok(manifest.includes("extra.csv"), "manifest should include extra.csv");

  // NOT referenced in report.md (only file names or links)
  const md = readFileSync(join(outDir, "report.md"), "utf8");
  assert.ok(!md.includes("extra.csv"), "report.md should NOT reference extra.csv");
});

// (c) dataFile under a subdir: file written + manifested with real sha/bytes
test("(c) dataFile with subdir path: written and manifested with real sha256/bytes", async () => {
  const content = '{"a":1}';
  const d = new Dossier({ title: "T", pageStyle: "letter-portrait" });
  d.dataFile("status-snapshots/x.json", content, "snap");
  const outDir = tmpDir();
  await d.write(outDir, { format: "all", generatedIso: "2026-01-01T00:00:00Z" });

  // File written under subdir
  assert.ok(existsSync(join(outDir, "status-snapshots", "x.json")), "subdir file should exist");
  const written = readFileSync(join(outDir, "status-snapshots", "x.json"), "utf8");
  assert.equal(written, content);

  // In manifest with real bytes and sha256
  const manifest = readFileSync(join(outDir, "manifest.csv"), "utf8");
  assert.ok(manifest.includes("status-snapshots/x.json"), "manifest should include subdir file");
  const expectedSha = sha256(content);
  assert.ok(manifest.includes(expectedSha), "manifest should include correct sha256");
  const expectedBytes = String(Buffer.byteLength(content));
  assert.ok(manifest.includes(expectedBytes), "manifest should include correct bytes");
});

// (d) manifestNote: row has empty bytes/sha256, filled generated_at
test("(d) manifestNote produces correct manifest row shape", async () => {
  const d = new Dossier({ title: "T", pageStyle: "letter-portrait" });
  d.manifestNote("(disclosure: x)", "some disclosure text");
  const outDir = tmpDir();
  await d.write(outDir, { format: "md", generatedIso: "2026-01-01T00:00:00Z" });

  const manifest = readFileSync(join(outDir, "manifest.csv"), "utf8");
  // Row must include the file name and description
  assert.ok(manifest.includes("(disclosure: x)"), "manifest must include disclosure file");
  assert.ok(manifest.includes("some disclosure text"), "manifest must include disclosure text");

  // Parse the row to verify empty bytes/sha256 and filled generated_at
  const lines = manifest.split("\n").filter(Boolean);
  const disclosureRow = lines.find((l) => l.includes("(disclosure: x)"));
  assert.ok(disclosureRow, "disclosure row must exist");
  const parts = disclosureRow.split(",");
  // columns: file,description,record_scope,data_row_count,bytes,sha256,generated_at
  // file=0, description=1, record_scope=2, data_row_count=3, bytes=4, sha256=5, generated_at=6
  assert.equal(parts[4], "", "bytes must be empty");
  assert.equal(parts[5], "", "sha256 must be empty");
  assert.equal(parts[6], "2026-01-01T00:00:00Z", "generated_at must be filled");
});

// (e) Section.subsection: md contains ### macOS
test("(e) Section.subsection emits ### heading in markdown", async () => {
  const d = new Dossier({ title: "R", pageStyle: "letter-portrait" });
  d.section("X").subsection("macOS");
  const outDir = tmpDir();
  await d.write(outDir, { format: "md", generatedIso: "2026-01-01T00:00:00Z" });
  const md = readFileSync(join(outDir, "report.md"), "utf8");
  assert.ok(md.includes("### macOS"), "md should contain ### macOS");
});
