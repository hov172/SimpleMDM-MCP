import { compareVersions, parseVersion } from "./evaluate.mjs";

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

// --report-only: write the rendered report (+ summary/manifest) but skip the
// data CSV/JSON exports. csv format renders no report, so the combination is
// an error rather than a silently empty run.
export function reportOnlyGate(format, reportOnly) {
  if (!reportOnly) return { writeData: true, error: null };
  if (format === "csv") return { writeData: false, error: "--report-only with --format csv writes no report — drop one of them" };
  return { writeData: false, error: null };
}

// "2026-06-06T21:51:22.000-04:00" -> "2026-06-06 21:51" (drop seconds/ms/tz)
function shortTs(ts) { return ts ? String(ts).slice(0, 16).replace("T", " ") : ""; }

export function securityRows(ev) {
  return ev.filter((d) => d.failCount > 0).map((d) => ({
    name: d.name, serial: d.serial, device_group: d.deviceGroup ?? "", model: d.model, os: d.osVersion,
    findings: d.findings.join("; "), unfixed_cves: d.cvesBehind ?? "",
    exploited: d.exploitedBehind ?? "", fail_count: d.failCount,
    last_seen: shortTs(d.lastSeen),
  }));
}

export function needUpdateRows(ev) {
  return ev.filter((d) => d.recommended?.target).map((d) => ({
    name: d.name, serial: d.serial, device_group: d.deviceGroup ?? "", model: d.model,
    current: d.osVersion, path: d.recommended.path.join(" -> "),
    target: d.recommended.target, replace: d.recommended.replace,
  }));
}

// Per-device-group rollup of the headline posture.
export function groupBreakdownRows(ev) {
  const byGroup = new Map();
  for (const d of ev) {
    const g = d.deviceGroup || "(none)";
    if (!byGroup.has(g)) {
      byGroup.set(g, { device_group: g, devices: 0, os_outdated: 0, no_filevault: 0, no_sip: 0, no_firewall: 0, unfixed_cve_devices: 0 });
    }
    const r = byGroup.get(g);
    r.devices++;
    if (d.latestMajor && compareVersions(d.osVersion, d.latestMajor) < 0) r.os_outdated++;
    if (!d.hasFilevault) r.no_filevault++;
    if (d.platform === "macOS" && !d.sipOk) r.no_sip++;
    if (d.platform === "macOS" && !d.firewallOk) r.no_firewall++;
    if ((d.cvesBehind || 0) > 0) r.unfixed_cve_devices++;
  }
  return [...byGroup.values()].sort((a, b) => b.devices - a.devices);
}

// ASCII-only marks so CSV cells render correctly regardless of how a spreadsheet
// app decodes the file (Unicode ✓/✗ get mangled when a .csv is read as MacRoman).
function mark(ok) { return ok ? "on" : "off"; }
function xpMark(status) { return status === "absent" ? "N/A" : status; } // ok | outdated | invalid

export function allDeviceRows(ev) {
  return ev.map((d) => ({
    name: d.name, device_name: d.deviceName ?? "", serial: d.serial, device_group: d.deviceGroup ?? "",
    os_version: d.osVersion, latest_minor: d.latestMinor ?? "", latest_major: d.latestMajor ?? "",
    unfixed_cves: d.cvesBehind ?? "", product: d.model,
    fv: mark(d.filevaultOk), sip: mark(d.sipOk), fw: mark(d.firewallOk), xp: xpMark(d.xprotect.status),
    last_seen: shortTs(d.lastSeen),
  }));
}

// Set of OS major versions the in-scope devices sit on, per track.
function relevantMajorsByTrack(ev) {
  const byTrack = { "macOS": new Set(), "iOS/iPadOS": new Set() };
  for (const d of ev) {
    const major = parseVersion(d.osVersion ?? "")[0];
    if (!major) continue;
    if (d.platform === "macOS") byTrack["macOS"].add(major);
    else if (d.platform === "iOS" || d.platform === "iPadOS") byTrack["iOS/iPadOS"].add(major);
  }
  return byTrack;
}

// When `scoped`, the Vulnerability Check is trimmed to the OS major-version
// ladders the in-scope devices are actually on: empty tracks (e.g. iOS/iPadOS
// for a macs-only scope) and unrelated majors are dropped, but the full upgrade
// ladder within a kept major is preserved. Whole-fleet runs keep the full feed.
export function vulnerabilityRows(tables, ev, { scoped = false } = {}) {
  const keep = scoped ? relevantMajorsByTrack(ev) : null;
  const rows = [];
  for (const [track, map, platforms] of [
    ["macOS", tables.macOS, ["macOS"]],
    ["iOS/iPadOS", tables.ios, ["iOS", "iPadOS"]],
  ]) {
    if (keep && keep[track].size === 0) continue;
    for (const info of [...map.values()].sort((a, b) => b.major - a.major)) {
      if (keep && !keep[track].has(info.major)) continue;
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
          cves: r.cveList.map((c) => (c.exploited ? `${c.id} [exploited]` : c.id)).join("\n"),
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

export function renderMarkdown(ev, cveDetail, summary, tables, dateStr, { scoped = false } = {}) {
  const out = [];
  out.push(`# SOFA Fleet Audit — ${dateStr}\n`);

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
