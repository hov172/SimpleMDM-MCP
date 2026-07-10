// index.ts wiring test (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
// §4): verifies the CallToolRequestSchema handler routes handleTool failures to
// onToolError and validateArgs failures to neither -- and that neither ever changes the
// error response shape returned to the MCP client. Drives the REAL handler in-process via
// an MCP SDK InMemoryTransport pair (server exported from src/index.ts for this purpose),
// rather than duplicating the handler's try/catch logic in the test.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";
// Disabling writes (default) is exactly what makes lock_device throw from inside
// handleTool without any network call -- requireWrites() throws before api() is reached.
delete process.env.SIMPLEMDM_ALLOW_WRITES;

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { server } = await import("../../dist/index.js");

function resetFindingsEnv(overrides = {}) {
  delete process.env.MUNKIREPORT_ENABLED;
  delete process.env.MCP_PUBLISH_MODE;
  delete process.env.MCP_PUBLISH_MIN_SEVERITY;
  Object.assign(process.env, overrides);
}

async function connectedClient() {
  const client = new Client({ name: "wiring-test-client", version: "0.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function withCapturedStderr(fn) {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logs;
}

test("a validateArgs failure (missing required arg) returns isError:true and does NOT invoke onToolError", async () => {
  resetFindingsEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "dry_run" });
  const client = await connectedClient();
  let result, logs;
  try {
    logs = await withCapturedStderr(async () => {
      result = await client.callTool({ name: "lock_device", arguments: {} });
    });
  } finally {
    await client.close();
  }
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /^Error: lock_device: missing required argument "device_id"$/);
  assert.ok(!logs.some((l) => /\[findings dry-run\]/.test(l)), "onToolError must not fire for a validateArgs (client-error) failure");
});

test("a handleTool failure (requireWrites throws) returns isError:true and DOES invoke onToolError", async () => {
  resetFindingsEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "dry_run" });
  const client = await connectedClient();
  let result, logs;
  try {
    logs = await withCapturedStderr(async () => {
      result = await client.callTool({ name: "lock_device", arguments: { device_id: "42" } });
    });
  } finally {
    await client.close();
  }
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /^Error: Write actions are disabled\./);
  assert.ok(
    logs.some((l) => /\[findings dry-run\] lock_device: would publish 1 failure finding/.test(l)),
    "onToolError must fire for a real handleTool (operational) failure",
  );
});

test("the error response shape is identical for both failure sources regardless of findings config (disabled)", async () => {
  resetFindingsEnv(); // MUNKIREPORT_ENABLED unset -- findings pipeline fully disabled
  const client = await connectedClient();
  try {
    const validateArgsFailure = await client.callTool({ name: "lock_device", arguments: {} });
    const handleToolFailure = await client.callTool({ name: "lock_device", arguments: { device_id: "42" } });

    for (const result of [validateArgsFailure, handleToolFailure]) {
      assert.equal(result.isError, true);
      assert.deepStrictEqual(Object.keys(result).sort(), ["content", "isError"]);
      assert.equal(result.content.length, 1);
      assert.deepStrictEqual(Object.keys(result.content[0]).sort(), ["text", "type"]);
      assert.equal(result.content[0].type, "text");
      assert.match(result.content[0].text, /^Error: /);
    }
  } finally {
    await client.close();
  }
});
