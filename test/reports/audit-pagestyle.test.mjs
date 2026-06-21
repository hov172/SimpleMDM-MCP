// buildAuditDossier page-size option: default A3, opt-in A4-landscape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditInput } from "../../test/golden/capture.mjs";
import { buildAuditDossier } from "../../dist/reports/specs/audit.js";

test("buildAuditDossier defaults to a3-landscape", () => {
  const d = buildAuditDossier(buildAuditInput());
  assert.strictEqual(d.toDocument().pageStyle, "a3-landscape");
});

test("buildAuditDossier honors pageStyle a4-landscape", () => {
  const d = buildAuditDossier(buildAuditInput(), { pageStyle: "a4-landscape" });
  assert.strictEqual(d.toDocument().pageStyle, "a4-landscape");
});

test("buildAuditDossier ignores an unknown pageStyle and falls back to a3", () => {
  const d = buildAuditDossier(buildAuditInput(), { pageStyle: "bogus" });
  assert.strictEqual(d.toDocument().pageStyle, "a3-landscape");
});
