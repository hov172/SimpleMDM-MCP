import { compareVersions } from "./evaluate.mjs";

function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// header: [[colKey, ...]] flattened; rows: array of objects keyed by colKey
export function toCsv(header, rows) {
  const cols = header[0];
  const lines = [cols.map(esc).join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\r\n");
}

export function securityRows(ev) {
  return ev.filter((d) => d.failCount > 0).map((d) => ({
    name: d.name, serial: d.serial, model: d.model, os: d.osVersion,
    findings: d.findings.join("; "), unfixed_cves: d.cvesBehind ?? "",
    exploited: d.exploitedBehind ?? "", fail_count: d.failCount,
    last_seen: d.lastSeen ?? "",
  }));
}

export function needUpdateRows(ev) {
  return ev.filter((d) => d.recommended?.target).map((d) => ({
    name: d.name, serial: d.serial, model: d.model,
    current: d.osVersion, path: d.recommended.path.join(" -> "),
    target: d.recommended.target, replace: d.recommended.replace,
  }));
}

export function allDeviceRows(ev) {
  return ev.map((d) => ({
    name: d.name, serial: d.serial, model: d.model, platform: d.platform, os: d.osVersion,
    filevault: d.filevaultOk ? "ok" : "off", sip: d.sipOk ? "ok" : "off",
    firewall: d.firewallOk ? "ok" : "off", xprotect: d.xprotect.status,
    last_seen: d.lastSeen ?? "",
  }));
}

export function vulnerabilityRows(tables, ev) {
  const rows = [];
  for (const [track, map, platforms] of [
    ["macOS", tables.macOS, ["macOS"]],
    ["iOS/iPadOS", tables.ios, ["iOS", "iPadOS"]],
  ]) {
    for (const info of [...map.values()].sort((a, b) => b.major - a.major)) {
      for (const r of info.releases) {
        const devicesOnRelease = ev.filter((d) => platforms.includes(d.platform) && d.osVersion === r.ver).length;
        let unfixedToLatest = 0;
        for (const r2 of info.releases) {
          if (compareVersions(r2.ver, r.ver) > 0) unfixedToLatest += r2.cves;
        }
        rows.push({
          version: r.ver, track, date: r.date, cves_fixed: r.cves,
          actively_exploited: r.exploited, devices_on_release: devicesOnRelease,
          unfixed_to_latest: unfixedToLatest,
        });
      }
    }
  }
  return rows;
}

export function cveRows(cveDetail) {
  return cveDetail.map((c) => ({
    cve_id: c.cve_id, fixed_in_version: c.fixed_in_version, os_track: c.os_track,
    actively_exploited: c.actively_exploited, devices_still_exposed: c.devices_still_exposed,
  }));
}

function mdTable(cols, rows) {
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

export function renderMarkdown(ev, cveDetail, summary, tables, dateStr) {
  const out = [];
  out.push(`# SOFA Fleet Audit — ${dateStr}\n`);

  out.push("## Security Report\n");
  out.push(`Devices with issues: **${summary.withIssues}** / ${summary.total}. ` +
    `OS Outdated ${summary.osOutdated} · No FileVault ${summary.noFileVault} · ` +
    `No SIP ${summary.noSip} · No Firewall ${summary.noFirewall} · ` +
    `XProtect Outdated ${summary.xprotectOutdated} · Unfixed CVEs ${summary.unfixedCves}\n`);
  out.push(mdTable(["name", "serial", "os", "findings", "unfixed_cves", "fail_count"], securityRows(ev)) + "\n");

  out.push("## Vulnerability Check\n");
  for (const [track, map] of [["macOS", tables.macOS], ["iOS/iPadOS", tables.ios]]) {
    out.push(`### ${track}\n`);
    for (const info of [...map.values()].sort((a, b) => b.major - a.major)) {
      for (const r of info.releases) {
        const devs = ev.filter((d) => d.osVersion === r.ver).length;
        out.push(`- **${r.ver}** (${r.date}) — ${r.cves} CVEs, ${r.exploited} exploited, ${devs} device(s)`);
        if (r.cveList.length) {
          const list = r.cveList.map((c) => (c.exploited ? `🔴 ${c.id}` : c.id)).join(", ");
          out.push(`  - ${list}`);
        }
      }
    }
  }
  out.push("");

  out.push("## Need Updates\n");
  out.push(mdTable(["name", "serial", "current", "path", "target", "replace"], needUpdateRows(ev)) + "\n");

  out.push("## All Devices\n");
  out.push(mdTable(["name", "serial", "model", "platform", "os", "filevault", "sip", "firewall", "xprotect"], allDeviceRows(ev)) + "\n");

  return out.join("\n");
}
