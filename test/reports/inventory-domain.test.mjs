// Backfill (Task 6 coverage-diff gate): preserves the unit-level assertions that
// test/inventory-report.test.mjs held over the inventory domain. The legacy file
// imported the LEGACY scripts/lib/inventory.mjs + inventory-render.mjs modules;
// here every assertion is re-pointed at the TS ports (dist/reports/domain/
// inventory.js + inventory-render.js) so the behavior follows the new code once
// the legacy suite is deleted. Golden-parity only fixes the default rendered
// bytes; these prove the normalizers, row-shapers, findings and the
// flat/roster/dossier renderers across detail levels, edge inputs and sort orders.
// parseInvArgs is intentionally omitted: it has no TS-domain export and its
// validation is covered by test/reports/cli.test.mjs (the unified CLI bridge).
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventoryDossier } from "../../dist/reports/specs/inventory.js";
import {
  buildModelMap, deriveType, normalizeDevice, assignmentAppMap, profileAssignmentMap,
  normalizeApps, normalizeProfiles, normalizeUsers,
} from "../../dist/reports/domain/inventory.js";
import {
  DEVICE_COLUMNS, deviceRows, appRows, ASSIGNED_COLUMNS, assignedAppRows,
  appCatalogRows, rollupRows, byModelRows,
  inventoryFindings, FINDING_COLUMNS, renderInventoryReport,
  assignedProfileRows, ASSIGNED_PROFILE_COLUMNS, renderInventoryRoster,
  renderInventoryFlat, FLAT_COLUMNS, sortRecords,
} from "../../dist/reports/domain/inventory-render.js";

const FIX = (n) => JSON.parse(readFileSync(new URL(`../fixtures/inventory/${n}`, import.meta.url)));
const DEVICES = FIX("devices.json").data;
const AG = FIX("assignment-groups.json").data;
const SOFA = FIX("sofa-models.json");
const SECTIONS = FIX("device-sections.json");
const APPCAT = new Map(FIX("app-catalog.json").data.map((a) => [a.id, a.attributes.name]));
const PROFCAT = FIX("profiles-catalog.json").data;
const DG = new Map([[9001, "Faculty"], [9002, "Staff iMacs"], [9003, "Library"]]);
const AGN = new Map(AG.map((g) => [g.id, g.attributes.name]));
const NOW2 = Date.parse("2026-06-10T12:00:00Z");

function buildRecords() {
  const models = buildModelMap(SOFA.mac, SOFA.ios);
  const agApps = assignmentAppMap(AG, APPCAT);
  const profileAssign = profileAssignmentMap(PROFCAT);
  return DEVICES.map((d) => {
    const r = normalizeDevice(d, { dgMap: DG, agNames: AGN, agAppsByDevice: agApps, models, profileAssign });
    const sec = SECTIONS[String(d.id)];
    r.apps = normalizeApps(sec.apps); r.profiles = normalizeProfiles(sec.profiles); r.users = normalizeUsers(sec.users);
    r.sections = { apps: "ok", profiles: "ok", users: "ok" };
    r.match_reasons = ""; r.match_status = "matched"; r.hits = { apps: new Set(), profiles: new Set(), users: new Set() };
    return r;
  });
}

test("buildModelMap merges mac+ios Models and extracts the release year", () => {
  const m = buildModelMap(SOFA.mac, SOFA.ios);
  assert.equal(m.get("iMac21,1").marketing, "iMac (24-inch, M1, 2021, Four Ports)");
  assert.equal(m.get("iMac21,1").year, "2021");
  assert.equal(m.get("iPad13,4").year, "2021");
});

test("buildModelMap: legacy Apple models fill SOFA gaps; SOFA overlays when it knows the model", () => {
  const m = buildModelMap(SOFA.mac, SOFA.ios);
  assert.equal(m.get("iMac14,1").year, "2013");
  assert.equal(m.get("iMac14,2").marketing, "iMac (27-inch, Late 2013)");
  assert.equal(m.get("MacPro6,1").year, "2013");
  assert.equal(m.get("iMac21,1").marketing, "iMac (24-inch, M1, 2021, Four Ports)");
  const empty = buildModelMap(null, null);
  assert.equal(empty.get("MacBookAir7,2").year, "2015");
});

