// validateArgs — schema-declared "integer" params must accept JS numbers.
// Regression test: wipe_device's wifi_network_id (the only integer-typed param)
// was rejected for every possible input, making Return-to-Service unreachable.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

let validateArgs;
async function load() {
  if (!validateArgs) ({ validateArgs } = await import("../dist/index.js"));
}

test("wipe_device accepts a numeric wifi_network_id (Return-to-Service path)", async () => {
  await load();
  assert.doesNotThrow(() =>
    validateArgs("wipe_device", { device_id: "1", return_to_service: true, wifi_network_id: 42 })
  );
});

test("wipe_device rejects a non-integer wifi_network_id", async () => {
  await load();
  assert.throws(
    () => validateArgs("wipe_device", { device_id: "1", wifi_network_id: 42.5 }),
    /wifi_network_id/
  );
});

test("wipe_device rejects a string wifi_network_id", async () => {
  await load();
  assert.throws(
    () => validateArgs("wipe_device", { device_id: "1", wifi_network_id: "42" }),
    /wifi_network_id/
  );
});

test("missing required argument still throws", async () => {
  await load();
  assert.throws(() => validateArgs("wipe_device", {}), /device_id/);
});
