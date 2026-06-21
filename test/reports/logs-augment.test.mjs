import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLogsInput } from "../../test/golden/capture.mjs";
import { buildLogsDossier } from "../../dist/reports/specs/logs.js";
import { buildMajorTables, evaluateDevice } from "../../dist/reports/domain/sofa-eval.js";
import { flatten } from "../../scripts/lib/simplemdm.mjs";

function withSecurityInput() {
  const input = buildLogsInput();
  // Synthesize a security eval from the fixture bundles using the same shape
  // logsInputLive will build at runtime: flatten(b.device) → evaluateDevice.
  const tables = buildMajorTables({}, {}); // empty feeds OK for shape; rows still render
  const evald = input.bundles.map((b) => evaluateDevice(flatten(b.device), tables));
  return { ...input, security: { tables, evald } };
}

test("buildLogsDossier withSecurity emits security-posture.csv and device-cves.csv", async () => {
  const out = mkdtempSync(join(tmpdir(), "logs-sec-"));
  try {
    await buildLogsDossier(withSecurityInput(), { withSecurity: true }).write(out, { format: "csv", reportOnly: false });
    assert.ok(existsSync(join(out, "security-posture.csv")), "security-posture.csv must exist");
    assert.ok(existsSync(join(out, "device-cves.csv")), "device-cves.csv must exist");
  } finally { rmSync(out, { recursive: true, force: true }); }
});
