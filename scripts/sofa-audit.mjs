#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { loadSofa } from "./lib/sofa.mjs";
import { fetchAllDevices, fetchDeviceGroups } from "./lib/simplemdm.mjs";
import { buildMajorTables, evaluateDevice, aggregateCveDetail, deviceCveRows, cveDeviceRows, summarize } from "./lib/evaluate.mjs";
import {
  toCsv, securityRows, needUpdateRows, allDeviceRows, cveRows, renderMarkdown, vulnerabilityRows, groupBreakdownRows,
} from "./lib/render.mjs";
import { mdToDocx } from "./lib/docx.mjs";
import { renderReportPdf } from "./lib/report-pdf.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function loadEnvKey() {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}
function todayStr() {
  // Date is allowed in a normal Node script (not a workflow); format YYYY-MM-DD.
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const format = arg("format", "all");
  const dateStr = todayStr();
  const outDir = arg("out", `reports/audit-${dateStr}`);
  const noCache = process.argv.includes("--no-network-cache");

  const apiKey = loadEnvKey();
  if (!apiKey) { console.error("AUDIT FAILED: Missing SIMPLEMDM_API_KEY (set it in .env or the environment)"); process.exit(1); }
  const { macFeed, iosFeed } = await loadSofa(`${outDir}/.cache`, { noCache });
  const tables = buildMajorTables(macFeed, iosFeed);
  const devices = await fetchAllDevices(apiKey);
  const groups = await fetchDeviceGroups(apiKey);
  for (const d of devices) d.device_group = groups.get(d.device_group_id) ?? "";
  const ev = devices.map((d) => evaluateDevice(d, tables));
  const cveDetail = aggregateCveDetail(ev, tables);
  const summary = summarize(ev, cveDetail);

  mkdirSync(outDir, { recursive: true });
  const write = (name, content) => writeFileSync(`${outDir}/${name}`, content);

  if (["csv", "all", "md", "docx"].includes(format)) {
    write("security-report.csv", toCsv([["name", "serial", "device_group", "model", "os", "findings", "unfixed_cves", "exploited", "fail_count", "last_seen"]], securityRows(ev)));
    write("need-updates.csv", toCsv([["name", "serial", "device_group", "model", "current", "path", "target", "replace"]], needUpdateRows(ev)));
    write("all-devices.csv", toCsv([["name", "device_name", "serial", "device_group", "os_version", "latest_minor", "latest_major", "unfixed_cves", "product", "fv", "sip", "fw", "xp", "last_seen"]], allDeviceRows(ev)));
    write("by-group.csv", toCsv([["device_group", "devices", "os_outdated", "no_filevault", "no_sip", "no_firewall", "unfixed_cve_devices"]], groupBreakdownRows(ev)));
    write("cve-detail.csv", toCsv([["cve_id", "fixed_in_version", "os_track", "actively_exploited", "devices_still_exposed"]], cveRows(cveDetail)));
    write("vulnerability-check.csv", toCsv([["version", "track", "date", "cves_fixed", "actively_exploited", "devices_on_release", "unfixed_to_latest", "cves"]], vulnerabilityRows(tables, ev)));
    write("device-cves.csv", toCsv([["name", "serial", "device_group", "model", "os", "unfixed_count", "exploited_count", "cves"]], deviceCveRows(ev, tables)));
    write("cve-devices.csv", toCsv([["cve_id", "fixed_in_version", "os_track", "actively_exploited", "devices_exposed", "devices"]], cveDeviceRows(ev, tables)));
  }

  const md = renderMarkdown(ev, cveDetail, summary, tables, dateStr);
  if (["md", "docx", "all"].includes(format)) write("full-audit.md", md);
  if (["docx", "all"].includes(format)) mdToDocx(`${outDir}/full-audit.md`, `${outDir}/full-audit.docx`);
  // Auto-render full-audit.html + full-audit.pdf (A3 landscape; WeasyPrint preferred → footer page numbers).
  if (format === "all") {
    renderReportPdf({
      mdPath: `${outDir}/full-audit.md`, htmlPath: `${outDir}/full-audit.html`, pdfPath: `${outDir}/full-audit.pdf`,
      style: join(HERE, "audit-report.head.html"), label: "audit",
    });
  }

  write("summary.txt",
    `SOFA Audit ${dateStr}\nDevices: ${summary.total} (issues: ${summary.withIssues})\n` +
    `OS Outdated ${summary.osOutdated} | No FileVault ${summary.noFileVault} | No SIP ${summary.noSip} | ` +
    `No Firewall ${summary.noFirewall} | XProtect Outdated ${summary.xprotectCollected ? summary.xprotectOutdated : "N/A (not set up)"} | Unfixed CVEs ${summary.unfixedCves}\n`);

  console.log(`Audit written to ${outDir}/`);
  console.log(readFileSync(`${outDir}/summary.txt`, "utf8"));
}

main().catch((err) => { console.error("AUDIT FAILED:", err.message); process.exit(1); });
