// Write-gate behavior driven through the REAL CallToolRequestSchema handler.
// fetch is mocked and counted: the core assertions are "no network call
// happened" (plan/dry_run/blocked) vs "exactly one call" (confirmed execute).
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";
process.env.SIMPLEMDM_ALLOW_WRITES = "true";
process.env.SIMPLEMDM_CONFIRM_MODE = "on";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let fetchCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url: String(url), method: opts.method ?? "GET" });
  return {
    ok: true, status: 202, headers: { get: () => null },
    text: async () => "{}", json: async () => ({}),
  };
};

const AUDIT_DIR = mkdtempSync(join(tmpdir(), "gate-audit-"));
process.env.MCP_WRITE_AUDIT_DIR = AUDIT_DIR;

const { server } = await import("../../dist/index.js");
const { _clearTokensForTests } = await import("../../dist/safety/confirm.js");

beforeEach(() => { fetchCalls = []; _clearTokensForTests(); });

async function connectedClient() {
  const client = new Client({ name: "gate-test", version: "0.0.0" }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

function parse(result) { return JSON.parse(result.content[0].text); }

function auditLines() {
  return readdirSync(AUDIT_DIR)
    .flatMap((f) => readFileSync(join(AUDIT_DIR, f), "utf8").trim().split("\n"))
    .filter(Boolean).map((l) => JSON.parse(l));
}

test("critical tool without token returns a plan, makes no network call, audits phase=plan", async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: "wipe_device", arguments: { device_id: "42" } });
    assert.ok(!result.isError);
    const plan = parse(result);
    assert.equal(plan.write_gate, "confirmation_required");
    assert.equal(plan.tier, "critical");
    assert.match(plan.confirm_token, /^[0-9a-f]{32,}$/);
    assert.equal(fetchCalls.filter((c) => c.method !== "GET").length, 0);
    assert.ok(auditLines().some((e) => e.tool === "wipe_device" && e.phase === "plan"));
  } finally { await client.close(); }
});

test("critical tool with valid token executes exactly one POST and audits phase=execute", async () => {
  const client = await connectedClient();
  try {
    const plan = parse(await client.callTool({ name: "wipe_device", arguments: { device_id: "42" } }));
    fetchCalls = [];
    const result = await client.callTool({
      name: "wipe_device", arguments: { device_id: "42", confirm_token: plan.confirm_token },
    });
    assert.ok(!result.isError);
    assert.equal(fetchCalls.filter((c) => c.method === "POST").length, 1);
    assert.ok(auditLines().some((e) => e.tool === "wipe_device" && e.phase === "execute" && e.outcome === "success"));
  } finally { await client.close(); }
});

test("token bound to different args is rejected (blocked, no network call)", async () => {
  const client = await connectedClient();
  try {
    const plan = parse(await client.callTool({ name: "wipe_device", arguments: { device_id: "42" } }));
    fetchCalls = [];
    const result = await client.callTool({
      name: "wipe_device", arguments: { device_id: "43", confirm_token: plan.confirm_token },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirm token/i);
    assert.equal(fetchCalls.filter((c) => c.method === "POST").length, 0);
    assert.ok(auditLines().some((e) => e.tool === "wipe_device" && e.phase === "blocked"));
  } finally { await client.close(); }
});

test("dry_run on any write tool returns a plan and never issues a write", async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: "sync_device", arguments: { device_id: "42", dry_run: true } });
    assert.ok(!result.isError);
    const plan = parse(result);
    assert.equal(plan.write_gate, "dry_run");
    assert.equal(plan.tier, "low");
    assert.equal(fetchCalls.filter((c) => c.method === "POST").length, 0);
  } finally { await client.close(); }
});

test("low-tier tool executes directly (no token) and is audited", async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: "sync_device", arguments: { device_id: "42" } });
    assert.ok(!result.isError);
    assert.equal(fetchCalls.filter((c) => c.method === "POST").length, 1);
    assert.ok(auditLines().some((e) => e.tool === "sync_device" && e.phase === "execute"));
  } finally { await client.close(); }
});

test("SIMPLEMDM_CONFIRM_MODE=off executes high/critical directly", async () => {
  process.env.SIMPLEMDM_CONFIRM_MODE = "off";
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: "lock_device", arguments: { device_id: "42" } });
    assert.ok(!result.isError);
    assert.equal(fetchCalls.filter((c) => c.method === "POST").length, 1);
  } finally {
    process.env.SIMPLEMDM_CONFIRM_MODE = "on";
    await client.close();
  }
});

test("read tools are untouched by the gate (no audit lines)", async () => {
  const client = await connectedClient();
  try {
    const before = auditLines().length;
    await client.callTool({ name: "get_account", arguments: {} });
    assert.equal(auditLines().length, before);
  } finally { await client.close(); }
});

test("write tools advertise dry_run and confirm_token in their input schema", async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const wipe = tools.find((t) => t.name === "wipe_device");
    assert.ok(wipe.inputSchema.properties.dry_run);
    assert.ok(wipe.inputSchema.properties.confirm_token);
    const read = tools.find((t) => t.name === "get_account");
    assert.ok(!read.inputSchema.properties?.confirm_token);
  } finally { await client.close(); }
});
