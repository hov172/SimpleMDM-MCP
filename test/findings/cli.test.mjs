import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.MUNKIREPORT_BASE_URL = "https://munkireport.example.edu";

const rich = [];
let fetchImpl = async (url, opts) => {
  rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
};
globalThis.fetch = (...args) => fetchImpl(...args);

const { runCli } = await import("../../dist/reports/cli.js");
const { computeManifestDrift } = await import("../../dist/findings/cli.js");
const { TOOL_MANIFEST } = await import("../../dist/findings/toolManifest.js");

// Under reports/ (gitignored) rather than /tmp -- sandboxed CI environments can
// sweep /tmp mid-run, per this repo's established convention (see
// test/findings/retryQueue.test.mjs, test/reports/cli-publish.test.mjs).
const QUEUE_DIR = path.resolve("reports/.scratch/findings-cli-test-queue");
const FIXTURE_DIR = path.resolve("reports/.scratch/findings-cli-test-fixtures");

function resetEnv(overrides = {}) {
  delete process.env.MUNKIREPORT_ENABLED;
  delete process.env.MCP_PUBLISH_MODE;
  delete process.env.MCP_PUBLISH_MIN_SEVERITY;
  delete process.env.MCP_PUBLISH_INVENTORY_TOOLS;
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
  Object.assign(process.env, overrides);
}

async function resetQueueDir() {
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
}

function logSink() {
  const lines = [];
  return { lines, log: (m) => lines.push(m) };
}

test.before(async () => {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
});

test.afterEach(async () => {
  await resetQueueDir();
  rich.length = 0;
  fetchImpl = async (url, opts) => {
    rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
  };
});

test.after(async () => {
  await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
});

// ── findings status ──────────────────────────────────────────────────────────

test("findings status without queueDir prints config, no queue lines", async () => {
  resetEnv({ MUNKIREPORT_ENABLED: "true", MCP_PUBLISH_MODE: "auto" });
  const { lines, log } = logSink();
  const result = await runCli(["findings", "status"], { log });
  assert.equal(result.outDir, "");
  assert.ok(lines.some((l) => /mode:\s+auto/.test(l)));
  assert.ok(lines.some((l) => /queueDir:\s+\(unset/.test(l)));
  assert.ok(!lines.some((l) => /queued files/.test(l)));
});

test("findings status with queueDir set reports queued file count and oldest timestamp", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  await fs.writeFile(path.join(QUEUE_DIR, "1000-aaa.json"), JSON.stringify({ route: "/x", body: {} }));
  await fs.writeFile(path.join(QUEUE_DIR, "2000-bbb.json"), JSON.stringify({ route: "/x", body: {} }));
  const { lines, log } = logSink();
  await runCli(["findings", "status"], { log });
  assert.ok(lines.some((l) => /queued files:\s+2/.test(l)));
  assert.ok(lines.some((l) => l.includes(new Date(1000).toISOString())), `expected oldest timestamp in: ${lines.join(" | ")}`);
});

// ── findings retry ───────────────────────────────────────────────────────────

test("findings retry with MCP_FINDINGS_QUEUE_DIR unset reports nothing to retry (not an error)", async () => {
  resetEnv();
  const { lines, log } = logSink();
  await assert.doesNotReject(() => runCli(["findings", "retry"], { log }));
  assert.ok(lines.some((l) => /nothing to retry/i.test(l)));
});

test("findings retry against an empty/nonexistent queue dir reports all-zero counts", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await resetQueueDir();
  const { lines, log } = logSink();
  await runCli(["findings", "retry"], { log });
  assert.ok(lines.some((l) => /attempted=0 succeeded=0 failed=0/.test(l)));
});

test("findings retry drains a queued file via a stubbed succeeding ingest", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  const { enqueue } = await import("../../dist/findings/retryQueue.js");
  await enqueue({ route: "/ingest_mcp_findings", body: { source: "mcp_auto_test", findings: [] } });
  const { lines, log } = logSink();
  await runCli(["findings", "retry"], { log });
  assert.ok(lines.some((l) => /attempted=1 succeeded=1 failed=0/.test(l)));
  const remaining = await fs.readdir(QUEUE_DIR).catch(() => []);
  assert.equal(remaining.length, 0);
});

