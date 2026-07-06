// Cache race — a list pagination in flight when a write invalidates must NOT
// re-cache its (now stale) result after the invalidation lands. Otherwise the
// next read serves pre-write data for a full TTL.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const respond = (data) => ({
  ok: true, status: 200,
  json: async () => ({ data, has_more: false }),
  text: async () => "",
});

let releaseFirstFetch;
const firstFetchGate = new Promise((r) => { releaseFirstFetch = r; });
let fetchCount = 0;

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/devices") {
    fetchCount++;
    if (fetchCount === 1) {
      await firstFetchGate; // hold the first pagination in flight
      return respond([{ id: 1, attributes: { name: "STALE-PRE-WRITE" } }]);
    }
    return respond([{ id: 2, attributes: { name: "FRESH-POST-WRITE" } }]);
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool, cacheInvalidate } = await import("../dist/index.js");

test("in-flight pagination does not re-cache stale data over a write's invalidation", async () => {
  const inFlight = handleTool("list_devices", {});          // read starts
  await new Promise((r) => setTimeout(r, 20));              // let it reach the gated fetch
  cacheInvalidate("/devices");                              // write completes mid-read
  releaseFirstFetch();
  await inFlight;                                           // stale result returns to ITS caller (fine)

  const after = await handleTool("list_devices", {});       // must refetch, not serve stale cache
  assert.match(JSON.stringify(after), /FRESH-POST-WRITE/,
    `post-write read must not see pre-write data; fetches: ${fetchCount}`);
  assert.equal(fetchCount, 2, "second read must hit the API again");
});
