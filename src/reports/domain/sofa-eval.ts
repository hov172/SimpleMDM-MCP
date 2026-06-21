// Ported verbatim from scripts/lib/evaluate.mjs and audit row shapers from scripts/lib/render.mjs.
// Logic is behavior-identical; TypeScript types added, no functional changes.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReleaseEntry {
  ver: string;
  date: string;
  cves: number;
  exploited: number;
  cveList: { id: string; exploited: boolean }[];
}

export interface MajorInfo {
  major: number;
  name: string;
  latest: string;
  latestDate: string;
  releases: ReleaseEntry[];
  supportedDevices: string[];
}

export interface SofaTables {
  macOS: Map<number, MajorInfo>;
  ios: Map<number, MajorInfo>;
  supportedMacMajors: number[];
  supportedIosMajors: number[];
  xprotectLatest: string | null;
  modelMaxMajor: Map<string, number>;
}

export interface XProtectStatus {
  value: unknown;
  status: "absent" | "invalid" | "outdated" | "ok";
}

export interface UpgradeTarget {
  target: string | null;
  path: string[];
  replace: boolean;
}

export interface EvaluatedDevice {
  id: unknown;
  name: string;
  deviceName: string;
  serial: string;
  deviceGroup: string;
  model: string;
  osVersion: string;
  platform: string;
  osStatus: string;
  latest: string | null;
  latestMinor: string | null;
  latestMajor: string | null;
  maxMajor: number | null;
  recommended: UpgradeTarget;
  cvesBehind: number | null;
  exploitedBehind: number | null;
  filevaultOk: boolean;
  sipOk: boolean;
  firewallOk: boolean;
  xprotect: XProtectStatus;
  hasFilevault: boolean;
  findings: string[];
  failCount: number;
  lastSeen: string | null;
}

export interface CveDetailRow {
  cve_id: string;
  fixed_in_version: string;
  os_track: string;
  actively_exploited: boolean;
  devices_still_exposed: number;
}

export interface AuditSummary {
  total: number;
  withIssues: number;
  osOutdated: number;
  noFileVault: number;
  noSip: number;
  noFirewall: number;
  xprotectOutdated: number;
  xprotectCollected: boolean;
  unfixedCves: number;
}

// ── evaluate.mjs port ─────────────────────────────────────────────────────────

export function parseVersion(v: unknown): number[] {
  const parts = String(v ?? "").split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return parts.length ? parts : [0];
}

export function compareVersions(a: unknown, b: unknown): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function detectPlatform(device: { model?: unknown; product_name?: unknown }): string {
  const id = String(device.model ?? device.product_name ?? "");
  if (/^iPad/i.test(id)) return "iPadOS";
  if (/^(iPhone|iPod)/i.test(id)) return "iOS";
  if (/^(MacBook|iMac|Macmini|MacPro|MacStudio|Mac\d)/i.test(id)) return "macOS";
  return "unknown";
}

function assessXProtect(value: unknown, latest: string | null): XProtectStatus {
  if (value === null || value === undefined || value === "") return { value: value ?? null, status: "absent" };
  if (!/^\d+$/.test(String(value))) return { value, status: "invalid" };
  if (latest && parseInt(String(value), 10) < parseInt(latest, 10)) return { value, status: "outdated" };
  return { value, status: "ok" };
}

