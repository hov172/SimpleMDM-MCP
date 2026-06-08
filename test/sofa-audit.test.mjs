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
  assert.equal(t.macOS.get(26).releases.find(r => r.ver === "26.5.1").exploited, 1);
  assert.deepEqual(t.supportedMacMajors, [26, 15, 14]);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  assert.equal(t.modelMaxMajor.get("iMac21,1"), 26);
  // CVE list captured with exploited flag (CVEs are fixed in the latest release)
  const r2651 = t.macOS.get(26).releases.find(r => r.ver === "26.5.1");
  assert.deepEqual(r2651.cveList.find(c => c.id === "CVE-2025-0001"), { id: "CVE-2025-0001", exploited: true });
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

import { recommendTarget } from "../scripts/lib/evaluate.mjs";

test("recommendTarget builds supported upgrade path", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  // Mac14,3 ceiling 26, currently 14.6.1 -> 15.7.7 -> 26.5.1
  const r1 = recommendTarget("14.6.1", "Mac14,3", t);
  assert.equal(r1.replace, false);
  assert.equal(r1.target, "26.5.1");
  assert.deepEqual(r1.path, ["14.6.1", "15.7.7", "26.5.1"]);

  // currently 26.0 -> only minor update to 26.5.1
  const r2 = recommendTarget("26.0", "Mac14,3", t);
  assert.deepEqual(r2.path, ["26.0", "26.5.1"]);

  // unknown model -> replace=false but target null, path just current
  const r3 = recommendTarget("13.0", "UnknownModel", t);
  assert.equal(r3.target, null);
});

import { evaluateDevice } from "../scripts/lib/evaluate.mjs";

test("evaluateDevice composes findings", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const d = { id: 1, name: "Mac-Behind", serial: "AAA1", model: "Mac14,3", osVersion: "26.0",
    filevault_enabled: false, firewall_enabled: false, sip_enabled: false, xprotect_version: "5345" };
  const e = evaluateDevice(d, t);
  assert.equal(e.platform, "macOS");
  assert.equal(e.osStatus, "outdated");
  assert.equal(e.filevaultOk, false);
  assert.equal(e.sipOk, false);
  assert.equal(e.firewallOk, false);
  assert.equal(e.xprotect.status, "outdated");
  assert.equal(e.failCount, 5); // OS + FV + SIP + FW + XProtect

  const ok = evaluateDevice({ id: 2, model: "Mac14,3", osVersion: "26.5.1",
    filevault_enabled: true, firewall_enabled: true, sip_enabled: true, xprotect_version: "5347" }, t);
  assert.equal(ok.failCount, 0);

  // iPad: Mac-only checks N/A, not counted as failures
  const ipad = evaluateDevice({ id: 4, model: "iPad13,1", osVersion: "26.4.2",
    filevault_enabled: null, firewall_enabled: null, sip_enabled: null, xprotect_version: null }, t);
  assert.equal(ipad.platform, "iPadOS");
  assert.equal(ipad.filevaultOk, true); // N/A treated as not-a-failure off-platform
});

test("evaluateDevice: current non-Mac has no upgrade target", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ipadCurrent = evaluateDevice({ id: 9, model: "iPad13,1", osVersion: "26.5.1" }, t);
  assert.equal(ipadCurrent.recommended.target, null);
});

import { aggregateCveDetail, summarize } from "../scripts/lib/evaluate.mjs";
const devices = JSON.parse(readFileSync(new URL("./fixtures/devices.json", import.meta.url)));

test("aggregateCveDetail lists CVEs with exposure counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const rows = aggregateCveDetail(devices.map(d => evaluateDevice(d, t)), t);
  const c = rows.find(r => r.cve_id === "CVE-2025-0001");
  assert.equal(c.actively_exploited, true);
  assert.equal(c.fixed_in_version, "26.5.1");
  assert.equal(c.os_track, "macOS");
  // CVE-2025-0001 is fixed in 26.5.1; device id 1 on 26.0 (< 26.5.1) is still exposed.
  assert.equal(c.devices_still_exposed, 1);
});

