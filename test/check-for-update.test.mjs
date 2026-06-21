// check_for_update tool — registration + graceful handler (no throw, online or offline).
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

let TOOLS, handleTool;
async function load() {
  if (!TOOLS) ({ TOOLS, handleTool } = await import("../dist/index.js"));
}

test("check_for_update is registered with an empty input schema", async () => {
  await load();
  const t = TOOLS.find((x) => x.name === "check_for_update");
  assert.ok(t, "check_for_update must be registered");
  assert.deepEqual(t.inputSchema, { type: "object", properties: {} });
});

test("check_for_update always returns an object with current_version (never throws)", async () => {
  await load();
  const r = await handleTool("check_for_update", {});
  assert.ok(r && typeof r === "object", "must return an object");
  assert.equal(typeof r.current_version, "string", "current_version is always set from package.json");
  // Either a successful comparison (update_available present) or a graceful {error} — never a throw.
  assert.ok("update_available" in r || "error" in r, "must report status or a graceful error");
  if ("update_available" in r) {
    assert.equal(typeof r.update_available, "boolean");
    assert.equal(typeof r.latest_version, "string");
  }
});
