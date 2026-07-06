// Verbatim port of the legacy render lib's renderMarkdown function.
// Exported as renderAuditMarkdown; produces the full-audit.md body.

import {
  securityRows, needUpdateRows, groupBreakdownRows, allDeviceRows,
  vulnerabilityRows,
  type EvaluatedDevice, type CveDetailRow, type AuditSummary, type SofaTables,
} from "./sofa-eval.js";

const mdEsc = (v: unknown): string => String(v ?? "").replace(/\|/g, "\\|");

function mdTable(cols: string[], rows: Record<string, unknown>[]): string {
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => mdEsc(r[c])).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

export function renderAuditMarkdown(
  ev: EvaluatedDevice[],
  cveDetail: CveDetailRow[],
  summary: AuditSummary,
  tables: SofaTables,
  dateStr: string,
  { scoped = false, account = null as { name: string; total: number | null; available: number | null } | null } = {},
): string {
  void cveDetail; // accepted for API compatibility, not used directly
  const out: string[] = [];
  out.push(`# SOFA Fleet Audit — ${dateStr}\n`);
  if (account) {
    out.push(`Account: **${String(account.name).replace(/\|/g, "\\|")}**${account.total != null ? ` · licenses ${account.total - (account.available ?? 0)} used of ${account.total}` : ""}\n`);
  }

  out.push("## Security Report\n");
  out.push(`Devices with issues: **${summary.withIssues}** / ${summary.total}. ` +
    `OS Outdated ${summary.osOutdated} · No FileVault ${summary.noFileVault} · ` +
    `No SIP ${summary.noSip} · No Firewall ${summary.noFirewall} · ` +
    `XProtect Outdated ${summary.xprotectCollected ? summary.xprotectOutdated : "N/A (not set up)"} · ` +
    `Unfixed CVEs ${summary.unfixedCves}\n`);
  out.push(mdTable(["name", "serial", "device_group", "os", "findings", "unfixed_cves", "fail_count"], securityRows(ev)) + "\n");

  out.push("## Vulnerability Check\n");
  out.push("_Per-release CVE counts. The full CVE IDs for each release are in `cve-detail.csv` and `vulnerability-check.csv`._\n");
  if (scoped) out.push("_Scoped run: limited to the OS major-version ladders the selected devices are on._\n");
  const vrows = vulnerabilityRows(tables, ev, { scoped });
  for (const track of ["macOS", "iOS/iPadOS"]) {
    const rows = vrows.filter((r) => r.track === track);
    if (!rows.length) continue;
    out.push(`### ${track}\n`);
    out.push(mdTable(["version", "date", "cves_fixed", "actively_exploited", "devices_on_release", "unfixed_to_latest"], rows) + "\n");
  }

  out.push("## Need Updates\n");
  out.push(mdTable(["name", "serial", "device_group", "current", "path", "target", "replace"], needUpdateRows(ev)) + "\n");

  out.push("## By Device Group\n");
  out.push(mdTable(["device_group", "devices", "os_outdated", "no_filevault", "no_sip", "no_firewall", "unfixed_cve_devices"], groupBreakdownRows(ev)) + "\n");

  out.push("## All Devices\n");
  out.push(mdTable(["name", "device_name", "serial", "device_group", "os_version", "latest_minor", "latest_major", "unfixed_cves", "product", "fv", "sip", "fw", "xp", "last_seen"], allDeviceRows(ev)) + "\n");

  return out.join("\n");
}
