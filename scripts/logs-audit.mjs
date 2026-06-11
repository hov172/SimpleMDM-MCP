#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderReportPdf } from "./lib/report-pdf.mjs";
import {
  fetchAllDevicesRaw, fetchDeviceLogs, fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers,
  fetchDeviceGroups, fetchAssignmentGroups, flatten,
} from "./lib/simplemdm.mjs";
import { loadSofa } from "./lib/sofa.mjs";
import { buildMajorTables, evaluateDevice, deviceCveRows } from "./lib/evaluate.mjs";
import { toCsv, allDeviceRows } from "./lib/render.mjs";
import { mdToDocx } from "./lib/docx.mjs";
import {
  parseArgs, selectDevices, logRows, LOG_COLUMNS, statusSnapshotRows, STATUS_COLUMNS,
  statusSnapshotFiles, logSummaryRows, SUMMARY_COLUMNS, manifestRows, MANIFEST_COLUMNS,
  renderDetailedReport, noisyDevices, findingRows, FINDINGS_COLUMNS,
} from "./lib/logs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Render report.md -> report.html + report.pdf via the shared renderer
// (WeasyPrint preferred, Chrome fallback). Returns produced basenames.
function renderHtmlAndPdf(outDir) {
  return renderReportPdf({
    mdPath: join(outDir, "report.md"),
    htmlPath: join(outDir, "report.html"),
    pdfPath: join(outDir, "report.pdf"),
    style: join(HERE, "logs-report.head.html"),
    label: "logs-audit",
  }).map((p) => p.split("/").pop());
}

