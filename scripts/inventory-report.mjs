#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  fetchAllDevicesRaw, fetchDeviceGroups, fetchAssignmentGroupsRaw, fetchAppCatalog, fetchProfilesRaw, fetchAccount,
  fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers,
} from "./lib/simplemdm.mjs";
import { selectDevices } from "./lib/logs.mjs";
import { loadSofa } from "./lib/sofa.mjs";
import { toCsv } from "./lib/render.mjs";
import { mdToDocx } from "./lib/docx.mjs";
import { renderReportPdf } from "./lib/report-pdf.mjs";
import { parseQuery, planQuery, sectionsReferenced, evaluate, QueryError } from "./lib/query.mjs";
import {
  parseInvArgs, normalizeDevice, normalizeApps, normalizeProfiles, normalizeUsers,
  buildModelMap, assignmentAppMap, profileAssignmentMap,
} from "./lib/inventory.mjs";
import {
  DEVICE_COLUMNS, deviceRows, APP_COLUMNS, appRows, ASSIGNED_COLUMNS, assignedAppRows,
  ASSIGNED_PROFILE_COLUMNS, assignedProfileRows,
  PROFILE_COLUMNS, profileRows, USER_COLUMNS, userRows, APP_CATALOG_COLUMNS, appCatalogRows,
  rollupRows, BY_MODEL_COLUMNS, byModelRows, FINDING_COLUMNS, inventoryFindings, renderInventoryReport,
} from "./lib/inventory-render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnvKey() {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

function uniqueDir(base) {
  let d = base;
  for (let i = 2; existsSync(d); i++) d = `${base}-${i}`;
  return d;
}

// raw API dumps must never carry secret values: the FileVault recovery key,
// the firmware (EFI) password, or the Recovery Lock password
const SECRET_DEVICE_ATTRS = ["filevault_recovery_key", "firmware_password", "recovery_lock_password"];
export function redactDeviceRaw(d) {
  const c = JSON.parse(JSON.stringify(d));
  if (c.attributes) {
    for (const k of SECRET_DEVICE_ATTRS) {
      if (k in c.attributes) c.attributes[k] = c.attributes[k] ? "[REDACTED set=yes]" : null;
    }
  }
  return c;
}

