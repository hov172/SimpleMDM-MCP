import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAssignmentGroupsRaw, fetchAppCatalog } from "../scripts/lib/simplemdm.mjs";
import {
  buildModelMap, deriveType, normalizeDevice, assignmentAppMap,
  normalizeApps, normalizeProfiles, normalizeUsers,
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
