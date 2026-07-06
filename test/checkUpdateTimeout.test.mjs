// check_for_update must bound its GitHub fetch with an abort timeout like every
// other outbound call — a stalled connection otherwise hangs the tool for
// undici's multi-minute default.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

let sawAbortSignal = false;
globalThis.fetch = async (_url, opts) => {
  sawAbortSignal = opts?.signal instanceof AbortSignal;
  throw new Error("offline (mock)");
};

const { handleTool } = await import("../dist/index.js");

test("check_for_update passes an AbortSignal timeout to fetch", async () => {
  const r = await handleTool("check_for_update", {});
  assert.ok(r && typeof r === "object" && "error" in r, "graceful error object on network failure");
  assert.ok(sawAbortSignal, "fetch must be called with an AbortSignal (timeout bound)");
});