test("deriveType classifies from marketing/family name, with identifier fallback", () => {
  assert.equal(deriveType("MacBookPro18,1", "MacBook Pro (16-inch, M1 Pro, 2021)"), "laptop");
  assert.equal(deriveType("iMac21,1", "iMac"), "imac");
  assert.equal(deriveType("Macmini9,1", "Mac mini (M1, 2020)"), "desktop");
  assert.equal(deriveType("iPad13,4", ""), "ipad");
  assert.equal(deriveType("Mac14,5", ""), "mac");
  assert.equal(deriveType("AppleTV6,2", ""), "appletv");
});

test("assignmentAppMap resolves app ids to names per assignment group", () => {
  const m = assignmentAppMap(AG, APPCAT);
  assert.deepEqual(m.get(501), ["Zoom", "Google Chrome"]);
  assert.deepEqual(m.get(502), ["Pages"]);
});

test("normalizeDevice builds the full searchable record (real attribute names)", () => {
  const models = buildModelMap(SOFA.mac, SOFA.ios);
  const agApps = assignmentAppMap(AG, APPCAT);
  const r = normalizeDevice(DEVICES[0], { dgMap: DG, agNames: AGN, agAppsByDevice: agApps, models });
  assert.equal(r.serial, "C02FAC111");
  assert.equal(r.udid, "UDID-201");
  assert.equal(r.model_name, "MacBook Pro (16-inch, M1 Pro, 2021)");
  assert.equal(r.model_year, "2021");
  assert.equal(r.type, "laptop");
  assert.equal(r.arch, "Apple Silicon");
  assert.equal(r.device_group, "Faculty");
  assert.deepEqual(r.assignment_groups, ["Faculty Apps"]);
  assert.deepEqual(r.assigned_apps, ["Zoom", "Google Chrome"]);
  assert.deepEqual(r.assigned_detail, [{ app: "Zoom", group: "Faculty Apps" }, { app: "Google Chrome", group: "Faculty Apps" }]);
  assert.equal(r.battery_pct, 88);
  assert.equal(r.storage_free_gb, 512.5);
  assert.equal(r.recoverykey, true);
  assert.equal(r.ard, true);
  assert.equal(r.uamdm, true);
  assert.equal(r.ddm, true);
  assert.equal(r.activation_lock, false);
  assert.equal(r.firmware_lock, true);
  assert.equal(r.recovery_lock, true);
  assert.equal(r.passcode_present, true);
  assert.equal(r.rsr, "(a)");
  assert.equal(r.bluetooth_mac, "a4:83:e7:11:11:13");
  assert.equal(r.time_zone, "America/New_York");
  assert.ok(!JSON.stringify(r).includes("FWSECRET-999") && !JSON.stringify(r).includes("RLSECRET-888"));
  assert.equal(r.attrs.xprotect_version, "5305");
  assert.deepEqual(r.sections, { apps: "pending", profiles: "pending", users: "pending" });
  assert.ok(!JSON.stringify(r).includes("SECRETKEY-FVR-123"));
});

test("normalizeDevice: recoverykey false when FileVault known but no key; null when posture unknown", () => {
  const r2 = normalizeDevice(DEVICES[1], { dgMap: DG, agNames: AGN });
  assert.equal(r2.recoverykey, false);
  const r4 = normalizeDevice(DEVICES[3], { dgMap: DG, agNames: AGN });
  assert.equal(r4.filevault, null);
  assert.equal(r4.recoverykey, null);
  assert.equal(r4.battery_pct, 45);
});

