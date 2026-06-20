import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, reportOnlyGate } from "../../dist/reports/engine/csv.js";

test("toCsv quotes cells with commas/quotes/newlines and uses CRLF", () => {
  const cols = [{ key: "a", header: "a" }, { key: "b", header: "b" }];
  const out = toCsv(cols, [{ a: "x,y", b: 'he said "hi"' }]);
  assert.equal(out, 'a,b\r\n"x,y","he said ""hi"""');
});

test("reportOnlyGate: report-only + csv is an error", () => {
  assert.equal(reportOnlyGate("csv", true).error !== null, true);
  assert.deepEqual(reportOnlyGate("all", false), { writeData: true, error: null });
  assert.deepEqual(reportOnlyGate("md", true), { writeData: false, error: null });
});
