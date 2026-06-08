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
  }));
}

export function cveRows(cveDetail) {
  return cveDetail.map((c) => ({
    cve_id: c.cve_id, fixed_in_version: c.fixed_in_version, os_track: c.os_track,
    actively_exploited: c.actively_exploited, devices_still_exposed: c.devices_still_exposed,
  }));
}
