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
