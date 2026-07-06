// fetchDeviceGroups must retry 429 like every other fetcher in this lib —
// every report calls it up front, so one rate-limit hit aborted whole reports.
import { test } from "node:test";
import assert from "node:assert/strict";

let calls = 0;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/device_groups") {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 429, headers: new Map(), json: async () => ({}), text: async () => "" };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ data: [{ id: 7, attributes: { name: "HLAB_Faculty" } }], has_more: false }),
      text: async () => "",
    };
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { fetchDeviceGroups } = await import("../../scripts/lib/simplemdm.mjs");

test("fetchDeviceGroups retries a 429 instead of aborting the report", async () => {
  const map = await fetchDeviceGroups("k");
  assert.equal(map.get(7), "HLAB_Faculty");
  assert.equal(calls, 2, "must have retried after the 429");
});
