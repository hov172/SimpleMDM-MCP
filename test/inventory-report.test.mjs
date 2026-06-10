import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAssignmentGroupsRaw, fetchAppCatalog } from "../scripts/lib/simplemdm.mjs";
import {
  buildModelMap, deriveType, normalizeDevice, assignmentAppMap,
  normalizeApps, normalizeProfiles, normalizeUsers, parseInvArgs,
} from "../scripts/lib/inventory.mjs";

const FIX = (n) => JSON.parse(readFileSync(new URL(`./fixtures/inventory/${n}`, import.meta.url)));
const DEVICES = FIX("devices.json").data;
const AG = FIX("assignment-groups.json").data;
const SOFA = FIX("sofa-models.json");
const SECTIONS = FIX("device-sections.json");
const APPCAT = new Map(FIX("app-catalog.json").data.map((a) => [a.id, a.attributes.name]));
const DG = new Map([[9001, "Faculty"], [9002, "Staff iMacs"], [9003, "Library"]]);
const AGN = new Map(AG.map((g) => [g.id, g.attributes.name]));

test("new fetchers reject a missing apiKey before any network call", async () => {
  await assert.rejects(() => fetchAssignmentGroupsRaw(null), /Missing SIMPLEMDM_API_KEY/);
  await assert.rejects(() => fetchAppCatalog(null), /Missing SIMPLEMDM_API_KEY/);
});

test("buildModelMap merges mac+ios Models and extracts the release year", () => {
  const m = buildModelMap(SOFA.mac, SOFA.ios);
  assert.equal(m.get("iMac21,1").marketing, "iMac (24-inch, M1, 2021, Four Ports)");
  assert.equal(m.get("iMac21,1").year, "2021");
  assert.equal(m.get("iPad13,4").year, "2021");
});

test("deriveType classifies from marketing/family name, with identifier fallback", () => {
  assert.equal(deriveType("MacBookPro18,1", "MacBook Pro (16-inch, M1 Pro, 2021)"), "laptop");
  assert.equal(deriveType("iMac21,1", "iMac"), "imac");
  assert.equal(deriveType("Macmini9,1", "Mac mini (M1, 2020)"), "desktop");
  assert.equal(deriveType("iPad13,4", ""), "ipad");
  assert.equal(deriveType("Mac14,5", ""), "mac");   // Apple Silicon id, no marketing info
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
  assert.equal(r.udid, "UDID-201");                       // from unique_identifier
  assert.equal(r.model_name, "MacBook Pro (16-inch, M1 Pro, 2021)");
  assert.equal(r.model_year, "2021");
  assert.equal(r.type, "laptop");
  assert.equal(r.arch, "arm64");
  assert.equal(r.device_group, "Faculty");
  assert.deepEqual(r.assignment_groups, ["Faculty Apps"]);
  assert.deepEqual(r.assigned_apps, ["Zoom", "Google Chrome"]);
  assert.deepEqual(r.assigned_detail, [{ app: "Zoom", group: "Faculty Apps" }, { app: "Google Chrome", group: "Faculty Apps" }]);
  assert.equal(r.battery_pct, 88);                        // parsed from "88%"
  assert.equal(r.storage_free_gb, 512.5);
  assert.equal(r.recoverykey, true);
  assert.equal(r.attrs.xprotect_version, "5305");
  assert.deepEqual(r.sections, { apps: "pending", profiles: "pending", users: "pending" });
  assert.ok(!JSON.stringify(r).includes("SECRETKEY-FVR-123"), "normalized record must never carry the recovery key value");
});

test("normalizeDevice: recoverykey false when FileVault known but no key; null when posture unknown", () => {
  const r2 = normalizeDevice(DEVICES[1], { dgMap: DG, agNames: AGN });
  assert.equal(r2.recoverykey, false);
  const r4 = normalizeDevice(DEVICES[3], { dgMap: DG, agNames: AGN });
  assert.equal(r4.filevault, null);
  assert.equal(r4.recoverykey, null);
  assert.equal(r4.battery_pct, 45);
});

test("section normalizers map API shapes to flat record items", () => {
  assert.deepEqual(normalizeApps(SECTIONS["201"].apps)[0], { name: "zoom.us", identifier: "us.zoom.xos", version: "5.9.0", managed: true });
  assert.deepEqual(normalizeProfiles(SECTIONS["201"].profiles)[0], { name: "WiFi - Campus", identifier: "edu.slc.wifi" });
  assert.deepEqual(normalizeUsers(SECTIONS["201"].users)[0], { username: "alice", full_name: "Alice Anderson" });
});

