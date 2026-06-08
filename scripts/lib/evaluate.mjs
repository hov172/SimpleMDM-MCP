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
