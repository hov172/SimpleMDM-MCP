// Report paths must resolve against the install root, not process.cwd() —
// desktop MCP clients launch servers with cwd "/" (or "~"), which made the
// run_* tools try to write /reports/... on source installs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const page = (data) => ({ ok: true, status: 200, json: async () => ({ data, has_more: false }), text: async () => "", headers: new Headers() });
globalThis.fetch = async (url) => {
  const p = new URL(url).pathname;
  if (p === "/api/v1/custom_configuration_profiles") return page([]);
  if (p === "/api/v1/custom_declarations") return page([]);
  if (p === "/api/v1/scripts") return page([]);
  if (p === "/api/v1/assignment_groups") return page([]);
  if (p === "/api/v1/device_groups") return page([]);
  if (p === "/api/v1/custom_attributes") return page([]);
  if (p === "/api/v1/profiles") return page([]);
  throw new Error(`Unhandled mock fetch: ${p}`);
};

const { handleTool } = await import("../dist/index.js");

test("run_config_backup default dir lands under the install root even with a foreign cwd", async () => {
  const foreignCwd = mkdtempSync(join(tmpdir(), "foreign-cwd-"));
  const origCwd = process.cwd();
  process.chdir(foreignCwd);
  try {
    const r = await handleTool("run_config_backup", {});
    assert.ok(r.out_dir.startsWith(join(REPO_ROOT, "reports")),
      `default out_dir must resolve under <install>/reports, got: ${r.out_dir}`);
    assert.ok(existsSync(join(r.out_dir, "manifest.json")));
    assert.ok(!existsSync(join(foreignCwd, "reports")), "nothing may be written relative to the foreign cwd");
    rmSync(r.out_dir, { recursive: true, force: true });
  } finally { process.chdir(origCwd); rmSync(foreignCwd, { recursive: true, force: true }); }
});

test("run_report_diff resolves reports/ against the install root, not cwd", async () => {
  const HEAD = "name,serial,os_version";
  const a = join(REPO_ROOT, "reports", ".pathres-a");
  const b = join(REPO_ROOT, "reports", ".pathres-b");
  for (const d of [a, b]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "devices.csv"), HEAD + "\r\nX,S1,15.5\r\n");
  }
  const foreignCwd = mkdtempSync(join(tmpdir(), "foreign-cwd2-"));
  const origCwd = process.cwd();
  process.chdir(foreignCwd);
  try {
    const r = await handleTool("run_report_diff", { before_dir: "reports/.pathres-a", after_dir: "reports/.pathres-b" });
    assert.equal(r.changed.length, 0, "identical runs diff clean — proves the dirs were found under the install root");
  } finally {
    process.chdir(origCwd);
    rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true });
    rmSync(foreignCwd, { recursive: true, force: true });
  }
});
