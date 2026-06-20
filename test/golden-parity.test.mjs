import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("golden corpus present for all three reports", () => {
  for (const [r, f] of [["audit", "full-audit.md"], ["inventory", "report.md"], ["logs", "report.md"]]) {
    const body = readFileSync(new URL(`./golden/${r}/${f}`, import.meta.url), "utf8");
    assert.ok(body.length > 100, `${r}/${f} should be a real report`);
  }
});