export function evaluateDevice(device: Record<string, unknown>, tables: SofaTables): EvaluatedDevice {
  const platform = detectPlatform(device as { model?: unknown; product_name?: unknown });
  const osVersion = String(device.osVersion ?? device.os_version ?? "");
  const os = assessOS(osVersion, platform, tables);
  const isMac = platform === "macOS";
  const findings: string[] = [];

  // OS
  if (os.status === "outdated") {
    findings.push(`OS outdated (${os.cvesBehind} CVEs${os.exploitedBehind ? `, ${os.exploitedBehind} exploited` : ""})`);
  } else if (os.status === "eol" || os.status === "untracked") {
    findings.push("OS end-of-life");
  }

  // Mac-only security checks; off-platform => treated OK (N/A), not a failure
  const filevaultOk = isMac ? device.filevault_enabled === true : true;
  const sipOk = isMac ? device.sip_enabled !== false : true; // explicit false only
  const firewallOk = isMac ? device.firewall_enabled === true : true;
  if (isMac && !filevaultOk) findings.push("FileVault disabled");
  if (isMac && !sipOk) findings.push("SIP disabled");
  if (isMac && !firewallOk) findings.push("Firewall disabled");

  const xprotect = isMac ? assessXProtect(device.xprotect_version, tables.xprotectLatest) : { value: null, status: "absent" as const };
  if (xprotect.status === "outdated") findings.push(`XProtect outdated (${xprotect.value} -> ${tables.xprotectLatest})`);
  if (xprotect.status === "invalid") findings.push("XProtect invalid");

  const model = String(device.model ?? "");
  const recommended = isMac
    ? recommendTarget(osVersion, model, tables)
    : os.status === "outdated"
      ? { target: os.latest, path: ([osVersion, os.latest] as (string | null)[]).filter((x): x is string => Boolean(x)), replace: false }
      : { target: null, path: [osVersion], replace: false };

  // Latest available for this hardware: latestMinor = latest of the device's
  // current major track; latestMajor = latest of the newest major it can run.
  const map = isMac ? tables.macOS : tables.ios;
  const maxMajor = isMac ? (tables.modelMaxMajor.get(model) ?? null) : parseVersion(osVersion)[0];
  const latestMajor = maxMajor != null ? (map.get(maxMajor)?.latest ?? null) : null;

  return {
    id: device.id, name: String(device.name ?? ""), deviceName: String(device.device_name ?? ""),
    serial: String(device.serial ?? device.serial_number ?? ""),
    deviceGroup: String(device.device_group ?? ""),
    model, osVersion, platform,
    osStatus: os.status, latest: os.latest, latestMinor: os.latest, latestMajor, maxMajor,
    recommended, cvesBehind: os.cvesBehind, exploitedBehind: os.exploitedBehind,
    filevaultOk, sipOk, firewallOk, xprotect,
    hasFilevault: device.filevault_enabled === true, // raw, all-platform (for fleet count)
    findings, failCount: findings.length,
    lastSeen: (device.last_seen_at as string | null) ?? null,
  };
}

export function recommendTarget(version: string, model: string, tables: SofaTables): UpgradeTarget {
  const ceiling = tables.modelMaxMajor.get(model) ?? null;
  const supported = tables.supportedMacMajors; // macOS only
  const currentMajor = parseVersion(version)[0];
  if (ceiling === null) {
    return { target: null, path: [version], replace: false };
  }
  // Supported majors the hardware can run, ascending, that are >= currentMajor
  const reachable = supported
    .filter((m) => m <= ceiling)
    .sort((a, b) => a - b);
  if (reachable.length === 0) {
    return { target: null, path: [version], replace: true }; // capped below supported
  }
  const path = [version];
  for (const m of reachable) {
    if (m > currentMajor) path.push(tables.macOS.get(m)!.latest);
  }
  // same-major minor update
  if (path.length === 1) {
    const info = tables.macOS.get(currentMajor);
    if (info && compareVersions(version, info.latest) < 0) path.push(info.latest);
  }
  const target = path.length > 1 ? path[path.length - 1] : null;
  return { target, path, replace: false };
}

function buildMajorMap(feed: any): Map<number, MajorInfo> {
  const map = new Map<number, MajorInfo>();
  for (const osv of feed.OSVersions ?? []) {
    const latest = osv.Latest?.ProductVersion;
    if (!latest) continue;
    const major = parseVersion(latest)[0];
    const releases: ReleaseEntry[] = (osv.SecurityReleases ?? [])
      .filter((r: any) => r.ProductVersion)
      .map((r: any) => ({
        ver: r.ProductVersion,
        date: (r.ReleaseDate ?? "").slice(0, 10),
        cves: r.UniqueCVEsCount ?? 0,
        exploited: (r.ActivelyExploitedCVEs ?? []).length,
        cveList: Object.entries(r.CVEs ?? {}).map(([id, ex]) => ({ id, exploited: !!ex })),
      }));
    map.set(major, {
      major,
      name: osv.OSVersion ?? String(major),
      latest,
      latestDate: (osv.Latest?.ReleaseDate ?? "").slice(0, 10),
      releases,
      supportedDevices: osv.Latest?.SupportedDevices ?? [],
    });
  }
  return map;
}

