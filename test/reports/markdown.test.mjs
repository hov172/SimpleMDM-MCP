import { test } from "node:test";
import assert from "node:assert/strict";
import { Dossier } from "../../dist/reports/engine/dossier.js";
import { renderMarkdown } from "../../dist/reports/engine/markdown.js";

test("renderMarkdown matches the established section/table format", () => {
  const d = new Dossier({ title: "SOFA Fleet Audit — 2026-06-20", pageStyle: "a3-landscape" });
  d.section("Security Report").summary("Devices with issues: **2** / 3")
    .table([{ key: "serial", header: "serial" }, { key: "os", header: "os" }],
           [{ serial: "C02", os: "15.6" }]);
  d.section("Empty").table([{ key: "x", header: "x" }], []);
  const md = renderMarkdown(d.toDocument());
  assert.match(md, /^# SOFA Fleet Audit — 2026-06-20/);
  assert.match(md, /## Security Report\n\nDevices with issues: \*\*2\*\* \/ 3/);
  assert.match(md, /\| serial \| os \|\n\| --- \| --- \|\n\| C02 \| 15\.6 \|/);
  assert.match(md, /## Empty\n\n_none_/);
});

test("mdTable escapes pipes in cell values so rows keep their column count", () => {
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape" });
  d.section("Devices").table(
    [{ key: "name", header: "name" }, { key: "serial", header: "serial" }],
    [{ name: "Loaner | Library iPad", serial: "S1" }],
  );
  const md = renderMarkdown(d.toDocument());
  assert.match(md, /Loaner \\\| Library iPad/, "cell pipes must be escaped");
  const row = md.split("\n").find((l) => l.includes("Loaner"));
  const unescapedPipes = row.replace(/\\\|/g, "").split("|").length - 1;
  assert.equal(unescapedPipes, 3, `row must keep 2 columns (3 delimiters); got: ${row}`);
});
