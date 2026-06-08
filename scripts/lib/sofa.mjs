import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
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

// cacheDir: where to read/write cached copies; maxAgeMs: reuse cache if newer
export async function loadSofa(cacheDir, { noCache = false, maxAgeMs = 86400000 } = {}) {
  const out = {};
  for (const [key, url] of Object.entries(FEEDS)) {
    const path = `${cacheDir}/sofa-${key}.json`;
    let data;
    const fresh = !noCache && existsSync(path) && (Date.now() - statSync(path).mtimeMs) < maxAgeMs;
    if (fresh) {
      data = JSON.parse(readFileSync(path, "utf8"));
    } else {
      try {
        data = await fetchJson(url);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(data));
      } catch (err) {
        if (existsSync(path)) {
          console.warn(`WARN: ${err.message} — using cached ${path}`);
          data = JSON.parse(readFileSync(path, "utf8"));
        } else {
          throw err;
        }
      }
    }
    out[key] = data;
  }
  return { macFeed: out.macos, iosFeed: out.ios };
}