function loadEnvKey() {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) { console.error(`logs-audit: ${opts.error}`); process.exit(2); }

  const apiKey = loadEnvKey();
  if (!apiKey) { console.error("LOGS-AUDIT FAILED: Missing SIMPLEMDM_API_KEY (set it in .env or the environment)"); process.exit(1); }

  const raw = await fetchAllDevicesRaw(apiKey);

  // Resolve --group name -> set of matching group ids (device-group + assignment-group).
  let matchGroupIds = new Set();
  if (opts.selector.kind === "group") {
    const dg = await fetchDeviceGroups(apiKey);
    const ag = await fetchAssignmentGroups(apiKey);
    const wanted = opts.selector.value.toLowerCase();
    for (const [id, name] of [...dg, ...ag]) if (String(name).toLowerCase() === wanted) matchGroupIds.add(id);
    if (matchGroupIds.size === 0) { console.error(`logs-audit: no group named "${opts.selector.value}"`); process.exit(3); }
  }
  if (opts.selector.kind === "all") console.warn(`logs-audit: --all selected ${raw.length} devices; fetching logs for each…`);

  const selected = selectDevices(raw, opts.selector, matchGroupIds);
  if (selected.length === 0) { console.error("logs-audit: no devices matched the selector"); process.exit(3); }

  // Build per-device bundles (continue-on-error).
  const bundles = [];
  const errors = [];
  for (const device of selected) {
    const serial = device.attributes?.serial_number;
    if (!serial) { errors.push({ serial: String(device.id), message: "device record is missing serial_number" }); continue; }
    try {
      const bundle = { device, logs: await fetchDeviceLogs(apiKey, serial) };
      if (opts.withInventory) {
        bundle.apps = await fetchDeviceApps(apiKey, device.id);
        bundle.profiles = await fetchDeviceProfiles(apiKey, device.id);
        bundle.users = await fetchDeviceUsers(apiKey, device.id);
      }
      bundles.push(bundle);
    } catch (e) { errors.push({ serial, message: String(e.message ?? e) }); }
  }

  // Optional security evaluation on the selected devices.
  let securityEval = null;
  let securityResult = null;
  if (opts.withSecurity) {
    const { macFeed, iosFeed } = await loadSofa(`reports/.logs-audit-cache`, { noCache: false });
    const tables = buildMajorTables(macFeed, iosFeed);
    const evald = bundles.map((b) => evaluateDevice(flatten(b.device), tables));
    securityEval = evald;
    securityResult = { tables, evald };
  }

  const dateStr = todayStr();
  const outDir = opts.out ?? `reports/logs-audit-${dateStr}`;
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const writeFile = (name, content, description, scope) => {
    const path = `${outDir}/${name}`;
    writeFileSync(path, content);
    written.push({ name, path, description, record_scope: scope });
  };

  // CSV + JSON core (rows always computed — summary.txt needs them; files
  // skipped under --report-only).
  const lr = logRows(bundles), sr = statusSnapshotRows(bundles), mr = logSummaryRows(bundles);
  const fr = findingRows(bundles);
  const snapFiles = opts.reportOnly ? [] : statusSnapshotFiles(bundles);
  if (!opts.reportOnly) {
    writeFile("logs.csv", toCsv([LOG_COLUMNS], lr), "Activity events: one row per event, ISO+verbatim time, typed, sorted", `${lr.length} events`);
    writeFile("logs-status-snapshots.csv", toCsv([STATUS_COLUMNS], sr), "status.changed snapshots; full status JSON externalized to status-snapshots/ (see status_json_file column)", `${sr.length} snapshots`);
    // Externalize each full status snapshot to its own JSON file so no CSV cell is oversized.
    if (snapFiles.length) {
      mkdirSync(`${outDir}/status-snapshots`, { recursive: true });
      for (const sf of snapFiles) writeFileSync(`${outDir}/${sf.file}`, JSON.stringify(sf.json, null, 2));
    }
    writeFile("logs-summary.csv", toCsv([SUMMARY_COLUMNS], mr), "Per-device pivot + coverage window", `${bundles.length} devices`);
    if (fr.length) writeFile("findings.csv", toCsv([FINDINGS_COLUMNS], fr), "Auto-detected per-device findings (reinstall loops, update-failure loops, profile churn)", `${fr.length} findings`);
    writeFile("raw-logs.json", JSON.stringify({ generated_at: nowIso(), selector: opts.selector, devices: bundles.map((b) => ({ device: b.device, logs: b.logs })) }, null, 2), "Verbatim per-device log records", `${bundles.length} devices`);
  }

  if (opts.withInventory && !opts.reportOnly) {
    const invRows = bundles.map((b) => flatten(b.device));
    writeFile("inventory.csv", toCsv([["id", "name", "serial", "model", "osVersion", "last_seen_at", "filevault_enabled", "sip_enabled", "firewall_enabled", "device_group_id"]], invRows), "Per-device inventory", `${invRows.length} devices`);
    const appRows = bundles.flatMap((b) => (b.apps ?? []).map((a) => ({ serial: b.device.attributes?.serial_number, name: a.attributes?.name, identifier: a.attributes?.identifier, version: a.attributes?.version, managed: a.attributes?.managed })));
    writeFile("apps.csv", toCsv([["serial", "name", "identifier", "version", "managed"]], appRows), "Installed apps per device", `${appRows.length} app records`);
    const profRows = bundles.flatMap((b) => (b.profiles ?? []).map((p) => ({ serial: b.device.attributes?.serial_number, type: p.type, id: p.id, name: p.attributes?.name })));
    writeFile("profiles.csv", toCsv([["serial", "type", "id", "name"]], profRows), "Profiles per device", `${profRows.length} profile records`);
  }

  if (securityResult && !opts.reportOnly) {
    const { tables, evald } = securityResult;
    writeFile("security-posture.csv", toCsv([["name", "device_name", "serial", "device_group", "os_version", "latest_minor", "latest_major", "unfixed_cves", "product", "fv", "sip", "fw", "xp", "last_seen"]], allDeviceRows(evald)), "SOFA posture for selected devices", `${evald.length} devices`);
    writeFile("device-cves.csv", toCsv([["name", "serial", "device_group", "model", "os", "unfixed_count", "exploited_count", "cves"]], deviceCveRows(evald, tables)), "Per-device outstanding CVEs", `${evald.length} devices`);
  }

  // Document: detailed combined dossier. md (md/docx/all), docx (docx/all), html+pdf (all).
  if (["md", "docx", "all"].includes(opts.format)) {
    let groupNameMap = {};
    try {
      const dg = await fetchDeviceGroups(apiKey);
      const ag = await fetchAssignmentGroups(apiKey);
      groupNameMap = Object.fromEntries([...dg, ...ag].map(([id, name]) => [String(id), name]));
    } catch (e) { console.warn(`logs-audit: group names unavailable for report (${e.message})`); }
    const md = renderDetailedReport(bundles, securityEval, dateStr, groupNameMap, { detail: opts.reportDetail });
    writeFile("report.md", md, "Detailed combined dossier: identity + security + activity + inventory per device", "1 document");
    if (["docx", "all"].includes(opts.format)) {
      const ok = mdToDocx(`${outDir}/report.md`, `${outDir}/report.docx`);
      if (ok) written.push({ name: "report.docx", path: `${outDir}/report.docx`, description: "Word report", record_scope: "1 document" });
      else console.warn("logs-audit: docx skipped (pandoc unavailable or failed)");
    }
    if (opts.format === "all") {
      for (const name of renderHtmlAndPdf(outDir)) {
        written.push({ name, path: `${outDir}/${name}`, description: name.endsWith(".pdf") ? "PDF report" : "HTML report", record_scope: "1 document" });
      }
    }
  }

  // Manifest (hash everything written so far).
  const fileMetas = written.map((w) => {
    const buf = readFileSync(w.path);
    return { file: w.name, description: w.description, record_scope: w.record_scope, data_row_count: "", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  // Hash each externalized status snapshot individually for integrity.
  for (const sf of snapFiles) {
    const buf = readFileSync(`${outDir}/${sf.file}`);
    fileMetas.push({ file: sf.file, description: "status.changed full snapshot", record_scope: "1 snapshot", data_row_count: "", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
  }
  // Record any devices that failed collection so the integrity manifest reflects a partial export (spec §8).
  for (const err of errors) {
    fileMetas.push({ file: `(error: ${err.serial})`, description: err.message, record_scope: "", data_row_count: "", bytes: "", sha256: "" });
  }
  writeFileSync(`${outDir}/manifest.csv`, toCsv([MANIFEST_COLUMNS], manifestRows(fileMetas, nowIso())));

  // summary.txt + stdout headline.
  const totalEvents = bundles.reduce((n, b) => n + b.logs.length, 0);
  const byType = mr.reduce((acc, r) => {
    acc.app_installing += r.app_installing; acc.profile_installed += r.profile_installed;
    acc.status_changed += r.status_changed; acc.bootstrap_token_get += r.bootstrap_token_get;
    return acc;
  }, { app_installing: 0, profile_installed: 0, status_changed: 0, bootstrap_token_get: 0 });
  const unparseableTimestamps = lr.filter((r) => r.at_iso === "").length;
  const noisy = noisyDevices(bundles);
  const head = [`Logs Audit ${dateStr}`, `Devices: ${bundles.length}`, `Total events: ${totalEvents}`,
    `By type: app.installing ${byType.app_installing} | profile.installed ${byType.profile_installed} | status.changed ${byType.status_changed} | bootstrap_token.get ${byType.bootstrap_token_get}`,
    `Unparseable timestamps: ${unparseableTimestamps}`,
    noisy.length ? `Noisy devices (>=25% of events): ${noisy.map((d) => `${d.serial} (${Math.round(d.share * 100)}%)`).join(", ")}` : null,
    fr.length ? `Findings: ${fr.length} across ${new Set(fr.map((r) => r.serial_number)).size} device(s)${opts.reportOnly ? "" : " — see findings.csv"}` : null,
    errors.length ? `Failed devices: ${errors.length} (export is PARTIAL)` : `Failed devices: 0`,
    `Output: ${outDir}`].filter(Boolean).join("\n");
  writeFileSync(`${outDir}/summary.txt`, head + "\n");
  console.log(head);
  for (const w of written) console.log(`  ${w.name}`);
  if (snapFiles.length) console.log(`  status-snapshots/ (${snapFiles.length} files)`);
  console.log("  manifest.csv");
  console.log("Output is local-only (reports/ is gitignored) and NOT committed.");
}

main().catch((e) => { console.error("LOGS-AUDIT FAILED:", e.message ?? e); process.exit(1); });
