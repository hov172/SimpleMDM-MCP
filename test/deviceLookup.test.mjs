// get_device_full_profile serial resolution — /devices?search matches names, UDIDs,
// etc., so a non-matching first hit must NOT be silently used as "the" device.
// Regression: `?? foundData[0]` returned a full dossier for an unrelated device.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/devices" && u.searchParams.has("search")) {
    // Search hit on device NAME ("XY123 loaner"), not serial — wrong device.
    return {
      ok: true, status: 200,
      json: async () => ({
        data: [{ id: 999, attributes: { name: "XY123 loaner", serial_number: "OTHER-SERIAL" } }],
        has_more: false,
      }),
      text: async () => "",
    };
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool } = await import("../dist/index.js");

test("get_device_full_profile throws on serial search with no exact match (never guesses)", async () => {
  await assert.rejects(
    () => handleTool("get_device_full_profile", { serial_number: "XY123" }),
    /exact|no device found/i,
    "must throw instead of silently returning the first search hit",
  );
});
