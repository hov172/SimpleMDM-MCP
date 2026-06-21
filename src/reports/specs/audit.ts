import { Dossier } from "../engine/dossier.js";
import {
  securityRows, needUpdateRows, allDeviceRows, groupBreakdownRows,
  cveRows, vulnerabilityRows, deviceCveRows, cveDeviceRows,
} from "../domain/sofa-eval.js";
import type { EvaluatedDevice, SofaTables, CveDetailRow, AuditSummary } from "../domain/sofa-eval.js";
import { renderAuditMarkdown } from "../domain/audit-render.js";

export interface AuditInput {
  ev: EvaluatedDevice[];
  tables: SofaTables;
  cveDetail: CveDetailRow[];
  summary: AuditSummary;
  dateStr: string;
  scoped: boolean;
}

const C = (...names: string[]) => names.map((n) => ({ key: n, header: n }));
const SEC_COLS         = C("name","serial","device_group","model","os","findings","unfixed_cves","exploited","fail_count","last_seen");
const NEED_COLS        = C("name","serial","device_group","model","current","path","target","replace");
const ALL_COLS         = C("name","device_name","serial","device_group","os_version","latest_minor","latest_major","unfixed_cves","product","fv","sip","fw","xp","last_seen");
const GROUP_COLS       = C("device_group","devices","os_outdated","no_filevault","no_sip","no_firewall","unfixed_cve_devices");
const CVE_DETAIL_COLS  = C("cve_id","fixed_in_version","os_track","actively_exploited","devices_still_exposed");
const VULN_COLS        = C("version","track","date","cves_fixed","actively_exploited","devices_on_release","unfixed_to_latest","cves");
const DEVICE_CVES_COLS = C("name","serial","device_group","model","os","unfixed_count","exploited_count","cves");
const CVE_DEVICES_COLS = C("cve_id","fixed_in_version","os_track","actively_exploited","devices_exposed","devices");

export function buildAuditDossier(input: AuditInput): Dossier {
  const { ev, tables, cveDetail, summary, dateStr, scoped } = input;
  const d = new Dossier({ title: "", pageStyle: "a3-landscape", footerTitle: "SOFA Fleet Security Audit", mdName: "full-audit.md" });
  d.bodyMarkdown(renderAuditMarkdown(ev, cveDetail, summary, tables, dateStr, { scoped }));
  d.dataCsv("security-report.csv",     SEC_COLS,         securityRows(ev));
  d.dataCsv("need-updates.csv",        NEED_COLS,        needUpdateRows(ev));
  d.dataCsv("all-devices.csv",         ALL_COLS,         allDeviceRows(ev));
  d.dataCsv("by-group.csv",            GROUP_COLS,       groupBreakdownRows(ev));
  d.dataCsv("cve-detail.csv",          CVE_DETAIL_COLS,  cveRows(cveDetail));
  d.dataCsv("vulnerability-check.csv", VULN_COLS,        vulnerabilityRows(tables, ev, { scoped }));
  d.dataCsv("device-cves.csv",         DEVICE_CVES_COLS, deviceCveRows(ev, tables));
  d.dataCsv("cve-devices.csv",         CVE_DEVICES_COLS, cveDeviceRows(ev, tables));
  return d;
}
