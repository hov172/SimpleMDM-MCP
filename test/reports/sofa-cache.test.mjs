// SOFA cache resilience — a truncated/corrupt cache file or a schema-changed
// feed must not brick every --with-security report for 24h, and writes must be
// atomic so a crash can't leave a half-written cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const GOOD_FEED = { OSVersions: [{ Latest: { ProductVersion: "15.6" }, SecurityReleases: [] }] };
let fetchBody = GOOD_FEED;
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return { ok: true, status: 200, json: async () => fetchBody };
};

const { loadSofa } = await import("../../scripts/lib/sofa.mjs");

test("corrupt fresh cache falls back to a refetch instead of throwing SyntaxError", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sofa-corrupt-"));
  try {
    writeFileSync(join(dir, "sofa-macos.json"), '{"OSVersions": [{"trunc');   // fresh mtime, corrupt
    writeFileSync(join(dir, "sofa-ios.json"), JSON.stringify(GOOD_FEED));
    fetchBody = GOOD_FEED; fetchCalls = 0;
    const { macFeed } = await loadSofa(dir);
    assert.deepEqual(macFeed, GOOD_FEED, "must recover by refetching");
    assert.ok(fetchCalls >= 1, "must have fetched to replace the corrupt cache");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fetched feed without OSVersions is rejected, not cached as truth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sofa-shape-"));
  try {
    fetchBody = { unexpected: "shape" };
    await assert.rejects(() => loadSofa(dir), /OSVersions/,
      "an empty/reshaped feed must fail loudly, not silently report every device untracked");
    assert.ok(!existsSync(join(dir, "sofa-macos.json")), "bad feed must not be cached");
  } finally { rmSync(dir, { recursive: true, force: true }); fetchBody = GOOD_FEED; }
});

test("cache writes are atomic (no .tmp remnant, file parseable)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sofa-atomic-"));
  try {
    fetchBody = GOOD_FEED;
    await loadSofa(dir);
    assert.ok(existsSync(join(dir, "sofa-macos.json")));
    assert.ok(!existsSync(join(dir, "sofa-macos.json.tmp")), "temp file must be renamed away");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
