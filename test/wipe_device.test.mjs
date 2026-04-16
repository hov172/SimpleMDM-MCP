import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWipeBody, validateWipeArgs } from "../dist/wipe.js";

test("buildWipeBody — legacy call, only device_id, serializes to {}", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1" }));
  assert.equal(body, "{}");
});

test("buildWipeBody — legacy call with pin serializes pin only", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1", pin: "123456" }));
  assert.equal(body, '{"pin":"123456"}');
});

test("validateWipeArgs — return_to_service=true without wifi_network_id throws", () => {
  assert.throws(
    () => validateWipeArgs({ return_to_service: true }),
    /wifi_network_id/
  );
});

test("validateWipeArgs — return_to_service=true with wifi_network_id passes", () => {
  assert.doesNotThrow(() =>
    validateWipeArgs({ return_to_service: true, wifi_network_id: 42 })
  );
});

test("validateWipeArgs — return_to_service=false does not require wifi_network_id", () => {
  assert.doesNotThrow(() => validateWipeArgs({ return_to_service: false }));
});

test("validateWipeArgs — return_to_service omitted does not require wifi_network_id", () => {
  assert.doesNotThrow(() => validateWipeArgs({}));
});

test("buildWipeBody — all fields serialize verbatim", () => {
  const body = JSON.parse(JSON.stringify(buildWipeBody({
    device_id: "1",
    pin: "123456",
    preserve_data_plan: true,
    disable_activation_lock: false,
    disallow_proximity_setup: true,
    return_to_service: true,
    wifi_network_id: 42,
    obliteration_behavior: "DoNotObliterate",
    clear_custom_attributes: true,
    unassign_direct_profiles: true,
  })));
  assert.deepEqual(body, {
    pin: "123456",
    preserve_data_plan: true,
    disable_activation_lock: false,
    disallow_proximity_setup: true,
    return_to_service: true,
    wifi_network_id: 42,
    obliteration_behavior: "DoNotObliterate",
    clear_custom_attributes: true,
    unassign_direct_profiles: true,
  });
});

test("buildWipeBody — wifi_network_id serializes as unquoted integer", () => {
  const body = JSON.stringify(buildWipeBody({
    device_id: "1",
    return_to_service: true,
    wifi_network_id: 42,
  }));
  assert.equal(body, '{"return_to_service":true,"wifi_network_id":42}');
});

test("buildWipeBody — undefined fields are dropped by JSON.stringify", () => {
  const body = JSON.parse(JSON.stringify(buildWipeBody({
    device_id: "1",
    preserve_data_plan: true,
  })));
  assert.deepEqual(body, { preserve_data_plan: true });
});

test("buildWipeBody — clear_custom_attributes alone serializes", () => {
  const body = JSON.stringify(buildWipeBody({
    device_id: "1",
    clear_custom_attributes: true,
  }));
  assert.equal(body, '{"clear_custom_attributes":true}');
});

test("buildWipeBody — unassign_direct_profiles alone serializes", () => {
  const body = JSON.stringify(buildWipeBody({
    device_id: "1",
    unassign_direct_profiles: true,
  }));
  assert.equal(body, '{"unassign_direct_profiles":true}');
});
