import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, manifestRows, MANIFEST_COLUMNS } from "../../dist/reports/engine/manifest.js";

test("sha256 is stable and hex", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("manifestRows carries file metadata + generated timestamp", () => {
  const rows = manifestRows([{ file: "logs.csv", description: "events", record_scope: "all", data_row_count: 10, bytes: 99, sha256: "ff" }], "2026-06-20T00:00:00Z");
  assert.equal(rows[0].file, "logs.csv");
  assert.equal(rows[0].sha256, "ff");
  assert.equal(MANIFEST_COLUMNS[0].key, "file");
});

test("MANIFEST_COLUMNS header order matches golden manifest.csv", () => {
  const headerString = MANIFEST_COLUMNS.map(c => c.header).join(",");
  assert.equal(headerString, "file,description,record_scope,data_row_count,bytes,sha256,generated_at");
});
