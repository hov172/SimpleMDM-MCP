import { Dossier } from "../engine/dossier.js";
import { toCsv } from "../engine/csv.js";
// @ts-ignore — retained legacy lib, no .d.ts
import { flatten } from "../../../scripts/lib/simplemdm.mjs";
import {
  logRows, LOG_COLUMNS, statusSnapshotRows, STATUS_COLUMNS, statusSnapshotFiles,
  logSummaryRows, SUMMARY_COLUMNS, findingRows, FINDINGS_COLUMNS,
  renderDetailedReport, manifestRows, MANIFEST_COLUMNS,
} from "../domain/logs.js";
import { allDeviceRows, deviceCveRows } from "../domain/sofa-eval.js";
import { sha256 } from "../engine/manifest.js";

const cols = (arr: string[]) => arr.map((n) => ({ key: n, header: n }));

export interface LogsBuildOpts {
  reportDetail?: string;
  withSecurity?: boolean;
  withInventory?: boolean;
}

export function buildLogsDossier(input: any, opts: LogsBuildOpts = {}): Dossier {
  const { bundles, dateStr, nowIso } = input;
  // Default to "summary" explicitly (renderDetailedReport's implicit default) so the
  // verbosity level is self-documenting rather than relying on an undefined fall-through.
  const detail = (opts.reportDetail as "summary" | "table" | "full" | undefined) ?? "summary";

  const lr = logRows(bundles), sr = statusSnapshotRows(bundles), mr = logSummaryRows(bundles);
  const fr = findingRows(bundles), snapFiles = statusSnapshotFiles(bundles);

  // Render body; thread --report-detail to control per-device log verbosity.
  const bodyMd = renderDetailedReport(bundles, null, dateStr, {}, { detail, reportOnly: false });

  const d = new Dossier({
    title: "",
    pageStyle: "letter-portrait",
    footerTitle: "SimpleMDM Device Activity & Security Dossier",
    mdName: "report.md",
  });
  d.bodyMarkdown(bodyMd);

  const meta: any[] = [];
  const add = (file: string, content: string, description: string, scope: string) => {
    d.dataFile(file, content);
    meta.push({ file, description, record_scope: scope, data_row_count: "", bytes: Buffer.byteLength(content), sha256: sha256(content) });
  };

  add("logs.csv", toCsv(cols(LOG_COLUMNS), lr), "Activity events: one row per event, ISO+verbatim time, typed, sorted", `${lr.length} events`);
  add("logs-status-snapshots.csv", toCsv(cols(STATUS_COLUMNS), sr), "status.changed snapshots; full status JSON externalized to status-snapshots/ (see status_json_file column)", `${sr.length} snapshots`);
  add("logs-summary.csv", toCsv(cols(SUMMARY_COLUMNS), mr), "Per-device pivot + coverage window", `${bundles.length} devices`);
  if (fr.length) add("findings.csv", toCsv(cols(FINDINGS_COLUMNS), fr), "Auto-detected per-device findings", `${fr.length} findings`);
  add("raw-logs.json", JSON.stringify({ generated_at: nowIso, selector: null, devices: bundles.map((b: any) => ({ device: b.device, logs: b.logs })) }, null, 2), "Verbatim per-device log records", `${bundles.length} devices`);

  if (opts.withSecurity && input.security) {
    const { tables, evald } = input.security;
    add("security-posture.csv",
      toCsv(cols(["name","device_name","serial","device_group","os_version","latest_minor","latest_major","unfixed_cves","product","fv","sip","fw","xp","last_seen"]), allDeviceRows(evald)),
      "SOFA posture for selected devices", `${evald.length} devices`);
    add("device-cves.csv",
      toCsv(cols(["name","serial","device_group","model","os","unfixed_count","exploited_count","cves"]), deviceCveRows(evald, tables)),
      "Per-device outstanding CVEs", `${evald.length} devices`);
  }

  if (opts.withInventory) {
    const invRows = bundles.map((b: any) => flatten(b.device));
    add("inventory.csv",
      toCsv(cols(["id","name","serial","model","osVersion","last_seen_at","filevault_enabled","sip_enabled","firewall_enabled","device_group_id"]), invRows),
      "Per-device inventory", `${invRows.length} devices`);
    const appRows = bundles.flatMap((b: any) => (b.apps ?? []).map((a: any) => ({ serial: b.device.attributes?.serial_number, name: a.attributes?.name, identifier: a.attributes?.identifier, version: a.attributes?.version, managed: a.attributes?.managed })));
    add("apps.csv", toCsv(cols(["serial","name","identifier","version","managed"]), appRows), "Installed apps per device", `${appRows.length} app records`);
    const profRows = bundles.flatMap((b: any) => (b.profiles ?? []).map((p: any) => ({ serial: b.device.attributes?.serial_number, type: p.type, id: p.id, name: p.attributes?.name })));
    add("profiles.csv", toCsv(cols(["serial","type","id","name"]), profRows), "Profiles per device", `${profRows.length} profile records`);
  }

  // report.md written by engine's bodyMarkdown path; manifest entry uses same rendered string.
  meta.push({ file: "report.md", description: "Detailed combined dossier", record_scope: "1 document", data_row_count: "", bytes: Buffer.byteLength(bodyMd), sha256: sha256(bodyMd) });

  // Status-snapshot sidecars (written + manifested).
  for (const sf of snapFiles) {
    const content = JSON.stringify(sf.json, null, 2);
    d.dataFile(sf.file, content);
    meta.push({ file: sf.file, description: "status.changed full snapshot", record_scope: "1 snapshot", data_row_count: "", bytes: Buffer.byteLength(content), sha256: sha256(content) });
  }

  // Bespoke manifest (with disclosures) — engine auto-manifest suppressed via manifest:false.
  d.dataFile("manifest.csv", toCsv(cols(MANIFEST_COLUMNS), manifestRows(meta, nowIso)));
  return d;
}
