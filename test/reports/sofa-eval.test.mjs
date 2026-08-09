// Backfill (Task 6 coverage-diff gate): preserves the unit-level assertions that
// test/sofa-audit.test.mjs held over the SOFA evaluation domain. Those assertions
// target dist/reports/domain/sofa-eval.js (the TS port) directly and are NOT
// otherwise re-proven by the golden-parity snapshot (which only fixes the default
// rendered bytes for one fixture). renderMarkdown -> renderAuditMarkdown and
// toCsv/reportOnlyGate -> engine/csv.js are the only renamed/relocated symbols.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseVersion, compareVersions, detectPlatform, buildMajorTables, assessOS,
  recommendTarget, evaluateDevice, aggregateCveDetail, summarize,
  securityRows, allDeviceRows, cveRows, vulnerabilityRows,
  deviceCveRows, cveDeviceRows, groupBreakdownRows,
} from "../../dist/reports/domain/sofa-eval.js";
import { renderAuditMarkdown } from "../../dist/reports/domain/audit-render.js";
import { reportOnlyGate } from "../../dist/reports/engine/csv.js";

const macFeed = JSON.parse(readFileSync(new URL("../fixtures/sofa-macos.json", import.meta.url)));
const iosFeed = JSON.parse(readFileSync(new URL("../fixtures/sofa-ios.json", import.meta.url)));
const devices = JSON.parse(readFileSync(new URL("../fixtures/devices.json", import.meta.url)));

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

test("detectPlatform maps model identifiers", () => {
  assert.equal(detectPlatform({ model: "Mac14,3" }), "macOS");
  assert.equal(detectPlatform({ model: "MacBookPro18,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iMac21,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iPad13,1" }), "iPadOS");
  assert.equal(detectPlatform({ model: "iPhone15,2" }), "iOS");
  assert.equal(detectPlatform({ model: "iPod9,1" }), "iOS");
  assert.equal(detectPlatform({ model: "" }), "unknown");
});

test("buildMajorTables builds majors, xprotect, supported, model map", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(t.xprotectLatest, "5347");
  assert.equal(t.macOS.get(15).latest, "15.7.7");
  assert.equal(t.macOS.get(26).releases.find(r => r.ver === "26.5.1").exploited, 1);
  assert.deepEqual(t.supportedMacMajors, [26, 15, 14]);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  assert.equal(t.modelMaxMajor.get("iMac21,1"), 26);
  const r2651 = t.macOS.get(26).releases.find(r => r.ver === "26.5.1");
  assert.deepEqual(r2651.cveList.find(c => c.id === "CVE-2025-0001"), { id: "CVE-2025-0001", exploited: true });
});

test("assessOS computes behind counts and status", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const a = assessOS("26.0", "macOS", t);
  assert.equal(a.status, "outdated");
  assert.equal(a.latest, "26.5.1");
  assert.equal(a.cvesBehind, 2);
  assert.equal(a.exploitedBehind, 1);
  assert.equal(assessOS("26.5.1", "macOS", t).status, "current");
  assert.equal(assessOS("13.7.8", "macOS", t).status, "eol");
  assert.equal(assessOS("", "macOS", t).status, "unknown");
});

test("recommendTarget builds supported upgrade path", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const r1 = recommendTarget("14.6.1", "Mac14,3", t);
  assert.equal(r1.replace, false);
  assert.equal(r1.target, "26.5.1");
  assert.deepEqual(r1.path, ["14.6.1", "15.7.7", "26.5.1"]);
  assert.deepEqual(recommendTarget("26.0", "Mac14,3", t).path, ["26.0", "26.5.1"]);
  assert.equal(recommendTarget("13.0", "UnknownModel", t).target, null);
});

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
  assert.equal(e.failCount, 5);
  const ok = evaluateDevice({ id: 2, model: "Mac14,3", osVersion: "26.5.1",
    filevault_enabled: true, firewall_enabled: true, sip_enabled: true, xprotect_version: "5347" }, t);
  assert.equal(ok.failCount, 0);
  const ipad = evaluateDevice({ id: 4, model: "iPad13,1", osVersion: "26.4.2",
    filevault_enabled: null, firewall_enabled: null, sip_enabled: null, xprotect_version: null }, t);
  assert.equal(ipad.platform, "iPadOS");
  assert.equal(ipad.filevaultOk, true);
});

test("evaluateDevice: current non-Mac has no upgrade target", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(evaluateDevice({ id: 9, model: "iPad13,1", osVersion: "26.5.1" }, t).recommended.target, null);
});

