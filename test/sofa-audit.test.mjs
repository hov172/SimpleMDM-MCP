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

import { detectPlatform } from "../scripts/lib/evaluate.mjs";

test("detectPlatform maps model identifiers", () => {
  assert.equal(detectPlatform({ model: "Mac14,3" }), "macOS");
  assert.equal(detectPlatform({ model: "MacBookPro18,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iMac21,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iPad13,1" }), "iPadOS");
  assert.equal(detectPlatform({ model: "iPhone15,2" }), "iOS");
  assert.equal(detectPlatform({ model: "iPod9,1" }), "iOS");
  assert.equal(detectPlatform({ model: "" }), "unknown");
});