test("normalizeDevice: release year falls back to the model_name string when SOFA lacks the model", () => {
  const d = { type: "device", id: 999, attributes: { name: "X", serial_number: "X1", product_name: "Mac15,5", model_name: "iMac (24-inch, 2023)" }, relationships: {} };
  const r = normalizeDevice(d, {});
  assert.equal(r.model_name, "iMac (24-inch, 2023)");
  assert.equal(r.model_year, "2023");
});

test("normalizeDevice carries assigned_profile_detail with via attribution", () => {
  const recs = buildRecords();
  const alice = recs.find((r) => r.serial === "C02FAC111");
  assert.deepEqual(alice.assigned_profile_detail.map((p) => [p.profile, p.via]),
    [["WiFi - Campus", "Faculty"], ["FileVault Escrow", "Faculty"], ["Zoom Settings", "Faculty Apps"]]);
  const ipad = recs.find((r) => r.serial === "F44PAD444");
  assert.deepEqual(ipad.assigned_profile_detail.map((p) => [p.profile, p.via]), [["Library Web Clip", "direct"]]);
  const carol = recs.find((r) => r.serial === "E33LAB333");
  assert.deepEqual(carol.assigned_profile_detail, []);
});

test("section normalizers map API shapes to flat record items", () => {
  assert.deepEqual(normalizeApps(SECTIONS["201"].apps)[0], { name: "zoom.us", identifier: "us.zoom.xos", version: "5.9.0", managed: true });
  assert.deepEqual(normalizeProfiles(SECTIONS["201"].profiles)[0], { name: "WiFi - Campus", identifier: "edu.slc.wifi" });
  assert.deepEqual(normalizeUsers(SECTIONS["201"].users)[0], { username: "alice", full_name: "Alice Anderson" });
});

test("profileAssignmentMap maps device-group and direct-device profile assignments", () => {
  const m = profileAssignmentMap(PROFCAT);
  assert.deepEqual(m.byDeviceGroup.get(9001).map((p) => p.profile), ["WiFi - Campus", "FileVault Escrow"]);
  assert.deepEqual(m.byAssignmentGroup.get(501).map((p) => p.profile), ["Zoom Settings"]);
  assert.deepEqual(m.byDeviceGroup.get(9002).map((p) => p.profile), ["FileVault Escrow"]);
  assert.deepEqual(m.byDevice.get(204).map((p) => p.profile), ["Library Web Clip"]);
});

test("deviceRows covers every DEVICE_COLUMNS key; booleans render on/off, null renders empty", () => {
  const rows = deviceRows(buildRecords());
  assert.equal(rows.length, 4);
  for (const c of DEVICE_COLUMNS) assert.ok(c in rows[0], `missing column ${c}`);
  const alice = rows.find((r) => r.serial === "C02FAC111");
  assert.equal(alice.filevault, "on");
  assert.equal(alice.recoverykey, "on");
  assert.equal(alice.assignment_groups, "Faculty Apps");
  assert.equal(alice.custom_attributes, "xprotect_version=5305");
  const ipad = rows.find((r) => r.serial === "F44PAD444");
  assert.equal(ipad.filevault, "");
  assert.equal(ipad.type, "ipad");
});

test("appRows flag matched rows from hits; assignedAppRows compute installed yes/no", () => {
  const recs = buildRecords();
  recs[0].hits.apps.add("zoom.us");
  const apps = appRows(recs);
  assert.equal(apps.find((r) => r.serial === "C02FAC111" && r.app_name === "zoom.us").matched, "yes");
  assert.equal(apps.find((r) => r.serial === "C02FAC111" && r.app_name === "Google Chrome").matched, "");
  const assigned = assignedAppRows(recs);
  const aliceZoom = assigned.find((r) => r.serial === "C02FAC111" && r.app_name === "Zoom");
  assert.equal(aliceZoom.installed, "yes");
  assert.equal(aliceZoom.managed, "yes");
  assert.equal(aliceZoom.installed_as, "zoom.us 5.9.0");
  assert.equal(assigned.find((r) => r.serial === "C02FAC111" && r.app_name === "Google Chrome").managed, "yes");
  const bobZoom = assigned.find((r) => r.serial === "D25STA222" && r.app_name === "Zoom");
  assert.equal(bobZoom.installed, "no");
  assert.equal(bobZoom.managed, "");
  assert.equal(bobZoom.installed_as, "");
  const unknownRecs = buildRecords();
  unknownRecs[1].sections.apps = "failed"; unknownRecs[1].apps = null;
  assert.equal(assignedAppRows(unknownRecs).find((r) => r.serial === "D25STA222" && r.app_name === "Zoom").installed, "unknown");
  assert.ok(Array.isArray(ASSIGNED_COLUMNS));
});

