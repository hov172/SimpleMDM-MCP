// refresh_device_inventory — POST /devices/{id}/refresh (documented; live-verified
// route exists 2026-07-06, returns 403 until the API key gets the write scope).
// Also pins sync_device's actual behavior: it calls /push_apps, not a check-in.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.SIMPLEMDM_ALLOW_WRITES = "true";

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push(`${opts?.method ?? "GET"} ${new URL(url).pathname}`);
  return { ok: true, status: 202, json: async () => ({}), text: async () => "", headers: new Headers() };
};

const { handleTool, TOOLS, WRITE_TOOLS, INVALIDATION_MAP } = await import("../dist/index.js");

test("refresh_device_inventory POSTs /devices/{id}/refresh", async () => {
  await handleTool("refresh_device_inventory", { device_id: "570972" });
  assert.ok(calls.includes("POST /api/v1/devices/570972/refresh"), `calls: ${calls.join(", ")}`);
});

test("refresh_device_inventory is a write tool with /devices invalidation", () => {
  assert.ok(WRITE_TOOLS.has("refresh_device_inventory"));
  assert.ok(INVALIDATION_MAP["refresh_device_inventory"]?.includes("/devices"));
});

test("sync_device description states its real behavior (app push, not check-in)", () => {
  const t = TOOLS.find((x) => x.name === "sync_device");
  assert.match(t.description, /push/i, "must say it pushes assigned apps");
  assert.doesNotMatch(t.description, /re-?check.?in/i, "must not claim a device check-in");
  assert.match(t.description, /refresh_device_inventory/, "must point to the real refresh tool");
});
