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
