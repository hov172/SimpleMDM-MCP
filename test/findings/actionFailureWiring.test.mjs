// index.ts wiring test (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md
// §4): verifies the CallToolRequestSchema handler routes handleTool failures to
// onToolError and validateArgs failures to neither -- and that neither ever changes the
// error response shape returned to the MCP client. Drives the REAL handler in-process via
// an MCP SDK InMemoryTransport pair (server exported from src/index.ts for this purpose),
// rather than duplicating the handler's try/catch logic in the test.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";
// Writes must be ENABLED so lock_device reaches the real api() call and fails
// with a genuine HttpError (a non-2xx SimpleMDM response) -- onToolError only
// treats HttpError as an operational failure worth a finding (see the review
// fix in middleware.ts: requireWrites()/validateWipeArgs()/seg() throw plain
// Errors for client-error/bad-argument/config cases BEFORE any network call,
// and those must NOT generate a "danger" fleet finding).
process.env.SIMPLEMDM_ALLOW_WRITES = "true";
// lock_device is a high-tier write; the write-safety gate (src/index.ts) would
// otherwise intercept it and return a confirmation plan instead of reaching
// the real api() call this test needs. Confirm mode off keeps this test's
// focus on findings wiring, not the gate (that's test/safety/gateWiring.test.mjs).
process.env.SIMPLEMDM_CONFIRM_MODE = "off";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Keep this test's gated lock_device/wipe_device audit writes out of the
// repo's real default audit_log/ dir (mirrors test/safety/gateWiring.test.mjs).
process.env.MCP_WRITE_AUDIT_DIR = mkdtempSync(join(tmpdir(), "afw-audit-"));

// A 404 (never retried by fetchWithRetry, unlike 429/5xx) so throwForStatus
// raises an HttpError immediately -- a stand-in for a real SimpleMDM failure
// (e.g. device not found), without a live network call.
globalThis.fetch = async () => ({
  ok: false,
  status: 404,
  headers: { get: () => null },
  text: async () => "device not found",
});

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

test("a handleTool failure (real HttpError from SimpleMDM) returns isError:true and DOES invoke onToolError", async () => {
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
  assert.match(result.content[0].text, /^Error: SimpleMDM 404/);
  assert.ok(
    logs.some((l) => /\[findings dry-run\] lock_device: would publish 1 failure finding/.test(l)),
    "onToolError must fire for a real upstream HttpError failure",
  );
});

test("a handleTool failure that is a client/bad-args error (validateWipeArgs), not an HttpError, does NOT invoke onToolError", async () => {
  // SIMPLEMDM_ALLOW_WRITES is captured into a module-level const at import time,
  // so it can't be toggled per-test here -- instead use wipe_device's own
  // validateWipeArgs() bad-argument guard (return_to_service:true requires
  // wifi_network_id), which throws a plain Error from inside handleTool
  // AFTER requireWrites() passes but BEFORE any api()/network call is made --
  // exactly the "client error, no network attempted" case the fix targets.
  resetFindingsEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "dry_run" });
  const client = await connectedClient();
  let result, logs;
  try {
    logs = await withCapturedStderr(async () => {
      result = await client.callTool({ name: "wipe_device", arguments: { device_id: "42", return_to_service: true } });
    });
  } finally {
    await client.close();
  }
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /wifi_network_id/);
  assert.ok(
    !logs.some((l) => /\[findings dry-run\]/.test(l)),
    "onToolError must not fire for a non-HttpError handleTool failure (client/bad-args error, no network call attempted)",
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