test("aggregateCveDetail lists CVEs with exposure counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const rows = aggregateCveDetail(devices.map(d => evaluateDevice(d, t)), t);
  const c = rows.find(r => r.cve_id === "CVE-2025-0001");
  assert.equal(c.actively_exploited, true);
  assert.equal(c.fixed_in_version, "26.5.1");
  assert.equal(c.os_track, "macOS");
  assert.equal(c.devices_still_exposed, 1);
});

test("summarize produces headline counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const s = summarize(ev, aggregateCveDetail(ev, t));
  assert.equal(s.total, 4);
  assert.equal(s.osOutdated, 3);
  // Two of the three Macs lack FileVault. The iPad is NOT counted: it cannot run
  // FileVault, so counting it inflates the headline. (Was 3 back when noFileVault
  // counted every platform while noSip/noFirewall counted Macs only.)
  assert.equal(s.noFileVault, 2);
  assert.equal(typeof s.noSip, "number");
  assert.equal(typeof s.noFirewall, "number");
  assert.equal(s.unfixedCves, 1);
  assert.equal(s.xprotectCollected, true);
});

test("FileVault counts are Mac-only, and the summary agrees with the per-device rows", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  // One Mac without FileVault, plus three devices that cannot run it at all.
  const ev = [
    evaluateDevice({ id: 1, model: "Mac14,3", osVersion: "26.0", filevault_enabled: false }, t),
    evaluateDevice({ id: 2, model: "iPad13,1", osVersion: "26.4.2" }, t),
    evaluateDevice({ id: 3, model: "iPhone15,2", osVersion: "26.4.2" }, t),
    evaluateDevice({ id: 4, model: "iPod9,1", osVersion: "15.8" }, t),
  ];
  assert.equal(summarize(ev).noFileVault, 1);

  // The per-device rows must not contradict that headline. A non-Mac previously
  // rendered fv="on", which reads as "encrypted" for the very devices the summary
  // was at the same time counting as unencrypted.
  const rows = allDeviceRows(ev);
  assert.equal(rows[0].fv, "off");
  for (const r of rows.slice(1)) {
    assert.equal(r.fv, "N/A");
    assert.equal(r.sip, "N/A");
    assert.equal(r.fw, "N/A");
  }
});

test("group breakdown counts FileVault on Macs only", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [
    evaluateDevice({ id: 1, model: "Mac14,3", osVersion: "26.0", filevault_enabled: false, device_group: "Lab" }, t),
    evaluateDevice({ id: 2, model: "iPad13,1", osVersion: "26.4.2", device_group: "Lab" }, t),
  ];
  const lab = groupBreakdownRows(ev).find((r) => r.device_group === "Lab");
  assert.equal(lab.devices, 2);
  assert.equal(lab.no_filevault, 1);
});

test("xprotectCollected is false when no device reports xprotect_version", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [
    evaluateDevice({ id: 1, model: "Mac14,3", osVersion: "26.0" }, t),
    evaluateDevice({ id: 2, model: "Mac14,3", osVersion: "26.5.1" }, t),
  ];
  const s = summarize(ev);
  assert.equal(s.xprotectCollected, false);
  assert.equal(allDeviceRows(ev)[0].xp, "N/A");
});

test("section row builders return arrays of objects", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  assert.ok(securityRows(ev).length >= 1);
  assert.equal(allDeviceRows(ev).length, 4);
  assert.ok(cveRows(aggregateCveDetail(ev, t)).length >= 1);
});

test("renderAuditMarkdown produces all four sections + CVE detail", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const md = renderAuditMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev, aggregateCveDetail(ev, t)), t, "2026-06-07");
  assert.match(md, /## Security Report/);
  assert.match(md, /## Vulnerability Check/);
  assert.match(md, /## Need Updates/);
  assert.match(md, /## All Devices/);
  assert.match(md, /\| version \| date \| cves_fixed \| actively_exploited \|/);
});

test("vulnerabilityRows lists releases with unfixed-to-latest", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const r260 = vulnerabilityRows(t, ev).find(r => r.version === "26.0" && r.track === "macOS");
  assert.equal(r260.unfixed_to_latest, 2);
});

test("vulnerabilityRows unscoped keeps the full catalog (both tracks)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [evaluateDevice({ id: 1, model: "iMac21,1", osVersion: "26.0" }, t)];
  const rows = vulnerabilityRows(t, ev);
  assert.ok(rows.some(r => r.track === "iOS/iPadOS"));
  assert.ok(rows.some(r => r.track === "macOS" && parseVersion(r.version)[0] !== 26));
});