test("parseInvArgs: search-only, selector-only, and combined are all valid", () => {
  assert.equal(parseInvArgs(["--search", "os:<15"]).error, null);
  assert.equal(parseInvArgs(["--group", "Faculty"]).error, null);
  const o = parseInvArgs(["--group", "Faculty", "--search", "app:zoom"]);
  assert.equal(o.error, null);
  assert.deepEqual(o.selector, { kind: "group", value: "Faculty" });
  assert.equal(o.search, "app:zoom");
});

test("parseInvArgs: defaults and flag parsing", () => {
  const o = parseInvArgs(["--search", "x", "--format", "md", "--report-detail", "full", "--no-apps", "--raw", "--allow-partial", "--out", "/tmp/x"]);
  assert.equal(o.format, "md");
  assert.equal(o.reportDetail, "full");
  assert.equal(o.noApps, true);
  assert.equal(o.raw, true);
  assert.equal(o.allowPartial, true);
  assert.equal(o.out, "/tmp/x");
  const d = parseInvArgs(["--search", "x"]);
  assert.equal(d.format, "all");
  assert.equal(d.raw, false);
  assert.equal(d.allowPartial, false);
});

test("parseInvArgs: errors — no input, multiple selectors, --all w/o confirm, bad values, unknown flag", () => {
  assert.match(parseInvArgs([]).error, /selector .*--search/i);
  assert.match(parseInvArgs(["--serial", "A", "--group", "G"]).error, /exactly one selector/);
  assert.match(parseInvArgs(["--all"]).error, /--confirm-all/);
  assert.equal(parseInvArgs(["--all", "--confirm-all"]).error, null);
  assert.match(parseInvArgs(["--last-seen", "zero"]).error, /positive integer/);
  assert.match(parseInvArgs(["--serial", ""]).error, /at least one serial/);
  assert.match(parseInvArgs(["--search", "x", "--format", "xls"]).error, /Invalid --format/);
  assert.match(parseInvArgs(["--bogus"]).error, /Unknown flag/);
});

import {
  DEVICE_COLUMNS, deviceRows, APP_COLUMNS, appRows, ASSIGNED_COLUMNS, assignedAppRows,
  PROFILE_COLUMNS, profileRows, USER_COLUMNS, userRows, appCatalogRows,
  rollupRows, byModelRows,
} from "../scripts/lib/inventory-render.mjs";

function buildRecords() {
  const models = buildModelMap(SOFA.mac, SOFA.ios);
  const agApps = assignmentAppMap(AG, APPCAT);
  return DEVICES.map((d) => {
    const r = normalizeDevice(d, { dgMap: DG, agNames: AGN, agAppsByDevice: agApps, models });
    const sec = SECTIONS[String(d.id)];
    r.apps = normalizeApps(sec.apps); r.profiles = normalizeProfiles(sec.profiles); r.users = normalizeUsers(sec.users);
    r.sections = { apps: "ok", profiles: "ok", users: "ok" };
    r.match_reasons = ""; r.match_status = "matched"; r.hits = { apps: new Set(), profiles: new Set(), users: new Set() };
    return r;
  });
}

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
  assert.equal(assigned.find((r) => r.serial === "C02FAC111" && r.app_name === "Zoom").installed, "yes");     // zoom.us matches Zoom
  assert.equal(assigned.find((r) => r.serial === "D25STA222" && r.app_name === "Zoom").installed, "no");      // the deployment gap
  const unknownRecs = buildRecords();
  unknownRecs[1].sections.apps = "failed"; unknownRecs[1].apps = null;
  assert.equal(assignedAppRows(unknownRecs).find((r) => r.serial === "D25STA222" && r.app_name === "Zoom").installed, "unknown");
});

test("appCatalogRows aggregate fleet-wide app -> versions -> device count", () => {
  const rows = appCatalogRows(buildRecords());
  const chrome = rows.find((r) => r.app_name === "Google Chrome");
  assert.equal(chrome.devices, 2);
  assert.equal(chrome.versions, "120.0, 137.0");
});

test("rollupRows and byModelRows aggregate with enrichment carried through", () => {
  const recs = buildRecords();
  const byType = rollupRows(recs, (r) => r.type, "type");
  assert.deepEqual(byType.find((r) => r.type === "laptop"), { type: "laptop", devices: 1 });
  const byGroup = rollupRows(recs, (r) => r.device_group, "device_group");
  assert.ok(byGroup.find((r) => r.device_group === "(none)"));   // Carol Mini has no group
  const byModel = byModelRows(recs);
  const imac = byModel.find((r) => r.model_id === "iMac21,1");
  assert.equal(imac.model_name, "iMac (24-inch, M1, 2021, Four Ports)");
  assert.equal(imac.release_year, "2021");
  assert.equal(imac.devices, 1);
});