function topMajors(map: Map<number, unknown>, n = 3): number[] {
  return [...map.keys()].sort((a, b) => b - a).slice(0, n);
}

export function assessOS(version: string, platform: string, tables: SofaTables): {
  status: "unknown" | "untracked" | "eol" | "outdated" | "current";
  latest: string | null;
  releasesBehind: number | null;
  cvesBehind: number | null;
  exploitedBehind: number | null;
  isLatest: boolean;
  supportedMajor?: boolean;
} {
  if (!version) return { status: "unknown", latest: null, releasesBehind: null, cvesBehind: null, exploitedBehind: null, isLatest: false };
  const map = platform === "macOS" ? tables.macOS : tables.ios;
  const supported = platform === "macOS" ? tables.supportedMacMajors : tables.supportedIosMajors;
  const major = parseVersion(version)[0];
  const info = map.get(major);
  if (!info) {
    // Major not present in the SOFA feed at all (e.g. macOS 10/11) -> not measurable.
    return { status: "untracked", latest: null, releasesBehind: null, cvesBehind: null, exploitedBehind: null, isLatest: false, supportedMajor: false };
  }
  let releasesBehind = 0, cvesBehind = 0, exploitedBehind = 0;
  for (const r of info.releases) {
    if (compareVersions(r.ver, version) > 0) {
      releasesBehind++; cvesBehind += r.cves; exploitedBehind += r.exploited;
    }
  }
  const isLatest = compareVersions(version, info.latest) >= 0;
  // CVE counts are computed for any major present in the feed (including EOL
  // ones, up to that major's final release). `status` still flags EOL majors.
  const supportedMajor = supported.includes(major);
  const status: "eol" | "current" | "outdated" = !supportedMajor ? "eol" : (isLatest ? "current" : "outdated");
  return { status, latest: info.latest, releasesBehind, cvesBehind, exploitedBehind, isLatest, supportedMajor };
}

// Map model identifier (e.g. "MacBookPro15,2", "Mac16,5") -> highest macOS major
// it supports, from SOFA's top-level Models map.
function buildModelMaxMajor(macFeed: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, info] of Object.entries(macFeed.Models ?? {}) as [string, any][]) {
    const oss: number[] = info.OSVersions ?? [];
    if (oss.length) m.set(id, Math.max(...oss));
  }
  return m;
}

export function buildMajorTables(macFeed: any, iosFeed: any): SofaTables {
  const macOS = buildMajorMap(macFeed);
  const ios = buildMajorMap(iosFeed);
  const modelMaxMajor = buildModelMaxMajor(macFeed);
  return {
    macOS,
    ios,
    supportedMacMajors: topMajors(macOS),
    supportedIosMajors: topMajors(ios),
    xprotectLatest: macFeed.XProtectPlistConfigData?.["com.apple.XProtect"] ?? null,
    modelMaxMajor,
  };
}

export function aggregateCveDetail(evaluatedDevices: EvaluatedDevice[], tables: SofaTables): CveDetailRow[] {
  const rows: CveDetailRow[] = [];
  for (const [track, map] of [["macOS", tables.macOS], ["iOS", tables.ios]] as [string, Map<number, MajorInfo>][]) {
    const platforms = track === "macOS" ? ["macOS"] : ["iOS", "iPadOS"];
    for (const info of map.values()) {
      for (const r of info.releases) {
        for (const cve of r.cveList) {
          const exposed = evaluatedDevices.filter((d) =>
            platforms.includes(d.platform) &&
            parseVersion(d.osVersion)[0] === info.major &&
            compareVersions(d.osVersion, r.ver) < 0
          ).length;
          rows.push({
            cve_id: cve.id,
            fixed_in_version: r.ver,
            os_track: track,
            actively_exploited: cve.exploited,
            devices_still_exposed: exposed,
          });
        }
      }
    }
  }
  return rows;
}