export async function run(argv) {
  const opts = parseInvArgs(argv);
  if (opts.error) { console.error(`inventory-report: ${opts.error}`); return 2; }

  let ast = null, plan = { deviceUnits: [], perDeviceUnits: [] };
  if (opts.search) {
    try { ast = parseQuery(opts.search); plan = planQuery(ast); }
    catch (e) {
      if (e instanceof QueryError) { console.error(`inventory-report: ${e.message}`); return 2; }
      throw e;
    }
    const disabled = new Set([opts.noApps && "apps", opts.noProfiles && "profiles", opts.noUsers && "users"].filter(Boolean));
    for (const s of sectionsReferenced(ast)) {
      if (disabled.has(s)) { console.error(`inventory-report: the query references ${s} but --no-${s} is set`); return 2; }
    }
  }
  // Cost guard: a fleet-wide search with no device-level prefilter unit fetches
  // per-device data for every device — same cost as --all.
  if (!opts.selector && opts.search && plan.deviceUnits.length === 0 && !opts.confirmAll) {
    console.error("inventory-report: this fleet-wide search has no device-level filter (only keywords/app:/profile:/user: or mixed OR groups), so it must fetch per-device data for the entire fleet; add --confirm-all to proceed");
    return 2;
  }

  const apiKey = loadEnvKey();
  if (!apiKey) { console.error("INVENTORY-REPORT FAILED: Missing SIMPLEMDM_API_KEY (set it in .env or the environment)"); return 1; }

  const rawDevices = await fetchAllDevicesRaw(apiKey);
  const dgMap = await fetchDeviceGroups(apiKey);
  const agRaw = await fetchAssignmentGroupsRaw(apiKey);
  const agNames = new Map(agRaw.map((g) => [g.id, g.attributes?.name ?? String(g.id)]));
  let appCatalog = new Map();
  try { appCatalog = await fetchAppCatalog(apiKey); }
  catch (e) { console.warn(`inventory-report: app catalog unavailable (${e.message}) — assigned-app data will be empty`); }
  let profileAssign = { byDeviceGroup: new Map(), byAssignmentGroup: new Map(), byDevice: new Map() };
  try { profileAssign = profileAssignmentMap(await fetchProfilesRaw(apiKey)); }
  catch (e) { console.warn(`inventory-report: profile catalog unavailable (${e.message}) — assigned-profile data will be empty`); }
  let account = null;
  try { account = await fetchAccount(apiKey); }
  catch (e) { console.warn(`inventory-report: account info unavailable (${e.message})`); }
  let models = new Map();
  try {
    const { macFeed, iosFeed } = await loadSofa("reports/.inventory-cache", {});
    models = buildModelMap(macFeed, iosFeed);
  } catch (e) { console.warn(`inventory-report: SOFA model enrichment unavailable (${e.message})`); }

  let matchGroupIds = new Set();
  if (opts.selector?.kind === "group") {
    const wanted = opts.selector.value.toLowerCase();
    for (const [id, name] of [...dgMap, ...agNames]) if (String(name).toLowerCase() === wanted) matchGroupIds.add(id);
    if (matchGroupIds.size === 0) { console.error(`inventory-report: no group named "${opts.selector.value}"`); return 3; }
  }
  const selectedRaw = opts.selector ? selectDevices(rawDevices, opts.selector, matchGroupIds) : rawDevices;
  if (opts.selector && selectedRaw.length === 0) { console.error("inventory-report: no devices matched the selector"); return 3; }

  const agApps = assignmentAppMap(agRaw, appCatalog);
  let records = selectedRaw.map((d) => normalizeDevice(d, { dgMap, agNames, agAppsByDevice: agApps, models, profileAssign }));
  const rawById = new Map(selectedRaw.map((d) => [d.id, d]));

  if (plan.deviceUnits.length) {
    records = records.filter((r) => evaluate({ units: plan.deviceUnits }, r).matched === true);
  }
  console.log(`inventory-report: plan — prefilter ${plan.deviceUnits.length} unit(s) → ${records.length} device(s); per-device pass ${plan.perDeviceUnits.length} unit(s)`);

  const failures = [];
  const SECTION_FETCHERS = [
    ["apps", fetchDeviceApps, normalizeApps, opts.noApps],
    ["profiles", fetchDeviceProfiles, normalizeProfiles, opts.noProfiles],
    ["users", fetchDeviceUsers, normalizeUsers, opts.noUsers],
  ];
  for (const r of records) {
    for (const [section, fetcher, normalizer, skip] of SECTION_FETCHERS) {
      if (skip) { r.sections[section] = "skipped"; continue; }
      try {
        r[section] = normalizer(await fetcher(apiKey, r.id));
        r.sections[section] = "ok";
      } catch (e) {
        r.sections[section] = "failed";
        failures.push({ serial: r.serial, section, message: String(e.message ?? e) });
      }
    }
  }

  if (ast) {
    const kept = [];
    for (const r of records) {
      const res = evaluate(ast, r);
      r.match_reasons = res.reasons.join("; ");
      r.match_status = res.matched === true ? "matched" : res.matched === "unknown" ? "unknown" : "no";
      r.hits = res.hits;
      // unknown = included and flagged, never silently dropped (spec: error handling)
      if (res.matched === true || res.matched === "unknown") kept.push(r);
    }
    records = kept;
  } else {
    for (const r of records) { r.match_reasons = ""; r.match_status = "matched"; r.hits = { apps: new Set(), profiles: new Set(), users: new Set() }; }
  }

  const findings = opts.noFindings ? [] : inventoryFindings(records);

  const dateStr = todayStr();
  const outDir = opts.out ?? uniqueDir(`reports/inventory-${dateStr}`);
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const writeOut = (name, content) => {
    writeFileSync(join(outDir, name), content);
    written.push(name);
  };

  writeOut("devices.csv", toCsv([DEVICE_COLUMNS], deviceRows(records)));
  if (!opts.noApps) {
    writeOut("apps.csv", toCsv([APP_COLUMNS], appRows(records)));
    writeOut("app-catalog.csv", toCsv([APP_CATALOG_COLUMNS], appCatalogRows(records)));
  }
  writeOut("assigned-apps.csv", toCsv([ASSIGNED_COLUMNS], assignedAppRows(records)));
  writeOut("assigned-profiles.csv", toCsv([ASSIGNED_PROFILE_COLUMNS], assignedProfileRows(records)));
  if (!opts.noProfiles) writeOut("profiles.csv", toCsv([PROFILE_COLUMNS], profileRows(records)));
  if (!opts.noUsers) writeOut("users.csv", toCsv([USER_COLUMNS], userRows(records)));
  writeOut("by-group.csv", toCsv([["device_group", "devices"]], rollupRows(records, (r) => r.device_group, "device_group")));
  writeOut("by-type.csv", toCsv([["type", "devices"]], rollupRows(records, (r) => r.type, "type")));
  writeOut("by-model.csv", toCsv([BY_MODEL_COLUMNS], byModelRows(records)));
  writeOut("by-os.csv", toCsv([["os", "devices"]], rollupRows(records, (r) => (r.os_version ? r.os_version.split(".")[0] + ".x" : ""), "os")));
  writeOut("findings.csv", toCsv([FINDING_COLUMNS], findings));

  if (opts.raw) {
    mkdirSync(join(outDir, "raw"), { recursive: true });
    const redacted = records.map((r) => redactDeviceRaw(rawById.get(r.id)));
    writeFileSync(join(outDir, "raw", "devices.json"), JSON.stringify(redacted, null, 2));
    written.push("raw/devices.json");
  }

  const scopeLabel = opts.selector
    ? `--${opts.selector.kind}${opts.selector.kind === "all" ? "" : ` ${Array.isArray(opts.selector.value) ? opts.selector.value.join(",") : opts.selector.value}`}`
    : "search (whole fleet)";
  if (["md", "docx", "all"].includes(opts.format)) {
    const md = renderInventoryReport(records, { query: opts.search, scopeLabel, dateStr, findings, detail: opts.reportDetail, failures, account });
    writeOut("report.md", md);
    if (["docx", "all"].includes(opts.format)) {
      if (mdToDocx(join(outDir, "report.md"), join(outDir, "report.docx"))) written.push("report.docx");
      else console.warn("inventory-report: docx skipped (pandoc unavailable or failed)");
    }
    if (opts.format === "all") {
      for (const p of renderReportPdf({
        mdPath: join(outDir, "report.md"), htmlPath: join(outDir, "report.html"), pdfPath: join(outDir, "report.pdf"),
        style: join(HERE, "inventory-report.head.html"), label: "inventory-report",
      })) written.push(p.split("/").pop());
    }
  }

  const undetermined = records.filter((r) => r.match_status === "unknown").length;
  const head = [
    `Inventory Report ${dateStr}`,
    account ? `Account: ${account.name}${account.total != null ? ` — licenses ${account.total - (account.available ?? 0)} used of ${account.total}` : ""}` : null,
    opts.search ? `Query: ${opts.search}` : null,
    `Scope: ${scopeLabel}`,
    `Devices: ${records.length} matched (of ${selectedRaw.length} selected, fleet ${rawDevices.length})`,
    undetermined ? `Undetermined matches (included, flagged): ${undetermined}` : null,
    `Findings: ${findings.length}${findings.some((f) => f.status === "unknown") ? ` (${findings.filter((f) => f.status === "unknown").length} unknown)` : ""}`,
    findings.length ? `Findings by type: ${[...findings.reduce((m, f) => m.set(f.type, (m.get(f.type) ?? 0) + 1), new Map())].map(([t, n]) => `${t} ${n}`).join(" | ")}` : null,
    records.some((r) => r.sections?.apps !== "ok") ? `App catalog/rollups exclude ${records.filter((r) => r.sections?.apps !== "ok").length} device(s) with unavailable app inventory` : null,
    failures.length ? `Failed section fetches: ${failures.length} — export is PARTIAL` : "Failed section fetches: 0",
    ...failures.map((f) => `  failed: ${f.serial} ${f.section} — ${f.message}`),
    `Output: ${outDir}`,
  ].filter(Boolean).join("\n");
  writeOut("summary.txt", head + "\n");

  // manifest last so it covers every output file, summary.txt included
  const manifest = written.map((name) => {
    const buf = readFileSync(join(outDir, name));
    return `${createHash("sha256").update(buf).digest("hex")}  ${name}`;
  });
  writeFileSync(join(outDir, "manifest.sha256"), manifest.join("\n") + "\n");
  console.log(head);
  for (const w of written) console.log(`  ${w}`);
  console.log("  manifest.sha256");
  console.log("Output is local-only (reports/ is gitignored) and NOT committed.");

  if (failures.length && !opts.allowPartial) {
    console.error("inventory-report: exiting 2 because per-device data is incomplete (use --allow-partial to accept)");
    return 2;
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error("INVENTORY-REPORT FAILED:", e.message ?? e); process.exit(1); });
}
