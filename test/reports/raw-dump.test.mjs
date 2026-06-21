import { test } from "node:test";
import assert from "node:assert/strict";
import { redactDeviceRaw, SECRET_DEVICE_ATTRS } from "../../dist/reports/domain/inventory.js";

test("redactDeviceRaw masks all secret attrs without mutating the input", () => {
  const input = { id: 1, attributes: { serial_number: "C02", filevault_recovery_key: "ABC-123", firmware_password: "pw", recovery_lock_password: "", name: "Mac" } };
  const out = redactDeviceRaw(input);
  assert.equal(out.attributes.filevault_recovery_key, "[REDACTED set=yes]");
  assert.equal(out.attributes.firmware_password, "[REDACTED set=yes]");
  assert.equal(out.attributes.recovery_lock_password, null); // empty → null, not "set=yes"
  assert.equal(out.attributes.serial_number, "C02");
  assert.equal(input.attributes.filevault_recovery_key, "ABC-123"); // input untouched
  assert.deepEqual(SECRET_DEVICE_ATTRS, ["filevault_recovery_key", "firmware_password", "recovery_lock_password"]);
});

import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInventoryInput } from "../../test/golden/capture.mjs";
import { buildInventoryDossier } from "../../dist/reports/specs/inventory.js";

test("buildInventoryDossier raw opt writes redacted raw/devices.json", async () => {
  const input = buildInventoryInput();
  const out = mkdtempSync(join(tmpdir(), "raw-"));
  try {
    await buildInventoryDossier(input, { raw: true }).write(out, { format: "md", reportOnly: false });
    assert.ok(existsSync(join(out, "raw", "devices.json")), "raw/devices.json must exist");
    const dump = readFileSync(join(out, "raw", "devices.json"), "utf8");
    assert.doesNotMatch(dump, /filevault_recovery_key":"(?!\[REDACTED|null)/, "secret values must be redacted");
  } finally { rmSync(out, { recursive: true, force: true }); }
});
