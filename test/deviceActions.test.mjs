import { test } from "node:test";
import assert from "node:assert/strict";
import { runBulk } from "../dist/deviceActions.js";

test("runBulk — all succeed", async () => {
  const out = await runBulk(["1", "2", "3"], 2, async (id) => id);
  assert.equal(out.succeeded, 3);
  assert.equal(out.failed, 0);
  assert.equal(out.results.length, 3);
  assert.ok(out.results.every(r => r.ok));
});

test("runBulk — one fails, others still run", async () => {
  const out = await runBulk(["1", "2", "3"], 2, async (id) => {
    if (id === "2") throw new Error("boom");
    return id;
  });
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 1);
  const bad = out.results.find(r => r.device_id === "2");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /boom/);
});

test("runBulk — empty list is a no-op", async () => {
  const out = await runBulk([], 4, async () => { throw new Error("should not run"); });
  assert.deepEqual(out, { results: [], succeeded: 0, failed: 0 });
});
