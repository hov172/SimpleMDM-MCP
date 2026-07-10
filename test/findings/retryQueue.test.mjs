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

const { enqueue, drainQueue } = await import("../../dist/findings/retryQueue.js");

// Under reports/ (gitignored, same shape the CLI writes to in production) rather
// than /tmp -- sandboxed CI environments can sweep /tmp mid-run, per this repo's
// established convention (see test/reports/cli-publish.test.mjs).
const QUEUE_DIR = path.resolve("reports/.scratch/retry-queue-test");

async function resetQueueDir() {
  await fs.rm(QUEUE_DIR, { recursive: true, force: true });
}

function resetEnv(overrides = {}) {
  delete process.env.MCP_FINDINGS_QUEUE_DIR;
  Object.assign(process.env, overrides);
}

async function listQueueFiles() {
  try {
    return await fs.readdir(QUEUE_DIR);
  } catch {
    return [];
  }
}

test.afterEach(async () => {
  await resetQueueDir();
  rich.length = 0;
  fetchImpl = async (url, opts) => {
    rich.push({ url: String(url), method: opts?.method ?? "GET", body: opts?.body });
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
  };
});

test("enqueue writes a JSON file to the configured queue dir", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await enqueue({ route: "/ingest_mcp_findings", body: { source: "mcp_auto_test", findings: [] } });
  const files = await listQueueFiles();
  assert.equal(files.length, 1);
  assert.match(files[0], /\.json$/);
  const contents = JSON.parse(await fs.readFile(path.join(QUEUE_DIR, files[0]), "utf8"));
  assert.equal(contents.route, "/ingest_mcp_findings");
  assert.equal(contents.body.source, "mcp_auto_test");
});

test("enqueue is a no-op (does not throw, does not create a dir) when MCP_FINDINGS_QUEUE_DIR is unset", async () => {
  resetEnv();
  await assert.doesNotReject(() => enqueue({ route: "/ingest_mcp_findings", body: { a: 1 } }));
  await assert.rejects(() => fs.access(QUEUE_DIR));
});

test("drainQueue with a stubbed succeeding ingest empties the dir and returns correct counts", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 1 } });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 2 } });
  assert.equal((await listQueueFiles()).length, 2);

  const result = await drainQueue();
  assert.deepStrictEqual(result, { attempted: 2, succeeded: 2, failed: 0 });
  assert.equal((await listQueueFiles()).length, 0);
});

test("drainQueue with a stubbed failing ingest leaves files in place and reports them as failed", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 1 } });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 2 } });

  fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom", headers: new Headers() });

  const logs = [];
  const result = await drainQueue((m) => logs.push(m));
  assert.deepStrictEqual(result, { attempted: 2, succeeded: 0, failed: 2 });
  assert.equal((await listQueueFiles()).length, 2, "failed retries must leave files in place");
  assert.ok(logs.some((l) => /retry failed/i.test(l)));
});

test("drainQueue with a mix of succeeding/failing calls processes all files and reports accurate counts", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 1 } });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 2 } });
  await enqueue({ route: "/ingest_mcp_findings", body: { n: 3 } });

  // Decide success/failure by the payload's own `n` field (not by call count):
  // fetchWithRetry retries a single 500 response several times internally with
  // backoff before giving up, so counting raw fetch invocations would conflate
  // "one queued item's retries" with "which queued item this is."
  fetchImpl = async (url, opts) => {
    const { n } = JSON.parse(opts.body);
    if (n === 2) return { ok: false, status: 500, text: async () => "boom", headers: new Headers() };
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "", headers: new Headers() };
  };

  const result = await drainQueue();
  assert.equal(result.attempted, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal((await listQueueFiles()).length, 1, "only the failed retry should remain queued");
});

test("drainQueue with MCP_FINDINGS_QUEUE_DIR unset is a no-op returning all-zero counts", async () => {
  resetEnv();
  const result = await drainQueue();
  assert.deepStrictEqual(result, { attempted: 0, succeeded: 0, failed: 0 });
});

test("drainQueue against a non-existent queue dir (nothing ever enqueued) returns all-zero counts", async () => {
  resetEnv({ MCP_FINDINGS_QUEUE_DIR: QUEUE_DIR });
  await resetQueueDir(); // ensure it does not exist
  const result = await drainQueue();
  assert.deepStrictEqual(result, { attempted: 0, succeeded: 0, failed: 0 });
});