test("summarize produces headline counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const s = summarize(ev, aggregateCveDetail(ev, t));
  assert.equal(s.total, 4);
  // not on newest-for-hardware: id1(26.0), id3(13.7.8->can run 26), id4(iPad 26.4.2) = 3; id2 on 26.5.1 = current
  assert.equal(s.osOutdated, 3);
  // all devices without FileVault enabled: id1(false), id3(false), id4(null) = 3; id2(true) has it
  assert.equal(s.noFileVault, 3);
  assert.equal(typeof s.noSip, "number");
  assert.equal(typeof s.noFirewall, "number");
  // devices with >=1 unfixed CVE: only id1 (26.0 behind 26.5.1)
  assert.equal(s.unfixedCves, 1);
});

import { toCsv, securityRows, allDeviceRows, cveRows } from "../scripts/lib/render.mjs";

test("toCsv escapes and joins", () => {
  const csv = toCsv([["a", "b"]], [{ a: "x,y", b: 'q"z' }]);
  assert.equal(csv, 'a,b\r\n"x,y","q""z"');
});

test("section row builders return arrays of objects", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  assert.ok(securityRows(ev).length >= 1);
  assert.equal(allDeviceRows(ev).length, 4);
  assert.ok(cveRows(aggregateCveDetail(ev, t)).length >= 1);
});

import { renderMarkdown, vulnerabilityRows } from "../scripts/lib/render.mjs";

test("renderMarkdown produces all four sections + CVE detail", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const md = renderMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev, aggregateCveDetail(ev, t)), t, "2026-06-07");
  assert.match(md, /## Security Report/);
  assert.match(md, /## Vulnerability Check/);
  assert.match(md, /## Need Updates/);
  assert.match(md, /## All Devices/);
  assert.match(md, /CVE-2025-0001/);          // CVE detail present
  assert.match(md, /🔴/);                      // exploited marker present
});

test("vulnerabilityRows lists releases with unfixed-to-latest", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const rows = vulnerabilityRows(t, ev);
  const r260 = rows.find(r => r.version === "26.0" && r.track === "macOS");
  assert.equal(r260.unfixed_to_latest, 2); // 26.5.1 fixes 2 CVEs newer than 26.0
});

test("modelMaxMajor comes from SOFA Models; evaluateDevice exposes latestMinor/latestMajor", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  // Mac on 26.0, model max major 26 -> latestMinor & latestMajor both 26.5.1
  const e = evaluateDevice({ id: 1, model: "Mac14,3", osVersion: "26.0" }, t);
  assert.equal(e.latestMinor, "26.5.1");
  assert.equal(e.latestMajor, "26.5.1");
});

test("EOL-major device still gets an unfixed-CVE count (not null)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  // Ventura 13 is in the feed but not actively supported -> status eol, count computed.
  const e = evaluateDevice({ id: 3, model: "iMac21,1", osVersion: "13.7.8" }, t);
  assert.equal(e.osStatus, "eol");
  assert.equal(typeof e.cvesBehind, "number"); // computed, not null
});

import { deviceCveRows } from "../scripts/lib/evaluate.mjs";

test("deviceCveRows groups each device's missing CVEs into ONE multi-line row", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const rows = deviceCveRows(ev, t);
  // device id 1 (serial AAA1) on 26.0 -> a single row, not one per CVE
  const aaa1 = rows.filter(r => r.serial === "AAA1");
  assert.equal(aaa1.length, 1);
  assert.equal(aaa1[0].unfixed_count, 2);
  assert.equal(aaa1[0].exploited_count, 1);
  assert.match(aaa1[0].cves, /CVE-2025-0001/);
  assert.match(aaa1[0].cves, /🔴/);   // exploited CVE marked
  assert.match(aaa1[0].cves, /\n/);    // multiple CVEs on separate lines in one cell
  // current device id 2 (serial BBB2) on 26.5.1 -> no row
  assert.equal(rows.filter(r => r.serial === "BBB2").length, 0);
  // EOL device id 3 (serial CCC3, macOS 13) not enumerable -> no row
  assert.equal(rows.filter(r => r.serial === "CCC3").length, 0);
});
