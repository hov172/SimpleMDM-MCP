#!/usr/bin/env node
/**
 * test/golden/capture.mjs — manually run: node test/golden/capture.mjs
 *
 * Captures deterministic golden output for all three report engines.
 * Uses committed fixtures ONLY — no live API calls.
 *
 * Fixed timestamps (for reproducibility):
 *   dateStr  = "2026-01-01"
 *   nowIso   = "2026-01-01T00:00:00Z"
 *
 * Re-run this script whenever the engine output format changes to refresh
 * the goldens. Then commit the updated test/golden/ tree.
 */

import {
  mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync, readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Fixed timestamps for determinism ─────────────────────────────────────────
const FIXED_DATE   = "2026-01-01";
const FIXED_NOW    = "2026-01-01T00:00:00Z";
const FIXED_NOW_MS = Date.parse(FIXED_NOW);

// ── Path helpers ──────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function fix(name) {
  return JSON.parse(readFileSync(join(ROOT, "test/fixtures", name), "utf8"));
}
function invFix(name) {
  return JSON.parse(readFileSync(join(ROOT, "test/fixtures/inventory", name), "utf8"));
}
function ensureGolden(report) {
  const dir = join(HERE, report);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function writeGolden(dir, name, content) {
  writeFileSync(join(dir, name), content);
}

// ── captureDir: copy text artifacts; record binaries in _binary-manifest.json ─
// Used when writing to a tmpdir then promoting to golden. Also exported for
// use by later parity-test tasks.
const TEXT = /\.(md|html|csv|json)$/;
const BIN  = /\.(pdf|docx)$/;

export function captureDir(srcDir, goldenDir) {
  const bin = [];
  for (const f of readdirSync(srcDir)) {
    if (TEXT.test(f)) copyFileSync(join(srcDir, f), join(goldenDir, f));
    else if (BIN.test(f)) bin.push({ name: f, bytes: statSync(join(srcDir, f)).size });
  }
  writeFileSync(join(goldenDir, "_binary-manifest.json"), JSON.stringify(bin, null, 2) + "\n");
}

export function readGolden(report, name) {
  return readFileSync(new URL(`./${report}/${name}`, import.meta.url), "utf8");
}

// ════════════════════════════════════════════════════════════════════════════
// 1. AUDIT (sofa-audit engine — lib functions only, no API calls)
//    Fixtures: test/fixtures/devices.json (pre-flattened), sofa-macos.json,
//              sofa-ios.json
// ════════════════════════════════════════════════════════════════════════════
import {
  buildMajorTables, evaluateDevice, aggregateCveDetail,
  deviceCveRows, cveDeviceRows, summarize,
} from "../../scripts/lib/evaluate.mjs";
import {
  toCsv, securityRows, needUpdateRows, allDeviceRows, cveRows,
  renderMarkdown, vulnerabilityRows, groupBreakdownRows,
} from "../../scripts/lib/render.mjs";

export function buildAuditInput() {
  // devices.json is already in the flat shape evaluateDevice expects
  const devices = fix("devices.json");
  const macFeed  = fix("sofa-macos.json");
  const iosFeed  = fix("sofa-ios.json");

  const tables    = buildMajorTables(macFeed, iosFeed);
  const ev        = devices.map((d) => evaluateDevice(d, tables));
  const cveDetail = aggregateCveDetail(ev, tables);
  const summary   = summarize(ev, cveDetail);

  return { ev, tables, cveDetail, summary, dateStr: FIXED_DATE, scoped: false };
}

function captureAudit() {
  console.log("Capturing audit golden…");
  const dir = ensureGolden("audit");

  const { ev, tables, cveDetail, summary } = buildAuditInput();

  const W = (name, content) => writeGolden(dir, name, content);

  W("security-report.csv", toCsv(
    [["name","serial","device_group","model","os","findings","unfixed_cves","exploited","fail_count","last_seen"]],
    securityRows(ev)));
  W("need-updates.csv", toCsv(
    [["name","serial","device_group","model","current","path","target","replace"]],
    needUpdateRows(ev)));
  W("all-devices.csv", toCsv(
    [["name","device_name","serial","device_group","os_version","latest_minor","latest_major","unfixed_cves","product","fv","sip","fw","xp","last_seen"]],
    allDeviceRows(ev)));
  W("by-group.csv", toCsv(
    [["device_group","devices","os_outdated","no_filevault","no_sip","no_firewall","unfixed_cve_devices"]],
    groupBreakdownRows(ev)));
  W("cve-detail.csv", toCsv(
    [["cve_id","fixed_in_version","os_track","actively_exploited","devices_still_exposed"]],
    cveRows(cveDetail)));
  W("vulnerability-check.csv", toCsv(
    [["version","track","date","cves_fixed","actively_exploited","devices_on_release","unfixed_to_latest","cves"]],
    vulnerabilityRows(tables, ev, { scoped: false })));
  W("device-cves.csv", toCsv(
    [["name","serial","device_group","model","os","unfixed_count","exploited_count","cves"]],
    deviceCveRows(ev, tables)));
  W("cve-devices.csv", toCsv(
    [["cve_id","fixed_in_version","os_track","actively_exploited","devices_exposed","devices"]],
    cveDeviceRows(ev, tables)));
  W("full-audit.md", renderMarkdown(ev, cveDetail, summary, tables, FIXED_DATE, { scoped: false }));

  // Binaries (docx, pdf) require running the full engine with pandoc/WeasyPrint;
  // not produced here — record empty manifest.
  writeFileSync(join(dir, "_binary-manifest.json"), JSON.stringify([], null, 2) + "\n");

  console.log(`  ✓ audit: ${readdirSync(dir).length} files written to ${dir}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. INVENTORY (inventory-report engine — lib functions only, no API calls)
//    Fixtures: test/fixtures/inventory/*
// ════════════════════════════════════════════════════════════════════════════
import {
  buildModelMap, assignmentAppMap, profileAssignmentMap,
  normalizeDevice, normalizeApps, normalizeProfiles, normalizeUsers,
} from "../../scripts/lib/inventory.mjs";
import {
  DEVICE_COLUMNS, deviceRows,
  APP_COLUMNS, appRows,
  ASSIGNED_COLUMNS, assignedAppRows,
  ASSIGNED_PROFILE_COLUMNS, assignedProfileRows,
  PROFILE_COLUMNS, profileRows,
  USER_COLUMNS, userRows,
  APP_CATALOG_COLUMNS, appCatalogRows,
  rollupRows, BY_MODEL_COLUMNS, byModelRows,
  FINDING_COLUMNS, inventoryFindings,
  renderInventoryReport,
} from "../../scripts/lib/inventory-render.mjs";

export function buildInventoryInput() {
  const DEVICES  = invFix("devices.json").data;
  const AG       = invFix("assignment-groups.json").data;
  const SOFA     = invFix("sofa-models.json");
  const SECTIONS = invFix("device-sections.json");
  const APPCAT   = new Map(invFix("app-catalog.json").data.map((a) => [a.id, a.attributes.name]));
  const PROFCAT  = invFix("profiles-catalog.json").data;
  // Device-group and assignment-group name maps (as the engine builds them)
  const DG  = new Map([[9001, "Faculty"], [9002, "Staff iMacs"], [9003, "Library"]]);
  const AGN = new Map(AG.map((g) => [g.id, g.attributes.name]));

  const models        = buildModelMap(SOFA.mac, SOFA.ios);
  const agApps        = assignmentAppMap(AG, APPCAT);
  const profileAssign = profileAssignmentMap(PROFCAT);

  const records = DEVICES.map((d) => {
    const r   = normalizeDevice(d, { dgMap: DG, agNames: AGN, agAppsByDevice: agApps, models, profileAssign });
    const sec = SECTIONS[String(d.id)];
    r.apps     = normalizeApps(sec.apps);
    r.profiles = normalizeProfiles(sec.profiles);
    r.users    = normalizeUsers(sec.users);
    r.sections     = { apps: "ok", profiles: "ok", users: "ok" };
    r.match_reasons = "";
    r.match_status  = "matched";
    r.hits          = { apps: new Set(), profiles: new Set(), users: new Set() };
    return r;
  });

  // Pin the clock so stale-device / other date-relative findings are stable
  const findings = inventoryFindings(records, { now: FIXED_NOW_MS });

  return { records, findings, dateStr: FIXED_DATE };
}

function captureInventory() {
  console.log("Capturing inventory golden…");
  const dir = ensureGolden("inventory");

  const { records, findings } = buildInventoryInput();

  const W = (name, content) => writeGolden(dir, name, content);

  W("devices.csv",           toCsv([DEVICE_COLUMNS],            deviceRows(records)));
  W("apps.csv",              toCsv([APP_COLUMNS],                appRows(records)));
  W("app-catalog.csv",       toCsv([APP_CATALOG_COLUMNS],        appCatalogRows(records)));
  W("assigned-apps.csv",     toCsv([ASSIGNED_COLUMNS],           assignedAppRows(records)));
  W("assigned-profiles.csv", toCsv([ASSIGNED_PROFILE_COLUMNS],   assignedProfileRows(records)));
  W("profiles.csv",          toCsv([PROFILE_COLUMNS],            profileRows(records)));
  W("users.csv",             toCsv([USER_COLUMNS],               userRows(records)));
  W("by-group.csv",          toCsv([["device_group","devices"]],
    rollupRows(records, (r) => r.device_group, "device_group")));
  W("by-type.csv",           toCsv([["type","devices"]],
    rollupRows(records, (r) => r.type, "type")));
  W("by-model.csv",          toCsv([BY_MODEL_COLUMNS],           byModelRows(records)));
  W("by-os.csv",             toCsv([["os","devices"]],
    rollupRows(records, (r) => (r.os_version ? r.os_version.split(".")[0] + ".x" : ""), "os")));
  W("findings.csv",          toCsv([FINDING_COLUMNS],            findings));
  W("report.md", renderInventoryReport(records, {
    query: null, scopeLabel: "--all", dateStr: FIXED_DATE,
    findings, detail: "full", failures: [], account: null,
  }));

  writeFileSync(join(dir, "_binary-manifest.json"), JSON.stringify([], null, 2) + "\n");

  console.log(`  ✓ inventory: ${readdirSync(dir).length} files written to ${dir}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. LOGS (logs-audit engine — lib functions only, no API calls)
//    Fixtures: test/fixtures/devices-sample.json, test/fixtures/logs-sample.json
// ════════════════════════════════════════════════════════════════════════════
import {
  logRows, LOG_COLUMNS,
  statusSnapshotRows, STATUS_COLUMNS,
  statusSnapshotFiles,
  logSummaryRows, SUMMARY_COLUMNS,
  manifestRows, MANIFEST_COLUMNS,
  renderDetailedReport,
  findingRows, FINDINGS_COLUMNS,
} from "../../scripts/lib/logs.mjs";

function captureLogs() {
  console.log("Capturing logs golden…");
  const dir = ensureGolden("logs");

  const RAW  = fix("devices-sample.json").data;
  const LOGS = fix("logs-sample.json").data;

  // Build per-device bundles (match logs by serial number, same as engine does)
  const bundles = RAW.map((device) => ({
    device,
    logs: LOGS.filter(
      (l) => l.attributes.relationships.device.data.serial_number
             === device.attributes.serial_number,
    ),
  }));

  const lr        = logRows(bundles);
  const sr        = statusSnapshotRows(bundles);
  const mr        = logSummaryRows(bundles);
  const fr        = findingRows(bundles);
  const snapFiles = statusSnapshotFiles(bundles);

  // Track written files so we can compute the manifest
  const written = [];
  function writeLogsFile(name, content, description, scope) {
    writeFileSync(join(dir, name), content);
    written.push({ name, description, record_scope: scope });
  }

  writeLogsFile("logs.csv",
    toCsv([LOG_COLUMNS], lr),
    "Activity events: one row per event, ISO+verbatim time, typed, sorted",
    `${lr.length} events`);
  writeLogsFile("logs-status-snapshots.csv",
    toCsv([STATUS_COLUMNS], sr),
    "status.changed snapshots; full status JSON externalized to status-snapshots/ (see status_json_file column)",
    `${sr.length} snapshots`);
  writeLogsFile("logs-summary.csv",
    toCsv([SUMMARY_COLUMNS], mr),
    "Per-device pivot + coverage window",
    `${bundles.length} devices`);
  if (fr.length) {
    writeLogsFile("findings.csv",
      toCsv([FINDINGS_COLUMNS], fr),
      "Auto-detected per-device findings",
      `${fr.length} findings`);
  }
  // raw-logs.json — driver writes this unconditionally (logs-audit.mjs:122).
  // Pin generated_at to FIXED_NOW; selector is null for a whole-fleet run.
  writeLogsFile("raw-logs.json",
    JSON.stringify({ generated_at: FIXED_NOW, selector: null, devices: bundles.map((b) => ({ device: b.device, logs: b.logs })) }, null, 2),
    "Verbatim per-device log records",
    `${bundles.length} devices`);

  // Dossier report — pin the date; pass explicit opts to match driver's default-path call.
  writeLogsFile("report.md",
    renderDetailedReport(bundles, null, FIXED_DATE, {}, { detail: undefined, reportOnly: false }),
    "Detailed combined dossier",
    "1 document");

  // manifest.csv: sha256 of every written file, plus externalized snapshot files.
  // Pin generated_at to FIXED_NOW so the manifest is byte-stable.
  const fileMetas = written.map((w) => {
    const buf = readFileSync(join(dir, w.name));
    return {
      file: w.name,
      description: w.description,
      record_scope: w.record_scope,
      data_row_count: "",
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  });
  for (const sf of snapFiles) {
    const content = JSON.stringify(sf.json, null, 2);
    const buf     = Buffer.from(content, "utf8");
    fileMetas.push({
      file: sf.file,
      description: "status.changed full snapshot",
      record_scope: "1 snapshot",
      data_row_count: "",
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
  writeFileSync(join(dir, "manifest.csv"),
    toCsv([MANIFEST_COLUMNS], manifestRows(fileMetas, FIXED_NOW)));

  writeFileSync(join(dir, "_binary-manifest.json"), JSON.stringify([], null, 2) + "\n");

  console.log(`  ✓ logs: ${readdirSync(dir).length} files written to ${dir}`);
}

// ── Run all three captures ────────────────────────────────────────────────────
captureAudit();
captureInventory();
captureLogs();
console.log("\nAll goldens captured successfully.");
console.log("Re-run: node test/golden/capture.mjs");