test("appCatalogRows aggregate fleet-wide app -> versions -> device count", () => {
  const chrome = appCatalogRows(buildRecords()).find((r) => r.app_name === "Google Chrome");
  assert.equal(chrome.devices, 2);
  assert.equal(chrome.versions, "120.0, 137.0");
});

test("rollupRows and byModelRows aggregate with enrichment carried through", () => {
  const recs = buildRecords();
  const byType = rollupRows(recs, (r) => r.type, "type");
  assert.deepEqual(byType.find((r) => r.type === "laptop"), { type: "laptop", devices: 1 });
  const byGroup = rollupRows(recs, (r) => r.device_group, "device_group");
  assert.ok(byGroup.find((r) => r.device_group === "(none)"));
  const imac = byModelRows(recs).find((r) => r.model_id === "iMac21,1");
  assert.equal(imac.model_name, "iMac (24-inch, M1, 2021, Four Ports)");
  assert.equal(imac.release_year, "2021");
  assert.equal(imac.devices, 1);
});

test("inventoryFindings: low storage, stale device, recovery-key-missing, deployment gap", () => {
  const f = inventoryFindings(buildRecords(), { now: NOW2 });
  assert.ok(f.find((x) => x.type === "low-storage" && x.serial === "D25STA222" && x.status === "flag"));
  assert.ok(f.find((x) => x.type === "stale-device" && x.serial === "E33LAB333"));
  assert.ok(f.find((x) => x.type === "recovery-key-missing" && x.serial === "D25STA222"));
  assert.ok(f.find((x) => x.type === "assigned-app-missing" && x.serial === "D25STA222" && /Zoom/.test(x.detail) && x.status === "flag"));
  assert.ok(!f.find((x) => x.type === "assigned-app-missing" && x.serial === "C02FAC111" && /Zoom/.test(x.detail)));
  for (const c of FINDING_COLUMNS) assert.ok(c in f[0]);
});

test("inventoryFindings: failed app section degrades the gap finding to unknown, never pass/fail", () => {
  const recs = buildRecords();
  const bob = recs.find((r) => r.serial === "D25STA222");
  bob.sections.apps = "failed"; bob.apps = null;
  const gap = inventoryFindings(recs, { now: NOW2 }).filter((x) => x.type === "assigned-app-missing" && x.serial === "D25STA222");
  assert.ok(gap.length > 0);
  assert.ok(gap.every((x) => x.status === "unknown"));
});

test("inventoryFindings: duplicate names and OS outliers", () => {
  const recs = buildRecords();
  recs[2].name = "Alice MBP";
  recs[2].os_version = "13.6";
  const f = inventoryFindings(recs, { now: NOW2 });
  assert.equal(f.filter((x) => x.type === "duplicate-name").length, 2);
  assert.ok(f.find((x) => x.type === "os-outlier" && x.serial === "E33LAB333"));
  assert.ok(!f.find((x) => x.type === "os-outlier" && x.serial === "F44PAD444"));
});

