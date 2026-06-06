import { test } from "node:test";
import assert from "node:assert/strict";
import { runBulk } from "../dist/deviceActions.js";
import { buildSendMessageBody, validateSendMessageArgs } from "../dist/deviceActions.js";

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

test("buildSendMessageBody — message only", () => {
  const body = buildSendMessageBody({ message: "Please restart" });
  assert.deepEqual(body, { message: "Please restart" });
});

test("buildSendMessageBody — message + title", () => {
  const body = buildSendMessageBody({ message: "Hi", title: "IT Notice" });
  assert.deepEqual(body, { message: "Hi", title: "IT Notice" });
});

test("validateSendMessageArgs — empty message throws", () => {
  assert.throws(() => validateSendMessageArgs({ message: "" }), /message/);
});

test("validateSendMessageArgs — non-empty message passes", () => {
  assert.doesNotThrow(() => validateSendMessageArgs({ message: "ok" }));
});

test("validateSendMessageArgs — whitespace-only message throws", () => {
  assert.throws(() => validateSendMessageArgs({ message: "   " }), /message/);
});

test("buildSendMessageBody — whitespace-only title is omitted", () => {
  const body = buildSendMessageBody({ message: "hi", title: "   " });
  assert.deepEqual(body, { message: "hi" });
});
