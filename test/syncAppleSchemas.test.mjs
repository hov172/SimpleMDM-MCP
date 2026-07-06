import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("sync script normalizes fixture YAML with nested keys and platform metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apple-schema-sync-"));
  const out = join(dir, "schema-cache.json");
  await execFileAsync("node", [
    "scripts/sync-apple-device-schemas.mjs",
    "--source-dir",
    "test/fixtures/apple-schemas",
    "--out",
    out,
    "--no-fallback",
  ]);
  const cache = JSON.parse(await readFile(out, "utf8"));
  assert.equal(cache.schemaVersion, 2);
  assert.equal(cache.source.mode, "local-fixtures");
  assert.equal(cache.schemas.length, 1);

  const schema = cache.schemas[0];
  assert.equal(schema.identifier, "com.example.fixture");
  assert.equal(schema.kind, "profile");
  assert.deepEqual(schema.platforms, ["iOS", "macOS"]);
  assert.match(schema.availability, /iOS 17\.0\+/);
  assert.equal(schema.supervised, true);

  const mode = schema.keys.find((key) => key.name === "Mode");
  assert.equal(mode.required, true);
  assert.deepEqual(mode.enumValues, ["Relaxed", "Strict"]);
  assert.equal(mode.default, "Strict");

  const enabled = schema.keys.find((key) => key.name === "Enabled");
  assert.equal(enabled.type, "boolean");
  assert.equal(enabled.default, true);

  const nested = schema.keys.find((key) => key.name === "Nested");
  assert.equal(nested.type, "dictionary");
  assert.ok(nested.childKeys.some((key) => key.name === "ChildRequired" && key.required));
  const items = nested.childKeys.find((key) => key.name === "Items");
  assert.equal(items.type, "array");
  assert.equal(items.itemKeys[0].name, "ItemValue");
  assert.deepEqual(items.itemKeys[0].enumValues, ["1", "2"]);
});

test("offline fallback registers the real VPN identifier, not the display name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apple-schema-vpn-"));
  const out = join(dir, "schema-cache.json");
  await execFileAsync("node", ["scripts/sync-apple-device-schemas.mjs", "--offline", "--out", out]);
  const cache = JSON.parse(await readFile(out, "utf8"));
  const ids = cache.schemas.map((s) => s.identifier);
  assert.ok(ids.includes("com.apple.vpn.managed"),
    `fallback must register com.apple.vpn.managed (got: ${ids.filter((i) => /vpn|VPN/i.test(i)).join(", ") || "none"})`);
  assert.ok(!ids.includes("VPN"), "the bare display name must not be used as an identifier");
});

test("sync refuses to shrink an existing cache without --allow-shrink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apple-schema-shrink-"));
  const out = join(dir, "schema-cache.json");
  // Simulate a healthy 50-schema cache on disk.
  const big = {
    schemaVersion: 2,
    schemas: Array.from({ length: 50 }, (_, i) => ({ kind: "profile", identifier: `com.example.s${i}`, displayName: `S${i}`, keys: [] })),
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(out, JSON.stringify(big));

  // --offline produces only the ~dozen curated fallbacks → must refuse.
  await assert.rejects(
    () => execFileAsync("node", ["scripts/sync-apple-device-schemas.mjs", "--offline", "--out", out]),
    (err) => /shrink|refus/i.test(String(err.stderr ?? err.message)),
    "a degraded run must not clobber a larger existing cache",
  );
  const still = JSON.parse(await readFile(out, "utf8"));
  assert.equal(still.schemas.length, 50, "existing cache must be untouched");

  // Explicit override proceeds.
  await execFileAsync("node", ["scripts/sync-apple-device-schemas.mjs", "--offline", "--out", out, "--allow-shrink"]);
  const after = JSON.parse(await readFile(out, "utf8"));
  assert.ok(after.schemas.length < 50, "override must write the smaller cache");
});
