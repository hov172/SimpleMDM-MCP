#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localApp, checkLocalApp } from "./localAppClient.js";

// Resolved at startup from the sibling package.json so the server's reported
// version stays in sync with package.json automatically. Works in both the
// installed npm layout (dist/ + package.json siblings) and the Dockerfile
// layout (/app/dist/ + /app/package.json).
const PKG_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY        = process.env.SIMPLEMDM_API_KEY ?? "";
const ALLOW_WRITES   = process.env.SIMPLEMDM_ALLOW_WRITES === "true";
const USE_LOCAL_APP  = process.env.LOCAL_APP_MODE === "true";
const BASE           = "https://a.simplemdm.com/api/v1";

const MR_BASE    = process.env.MUNKIREPORT_BASE_URL ?? "";
const MR_PREFIX  = process.env.MUNKIREPORT_MODULE_PREFIX ?? "/module/simplemdm";
const MR_HNAME   = process.env.MUNKIREPORT_AUTH_HEADER_NAME ?? "";
const MR_HVALUE  = process.env.MUNKIREPORT_AUTH_HEADER_VALUE ?? "";
const MR_COOKIE  = process.env.MUNKIREPORT_COOKIE ?? "";

const REQUEST_TIMEOUT_MS = Number(process.env.SIMPLEMDM_TIMEOUT_MS ?? 30_000);
const MAX_RETRIES        = Number(process.env.SIMPLEMDM_MAX_RETRIES ?? 3);
const MAX_PAGES          = Number(process.env.SIMPLEMDM_MAX_PAGES ?? 200);
const CACHE_TTL_MS       = Number(process.env.SIMPLEMDM_CACHE_TTL_MS ?? 300_000); // 5 min default

// macOS support matrix keyed by Apple model identifier prefix.
// Source: Apple support docs as of 2024-11. Update on each macOS major release.
// Keys are matched as prefixes against the device's `model` attribute
// (e.g. "MacBookPro18,1", "Mac14,2"). The first matching prefix wins, so the
// list is ordered most-specific → least-specific.
const MACOS_SUPPORT_TABLE: ReadonlyArray<{ prefix: string; max_macos_major: number }> = [
  // Apple Silicon — every Mac{N},{M} family supports the macOS that shipped
  // with it and every subsequent release through current (15 Sequoia, 11/2024).
  { prefix: "Mac16,",       max_macos_major: 15 }, // M4 (2024)
  { prefix: "Mac15,",       max_macos_major: 15 }, // M3 (2023-24)
  { prefix: "Mac14,",       max_macos_major: 15 }, // M2 (2022-23)
  { prefix: "Mac13,",       max_macos_major: 15 }, // M1 Pro/Max/Ultra (2021-22)
  { prefix: "Mac11,",       max_macos_major: 15 }, // M1 (2020)
  // Intel — macOS 15 Sequoia supports 2018+ in most product lines.
  { prefix: "iMacPro1,",    max_macos_major: 15 },
  { prefix: "MacPro7,",     max_macos_major: 15 },
  { prefix: "Macmini8,",    max_macos_major: 15 },
  { prefix: "MacBookAir8,", max_macos_major: 15 }, { prefix: "MacBookAir9,",  max_macos_major: 15 }, { prefix: "MacBookAir10,", max_macos_major: 15 },
  { prefix: "MacBookPro15,",max_macos_major: 15 }, { prefix: "MacBookPro16,", max_macos_major: 15 }, { prefix: "MacBookPro17,", max_macos_major: 15 }, { prefix: "MacBookPro18,", max_macos_major: 15 },
  { prefix: "iMac19,",      max_macos_major: 15 }, { prefix: "iMac20,",       max_macos_major: 15 }, { prefix: "iMac21,",       max_macos_major: 15 },
  // Ventura (13) cut: roughly 2017 hardware.
  { prefix: "iMac18,",      max_macos_major: 13 },
  { prefix: "MacBookPro13,",max_macos_major: 13 }, { prefix: "MacBookPro14,", max_macos_major: 13 },
  { prefix: "MacBookAir7,", max_macos_major: 12 }, { prefix: "Macmini7,",     max_macos_major: 12 }, { prefix: "MacPro6,", max_macos_major: 12 },
  // Older — Big Sur (11) or earlier; sparse, listed as a coarse bucket.
  { prefix: "iMac17,",      max_macos_major: 11 }, { prefix: "MacBookPro11,", max_macos_major: 11 }, { prefix: "MacBookPro12,", max_macos_major: 11 },
];

// Currently shipping major version per Apple platform. Update on each Apple
// release alongside MACOS_SUPPORT_TABLE. Used as the baseline for OS-lag
// checks so the result doesn't depend on whatever happens to be running in
// the fleet (one beta device on a future macOS would otherwise make every
// other device look "decades behind").
//
// Override via env: CURRENT_SUPPORTED_OS_OVERRIDE='{"mac":15,"ios":18,"ipad":18}'
const CURRENT_SUPPORTED_OS: Readonly<Record<"mac" | "ios" | "ipad", number>> = (() => {
  const defaults = { mac: 15, ios: 18, ipad: 18 };
  const raw = process.env.CURRENT_SUPPORTED_OS_OVERRIDE;
  if (!raw) return defaults;
  try {
    const o = JSON.parse(raw) as Partial<Record<"mac" | "ios" | "ipad", number>>;
    return { mac: o.mac ?? defaults.mac, ios: o.ios ?? defaults.ios, ipad: o.ipad ?? defaults.ipad };
  } catch {
    return defaults;
  }
})();

function maxMacOSMajorFor(model: string | undefined): number | null {
  if (!model) return null;
  // Apply env override first if present (so admins can patch the table without redeploying).
  const overrideRaw = process.env.MAC_OS_ELIGIBILITY_OVERRIDE;
  if (overrideRaw) {
    try {
      const o = JSON.parse(overrideRaw) as Record<string, number>;
      for (const [prefix, max] of Object.entries(o)) {
        if (model.startsWith(prefix) && Number.isFinite(max)) return max;
      }
    } catch { /* ignore malformed override */ }
  }
  for (const row of MACOS_SUPPORT_TABLE) if (model.startsWith(row.prefix)) return row.max_macos_major;
  return null;
}

// Default worker count for fleet-wide aggregations. SimpleMDM's published
// rate limit (1 req/sec sustained, with bursts) tolerates 8 well; raise via
// env if your tenant has a higher limit, lower it if you see 429s.
const DEFAULT_FLEET_CONCURRENCY = Number(process.env.SIMPLEMDM_FLEET_CONCURRENCY ?? 8);

// Pre-computed auth header — avoids re-encoding on every request.
const AUTH_HEADER = API_KEY ? `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}` : "";

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(readonly upstream: string, readonly status: number, readonly bodyExcerpt: string) {
    super(`${upstream} ${status}`);
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchWithRetry(upstream: string, url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Retry 429 and 5xx with Retry-After / exponential backoff.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 10_000);
        await sleep(delayMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES) break;
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }
  throw new Error(`${upstream} request failed after ${MAX_RETRIES + 1} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

async function throwForStatus(upstream: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  // Cap body excerpt to avoid leaking large upstream payloads into client errors.
  const excerpt = body.slice(0, 500);
  throw new HttpError(upstream, res.status, excerpt);
}

async function simpleMDM(path: string, opts: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: AUTH_HEADER,
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (opts.body != null) headers["Content-Type"] = "application/json";
  const res = await fetchWithRetry("SimpleMDM", `${BASE}${path}`, { ...opts, headers });
  if (!res.ok) await throwForStatus("SimpleMDM", res);
  if (res.status === 204) return { success: true };
  return res.json();
}

async function munkiReport(route: string): Promise<unknown> {
  if (!MR_BASE) throw new Error("MunkiReport not configured — set MUNKIREPORT_BASE_URL.");
  const headers: Record<string, string> = {};
  if (MR_COOKIE) headers["Cookie"] = MR_COOKIE;
  if (MR_HNAME) {
    if (!MR_HVALUE) throw new Error("MunkiReport auth header set (MUNKIREPORT_AUTH_HEADER_NAME) but MUNKIREPORT_AUTH_HEADER_VALUE is empty.");
    headers[MR_HNAME] = MR_HVALUE;
  }
  const res = await fetchWithRetry("MunkiReport", `${MR_BASE}${MR_PREFIX}${route}`, { headers });
  if (!res.ok) await throwForStatus("MunkiReport", res);
  return res.json();
}

async function api(path: string, opts: RequestInit = {}): Promise<unknown> {
  return USE_LOCAL_APP ? localApp(path, opts) : simpleMDM(path, opts);
}

function requireWrites(): void {
  if (!ALLOW_WRITES) throw new Error(
    "Write actions are disabled. Set SIMPLEMDM_ALLOW_WRITES=true to enable. " +
    "Use a key scoped to minimum required permissions before doing so."
  );
}

function j(body: unknown): string { return JSON.stringify(body); }

// seg() — encode an untrusted value for use as a single URL path segment.
// Rejects non-string/number values and values containing "/" or control chars,
// preventing path traversal and query injection via tool arguments.
function seg(value: unknown, name = "path segment"): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error(`Invalid ${name}: expected string or number, got ${typeof value}`);
  const s = String(value);
  if (s.length === 0) throw new Error(`Invalid ${name}: empty`);
  // eslint-disable-next-line no-control-regex
  if (/[\/\?\#\x00-\x1f]/.test(s)) throw new Error(`Invalid ${name}: contains disallowed characters`);
  return encodeURIComponent(s);
}

type DeviceAttributes = {
  status?: string | null;
  enrollment_status?: string | null;
  os_version?: string | null;
  is_supervised?: boolean | null;
  dep_enrolled?: boolean | null;
  filevault_enabled?: boolean | null;
  [key: string]: unknown;
};

type DeviceRecord = {
  id: string | number;
  attributes: DeviceAttributes;
};

type InstalledAppAttributes = {
  identifier?: string | null;
  bundle_identifier?: string | null;
  name?: string | null;
  short_version?: string | null;
  managed?: boolean | null;
  [key: string]: unknown;
};

type InstalledAppRecord = {
  id: string | number;
  attributes: InstalledAppAttributes;
};

type PaginatedResponse<T> = {
  data: T[];
  has_more: boolean;
};

function getDeviceStatus(attributes: DeviceAttributes): string {
  return attributes.status ?? attributes.enrollment_status ?? "unknown";
}

// Paginate SimpleMDM /devices bypassing the local-app shortcut (used by derived
// fleet rollups). Hard-capped by MAX_PAGES to bound memory/time.
async function* paginateDevices(): AsyncGenerator<DeviceRecord> {
  let cursor: string | number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
    const p = await simpleMDM(`/devices?limit=100${q}`) as PaginatedResponse<DeviceRecord>;
    for (const d of p.data) yield d;
    if (!p.has_more) return;
    cursor = p.data.at(-1)?.id;
    if (cursor == null) return;
  }
  throw new Error(`paginateDevices: exceeded ${MAX_PAGES}-page cap; set SIMPLEMDM_MAX_PAGES to raise.`);
}

async function collectDevices(): Promise<DeviceRecord[]> {
  const cacheKey = "__collectDevices__";
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() <= hit.expiry) return hit.data as DeviceRecord[];
  const out: DeviceRecord[] = [];
  for await (const d of paginateDevices()) out.push(d);
  listCache.set(cacheKey, { data: out, expiry: Date.now() + CACHE_TTL_MS });
  return out;
}

// Paginate one device's installed_apps list (some Macs have hundreds).
// Throws on MAX_PAGES exhaustion to match paginateDevices() behavior — silent
// truncation in an aggregation tool produces wrong rollups, not partial ones.
async function collectInstalledApps(deviceId: string | number): Promise<InstalledAppRecord[]> {
  const cacheKey = `__installedApps__${deviceId}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() <= hit.expiry) return hit.data as InstalledAppRecord[];
  const id = encodeURIComponent(String(deviceId));
  const out: InstalledAppRecord[] = [];
  let cursor: string | number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
    const p = await simpleMDM(`/devices/${id}/installed_apps?limit=100${q}`) as PaginatedResponse<InstalledAppRecord>;
    for (const a of p.data) out.push(a);
    if (!p.has_more) { listCache.set(cacheKey, { data: out, expiry: Date.now() + CACHE_TTL_MS }); return out; }
    cursor = p.data.at(-1)?.id;
    if (cursor == null) { listCache.set(cacheKey, { data: out, expiry: Date.now() + CACHE_TTL_MS }); return out; }
  }
  throw new Error(`collectInstalledApps(${deviceId}): exceeded ${MAX_PAGES}-page cap; raise SIMPLEMDM_MAX_PAGES.`);
}

// ─── Response slimming for list endpoints ────────────────────────────────────
// Some SimpleMDM list endpoints embed full relationship arrays (every device ID,
// profile ID, etc.) on each record.  For endpoints with 100+ records this blows
// up the payload and causes MCP transport truncation.  slimRelationships()
// replaces heavy arrays with a count, while keeping lightweight ones (apps) as
// full ID lists so callers can still map names without a per-group fetch.

type RelBlock = { data?: Array<{ id: string | number; type?: string; [k: string]: unknown }> };
type AnyRecord = { id: string | number; attributes?: Record<string, unknown>; relationships?: Record<string, RelBlock | unknown> };

const KEEP_IDS_THRESHOLD = 200; // relationship arrays ≤ this keep full IDs

function slimRelationships<T extends AnyRecord>(records: T[]): T[] {
  return records.map(r => {
    if (!r.relationships) return r;
    const slim: Record<string, unknown> = {};
    for (const [key, rel] of Object.entries(r.relationships)) {
      const block = rel as RelBlock | undefined;
      if (!block?.data || !Array.isArray(block.data)) { slim[key] = rel; continue; }
      if (block.data.length <= KEEP_IDS_THRESHOLD) {
        // Keep just IDs — strip any extra fields per item to save space
        slim[key] = { data: block.data.map(d => ({ type: d.type, id: d.id })), count: block.data.length };
      } else {
        // Too many — collapse to count only
        slim[key] = { count: block.data.length };
      }
    }
    return { ...r, relationships: slim };
  });
}

// ─── In-memory TTL cache for paginated list results ──────────────────────────
// Keyed by request path (includes query-string filters). Entries auto-expire
// after CACHE_TTL_MS. Write operations invalidate related entries via prefix
// matching so subsequent reads pick up changes immediately.

type CacheEntry = { data: unknown[]; expiry: number };
const listCache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): { data: T[]; has_more: false } | undefined {
  const entry = listCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) { listCache.delete(key); return undefined; }
  return { data: entry.data as T[], has_more: false };
}