test("inventoryFindings: assigned-profile-missing flags gaps, unknown on failed profile fetch", () => {
  const f = inventoryFindings(buildRecords(), { now: NOW2 });
  assert.ok(f.find((x) => x.type === "assigned-profile-missing" && x.serial === "C02FAC111" && /FileVault Escrow/.test(x.detail) && x.status === "flag"));
  assert.ok(!f.find((x) => x.type === "assigned-profile-missing" && x.serial === "C02FAC111" && /WiFi - Campus/.test(x.detail)));
  assert.ok(f.find((x) => x.type === "assigned-profile-missing" && x.serial === "F44PAD444" && x.status === "flag"));
  const broken = buildRecords();
  const alice = broken.find((r) => r.serial === "C02FAC111");
  alice.sections.profiles = "failed"; alice.profiles = null;
  const fb = inventoryFindings(broken, { now: NOW2 });
  assert.ok(fb.filter((x) => x.type === "assigned-profile-missing" && x.serial === "C02FAC111").every((x) => x.status === "unknown"));
});

test("assignedProfileRows: installed by identifier match, gaps as no, failed section as unknown", () => {
  const recs = buildRecords();
  const rows = assignedProfileRows(recs);
  for (const c of ASSIGNED_PROFILE_COLUMNS) assert.ok(c in rows[0], `missing column ${c}`);
  assert.equal(rows.find((r) => r.serial === "C02FAC111" && r.profile_name === "WiFi - Campus").installed, "yes");
  assert.equal(rows.find((r) => r.serial === "C02FAC111" && r.profile_name === "FileVault Escrow").installed, "no");
  assert.equal(rows.find((r) => r.serial === "D25STA222" && r.profile_name === "FileVault Escrow").installed, "yes");
  assert.equal(rows.find((r) => r.serial === "F44PAD444").installed, "no");
  const broken = buildRecords();
  const alice = broken.find((r) => r.serial === "C02FAC111");
  alice.sections.profiles = "failed"; alice.profiles = null;
  assert.ok(assignedProfileRows(broken).filter((r) => r.serial === "C02FAC111").every((r) => r.installed === "unknown"));
});