test("vulnerabilityRows scoped shows only tracks/majors in-scope devices are on", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [evaluateDevice({ id: 1, model: "iMac21,1", osVersion: "26.0" }, t)];
  const rows = vulnerabilityRows(t, ev, { scoped: true });
  assert.ok(rows.length > 1);
  assert.ok(rows.every(r => r.track === "macOS"));
  assert.ok(rows.every(r => parseVersion(r.version)[0] === 26));
  assert.ok(rows.some(r => r.version === "26.0" && r.devices_on_release === 1));
});

test("renderAuditMarkdown scoped drops the empty iOS/iPadOS Vulnerability Check table", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [evaluateDevice({ id: 1, model: "iMac21,1", osVersion: "26.0" }, t)];
  const md = renderAuditMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev, aggregateCveDetail(ev, t)), t, "2026-06-07", { scoped: true });
  const vulnSection = md.slice(md.indexOf("## Vulnerability Check"), md.indexOf("## Need Updates"));
  assert.doesNotMatch(vulnSection, /### iOS\/iPadOS/);
  assert.match(vulnSection, /### macOS/);
});

test("modelMaxMajor comes from SOFA Models; evaluateDevice exposes latestMinor/latestMajor", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  const e = evaluateDevice({ id: 1, model: "Mac14,3", osVersion: "26.0" }, t);
  assert.equal(e.latestMinor, "26.5.1");
  assert.equal(e.latestMajor, "26.5.1");
});

test("EOL-major device still gets an unfixed-CVE count (not null)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const e = evaluateDevice({ id: 3, model: "iMac21,1", osVersion: "13.7.8" }, t);
  assert.equal(e.osStatus, "eol");
  assert.equal(typeof e.cvesBehind, "number");
});

test("deviceCveRows groups each device's missing CVEs into ONE multi-line row", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const rows = deviceCveRows(ev, t);
  const aaa1 = rows.filter(r => r.serial === "AAA1");
  assert.equal(aaa1.length, 1);
  assert.equal(aaa1[0].unfixed_count, 2);
  assert.equal(aaa1[0].exploited_count, 1);
  assert.match(aaa1[0].cves, /CVE-2025-0001/);
  assert.match(aaa1[0].cves, /\[exploited\]/);
  assert.match(aaa1[0].cves, /\n/);
  assert.equal(rows.filter(r => r.serial === "BBB2").length, 0);
  assert.equal(rows.filter(r => r.serial === "CCC3").length, 0);
});

test("cveDeviceRows lists affected devices per CVE (inverse of device-cves)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const rows = cveDeviceRows(ev, t);
  const c = rows.find(r => r.cve_id === "CVE-2025-0001");
  assert.equal(c.os_track, "macOS");
  assert.equal(c.actively_exploited, true);
  assert.equal(c.devices_exposed, 1);
  assert.match(c.devices, /AAA1/);
  assert.equal(rows.every(r => r.devices_exposed > 0), true);
});

test("device group surfaces per-row and in the per-group rollup", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [
    evaluateDevice({ id: 1, model: "Mac14,3", serial: "S1", osVersion: "26.0", device_group: "Lab A", filevault_enabled: false }, t),
    evaluateDevice({ id: 2, model: "Mac14,3", osVersion: "26.5.1", device_group: "Lab A", filevault_enabled: true }, t),
    evaluateDevice({ id: 3, model: "iMac21,1", osVersion: "13.7.8", device_group: "Lab B" }, t),
  ];
  assert.equal(allDeviceRows(ev)[0].device_group, "Lab A");
  assert.equal(deviceCveRows(ev, t).find((r) => r.serial === "S1").device_group, "Lab A");
  const g = groupBreakdownRows(ev);
  const labA = g.find((r) => r.device_group === "Lab A");
  assert.equal(labA.devices, 2);
  assert.equal(labA.no_filevault, 1);
  assert.equal(g[0].device_group, "Lab A");
});

test("reportOnlyGate: data CSVs gated by --report-only; csv format conflicts", () => {
  assert.deepEqual(reportOnlyGate("all", false), { writeData: true, error: null });
  assert.deepEqual(reportOnlyGate("md", true), { writeData: false, error: null });
  assert.deepEqual(reportOnlyGate("csv", false), { writeData: true, error: null });
  const conflict = reportOnlyGate("csv", true);
  assert.equal(conflict.writeData, false);
  assert.match(conflict.error, /--report-only/);
});

test("renderAuditMarkdown escapes pipes in device names (md table integrity)", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = [evaluateDevice({ id: 1, name: "Loaner | Library iPad", model: "Mac14,3", osVersion: "26.0" }, t)];
  const md = renderAuditMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev), t, "2026-06-07");
  assert.match(md, /Loaner \\\| Library iPad/, "device-name pipes must be escaped in md tables");
});
