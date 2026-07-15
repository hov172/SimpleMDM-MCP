import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const mockRoutes = new Map();
globalThis.fetch = async (url, opts) => {
  const path = new URL(url).pathname;
  const key = `${opts?.method ?? "GET"}:${path}`;
  if (mockRoutes.has(key)) {
    const body = mockRoutes.get(key);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }
  throw new Error(`Unhandled mock fetch: ${key}`);
};

const { handleTool } = await import("../dist/index.js");

const DAY = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY + 60_000).toISOString();

test("get_dep_token_audit bands, counts, roll-up, sort, sync_stale", async () => {
  mockRoutes.set("GET:/api/v1/dep_servers", {
    data: [
      { type: "dep_server", id: 1, attributes: { server_name: "A-renewnow",  organization_name: "Org", token_expires_at: iso(10),  last_synced_at: iso(-1)  } },
      { type: "dep_server", id: 2, attributes: { server_name: "B-renewsoon", organization_name: "Org", token_expires_at: iso(60),  last_synced_at: iso(-10) } },
      { type: "dep_server", id: 3, attributes: { server_name: "C-ok",        organization_name: "Org", token_expires_at: iso(200), last_synced_at: iso(-1)  } },
      { type: "dep_server", id: 4, attributes: { server_name: "D-expired",   organization_name: "Org", token_expires_at: iso(-5),  last_synced_at: iso(-1)  } },
      { type: "dep_server", id: 5, attributes: { server_name: "E-unknown",   organization_name: "Org" } },
    ],
    has_more: false,
  });

  const r = await handleTool("get_dep_token_audit", {});

  assert.equal(r.total, 5);
  assert.equal(r.expired_count, 1);
  assert.equal(r.renew_now_count, 1);
  assert.equal(r.renew_soon_count, 1);
  assert.equal(r.worst_warning, "expired");

  // sorted ascending by days_until_expiry, unknown (null) last
  assert.equal(r.servers[0].warning, "expired");
  assert.equal(r.servers[1].warning, "renew_now");
  assert.equal(r.servers[2].warning, "renew_soon");
  assert.equal(r.servers[3].warning, "ok");
  assert.equal(r.servers[4].warning, "unknown");
  assert.equal(r.servers[4].days_until_expiry, null);

  const byName = Object.fromEntries(r.servers.map((s) => [s.server_name, s]));
  assert.equal(byName["A-renewnow"].sync_stale, false);
  assert.equal(byName["B-renewsoon"].sync_stale, true);   // synced 10d ago
  assert.equal(byName["E-unknown"].sync_stale, true);     // last_synced_at missing
});
