import { test } from "node:test";
import assert from "node:assert/strict";
import { Dossier } from "../../dist/reports/engine/dossier.js";

test("Dossier records sections and blocks into a serializable document", () => {
  const d = new Dossier({ title: "T", pageStyle: "a3-landscape" });
  d.section("Security Report")
    .summary("Devices with issues: **2**")
    .table([{ key: "serial", header: "serial" }], [{ serial: "C02" }], "security-report.csv")
    .callout("1 device exploited");
  const doc = d.toDocument();
  assert.equal(doc.title, "T");
  assert.equal(doc.pageStyle, "a3-landscape");
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].heading, "Security Report");
  assert.deepEqual(doc.sections[0].blocks.map((b) => b.kind), ["summary", "table", "callout"]);
  assert.equal(doc.sections[0].blocks[1].csvName, "security-report.csv");
});
