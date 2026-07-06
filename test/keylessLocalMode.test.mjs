// LOCAL_APP_MODE without SIMPLEMDM_API_KEY — startup allows it, but only
// get_fleet_summary / get_security_posture have local routes. Every derived
// fleet tool hits the API directly and failed with an opaque "SimpleMDM 401".
// It must fail fast with a message that names the missing key instead.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.LOCAL_APP_MODE = "true";
delete process.env.SIMPLEMDM_API_KEY;

globalThis.fetch = async () => {
  // If the key guard works, no API request is ever made.
  return { ok: false, status: 401, json: async () => ({}), text: async () => "401 Unauthorized" };
};

const { handleTool } = await import("../dist/index.js");

test("fleet tools without an API key fail with a clear message, not SimpleMDM 401", async () => {
  await assert.rejects(
    () => handleTool("get_stale_devices", {}),
    (err) => {
      assert.match(err.message, /SIMPLEMDM_API_KEY/, `error must name the missing env var; got: ${err.message}`);
      assert.doesNotMatch(err.message, /SimpleMDM 401/, "must not surface an opaque upstream 401");
      return true;
    },
  );
});
