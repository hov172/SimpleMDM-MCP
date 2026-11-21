// SIMPLEMDM_TOOL_ALLOWLIST trims tools/list and rejects tools/call for hidden tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
const { filterTools, TOOLS } = await import("../dist/index.js");

test("filterTools: unset exposes everything; names and globs filter; unmatched reported", () => {
  assert.equal(filterTools(TOOLS, undefined).tools.length, TOOLS.length);
  assert.equal(filterTools(TOOLS, " , ").tools.length, TOOLS.length);
  const r = filterTools(TOOLS, "get_fleet_summary, list_*, nope_*");
  const names = r.tools.map(t => t.name);
  assert.ok(names.includes("get_fleet_summary"));
  assert.ok(names.includes("list_devices"));
  assert.ok(!names.includes("get_device"));
  assert.deepEqual(r.unmatched, ["nope_*"]);
  assert.equal(filterTools(TOOLS, "get_device.").tools.length, 0, "dot is literal, not regex");
});

function rpc(child, id, method, params) {
  return new Promise((resolve0, reject) => {
    let resolve = resolve0;
    let buf = "";
    const onData = (c) => {
      buf += c.toString("utf8");
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === id) { child.stdout.off("data", onData); resolve(m); } } catch { /* partial */ }
      }
    };
    child.stdout.on("data", onData);
    const timer = setTimeout(() => { child.stdout.off("data", onData); reject(new Error(`timeout ${method}`)); }, 8000);
    child.stdout.on("data", () => {}); // keep stream flowing
    const done = resolve; resolve = (m) => { clearTimeout(timer); done(m); };
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

test("stdio: allowlisted server lists only matching tools and refuses hidden ones", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    // Child must NOT inherit SIMPLEMDM_TEST_MODE — that flag skips the stdio transport.
    env: { ...process.env, SIMPLEMDM_TEST_MODE: undefined, SIMPLEMDM_API_KEY: "k", SIMPLEMDM_TOOL_ALLOWLIST: "check_for_update,get_fleet_summary" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = ""; child.stderr.on("data", (c) => { stderr += c; });
  try {
    await rpc(child, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    const list = await rpc(child, 2, "tools/list", {});
    assert.deepEqual(list.result.tools.map(t => t.name).sort(), ["check_for_update", "get_fleet_summary"]);
    const call = await rpc(child, 3, "tools/call", { name: "get_device", arguments: { device_id: "1" } });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /not exposed/);
    assert.match(stderr, /exposing 2 of \d+ tools/);
  } finally {
    child.kill("SIGTERM"); await new Promise((r) => child.once("exit", r));
  }
});
