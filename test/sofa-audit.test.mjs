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

import { buildMajorTables } from "../scripts/lib/evaluate.mjs";
import { readFileSync } from "node:fs";
const macFeed = JSON.parse(readFileSync(new URL("./fixtures/sofa-macos.json", import.meta.url)));
const iosFeed = JSON.parse(readFileSync(new URL("./fixtures/sofa-ios.json", import.meta.url)));

test("buildMajorTables builds majors, xprotect, supported, model map", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(t.xprotectLatest, "5347");
  assert.equal(t.macOS.get(15).latest, "15.7.7");
  assert.equal(t.macOS.get(26).releases.find(r => r.ver === "26.0").exploited, 1);
  assert.deepEqual(t.supportedMacMajors, [26, 15, 14]);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  assert.equal(t.modelMaxMajor.get("iMac21,1"), 26);
  // CVE list captured with exploited flag
  const r260 = t.macOS.get(26).releases.find(r => r.ver === "26.0");
  assert.deepEqual(r260.cveList.find(c => c.id === "CVE-2025-0001"), { id: "CVE-2025-0001", exploited: true });
});

import { assessOS } from "../scripts/lib/evaluate.mjs";

test("assessOS computes behind counts and status", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const a = assessOS("26.0", "macOS", t);
  assert.equal(a.status, "outdated");
  assert.equal(a.latest, "26.5.1");
  assert.equal(a.cvesBehind, 2);
  assert.equal(a.exploitedBehind, 1);

  const cur = assessOS("26.5.1", "macOS", t);
  assert.equal(cur.status, "current");

  const eol = assessOS("13.7.8", "macOS", t);
  assert.equal(eol.status, "eol"); // major 13 not in supportedMacMajors

  const unknown = assessOS("", "macOS", t);
  assert.equal(unknown.status, "unknown");
});
