// End-to-end through logsInputLive itself (mocked fetch) — NOT synthetic
// input.failures injection. Regression: logsInputLive built a failures array
// but never returned it, making the entire partial-export disclosure chain
// (summary, report body, manifest, exit 2) dead code on the live path.
import { test } from "node:test";
import assert from "node:assert/strict";

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
const dev = (id, serial) => ({
  id,
  attributes: { name: `Dev${id}`, serial_number: serial, status: "enrolled" },
});

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/devices") {
    return ok({ data: [dev(1, "S1"), dev(2, "S2")], has_more: false });
  }
  if (u.pathname === "/api/v1/logs") {
    if (u.searchParams.get("serial_number") === "S2") {
      return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
    }
    return ok({ data: [{ id: "L1", attributes: { at: "07/06/26 10:00:00", event_type: "status.changed" } }], has_more: false });
  }
  if (u.pathname === "/api/v1/account") {
    return ok({ data: { attributes: { name: "TestOrg" } } });
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { logsInputLive } = await import("../../dist/reports/cli/inputs.js");

test("logsInputLive RETURNS the failures it collects (drives summary/manifest/partial)", async () => {
  const input = await logsInputLive({ kind: "all" }, { apiKey: "k" });
  assert.equal(input.bundles.length, 1, "only the collectable device is bundled");
  assert.equal(input.bundles[0].device.attributes.serial_number, "S1");
  assert.ok(Array.isArray(input.failures),
    "failures must be RETURNED — without it the partial-export chain is dead code");
  assert.equal(input.failures.length, 1);
  assert.equal(input.failures[0].serial, "S2");
  assert.match(input.failures[0].message, /500/);
});
