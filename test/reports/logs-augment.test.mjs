import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
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

test("buildLogsDossier withInventory emits inventory.csv, apps.csv, profiles.csv", async () => {
  const input = buildLogsInput();
  // attach minimal apps/profiles to the first bundle (shape inputs.ts will produce)
  input.bundles[0].apps = [{ attributes: { name: "Chrome", identifier: "com.google.Chrome", version: "1", managed: true } }];
  input.bundles[0].profiles = [{ type: "profile", id: 5, attributes: { name: "WiFi" } }];
  input.bundles[0].users = [];
  const out = mkdtempSync(join(tmpdir(), "logs-inv-"));
  try {
    await buildLogsDossier(input, { withInventory: true }).write(out, { format: "csv", reportOnly: false });
    assert.ok(existsSync(join(out, "inventory.csv")), "inventory.csv must exist");
    assert.ok(existsSync(join(out, "apps.csv")), "apps.csv must exist");
    assert.ok(existsSync(join(out, "profiles.csv")), "profiles.csv must exist");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("buildLogsDossier raw-logs.json redacts secret device attributes", async () => {
  const SECRET_FV  = "hunter2-fv-key-plaintext";
  const SECRET_FW  = "hunter2-fw-password-plaintext";
  const SECRET_RL  = "hunter2-recovery-lock-plaintext";

  const input = buildLogsInput();
  // Inject all 3 secret attrs into the first bundle's device object (deep-clone to avoid fixture mutation).
  const firstDevice = JSON.parse(JSON.stringify(input.bundles[0].device));
  firstDevice.attributes.filevault_recovery_key  = SECRET_FV;
  firstDevice.attributes.firmware_password       = SECRET_FW;
  firstDevice.attributes.recovery_lock_password  = SECRET_RL;
  input.bundles[0] = { ...input.bundles[0], device: firstDevice };

  const out = mkdtempSync(join(tmpdir(), "logs-redact-"));
  try {
    await buildLogsDossier(input).write(out, { format: "md", reportOnly: false });
    const raw = readFileSync(join(out, "raw-logs.json"), "utf8");

    // Plaintext secrets must not appear anywhere in the dump.
    assert.ok(!raw.includes(SECRET_FV),  "filevault_recovery_key plaintext must be absent from raw-logs.json");
    assert.ok(!raw.includes(SECRET_FW),  "firmware_password plaintext must be absent from raw-logs.json");
    assert.ok(!raw.includes(SECRET_RL),  "recovery_lock_password plaintext must be absent from raw-logs.json");

    // Redaction sentinel must be present (non-vacuous assertion).
    assert.ok(raw.includes("[REDACTED set=yes]"), "raw-logs.json must contain [REDACTED set=yes] sentinel");
  } finally { rmSync(out, { recursive: true, force: true }); }
});