function cacheSet(key: string, data: unknown[]): void {
  listCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// Invalidate all cache entries whose key starts with any of the given prefixes.
// The special prefix "/devices" also clears collectDevices() and per-device
// installed-app caches, since device mutations can affect fleet rollups.
function cacheInvalidate(...prefixes: string[]): void {
  const alsoDevices = prefixes.some(p => p === "/devices");
  const alsoApps = prefixes.some(p => p === "/apps" || p === "/installed_apps");
  for (const key of listCache.keys()) {
    if (prefixes.some(p => key.startsWith(p))) { listCache.delete(key); continue; }
    if (alsoDevices && key === "__collectDevices__") { listCache.delete(key); continue; }
    if ((alsoDevices || alsoApps) && key.startsWith("__installedApps__")) { listCache.delete(key); continue; }
  }
}

// Maps a write-operation tool name to the cache key prefixes it should
// invalidate. Covers every tool that calls requireWrites().
const INVALIDATION_MAP: Record<string, string[]> = {
  create_device:                       ["/devices"],
  update_device:                       ["/devices"],
  delete_device:                       ["/devices"],
  delete_device_user:                  ["/devices"],
  lock_device:                         ["/devices"],
  wipe_device:                         ["/devices"],
  sync_device:                         ["/devices"],
  restart_device:                      ["/devices"],
  shutdown_device:                     ["/devices"],
  unenroll_device:                     ["/devices"],
  clear_passcode:                      ["/devices"],
  clear_restrictions_password:         ["/devices"],
  update_os:                           ["/devices"],
  enable_lost_mode:                    ["/devices"],
  disable_lost_mode:                   ["/devices"],
  play_lost_mode_sound:                ["/devices"],
  update_lost_mode_location:           ["/devices"],
  clear_firmware_password:             ["/devices"],
  rotate_firmware_password:            ["/devices"],
  clear_recovery_lock_password:        ["/devices"],
  rotate_recovery_lock_password:       ["/devices"],
  rotate_filevault_recovery_key:       ["/devices"],
  set_admin_password:                  ["/devices"],
  rotate_admin_password:               ["/devices"],
  enable_remote_desktop:               ["/devices"],
  disable_remote_desktop:              ["/devices"],
  enable_bluetooth:                    ["/devices"],
  disable_bluetooth:                   ["/devices"],
  set_time_zone:                       ["/devices"],
  create_assignment_group:             ["/assignment_groups"],
  update_assignment_group:             ["/assignment_groups"],
  delete_assignment_group:             ["/assignment_groups"],
  assign_device_to_group:              ["/assignment_groups", "/devices"],
  unassign_device_from_group:          ["/assignment_groups", "/devices"],
  assign_app_to_group:                 ["/assignment_groups", "/apps"],
  unassign_app_from_group:             ["/assignment_groups", "/apps"],
  assign_profile_to_group:             ["/assignment_groups", "/profiles"],
  unassign_profile_from_group:         ["/assignment_groups", "/profiles"],
  push_apps_to_group:                  ["/assignment_groups"],
  update_apps_in_group:                ["/assignment_groups", "/apps"],
  sync_profiles_in_group:              ["/assignment_groups", "/profiles"],
  clone_assignment_group:              ["/assignment_groups"],
  create_app:                          ["/apps"],
  update_app:                          ["/apps"],
  delete_app:                          ["/apps"],
  request_app_management:              ["/installed_apps", "/apps"],
  update_installed_app:                ["/installed_apps", "/apps"],
  uninstall_app:                       ["/installed_apps", "/apps"],
  create_custom_attribute:             ["/custom_attributes"],
  update_custom_attribute:             ["/custom_attributes"],
  delete_custom_attribute:             ["/custom_attributes"],
  set_device_attribute_value:          ["/custom_attributes"],
  set_attribute_for_multiple_devices:  ["/custom_attributes"],
  set_group_attribute_value:           ["/custom_attributes"],
  create_custom_configuration_profile: ["/custom_configuration_profiles"],
  update_custom_configuration_profile: ["/custom_configuration_profiles"],
  delete_custom_configuration_profile: ["/custom_configuration_profiles"],
  assign_custom_profile_to_device:     ["/custom_configuration_profiles"],
  unassign_custom_profile_from_device: ["/custom_configuration_profiles"],
  create_custom_declaration:           ["/custom_declarations"],
  update_custom_declaration:           ["/custom_declarations"],
  delete_custom_declaration:           ["/custom_declarations"],
  assign_declaration_to_device:        ["/custom_declarations"],
  unassign_declaration_from_device:    ["/custom_declarations"],
  assign_profile_to_device:            ["/profiles"],
  unassign_profile_from_device:        ["/profiles"],
  sync_dep_server:                     ["/dep_servers"],
  send_enrollment_invitation:          ["/enrollments"],
  delete_enrollment:                   ["/enrollments"],
  create_managed_app_config:           ["/apps"],
  delete_managed_app_config:           ["/apps"],
  push_managed_app_configs:            ["/apps"],
  create_script:                       ["/scripts"],
  update_script:                       ["/scripts"],
  delete_script:                       ["/scripts"],
  create_script_job:                   ["/script_jobs"],
  cancel_script_job:                   ["/script_jobs"],
  update_account:                      [],
};

// Stampede guard: if multiple callers request the same path concurrently, only
// one fetch runs; the rest await its result.
const inflight = new Map<string, Promise<{ data: unknown[]; has_more: false }>>();

// Generic paginator for SimpleMDM list endpoints. SimpleMDM caps page size at
// 100; we walk pages with starting_after until has_more is false. Returns the
// standard { data, has_more: false } shape so callers can treat it as one page.
// Results are cached in-memory for CACHE_TTL_MS; write operations invalidate
// the relevant entries via INVALIDATION_MAP.
async function collectAllPages<T extends { id: string | number }>(
  path: string,
): Promise<{ data: T[]; has_more: false }> {
  const cached = cacheGet<T>(path);
  if (cached) return cached;

  const existing = inflight.get(path);
  if (existing) return existing as Promise<{ data: T[]; has_more: false }>;

  const work = (async (): Promise<{ data: T[]; has_more: false }> => {
    const sep = path.includes("?") ? "&" : "?";
    const out: T[] = [];
    let cursor: string | number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
      const p = await api(`${path}${sep}limit=100${q}`) as PaginatedResponse<T>;
      for (const r of p.data) out.push(r);
      if (!p.has_more) { cacheSet(path, out); return { data: out, has_more: false }; }
      cursor = p.data.at(-1)?.id;
      if (cursor == null) { cacheSet(path, out); return { data: out, has_more: false }; }
    }
    throw new Error(`collectAllPages(${path}): exceeded ${MAX_PAGES}-page cap; raise SIMPLEMDM_MAX_PAGES.`);
  })();

  inflight.set(path, work as Promise<{ data: unknown[]; has_more: false }>);
  try { return await work; } finally { inflight.delete(path); }
}

// Generic concurrent per-device iteration. Caller supplies a filter (which
// devices to visit) and a worker (returns a result row or undefined to skip).
async function forEachDevice<T>(
  concurrency: number,
  filter: (d: DeviceRecord) => boolean,
  fn: (d: DeviceRecord) => Promise<T | undefined>,
): Promise<{ results: T[]; devices_processed: number; devices_with_errors: number }> {
  const all = await collectDevices();
  const queue = all.filter(filter);
  const results: T[] = [];
  let processed = 0;
  let errors = 0;
  const worker = async () => {
    while (queue.length) {
      const d = queue.pop()!;
      try {
        const r = await fn(d);
        if (r !== undefined) results.push(r);
        processed++;
      } catch { errors++; }
    }
  };
  const conc = Math.max(1, Math.min(16, concurrency));
  await Promise.all(Array.from({ length: conc }, worker));
  return { results, devices_processed: processed, devices_with_errors: errors };
}

