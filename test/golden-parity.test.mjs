import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuditDossier } from "../dist/reports/specs/audit.js";
import { buildInventoryDossier } from "../dist/reports/specs/inventory.js";
import { buildLogsDossier } from "../dist/reports/specs/logs.js";
import { buildAuditInput, buildInventoryInput, buildLogsInput, readGolden } from "./golden/capture.mjs";

test("golden corpus present for all three reports", () => {
  for (const [r, f] of [["audit", "full-audit.md"], ["inventory", "report.md"], ["logs", "report.md"]]) {
    const body = readFileSync(new URL(`./golden/${r}/${f}`, import.meta.url), "utf8");
    assert.ok(body.length > 100, `${r}/${f} should be a real report`);
  }
});

test("audit dossier byte-identical to golden (full set)", async () => {
  const out = mkdtempSync(join(tmpdir(), "audit-"));
  await buildAuditDossier(buildAuditInput()).write(out, { format: "md", reportOnly: false, generatedIso: "2026-01-01T00:00:00Z" });
  for (const f of readdirSync(new URL("./golden/audit", import.meta.url)).filter((f) => f !== "_binary-manifest.json"))
    assert.equal(readFileSync(join(out, f), "utf8"), readGolden("audit", f), `${f} drifted`);
});

test("inventory dossier byte-identical to golden (full set)", async () => {
  const out = mkdtempSync(join(tmpdir(), "inventory-"));
  await buildInventoryDossier(buildInventoryInput()).write(out, { format: "md", reportOnly: false, generatedIso: "2026-01-01T00:00:00Z" });
  for (const f of readdirSync(new URL("./golden/inventory", import.meta.url)).filter((f) => f !== "_binary-manifest.json"))
    assert.equal(readFileSync(join(out, f), "utf8"), readGolden("inventory", f), `${f} drifted`);
});

test("logs dossier byte-identical to golden (full set)", async () => {
  const input = buildLogsInput();
  const out = mkdtempSync(join(tmpdir(), "logs-"));
  await buildLogsDossier(input).write(out, { format: "md", reportOnly: false, manifest: false, generatedIso: input.nowIso });
  for (const f of readdirSync(new URL("./golden/logs", import.meta.url)).filter((f) => f !== "_binary-manifest.json"))
    assert.equal(readFileSync(join(out, f), "utf8"), readGolden("logs", f), `${f} drifted`);
});
