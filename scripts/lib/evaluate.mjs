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
  if (!info || !supported.includes(major)) {
    return { status: "eol", latest: info?.latest ?? null, releasesBehind: null, cvesBehind: null, exploitedBehind: null, isLatest: false };
  }
  let releasesBehind = 0, cvesBehind = 0, exploitedBehind = 0;
  for (const r of info.releases) {
    if (compareVersions(r.ver, version) >= 0 && compareVersions(r.ver, info.latest) < 0) {
      releasesBehind++; cvesBehind += r.cves; exploitedBehind += r.exploited;
    }
  }
  const isLatest = compareVersions(version, info.latest) >= 0;
  return { status: isLatest ? "current" : "outdated", latest: info.latest, releasesBehind, cvesBehind, exploitedBehind, isLatest };
}

export function buildMajorTables(macFeed, iosFeed) {
  const macOS = buildMajorMap(macFeed);
  const ios = buildMajorMap(iosFeed);
  const modelMaxMajor = new Map();
  for (const info of macOS.values()) {
    for (const model of info.supportedDevices) {
      const prev = modelMaxMajor.get(model) ?? 0;
      if (info.major > prev) modelMaxMajor.set(model, info.major);
    }
  }
  return {
    macOS,
    ios,
    supportedMacMajors: topMajors(macOS),
    supportedIosMajors: topMajors(ios),
    xprotectLatest: macFeed.XProtectPlistConfigData?.["com.apple.XProtect"] ?? null,
    modelMaxMajor,
  };
}
