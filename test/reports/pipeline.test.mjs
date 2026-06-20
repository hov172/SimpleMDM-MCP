import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReportPdf } from "../../dist/reports/engine/pipeline.js";

test("renderReportPdf never throws; records skips when tooling missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const md = join(dir, "r.md");
  writeFileSync(md, "# Hi\n\ntext");
  const res = renderReportPdf({
    mdPath: md,
    htmlPath: join(dir, "r.html"),
    pdfPath: join(dir, "r.pdf"),
    headHtml: "<style></style>",
    label: "test",
  });
  assert.ok(Array.isArray(res.produced));
  assert.ok(Array.isArray(res.skipped));
  // Either it produced html (pandoc present) or recorded a skip — but it did not throw.
});
