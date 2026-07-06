import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const FEEDS = {
  macos: "https://sofafeed.macadmins.io/v1/macos_data_feed.json",
  ios: "https://sofafeed.macadmins.io/v1/ios_data_feed.json",
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SOFA fetch failed ${res.status} for ${url}`);
  return res.json();
}

// A feed without OSVersions would silently evaluate every device as "untracked"
// with zero CVE data — refuse it rather than cache it as truth for 24h.
function assertFeedShape(data, source) {
  if (!data || !Array.isArray(data.OSVersions) || data.OSVersions.length === 0) {
    throw new Error(`SOFA feed from ${source} has no OSVersions — refusing to use it`);
  }
  return data;
}

// Guarded read: a truncated/corrupt or wrong-shaped cache file returns null so
// callers fall back to a fetch instead of throwing a raw SyntaxError until the
// file ages out.
function readCached(path) {
  try {
    return assertFeedShape(JSON.parse(readFileSync(path, "utf8")), path);
  } catch {
    return null;
  }
}

// cacheDir: where to read/write cached copies; maxAgeMs: reuse cache if newer
export async function loadSofa(cacheDir, { noCache = false, maxAgeMs = 86400000 } = {}) {
  const out = {};
  for (const [key, url] of Object.entries(FEEDS)) {
    const path = `${cacheDir}/sofa-${key}.json`;
    let data = null;
    const fresh = !noCache && existsSync(path) && (Date.now() - statSync(path).mtimeMs) < maxAgeMs;
    if (fresh) data = readCached(path);
    if (!data) {
      try {
        data = assertFeedShape(await fetchJson(url), url);
        mkdirSync(dirname(path), { recursive: true });
        // Atomic temp+rename: a crash mid-write must not leave a truncated cache.
        writeFileSync(`${path}.tmp`, JSON.stringify(data));
        renameSync(`${path}.tmp`, path);
      } catch (err) {
        const cached = existsSync(path) ? readCached(path) : null;
        if (cached) {
          console.warn(`WARN: ${err.message} — using cached ${path}`);
          data = cached;
        } else {
          throw err;
        }
      }
    }
    out[key] = data;
  }
  return { macFeed: out.macos, iosFeed: out.ios };
}