test("findings retry reports a failed drain when munkiReportIngest fails", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  const { enqueue } = await import("../../dist/findings/retryQueue.js");
  await enqueue({ route: "/ingest_mcp_findings", body: { source: "mcp_auto_test", findings: [] } });
  fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom", headers: new Headers() });
  const { lines, log } = logSink();
  await runCli(["findings", "retry"], { log });
  assert.ok(lines.some((l) => /attempted=1 succeeded=0 failed=1/.test(l)));
  const remaining = await fs.readdir(QUEUE_DIR).catch(() => []);
  assert.equal(remaining.length, 1, "failed retry must leave the file queued");
});

// ── findings dry-run ─────────────────────────────────────────────────────────

test("findings dry-run with a valid fixture prints the expected findings", async () => {
  resetEnv();
  const fixturePath = path.join(FIXTURE_DIR, "stale-devices.json");
  await fs.writeFile(fixturePath, JSON.stringify({
    devices: [
      { serial: "C02AAA111", name: "Alice's Mac", days_since: 20 },
      { serial: "C02BBB222", name: "Bob's Mac", days_since: 45 },
    ],
  }));
  const { lines, log } = logSink();
  await runCli(["findings", "dry-run", "get_stale_devices", "--fixture", fixturePath], { log });
  assert.ok(lines.some((l) => /would publish 2 finding\(s\)/.test(l)));
  assert.ok(lines.some((l) => l.includes("stale_device") && l.includes("Alice's Mac has not checked in for 20 days")));
});

test("findings dry-run on an unknown tool name errors clearly", async () => {
  resetEnv();
  const { log } = logSink();
  await assert.rejects(
    () => runCli(["findings", "dry-run", "not_a_real_tool", "--fixture", path.join(FIXTURE_DIR, "missing.json")], { log }),
    /unknown tool/i,
  );
});

test("findings dry-run on a tool with no adapters errors clearly", async () => {
  resetEnv();
  const { log } = logSink();
  await assert.rejects(
    () => runCli(["findings", "dry-run", "lock_device", "--fixture", path.join(FIXTURE_DIR, "missing.json")], { log }),
    /no findings adapters/i,
  );
});

test("findings dry-run with a missing fixture file errors clearly", async () => {
  resetEnv();
  const { log } = logSink();
  await assert.rejects(
    () => runCli(["findings", "dry-run", "get_stale_devices", "--fixture", path.join(FIXTURE_DIR, "does-not-exist.json")], { log }),
    /could not read fixture/i,
  );
});

test("findings dry-run with an unparseable fixture file errors clearly", async () => {
  resetEnv();
  const fixturePath = path.join(FIXTURE_DIR, "bad.json");
  await fs.writeFile(fixturePath, "{ not valid json");
  const { log } = logSink();
  await assert.rejects(
    () => runCli(["findings", "dry-run", "get_stale_devices", "--fixture", fixturePath], { log }),
    /not valid JSON/i,
  );
});

// ── findings validate ────────────────────────────────────────────────────────

test("findings validate against the real current manifest is clean (exit 0)", async () => {
  resetEnv();
  const { lines, log } = logSink();
  await assert.doesNotReject(() => runCli(["findings", "validate"], { log }));
  assert.ok(lines.some((l) => /manifest is in sync/i.test(l)));
});

test("computeManifestDrift detects a registered tool missing its manifest entry", () => {
  // Test the diff-computation function directly rather than the full CLI
  // process -- cleaner than mutating the real TOOL_MANIFEST/TOOLS module state
  // for a single assertion, and this is the same logic runFindingsCli's
  // "validate" branch calls.
  const registered = Object.keys(TOOL_MANIFEST);
  const manifest = { ...TOOL_MANIFEST };
  delete manifest["lock_device"];
  const drift = computeManifestDrift(registered, manifest);
  assert.deepStrictEqual(drift.missing, ["lock_device"]);
  assert.deepStrictEqual(drift.stale, []);
});

test("computeManifestDrift detects a stale manifest entry for a tool no longer registered", () => {
  const registered = Object.keys(TOOL_MANIFEST).filter((n) => n !== "lock_device");
  const drift = computeManifestDrift(registered, TOOL_MANIFEST);
  assert.deepStrictEqual(drift.missing, []);
  assert.deepStrictEqual(drift.stale, ["lock_device"]);
});

test("computeManifestDrift reports no drift for identical registered/manifest sets", () => {
  const names = Object.keys(TOOL_MANIFEST);
  const drift = computeManifestDrift(names, TOOL_MANIFEST);
  assert.deepStrictEqual(drift, { missing: [], stale: [] });
});
