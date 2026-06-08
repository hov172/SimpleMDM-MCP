import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions } from "../scripts/lib/evaluate.mjs";

test("parseVersion splits dotted version into integers", () => {
  assert.deepEqual(parseVersion("15.6.1"), [15, 6, 1]);
  assert.deepEqual(parseVersion("26.0"), [26, 0]);
  assert.deepEqual(parseVersion(""), [0]);
});

test("compareVersions orders versions", () => {
  assert.equal(compareVersions("15.7.7", "15.6.1"), 1);
  assert.equal(compareVersions("15.6.1", "15.7.7"), -1);
  assert.equal(compareVersions("26.0", "26.0"), 0);
  assert.equal(compareVersions("15.7", "15.7.1"), -1);
});