// Inverse of deviceCveRows: one row PER CVE, with the affected devices collapsed
// into a single multi-line `devices` cell. Only CVEs with >=1 exposed device.
export function cveDeviceRows(evaluatedDevices: EvaluatedDevice[], tables: SofaTables): {
  cve_id: string; fixed_in_version: string; os_track: string; actively_exploited: boolean;
  devices_exposed: number; devices: string;
}[] {
  const label = (d: EvaluatedDevice): string => {
    const id = d.name && d.name !== d.serial ? `${d.name} (${d.serial})` : (d.serial || d.name || String(d.id));
    return d.deviceGroup ? `${id} — ${d.deviceGroup}` : id;
  };
  const rows: { cve_id: string; fixed_in_version: string; os_track: string; actively_exploited: boolean; devices_exposed: number; devices: string; }[] = [];
  for (const [track, map] of [["macOS", tables.macOS], ["iOS", tables.ios]] as [string, Map<number, MajorInfo>][]) {
    const platforms = track === "macOS" ? ["macOS"] : ["iOS", "iPadOS"];
    for (const info of map.values()) {
      for (const r of info.releases) {
        for (const cve of r.cveList) {
          const exposed = evaluatedDevices.filter((d) =>
            platforms.includes(d.platform) &&
            parseVersion(d.osVersion)[0] === info.major &&
            compareVersions(d.osVersion, r.ver) < 0
          );
          if (exposed.length === 0) continue;
          rows.push({
            cve_id: cve.id,
            fixed_in_version: r.ver,
            os_track: track,
            actively_exploited: cve.exploited,
            devices_exposed: exposed.length,
            devices: exposed.map(label).join("\n"),
          });
        }
      }
    }
  }
  return rows;
}

// One row PER DEVICE, with that device's unfixed CVEs collapsed into a single
// multi-line `cves` cell.
export function deviceCveRows(evaluatedDevices: EvaluatedDevice[], tables: SofaTables): {
  name: string; serial: string; device_group: string; model: string; os: string;
  unfixed_count: number; exploited_count: number; cves: string;
}[] {
  const rows: { name: string; serial: string; device_group: string; model: string; os: string; unfixed_count: number; exploited_count: number; cves: string; }[] = [];
  for (const d of evaluatedDevices) {
    const isMac = d.platform === "macOS";
    const isIos = d.platform === "iOS" || d.platform === "iPadOS";
    if (!isMac && !isIos) continue;
    const map = isMac ? tables.macOS : tables.ios;
    const major = parseVersion(d.osVersion)[0];
    const info = map.get(major);
    if (!info) continue;
    const cves: { id: string; fixed: string; exploited: boolean }[] = [];
    for (const r of info.releases) {
      if (compareVersions(r.ver, d.osVersion) > 0) {
        for (const cve of r.cveList) cves.push({ id: cve.id, fixed: r.ver, exploited: cve.exploited });
      }
    }
    if (cves.length === 0) continue;
    const lines = cves.map((c) => `${c.id} (->${c.fixed})${c.exploited ? " [exploited]" : ""}`);
    rows.push({
      name: d.name, serial: d.serial, device_group: d.deviceGroup ?? "", model: d.model, os: d.osVersion,
      unfixed_count: cves.length,
      exploited_count: cves.filter((c) => c.exploited).length,
      cves: lines.join("\n"),
    });
  }
  return rows;
}

// Headline counts.
export function summarize(evaluatedDevices: EvaluatedDevice[], _cveDetail: CveDetailRow[] = []): AuditSummary {
  // _cveDetail accepted for call-site API compatibility; not used in the summary body.
  const macs = evaluatedDevices.filter((d) => d.platform === "macOS");
  return {
    total: evaluatedDevices.length,
    withIssues: evaluatedDevices.filter((d) => d.failCount > 0).length,
    osOutdated: evaluatedDevices.filter((d) => d.latestMajor && compareVersions(d.osVersion, d.latestMajor) < 0).length,
    noFileVault: evaluatedDevices.filter((d) => !d.hasFilevault).length,
    noSip: macs.filter((d) => !d.sipOk).length,
    noFirewall: macs.filter((d) => !d.firewallOk).length,
    xprotectOutdated: macs.filter((d) => d.xprotect.status === "outdated").length,
    // false when the xprotect_version custom attribute isn't collected anywhere
    xprotectCollected: macs.some((d) => d.xprotect.status !== "absent"),
    unfixedCves: evaluatedDevices.filter((d) => (d.cvesBehind || 0) > 0).length,
  };
}

// ── Audit row shapers (from render.mjs) ───────────────────────────────────────

