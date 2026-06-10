import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SIMPLEMDM_API_KEY = "dummy-key";

const FIX = (n) => JSON.parse(readFileSync(new URL(`./fixtures/inventory/${n}`, import.meta.url)));
const DEVICES = FIX("devices.json");
const AG = FIX("assignment-groups.json");
const APPCAT = FIX("app-catalog.json");
const SECTIONS = FIX("device-sections.json");
const SOFA = FIX("sofa-models.json");
const DG = { data: [
  { type: "device_group", id: 9001, attributes: { name: "Faculty" } },
  { type: "device_group", id: 9002, attributes: { name: "Staff iMacs" } },
  { type: "device_group", id: 9003, attributes: { name: "Library" } } ], has_more: false };

let failApps = false;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const path = u.pathname;
  const body = (() => {
    if (u.hostname === "sofafeed.macadmins.io") return path.includes("macos") ? SOFA.mac : SOFA.ios;
    if (path === "/api/v1/devices") return DEVICES;
    if (path === "/api/v1/device_groups") return DG;
    if (path === "/api/v1/assignment_groups") return AG;
    if (path === "/api/v1/apps") return APPCAT;
    const m = path.match(/^\/api\/v1\/devices\/(\d+)\/(installed_apps|profiles|users)$/);
    if (m) {
      if (m[2] === "installed_apps" && failApps) return null; // simulate failure
      const key = m[2] === "installed_apps" ? "apps" : m[2];
      return { data: SECTIONS[m[1]][key], has_more: false };
    }
    throw new Error(`Unhandled mock fetch: ${url}`);
  })();
  if (body === null) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const { run } = await import("../scripts/inventory-report.mjs");
const SECRET = "SECRETKEY-FVR-123";

function allFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((p) => statSync(p).isFile());
}

test("engine end-to-end: search run writes secure outputs and never leaks the recovery key", async () => {
  const out = mkdtempSync(join(tmpdir(), "inv-"));
  const dir = join(out, "report");
  const code = await run(["--search", "group:faculty,staff seen:>=2025-01-01", "--format", "md", "--out", dir]);
  assert.equal(code, 0);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  const summary = readFileSync(join(dir, "summary.txt"), "utf8");
  assert.match(summary, /Devices: 2 matched/);             // Alice (Faculty) + Bob (Staff iMacs, seen 2026)
  assert.ok(!existsSync(join(dir, "raw")), "raw/ must be absent without --raw");
  for (const p of allFiles(dir)) {
    assert.equal(statSync(p).mode & 0o777, 0o600, `${p} must be 0600`);
    assert.ok(!readFileSync(p, "utf8").includes(SECRET), `${p} must not contain the recovery key`);
  }
  const manifest = readFileSync(join(dir, "manifest.sha256"), "utf8");
  assert.match(manifest, /^[0-9a-f]{64} {2}devices\.csv$/m);
  const devices = readFileSync(join(dir, "devices.csv"), "utf8");
  assert.match(devices, /C02FAC111/);
  assert.doesNotMatch(devices, /E33LAB333/);               // stale Mac mini: seen 2024, filtered out
});

test("engine: --raw writes redacted raw dumps", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "inv-")), "r");
  const code = await run(["--serial", "C02FAC111", "--format", "csv", "--raw", "--out", dir]);
  assert.equal(code, 0);
  const raw = readFileSync(join(dir, "raw", "devices.json"), "utf8");
  assert.ok(!raw.includes(SECRET));
  assert.match(raw, /\[REDACTED escrowed=yes\]/);
});

test("engine: failed app fetches → exit 2, unknown findings, sections_failed; --allow-partial → exit 0", async () => {
  failApps = true;
  try {
    const dir1 = join(mkdtempSync(join(tmpdir(), "inv-")), "p1");
    const code1 = await run(["--group", "Faculty", "--format", "csv", "--out", dir1]);
    assert.equal(code1, 2);
    assert.match(readFileSync(join(dir1, "devices.csv"), "utf8"), /apps/);          // sections_failed column
    const findings = readFileSync(join(dir1, "findings.csv"), "utf8");
    assert.match(findings, /assigned-app-missing,unknown/);
    assert.doesNotMatch(findings, /assigned-app-missing,flag/);
    const dir2 = join(mkdtempSync(join(tmpdir(), "inv-")), "p2");
    assert.equal(await run(["--group", "Faculty", "--format", "csv", "--allow-partial", "--out", dir2]), 0);
  } finally { failApps = false; }
});

test("engine: mixed-scope OR matches the out-of-group branch (Codex finding 1 end-to-end)", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "inv-")), "or");
  const code = await run(["--search", "group:library OR app:zoom", "--confirm-all", "--format", "csv", "--out", dir]);
  assert.equal(code, 0);
  const devices = readFileSync(join(dir, "devices.csv"), "utf8");
  assert.match(devices, /F44PAD444/);   // Library iPad via group branch
  assert.match(devices, /C02FAC111/);   // Alice via app:zoom branch — NOT in Library
});