test("renderInventoryReport: header, banner, rollups, findings, per-device sections, methodology", () => {
  const recs = buildRecords();
  const findings = inventoryFindings(recs, { now: NOW2 });
  const md = renderInventoryReport(recs, {
    query: "group:faculty,staff seen:>=2025-01-01", scopeLabel: "search (whole fleet)",
    dateStr: "2026-06-10", findings, detail: "summary", failures: [],
  });
  assert.match(md, /# SimpleMDM Fleet Inventory — 2026-06-10/);
  assert.match(md, /Confidential/);
  assert.match(md, /`group:faculty,staff seen:>=2025-01-01`/);
  assert.match(md, /## 1\. Fleet Overview/);
  assert.match(md, /### By Device Group/);
  assert.match(md, /### By Model/);
  assert.match(md, /iMac \(24-inch, M1, 2021, Four Ports\)/);
  assert.match(md, /## 2\. ⚠ Findings/);
  assert.match(md, /\| finding \| devices \| items \| undetermined \|/);
  assert.match(md, /\| assigned-app-missing \| 1 \| 1 \|/);
  assert.match(md, /### Assigned apps missing \(1\)/);
  assert.match(md, /\| Bob iMac \(D25STA222\) \| Zoom \| Faculty Apps \|/);
  assert.match(md, /### Assigned profiles missing \(4\)/);
  assert.doesNotMatch(md, /is assigned via an assignment group but not installed/);
  assert.match(md, /## 3\. Per-Device Inventory/);
  assert.match(md, /\| Serial \/ UDID \| `C02FAC111` · `UDID-201` \|/);
  assert.match(md, /\| Last seen \| 2026-06-09 \|/);
  assert.match(md, /\| Assignment groups \(1\) \| Faculty Apps \|/);
  assert.match(md, /## 4\. Methodology & Disclosures/);
  assert.match(md, /last MDM check-in/);
});

test("renderInventoryReport: detail=summary omits full app tables; detail=full includes them; pipes escaped", () => {
  const recs = buildRecords();
  recs[0].name = "Pipe|Name";
  const summary = renderInventoryReport(recs, { query: null, scopeLabel: "--group Faculty", dateStr: "2026-06-10", findings: [], detail: "summary", failures: [] });
  const full = renderInventoryReport(recs, { query: null, scopeLabel: "--group Faculty", dateStr: "2026-06-10", findings: [], detail: "full", failures: [] });
  assert.doesNotMatch(summary, /\| zoom\.us \|/);
  assert.match(full, /\| zoom\.us \|/);
  assert.match(full, /Pipe\\\|Name/);
});

test("renderInventoryReport: failed devices and undetermined matches are called out", () => {
  const recs = buildRecords();
  recs[1].sections.apps = "failed"; recs[1].apps = null; recs[1].match_status = "unknown";
  const md = renderInventoryReport(recs, {
    query: "app:zoom", scopeLabel: "search (whole fleet)", dateStr: "2026-06-10",
    findings: [], detail: "summary", failures: [{ serial: "D25STA222", section: "apps", message: "boom" }],
  });
  assert.match(md, /PARTIAL/);
  assert.match(md, /D25STA222.*apps.*boom/);
  assert.match(md, /undetermined/i);
});

test("renderInventoryReport: assigned apps + assigned profiles tables appear at EVERY detail level", () => {
  const summary = renderInventoryReport(buildRecords(), { query: null, scopeLabel: "--group Faculty", dateStr: "2026-06-10", findings: [], detail: "summary", failures: [] });
  assert.match(summary, /\*\*Assigned apps\*\* \(via assignment groups\):/);
  assert.match(summary, /\*\*Assigned profiles\*\* \(via device group \/ direct\):/);
  assert.match(summary, /\| Zoom \| Faculty Apps \| yes \| yes \| zoom\.us 5\.9\.0 \|/);
  assert.match(summary, /\| FileVault Escrow \| Faculty \| no \|/);
  assert.match(summary, /\| Library Web Clip \| direct \| no \|/);
  assert.match(summary, /assigned profiles\n/);
  assert.doesNotMatch(summary, /\*\*Installed apps:\*\*/);
});

test("renderInventoryRoster: by-group sections, one row per device with users + assignment groups inline", () => {
  const md = renderInventoryRoster(buildRecords(), {
    query: "group:faculty,staff", scopeLabel: "search (whole fleet)", dateStr: "2026-06-11",
    failures: [], account: { name: "Test U", total: 500, available: 51 },
  });
  assert.match(md, /# SimpleMDM Device Roster — 2026-06-11/);
  assert.match(md, /licenses 449 used of 500/);
  assert.match(md, /## Summary — by Device Group/);
  assert.match(md, /\| \*\*Total\*\* \| \*\*4\*\* \|/);
  assert.match(md, /## Breakdown by Device Type/);
  assert.match(md, /### By type and model/);
  assert.match(md, /## Faculty \(1\)/);
  assert.match(md, /\| model_id \| model_name \| release_year \| device_name \| serial \| users \| assignment_groups \| os \| last_seen \|/);
  assert.match(md, /\| MacBookPro18,1 \| MacBook Pro \(16-inch, M1 Pro, 2021\) \| 2021 \| Alice MBP \| C02FAC111 \| Alice Anderson \| Faculty Apps \| 15.5 \| 2026-06-09 \|/);
  assert.match(md, /## \(no device group\) \(1\)/);
  assert.match(md, /\| Library iPad \| F44PAD444 \| — \| iPad Core \| 18.5 \|/);
  assert.doesNotMatch(md, /Findings/);
});

test("renderInventoryRoster: failed users section renders — and PARTIAL banner shows", () => {
  const recs = buildRecords();
  const alice = recs.find((r) => r.serial === "C02FAC111");
  alice.sections.users = "failed"; alice.users = null;
  const md = renderInventoryRoster(recs, {
    query: null, scopeLabel: "--group Faculty", dateStr: "2026-06-11",
    failures: [{ serial: "C02FAC111", section: "users", message: "boom" }],
  });
  assert.match(md, /PARTIAL/);
  assert.match(md, /\| Alice MBP \| C02FAC111 \| — \| Faculty Apps \|/);
});

test("renderInventoryFlat: one table, device_group column, default sort = group then last seen", () => {
  const md = renderInventoryFlat(buildRecords(), { query: "devicegroup:faculty,staff", scopeLabel: "search (whole fleet)", dateStr: "2026-06-11", failures: [], account: { name: "Test U", total: 500, available: 51 } });
  assert.match(md, /# SimpleMDM Device Inventory \(flat\) — 2026-06-11/);
  assert.match(md, new RegExp("\\| " + FLAT_COLUMNS.join(" \\| ") + " \\|"));
  assert.match(md, /\| MacBookPro18,1 \| MacBook Pro \(16-inch, M1 Pro, 2021\) \| 2021 \| Faculty \| Alice MBP \| C02FAC111 \| Alice Anderson \| Faculty Apps \| 15.5 \| 2026-06-09 \|/);
  const serialOrder = md.split("\n").filter((l) => /^\| \S+ \| .*\| (C02FAC111|D25STA222|E33LAB333|F44PAD444) \|/.test(l) || /(C02FAC111|D25STA222|E33LAB333|F44PAD444)/.test(l) && l.startsWith("| ")).map((l) => (l.match(/C02FAC111|D25STA222|E33LAB333|F44PAD444/) ?? [])[0]).filter(Boolean);
  assert.deepEqual(serialOrder, ["E33LAB333", "C02FAC111", "F44PAD444", "D25STA222"]);
  assert.doesNotMatch(md, /## Summary/);
});

test("renderInventoryFlat + sortRecords: --sort seen:desc puts most recently seen first; os sorts numerically", () => {
  const md = renderInventoryFlat(buildRecords(), { query: null, scopeLabel: "--all", dateStr: "2026-06-11", sort: { field: "seen", dir: "desc" } });
  const serials = md.split("\n").filter((l) => l.startsWith("| ")).map((l) => (l.match(/C02FAC111|D25STA222|E33LAB333|F44PAD444/) ?? [])[0]).filter(Boolean);
  assert.equal(serials[0], "C02FAC111");
  assert.equal(serials[serials.length - 1], "E33LAB333");
  const byOs = sortRecords(buildRecords(), { field: "os", dir: "desc" });
  assert.equal(byOs[0].serial, "F44PAD444");
});

// ── Finding 2: empty-fleet write behavior ────────────────────────────────────
// Backfill of inventory-engine.test.mjs:175-183: a zero-match run must NOT
// crash and must still write all structural CSV artifacts + manifest.
// The legacy test called the CLI driver and checked exit 0; here we call the
// unified buildInventoryDossier().write() directly.
test("buildInventoryDossier: zero-record run writes structural CSVs and manifest without throwing", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "inv-empty-"));
  const emptyInput = { records: [], findings: [], dateStr: "2026-01-01" };
  // Must not throw even with no devices
  await assert.doesNotReject(() =>
    buildInventoryDossier(emptyInput).write(tmpDir, { format: "md", reportOnly: false }),
  );
  // Core artifacts the spec always emits regardless of record count
  for (const f of ["devices.csv", "findings.csv", "by-group.csv", "manifest.csv"]) {
    assert.ok(existsSync(join(tmpDir, f)), `${f} must exist on a zero-match run`);
  }
});

// ── Finding 3: sections_failed VALUE ─────────────────────────────────────────
// Backfill of inventory-engine.test.mjs:99: when apps fetch fails the
// sections_failed cell in devices.csv must equal "apps", not just be present.
// Logic lives in dist/reports/domain/inventory-render.js:39.
test("deviceRows: sections_failed is 'apps' (exact) when only apps section failed", () => {
  const recs = buildRecords();
  recs[0].sections = { apps: "failed", profiles: "ok", users: "ok" };
  const row = deviceRows(recs)[0];
  assert.equal(row.sections_failed, "apps");
});
