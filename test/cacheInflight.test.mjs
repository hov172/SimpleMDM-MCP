// A read that starts AFTER a write's invalidation must not be handed a
// pre-write in-flight pagination promise — it should trigger a fresh fetch.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const respond = (data) => ({
  ok: true, status: 200,
  json: async () => ({ data, has_more: false }),
  text: async () => "",
});

let releaseGate;
const gate = new Promise((r) => { releaseGate = r; });
let fetchCount = 0;

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/devices") {
    fetchCount++;
    if (fetchCount === 1) {
      await gate; // first read held in flight across the invalidation
      return respond([{ id: 1, attributes: { name: "PRE-WRITE" } }]);
    }
    return respond([{ id: 2, attributes: { name: "POST-WRITE" } }]);
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool, cacheInvalidate } = await import("../dist/index.js");

test("post-invalidation reads do not join a pre-write in-flight pagination", async () => {
  const preWriteRead = handleTool("list_devices", {});     // starts, blocks on gate
  await new Promise((r) => setTimeout(r, 20));
  cacheInvalidate("/devices");                             // write completes
  const postWriteRead = handleTool("list_devices", {});    // must fetch fresh
  await new Promise((r) => setTimeout(r, 20));
  releaseGate();

  const [, r2] = await Promise.all([preWriteRead, postWriteRead]);
  assert.equal(fetchCount, 2, "post-invalidation read must trigger its own fetch");
  assert.match(JSON.stringify(r2), /POST-WRITE/,
    "read started after the write must not see pre-write data");
});
