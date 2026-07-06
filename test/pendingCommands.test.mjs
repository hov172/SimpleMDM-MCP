// get_pending_commands pairing — without metadata.command_uuid the fallback key
// embedded the event name AND timestamp, so a "...command.sent" entry could never
// be matched by its "...command.acknowledged" entry: every old sent command was
// reported pending forever.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const HOURS = 3_600_000;
const logEntry = (id, deviceId, event, atMs) => ({
  id,
  attributes: { event, at: new Date(atMs).toISOString() },
  relationships: { device: { data: { id: deviceId } } },
});

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/logs") {
    const now = Date.now();
    return {
      ok: true, status: 200,
      json: async () => ({
        data: [
          // Device 1: sent 10h ago, acknowledged 9h ago — NOT pending.
          logEntry("L1", 1, "restart.command.sent", now - 10 * HOURS),
          logEntry("L2", 1, "restart.command.acknowledged", now - 9 * HOURS),
          // Device 2: sent 10h ago, never acknowledged — pending.
          logEntry("L3", 2, "lock.command.sent", now - 10 * HOURS),
        ],
        has_more: false,
      }),
      text: async () => "",
    };
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool } = await import("../dist/index.js");

test("acknowledged commands without command_uuid are not reported pending", async () => {
  const r = await handleTool("get_pending_commands", { min_age_hours: 4 });
  const ids = r.devices.map((d) => String(d.device_id));
  assert.ok(!ids.includes("1"), `device 1 was acknowledged; pending devices: ${ids.join(", ")}`);
  assert.ok(ids.includes("2"), "device 2's unacknowledged command must be pending");
  assert.equal(r.devices_with_pending, 1);
});
