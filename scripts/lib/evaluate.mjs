export function parseVersion(v) {
  const parts = String(v ?? "").split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return parts.length ? parts : [0];
}

export function compareVersions(a, b) {
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

export function detectPlatform(device) {
  const id = String(device.model ?? device.product_name ?? "");
  if (/^iPad/i.test(id)) return "iPadOS";
  if (/^(iPhone|iPod)/i.test(id)) return "iOS";
  if (/^(MacBook|iMac|Macmini|MacPro|MacStudio|Mac\d)/i.test(id)) return "macOS";
  return "unknown";
}

function assessXProtect(value, latest) {
  if (value === null || value === undefined || value === "") return { value: value ?? null, status: "absent" };
  if (!/^\d+$/.test(String(value))) return { value, status: "invalid" };
  if (latest && parseInt(value, 10) < parseInt(latest, 10)) return { value, status: "outdated" };
  return { value, status: "ok" };
}

export function evaluateDevice(device, tables) {
  const platform = detectPlatform(device);
  const osVersion = device.osVersion ?? device.os_version ?? "";
  const os = assessOS(osVersion, platform, tables);
  const isMac = platform === "macOS";
  const findings = [];

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

  const xprotect = isMac ? assessXProtect(device.xprotect_version, tables.xprotectLatest) : { value: null, status: "absent" };
  if (xprotect.status === "outdated") findings.push(`XProtect outdated (${xprotect.value} -> ${tables.xprotectLatest})`);
  if (xprotect.status === "invalid") findings.push("XProtect invalid");

  const recommended = isMac
    ? recommendTarget(osVersion, device.model ?? "", tables)
    : os.status === "outdated"
      ? { target: os.latest, path: [osVersion, os.latest].filter(Boolean), replace: false }
      : { target: null, path: [osVersion], replace: false };

  // Latest available for this hardware: latestMinor = latest of the device's
  // current major track; latestMajor = latest of the newest major it can run.
  const map = isMac ? tables.macOS : tables.ios;
  const maxMajor = isMac ? (tables.modelMaxMajor.get(device.model ?? "") ?? null) : parseVersion(osVersion)[0];
  const latestMajor = maxMajor != null ? (map.get(maxMajor)?.latest ?? null) : null;

  return {
    id: device.id, name: device.name ?? "", deviceName: device.device_name ?? "",
    serial: device.serial ?? device.serial_number ?? "",
    deviceGroup: device.device_group ?? "",
    model: device.model ?? "", osVersion, platform,
    osStatus: os.status, latest: os.latest, latestMinor: os.latest, latestMajor, maxMajor,
    recommended, cvesBehind: os.cvesBehind, exploitedBehind: os.exploitedBehind,
    filevaultOk, sipOk, firewallOk, xprotect,
    hasFilevault: device.filevault_enabled === true, // raw, all-platform (for fleet count)
    findings, failCount: findings.length,
    lastSeen: device.last_seen_at ?? null,
  };
}

export function recommendTarget(version, model, tables) {
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
    if (m > currentMajor) path.push(tables.macOS.get(m).latest);
  }
  // same-major minor update
  if (path.length === 1) {
    const info = tables.macOS.get(currentMajor);
    if (info && compareVersions(version, info.latest) < 0) path.push(info.latest);
  }
  const target = path.length > 1 ? path[path.length - 1] : null;
  return { target, path, replace: false };
}

function buildMajorMap(feed) {
  const map = new Map();
  for (const osv of feed.OSVersions ?? []) {
    const latest = osv.Latest?.ProductVersion;
    if (!latest) continue;
    const major = parseVersion(latest)[0];
    const releases = (osv.SecurityReleases ?? [])
      .filter((r) => r.ProductVersion)
      .map((r) => ({
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

function topMajors(map, n = 3) {
  return [...map.keys()].sort((a, b) => b - a).slice(0, n);
}

export function assessOS(version, platform, tables) {
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
  const status = !supportedMajor ? "eol" : (isLatest ? "current" : "outdated");
  return { status, latest: info.latest, releasesBehind, cvesBehind, exploitedBehind, isLatest, supportedMajor };
}

// Map model identifier (e.g. "MacBookPro15,2", "Mac16,5") -> highest macOS major
// it supports, from SOFA's top-level Models map (Latest.SupportedDevices uses
// board IDs and does NOT match SimpleMDM model identifiers).
function buildModelMaxMajor(macFeed) {
  const m = new Map();
  for (const [id, info] of Object.entries(macFeed.Models ?? {})) {
    const oss = info.OSVersions ?? [];
    if (oss.length) m.set(id, Math.max(...oss));
  }
  return m;
}

export function buildMajorTables(macFeed, iosFeed) {
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

export function aggregateCveDetail(evaluatedDevices, tables) {
  const rows = [];
  for (const [track, map] of [["macOS", tables.macOS], ["iOS", tables.ios]]) {
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

// One row PER DEVICE, with that device's unfixed CVEs collapsed into a single
// multi-line `cves` cell (e.g. "🔴 CVE-2025-0001 (→15.7.7)\nCVE-2025-0002 (→15.7.7)").
// Enumerable for any major present in the feed, INCLUDING EOL majors (up to that
// major's final release). Only majors absent from the feed entirely are skipped.
export function deviceCveRows(evaluatedDevices, tables) {
  const rows = [];
  for (const d of evaluatedDevices) {
    const isMac = d.platform === "macOS";
    const isIos = d.platform === "iOS" || d.platform === "iPadOS";
    if (!isMac && !isIos) continue;
    const map = isMac ? tables.macOS : tables.ios;
    const major = parseVersion(d.osVersion)[0];
    const info = map.get(major);
    if (!info) continue;
    const cves = [];
    for (const r of info.releases) {
      if (compareVersions(r.ver, d.osVersion) > 0) {
        for (const cve of r.cveList) cves.push({ id: cve.id, fixed: r.ver, exploited: cve.exploited });
      }
    }
    if (cves.length === 0) continue;
    const lines = cves.map((c) => `${c.id} (->${c.fixed})${c.exploited ? " [exploited]" : ""}`);
    rows.push({
      name: d.name, serial: d.serial, model: d.model, os: d.osVersion,
      unfixed_count: cves.length,
      exploited_count: cves.filter((c) => c.exploited).length,
      cves: lines.join("\n"),
    });
  }
  return rows;
}

// Headline counts. Definitions chosen to mirror the dashboard layout:
//  - osOutdated  : devices NOT on the newest version their hardware can run.
//  - noFileVault : ALL devices without FileVault enabled (Mac-only feature, but
//                  non-Macs count as "no", matching the dashboard's total).
//  - noSip/noFirewall/xprotectOutdated : Mac-only.
//  - unfixedCves : number of DEVICES that are missing at least one CVE fix.
export function summarize(evaluatedDevices, cveDetail = []) {
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
    // (so the XProtect check should report N/A / "not set up", not 0).
    xprotectCollected: macs.some((d) => d.xprotect.status !== "absent"),
    unfixedCves: evaluatedDevices.filter((d) => (d.cvesBehind || 0) > 0).length,
  };
}
