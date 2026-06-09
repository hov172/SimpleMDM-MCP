import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function waitForResponse(child, id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}. Buffer: ${buffer}`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === id) {
          cleanup();
          resolve(parsed);
          return;
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`MCP server exited before response ${id}; code=${code}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

test("MCP stdio initialize and tools/list expose Apple schema helpers", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, SIMPLEMDM_API_KEY: "smoke-test-key" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const initialize = waitForResponse(child, 1);
    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "simplemdm-mcp-test", version: "0.0.0" },
      },
    });
    const initResponse = await initialize;
    assert.equal(initResponse.result.serverInfo.name, "simplemdm-mcp");

    send(child, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    const listTools = waitForResponse(child, 2);
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const toolsResponse = await listTools;
    const names = toolsResponse.result.tools.map((tool) => tool.name);
    assert.ok(names.includes("search_apple_device_management_schemas"));
    assert.ok(names.includes("build_wifi_profile_payload"));
    assert.ok(names.includes("build_filevault_escrow_profile_payload"));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    assert.doesNotMatch(stderr, /Fatal:/);
  }
});