// Iterate every enrolled device's installed apps with bounded concurrency.
// Used by the cross-fleet aggregation tools (get_top_installed_apps,
// get_app_coverage, get_unmanaged_apps). Errors per device are counted
// but do not abort the whole run — partial results are usually still useful.
async function forEachDeviceInstalledApps(
  concurrency: number,
  onDevice: (device: DeviceRecord, apps: InstalledAppRecord[]) => void,
): Promise<{ devices_processed: number; devices_with_errors: number }> {
  const devices = await collectDevices();
  const enrolled = devices.filter(d => getDeviceStatus(d.attributes) === "enrolled");
  const queue = [...enrolled];
  let errors = 0;
  let processed = 0;
  const worker = async () => {
    while (queue.length) {
      const d = queue.pop()!;
      try {
        const apps = await collectInstalledApps(d.id);
        onDevice(d, apps);
        processed++;
      } catch {
        errors++;
      }
    }
  };
  const conc = Math.max(1, Math.min(16, concurrency));
  await Promise.all(Array.from({ length: conc }, worker));
  return { devices_processed: processed, devices_with_errors: errors };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNT
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_account",
    description: "Retrieve account info: name, App Store country, and subscription license counts.",
    inputSchema: { type: "object", properties: {} } },

  { name: "update_account",
    description: "⚠️ WRITE — Update account settings (name, apple_store_country_code).",
    inputSchema: { type: "object", properties: {
      name: { type: "string" },
      apple_store_country_code: { type: "string", description: "Two-letter country code e.g. US, AU, GB." },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET SUMMARY (derived)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_fleet_summary",
    description: "Derived fleet KPIs: total devices, enrolled/unenrolled counts, supervised/DEP/FileVault posture counts, plus OS and device status breakdowns. In local app mode this is instant.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_device_full_profile",
    description: "Compound tool — fetches device detail, installed profiles, installed apps, users, and recent logs in parallel for a single device. Accepts either device_id or serial_number (serial is resolved first).",
    inputSchema: { type: "object", properties: {
      device_id: { type: "string", description: "SimpleMDM device ID. Preferred when known." },
      serial_number: { type: "string", description: "Device serial — resolved to an ID via list_devices before the parallel fetch." },
    }}},

  { name: "get_security_posture",
    description: "Compound tool — fleet-wide security rollup. Returns percentages and raw counts for supervised, DEP-enrolled, FileVault-enabled, recovery-lock, firmware-password, activation-lock, and user-approved-MDM posture across all enrolled devices, plus OS currency buckets (macOS / iOS / iPadOS).",
    inputSchema: { type: "object", properties: {} } },

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET ANALYTICS (derived — iterate every device)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_top_installed_apps",
    description: "Derived — rank apps by install count across the fleet. Iterates every enrolled device's installed_apps. Slow on large fleets (one HTTP call per device) but bounded by concurrency. Use to spot catalog gaps and shadow IT footprint.",
    inputSchema: { type: "object", properties: {
      limit: { type: "number", description: "Max apps to return. Default 25, max 500." },
      exclude_apple: { type: "boolean", description: "Exclude com.apple.* bundle IDs (macOS/iOS built-ins). Default true." },
      min_install_count: { type: "number", description: "Drop apps installed on fewer than N devices. Default 1." },
    }}},

  { name: "get_app_coverage",
    description: "Derived — for a given bundle_identifier, return install percentage and the list of devices that DO NOT have it installed. Use to verify required tools (e.g. CrowdStrike, 1Password, VPN client) are deployed everywhere.",
    inputSchema: { type: "object", required: ["bundle_identifier"], properties: {
      bundle_identifier: { type: "string", description: "Exact bundle identifier to check (e.g. com.google.Chrome)." },
    }}},

  { name: "get_stale_devices",
    description: "Derived — devices that have not checked in within the last N days. Reads device records only (no installed_apps iteration), so this is fast. Returns sorted by days_since (oldest first).",
    inputSchema: { type: "object", properties: {
      days: { type: "number", description: "Days since last check-in to consider stale. Default 14." },
      include_unenrolled: { type: "boolean", description: "Include unenrolled devices in the result. Default false." },
    }}},

  { name: "get_storage_health",
    description: "Derived — devices with low free disk space and/or low battery. Reads device records only. Returns two sorted lists (low_disk_devices, low_battery_devices). Useful for proactive replacement / cleanup tickets.",
    inputSchema: { type: "object", properties: {
      low_disk_gb: { type: "number", description: "Free-space threshold in GB. Devices with available_device_capacity below this are flagged. Default 20." },
      low_battery_pct: { type: "number", description: "Battery level threshold percentage. Devices at or below this are flagged. Default 20." },
    }}},

  { name: "get_unmanaged_apps",
    description: "Derived — apps installed on the fleet but NOT present in the SimpleMDM catalog. Iterates every device. Use for shadow-IT discovery: which third-party apps should be brought under management?",
    inputSchema: { type: "object", properties: {
      min_install_count: { type: "number", description: "Drop apps installed on fewer than N devices. Default 5." },
      limit: { type: "number", description: "Max apps to return. Default 50, max 500." },
      exclude_apple: { type: "boolean", description: "Exclude com.apple.* bundle IDs. Default true." },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET ANALYTICS — Tier 1 (high-impact derived tools)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_app_version_drift",
    description: "Derived — for one bundle_identifier, return the distribution of installed versions across the fleet plus per-device install rows. Iterates every enrolled device. Use to find devices stuck on outdated versions.",
    inputSchema: { type: "object", required: ["bundle_identifier"], properties: {
      bundle_identifier: { type: "string", description: "Exact bundle identifier to inspect (e.g. com.google.Chrome)." },
    }}},

  { name: "get_compliance_violators",
    description: "Derived — single call returning enrolled devices that fail one or more compliance checks. Defaults: passcode_compliant, filevault_enabled (Macs), supervised, user_approved_mdm, OS within 2 majors of currently-supported. Reads device records only — fast. The OS-lag baseline is the platform's currently-shipping major (macOS 15 / iOS 18 / iPadOS 18 as of 2024-11), NOT the fleet maximum, so a single beta device cannot skew the result. Override via CURRENT_SUPPORTED_OS_OVERRIDE env var.",
    inputSchema: { type: "object", properties: {
      require_passcode_compliant: { type: "boolean", description: "Default true." },
      require_filevault_macs: { type: "boolean", description: "Require FileVault on for Macs. Default true." },
      require_supervised: { type: "boolean", description: "Default true." },
      require_user_approved_mdm: { type: "boolean", description: "Default true." },
      max_os_major_lag: { type: "number", description: "Max major versions behind the currently-supported major before flagging. Default 2." },
      skip_os_check: { type: "boolean", description: "Skip the OS-lag check entirely. Default false." },
      unsupported_lag_threshold: { type: "number", description: "Devices more than this many majors behind get the `os_unsupported` failure label instead of a numeric lag (Apple typically supports current + 2 prior majors). Default 3." },
    }}},

  { name: "get_devices_missing_profile",
    description: "Derived — list devices that DO NOT have a given configuration profile installed. Iterates every enrolled device's profiles list.",
    inputSchema: { type: "object", required: ["profile_id"], properties: {
      profile_id: { type: "string", description: "SimpleMDM profile ID to check coverage for." },
    }}},

  { name: "get_pending_commands",
    description: "Derived — devices with MDM commands sent but not acknowledged for over N hours. Reads the global /logs feed (no per-device fan-out) and pairs `*sent` events against `*acknowledged`/`*succeeded`/`*failed` events by device_id. Returns empty if /logs does not surface command events for your tenant.",
    inputSchema: { type: "object", properties: {
      min_age_hours: { type: "number", description: "Minimum age of the unacknowledged sent-event in hours. Default 4." },
      log_pages: { type: "number", description: "Pages of /logs to scan (100 entries each). Default 5." },
    }}},

  { name: "get_dep_drift",
    description: "Derived — DEP devices in Apple Business Manager whose assigned `profile_uuid` does not match the `default_assignment_profile_uuid` of the SimpleMDM dep_server they belong to. Indicates manual ABM intervention or a stale default. Does not require per-device search.",
    inputSchema: { type: "object", properties: {
      dep_server_id: { type: "string", description: "Restrict to one DEP server. Default: scan all." },
    }}},

  { name: "get_os_eligibility",
    description: "Derived — for each Mac, list current macOS major and the maximum macOS major Apple supports for that model identifier, using a built-in static table (last updated 2024-11; macOS 15 Sequoia compatibility). Returns max_supported_major=null for unknown models. Optional MAC_OS_ELIGIBILITY_OVERRIDE env var (JSON) merges into the table.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_dep_unassigned",
    description: "Derived — DEP devices visible in Apple Business Manager (via list_dep_devices) that are not yet assigned to a SimpleMDM enrollment / profile.",
    inputSchema: { type: "object", properties: {
      dep_server_id: { type: "string", description: "Specific DEP server. If omitted, scans all configured DEP servers." },
    }}},

  { name: "get_recently_enrolled",
    description: "Derived — devices enrolled in the last N days. Reads device records only — fast.",
    inputSchema: { type: "object", properties: {
      days: { type: "number", description: "Look-back window in days. Default 7." },
    }}},

  { name: "get_lost_mode_devices",
    description: "Derived — devices currently in lost mode, with last known location and lost-mode entry time when reported.",
    inputSchema: { type: "object", properties: {} } },

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET ANALYTICS — Tier 2 (operational rollups)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_app_install_failures",
    description: "Derived — devices where a managed app push failed or is stuck pending. Iterates per-device installed_apps and inspects state. Sparse if SimpleMDM does not return install_status.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_battery_health_report",
    description: "Derived — battery rollup for laptops/iOS: current level, low-battery flag. Beyond level (cycle count, max-capacity %) requires MunkiReport integration; falls back gracefully when not available.",
    inputSchema: { type: "object", properties: {
      low_pct: { type: "number", description: "Threshold considered 'low'. Default 20." },
    }}},

  { name: "get_network_summary",
    description: "Derived — Wi-Fi MAC, ethernet MACs, last-seen IP, carrier breakdown (cellular). Useful for cellular fleets and IP-allow-list audits.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_user_attribution",
    description: "Derived — device → primary user mapping rollup, reading a custom_attribute. Returns devices grouped by user plus 'unattributed' devices.",
    inputSchema: { type: "object", required: ["custom_attribute_name"], properties: {
      custom_attribute_name: { type: "string", description: "Name of the custom attribute that holds the primary user (e.g. 'primary_user_email')." },
    }}},

  { name: "get_inactive_assignment_groups",
    description: "Derived — assignment groups with zero devices. Cleanup target.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_orphaned_profiles",
    description: "Derived — configuration profiles in the catalog that are not attached to any assignment group (and therefore not deployed via group membership).",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_orphaned_apps",
    description: "Derived — apps in the catalog that are not attached to any assignment group.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_app_size_footprint",
    description: "Derived — fleet-wide storage cost per app, computed as sum(app_size_bytes × install_count). Iterates every device's installed_apps. Sparse if SimpleMDM does not return app size.",
    inputSchema: { type: "object", properties: {
      limit: { type: "number", description: "Max apps to return. Default 25." },
    }}},

  { name: "get_assignment_group_drift",
    description: "Derived — devices whose installed apps diverge from the assigned-app set of any assignment group they belong to (apps missing from devices that should have them, per group membership).",
    inputSchema: { type: "object", properties: {
      assignment_group_id: { type: "string", description: "Restrict the drift check to a single assignment group. Default: all groups." },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET ANALYTICS — Tier 3 (niche / context-specific)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_certificate_expiration_audit",
    description: "Derived — APNs / MDM push certificate expiration. Inspects get_push_certificate. Lists days remaining and a renewal warning band (90/60/30).",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_enrollment_token_audit",
    description: "Derived — list enrollments with creation date, last-used date (when reported), and a stale flag for enrollments not used in over N days.",
    inputSchema: { type: "object", properties: {
      stale_days: { type: "number", description: "Days without use to mark as stale. Default 90." },
    }}},

  { name: "get_device_user_count_outliers",
    description: "Derived — Macs with unusually many local user accounts (default >5). Often indicates a shared device or stale local accounts.",
    inputSchema: { type: "object", properties: {
      min_users: { type: "number", description: "Threshold for 'too many'. Default 5." },
    }}},

  { name: "get_supervision_drift",
    description: "Derived — currently unsupervised devices that are DEP-enrolled (and therefore should be supervised). Indicates supervision lost via re-image or restore.",
    inputSchema: { type: "object", properties: {} } },

  // ══════════════════════════════════════════════════════════════════════════
  // FLEET ANALYTICS — Tier 4 selection
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_apps_by_publisher",
    description: "Derived — group top installed apps by publisher prefix (com.google.*, com.microsoft.*, com.adobe.*, etc.) and return per-publisher install totals plus app breakdown. Iterates every device; share input with get_top_installed_apps.",
    inputSchema: { type: "object", properties: {
      limit_publishers: { type: "number", description: "Max publishers to return. Default 20." },
      exclude_apple: { type: "boolean", description: "Exclude com.apple.* publisher. Default true." },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEVICES — read
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_devices",
    description: "List and search devices. Filter by name, serial, UDID, IMEI, or MAC. Auto-paginates to return all results.",
    inputSchema: { type: "object", properties: {
      search: { type: "string" },
      include_awaiting_enrollment: { type: "boolean" },
    }}},

  { name: "get_device",
    description: "Full detail for one device: hardware, OS version, enrollment status, supervised/DEP/FileVault posture, battery, storage, custom attributes.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
    }}},

  { name: "get_device_profiles",
    description: "Configuration profiles installed on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "get_device_installed_apps",
    description: "Apps installed on a device with managed/unmanaged state and catalog match.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "get_device_users",
    description: "User accounts on a device (macOS only).",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "get_device_logs",
    description: "MDM command logs for a device by serial number.",
    inputSchema: { type: "object", required: ["serial_number"], properties: { serial_number: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEVICES — write (management)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "create_device",
    description: "⚠️ WRITE — Create a device placeholder record.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string" },
      group_id: { type: "string", description: "Optional device group ID to assign to." },
    }}},

  { name: "update_device",
    description: "⚠️ WRITE — Update a device record (name, device_name).",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      name: { type: "string", description: "SimpleMDM display name." },
      device_name: { type: "string", description: "Name pushed to the device itself." },
    }}},

  { name: "delete_device",
    description: "⚠️ WRITE — Delete a device record from SimpleMDM. Does not wipe the device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "delete_device_user",
    description: "⚠️ WRITE — Delete a user account from a device.",
    inputSchema: { type: "object", required: ["device_id", "user_id"], properties: {
      device_id: { type: "string" },
      user_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEVICES — actions
  // ══════════════════════════════════════════════════════════════════════════
  { name: "lock_device",
    description: "⚠️ WRITE — Remote lock. Optional message and 6-digit PIN on macOS.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      message: { type: "string" },
      pin: { type: "string", description: "6-digit PIN (macOS)." },
    }}},

  { name: "wipe_device",
    description: "⚠️ WRITE DESTRUCTIVE — Remote wipe. Erases all data on the device. Irreversible.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      pin: { type: "string", description: "Optional 6-digit PIN to set after wipe (macOS)." },
    }}},

  { name: "sync_device",
    description: "⚠️ WRITE — Force device to re-check in with SimpleMDM immediately.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "restart_device",
    description: "⚠️ WRITE — Remote restart. Device must be supervised.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "shutdown_device",
    description: "⚠️ WRITE — Remote shutdown. Device must be supervised.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "unenroll_device",
    description: "⚠️ WRITE — Unenroll a device from MDM management.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_passcode",
    description: "⚠️ WRITE — Clear the device passcode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_restrictions_password",
    description: "⚠️ WRITE — Clear the restrictions password on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "update_os",
    description: "⚠️ WRITE — Trigger a managed OS update.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_lost_mode",
    description: "⚠️ WRITE — Enable Lost Mode on a supervised iOS device.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      message: { type: "string" },
      phone_number: { type: "string" },
      footnote: { type: "string" },
    }}},

  { name: "disable_lost_mode",
    description: "⚠️ WRITE — Disable Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "play_lost_mode_sound",
    description: "⚠️ WRITE — Play a sound on a device in Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "update_lost_mode_location",
    description: "⚠️ WRITE — Request a location update on a device in Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_firmware_password",
    description: "⚠️ WRITE — Clear the firmware password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_firmware_password",
    description: "⚠️ WRITE — Rotate the firmware password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_recovery_lock_password",
    description: "⚠️ WRITE — Clear the recovery lock password on an Apple Silicon Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_recovery_lock_password",
    description: "⚠️ WRITE — Rotate the recovery lock password on an Apple Silicon Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_filevault_recovery_key",
    description: "⚠️ WRITE — Rotate the FileVault recovery key on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_admin_password",
    description: "⚠️ WRITE — Set the local admin password on a Mac.",
    inputSchema: { type: "object", required: ["device_id", "new_password"], properties: {
      device_id: { type: "string" },
      new_password: { type: "string" },
    }}},

  { name: "rotate_admin_password",
    description: "⚠️ WRITE — Rotate the local admin password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_remote_desktop",
    description: "⚠️ WRITE — Enable Remote Desktop (ARD) on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "disable_remote_desktop",
    description: "⚠️ WRITE — Disable Remote Desktop (ARD) on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_bluetooth",
    description: "⚠️ WRITE — Enable Bluetooth on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "disable_bluetooth",
    description: "⚠️ WRITE — Disable Bluetooth on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_time_zone",
    description: "⚠️ WRITE — Set the time zone on a device.",
    inputSchema: { type: "object", required: ["device_id", "time_zone"], properties: {
      device_id: { type: "string" },
      time_zone: { type: "string", description: "IANA time zone name e.g. America/New_York." },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // ASSIGNMENT GROUPS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_assignment_groups",
    description: "List all assignment groups.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_assignment_group",
    description: "Full detail for one assignment group including app, profile, and device membership.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "create_assignment_group",
    description: "⚠️ WRITE — Create a new static assignment group.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string" },
      auto_deploy: { type: "boolean", description: "Auto-push apps when devices join. Default true." },
    }}},

  { name: "update_assignment_group",
    description: "⚠️ WRITE — Update an assignment group name or auto_deploy setting.",
    inputSchema: { type: "object", required: ["group_id"], properties: {
      group_id: { type: "string" },
      name: { type: "string" },
      auto_deploy: { type: "boolean" },
    }}},

  { name: "delete_assignment_group",
    description: "⚠️ WRITE — Delete an assignment group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "assign_device_to_group",
    description: "⚠️ WRITE — Add a device to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "device_id"], properties: {
      group_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_device_from_group",
    description: "⚠️ WRITE — Remove a device from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "device_id"], properties: {
      group_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "assign_app_to_group",
    description: "⚠️ WRITE — Assign an app to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "app_id"], properties: {
      group_id: { type: "string" },
      app_id: { type: "string" },
      deployment_type: { type: "string", description: "standard or munki. Default standard." },
      install_type: { type: "string", description: "managed, self_serve, default_installs, managed_updates." },
    }}},

  { name: "unassign_app_from_group",
    description: "⚠️ WRITE — Remove an app from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "app_id"], properties: {
      group_id: { type: "string" }, app_id: { type: "string" },
    }}},

  { name: "assign_profile_to_group",
    description: "⚠️ WRITE — Assign a profile to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "profile_id"], properties: {
      group_id: { type: "string" }, profile_id: { type: "string" },
    }}},

  { name: "unassign_profile_from_group",
    description: "⚠️ WRITE — Remove a profile from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "profile_id"], properties: {
      group_id: { type: "string" }, profile_id: { type: "string" },
    }}},

  { name: "push_apps_to_group",
    description: "⚠️ WRITE — Push all assigned apps to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "update_apps_in_group",
    description: "⚠️ WRITE — Push app updates to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "sync_profiles_in_group",
    description: "⚠️ WRITE — Sync all profiles to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "clone_assignment_group",
    description: "⚠️ WRITE — Clone an assignment group (static and dynamic only).",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // APPS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_apps",
    description: "All apps in the catalog including App Store, enterprise, and shared.",
    inputSchema: { type: "object", properties: {
      include_shared: { type: "boolean", description: "Include shared apps. Defaults to true when omitted." },
    }}},

  { name: "get_app",
    description: "Detail for a single catalog app.",
    inputSchema: { type: "object", required: ["app_id"], properties: { app_id: { type: "string" } }}},

  { name: "create_app",
    description: "⚠️ WRITE — Add an App Store app by ID or bundle ID to the catalog.",
    inputSchema: { type: "object", properties: {
      app_store_id: { type: "string", description: "Apple App Store numeric ID e.g. 1090161858." },
      bundle_id: { type: "string", description: "Bundle identifier e.g. com.myCompany.MyApp." },
      name: { type: "string", description: "Optional display name override." },
    }}},

  { name: "update_app",
    description: "⚠️ WRITE — Update an app catalog entry name.",
    inputSchema: { type: "object", required: ["app_id"], properties: {
      app_id: { type: "string" },
      name: { type: "string" },
      deploy_to: { type: "string", description: "none, outdated, or all. Push after update." },
    }}},

  { name: "delete_app",
    description: "⚠️ WRITE — Remove an app from the catalog. Does not uninstall from devices.",
    inputSchema: { type: "object", required: ["app_id"], properties: { app_id: { type: "string" } }}},

  { name: "list_app_installs",
    description: "List all devices that have a specific catalog app installed. Auto-paginates to return all results.",
    inputSchema: { type: "object", required: ["app_id"], properties: {
      app_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // INSTALLED APPS (per-device)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_installed_app",
    description: "Get detail for a specific installed app instance by its installed app ID.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  { name: "request_app_management",
    description: "⚠️ WRITE — Request MDM management of an unmanaged installed app.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  { name: "update_installed_app",
    description: "⚠️ WRITE — Push an update to a specific installed app instance.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  { name: "uninstall_app",
    description: "⚠️ WRITE — Uninstall a managed app from a device.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOM ATTRIBUTES
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_custom_attributes",
    description: "List all custom attributes defined in the account.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_custom_attribute",
    description: "Get a specific custom attribute by its key name.",
    inputSchema: { type: "object", required: ["attribute_name"], properties: { attribute_name: { type: "string" } }}},

  { name: "create_custom_attribute",
    description: "⚠️ WRITE — Create a new custom attribute.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string", description: "Attribute key name." },
      default_value: { type: "string" },
    }}},

  { name: "update_custom_attribute",
    description: "⚠️ WRITE — Update a custom attribute's default value.",
    inputSchema: { type: "object", required: ["attribute_name"], properties: {
      attribute_name: { type: "string" },
      default_value: { type: "string" },
    }}},

  { name: "delete_custom_attribute",
    description: "⚠️ WRITE — Delete a custom attribute.",
    inputSchema: { type: "object", required: ["attribute_name"], properties: { attribute_name: { type: "string" } }}},

  { name: "get_device_attribute_values",
    description: "Get all custom attribute values for a specific device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_device_attribute_value",
    description: "⚠️ WRITE — Set a custom attribute value for a specific device.",
    inputSchema: { type: "object", required: ["attribute_name", "device_id", "value"], properties: {
      attribute_name: { type: "string" },
      device_id: { type: "string" },
      value: { type: "string" },
    }}},

  { name: "set_attribute_for_multiple_devices",
    description: "⚠️ WRITE — Set a custom attribute value on multiple devices at once.",
    inputSchema: { type: "object", required: ["attribute_name", "device_ids", "value"], properties: {
      attribute_name: { type: "string" },
      device_ids: { type: "array", items: { type: "string" } },
      value: { type: "string" },
    }}},

  { name: "get_group_attribute_values",
    description: "Get custom attribute values set at the assignment group level.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "set_group_attribute_value",
    description: "⚠️ WRITE — Set a custom attribute value at the assignment group level.",
    inputSchema: { type: "object", required: ["attribute_name", "group_id", "value"], properties: {
      attribute_name: { type: "string" },
      group_id: { type: "string" },
      value: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOM CONFIGURATION PROFILES
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_custom_configuration_profiles",
    description: "List all custom configuration profiles.",
    inputSchema: { type: "object", properties: {} } },

  { name: "create_custom_configuration_profile",
    description: "⚠️ WRITE — Create a new custom configuration profile by providing mobileconfig XML.",
    inputSchema: { type: "object", required: ["name", "mobileconfig"], properties: {
      name: { type: "string" },
      mobileconfig: { type: "string", description: "The mobileconfig XML content as a string." },
      user_scope: { type: "boolean", description: "Apply at user scope. Default false." },
      attribute_support: { type: "boolean", description: "Enable attribute variable substitution." },
    }}},

  { name: "update_custom_configuration_profile",
    description: "⚠️ WRITE — Update a custom configuration profile.",
    inputSchema: { type: "object", required: ["profile_id"], properties: {
      profile_id: { type: "string" },
      name: { type: "string" },
      mobileconfig: { type: "string" },
      user_scope: { type: "boolean" },
      attribute_support: { type: "boolean" },
    }}},

  { name: "delete_custom_configuration_profile",
    description: "⚠️ WRITE — Delete a custom configuration profile.",
    inputSchema: { type: "object", required: ["profile_id"], properties: { profile_id: { type: "string" } }}},

  { name: "assign_custom_profile_to_device",
    description: "⚠️ WRITE — Assign a custom configuration profile directly to a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_custom_profile_from_device",
    description: "⚠️ WRITE — Remove a custom configuration profile from a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOM DECLARATIONS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_custom_declarations",
    description: "List all custom DDM declarations.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_custom_declaration",
    description: "Detail for a single declaration including type, identifier, scope, and activation predicate.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: { declaration_id: { type: "string" } }}},

  { name: "create_custom_declaration",
    description: "⚠️ WRITE — Create a new custom declaration.",
    inputSchema: { type: "object", required: ["name", "payload"], properties: {
      name: { type: "string" },
      payload: { type: "string", description: "The declaration JSON payload as a string." },
      reinstall_after_os_update: { type: "boolean" },
      user_scope: { type: "boolean" },
    }}},

  { name: "update_custom_declaration",
    description: "⚠️ WRITE — Update a custom declaration.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: {
      declaration_id: { type: "string" },
      name: { type: "string" },
      payload: { type: "string" },
      reinstall_after_os_update: { type: "boolean" },
    }}},

  { name: "delete_custom_declaration",
    description: "⚠️ WRITE — Delete a custom declaration.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: { declaration_id: { type: "string" } }}},

  { name: "assign_declaration_to_device",
    description: "⚠️ WRITE — Assign a declaration directly to a device.",
    inputSchema: { type: "object", required: ["declaration_id", "device_id"], properties: {
      declaration_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_declaration_from_device",
    description: "⚠️ WRITE — Remove a declaration from a device.",
    inputSchema: { type: "object", required: ["declaration_id", "device_id"], properties: {
      declaration_id: { type: "string" }, device_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // PROFILES (live)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_profiles",
    description: "List all profiles (live profiles endpoint).",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_profile",
    description: "Get detail for a single profile.",
    inputSchema: { type: "object", required: ["profile_id"], properties: { profile_id: { type: "string" } }}},

  { name: "assign_profile_to_device",
    description: "⚠️ WRITE — Assign a profile directly to a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_profile_from_device",
    description: "⚠️ WRITE — Remove a profile from a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEP SERVERS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_dep_servers",
    description: "List all registered Apple DEP servers.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_dep_server",
    description: "Get detail for a specific DEP server.",
    inputSchema: { type: "object", required: ["dep_server_id"], properties: { dep_server_id: { type: "string" } }}},

  { name: "sync_dep_server",
    description: "⚠️ WRITE — Trigger a sync with Apple for a DEP server.",
    inputSchema: { type: "object", required: ["dep_server_id"], properties: { dep_server_id: { type: "string" } }}},

  { name: "list_dep_devices",
    description: "List DEP devices registered under a DEP server. Auto-paginates to return all results.",
    inputSchema: { type: "object", required: ["dep_server_id"], properties: {
      dep_server_id: { type: "string" },
    }}},

  { name: "get_dep_device",
    description: "Get detail for a specific DEP device.",
    inputSchema: { type: "object", required: ["dep_server_id", "dep_device_id"], properties: {
      dep_server_id: { type: "string" }, dep_device_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEVICE GROUPS (legacy)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_device_groups",
    description: "List legacy device groups. Note: SimpleMDM has migrated to Assignment Groups. These are maintained for backwards compatibility.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_device_group",
    description: "Get detail for a legacy device group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // ENROLLMENTS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_enrollments",
    description: "List active enrollment configurations.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_enrollment",
    description: "Get detail for a specific enrollment including URL and auth flags.",
    inputSchema: { type: "object", required: ["enrollment_id"], properties: { enrollment_id: { type: "string" } }}},

  { name: "send_enrollment_invitation",
    description: "⚠️ WRITE — Send an enrollment invitation to an email address or phone number.",
    inputSchema: { type: "object", required: ["enrollment_id", "contact"], properties: {
      enrollment_id: { type: "string" },
      contact: { type: "string", description: "Email address or phone number." },
    }}},

  { name: "delete_enrollment",
    description: "⚠️ WRITE — Delete an enrollment configuration.",
    inputSchema: { type: "object", required: ["enrollment_id"], properties: { enrollment_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // LOGS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_logs",
    description: "List MDM logs. Filter by serial_number to get logs for a specific device. Auto-paginates to return all results.",
    inputSchema: { type: "object", properties: {
      serial_number: { type: "string" },
    }}},

  { name: "get_log",
    description: "Get detail for a specific log entry by ID.",
    inputSchema: { type: "object", required: ["log_id"], properties: { log_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // MANAGED APP CONFIGS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_managed_app_configs",
    description: "Get managed app configuration entries for a specific catalog app.",
    inputSchema: { type: "object", required: ["app_id"], properties: { app_id: { type: "string" } }}},

  { name: "create_managed_app_config",
    description: "⚠️ WRITE — Create a managed app configuration entry for an app.",
    inputSchema: { type: "object", required: ["app_id", "key", "value", "kind"], properties: {
      app_id: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      kind: { type: "string", description: "Value type: string, integer, boolean, etc." },
    }}},

  { name: "delete_managed_app_config",
    description: "⚠️ WRITE — Delete a managed app configuration entry.",
    inputSchema: { type: "object", required: ["app_id", "config_id"], properties: {
      app_id: { type: "string" }, config_id: { type: "string" },
    }}},

  { name: "push_managed_app_configs",
    description: "⚠️ WRITE — Push managed app config updates to all devices with the app installed.",
    inputSchema: { type: "object", required: ["app_id"], properties: { app_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // PUSH CERTIFICATE
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_push_certificate",
    description: "Get current APNs push certificate info: expiry date and Apple ID.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_signed_csr",
    description: "Download the signed CSR needed to renew the APNs push certificate.",
    inputSchema: { type: "object", properties: {} } },

  // ══════════════════════════════════════════════════════════════════════════
  // SCRIPTS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_scripts",
    description: "List all scripts in the script library.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_script",
    description: "Get detail for a specific script including its content.",
    inputSchema: { type: "object", required: ["script_id"], properties: { script_id: { type: "string" } }}},

  { name: "create_script",
    description: "⚠️ WRITE — Create a new script.",
    inputSchema: { type: "object", required: ["name", "content"], properties: {
      name: { type: "string" },
      content: { type: "string", description: "The script content (shell script, etc.)." },
    }}},

  { name: "update_script",
    description: "⚠️ WRITE — Update a script's name or content.",
    inputSchema: { type: "object", required: ["script_id"], properties: {
      script_id: { type: "string" },
      name: { type: "string" },
      content: { type: "string" },
    }}},

  { name: "delete_script",
    description: "⚠️ WRITE — Delete a script.",
    inputSchema: { type: "object", required: ["script_id"], properties: { script_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // SCRIPT JOBS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_script_jobs",
    description: "List script jobs. Filter by status: pending, acknowledged, complete, failed. Auto-paginates to return all results.",
    inputSchema: { type: "object", properties: {
      status: { type: "string" },
    }}},

  { name: "get_script_job",
    description: "Get detail and results for a specific script job.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: { type: "string" } }}},

  { name: "create_script_job",
    description: "⚠️ WRITE — Run a script on one or more devices.",
    inputSchema: { type: "object", required: ["script_id", "device_ids"], properties: {
      script_id: { type: "string" },
      device_ids: { type: "array", items: { type: "string" } },
    }}},

  { name: "cancel_script_job",
    description: "⚠️ WRITE — Cancel a pending script job.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // MUNKIREPORT ENRICHMENT
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_munkireport_sync_health",
    description: "Sync health telemetry from the MunkiReport simplemdm module.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_compliance",
    description: "Fleet compliance stats from the MunkiReport simplemdm module.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_device_resources",
    description: "Per-device connected-resource context from the MunkiReport module.",
    inputSchema: { type: "object", required: ["serial_number"], properties: { serial_number: { type: "string" } }}},

  { name: "get_munkireport_apple_care",
    description: "AppleCare coverage stats from the MunkiReport module.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_supplemental_overview",
    description: "Supplemental fleet overview from the MunkiReport module.",
    inputSchema: { type: "object", properties: {} } },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

function qs(args: Args, keys: string[]): string {
  const p = new URLSearchParams();
  for (const k of keys) if (args[k] != null) p.set(k, String(args[k]));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function handleTool(name: string, args: Args): Promise<unknown> {
  switch (name) {

    // ── Account ─────────────────────────────────────────────────────────────
    case "get_account": return api("/account");
    case "update_account":
      requireWrites();
      return api("/account", { method: "PATCH", body: j({ name: args.name, apple_store_country_code: args.apple_store_country_code }) });

    // ── Fleet summary (derived) ──────────────────────────────────────────────
    case "get_fleet_summary": {
      if (USE_LOCAL_APP) return api("/fleet/summary");
      const all = await collectDevices();
      const statusCounts: Record<string, number> = {};
      const osCounts: Record<string, number> = {};
      for (const d of all) {
        const status = getDeviceStatus(d.attributes);
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        const v = d.attributes.os_version || "unknown";
        osCounts[v] = (osCounts[v] ?? 0) + 1;
      }
      const enrolled = statusCounts.enrolled ?? 0;
      const unenrolled = statusCounts.unenrolled ?? 0;
      return {
        total: all.length,
        enrolled,
        unenrolled,
        posture: {
          supervised: all.filter(d => d.attributes.is_supervised === true).length,
          dep_enrolled: all.filter(d => d.attributes.dep_enrolled === true).length,
          filevault_enabled: all.filter(d => d.attributes.filevault_enabled === true).length,
        },
        device_status_breakdown: statusCounts,
        os_version_breakdown: osCounts,
      };
    }

    // ── Compound: device full profile ────────────────────────────────────────
    case "get_device_full_profile": {
      let deviceId = typeof args.device_id === "string" ? args.device_id : undefined;
      if (!deviceId && args.serial_number) {
        const found = await api(`/devices?search=${encodeURIComponent(String(args.serial_number))}&limit=10`) as PaginatedResponse<DeviceRecord>;
        const match = found.data.find(d => (d as { attributes?: { serial_number?: string } }).attributes?.serial_number === args.serial_number) ?? found.data[0];
        if (!match) throw new Error(`No device found for serial_number=${args.serial_number}`);
        deviceId = String(match.id);
      }
      if (!deviceId) throw new Error("get_device_full_profile requires device_id or serial_number");
      const id = seg(deviceId, "device_id");

      const devicePromise = api(`/devices/${id}`);
      const [device, profiles, installedApps, users, logs] = await Promise.allSettled([
        devicePromise,
        collectAllPages(`/devices/${id}/profiles`),
        collectAllPages(`/devices/${id}/installed_apps`),
        collectAllPages(`/devices/${id}/users`),
        (async () => {
          const d = await devicePromise as { data?: { attributes?: { serial_number?: string } } };
          const sn = d?.data?.attributes?.serial_number;
          if (!sn) return { data: [] };
          return collectAllPages(`/logs?serial_number=${encodeURIComponent(sn)}`);
        })(),
      ]);
      const unwrap = <T>(r: PromiseSettledResult<T>) => r.status === "fulfilled" ? r.value : { error: String((r as PromiseRejectedResult).reason) };
      return {
        device_id: deviceId,
        device: unwrap(device),
        profiles: unwrap(profiles),
        installed_apps: unwrap(installedApps),
        users: unwrap(users),
        recent_logs: unwrap(logs),
      };
    }

    // ── Compound: security posture ───────────────────────────────────────────
    case "get_security_posture": {
      if (USE_LOCAL_APP) return api("/fleet/security_posture");
      const all = await collectDevices();
      const enrolled = all.filter(d => getDeviceStatus(d.attributes) === "enrolled");
      const n = enrolled.length || 1;
      const pct = (v: number) => Math.round((v / n) * 1000) / 10;
      const metric = (key: string) => {
        const c = enrolled.filter(d => d.attributes[key] === true).length;
        return { count: c, pct: pct(c) };
      };

      return {
        total_enrolled: enrolled.length,
        total_devices: all.length,
        posture: {
          supervised:              metric("is_supervised"),
          dep_enrolled:            metric("dep_enrolled"),
          filevault_enabled:       metric("filevault_enabled"),
          firmware_password:       metric("firmware_password_enabled"),
          recovery_lock_password:  metric("recovery_lock_password_enabled"),
          activation_lock:         metric("is_activation_lock_enabled"),
          user_approved_mdm:       metric("is_user_approved_enrollment"),
          passcode_compliant:      metric("passcode_compliant"),
          remote_desktop_enabled:  metric("remote_desktop_enabled"),
        },
        os_major_breakdown: enrolled.reduce<Record<string, number>>((acc, d) => {
          const v = d.attributes.os_version ?? "unknown";
          const major = v.split(".")[0];
          acc[major] = (acc[major] ?? 0) + 1;
          return acc;
        }, {}),
      };
    }

    // ── Fleet analytics: top installed apps ─────────────────────────────────
    case "get_top_installed_apps": {
      const limit = Math.max(1, Math.min(500, Number(args.limit ?? 25)));
      const excludeApple = args.exclude_apple !== false;
      const minCount = Math.max(1, Number(args.min_install_count ?? 1));
      const counts = new Map<string, { bundle_identifier: string; name: string; count: number }>();
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (_, apps) => {
        const seenOnDevice = new Set<string>();
        for (const a of apps) {
          const at = a.attributes ?? {};
          const bid = (at.identifier as string | undefined)
            ?? (at.bundle_identifier as string | undefined)
            ?? (at.name as string | undefined);
          if (!bid) continue;
          if (excludeApple && bid.startsWith("com.apple.")) continue;
          if (seenOnDevice.has(bid)) continue;
          seenOnDevice.add(bid);
          const cur = counts.get(bid);
          if (cur) cur.count++;
          else counts.set(bid, { bundle_identifier: bid, name: (at.name as string | undefined) ?? bid, count: 1 });
        }
      });
      const denom = Math.max(stats.devices_processed, 1);
      const apps = [...counts.values()]
        .filter(a => a.count >= minCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(a => ({ ...a, install_pct: Math.round((a.count / denom) * 1000) / 10 }));
      return { ...stats, exclude_apple: excludeApple, apps_returned: apps.length, apps };
    }

    // ── Fleet analytics: app coverage for a specific bundle ID ──────────────
    case "get_app_coverage": {
      const bid = String(args.bundle_identifier ?? "").trim();
      if (!bid) throw new Error("get_app_coverage requires bundle_identifier");
      const installed: Array<{ id: string | number; name?: string; serial?: string }> = [];
      const missing:   Array<{ id: string | number; name?: string; serial?: string }> = [];
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (d, apps) => {
        const has = apps.some(a => {
          const at = a.attributes ?? {};
          return at.identifier === bid || at.bundle_identifier === bid;
        });
        const row = {
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
        };
        (has ? installed : missing).push(row);
      });
      const denom = Math.max(stats.devices_processed, 1);
      return {
        bundle_identifier: bid,
        ...stats,
        installed_count: installed.length,
        installed_pct: Math.round((installed.length / denom) * 1000) / 10,
        missing_count: missing.length,
        missing_devices: missing,
      };
    }

    // ── Fleet analytics: stale devices ──────────────────────────────────────
    case "get_stale_devices": {
      const days = Math.max(1, Number(args.days ?? 14));
      const includeUnenrolled = args.include_unenrolled === true;
      const cutoff = Date.now() - days * 86_400_000;
      const all = await collectDevices();
      const stale: Array<{
        id: string | number; name?: string; serial?: string; os?: string;
        last_seen_at?: string; days_since: number; status: string;
      }> = [];
      for (const d of all) {
        const status = getDeviceStatus(d.attributes);
        if (!includeUnenrolled && status !== "enrolled") continue;
        const last = d.attributes.last_seen_at as string | undefined;
        if (!last) continue;
        const t = Date.parse(last);
        if (!Number.isFinite(t) || t > cutoff) continue;
        stale.push({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          os: d.attributes.os_version ?? undefined,
          last_seen_at: last,
          days_since: Math.floor((Date.now() - t) / 86_400_000),
          status,
        });
      }
      stale.sort((a, b) => b.days_since - a.days_since);
      return {
        threshold_days: days,
        include_unenrolled: includeUnenrolled,
        total_devices: all.length,
        stale_count: stale.length,
        devices: stale,
      };
    }

    // ── Fleet analytics: storage / battery health ───────────────────────────
    case "get_storage_health": {
      const lowDiskGb = Math.max(0, Number(args.low_disk_gb ?? 20));
      const lowBatteryPct = Math.max(0, Math.min(100, Number(args.low_battery_pct ?? 20)));
      const lowDisk: Array<{
        id: string | number; name?: string; serial?: string; os?: string;
        available_gb: number; total_gb?: number; free_pct?: number;
      }> = [];
      const lowBattery: Array<{
        id: string | number; name?: string; serial?: string; battery_level_pct: number;
      }> = [];
      const all = await collectDevices();
      for (const d of all) {
        if (getDeviceStatus(d.attributes) !== "enrolled") continue;
        const cap = d.attributes.available_device_capacity as number | undefined;
        const total = d.attributes.device_capacity as number | undefined;
        if (typeof cap === "number" && cap < lowDiskGb) {
          lowDisk.push({
            id: d.id,
            name: d.attributes.name as string | undefined,
            serial: d.attributes.serial_number as string | undefined,
            os: d.attributes.os_version ?? undefined,
            available_gb: Math.round(cap * 10) / 10,
            total_gb: typeof total === "number" ? Math.round(total * 10) / 10 : undefined,
            free_pct: typeof total === "number" && total > 0 ? Math.round((cap / total) * 1000) / 10 : undefined,
          });
        }
        const batRaw = d.attributes.battery_level as number | string | undefined | null;
        if (batRaw != null) {
          const num = typeof batRaw === "string" ? parseFloat(batRaw.replace("%", "")) : Number(batRaw);
          // SimpleMDM may report 0-1 fraction or 0-100 percentage; normalize.
          const pct = num <= 1 ? num * 100 : num;
          if (Number.isFinite(pct) && pct > 0 && pct <= lowBatteryPct) {
            lowBattery.push({
              id: d.id,
              name: d.attributes.name as string | undefined,
              serial: d.attributes.serial_number as string | undefined,
              battery_level_pct: Math.round(pct * 10) / 10,
            });
          }
        }
      }
      lowDisk.sort((a, b) => a.available_gb - b.available_gb);
      lowBattery.sort((a, b) => a.battery_level_pct - b.battery_level_pct);
      return {
        low_disk_threshold_gb: lowDiskGb,
        low_battery_threshold_pct: lowBatteryPct,
        total_enrolled: all.filter(d => getDeviceStatus(d.attributes) === "enrolled").length,
        low_disk_count: lowDisk.length,
        low_disk_devices: lowDisk,
        low_battery_count: lowBattery.length,
        low_battery_devices: lowBattery,
      };
    }

    // ── Fleet analytics: unmanaged (shadow IT) apps ─────────────────────────
    case "get_unmanaged_apps": {
      const minCount = Math.max(1, Number(args.min_install_count ?? 5));
      const limit = Math.max(1, Math.min(500, Number(args.limit ?? 50)));
      const excludeApple = args.exclude_apple !== false;
      const catalog = await collectAllPages<{ id: string|number; attributes?: { bundle_identifier?: string | null } }>("/apps?include_shared=true");
      const catalogBids = new Set<string>();
      for (const c of catalog.data) {
        const b = c.attributes?.bundle_identifier;
        if (b) catalogBids.add(b);
      }
      const counts = new Map<string, { bundle_identifier: string; name: string; count: number }>();
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (_, apps) => {
        const seenOnDevice = new Set<string>();
        for (const a of apps) {
          const at = a.attributes ?? {};
          const bid = (at.identifier as string | undefined) ?? (at.bundle_identifier as string | undefined);
          if (!bid) continue;
          if (excludeApple && bid.startsWith("com.apple.")) continue;
          if (catalogBids.has(bid)) continue;
          if (seenOnDevice.has(bid)) continue;
          seenOnDevice.add(bid);
          const cur = counts.get(bid);
          if (cur) cur.count++;
          else counts.set(bid, { bundle_identifier: bid, name: (at.name as string | undefined) ?? bid, count: 1 });
        }
      });
      const denom = Math.max(stats.devices_processed, 1);
      const apps = [...counts.values()]
        .filter(a => a.count >= minCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(a => ({ ...a, install_pct: Math.round((a.count / denom) * 1000) / 10 }));
      return {
        catalog_size: catalogBids.size,
        ...stats,
        min_install_count: minCount,
        exclude_apple: excludeApple,
        unmanaged_apps_returned: apps.length,
        apps,
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Tier 1 handlers
    // ══════════════════════════════════════════════════════════════════════

    case "get_app_version_drift": {
      const target = String(args.bundle_identifier ?? "").trim();
      if (!target) throw new Error("get_app_version_drift requires bundle_identifier");
      const versionCounts = new Map<string, number>();
      const rows: Array<{ id: string|number; name?: string; serial?: string; version: string }> = [];
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (d, apps) => {
        for (const a of apps) {
          const at = a.attributes ?? {};
          if (at.identifier !== target && at.bundle_identifier !== target) continue;
          const v = (at.short_version as string | undefined) ?? "unknown";
          versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
          rows.push({
            id: d.id,
            name: d.attributes.name as string | undefined,
            serial: d.attributes.serial_number as string | undefined,
            version: v,
          });
          break;
        }
      });
      const distribution = [...versionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([version, count]) => ({ version, count }));
      return {
        bundle_identifier: target,
        ...stats,
        installed_count: rows.length,
        unique_versions: distribution.length,
        version_distribution: distribution,
        installs: rows,
      };
    }

    case "get_compliance_violators": {
      const reqPasscode = args.require_passcode_compliant !== false;
      const reqFV = args.require_filevault_macs !== false;
      const reqSup = args.require_supervised !== false;
      const reqUAMDM = args.require_user_approved_mdm !== false;
      const skipOs = args.skip_os_check === true;
      const maxLag = Math.max(0, Number(args.max_os_major_lag ?? 2));
      const unsupportedLag = Math.max(maxLag, Number(args.unsupported_lag_threshold ?? 3));
      const all = await collectDevices();
      const enrolled = all.filter(d => getDeviceStatus(d.attributes) === "enrolled");
      const violators: Array<{
        id: string|number; name?: string; serial?: string; os?: string; platform: string;
        failures: string[];
      }> = [];
      // Tally each failure type so callers can act on the dominant one without
      // re-iterating the violators array.
      const failureCounts: Record<string, number> = {};
      const bumpFailure = (k: string) => { failureCounts[k] = (failureCounts[k] ?? 0) + 1; };
      for (const d of enrolled) {
        const failures: string[] = [];
        const a = d.attributes;
        const modelName = a.model_name as string | undefined ?? "";
        const isMac = modelName.includes("Mac");
        const platform: "mac" | "ios" | "ipad" = isMac ? "mac" : modelName.includes("iPad") ? "ipad" : "ios";
        if (reqPasscode && a.passcode_compliant === false) { failures.push("passcode_not_compliant"); bumpFailure("passcode_not_compliant"); }
        if (reqFV && isMac && a.filevault_enabled === false) { failures.push("filevault_off"); bumpFailure("filevault_off"); }
        if (reqSup && a.is_supervised === false) { failures.push("not_supervised"); bumpFailure("not_supervised"); }
        if (reqUAMDM && a.is_user_approved_enrollment === false) { failures.push("not_user_approved_mdm"); bumpFailure("not_user_approved_mdm"); }
        if (!skipOs) {
          const v = a.os_version ?? "";
          const major = parseInt(v.split(".")[0] ?? "", 10);
          const baseline = CURRENT_SUPPORTED_OS[platform];
          if (Number.isFinite(major) && Number.isFinite(baseline) && baseline - major > maxLag) {
            const lag = baseline - major;
            const label = lag > unsupportedLag ? "os_unsupported" : `os_${lag}_majors_behind`;
            failures.push(label);
            bumpFailure(label);
          }
        }
        if (failures.length) {
          violators.push({
            id: d.id,
            name: a.name as string | undefined,
            serial: a.serial_number as string | undefined,
            os: a.os_version ?? undefined,
            platform,
            failures,
          });
        }
      }
      violators.sort((a, b) => b.failures.length - a.failures.length);
      // Detect if any enrolled device is running a higher OS major than the
      // baseline — signals Apple shipped a new OS and the defaults are stale.
      const observedMax: Record<string, number> = {};
      for (const d of enrolled) {
        const a = d.attributes;
        const mn = a.model_name as string | undefined ?? "";
        const plat: "mac" | "ios" | "ipad" = mn.includes("Mac") ? "mac" : mn.includes("iPad") ? "ipad" : "ios";
        const major = parseInt((a.os_version ?? "").split(".")[0] ?? "", 10);
        if (Number.isFinite(major) && major > (observedMax[plat] ?? 0)) observedMax[plat] = major;
      }
      const stalePlatforms = (Object.keys(CURRENT_SUPPORTED_OS) as Array<"mac"|"ios"|"ipad">)
        .filter(p => (observedMax[p] ?? 0) > CURRENT_SUPPORTED_OS[p]);

      const result: Record<string, unknown> = {
        total_enrolled: enrolled.length,
        violator_count: violators.length,
        baseline_supported_major: CURRENT_SUPPORTED_OS,
        rules_applied: { reqPasscode, reqFV, reqSup, reqUAMDM, skipOs, maxLag, unsupportedLag },
        failure_counts: failureCounts,
        violators,
      };
      if (stalePlatforms.length > 0) {
        const details = stalePlatforms.map(p => `${p}: baseline=${CURRENT_SUPPORTED_OS[p]} but devices running ${observedMax[p]}`).join("; ");
        result._agent_hint = `The OS baseline appears stale for: ${details}. `
          + `Apple has likely shipped a newer OS version. Search the web for the current shipping version of ${stalePlatforms.map(p => p === "mac" ? "macOS" : p === "ios" ? "iOS" : "iPadOS").join(", ")} `
          + `and tell the admin to update the CURRENT_SUPPORTED_OS_OVERRIDE env var — for example: CURRENT_SUPPORTED_OS_OVERRIDE='${JSON.stringify(Object.fromEntries(stalePlatforms.map(p => [p, observedMax[p]])))}'.`;
      }
      return result;
    }

    case "get_devices_missing_profile": {
      const profileId = String(args.profile_id ?? "").trim();
      if (!profileId) throw new Error("get_devices_missing_profile requires profile_id");
      const stats = await forEachDevice(DEFAULT_FLEET_CONCURRENCY,
        d => getDeviceStatus(d.attributes) === "enrolled",
        async d => {
          const r = await simpleMDM(`/devices/${encodeURIComponent(String(d.id))}/profiles`) as { data?: Array<{ id: string|number }> };
          const has = (r.data ?? []).some(p => String(p.id) === profileId);
          if (has) return undefined;
          return {
            id: d.id,
            name: d.attributes.name as string | undefined,
            serial: d.attributes.serial_number as string | undefined,
            os: d.attributes.os_version ?? undefined,
          };
        });
      return {
        profile_id: profileId,
        devices_processed: stats.devices_processed,
        devices_with_errors: stats.devices_with_errors,
        missing_count: stats.results.length,
        missing_devices: stats.results,
      };
    }

    case "get_pending_commands": {
      const minAgeHours = Math.max(0, Number(args.min_age_hours ?? 4));
      const pages = Math.max(1, Math.min(20, Number(args.log_pages ?? 5)));
      const cutoffMs = Date.now() - minAgeHours * 3_600_000;
      // Pull recent global log entries (paginated). One pass — no per-device fan-out.
      const entries: Array<{ id: string|number; attributes?: Record<string, unknown>; relationships?: { device?: { data?: { id?: string|number }} } }> = [];
      let cursor: string | number | undefined;
      for (let i = 0; i < pages; i++) {
        const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
        const r = await simpleMDM(`/logs?limit=100${q}`) as PaginatedResponse<typeof entries[number]>;
        for (const e of r.data ?? []) entries.push(e);
        if (!r.has_more || !r.data?.length) break;
        cursor = r.data.at(-1)?.id;
      }
      // For each (device, command_uuid-ish key), record sent and terminal events.
      type EvtState = { device_id: string|number; sent_at: number; event: string; ack_seen: boolean };
      const sent = new Map<string, EvtState>();
      const terminalRe = /(acknowledged|succeeded|completed|failed|error)$/i;
      const sentRe = /(sent|queued|pending)$/i;
      for (const e of entries) {
        const a = e.attributes ?? {};
        const event = String(a.event ?? a.namespace ?? "");
        if (!event.toLowerCase().includes("command")) continue;
        const did = e.relationships?.device?.data?.id;
        if (did == null) continue;
        const meta = a.metadata as Record<string, unknown> | undefined;
        const cmdKey = String((meta?.command_uuid as string | undefined) ?? (meta?.uuid as string | undefined) ?? `${did}:${event}:${a.at}`);
        const ts = Date.parse(String(a.at ?? ""));
        if (!Number.isFinite(ts)) continue;
        if (sentRe.test(event)) {
          const cur = sent.get(cmdKey);
          if (!cur || ts < cur.sent_at) sent.set(cmdKey, { device_id: did, sent_at: ts, event, ack_seen: cur?.ack_seen ?? false });
        } else if (terminalRe.test(event)) {
          const cur = sent.get(cmdKey);
          if (cur) cur.ack_seen = true;
          else sent.set(cmdKey, { device_id: did, sent_at: ts, event, ack_seen: true });
        }
      }
      // Aggregate per device: count of unacknowledged commands older than cutoff.
      const perDevice = new Map<string, { device_id: string|number; pending_count: number; oldest_sent_at: string }>();
      for (const s of sent.values()) {
        if (s.ack_seen) continue;
        if (s.sent_at >= cutoffMs) continue;
        const k = String(s.device_id);
        const cur = perDevice.get(k);
        const iso = new Date(s.sent_at).toISOString();
        if (cur) { cur.pending_count++; if (iso < cur.oldest_sent_at) cur.oldest_sent_at = iso; }
        else perDevice.set(k, { device_id: s.device_id, pending_count: 1, oldest_sent_at: iso });
      }
      const devices = [...perDevice.values()].sort((a, b) => b.pending_count - a.pending_count);
      const result: Record<string, unknown> = {
        min_age_hours: minAgeHours,
        log_entries_scanned: entries.length,
        commands_observed: sent.size,
        devices_with_pending: devices.length,
        devices,
      };
      if (entries.length > 0 && sent.size === 0) {
        result._agent_hint = `Scanned ${entries.length} log entries but found no MDM command events to pair. `
          + "This typically means the SimpleMDM /logs endpoint isn't surfacing command-level events for this tenant — the tool can't detect pending commands without them. "
          + "Tell the admin: verify by calling list_logs and checking whether any entry has an event/namespace containing 'command'. If not, this tool will always return zero.";
      }
      return result;
    }

    case "get_dep_drift": {
      const restrict = args.dep_server_id != null ? String(args.dep_server_id) : undefined;
      const serversResp = await collectAllPages<{ id: string|number; attributes?: Record<string, unknown> }>("/dep_servers");
      const servers = serversResp.data.filter(s => !restrict || String(s.id) === restrict);
      const drift: Array<{ dep_server_id: string|number; serial: string; assigned_profile_uuid?: string|null; expected_profile_uuid?: string|null }> = [];
      for (const s of servers) {
        const expected = (s.attributes?.default_assignment_profile_uuid
                       ?? s.attributes?.default_profile_uuid
                       ?? null) as string | null;
        if (!expected) continue; // no default → can't define drift for this server
        const r = await collectAllPages<{ id: string|number; attributes?: Record<string, unknown> }>(`/dep_servers/${encodeURIComponent(String(s.id))}/dep_devices`);
        for (const dep of r.data) {
          const a = dep.attributes ?? {};
          const sn = a.serial_number as string | undefined;
          const assigned = (a.profile_uuid as string | null | undefined) ?? null;
          if (!sn || !assigned) continue;
          if (assigned !== expected) {
            drift.push({ dep_server_id: s.id, serial: sn, assigned_profile_uuid: assigned, expected_profile_uuid: expected });
          }
        }
      }
      return { servers_scanned: servers.length, drift_count: drift.length, devices: drift };
    }

    case "get_os_eligibility": {
      const all = await collectDevices();
      const rows: Array<{
        id: string|number; name?: string; serial?: string; model?: string;
        current_major?: number; max_supported_major: number | null;
        upgrade_available: boolean | null;
      }> = [];
      for (const d of all) {
        if (getDeviceStatus(d.attributes) !== "enrolled") continue;
        const modelName = d.attributes.model_name as string | undefined;
        if (!modelName || !modelName.includes("Mac")) continue;
        const model = d.attributes.model as string | undefined;
        const v = d.attributes.os_version ?? "";
        const cur = parseInt(v.split(".")[0] ?? "", 10);
        const max = maxMacOSMajorFor(model);
        rows.push({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          model,
          current_major: Number.isFinite(cur) ? cur : undefined,
          max_supported_major: max,
          upgrade_available: max != null && Number.isFinite(cur) ? max > cur : null,
        });
      }
      const upgradable = rows.filter(r => r.upgrade_available === true);
      const unknownModel = rows.filter(r => r.max_supported_major === null);
      const unknownPrefixes = [...new Set(unknownModel.map(r => r.model?.replace(/,\d+$/, ",") ?? "unknown").filter(Boolean))];
      const result: Record<string, unknown> = {
        table_last_updated: "2024-11",
        mac_count: rows.length,
        upgradable_count: upgradable.length,
        unknown_model_count: unknownModel.length,
        devices: rows,
      };
      if (unknownPrefixes.length > 0) {
        result.unknown_model_prefixes = unknownPrefixes;
        result._agent_hint = `${unknownPrefixes.length} model identifier${unknownPrefixes.length > 1 ? "s are" : " is"} not in the built-in support table (last updated 2024-11): ${unknownPrefixes.join(", ")}. `
          + `Search the web for each (e.g. "Apple ${unknownPrefixes[0]} macOS compatibility") to determine the maximum supported macOS version. `
          + `Once found, tell the admin to set the MAC_OS_ELIGIBILITY_OVERRIDE env var to patch the table without redeploying — for example: MAC_OS_ELIGIBILITY_OVERRIDE='{"${unknownPrefixes[0]}":16}'.`;
      }
      return result;
    }

    case "get_dep_unassigned": {
      const serverId = args.dep_server_id != null ? String(args.dep_server_id) : undefined;
      const servers = serverId
        ? [{ id: serverId }]
        : (await collectAllPages<{ id: string|number }>("/dep_servers")).data;
      const unassigned: Array<{ dep_server_id: string|number; serial: string; model?: string; profile_uuid?: string|null }> = [];
      for (const s of servers) {
        const r = await collectAllPages<{ id: string|number; attributes?: Record<string, unknown> }>(`/dep_servers/${encodeURIComponent(String(s.id))}/dep_devices`);
        for (const dep of r.data) {
          const a = dep.attributes ?? {};
          if (a.profile_uuid == null || a.profile_uuid === "") {
            unassigned.push({
              dep_server_id: s.id,
              serial: a.serial_number as string ?? "",
              model: a.model as string | undefined,
              profile_uuid: a.profile_uuid as string | null | undefined ?? null,
            });
          }
        }
      }
      return { dep_servers_scanned: servers.length, unassigned_count: unassigned.length, devices: unassigned };
    }

    case "get_recently_enrolled": {
      const days = Math.max(1, Number(args.days ?? 7));
      const cutoff = Date.now() - days * 86_400_000;
      const all = await collectDevices();
      const recent = all
        .map(d => {
          const e = d.attributes.enrolled_at as string | undefined;
          const t = e ? Date.parse(e) : NaN;
          return { d, t };
        })
        .filter(x => Number.isFinite(x.t) && x.t >= cutoff)
        .sort((a, b) => b.t - a.t)
        .map(({ d, t }) => ({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          os: d.attributes.os_version ?? undefined,
          enrolled_at: d.attributes.enrolled_at as string | undefined,
          days_since_enroll: Math.floor((Date.now() - t) / 86_400_000),
        }));
      return { window_days: days, count: recent.length, devices: recent };
    }

    case "get_lost_mode_devices": {
      const all = await collectDevices();
      const inLost = all
        .filter(d => d.attributes.lost_mode_enabled === true || d.attributes.is_lost_mode_enabled === true)
        .map(d => ({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          os: d.attributes.os_version ?? undefined,
          location_latitude: d.attributes.location_latitude ?? d.attributes.lost_mode_latitude ?? null,
          location_longitude: d.attributes.location_longitude ?? d.attributes.lost_mode_longitude ?? null,
          location_updated_at: d.attributes.location_updated_at ?? d.attributes.lost_mode_location_updated_at ?? null,
        }));
      return { count: inLost.length, devices: inLost };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Tier 2 handlers
    // ══════════════════════════════════════════════════════════════════════

    case "get_app_install_failures": {
      const failed: Array<{ device_id: string|number; device_name?: string; bundle_identifier?: string; app_name?: string; status?: string }> = [];
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (d, apps) => {
        for (const a of apps) {
          const at = a.attributes ?? {};
          const status = String((at.install_status as string | undefined) ?? (at.status as string | undefined) ?? "").toLowerCase();
          if (status === "failed" || status === "error" || status === "rejected" || status === "stuck") {
            failed.push({
              device_id: d.id,
              device_name: d.attributes.name as string | undefined,
              bundle_identifier: (at.identifier as string | undefined) ?? (at.bundle_identifier as string | undefined),
              app_name: at.name as string | undefined,
              status,
            });
          }
        }
      });
      const result: Record<string, unknown> = { ...stats, failure_count: failed.length, failures: failed };
      if (failed.length === 0 && stats.devices_processed > 0) {
        result._agent_hint = "Zero install failures were found, but this may mean the SimpleMDM API is not populating the install_status field for this tenant rather than there being no failures. "
          + "Tell the admin: verify by running get_device_installed_apps on a single device and checking whether install_status is present in the response. If the field is missing, this tool cannot detect failures.";
      }
      return result;
    }

    case "get_battery_health_report": {
      const lowPct = Math.max(0, Math.min(100, Number(args.low_pct ?? 20)));
      const all = await collectDevices();
      const rows: Array<{ id: string|number; name?: string; serial?: string; level_pct?: number; cycles?: number; max_capacity_pct?: number; flagged: boolean; reason?: string }> = [];
      for (const d of all) {
        if (getDeviceStatus(d.attributes) !== "enrolled") continue;
        const raw = d.attributes.battery_level as number | string | null | undefined;
        if (raw == null) continue;
        const num = typeof raw === "string" ? parseFloat(raw.replace("%", "")) : Number(raw);
        const pct = Number.isFinite(num) ? (num <= 1 ? num * 100 : num) : undefined;
        const cycles = d.attributes.battery_cycle_count as number | undefined;
        const maxCap = d.attributes.battery_max_capacity_pct as number | undefined;
        const flagged = (pct !== undefined && pct <= lowPct) ||
                        (typeof cycles === "number" && cycles > 1000) ||
                        (typeof maxCap === "number" && maxCap < 80);
        if (!flagged) continue;
        rows.push({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          level_pct: pct,
          cycles,
          max_capacity_pct: maxCap,
          flagged: true,
          reason: pct !== undefined && pct <= lowPct ? "low_level"
                : typeof maxCap === "number" && maxCap < 80 ? "low_capacity"
                : "high_cycles",
        });
      }
      const hasCycleData = rows.some(r => r.cycles !== undefined);
      const hasCapData = rows.some(r => r.max_capacity_pct !== undefined);
      const enrolled = all.filter(d => getDeviceStatus(d.attributes) === "enrolled");
      const withBattery = enrolled.filter(d => d.attributes.battery_level != null);
      const result: Record<string, unknown> = { low_threshold_pct: lowPct, flagged_count: rows.length, devices_with_battery: withBattery.length, devices: rows };
      if (withBattery.length > 0 && !hasCycleData && !hasCapData) {
        result._agent_hint = "Battery level data is present but cycle_count and max_capacity fields are not populated for any device. "
          + "Results only reflect low charge level, not battery health degradation. "
          + "Tell the admin: these fields require MDM profile settings that enable battery health reporting — without them, aging batteries with low max capacity will not be flagged.";
      }
      return result;
    }

    case "get_network_summary": {
      const all = await collectDevices();
      const carriers: Record<string, number> = {};
      const rows: Array<{ id: string|number; name?: string; serial?: string; wifi_mac?: string; ethernet_macs?: string[]; last_seen_ip?: string; current_carrier?: string|null }> = [];
      for (const d of all) {
        if (getDeviceStatus(d.attributes) !== "enrolled") continue;
        const a = d.attributes;
        const carrier = (a.current_carrier_network as string | null | undefined) ?? null;
        if (carrier) carriers[carrier] = (carriers[carrier] ?? 0) + 1;
        rows.push({
          id: d.id,
          name: a.name as string | undefined,
          serial: a.serial_number as string | undefined,
          wifi_mac: a.wifi_mac as string | undefined,
          ethernet_macs: a.ethernet_macs as string[] | undefined,
          last_seen_ip: a.last_seen_ip as string | undefined,
          current_carrier: carrier,
        });
      }
      return { device_count: rows.length, carrier_breakdown: carriers, devices: rows };
    }

    case "get_user_attribution": {
      const attrName = String(args.custom_attribute_name ?? "").trim();
      if (!attrName) throw new Error("get_user_attribution requires custom_attribute_name");
      const stats = await forEachDevice(DEFAULT_FLEET_CONCURRENCY,
        d => getDeviceStatus(d.attributes) === "enrolled",
        async d => {
          const r = await simpleMDM(`/devices/${encodeURIComponent(String(d.id))}/custom_attribute_values`)
            .catch(() => ({ data: [] as Array<{ id: string; attributes?: { value?: string|null } }> })) as { data?: Array<{ id: string; attributes?: { value?: string|null } }> };
          const match = (r.data ?? []).find(v => v.id === attrName);
          const value = match?.attributes?.value ?? null;
          return {
            device_id: d.id,
            device_name: d.attributes.name as string | undefined,
            serial: d.attributes.serial_number as string | undefined,
            user: value,
          };
        });
      const byUser: Record<string, Array<unknown>> = {};
      const unattributed: Array<unknown> = [];
      for (const r of stats.results) {
        const u = (r as { user: string|null }).user;
        if (!u) unattributed.push(r);
        else (byUser[u] ??= []).push(r);
      }
      return {
        custom_attribute: attrName,
        ...stats,
        unique_users: Object.keys(byUser).length,
        unattributed_count: unattributed.length,
        by_user: byUser,
        unattributed,
      };
    }

    case "get_inactive_assignment_groups": {
      const r = await collectAllPages<{ id: string|number; attributes?: { name?: string }; relationships?: { devices?: { data?: unknown[] } } }>("/assignment_groups");
      const inactive = r.data
        .filter(g => !g.relationships?.devices?.data?.length)
        .map(g => ({ id: g.id, name: g.attributes?.name }));
      return { total_groups: r.data.length, inactive_count: inactive.length, groups: inactive };
    }

    case "get_orphaned_profiles": {
      const profilesResp = await collectAllPages<{ id: string|number; attributes?: { name?: string } }>("/custom_configuration_profiles");
      const groupsResp = await collectAllPages<{ id: string|number; relationships?: { profiles?: { data?: Array<{ id: string|number }> } } }>("/assignment_groups");
      const usedProfileIds = new Set<string>();
      for (const g of groupsResp.data) {
        for (const p of g.relationships?.profiles?.data ?? []) usedProfileIds.add(String(p.id));
      }
      const orphans = profilesResp.data
        .filter(p => !usedProfileIds.has(String(p.id)))
        .map(p => ({ id: p.id, name: p.attributes?.name }));
      return { total_profiles: profilesResp.data.length, orphan_count: orphans.length, profiles: orphans };
    }

    case "get_orphaned_apps": {
      const apps = await collectAllPages<{ id: string|number; attributes?: { name?: string } }>("/apps?include_shared=true");
      const groupsResp = await collectAllPages<{ id: string|number; relationships?: { apps?: { data?: Array<{ id: string|number }> } } }>("/assignment_groups");
      const usedAppIds = new Set<string>();
      for (const g of groupsResp.data) {
        for (const a of g.relationships?.apps?.data ?? []) usedAppIds.add(String(a.id));
      }
      const orphans = apps.data
        .filter(a => !usedAppIds.has(String(a.id)))
        .map(a => ({ id: a.id, name: a.attributes?.name }));
      return { total_apps: apps.data.length, orphan_count: orphans.length, apps: orphans };
    }

    case "get_app_size_footprint": {
      const limit = Math.max(1, Math.min(500, Number(args.limit ?? 25)));
      const totals = new Map<string, { bundle_identifier: string; name: string; install_count: number; bytes_per_install: number }>();
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (_, apps) => {
        for (const a of apps) {
          const at = a.attributes ?? {};
          const bid = (at.identifier as string | undefined) ?? (at.bundle_identifier as string | undefined);
          if (!bid) continue;
          const size = Number((at.app_size as number | undefined) ?? (at.size as number | undefined) ?? 0);
          if (!size) continue;
          const cur = totals.get(bid);
          if (cur) cur.install_count++;
          else totals.set(bid, { bundle_identifier: bid, name: (at.name as string | undefined) ?? bid, install_count: 1, bytes_per_install: size });
        }
      });
      const ranked = [...totals.values()]
        .map(a => ({ ...a, total_bytes: a.install_count * a.bytes_per_install }))
        .sort((a, b) => b.total_bytes - a.total_bytes)
        .slice(0, limit);
      return { ...stats, apps_with_size_data: totals.size, ranked_by_total_bytes: ranked };
    }

    case "get_assignment_group_drift": {
      const restrictGroupId = args.assignment_group_id != null ? String(args.assignment_group_id) : undefined;
      const groupsResp = await collectAllPages<{
        id: string|number;
        attributes?: { name?: string };
        relationships?: { apps?: { data?: Array<{ id: string|number }> }; devices?: { data?: Array<{ id: string|number }> } };
      }>("/assignment_groups");
      const groups = groupsResp.data.filter(g => !restrictGroupId || String(g.id) === restrictGroupId);
      const catalog = await collectAllPages<{ id: string|number; attributes?: { bundle_identifier?: string|null } }>("/apps?include_shared=true");
      const appIdToBid = new Map<string, string>();
      for (const a of catalog.data) {
        const b = a.attributes?.bundle_identifier;
        if (b) appIdToBid.set(String(a.id), b);
      }
      // Build a flat work queue across all in-scope (group, device) pairs so we
      // can run with the same bounded concurrency as the other fleet tools.
      type WorkItem = { groupId: string|number; groupName?: string; deviceId: string; expected: string[] };
      const queue: WorkItem[] = [];
      for (const g of groups) {
        const expectedBids = (g.relationships?.apps?.data ?? [])
          .map(a => appIdToBid.get(String(a.id)))
          .filter((x): x is string => !!x);
        if (!expectedBids.length) continue;
        for (const d of g.relationships?.devices?.data ?? []) {
          queue.push({ groupId: g.id, groupName: g.attributes?.name, deviceId: String(d.id), expected: expectedBids });
        }
      }
      const drift: Array<{ group_id: string|number; group_name?: string; device_id: string; missing: string[] }> = [];
      let errors = 0;
      const worker = async () => {
        while (queue.length) {
          const item = queue.pop()!;
          try {
            const installed = await collectInstalledApps(item.deviceId);
            const installedBids = new Set<string>();
            for (const a of installed) {
              const at = a.attributes ?? {};
              const bid = (at.identifier as string | undefined) ?? (at.bundle_identifier as string | undefined);
              if (bid) installedBids.add(bid);
            }
            const missing = item.expected.filter(b => !installedBids.has(b));
            if (missing.length) drift.push({ group_id: item.groupId, group_name: item.groupName, device_id: item.deviceId, missing });
          } catch { errors++; }
        }
      };
      await Promise.all(Array.from({ length: DEFAULT_FLEET_CONCURRENCY }, worker));
      return { groups_checked: groups.length, drift_rows: drift.length, devices_with_errors: errors, drift };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Tier 3 handlers
    // ══════════════════════════════════════════════════════════════════════

    case "get_certificate_expiration_audit": {
      const r = await api("/push_certificate") as { data?: { attributes?: Record<string, unknown> } };
      const a = r.data?.attributes ?? {};
      const expiry = (a.expires_at as string | undefined) ?? (a.expiration as string | undefined);
      let days_until_expiry: number | null = null;
      let warning: "ok" | "renew_soon" | "renew_now" | "expired" | "unknown" = "unknown";
      if (expiry) {
        const t = Date.parse(expiry);
        if (Number.isFinite(t)) {
          days_until_expiry = Math.floor((t - Date.now()) / 86_400_000);
          warning = days_until_expiry < 0 ? "expired"
                  : days_until_expiry <= 30 ? "renew_now"
                  : days_until_expiry <= 90 ? "renew_soon" : "ok";
        }
      }
      return { apple_id: a.apple_id, expires_at: expiry ?? null, days_until_expiry, warning };
    }

    case "get_enrollment_token_audit": {
      const staleDays = Math.max(1, Number(args.stale_days ?? 90));
      const cutoff = Date.now() - staleDays * 86_400_000;
      const r = await collectAllPages<{ id: string|number; attributes?: Record<string, unknown> }>("/enrollments");
      const rows = r.data.map(e => {
        const at = e.attributes ?? {};
        const created = at.created_at as string | undefined;
        const lastUsed = (at.last_used_at as string | undefined) ?? (at.welcome_screen_dismissed_at as string | undefined);
        const lastUsedT = lastUsed ? Date.parse(lastUsed) : NaN;
        return {
          id: e.id,
          created_at: created,
          last_used_at: lastUsed,
          stale: !lastUsed || (Number.isFinite(lastUsedT) && lastUsedT < cutoff),
          enrollment_url: at.url as string | undefined,
        };
      });
      return { stale_days: staleDays, total: rows.length, stale_count: rows.filter(r => r.stale).length, enrollments: rows };
    }

    case "get_device_user_count_outliers": {
      const minUsers = Math.max(1, Number(args.min_users ?? 5));
      const stats = await forEachDevice(DEFAULT_FLEET_CONCURRENCY,
        d => getDeviceStatus(d.attributes) === "enrolled" && (d.attributes.model_name as string | undefined ?? "").includes("Mac"),
        async d => {
          const r = await simpleMDM(`/devices/${encodeURIComponent(String(d.id))}/users`) as { data?: unknown[] };
          const count = (r.data ?? []).length;
          if (count < minUsers) return undefined;
          return {
            id: d.id,
            name: d.attributes.name as string | undefined,
            serial: d.attributes.serial_number as string | undefined,
            user_count: count,
          };
        });
      return { threshold: minUsers, ...stats, outlier_count: stats.results.length, devices: stats.results.sort((a, b) => b.user_count - a.user_count) };
    }

    case "get_supervision_drift": {
      const all = await collectDevices();
      const drift = all.filter(d =>
        getDeviceStatus(d.attributes) === "enrolled"
        && d.attributes.dep_enrolled === true
        && d.attributes.is_supervised === false
      ).map(d => ({
        id: d.id,
        name: d.attributes.name as string | undefined,
        serial: d.attributes.serial_number as string | undefined,
        os: d.attributes.os_version ?? undefined,
      }));
      return { drift_count: drift.length, devices: drift };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Tier 4 selection
    // ══════════════════════════════════════════════════════════════════════

    case "get_apps_by_publisher": {
      const limitPub = Math.max(1, Math.min(200, Number(args.limit_publishers ?? 20)));
      const excludeApple = args.exclude_apple !== false;
      const byPub = new Map<string, { publisher: string; total_installs: number; apps: Map<string, { bundle_identifier: string; name: string; count: number }> }>();
      const stats = await forEachDeviceInstalledApps(DEFAULT_FLEET_CONCURRENCY, (_, apps) => {
        const seen = new Set<string>();
        for (const a of apps) {
          const at = a.attributes ?? {};
          const bid = (at.identifier as string | undefined) ?? (at.bundle_identifier as string | undefined);
          if (!bid) continue;
          if (excludeApple && bid.startsWith("com.apple.")) continue;
          if (seen.has(bid)) continue;
          seen.add(bid);
          const parts = bid.split(".");
          const publisher = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : bid;
          const name = (at.name as string | undefined) ?? bid;
          const pub = byPub.get(publisher) ?? { publisher, total_installs: 0, apps: new Map() };
          pub.total_installs++;
          const appCur = pub.apps.get(bid);
          if (appCur) appCur.count++;
          else pub.apps.set(bid, { bundle_identifier: bid, name, count: 1 });
          byPub.set(publisher, pub);
        }
      });
      const ranked = [...byPub.values()]
        .sort((a, b) => b.total_installs - a.total_installs)
        .slice(0, limitPub)
        .map(p => ({
          publisher: p.publisher,
          total_installs: p.total_installs,
          unique_apps: p.apps.size,
          apps: [...p.apps.values()].sort((a, b) => b.count - a.count),
        }));
      return { ...stats, publishers_returned: ranked.length, publishers: ranked };
    }

    // ── Devices read ─────────────────────────────────────────────────────────
    case "list_devices": {
      const r = await collectAllPages<AnyRecord>(`/devices${qs(args, ["search", "include_awaiting_enrollment"])}`);
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_device": return api(`/devices/${seg(args.device_id, "device_id")}`);
    case "get_device_profiles": return collectAllPages(`/devices/${seg(args.device_id, "device_id")}/profiles`);
    case "get_device_installed_apps": return collectAllPages(`/devices/${seg(args.device_id, "device_id")}/installed_apps`);
    case "get_device_users": return collectAllPages(`/devices/${seg(args.device_id, "device_id")}/users`);
    case "get_device_logs":
    case "list_logs":
      return collectAllPages(`/logs${qs(args, ["serial_number"])}`);
    case "get_log": return api(`/logs/${seg(args.log_id, "log_id")}`);

    // ── Devices write ────────────────────────────────────────────────────────
    case "create_device":
      requireWrites();
      return api("/devices", { method: "POST", body: j({ name: args.name, group_id: args.group_id }) });
    case "update_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}`, { method: "PATCH", body: j({ name: args.name, device_name: args.device_name }) });
    case "delete_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });
    case "delete_device_user":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/users/${seg(args.user_id, "user_id")}`, { method: "DELETE" });

    // ── Device actions ───────────────────────────────────────────────────────
    case "lock_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/lock`, { method: "POST", body: j({ message: args.message, pin: args.pin }) });
    case "wipe_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/wipe`, { method: "POST", body: j({ pin: args.pin }) });
    case "sync_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/push_apps`, { method: "POST" });
    case "restart_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/restart`, { method: "POST" });
    case "shutdown_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/shutdown`, { method: "POST" });
    case "unenroll_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/unenroll`, { method: "POST" });
    case "clear_passcode":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/clear_passcode`, { method: "POST" });
    case "clear_restrictions_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/clear_restrictions_password`, { method: "POST" });
    case "update_os":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/update_os`, { method: "POST" });
    case "enable_lost_mode":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/lost_mode`, { method: "POST", body: j({ message: args.message, phone_number: args.phone_number, footnote: args.footnote }) });
    case "disable_lost_mode":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/lost_mode`, { method: "DELETE" });
    case "play_lost_mode_sound":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/lost_mode/play_sound`, { method: "POST" });
    case "update_lost_mode_location":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/lost_mode/update_location`, { method: "POST" });
    case "clear_firmware_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/clear_firmware_password`, { method: "POST" });
    case "rotate_firmware_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/rotate_firmware_password`, { method: "POST" });
    case "clear_recovery_lock_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/clear_recovery_lock_password`, { method: "POST" });
    case "rotate_recovery_lock_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/rotate_recovery_lock_password`, { method: "POST" });
    case "rotate_filevault_recovery_key":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/rotate_filevault_recovery_key`, { method: "POST" });
    case "set_admin_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/set_admin_password`, { method: "POST", body: j({ new_password: args.new_password }) });
    case "rotate_admin_password":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/rotate_admin_password`, { method: "POST" });
    case "enable_remote_desktop":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/enable_remote_desktop`, { method: "POST" });
    case "disable_remote_desktop":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/disable_remote_desktop`, { method: "POST" });
    case "enable_bluetooth":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/enable_bluetooth`, { method: "POST" });
    case "disable_bluetooth":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/disable_bluetooth`, { method: "POST" });
    case "set_time_zone":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/set_time_zone`, { method: "POST", body: j({ time_zone: args.time_zone }) });

    // ── Assignment groups ────────────────────────────────────────────────────
    case "list_assignment_groups": {
      const r = await collectAllPages<AnyRecord>("/assignment_groups");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_assignment_group": return api(`/assignment_groups/${seg(args.group_id, "group_id")}`);
    case "create_assignment_group":
      requireWrites();
      return api("/assignment_groups", { method: "POST", body: j({ name: args.name, auto_deploy: args.auto_deploy }) });
    case "update_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}`, { method: "PATCH", body: j({ name: args.name, auto_deploy: args.auto_deploy }) });
    case "delete_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}`, { method: "DELETE" });
    case "assign_device_to_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "POST" });
    case "unassign_device_from_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });
    case "assign_app_to_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/apps/${seg(args.app_id, "app_id")}`, { method: "POST", body: j({ deployment_type: args.deployment_type, install_type: args.install_type }) });
    case "unassign_app_from_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/apps/${seg(args.app_id, "app_id")}`, { method: "DELETE" });
    case "assign_profile_to_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/profiles/${seg(args.profile_id, "profile_id")}`, { method: "POST" });
    case "unassign_profile_from_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/profiles/${seg(args.profile_id, "profile_id")}`, { method: "DELETE" });
    case "push_apps_to_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/push_apps`, { method: "POST" });
    case "update_apps_in_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/update_apps`, { method: "POST" });
    case "sync_profiles_in_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/sync_profiles`, { method: "POST" });
    case "clone_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${seg(args.group_id, "group_id")}/clone`, { method: "POST" });

    // ── Apps ─────────────────────────────────────────────────────────────────
    case "list_apps": {
      const r = await collectAllPages<AnyRecord>(`/apps?include_shared=${args.include_shared !== false}`);
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_app": return api(`/apps/${seg(args.app_id, "app_id")}`);
    case "create_app":
      requireWrites();
      return api("/apps", { method: "POST", body: j({ app_store_id: args.app_store_id, bundle_id: args.bundle_id, name: args.name }) });
    case "update_app":
      requireWrites();
      return api(`/apps/${seg(args.app_id, "app_id")}`, { method: "PATCH", body: j({ name: args.name, deploy_to: args.deploy_to }) });
    case "delete_app":
      requireWrites();
      return api(`/apps/${seg(args.app_id, "app_id")}`, { method: "DELETE" });
    case "list_app_installs": return collectAllPages(`/apps/${seg(args.app_id, "app_id")}/installs`);

    // ── Installed apps ────────────────────────────────────────────────────────
    case "get_installed_app": return api(`/installed_apps/${seg(args.installed_app_id, "installed_app_id")}`);
    case "request_app_management":
      requireWrites();
      return api(`/installed_apps/${seg(args.installed_app_id, "installed_app_id")}/request_management`, { method: "POST" });
    case "update_installed_app":
      requireWrites();
      return api(`/installed_apps/${seg(args.installed_app_id, "installed_app_id")}/update`, { method: "POST" });
    case "uninstall_app":
      requireWrites();
      return api(`/installed_apps/${seg(args.installed_app_id, "installed_app_id")}`, { method: "DELETE" });

    // ── Custom attributes ─────────────────────────────────────────────────────
    case "list_custom_attributes": return collectAllPages("/custom_attributes");
    case "get_custom_attribute": return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}`);
    case "create_custom_attribute":
      requireWrites();
      return api("/custom_attributes", { method: "POST", body: j({ name: args.name, default_value: args.default_value }) });
    case "update_custom_attribute":
      requireWrites();
      return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}`, { method: "PATCH", body: j({ default_value: args.default_value }) });
    case "delete_custom_attribute":
      requireWrites();
      return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}`, { method: "DELETE" });
    case "get_device_attribute_values": return api(`/custom_attributes/devices/${seg(args.device_id, "device_id")}`);
    case "set_device_attribute_value":
      requireWrites();
      return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}/devices/${seg(args.device_id, "device_id")}`, { method: "PUT", body: j({ value: args.value }) });
    case "set_attribute_for_multiple_devices":
      requireWrites();
      return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}/devices`, { method: "PUT", body: j({ device_ids: args.device_ids, value: args.value }) });
    case "get_group_attribute_values": return api(`/custom_attributes/assignment_groups/${seg(args.group_id, "group_id")}`);
    case "set_group_attribute_value":
      requireWrites();
      return api(`/custom_attributes/${seg(args.attribute_name, "attribute_name")}/assignment_groups/${seg(args.group_id, "group_id")}`, { method: "PUT", body: j({ value: args.value }) });

    // ── Custom configuration profiles ─────────────────────────────────────────
    case "list_custom_configuration_profiles": {
      const r = await collectAllPages<AnyRecord>("/custom_configuration_profiles");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "create_custom_configuration_profile":
      requireWrites();
      return api("/custom_configuration_profiles", { method: "POST", body: j({ name: args.name, mobileconfig: args.mobileconfig, user_scope: args.user_scope, attribute_support: args.attribute_support }) });
    case "update_custom_configuration_profile":
      requireWrites();
      return api(`/custom_configuration_profiles/${seg(args.profile_id, "profile_id")}`, { method: "PATCH", body: j({ name: args.name, mobileconfig: args.mobileconfig, user_scope: args.user_scope }) });
    case "delete_custom_configuration_profile":
      requireWrites();
      return api(`/custom_configuration_profiles/${seg(args.profile_id, "profile_id")}`, { method: "DELETE" });
    case "assign_custom_profile_to_device":
      requireWrites();
      return api(`/custom_configuration_profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "POST" });
    case "unassign_custom_profile_from_device":
      requireWrites();
      return api(`/custom_configuration_profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });

    // ── Custom declarations ───────────────────────────────────────────────────
    case "list_custom_declarations": {
      const r = await collectAllPages<AnyRecord>("/custom_declarations");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_custom_declaration": return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}`);
    case "create_custom_declaration":
      requireWrites();
      return api("/custom_declarations", { method: "POST", body: j({ name: args.name, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update, user_scope: args.user_scope }) });
    case "update_custom_declaration":
      requireWrites();
      return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}`, { method: "PATCH", body: j({ name: args.name, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update }) });
    case "delete_custom_declaration":
      requireWrites();
      return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}`, { method: "DELETE" });
    case "assign_declaration_to_device":
      requireWrites();
      return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "POST" });
    case "unassign_declaration_from_device":
      requireWrites();
      return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });

    // ── Profiles ─────────────────────────────────────────────────────────────
    case "list_profiles": {
      const r = await collectAllPages<AnyRecord>("/profiles");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_profile": return api(`/profiles/${seg(args.profile_id, "profile_id")}`);
    case "assign_profile_to_device":
      requireWrites();
      return api(`/profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "POST" });
    case "unassign_profile_from_device":
      requireWrites();
      return api(`/profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });

    // ── DEP servers ───────────────────────────────────────────────────────────
    case "list_dep_servers": return collectAllPages("/dep_servers");
    case "get_dep_server": return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}`);
    case "sync_dep_server":
      requireWrites();
      return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/sync`, { method: "POST" });
    case "list_dep_devices": return collectAllPages(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/dep_devices`);
    case "get_dep_device": return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/dep_devices/${seg(args.dep_device_id, "dep_device_id")}`);

    // ── Device groups (legacy) ────────────────────────────────────────────────
    case "list_device_groups": {
      const r = await collectAllPages<AnyRecord>("/device_groups");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "get_device_group": return api(`/device_groups/${seg(args.group_id, "group_id")}`);

    // ── Enrollments ───────────────────────────────────────────────────────────
    case "list_enrollments": return collectAllPages("/enrollments");
    case "get_enrollment": return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}`);
    case "send_enrollment_invitation":
      requireWrites();
      return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}/invitations`, { method: "POST", body: j({ contact: args.contact }) });
    case "delete_enrollment":
      requireWrites();
      return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}`, { method: "DELETE" });

    // ── Managed app configs ───────────────────────────────────────────────────
    case "list_managed_app_configs": return collectAllPages(`/apps/${seg(args.app_id, "app_id")}/managed_configs`);
    case "create_managed_app_config":
      requireWrites();
      return api(`/apps/${seg(args.app_id, "app_id")}/managed_configs`, { method: "POST", body: j({ key: args.key, value: args.value, kind: args.kind }) });
    case "delete_managed_app_config":
      requireWrites();
      return api(`/apps/${seg(args.app_id, "app_id")}/managed_configs/${seg(args.config_id, "config_id")}`, { method: "DELETE" });
    case "push_managed_app_configs":
      requireWrites();
      return api(`/apps/${seg(args.app_id, "app_id")}/managed_configs/push`, { method: "POST" });

    // ── Push certificate ──────────────────────────────────────────────────────
    case "get_push_certificate": return api("/push_certificate");
    case "get_signed_csr": return api("/push_certificate/scsr");

    // ── Scripts ───────────────────────────────────────────────────────────────
    case "list_scripts": return collectAllPages("/scripts");
    case "get_script": return api(`/scripts/${seg(args.script_id, "script_id")}`);
    case "create_script":
      requireWrites();
      return api("/scripts", { method: "POST", body: j({ name: args.name, content: args.content }) });
    case "update_script":
      requireWrites();
      return api(`/scripts/${seg(args.script_id, "script_id")}`, { method: "PATCH", body: j({ name: args.name, content: args.content }) });
    case "delete_script":
      requireWrites();
      return api(`/scripts/${seg(args.script_id, "script_id")}`, { method: "DELETE" });

    // ── Script jobs ───────────────────────────────────────────────────────────
    case "list_script_jobs": return collectAllPages(`/script_jobs${qs(args, ["status"])}`);
    case "get_script_job": return api(`/script_jobs/${seg(args.job_id, "job_id")}`);
    case "create_script_job":
      requireWrites();
      return api("/script_jobs", { method: "POST", body: j({ script_id: args.script_id, device_ids: args.device_ids }) });
    case "cancel_script_job":
      requireWrites();
      return api(`/script_jobs/${seg(args.job_id, "job_id")}`, { method: "DELETE" });

    // ── MunkiReport enrichment ────────────────────────────────────────────────
    case "get_munkireport_sync_health":       return USE_LOCAL_APP ? api("/enrichment/sync_health")          : munkiReport("/data/sync_health");
    case "get_munkireport_compliance":        return USE_LOCAL_APP ? api("/enrichment/compliance")            : munkiReport("/simplemdm/data/compliance_stats");
    case "get_munkireport_device_resources":  return USE_LOCAL_APP ? api(`/enrichment/device/${encodeURIComponent(String(args.serial_number))}`) : munkiReport(`/get_device_resources/${encodeURIComponent(String(args.serial_number))}`);
    case "get_munkireport_apple_care":        return USE_LOCAL_APP ? api("/enrichment/apple_care")            : munkiReport("/simplemdm/data/apple_care_stats");
    case "get_munkireport_supplemental_overview": return USE_LOCAL_APP ? api("/enrichment/supplemental_overview") : munkiReport("/simplemdm/data/supplemental_overview");

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Tool annotations (applied once at startup) ───────────────────────────────
// MCP spec annotations inform clients how to render/guard each tool. A tool is
// a write if its handler calls requireWrites(); DESTRUCTIVE is a subset flagged
// for extra client confirmation.

const WRITE_TOOLS = new Set<string>([
  "update_account",
  "create_device", "update_device", "delete_device", "delete_device_user",
  "lock_device", "wipe_device", "sync_device", "restart_device", "shutdown_device",
  "unenroll_device", "clear_passcode", "clear_restrictions_password", "update_os",
  "enable_lost_mode", "disable_lost_mode", "play_lost_mode_sound", "update_lost_mode_location",
  "clear_firmware_password", "rotate_firmware_password",
  "clear_recovery_lock_password", "rotate_recovery_lock_password",
  "rotate_filevault_recovery_key", "set_admin_password", "rotate_admin_password",
  "enable_remote_desktop", "disable_remote_desktop",
  "enable_bluetooth", "disable_bluetooth", "set_time_zone",
  "create_assignment_group", "update_assignment_group", "delete_assignment_group",
  "assign_device_to_group", "unassign_device_from_group",
  "assign_app_to_group", "unassign_app_from_group",
  "assign_profile_to_group", "unassign_profile_from_group",
  "push_apps_to_group", "update_apps_in_group", "sync_profiles_in_group", "clone_assignment_group",
  "create_app", "update_app", "delete_app",
  "request_app_management", "update_installed_app", "uninstall_app",
  "create_custom_attribute", "update_custom_attribute", "delete_custom_attribute",
  "set_device_attribute_value", "set_attribute_for_multiple_devices", "set_group_attribute_value",
  "create_custom_configuration_profile", "update_custom_configuration_profile", "delete_custom_configuration_profile",
  "assign_custom_profile_to_device", "unassign_custom_profile_from_device",
  "create_custom_declaration", "update_custom_declaration", "delete_custom_declaration",
  "assign_declaration_to_device", "unassign_declaration_from_device",
  "assign_profile_to_device", "unassign_profile_from_device",
  "sync_dep_server",
  "send_enrollment_invitation", "delete_enrollment",
  "create_managed_app_config", "delete_managed_app_config", "push_managed_app_configs",
  "create_script", "update_script", "delete_script",
  "create_script_job", "cancel_script_job",
]);

const DESTRUCTIVE = new Set<string>([
  "wipe_device",
  "unenroll_device",
  "delete_device",
  "delete_device_user",
  "delete_app",
  "delete_assignment_group",
  "delete_custom_attribute",
  "delete_custom_configuration_profile",
  "delete_custom_declaration",
  "delete_enrollment",
  "delete_managed_app_config",
  "delete_script",
  "clear_passcode",
  "clear_restrictions_password",
  "clear_firmware_password",
  "clear_recovery_lock_password",
]);

function titleCase(name: string): string {
  return name.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

for (const t of TOOLS) {
  const isWrite = WRITE_TOOLS.has(t.name);
  t.annotations = {
    title: titleCase(t.name),
    readOnlyHint: !isWrite,
    destructiveHint: DESTRUCTIVE.has(t.name),
    idempotentHint: !isWrite,
    openWorldHint: true,
  };
}

// ─── Resources (canonical report URIs) ────────────────────────────────────────

const RESOURCES = [
  { uri: "simplemdm://fleet/summary",          name: "Fleet summary",          description: "Total devices, enrolled/unenrolled, supervised/DEP/FileVault posture, OS breakdown.",               mimeType: "application/json" },
  { uri: "simplemdm://reports/security-posture", name: "Security posture",     description: "Fleet-wide percentages and counts for supervised, DEP, FileVault, firmware/recovery/activation lock, UAMDM, passcode compliance.", mimeType: "application/json" },
  { uri: "simplemdm://reports/os-versions",    name: "OS version report",      description: "Device count by OS major/minor version across the fleet.",                                         mimeType: "application/json" },
  { uri: "simplemdm://reports/enrollment",     name: "Enrollment status",      description: "Enrolled vs unenrolled counts and the list of unenrolled devices for cleanup.",                    mimeType: "application/json" },
  { uri: "simplemdm://reports/filevault",      name: "FileVault status",       description: "Which enrolled Macs have FileVault on vs off (name, serial, OS).",                                 mimeType: "application/json" },
  { uri: "simplemdm://inventory/devices",      name: "Device inventory",       description: "Full device list (auto-paginated, cached).",       mimeType: "application/json" },
  { uri: "simplemdm://inventory/assignment-groups", name: "Assignment groups", description: "Full list of assignment groups with their apps/devices/profiles.",                                  mimeType: "application/json" },
  { uri: "simplemdm://inventory/apps",         name: "App catalog",            description: "Full app catalog (auto-paginated, cached).",                                     mimeType: "application/json" },
  { uri: "simplemdm://reports/top-apps",       name: "Top installed apps",     description: "Apps ranked by install count across the fleet (excludes com.apple.*). Slow — iterates every device.", mimeType: "application/json" },
  { uri: "simplemdm://reports/unmanaged-apps", name: "Unmanaged apps",         description: "Apps installed on the fleet but missing from the SimpleMDM catalog. Shadow-IT discovery.",          mimeType: "application/json" },
  { uri: "simplemdm://reports/stale-devices",  name: "Stale devices (14d)",    description: "Enrolled devices that have not checked in for more than 14 days. Fast.",                              mimeType: "application/json" },
  { uri: "simplemdm://reports/storage-health", name: "Storage / battery health", description: "Enrolled devices with low free disk (<20GB) or low battery (<=20%). Fast.",                        mimeType: "application/json" },
];

async function readResource(uri: string): Promise<unknown> {
  switch (uri) {
    case "simplemdm://fleet/summary":                 return handleTool("get_fleet_summary", {});
    case "simplemdm://reports/security-posture":      return handleTool("get_security_posture", {});
    case "simplemdm://reports/os-versions": {
      const summary = await handleTool("get_fleet_summary", {}) as { os_version_breakdown?: Record<string, number> };
      return { os_version_breakdown: summary.os_version_breakdown ?? {} };
    }
    case "simplemdm://reports/enrollment": {
      const summary = await handleTool("get_fleet_summary", {}) as { total?: number; enrolled?: number; unenrolled?: number };
      const unenrolled: Array<{ id: string | number; name?: string; serial?: string }> = [];
      if (!USE_LOCAL_APP) {
        for await (const d of paginateDevices()) {
          if (getDeviceStatus(d.attributes) !== "enrolled") {
            unenrolled.push({
              id: d.id,
              name: d.attributes.name as string | undefined,
              serial: d.attributes.serial_number as string | undefined,
            });
          }
        }
      }
      return { total: summary.total, enrolled: summary.enrolled, unenrolled: summary.unenrolled, unenrolled_devices: unenrolled };
    }
    case "simplemdm://reports/filevault": {
      if (USE_LOCAL_APP) return api("/reports/filevault");
      const rows: Array<{ id: string | number; name?: string; serial?: string; os?: string; filevault_enabled: boolean }> = [];
      for await (const d of paginateDevices()) {
        if (getDeviceStatus(d.attributes) !== "enrolled") continue;
        const model = d.attributes.model_name as string | undefined;
        if (!model || !/Mac/i.test(model)) continue;
        rows.push({
          id: d.id,
          name: d.attributes.name as string | undefined,
          serial: d.attributes.serial_number as string | undefined,
          os: d.attributes.os_version ?? undefined,
          filevault_enabled: d.attributes.filevault_enabled === true,
        });
      }
      const on  = rows.filter(r => r.filevault_enabled).length;
      const off = rows.length - on;
      return { macs_total: rows.length, filevault_on: on, filevault_off: off, devices: rows };
    }
    case "simplemdm://inventory/devices":             return handleTool("list_devices", {});
    case "simplemdm://inventory/assignment-groups":   return handleTool("list_assignment_groups", {});
    case "simplemdm://inventory/apps":                return handleTool("list_apps", {});
    case "simplemdm://reports/top-apps":              return handleTool("get_top_installed_apps", {});
    case "simplemdm://reports/unmanaged-apps":        return handleTool("get_unmanaged_apps", {});
    case "simplemdm://reports/stale-devices":         return handleTool("get_stale_devices", {});
    case "simplemdm://reports/storage-health":        return handleTool("get_storage_health", {});
    default: throw new Error(`Unknown resource: ${uri}`);
  }
}

// ─── Prompts (workflow templates) ─────────────────────────────────────────────

const PROMPTS = [
  {
    name: "fleet-health-dashboard",
    description: "Comprehensive fleet health snapshot — enrollment, security posture, OS currency, recent unenrolled devices.",
    arguments: [],
  },
  {
    name: "security-audit",
    description: "Full security posture audit — FileVault, supervised, DEP, firmware/recovery-lock, activation-lock, user-approved MDM, with outliers.",
    arguments: [],
  },
  {
    name: "new-device-onboarding",
    description: "Verify a newly enrolled device: profiles assigned, apps installed, group membership, and recent MDM command log.",
    arguments: [
      { name: "device_ref", description: "Device ID or serial number of the newly enrolled device.", required: true },
    ],
  },
  {
    name: "device-offboarding",
    description: "Prepare a device for offboarding: unscope from assignment groups, lock or wipe (destructive — requires confirmation), and note remaining profiles.",
    arguments: [
      { name: "device_ref", description: "Device ID or serial number to offboard.", required: true },
    ],
  },
  {
    name: "patch-compliance-review",
    description: "Review OS version distribution across the fleet and identify devices more than one major version behind the latest observed.",
    arguments: [],
  },
  {
    name: "stale-devices-cleanup",
    description: "Find devices that appear enrolled but have not checked in recently; propose sync, lock, or unenroll actions per device.",
    arguments: [
      { name: "days", description: "Number of days since last check-in to consider stale. Default 14.", required: false },
    ],
  },
  {
    name: "compliance-violators-remediation",
    description: "Find compliance violators and produce a prioritized remediation plan grouped by failure type. Read-only — proposes actions, does not execute.",
    arguments: [
      { name: "max_os_major_lag", description: "Major versions behind to count as out-of-date. Default 1.", required: false },
    ],
  },
  {
    name: "profile-coverage-remediation",
    description: "For a given profile_id, list the missing-profile devices and propose either bulk assignment via assignment groups or per-device assign_profile_to_device calls.",
    arguments: [
      { name: "profile_id", description: "SimpleMDM profile ID to verify coverage for.", required: true },
    ],
  },
  {
    name: "app-inventory-audit",
    description: "Cross-fleet app inventory: top installed apps + apps installed but not in the SimpleMDM catalog (shadow IT). Recommends catalog additions and removals.",
    arguments: [
      { name: "limit", description: "Top N apps to report. Default 25.", required: false },
    ],
  },
];

function promptBody(name: string, args: Record<string, string> | undefined): string {
  const a = args ?? {};
  switch (name) {
    case "fleet-health-dashboard":
      return "Give me a fleet health dashboard. Call get_fleet_summary and get_security_posture in parallel. Then summarize: total devices, enrolled/unenrolled split, supervised and DEP percentages, FileVault enablement rate, OS major-version distribution, and any obvious posture outliers. End with up to 3 concrete recommendations.";
    case "security-audit":
      return "Run a full security audit. Call get_security_posture. For each posture metric below 80%, note it as an outlier. Specifically check: supervised, dep_enrolled, filevault_enabled, firmware_password, recovery_lock_password, activation_lock, user_approved_mdm, passcode_compliant. For macOS specifically, if FileVault enablement is under 80%, list the Macs that are off (call the simplemdm://reports/filevault resource). End with a prioritized remediation plan.";
    case "new-device-onboarding":
      return `Verify new-device onboarding for ${a.device_ref || "the specified device"}. Call get_device_full_profile with device_id or serial_number = ${a.device_ref || "{device_ref}"}. Then report: assigned configuration profiles, installed managed apps vs still-pending apps, assignment group memberships, supervised status, DEP status, and the most recent 5 MDM commands with timestamps and status. Flag anything unusual.`;
    case "device-offboarding":
      return `Prepare ${a.device_ref || "the specified device"} for offboarding. First call get_device_full_profile to confirm the device. List its current assignment groups, installed profiles, and any outstanding MDM commands. Propose (but do not execute) the offboarding steps: 1) unassign from each assignment group, 2) clear sensitive profiles, 3) lock or wipe (destructive — require explicit confirmation from the user before calling). Do not call any write tools without the user typing CONFIRM.`;
    case "patch-compliance-review":
      return "Review OS version distribution. Call get_fleet_summary and inspect os_version_breakdown. Identify the latest macOS, iOS, iPadOS major version observed. List device counts that are more than one major version behind each, and summarize patch risk. Recommend which device groups to prioritize for update_os.";
    case "stale-devices-cleanup": {
      const days = a.days || "14";
      return `Find stale devices using get_stale_devices with days=${days}. Group the result by os major version and propose remediation: sync_device for borderline cases, lock_device only if a device is past 30 days. Do not unenroll or wipe anything automatically — present the plan and wait for confirmation.`;
    }
    case "compliance-violators-remediation": {
      const lag = a.max_os_major_lag || "1";
      return `Call get_compliance_violators with max_os_major_lag=${lag}. Group the result by failure type (passcode_not_compliant, filevault_off, not_supervised, not_user_approved_mdm, os_*_majors_behind). For each group, propose the remediation tool that would address it (e.g. clear_passcode + user re-enrollment for passcode failures; profile reassignment for FileVault; update_os for OS lag). Do not call any write tool. End with a numbered remediation list ranked by device count.`;
    }
    case "profile-coverage-remediation": {
      const pid = a.profile_id || "{profile_id}";
      return `Call get_devices_missing_profile with profile_id=${pid}. If more than 20 devices are missing it, recommend creating or expanding an assignment group rather than per-device assignment. Otherwise, list the per-device assign_profile_to_device calls that would close the gap. Do not execute any writes — produce the plan only.`;
    }
    case "app-inventory-audit": {
      const limit = a.limit || "25";
      return `Run a cross-fleet app inventory audit. Call get_top_installed_apps with limit=${limit} and get_unmanaged_apps in parallel. Then: 1) flag any unmanaged app installed on more than 50% of the fleet as a strong candidate for catalog addition (so updates and configuration can be managed); 2) flag catalog apps with very low install_pct as candidates for removal or reassignment; 3) call out anything that looks like obviously legitimate Apple/Adobe/Microsoft helper processes (don't recommend managing those). End with a 5–10 item action list ranked by impact.`;
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

// ─── Input validation (from declared inputSchema) ─────────────────────────────
// Lightweight guard: required presence + primitive type checks. Not a full
// JSON Schema validator — keeps the dependency surface small — but catches the
// common "arg missing" / "wrong type" cases before they hit upstream.

const TOOL_SCHEMAS = new Map(TOOLS.map(t => [t.name, t.inputSchema]));

function validateArgs(toolName: string, args: Args): void {
  const schema = TOOL_SCHEMAS.get(toolName);
  if (!schema) return;
  const required = (schema as { required?: string[] }).required ?? [];
  const props = (schema as { properties?: Record<string, { type?: string | string[] }> }).properties ?? {};

  for (const r of required) {
    if (args[r] == null || args[r] === "") throw new Error(`${toolName}: missing required argument "${r}"`);
  }
  for (const [key, spec] of Object.entries(props)) {
    if (args[key] == null) continue;
    const expected = Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : [];
    if (expected.length === 0) continue;
    const actual = Array.isArray(args[key]) ? "array" : typeof args[key];
    if (!expected.includes(actual)) {
      throw new Error(`${toolName}: argument "${key}" must be ${expected.join("|")}, got ${actual}`);
    }
  }
}

function formatError(err: unknown): string {
  if (err instanceof HttpError) return `${err.upstream} ${err.status}${err.bodyExcerpt ? `: ${err.bodyExcerpt}` : ""}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "simplemdm-mcp", version: PKG_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    validateArgs(name, args as Args);
    const result = await handleTool(name, args as Args);
    const prefixes = INVALIDATION_MAP[name];
    if (prefixes?.length) cacheInvalidate(...prefixes);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${formatError(err)}` }], isError: true };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  const data = await readResource(uri);
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments as Record<string, string> | undefined;
  const text = promptBody(name, args);
  const prompt = PROMPTS.find(p => p.name === name);
  return {
    description: prompt?.description,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
});

async function main(): Promise<void> {
  if (!USE_LOCAL_APP && !API_KEY) {
    throw new Error("SIMPLEMDM_API_KEY is required unless LOCAL_APP_MODE=true.");
  }
  if (USE_LOCAL_APP) await checkLocalApp();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (signal: string) => {
    console.error(`Received ${signal}, shutting down.`);
    try { await server.close(); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on("SIGINT",  () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(err => {
  console.error(`Fatal: ${formatError(err)}`);
  process.exit(1);
});
