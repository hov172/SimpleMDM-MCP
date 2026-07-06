// disable_activation_lock + push_message — reinstated after live verification
// (2026-07-06): both routes return 403 (key scope), NOT 404, so they exist;
// the June 6 phantom-endpoint verdict was wrong (push_message was searched
// as "send_message").
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.SIMPLEMDM_ALLOW_WRITES = "true";

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ method: opts?.method ?? "GET", path: new URL(url).pathname, body: opts?.body });
  return { ok: true, status: 202, json: async () => ({}), text: async () => "", headers: new Headers() };
};

const { handleTool, WRITE_TOOLS } = await import("../dist/index.js");

test("disable_activation_lock POSTs the standalone endpoint", async () => {
  await handleTool("disable_activation_lock", { device_id: "570972" });
  assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/v1/devices/570972/disable_activation_lock"),
    `calls: ${calls.map((c) => `${c.method} ${c.path}`).join(", ")}`);
  assert.ok(WRITE_TOOLS.has("disable_activation_lock"));
});

test("push_message POSTs the message body and enforces the 225-char limit", async () => {
  await handleTool("push_message", { device_id: "570972", message: "Please return this loaner to the helpdesk." });
  const call = calls.find((c) => c.path === "/api/v1/devices/570972/push_message");
  assert.ok(call, "must hit /push_message");
  assert.match(String(call.body), /loaner/);
  await assert.rejects(
    () => handleTool("push_message", { device_id: "570972", message: "x".repeat(226) }),
    /225/,
    "messages over the documented 225-char limit must be rejected client-side",
  );
});
