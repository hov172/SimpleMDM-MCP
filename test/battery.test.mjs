// Battery normalization — a "1%" reading is one percent, not a 0-1 fraction.
// Regression: `num <= 1 ? num * 100 : num` turned the most critical reading (1%)
// into 100%, silently excluding the device most in need of flagging; "0%" was
// dropped entirely by a `pct > 0` guard.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const dev = (id, serial, battery_level) => ({
  id,
  attributes: { name: `Dev${id}`, serial_number: serial, status: "enrolled", battery_level },
});

globalThis.fetch = async (url) => {
  const path = new URL(url).pathname;
  if (path === "/api/v1/devices") {
    return {
      ok: true, status: 200,
      json: async () => ({
        data: [
          dev(1, "DEAD1PCT", "1%"),      // must be flagged: 1%
          dev(2, "DEAD0PCT", "0%"),      // must be flagged: 0%
          dev(3, "FULL100", "100%"),     // must NOT be flagged
          dev(4, "FRACHALF", 0.5),       // bare 0-1 fraction → 50%, not flagged
        ],
        has_more: false,
      }),
      text: async () => "",
    };
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool } = await import("../dist/index.js");

test("get_battery_health_report flags 1% and 0% readings, not 100%", async () => {
  const r = await handleTool("get_battery_health_report", {});
  const bySerial = new Map(r.devices.map((d) => [d.serial, d]));

  assert.ok(bySerial.has("DEAD1PCT"), `1% device must be flagged; flagged: ${[...bySerial.keys()].join(", ")}`);
  assert.equal(bySerial.get("DEAD1PCT").level_pct, 1, "'1%' must normalize to 1, not 100");
  assert.ok(bySerial.has("DEAD0PCT"), "0% device must be flagged");
  assert.equal(bySerial.get("DEAD0PCT").level_pct, 0);
  assert.ok(!bySerial.has("FULL100"), "100% device must not be flagged");
  assert.ok(!bySerial.has("FRACHALF"), "0.5 fraction (50%) must not be flagged at threshold 20");
});

test("get_storage_health low-battery list includes 1% and 0% devices", async () => {
  const r = await handleTool("get_storage_health", {});
  const serials = r.low_battery_devices.map((d) => d.serial);
  assert.ok(serials.includes("DEAD1PCT"), `1% device must be in low-battery list; got: ${serials.join(", ")}`);
  assert.ok(serials.includes("DEAD0PCT"), "0% device must be in low-battery list");
  assert.ok(!serials.includes("FULL100"));
  const d1 = r.low_battery_devices.find((d) => d.serial === "DEAD1PCT");
  assert.equal(d1.battery_level_pct, 1, "'1%' must normalize to 1, not 100");
});
