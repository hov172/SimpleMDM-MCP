// run_config_backup — disaster-recovery export of everything reproducible:
// custom profiles (downloaded mobileconfig), custom declarations (downloaded),
// scripts (content in record), assignment/device groups, custom attributes.
// A deleted hand-crafted mobileconfig is otherwise unrecoverable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const MOBILECONFIG = '<?xml version="1.0"?><plist version="1.0"><dict/></plist>';
const page = (data) => ({ ok: true, status: 200, json: async () => ({ data, has_more: false }), text: async () => "", headers: new Headers() });

globalThis.fetch = async (url) => {
  const p = new URL(url).pathname;
  if (p === "/api/v1/custom_configuration_profiles") return page([{ id: 104996, attributes: { name: "Lab WiFi / Cert!" } }]);
  if (p === "/api/v1/custom_configuration_profiles/104996/download") {
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/x-apple-aspen-config" }), text: async () => MOBILECONFIG, json: async () => ({}) };
  }
  if (p === "/api/v1/custom_declarations") return page([]);
  if (p === "/api/v1/scripts") return page([{ id: 9, attributes: { name: "fix-perms", content: "#!/bin/sh\necho ok" } }]);
  if (p === "/api/v1/assignment_groups") return page([{ id: 5, attributes: { name: "Faculty" } }]);
  if (p === "/api/v1/device_groups") return page([{ id: 92181, attributes: { name: "HLAB" } }]);
  if (p === "/api/v1/custom_attributes") return page([{ id: "asset_tag", attributes: { name: "asset_tag" } }]);
  if (p === "/api/v1/profiles") return page([{ id: 1, attributes: { name: "Native Profile" } }]);
  throw new Error(`Unhandled mock fetch: ${p}`);
};

const { handleTool } = await import("../dist/index.js");

test("run_config_backup writes downloadable content, records, and a hash manifest", async () => {
  const out = mkdtempSync(join(tmpdir(), "cfg-backup-"));
  try {
    const r = await handleTool("run_config_backup", { out_dir: out });
    assert.equal(r.out_dir, out);
    assert.equal(r.counts.custom_profiles, 1);
    assert.equal(r.counts.scripts, 1);
    assert.deepEqual(r.errors, [], "no errors expected in this run");

    const profFiles = readdirSync(join(out, "custom-profiles"));
    assert.equal(profFiles.length, 1);
    assert.match(profFiles[0], /^104996-/, "file named by id");
    assert.match(profFiles[0], /\.mobileconfig$/);
    const body = readFileSync(join(out, "custom-profiles", profFiles[0]), "utf8");
    assert.equal(body, MOBILECONFIG, "mobileconfig content must round-trip verbatim");

    assert.ok(existsSync(join(out, "scripts.json")));
    assert.match(readFileSync(join(out, "scripts.json"), "utf8"), /echo ok/, "script content preserved");
    assert.ok(existsSync(join(out, "assignment-groups.json")));
    assert.ok(existsSync(join(out, "device-groups.json")));
    assert.ok(existsSync(join(out, "custom-attributes.json")));

    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    const entry = manifest.files.find((f) => f.file.includes("104996"));
    assert.ok(entry, "manifest must list the profile file");
    const actual = createHash("sha256").update(body).digest("hex");
    assert.equal(entry.sha256, actual, "manifest hash must match disk content");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("run_config_backup records per-item download failures without aborting", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p === "/api/v1/custom_configuration_profiles/104996/download") {
      return { ok: false, status: 403, headers: new Headers(), text: async () => "no scope", json: async () => ({}) };
    }
    return prevFetch(url);
  };
  const out = mkdtempSync(join(tmpdir(), "cfg-backup-err-"));
  try {
    const r = await handleTool("run_config_backup", { out_dir: out });
    assert.equal(r.errors.length, 1, "the failed download must be recorded");
    assert.match(r.errors[0].error, /403/);
    assert.ok(existsSync(join(out, "scripts.json")), "rest of the backup still completes");
    assert.equal(r.partial, true);
  } finally { rmSync(out, { recursive: true, force: true }); globalThis.fetch = prevFetch; }
});