// "2026-06-06T21:51:22.000-04:00" -> "2026-06-06 21:51" (drop seconds/ms/tz)
function shortTs(ts: unknown): string { return ts ? String(ts).slice(0, 16).replace("T", " ") : ""; }

export function securityRows(ev: EvaluatedDevice[]): Record<string, unknown>[] {
  return ev.filter((d) => d.failCount > 0).map((d) => ({
    name: d.name, serial: d.serial, device_group: d.deviceGroup ?? "", model: d.model, os: d.osVersion,
    findings: d.findings.join("; "), unfixed_cves: d.cvesBehind ?? "",
    exploited: d.exploitedBehind ?? "", fail_count: d.failCount,
    last_seen: shortTs(d.lastSeen),
  }));
}

export function needUpdateRows(ev: EvaluatedDevice[]): Record<string, unknown>[] {
  return ev.filter((d) => d.recommended?.target).map((d) => ({
    name: d.name, serial: d.serial, device_group: d.deviceGroup ?? "", model: d.model,
    current: d.osVersion, path: d.recommended.path.join(" -> "),
    target: d.recommended.target, replace: d.recommended.replace,
  }));
}

// Per-device-group rollup of the headline posture.
export function groupBreakdownRows(ev: EvaluatedDevice[]): Record<string, unknown>[] {
  const byGroup = new Map<string, { device_group: string; devices: number; os_outdated: number; no_filevault: number; no_sip: number; no_firewall: number; unfixed_cve_devices: number }>();
  for (const d of ev) {
    const g = d.deviceGroup || "(none)";
    if (!byGroup.has(g)) {
      byGroup.set(g, { device_group: g, devices: 0, os_outdated: 0, no_filevault: 0, no_sip: 0, no_firewall: 0, unfixed_cve_devices: 0 });
    }
    const r = byGroup.get(g)!;
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
// app decodes the file.
function mark(ok: boolean): string { return ok ? "on" : "off"; }
function xpMark(status: string): string { return status === "absent" ? "N/A" : status; } // ok | outdated | invalid

export function allDeviceRows(ev: EvaluatedDevice[]): Record<string, unknown>[] {
  return ev.map((d) => ({
    name: d.name, device_name: d.deviceName ?? "", serial: d.serial, device_group: d.deviceGroup ?? "",
    os_version: d.osVersion, latest_minor: d.latestMinor ?? "", latest_major: d.latestMajor ?? "",
    unfixed_cves: d.cvesBehind ?? "", product: d.model,
    fv: mark(d.filevaultOk), sip: mark(d.sipOk), fw: mark(d.firewallOk), xp: xpMark(d.xprotect.status),
    last_seen: shortTs(d.lastSeen),
  }));
}

// Set of OS major versions the in-scope devices sit on, per track.
function relevantMajorsByTrack(ev: EvaluatedDevice[]): Record<string, Set<number>> {
  const byTrack: Record<string, Set<number>> = { "macOS": new Set(), "iOS/iPadOS": new Set() };
  for (const d of ev) {
    const major = parseVersion(d.osVersion ?? "")[0];
    if (!major) continue;
    if (d.platform === "macOS") byTrack["macOS"].add(major);
    else if (d.platform === "iOS" || d.platform === "iPadOS") byTrack["iOS/iPadOS"].add(major);
  }
  return byTrack;
}

// When `scoped`, the Vulnerability Check is trimmed to the OS major-version
// ladders the in-scope devices are actually on.
export function vulnerabilityRows(tables: SofaTables, ev: EvaluatedDevice[], { scoped = false } = {}): Record<string, unknown>[] {
  const keep = scoped ? relevantMajorsByTrack(ev) : null;
  const rows: Record<string, unknown>[] = [];
  for (const [track, map, platforms] of [
    ["macOS", tables.macOS, ["macOS"]],
    ["iOS/iPadOS", tables.ios, ["iOS", "iPadOS"]],
  ] as [string, Map<number, MajorInfo>, string[]][]) {
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

export function cveRows(cveDetail: CveDetailRow[]): Record<string, unknown>[] {
  return cveDetail.map((c) => ({
    cve_id: c.cve_id, fixed_in_version: c.fixed_in_version, os_track: c.os_track,
    actively_exploited: c.actively_exploited, devices_still_exposed: c.devices_still_exposed,
  }));
}
