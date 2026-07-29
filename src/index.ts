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
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localApp, checkLocalApp } from "./localAppClient.js";
import { validateWipeArgs, buildWipeBody } from "./wipe.js";
import { buildSafariBookmarksPayload, SAFARI_BOOKMARKS_DECLARATION_TYPE } from "./safariBookmarks.js";
import {
  APPLE_SCHEMA_SOURCE,
  buildCertificateProfilePayload,
  buildContentFilterProfilePayload,
  buildCustomDeclarationPayload,
  buildFileVaultEscrowProfilePayload,
  buildFirewallProfilePayload,
  buildMobileconfig,
  buildPasscodeProfilePayload,
  buildRestrictionsProfilePayload,
  buildScepProfilePayload,
  buildSoftwareUpdateSettingsDeclaration,
  buildVpnProfilePayload,
  buildWebClipProfilePayload,
  buildWifiProfilePayload,
  getAppleSchema,
  listAppleSchemas,
  validateApplePayload,
} from "./appleSchemas.js";
import { API_KEY, HttpError, fetchWithRetry, throwForStatus, simpleMDM, simpleMDMText } from "./simplemdm-client.js";
import { MR_BASE, MR_PREFIX, munkiReportIngest } from "./munkiReportClient.js";
import { afterToolCall, onToolError } from "./findings/middleware.js";
import { WRITE_TIERS, CONFIRM_TIERS, type RiskTier } from "./safety/tiers.js";
import { canonicalArgsHash, issueToken, redeemToken } from "./safety/confirm.js";
import { redactArgs, writeAuditEntry, readAuditEntries, type AuditEntry, type AuditPhase, type AuditOutcome } from "./safety/audit.js";
import { runReport } from "./reports/cli.js";
import { writeReportExtras } from "./reports/engine/extras.js";
import { compareVersions } from "./reports/domain/sofa-eval.js";
import { buildDynamicDossier, validateDynamicSpec, adapterRows, type DynamicReportSpec } from "./reports/specs/dynamic.js";
import { ServerDataSource } from "./reports/data/server-source.js";

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

// Install root (dist/..). Report outputs and reports/-scoped paths resolve
// against this rather than process.cwd() — desktop MCP clients launch servers
// with cwd "/" (or "~"), which would send reports/ writes to the wrong place.
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resolveReportPath = (p: string): string => p.startsWith("/") ? p : resolve(PKG_ROOT, p);

// ─── Config ───────────────────────────────────────────────────────────────────

const ALLOW_WRITES   = process.env.SIMPLEMDM_ALLOW_WRITES === "true";
const USE_LOCAL_APP  = process.env.LOCAL_APP_MODE === "true";

// One-time startup warning: with writes enabled and confirm mode off, high/
// critical-tier writes execute immediately with no confirm-token step (spec
// §1.3). Read once at startup, not per-call — this mirrors ALLOW_WRITES above.
if (ALLOW_WRITES && process.env.SIMPLEMDM_CONFIRM_MODE === "off") {
  console.error("[write-safety] SIMPLEMDM_CONFIRM_MODE=off — confirm tokens disabled; high/critical writes execute immediately.");
}

const MR_HNAME   = process.env.MUNKIREPORT_AUTH_HEADER_NAME ?? "";
const MR_HVALUE  = process.env.MUNKIREPORT_AUTH_HEADER_VALUE ?? "";
const MR_COOKIE  = process.env.MUNKIREPORT_COOKIE ?? "";

const MAX_PAGES          = Number(process.env.SIMPLEMDM_MAX_PAGES ?? 200);
const CACHE_TTL_MS       = Number(process.env.SIMPLEMDM_CACHE_TTL_MS ?? 300_000); // 5 min default

// macOS support matrix keyed by Apple model identifier prefix.
// Source: Apple support docs as of 2026-04. Update on each macOS major release.
// Keys are matched as prefixes against the device's `model` attribute
// (e.g. "MacBookPro18,1", "Mac14,2"). The first matching prefix wins, so the
// list is ordered most-specific → least-specific. Per-tenant patches go via
// MAC_OS_ELIGIBILITY_OVERRIDE without redeploying.
const MACOS_SUPPORT_TABLE: ReadonlyArray<{ prefix: string; max_macos_major: number }> = [
  // Apple Silicon — all support current macOS (Tahoe 26, shipped 09/2025).
  { prefix: "Mac16,",        max_macos_major: 26 }, // M4 (2024-25)
  { prefix: "Mac15,",        max_macos_major: 26 }, // M3 (2023-24)
  { prefix: "Mac14,",        max_macos_major: 26 }, // M2 (2022-23)
  { prefix: "Mac13,",        max_macos_major: 26 }, // M1 Pro/Max/Ultra (2021-22)
  { prefix: "Mac11,",        max_macos_major: 26 }, // M1 (2020)
  // Apple Silicon-era models with legacy naming (M1 generation, late 2020 / 2021).
  { prefix: "Macmini9,",     max_macos_major: 26 }, // M1 Mac mini (2020)
  { prefix: "MacBookAir10,", max_macos_major: 26 }, // M1 MacBook Air (2020)
  { prefix: "MacBookPro17,", max_macos_major: 26 }, // M1 MacBook Pro 13" (2020)
  { prefix: "MacBookPro18,", max_macos_major: 26 }, // M1 Pro/Max MacBook Pro 14"/16" (2021)
  { prefix: "iMac21,",       max_macos_major: 26 }, // M1 iMac 24" (2021)
  // Intel — only four Intel models support Tahoe (26).
  { prefix: "MacPro7,",      max_macos_major: 26 }, // Mac Pro 2019
  { prefix: "iMac20,",       max_macos_major: 26 }, // iMac 27" 2020
  { prefix: "MacBookPro16,3",max_macos_major: 15 }, // MBP 13" 2020 2-port — Sequoia max (Tahoe drops it)
  { prefix: "MacBookPro16,", max_macos_major: 26 }, // MBP 16" 2019 (16,1/4) and MBP 13" 2020 4-port (16,2)
  // Intel — Sequoia (15) is the max (Tahoe drops them).
  { prefix: "iMacPro1,",     max_macos_major: 15 },
  { prefix: "Macmini8,",     max_macos_major: 15 },
  { prefix: "MacBookAir8,",  max_macos_major: 15 }, { prefix: "MacBookAir9,",  max_macos_major: 15 },
  { prefix: "MacBookPro15,", max_macos_major: 15 },
  { prefix: "iMac19,",       max_macos_major: 15 },
  // Ventura (13) cut: roughly 2017 hardware.
  { prefix: "iMac18,",       max_macos_major: 13 },
  { prefix: "MacBookPro13,", max_macos_major: 13 }, { prefix: "MacBookPro14,", max_macos_major: 13 },
  // Monterey (12) — Late 2015 hardware (iMac 21.5"/27" Retina) and 2014 portables.
  { prefix: "iMac17,",       max_macos_major: 12 }, // iMac 27" Retina 5K Late 2015 (was 11 prior to v0.7.1; Apple supports through Monterey)
  { prefix: "iMac16,",       max_macos_major: 12 }, // iMac 21.5" Late 2015 (incl. 4K)
  { prefix: "MacBookAir7,",  max_macos_major: 12 }, { prefix: "Macmini7,",     max_macos_major: 12 }, { prefix: "MacPro6,", max_macos_major: 12 },
  // Big Sur (11) — Mid 2014 / Late 2014 hardware.
  { prefix: "iMac15,",       max_macos_major: 11 }, // iMac 27" Retina 5K Late 2014/Mid 2015
  { prefix: "iMac14,4",      max_macos_major: 11 }, // iMac 21.5" Mid 2014
  { prefix: "MacBookPro11,", max_macos_major: 11 }, { prefix: "MacBookPro12,", max_macos_major: 11 },
  // Catalina (10) — Late 2013 hardware (no Big Sur due to graphics driver cut).
  { prefix: "iMac14,1",      max_macos_major: 10 }, // iMac 21.5" Late 2013
  { prefix: "iMac14,2",      max_macos_major: 10 }, // iMac 27" Late 2013
  { prefix: "iMac14,3",      max_macos_major: 10 }, // iMac 21.5" Late 2013 NVIDIA
];

// Currently shipping major version per Apple platform. Update on each Apple
// release alongside MACOS_SUPPORT_TABLE. Used as the baseline for OS-lag
// checks so the result doesn't depend on whatever happens to be running in
// the fleet (one beta device on a future macOS would otherwise make every
// other device look "decades behind").
//
// Override via env: CURRENT_SUPPORTED_OS_OVERRIDE='{"mac":26,"ios":26,"ipad":26}'
const CURRENT_SUPPORTED_OS: Readonly<Record<"mac" | "ios" | "ipad", number>> = (() => {
  const defaults = { mac: 26, ios: 26, ipad: 26 };
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

// ─── Write-safety gate config (PRD v2 Phase 1) ─────────────────────────────
// Read at call time (not import time) so tests and operators can toggle
// confirm mode without a restart. auditDir() is also used by Task 5.
const confirmModeOn = (): boolean => (process.env.SIMPLEMDM_CONFIRM_MODE ?? "on") !== "off";
const DEFAULT_CONFIRM_TTL_SECONDS = 120;
const confirmTtlMs = (): number => {
  const raw = process.env.SIMPLEMDM_CONFIRM_TTL_SECONDS;
  if (raw === undefined) return DEFAULT_CONFIRM_TTL_SECONDS * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(
      `[write-safety] Invalid SIMPLEMDM_CONFIRM_TTL_SECONDS=${JSON.stringify(raw)}; ` +
      `falling back to ${DEFAULT_CONFIRM_TTL_SECONDS}s (fail closed).`
    );
    return DEFAULT_CONFIRM_TTL_SECONDS * 1000;
  }
  return n * 1000;
};
const auditDir = (): string => resolveReportPath(process.env.MCP_WRITE_AUDIT_DIR ?? "audit_log");

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

// SimpleMDM reports battery_level as a "NN%" string; tolerate bare numbers too.
// A "%"-suffixed value is always a percentage — "1%" is one percent, not a 0-1
// fraction. Only a bare number strictly below 1 is treated as a fraction.
export function normalizeBatteryPct(raw: number | string | null | undefined): number | undefined {
  if (raw == null) return undefined;
  const isPercentString = typeof raw === "string" && raw.trim().endsWith("%");
  const num = typeof raw === "string" ? parseFloat(raw.replace("%", "")) : Number(raw);
  if (!Number.isFinite(num)) return undefined;
  const pct = !isPercentString && num < 1 ? num * 100 : num;
  return pct < 0 || pct > 100 ? undefined : pct;
}

// Paginate SimpleMDM /devices bypassing the local-app shortcut (used by derived
// fleet rollups). Hard-capped by MAX_PAGES to bound memory/time.
async function* paginateDevices(): AsyncGenerator<DeviceRecord> {
  let cursor: string | number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
    const p = await simpleMDM(`/devices?limit=100${q}`) as PaginatedResponse<DeviceRecord>;
    const devPage = Array.isArray(p?.data) ? p.data : [];
    for (const d of devPage) yield d;
    if (!p.has_more) return;
    cursor = devPage.at(-1)?.id;
    if (cursor == null) return;
  }
  throw new Error(`paginateDevices: exceeded ${MAX_PAGES}-page cap; set SIMPLEMDM_MAX_PAGES to raise.`);
}

async function collectDevices(): Promise<DeviceRecord[]> {
  const cacheKey = "__collectDevices__";
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() <= hit.expiry) return hit.data as DeviceRecord[];
  const genAtStart = cacheGeneration; // see collectAllPages: don't re-cache over an invalidation
  const out: DeviceRecord[] = [];
  for await (const d of paginateDevices()) out.push(d);
  if (cacheGeneration === genAtStart) listCache.set(cacheKey, { data: out, expiry: Date.now() + CACHE_TTL_MS });
  return out;
}

// Paginate one device's installed_apps list (some Macs have hundreds).
// Throws on MAX_PAGES exhaustion to match paginateDevices() behavior — silent
// truncation in an aggregation tool produces wrong rollups, not partial ones.
async function collectInstalledApps(deviceId: string | number): Promise<InstalledAppRecord[]> {
  const cacheKey = `__installedApps__${deviceId}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() <= hit.expiry) return hit.data as InstalledAppRecord[];
  const genAtStart = cacheGeneration; // see collectAllPages: don't re-cache over an invalidation
  const cacheIfCurrent = (data: InstalledAppRecord[]) => {
    if (cacheGeneration === genAtStart) listCache.set(cacheKey, { data, expiry: Date.now() + CACHE_TTL_MS });
  };
  const id = encodeURIComponent(String(deviceId));
  const out: InstalledAppRecord[] = [];
  let cursor: string | number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
    const p = await simpleMDM(`/devices/${id}/installed_apps?limit=100${q}`) as PaginatedResponse<InstalledAppRecord>;
    const appPage = Array.isArray(p?.data) ? p.data : [];
    for (const a of appPage) out.push(a);
    if (!p.has_more) { cacheIfCurrent(out); return out; }
    cursor = appPage.at(-1)?.id;
    if (cursor == null) { cacheIfCurrent(out); return out; }
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

// Bumped on every invalidation; paginations snapshot it before fetching and only
// cacheSet if unchanged, so an in-flight read can't re-cache pre-write data over
// a write's invalidation.
let cacheGeneration = 0;

// Invalidate all cache entries whose key starts with any of the given prefixes.
// The special prefix "/devices" also clears collectDevices() and per-device
// installed-app caches, since device mutations can affect fleet rollups.
// (Exported for tests.)
export function cacheInvalidate(...prefixes: string[]): void {
  cacheGeneration++;
  // Detach matching in-flight paginations so a read starting after this write
  // fetches fresh instead of joining a pre-write promise. (The detached
  // pagination still resolves for its own callers; the generation counter
  // already prevents it from re-caching.)
  for (const key of inflight.keys()) {
    if (prefixes.some(p => key.startsWith(p))) inflight.delete(key);
  }
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
export const INVALIDATION_MAP: Record<string, string[]> = {
  create_device:                       ["/devices"],
  update_device:                       ["/devices"],
  delete_device:                       ["/devices"],
  delete_device_user:                  ["/devices"],
  lock_device:                         ["/devices"],
  wipe_device:                         ["/devices"],
  sync_device:                         ["/devices"],
  refresh_device_inventory:            ["/devices"],
  disable_activation_lock:             ["/devices"],
  push_message:                        ["/devices"],
  restart_device:                      ["/devices"],
  shutdown_device:                     ["/devices"],
  refresh_cellular_plans:              ["/devices"],
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
  // Group-level app/profile changes also mutate per-device state, which is cached
  // under /devices/{id}/... keys — so these must invalidate "/devices" as well.
  assign_app_to_group:                 ["/assignment_groups", "/apps", "/devices"],
  unassign_app_from_group:             ["/assignment_groups", "/apps", "/devices"],
  assign_profile_to_group:             ["/assignment_groups", "/profiles", "/devices"],
  unassign_profile_from_group:         ["/assignment_groups", "/profiles", "/devices"],
  push_apps_to_group:                  ["/assignment_groups", "/devices"],
  update_apps_in_group:                ["/assignment_groups", "/apps", "/devices"],
  sync_profiles_in_group:              ["/assignment_groups", "/profiles", "/devices"],
  clone_assignment_group:              ["/assignment_groups"],
  create_app:                          ["/apps"],
  update_app:                          ["/apps"],
  delete_app:                          ["/apps"],
  // "/devices" covers the per-device /devices/{id}/installed_apps caches, which
  // "/installed_apps" (the __installedApps__ rollup alias) does not reach.
  request_app_management:              ["/installed_apps", "/apps", "/devices"],
  update_installed_app:                ["/installed_apps", "/apps", "/devices"],
  uninstall_app:                       ["/installed_apps", "/apps", "/devices"],
  create_custom_attribute:             ["/custom_attributes"],
  update_custom_attribute:             ["/custom_attributes"],
  delete_custom_attribute:             ["/custom_attributes"],
  set_device_attribute_value:          ["/custom_attributes"],
  set_attribute_for_multiple_devices:  ["/custom_attributes"],
  set_group_attribute_value:           ["/custom_attributes"],
  create_custom_configuration_profile: ["/custom_configuration_profiles"],
  update_custom_configuration_profile: ["/custom_configuration_profiles"],
  delete_custom_configuration_profile: ["/custom_configuration_profiles"],
  assign_custom_profile_to_device:     ["/custom_configuration_profiles", "/devices"],
  unassign_custom_profile_from_device: ["/custom_configuration_profiles", "/devices"],
  create_custom_declaration:           ["/custom_declarations"],
  create_safari_bookmarks_declaration: ["/custom_declarations"],
  update_custom_declaration:           ["/custom_declarations"],
  delete_custom_declaration:           ["/custom_declarations"],
  assign_declaration_to_device:        ["/custom_declarations", "/devices"],
  unassign_declaration_from_device:    ["/custom_declarations", "/devices"],
  assign_profile_to_device:            ["/profiles", "/devices"],
  unassign_profile_from_device:        ["/profiles", "/devices"],
  sync_dep_server:                     ["/dep_servers"],
  send_enrollment_invitation:          ["/enrollments"],
  delete_enrollment:                   ["/enrollments"],
  create_managed_app_config:           ["/apps"],
  delete_managed_app_config:           ["/apps"],
  push_managed_app_configs:            ["/apps"],
  set_managed_app_config_schema:       ["/apps"],
  create_script:                       ["/scripts"],
  update_script:                       ["/scripts"],
  delete_script:                       ["/scripts"],
  create_script_job:                   ["/script_jobs"],
  cancel_script_job:                   ["/script_jobs"],
  update_account:                      [],
  request_munkireport_sync:            [],
  refresh_munkireport_supplemental:    [],
  push_munkireport_findings:           [],
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
    // Only cache if no invalidation landed while we paginated — otherwise this
    // result may predate a write and would resurrect stale data for a full TTL.
    const genAtStart = cacheGeneration;
    const cacheIfCurrent = (data: T[]) => { if (cacheGeneration === genAtStart) cacheSet(path, data); };
    const sep = path.includes("?") ? "&" : "?";
    const out: T[] = [];
    let cursor: string | number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
      const p = await api(`${path}${sep}limit=100${q}`) as PaginatedResponse<T>;
      const page = Array.isArray(p?.data) ? p.data : [];
      for (const r of page) out.push(r);
      if (!p.has_more) { cacheIfCurrent(out); return { data: out, has_more: false }; }
      cursor = page.at(-1)?.id;
      if (cursor == null) { cacheIfCurrent(out); return { data: out, has_more: false }; }
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

export const TOOLS: Tool[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNT
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_account",
    description: "Retrieve account info: name, App Store country, and subscription license counts.",
    inputSchema: { type: "object", properties: {} } },

  { name: "update_account",
    description: "WRITE — Update account settings (name, apple_store_country_code).",
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
    description: "Derived — single call returning enrolled devices that fail one or more compliance checks. Defaults: passcode_compliant, filevault_enabled (Macs), supervised, user_approved_mdm, OS within 2 majors of currently-supported. Reads device records only — fast. The OS-lag baseline is the platform's currently-shipping major (macOS 26 / iOS 26 / iPadOS 26 as of 2025-09), NOT the fleet maximum, so a single beta device cannot skew the result. Override via CURRENT_SUPPORTED_OS_OVERRIDE env var.",
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
    description: "Derived — devices with MDM commands sent but not acknowledged for over N hours. Reads the global /logs feed (no per-device fan-out) and pairs `*sent` events against `*acknowledged`/`*succeeded`/`*failed` events by command_uuid when present, else by device + command family (event name minus its verb). Caveat of the family fallback: repeated same-family commands collapse to one slot, so a newer acknowledgment can mask an older stuck command of the same type. Returns empty if /logs does not surface command events for your tenant.",
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
    description: "Derived — for each Mac, list current macOS major and the maximum macOS major Apple supports for that model identifier, using a built-in static table (last updated 2026-04; macOS 26 Tahoe compatibility). Returns max_supported_major=null for unknown models. Optional MAC_OS_ELIGIBILITY_OVERRIDE env var (JSON) merges into the table.",
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
    description: "Derived — battery rollup for laptops/iOS: current level, low-battery flag. Cycle count and max-capacity % are read from SimpleMDM device attributes, which most tenants do not populate (they require MDM profile settings that enable battery health reporting — NOT MunkiReport; MunkiReport battery data lives in get_munkireport_device_resources). Falls back gracefully to level-only.",
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

  { name: "get_dep_token_audit",
    description: "Derived — DEP (Automated Device Enrollment) server token expiration. For each DEP server lists days remaining and a renewal warning band (90/30), a worst_warning roll-up across all servers, and a sync_stale flag for servers not synced with Apple in over 7 days.",
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
    description: "WRITE — Create a device placeholder record.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string" },
      group_id: { type: "string", description: "Optional device group ID to assign to." },
    }}},

  { name: "update_device",
    description: "WRITE — Update a device record (name, device_name).",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      name: { type: "string", description: "SimpleMDM display name." },
      device_name: { type: "string", description: "Name pushed to the device itself." },
    }}},

  { name: "delete_device",
    description: "WRITE — Delete a device record from SimpleMDM. Does not wipe the device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "delete_device_user",
    description: "WRITE — Delete a user account from a device.",
    inputSchema: { type: "object", required: ["device_id", "user_id"], properties: {
      device_id: { type: "string" },
      user_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // DEVICES — actions
  // ══════════════════════════════════════════════════════════════════════════
  { name: "lock_device",
    description: "WRITE — Remote lock. Optional message and 6-digit PIN on macOS.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      message: { type: "string" },
      pin: { type: "string", description: "6-digit PIN (macOS)." },
    }}},

  { name: "wipe_device",
    description: "WRITE DESTRUCTIVE — Remote wipe. Erases all data on the device. Irreversible. " +
                 "Supports iOS 17+ Return-to-Service and eSIM/data-plan preservation.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      pin: { type: "string", description: "Optional 6-digit PIN to set after wipe (macOS)." },
      preserve_data_plan: { type: "boolean", description: "iOS. Preserve eSIM/cellular data plan during wipe." },
      disable_activation_lock: { type: "boolean", description: "iOS/macOS. Server default: true. Pass false to retain Activation Lock." },
      disallow_proximity_setup: { type: "boolean", description: "iOS. Suppress Proximity Setup on the wiped device." },
      return_to_service: { type: "boolean", description: "iOS 17+/tvOS 18+. Auto re-enrolls after wipe. Requires wifi_network_id." },
      wifi_network_id: { type: "integer", minimum: 1, description: "Integer id of a WiFi configuration profile assigned to the device. Required when return_to_service=true. Not an SSID, UUID, or profile name." },
      obliteration_behavior: { type: "string", enum: ["DoNotObliterate", "ObliterateWithWarning"],
        description: "macOS 12+ (T2/Apple Silicon). Server default: ObliterateWithWarning." },
      clear_custom_attributes: { type: "boolean", description: "Clear custom attribute values on the device record. Defaults to false." },
      unassign_direct_profiles: { type: "boolean", description: "Remove directly assigned profiles from the device record. Defaults to false." },
      preserve_managed_apps: { type: "boolean", description: "iOS 17+. Keep managed apps and their data installed through the wipe (Return-to-Service style). Defaults to false." },
    }}},

  { name: "sync_device",
    description: "WRITE — Re-push all assigned apps to the device (POST /push_apps). NOTE: this does not request a device check-in or inventory refresh — use refresh_device_inventory for that.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "refresh_device_inventory",
    description: "WRITE — Request a refresh of the device's information and app inventory (POST /devices/{id}/refresh). Use after remediation so analytics tools see fresh data instead of waiting for the next natural check-in. SimpleMDM throttles this per device (429 when requested too often). Requires the API key to have the device-refresh write scope (403 otherwise).",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "disable_activation_lock",
    description: "WRITE DESTRUCTIVE — Disable Activation Lock on a device WITHOUT wiping it (POST /devices/{id}/disable_activation_lock). Removes the theft-deterrent lock tied to the enrolling Apple ID; use for legitimate device turnover (departing owner, resale, re-provisioning). Check get_activation_lock_status first. Requires the API key write scope (403 otherwise).",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "push_message",
    description: "WRITE — Send a message to a device via the SimpleMDM mobile app (POST /devices/{id}/push_message). Max 225 characters. Only delivers on devices with the SimpleMDM app installed; returns an error otherwise. Requires the API key write scope (403 otherwise).",
    inputSchema: { type: "object", required: ["device_id", "message"], properties: {
      device_id: { type: "string" },
      message: { type: "string", description: "Message text, max 225 characters." },
    }}},

  { name: "restart_device",
    description: "WRITE — Remote restart. Device must be supervised.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "shutdown_device",
    description: "WRITE — Remote shutdown. Device must be supervised.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "refresh_cellular_plans",
    description: "WRITE — Refresh the device's cellular/eSIM plans from the carrier's eSIM server. iOS/iPadOS with cellular.",
    inputSchema: { type: "object", required: ["device_id", "esim_server_url"], properties: {
      device_id: { type: "string" },
      esim_server_url: { type: "string", description: "URL of the carrier's eSIM server, provided by the carrier. Required by the SimpleMDM API." },
    }}},

  { name: "unenroll_device",
    description: "WRITE — Unenroll a device from MDM management.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_passcode",
    description: "WRITE — Clear the device passcode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_restrictions_password",
    description: "WRITE — Clear the restrictions password on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "update_os",
    description: "WRITE — Trigger a managed OS update.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_lost_mode",
    description: "WRITE — Enable Lost Mode on a supervised iOS device.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      message: { type: "string" },
      phone_number: { type: "string" },
      footnote: { type: "string" },
    }}},

  { name: "disable_lost_mode",
    description: "WRITE — Disable Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "play_lost_mode_sound",
    description: "WRITE — Play a sound on a device in Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "update_lost_mode_location",
    description: "WRITE — Request a location update on a device in Lost Mode.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_firmware_password",
    description: "WRITE — Clear the firmware password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_firmware_password",
    description: "WRITE — Rotate the firmware password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "clear_recovery_lock_password",
    description: "WRITE — Clear the recovery lock password on an Apple Silicon Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_recovery_lock_password",
    description: "WRITE — Rotate the recovery lock password on an Apple Silicon Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "rotate_filevault_recovery_key",
    description: "WRITE — Rotate the FileVault recovery key on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_admin_password",
    description: "WRITE — Set the local admin password on a Mac.",
    inputSchema: { type: "object", required: ["device_id", "new_password"], properties: {
      device_id: { type: "string" },
      new_password: { type: "string" },
    }}},

  { name: "rotate_admin_password",
    description: "WRITE — Rotate the local admin password on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_remote_desktop",
    description: "WRITE — Enable Remote Desktop (ARD) on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "disable_remote_desktop",
    description: "WRITE — Disable Remote Desktop (ARD) on a Mac.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "enable_bluetooth",
    description: "WRITE — Enable Bluetooth on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "disable_bluetooth",
    description: "WRITE — Disable Bluetooth on a device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_time_zone",
    description: "WRITE — Set the time zone on a device.",
    inputSchema: { type: "object", required: ["device_id", "time_zone"], properties: {
      device_id: { type: "string" },
      time_zone: { type: "string", description: "IANA time zone name e.g. America/New_York." },
    }}},

  { name: "get_activation_lock_status",
    description: "Read — Whether Activation Lock is currently enabled on a device. Reads is_activation_lock_enabled from the device record.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

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
    description: "WRITE — Create a new static assignment group.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string" },
      auto_deploy: { type: "boolean", description: "Auto-push apps when devices join. Default true." },
    }}},

  { name: "update_assignment_group",
    description: "WRITE — Update an assignment group name or auto_deploy setting.",
    inputSchema: { type: "object", required: ["group_id"], properties: {
      group_id: { type: "string" },
      name: { type: "string" },
      auto_deploy: { type: "boolean" },
    }}},

  { name: "delete_assignment_group",
    description: "WRITE — Delete an assignment group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "assign_device_to_group",
    description: "WRITE — Add a device to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "device_id"], properties: {
      group_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_device_from_group",
    description: "WRITE — Remove a device from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "device_id"], properties: {
      group_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "assign_app_to_group",
    description: "WRITE — Assign an app to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "app_id"], properties: {
      group_id: { type: "string" },
      app_id: { type: "string" },
      deployment_type: { type: "string", description: "standard or munki. Default standard." },
      install_type: { type: "string", description: "managed, self_serve, default_installs, managed_updates." },
    }}},

  { name: "unassign_app_from_group",
    description: "WRITE — Remove an app from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "app_id"], properties: {
      group_id: { type: "string" }, app_id: { type: "string" },
    }}},

  { name: "assign_profile_to_group",
    description: "WRITE — Assign a profile to an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "profile_id"], properties: {
      group_id: { type: "string" }, profile_id: { type: "string" },
    }}},

  { name: "unassign_profile_from_group",
    description: "WRITE — Remove a profile from an assignment group.",
    inputSchema: { type: "object", required: ["group_id", "profile_id"], properties: {
      group_id: { type: "string" }, profile_id: { type: "string" },
    }}},

  { name: "push_apps_to_group",
    description: "WRITE — Push all assigned apps to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "update_apps_in_group",
    description: "WRITE — Push app updates to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "sync_profiles_in_group",
    description: "WRITE — Sync all profiles to all devices in a group.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "clone_assignment_group",
    description: "WRITE — Clone an assignment group (static and dynamic only).",
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
    description: "WRITE — Add an App Store app by ID or bundle ID to the catalog.",
    inputSchema: { type: "object", properties: {
      app_store_id: { type: "string", description: "Apple App Store numeric ID e.g. 1090161858." },
      bundle_id: { type: "string", description: "Bundle identifier e.g. com.myCompany.MyApp." },
      name: { type: "string", description: "Optional display name override." },
    }}},

  { name: "update_app",
    description: "WRITE — Update an app catalog entry name.",
    inputSchema: { type: "object", required: ["app_id"], properties: {
      app_id: { type: "string" },
      name: { type: "string" },
      deploy_to: { type: "string", description: "none, outdated, or all. Push after update." },
    }}},

  { name: "delete_app",
    description: "WRITE — Remove an app from the catalog. Does not uninstall from devices.",
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
    description: "WRITE — Request MDM management of an unmanaged installed app.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  { name: "update_installed_app",
    description: "WRITE — Push an update to a specific installed app instance.",
    inputSchema: { type: "object", required: ["installed_app_id"], properties: { installed_app_id: { type: "string" } }}},

  { name: "uninstall_app",
    description: "WRITE — Uninstall a managed app from a device.",
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
    description: "WRITE — Create a new custom attribute.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string", description: "Attribute key name." },
      default_value: { type: "string" },
    }}},

  { name: "update_custom_attribute",
    description: "WRITE — Update a custom attribute's default value.",
    inputSchema: { type: "object", required: ["attribute_name"], properties: {
      attribute_name: { type: "string" },
      default_value: { type: "string" },
    }}},

  { name: "delete_custom_attribute",
    description: "WRITE — Delete a custom attribute.",
    inputSchema: { type: "object", required: ["attribute_name"], properties: { attribute_name: { type: "string" } }}},

  { name: "get_device_attribute_values",
    description: "Get all custom attribute values for a specific device.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "set_device_attribute_value",
    description: "WRITE — Set a custom attribute value for a specific device.",
    inputSchema: { type: "object", required: ["attribute_name", "device_id", "value"], properties: {
      attribute_name: { type: "string" },
      device_id: { type: "string" },
      value: { type: "string" },
    }}},

  { name: "set_attribute_for_multiple_devices",
    description: "WRITE — Set a custom attribute value on multiple devices at once.",
    inputSchema: { type: "object", required: ["attribute_name", "device_ids", "value"], properties: {
      attribute_name: { type: "string" },
      device_ids: { type: "array", items: { type: "string" } },
      value: { type: "string" },
    }}},

  { name: "get_group_attribute_values",
    description: "Get custom attribute values set at the assignment group level.",
    inputSchema: { type: "object", required: ["group_id"], properties: { group_id: { type: "string" } }}},

  { name: "set_group_attribute_value",
    description: "WRITE — Set a custom attribute value at the assignment group level.",
    inputSchema: { type: "object", required: ["attribute_name", "group_id", "value"], properties: {
      attribute_name: { type: "string" },
      group_id: { type: "string" },
      value: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // APPLE DEVICE-MANAGEMENT SCHEMAS (local curated seed)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "search_apple_device_management_schemas",
    description: "Read — Search the local curated Apple device-management schema seed for profile payloads and DDM declarations. Use before building custom profiles/declarations so keys are schema-backed instead of guessed.",
    inputSchema: { type: "object", properties: {
      kind: { type: "string", enum: ["profile", "declaration"], description: "Restrict to profile payload schemas or DDM declaration schemas." },
      query: { type: "string", description: "Search display name, identifier, and description." },
      platform: { type: "string", description: "Restrict to a platform such as macOS, iOS, iPadOS, tvOS, or visionOS." },
      limit: { type: "number", description: "Maximum results. Default 25, max 100." },
    }}},

  { name: "get_apple_device_management_schema",
    description: "Read — Get one Apple profile payload or DDM declaration schema from the local curated seed, including required keys, enum values, platform support, and source path.",
    inputSchema: { type: "object", required: ["identifier"], properties: {
      identifier: { type: "string", description: "Apple payload/declaration identifier, e.g. com.apple.wifi.managed." },
      kind: { type: "string", enum: ["profile", "declaration"], description: "Optional disambiguation." },
    }}},

  { name: "validate_apple_payload",
    description: "Read — Validate a profile payload or DDM declaration payload object against the local curated Apple schema seed. Returns errors and warnings; does not call SimpleMDM.",
    inputSchema: { type: "object", required: ["identifier", "payload"], properties: {
      identifier: { type: "string", description: "Apple payload/declaration identifier." },
      kind: { type: "string", enum: ["profile", "declaration"], description: "Schema kind. Default searches both, but explicit is safer." },
      payload: { description: "Payload object, or a JSON object string." },
    }}},

  { name: "build_mobileconfig",
    description: "Read — Build a .mobileconfig XML string from one or more Apple profile payload objects after schema-seed validation. Preview this output, then pass it to create_custom_configuration_profile if acceptable.",
    inputSchema: { type: "object", required: ["display_name", "identifier", "payloads"], properties: {
      display_name: { type: "string", description: "Top-level profile display name." },
      identifier: { type: "string", description: "Top-level reverse-DNS profile identifier." },
      organization: { type: "string" },
      description: { type: "string" },
      scope: { type: "string", enum: ["System", "User"], description: "Profile scope. Default System." },
      payloads: { type: "array", minItems: 1, description: "Array of payload objects. Each requires PayloadType." },
    }}},

  { name: "build_custom_declaration_payload",
    description: "Read — Build DDM declaration JSON after validating the Payload against the local curated Apple declaration schema seed. Returns declaration_type and simplemdm_payload for create_custom_declaration.",
    inputSchema: { type: "object", required: ["declaration_type", "identifier", "payload"], properties: {
      declaration_type: { type: "string", description: "Apple DDM declaration type, e.g. com.apple.configuration.safari.bookmarks." },
      identifier: { type: "string", description: "Declaration Identifier value." },
      server_token: { type: "string", description: "Optional ServerToken." },
      payload: { description: "Declaration Payload object, or a JSON object string." },
    }}},

  { name: "build_wifi_profile_payload",
    description: "Read — Build and validate a com.apple.wifi.managed payload object. Pass the returned payload to build_mobileconfig, then create_custom_configuration_profile.",
    inputSchema: { type: "object", required: ["ssid"], properties: {
      ssid: { type: "string", description: "Wi-Fi SSID." },
      encryption_type: { type: "string", enum: ["WEP", "WPA", "WPA2", "WPA3", "Any", "None"], description: "Default WPA2." },
      password: { type: "string", description: "Pre-shared key for personal networks." },
      auto_join: { type: "boolean", description: "Default true." },
      hidden_network: { type: "boolean" },
      eap_client_configuration: { type: "object", description: "Enterprise EAP settings." },
      proxy_type: { type: "string", enum: ["None", "Manual", "Auto"] },
    }}},

  { name: "build_firewall_profile_payload",
    description: "Read — Build and validate a com.apple.security.firewall payload object for macOS.",
    inputSchema: { type: "object", properties: {
      enable_firewall: { type: "boolean", description: "Default true." },
      block_all_incoming: { type: "boolean" },
      enable_stealth_mode: { type: "boolean", description: "Default true." },
      applications: { type: "array", description: "Optional app rules with BundleID and Allowed." },
    }}},

  { name: "build_passcode_profile_payload",
    description: "Read — Build and validate a com.apple.mobiledevice.passwordpolicy payload object.",
    inputSchema: { type: "object", properties: {
      force_pin: { type: "boolean", description: "Require a passcode. Default true." },
      min_length: { type: "number" },
      min_complex_chars: { type: "number" },
      max_failed_attempts: { type: "number" },
      max_inactivity: { type: "number" },
      allow_simple: { type: "boolean" },
    }}},

  { name: "build_software_update_settings_declaration",
    description: "Read — Build and validate a com.apple.configuration.softwareupdate.settings DDM declaration. Use declaration_type + simplemdm_payload with create_custom_declaration.",
    inputSchema: { type: "object", required: ["identifier"], properties: {
      identifier: { type: "string", description: "Declaration Identifier value." },
      server_token: { type: "string" },
      automatic_actions: { type: "object", description: "AutomaticActions dictionary." },
      deferrals: { type: "object", description: "Deferrals dictionary." },
      rapid_security_response: { type: "object", description: "RapidSecurityResponse dictionary." },
      beta: { type: "object", description: "Beta dictionary." },
    }}},

  { name: "build_restrictions_profile_payload",
    description: "Read — Build and validate a com.apple.applicationaccess restrictions payload.",
    inputSchema: { type: "object", properties: {
      allow_app_installation: { type: "boolean" },
      allow_camera: { type: "boolean" },
      allow_cloud_backup: { type: "boolean" },
      allow_diagnostic_submission: { type: "boolean" },
      allow_safari: { type: "boolean" },
    }}},

  { name: "build_scep_profile_payload",
    description: "Read — Build and validate a com.apple.security.scep certificate enrollment payload.",
    inputSchema: { type: "object", required: ["url", "name"], properties: {
      url: { type: "string", description: "SCEP server URL. HTTPS is recommended." },
      name: { type: "string", description: "SCEP instance name." },
      challenge: { type: "string" },
      key_type: { type: "string", enum: ["RSA", "ECSECPrimeRandom"], description: "Default RSA." },
      key_size: { type: "number" },
      key_usage: { type: "number" },
      retries: { type: "number" },
      retry_delay: { type: "number" },
      subject: { type: "array" },
    }}},

  { name: "build_certificate_profile_payload",
    description: "Read — Build and validate a root certificate payload using base64/DER PayloadContent.",
    inputSchema: { type: "object", required: ["payload_content"], properties: {
      payload_content: { type: "string", description: "Certificate payload content." },
      certificate_file_name: { type: "string" },
    }}},

  { name: "build_vpn_profile_payload",
    description: "Read — Build and validate a com.apple.vpn.managed payload. Provider-specific VPN/IKEv2/IPSec dictionaries are passed through for schema validation.",
    inputSchema: { type: "object", required: ["user_defined_name", "vpn_type"], properties: {
      user_defined_name: { type: "string" },
      vpn_type: { type: "string", enum: ["VPN", "IPSec", "IKEv2", "AlwaysOn"] },
      vpn_sub_type: { type: "string" },
      vpn: { type: "object" },
      ikev2: { type: "object" },
      ipsec: { type: "object" },
      on_demand_enabled: { type: "boolean" },
      on_demand_rules: { type: "array" },
    }}},

  { name: "build_webclip_profile_payload",
    description: "Read — Build and validate a com.apple.webClip.managed payload.",
    inputSchema: { type: "object", required: ["label", "url"], properties: {
      label: { type: "string" },
      url: { type: "string" },
      is_removable: { type: "boolean" },
      full_screen: { type: "boolean" },
      icon: { type: "string", description: "Base64 icon data if used." },
    }}},

  { name: "build_content_filter_profile_payload",
    description: "Read — Build and validate a com.apple.webcontent-filter payload.",
    inputSchema: { type: "object", properties: {
      filter_type: { type: "string", enum: ["BuiltIn", "Plugin"], description: "Default BuiltIn." },
      auto_filter_enabled: { type: "boolean" },
      permitted_urls: { type: "array" },
      blacklisted_urls: { type: "array" },
      whitelisted_bookmarks: { type: "array" },
      plugin_bundle_id: { type: "string" },
      server_address: { type: "string" },
    }}},

  { name: "build_filevault_escrow_profile_payload",
    description: "Read — Build and validate a com.apple.security.FDERecoveryKeyEscrow payload.",
    inputSchema: { type: "object", required: ["encrypt_cert_payload_uuid"], properties: {
      encrypt_cert_payload_uuid: { type: "string", description: "UUID of the certificate payload used to encrypt recovery keys." },
      location: { type: "string" },
      device_key: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOM CONFIGURATION PROFILES
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_custom_configuration_profiles",
    description: "List all custom configuration profiles.",
    inputSchema: { type: "object", properties: {} } },

  { name: "download_custom_configuration_profile",
    description: "Download the actual mobileconfig XML content of a custom configuration profile. The list/get endpoints return metadata only — this is the only way to read (or back up) what a custom profile contains.",
    inputSchema: { type: "object", required: ["profile_id"], properties: { profile_id: { type: "string" } }}},

  { name: "create_custom_configuration_profile",
    description: "WRITE — Create a new custom configuration profile by providing mobileconfig XML.",
    inputSchema: { type: "object", required: ["name", "mobileconfig"], properties: {
      name: { type: "string" },
      mobileconfig: { type: "string", description: "The mobileconfig XML content as a string." },
      user_scope: { type: "boolean", description: "Apply at user scope. Default false." },
      attribute_support: { type: "boolean", description: "Enable attribute variable substitution." },
    }}},

  { name: "update_custom_configuration_profile",
    description: "WRITE — Update a custom configuration profile.",
    inputSchema: { type: "object", required: ["profile_id"], properties: {
      profile_id: { type: "string" },
      name: { type: "string" },
      mobileconfig: { type: "string" },
      user_scope: { type: "boolean" },
      attribute_support: { type: "boolean" },
    }}},

  { name: "delete_custom_configuration_profile",
    description: "WRITE — Delete a custom configuration profile.",
    inputSchema: { type: "object", required: ["profile_id"], properties: { profile_id: { type: "string" } }}},

  { name: "assign_custom_profile_to_device",
    description: "WRITE — Assign a custom configuration profile directly to a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_custom_profile_from_device",
    description: "WRITE — Remove a custom configuration profile from a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOM DECLARATIONS
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_custom_declarations",
    description: "List all custom DDM declarations.",
    inputSchema: { type: "object", properties: {} } },

  { name: "download_custom_declaration",
    description: "Download the raw content of a custom DDM declaration (the list endpoint returns metadata only).",
    inputSchema: { type: "object", required: ["declaration_id"], properties: { declaration_id: { type: "string" } }}},

  { name: "get_custom_declaration",
    description: "Detail for a single declaration including type, identifier, scope, and activation predicate.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: { declaration_id: { type: "string" } }}},

  { name: "create_custom_declaration",
    description: "WRITE — Create a new custom declaration.",
    inputSchema: { type: "object", required: ["name", "payload"], properties: {
      name: { type: "string" },
      declaration_type: { type: "string", description: "Apple DDM declaration type, e.g. com.apple.configuration.safari.bookmarks." },
      payload: { type: "string", description: "The declaration JSON payload as a string." },
      reinstall_after_os_update: { type: "boolean" },
      user_scope: { type: "boolean" },
    }}},

  { name: "update_custom_declaration",
    description: "WRITE — Update a custom declaration.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: {
      declaration_id: { type: "string" },
      name: { type: "string" },
      declaration_type: { type: "string" },
      payload: { type: "string" },
      reinstall_after_os_update: { type: "boolean" },
    }}},

  { name: "delete_custom_declaration",
    description: "WRITE — Delete a custom declaration.",
    inputSchema: { type: "object", required: ["declaration_id"], properties: { declaration_id: { type: "string" } }}},

  { name: "create_safari_bookmarks_declaration",
    description: "WRITE — Push managed Safari bookmarks. Creates a DDM custom declaration of type " +
                "com.apple.configuration.safari.bookmarks. Requires iOS 26+, macOS 26+, or visionOS 26+ " +
                "(supervised/device enrollment). Assign the resulting declaration to devices/groups to deploy.",
    inputSchema: { type: "object", required: ["name", "group_title", "bookmarks"], properties: {
      name: { type: "string", description: "Name for the declaration in SimpleMDM." },
      group_title: { type: "string", description: "Folder name Safari shows for this managed bookmarks group." },
      group_identifier: { type: "string", description: "Optional stable id; Safari merges groups that share one. Defaults to a slug of group_title." },
      bookmarks: { type: "array", minItems: 1, description:
        "Bookmark tree. Each item is { title, url } for a link OR { title, folder: [ ...items ] } for a nested folder (recursive). Each item needs exactly one of url or folder." },
      user_scope: { type: "boolean", description: "Install at user scope. Default false (device scope)." },
    }}},

  { name: "assign_declaration_to_device",
    description: "WRITE — Assign a declaration directly to a device.",
    inputSchema: { type: "object", required: ["declaration_id", "device_id"], properties: {
      declaration_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_declaration_from_device",
    description: "WRITE — Remove a declaration from a device.",
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
    description: "WRITE — Assign a profile directly to a device.",
    inputSchema: { type: "object", required: ["profile_id", "device_id"], properties: {
      profile_id: { type: "string" }, device_id: { type: "string" },
    }}},

  { name: "unassign_profile_from_device",
    description: "WRITE — Remove a profile from a device.",
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
    description: "WRITE — Trigger a sync with Apple for a DEP server.",
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
    description: "WRITE — Send an enrollment invitation to an email address or phone number.",
    inputSchema: { type: "object", required: ["enrollment_id", "contact"], properties: {
      enrollment_id: { type: "string" },
      contact: { type: "string", description: "Email address or phone number." },
    }}},

  { name: "delete_enrollment",
    description: "WRITE — Delete an enrollment configuration.",
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
    description: "WRITE — Create a managed app configuration entry for an app.",
    inputSchema: { type: "object", required: ["app_id", "key", "value", "kind"], properties: {
      app_id: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      kind: { type: "string", description: "Value type: string, integer, boolean, etc." },
    }}},

  { name: "delete_managed_app_config",
    description: "WRITE — Delete a managed app configuration entry.",
    inputSchema: { type: "object", required: ["app_id", "config_id"], properties: {
      app_id: { type: "string" }, config_id: { type: "string" },
    }}},

  { name: "push_managed_app_configs",
    description: "WRITE — Push managed app config updates to all devices with the app installed.",
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
    description: "WRITE — Create a new script.",
    inputSchema: { type: "object", required: ["name", "content"], properties: {
      name: { type: "string" },
      content: { type: "string", description: "The script content (shell script, etc.)." },
    }}},

  { name: "update_script",
    description: "WRITE — Update a script's name or content.",
    inputSchema: { type: "object", required: ["script_id"], properties: {
      script_id: { type: "string" },
      name: { type: "string" },
      content: { type: "string" },
    }}},

  { name: "delete_script",
    description: "WRITE — Delete a script.",
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
    description: "WRITE — Run a script on one or more devices.",
    inputSchema: { type: "object", required: ["script_id", "device_ids"], properties: {
      script_id: { type: "string" },
      device_ids: { type: "array", items: { type: "string" } },
    }}},

  { name: "cancel_script_job",
    description: "WRITE — Cancel a pending script job.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: { type: "string" } }}},

  // ══════════════════════════════════════════════════════════════════════════
  // MUNKIREPORT ENRICHMENT
  // ══════════════════════════════════════════════════════════════════════════
  { name: "get_munkireport_sync_health",
    description: "Sync-run state and telemetry from the SimpleMDM-MunkiReport module (module's own sync data; no cross-module content).",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_compliance",
    description: "Fleet compliance stats from the SimpleMDM-MunkiReport module, computed over its SimpleMDM-synced device table (status, supervision, FileVault, OS). Note: this is the SimpleMDM-reported FileVault field, not the cross-module filevault_status value.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_device_resources",
    description: "Per-device connected-resource context (profiles, apps, groups, scripts) from the SimpleMDM-MunkiReport module's own synced resource map.",
    inputSchema: { type: "object", required: ["serial_number"], properties: { serial_number: { type: "string" } }}},

  { name: "get_munkireport_apple_care",
    description: "AppleCare/warranty coverage stats — CROSS-MODULE data: the SimpleMDM-MunkiReport module reads the third-party MunkiReport warranty module's table (graceful zeros when that module isn't installed).",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_supplemental_overview",
    description: "Supplemental fleet overview — CROSS-MODULE data aggregated from other installed MunkiReport modules (built-in sources: filevault_status, findmymac, warranty/AppleCare, profile, managedinstalls; arbitrary serial-keyed third-party modules are auto-discovered). Graceful zeros for sources whose module isn't installed.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_alerts",
    description: "Current SimpleMDM alert/regression EVENTS from the module: 13 built-in types (command failed, FileVault/supervision/firewall/SIP/activation-lock disabled, enrollment/ADE regressed, passcode noncompliant, device stale, action accepted/failed) plus custom rules, newest first. Requires the module's get_events route (module >= the 2026-07-07 build).",
    inputSchema: { type: "object", properties: {
      serial_number: { type: "string", description: "Filter to one device." },
      type: { type: "string", enum: ["danger", "warning", "info"], description: "Filter by severity." },
      limit: { type: "number", description: "Max events, 1-500. Default 100." },
    }}},

  { name: "get_munkireport_command_status",
    description: "MDM command status distribution (failed/acknowledged/pending counts) from the module's command mirror — the public SimpleMDM API has no command-log endpoint, so this data exists only here.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_dashboard_trend",
    description: "Daily fleet trend snapshots (device/enrolled/supervised/FileVault/DEP/resource totals) up to 180 days back — historical data the SimpleMDM API cannot provide.",
    inputSchema: { type: "object", properties: {
      days: { type: "number", description: "Days of history, 1-180. Default 30." },
    }}},

  { name: "get_munkireport_supplemental_data",
    description: "Per-device CROSS-MODULE supplemental detail: every enrichment source (FileVault status, Find My, AppleCare/warranty, profiles, managedinstalls, auto-discovered third-party modules) plus Option-B client-reporter facts, with per-source freshness states.",
    inputSchema: { type: "object", required: ["serial_number"], properties: { serial_number: { type: "string" } }}},

  { name: "get_munkireport_supplemental_status",
    description: "Fleet-wide supplemental enrichment HEALTH: per-source freshness counts (fresh/stale/missing/refresh_failed/module_not_detected) and client-fact coverage. Warning-class data — refresh_failed and stale counts flag broken enrichment. Session or sync-token header auth.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_munkireport_client_facts",
    description: "Option-B client-reporter facts for one device (typed values, reported_at, source, client version) — endpoint-local data (console user, uptime, munki last run, local FileVault) that neither the SimpleMDM API nor server-side sync can see. Session or sync-token header auth (module 2026-07-08+).",
    inputSchema: { type: "object", required: ["serial_number"], properties: { serial_number: { type: "string" } }}},

  { name: "get_munkireport_runner_status",
    description: "Sync runner operational status: cron installation, Python runtime availability, runner config — the warning surface for 'syncs silently stopped'. Session or sync-token header auth (module 2026-07-08+).",
    inputSchema: { type: "object", properties: {} } },

  { name: "request_munkireport_sync",
    description: "WRITE — Queue a module mirror sync run in MunkiReport (picked up by its cron/worker). Acts on the module only, never on SimpleMDM. Requires an admin (global) MunkiReport session.",
    inputSchema: { type: "object", properties: {} } },

  { name: "refresh_munkireport_supplemental",
    description: "WRITE — Recompute the module's cross-module supplemental summaries (one device, or fleet-wide when serial_number is omitted). Local DB recompute only. Requires an admin (global) MunkiReport session.",
    inputSchema: { type: "object", properties: {
      serial_number: { type: "string", description: "Limit the refresh to one device." },
    }}},

  { name: "push_munkireport_findings",
    description: "WRITE — Push MCP-computed findings (SOFA CVE exposure, audit/diff deltas, stale/compliance detections) into MunkiReport, where they appear in the module's MCP Findings widget and get_mcp_findings. Authenticates with the sync token (the SimpleMDM API key the module already stores) — no MunkiReport session needed. replace=true (default) swaps out this source's previous findings so pushes reflect current state. Caps: 2000 findings, 2 MB. Requires the module's 2026-07-07+ build.",
    inputSchema: { type: "object", required: ["source", "findings"], properties: {
      source: { type: "string", description: "Findings namespace, e.g. 'sofa_audit' or 'inventory_diff' (a-z, 0-9, _, -; max 64)." },
      scan_id: { type: "string", description: "Groups this push under one scan for get_mcp_scan_status's per-source last-scan summary. Omit to let the module auto-generate one." },
      findings: { type: "array", description: "Array of { serial_number?, finding_type, category?, severity (danger|warning|info), message, data? }. category groups findings for get_mcp_finding_stats's by_category breakdown, e.g. 'FileVault', 'SIP', 'Firewall', 'XProtect', 'Compliance', 'OS'.", items: { type: "object" } },
      replace: { type: "boolean", description: "Replace this source's previous findings (default true)." },
    }}},

  { name: "get_munkireport_mcp_findings",
    description: "Read back MCP-pushed findings from the module (with per-severity totals). Filter by device, severity, or source. Session or sync-token header auth (module 2026-07-08+).",
    inputSchema: { type: "object", properties: {
      serial_number: { type: "string" },
      severity: { type: "string", enum: ["danger", "warning", "info"] },
      source: { type: "string" },
      limit: { type: "number", description: "Max findings, 1-500. Default 100." },
    }}},

  { name: "get_api_coverage",
    description: "Read — Report which SimpleMDM capability areas this MCP server exposes (tool count per area, total tools, write vs read). Static introspection of the registered tool list.",
    inputSchema: { type: "object", properties: {} } },

  { name: "check_for_update",
    description: "Read — Check whether a newer simplemdm-mcp release is available. Compares this server's running version against the latest GitHub release and returns {current_version, latest_version, update_available, release_url, upgrade}. Note: the server cannot update itself (it runs in a pinned, read-only Docker container) — when an update is available it returns the host-side upgrade steps to run.",
    inputSchema: { type: "object", properties: {} } },

  { name: "get_write_audit_log",
    description: "READ — Query the local write-audit log (JSONL, written by the write-safety gate). " +
                 "Filters: since (ISO timestamp), tool, tier (low|medium|high|critical), " +
                 "phase (plan|dry_run|execute|blocked), outcome (success|error|blocked), limit (default 100). " +
                 "Local file read only — never calls the SimpleMDM API.",
    inputSchema: { type: "object", properties: {
      since: { type: "string", description: "ISO 8601 timestamp; only entries at/after this time." },
      tool: { type: "string" },
      tier: { type: "string", enum: ["low", "medium", "high", "critical"] },
      phase: { type: "string", enum: ["plan", "dry_run", "execute", "blocked"] },
      outcome: { type: "string", enum: ["success", "error", "blocked"] },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
    }}},

  { name: "run_fleet_audit",
    description: "Runs the unified report engine CLI (node dist/reports/cli.js audit) as a host-side subprocess; writes CSV/md/html/docx/pdf files under reports/audit-YYYY-MM-DD and returns a text summary + report head. For in-process metadata-only generation (and declarative dynamic specs) use generate_report.",
    inputSchema: { type: "object", properties: {
      format: { type: "string", enum: ["csv", "md", "docx", "all"], description: "Report format to generate. Default is 'all'." },
      serial: { type: "string", description: "Scope to these comma-separated serial numbers (e.g. C02ABC123,DEF456)." },
      group: { type: "string", description: "Scope to this assignment group or device group name." },
      last_seen: { type: "number", description: "Scope to this number of most recently active devices." },
      no_network_cache: { type: "boolean", description: "Set true to ignore cached SOFA feed and refetch it." },
      report_only: { type: "boolean", description: "Write only the rendered report + summary; skip the data CSV exports. Not valid with format 'csv'." },
      page_size: { type: "string", enum: ["a3", "a4"], description: "PDF/HTML page size. 'a3' (default) = roomy A3-landscape with larger text; 'a4' = compact A4-landscape that shrinks the wide All Devices table to fit a standard page (denser, more wrapping)." },
      out_dir: { type: "string", description: "Custom output directory path." },
      publish: { type: "boolean", description: "Push per-check findings derived from the audit (FileVault/SIP/Firewall/XProtect/CVE/OS-EOL) to MunkiReport via push_munkireport_findings after the report writes. Publish failures are logged as a warning and do not fail the audit. Default false." },
      scan_id: { type: "string", description: "Scan id to group this publish under, surfaced by the module's get_mcp_scan_status. Defaults to scan_mcp_audit_<timestamp> when publish is true and scan_id is omitted." },
    }}},

  { name: "run_device_logs_audit",
    description: "Runs the unified report engine CLI (node dist/reports/cli.js logs) as a host-side subprocess; collects /logs activity feed, detects reinstall loops or update-failure loops, and writes report dossiers under reports/logs-audit-YYYY-MM-DD. For in-process generation use generate_report.",
    inputSchema: { type: "object", properties: {
      serial: { type: "string", description: "Comma-separated list of device serial numbers to audit." },
      last_seen: { type: "number", description: "Audit the N most recently active devices." },
      group: { type: "string", description: "Audit every device in a device/assignment group of this name." },
      all: { type: "boolean", description: "Audit the whole fleet (heavy, requires confirm_all=true)." },
      confirm_all: { type: "boolean", description: "Acknowledge running the audit against the entire fleet." },
      with_inventory: { type: "boolean", description: "Include software inventory, installed apps, and profiles." },
      with_security: { type: "boolean", description: "Include SOFA security eval (posture & CVE checks)." },
      format: { type: "string", enum: ["csv", "md", "docx", "all"], description: "Report formats to generate. Default is 'all'." },
      report_detail: { type: "string", enum: ["summary", "table", "full"], description: "Per-device event detail level. Default is 'summary'." },
      report_only: { type: "boolean", description: "Write only the rendered report dossier + manifest + summary; skip the CSV/JSON data exports. Not valid with format 'csv'." },
      out_dir: { type: "string", description: "Custom output directory path." },
    }}},

  { name: "run_config_backup",
    description: "Disaster-recovery export of the tenant's reproducible configuration: custom configuration profiles (actual downloaded mobileconfig XML), custom declarations (downloaded content), scripts (with content), assignment groups, device groups, custom attributes, and native-profile metadata. Writes files plus a sha256 manifest under reports/config-backup-<timestamp>/ (local only, never committed). Read-only against the API. Note: native SimpleMDM-built profiles have no download endpoint — only their metadata is captured.",
    inputSchema: { type: "object", properties: {
      out_dir: { type: "string", description: "Custom output directory path. Default reports/config-backup-<timestamp>." },
    }}},

  { name: "run_report_diff",
    description: "Compare two local inventory report run directories and report what CHANGED between them: devices added/removed, meaningful field changes (OS, FileVault, SIP, firewall, group, …; volatile per-check-in fields ignored), and findings new vs resolved. Answers 'what changed since the last audit' without re-reading thousands of findings. Writes diff-vs-<before>.md into the after directory. Both paths must be under reports/. Purely local — no API calls.",
    inputSchema: { type: "object", required: ["before_dir", "after_dir"], properties: {
      before_dir: { type: "string", description: "Older report run directory (under reports/), e.g. reports/inventory-20260611-090000." },
      after_dir: { type: "string", description: "Newer report run directory (under reports/)." },
    }}},

  { name: "run_inventory_report",
    description: "Runs the unified report engine CLI (node dist/reports/cli.js inventory) as a host-side subprocess; searchable fleet inventory of devices, apps, profiles, and security posture, with deployment-gap findings. Writes CSVs and a md/html/docx/pdf dossier. For in-process generation use generate_report.",
    inputSchema: { type: "object", properties: {
      search: { type: "string", description: "Query, e.g. 'group:faculty,staff seen:>=2025-01-01' or 'type:laptop os:<15 filevault:off'. Bare keywords AND together; OR between terms; -term excludes; field:value supports comma-lists, * wildcards, comparators, ranges, relative dates (seen:90d)." },
      serial: { type: "string", description: "Comma-separated device serial numbers." },
      group: { type: "string", description: "Device/assignment group name." },
      last_seen: { type: "number", description: "The N most recently seen devices." },
      all: { type: "boolean", description: "Whole fleet (heavy, requires confirm_all=true)." },
      confirm_all: { type: "boolean", description: "Acknowledge a whole-fleet per-device scan (needed for --all, or a fleet-wide search whose terms are all per-device)." },
      format: { type: "string", enum: ["csv", "md", "docx", "all"], description: "Report formats to generate. Default is 'all'." },
      report_detail: { type: "string", enum: ["summary", "table", "full"], description: "Per-device table detail in the dossier. Default is 'summary'." },
      report_style: { type: "string", enum: ["dossier", "roster", "flat"], description: "'dossier' (default) = audit style with rollups/findings/per-device facts; 'roster' = people-facing list grouped into device-group sections; 'flat' = one single table, device_group as a column — the spreadsheet-like hand-off view. Roster and flat also write report-table.csv, a CSV twin of the report's device rows." },
      sort: { type: "string", description: "Row order for roster/flat styles: seen|name|serial|model|os|group|year, optionally :asc or :desc (e.g. 'seen:desc' = most recently seen first). Defaults: roster oldest-seen first per group; flat by device group then last seen." },
      allow_partial: { type: "boolean", description: "Treat partial per-device data as success (otherwise the run reports partial data as a failure)." },
      findings_exclude: { type: "string", description: "Comma-separated finding types to drop from the report (noise control), e.g. 'assigned-app-missing'. Excluded counts are disclosed in summary.txt." },
      report_only: { type: "boolean", description: "Write only the rendered report + summary + manifest (plus report-table.csv for roster/flat styles); skip the data CSV exports. Not valid with format 'csv'." },
      raw: { type: "boolean", description: "Also write redacted raw device JSON (secrets are always redacted)." },
      out_dir: { type: "string", description: "Custom output directory path." },
    }}},

  { name: "verify_webhook_payload",
    description: "Validate the structure of an incoming SimpleMDM webhook JSON payload. Checks for expected fields by event type.",
    inputSchema: { type: "object", required: ["payload"], properties: {
      payload: { type: "string", description: "Raw JSON string of the webhook request body." },
    }}},

  { name: "get_dep_device_status",
    description: "Derived — Search for a DEP device by serial number across all registered Apple DEP/ABM servers on the tenant.",
    inputSchema: { type: "object", required: ["serial_number"], properties: {
      serial_number: { type: "string", description: "Device serial number to search for." },
    }}},

  { name: "set_managed_app_config_schema",
    description: "WRITE — Configure multiple managed configuration options (key-value schema) for an app, diffing and updating only changed fields, and push to devices.",
    inputSchema: { type: "object", required: ["app_id", "config"], properties: {
      app_id: { type: "string", description: "Catalog App ID to configure." },
      config: { type: "object", description: "Key-value dictionary of settings (values can be strings, integers, or booleans)." },
    }}},

  { name: "get_managed_app_config_templates",
    description: "Retrieve pre-defined managed configuration dictionary templates for common enterprise apps (Chrome, Zoom, Teams).",
    inputSchema: { type: "object", properties: {} } },

  // ══════════════════════════════════════════════════════════════════════════
  // UNIFIED REPORT ENGINE (in-process)
  // ══════════════════════════════════════════════════════════════════════════
  { name: "generate_report",
    description: "Generate a fleet dossier in-process and return WriteResult metadata (out_dir, files with sha256, skipped). Two modes (provide exactly one): (1) catalog — set `report` (audit/inventory/logs) + `scope`; reuses the same registry and bridge as the CLI. (2) dynamic — set `spec`, a declarative report definition rendered in the house style over a chosen dataAdapter (devices/apps/profiles/users/logs/posture). For large fleets prefer scoped selectors; whole-fleet (all) requires confirm_all:true in the scope object. The run_fleet_audit, run_device_logs_audit, and run_inventory_report tools wrap the same engine as host-side subprocesses for on-disk delivery.",
    inputSchema: { type: "object", properties: {
      report: { type: "string", enum: ["audit", "inventory", "logs"], description: "Catalog mode: report type — audit (SOFA security), inventory (fleet software/profile inventory), logs (device activity log export). Mutually exclusive with `spec`." },
      scope: { type: "object", description: "Catalog mode device selector — one of: {serials:[\"SN1\",...]}, {group:\"GroupName\"}, {last_seen:N}, {all:true,confirm_all:true}, or {search:\"query\"} (inventory only). Whole-fleet scope requires confirm_all:true to prevent accidental large fetches." },
      spec: { type: "object", description: "Dynamic mode: a declarative report spec {title, pageStyle?, footerTitle?, mdName?, dataAdapter, sections:[{heading, table:{columns:[{key,header}], from, csvName?, filter?}}]}. pageStyle is OPTIONAL (a3-landscape|a4-landscape|letter-portrait) — when omitted it is auto-selected by the widest table's column count: ≤6 cols → letter-portrait, 7-12 → a4-landscape, ≥13 → a3-landscape. dataAdapter is one of devices|apps|profiles|users|logs|posture; each section's table.from selects rows from the adapter result (key \"rows\"). Optional table.filter is an array of {field, op, value?} conditions (ANDed) — op one of eq|ne|contains|icontains|gt|lt|gte|lte|exists|absent|in; field supports dot-paths (e.g. \"attributes.name\") — keeps only matching rows (e.g. stale devices, missing-FileVault). Mutually exclusive with `report`." },
      format: { type: "string", enum: ["csv", "md", "docx", "all"], description: "Output format(s). Default 'all'." },
      report_only: { type: "boolean", description: "Write only the rendered dossier; skip data CSV exports." },
    }}},
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

function qs(args: Args, keys: string[]): string {
  const p = new URLSearchParams();
  for (const k of keys) if (args[k] != null) p.set(k, String(args[k]));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function handleTool(name: string, args: Args): Promise<unknown> {
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
        const foundData = Array.isArray(found?.data) ? found.data : [];
        // /devices?search also matches names/UDIDs — require an exact serial match;
        // guessing (e.g. first hit) would return a dossier for the wrong device.
        const match = foundData.find(d => (d as { attributes?: { serial_number?: string } }).attributes?.serial_number === args.serial_number);
        if (!match) {
          const near = foundData
            .map(d => (d as { attributes?: { serial_number?: string } }).attributes?.serial_number)
            .filter(Boolean).slice(0, 5);
          throw new Error(
            `No device with exact serial_number=${args.serial_number}` +
            (near.length ? ` (search returned near matches: ${near.join(", ")})` : "")
          );
        }
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
          const pct = normalizeBatteryPct(batRaw);
          if (pct !== undefined && pct <= lowBatteryPct) {
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
        // Without a command_uuid, pair by device + command FAMILY (event minus its
        // trailing sent/acknowledged verb). Keying on the full event name (or its
        // timestamp) can never pair a sent with its terminal event, which reported
        // every old command as pending forever.
        const family = event.replace(/[.:]?(sent|queued|pending|acknowledged|succeeded|completed|failed|error)$/i, "");
        const cmdKey = String((meta?.command_uuid as string | undefined) ?? (meta?.uuid as string | undefined) ?? `${did}:${family}`);
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
        table_last_updated: "2026-04",
        mac_count: rows.length,
        upgradable_count: upgradable.length,
        unknown_model_count: unknownModel.length,
        devices: rows,
      };
      if (unknownPrefixes.length > 0) {
        result.unknown_model_prefixes = unknownPrefixes;
        result._agent_hint = `${unknownPrefixes.length} model identifier${unknownPrefixes.length > 1 ? "s are" : " is"} not in the built-in support table (last updated 2026-04): ${unknownPrefixes.join(", ")}. `
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
        const pct = normalizeBatteryPct(raw);
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

    case "get_dep_token_audit": {
      const r = await collectAllPages<{ id: string | number; attributes?: Record<string, unknown> }>("/dep_servers");
      const now = Date.now();
      const SYNC_STALE_MS = 7 * 86_400_000;
      const servers = r.data.map(s => {
        const at = s.attributes ?? {};
        const expiry = at.token_expires_at as string | undefined;
        let days_until_expiry: number | null = null;
        let warning: "ok" | "renew_soon" | "renew_now" | "expired" | "unknown" = "unknown";
        if (expiry) {
          const t = Date.parse(expiry);
          if (Number.isFinite(t)) {
            days_until_expiry = Math.floor((t - now) / 86_400_000);
            warning = days_until_expiry < 0 ? "expired"
                    : days_until_expiry <= 30 ? "renew_now"
                    : days_until_expiry <= 90 ? "renew_soon" : "ok";
          }
        }
        const lastSynced = at.last_synced_at as string | undefined;
        const lastSyncedT = lastSynced ? Date.parse(lastSynced) : NaN;
        const sync_stale = !Number.isFinite(lastSyncedT) || (now - lastSyncedT) > SYNC_STALE_MS;
        return {
          id: s.id,
          server_name: at.server_name as string | undefined,
          organization_name: at.organization_name as string | undefined,
          token_expires_at: expiry ?? null,
          last_synced_at: lastSynced ?? null,
          days_until_expiry,
          warning,
          sync_stale,
        };
      });
      const RANK: Record<string, number> = { expired: 4, renew_now: 3, renew_soon: 2, ok: 1, unknown: 0 };
      servers.sort((a, b) => {
        if (a.days_until_expiry === null && b.days_until_expiry === null) return 0;
        if (a.days_until_expiry === null) return 1;
        if (b.days_until_expiry === null) return -1;
        return a.days_until_expiry - b.days_until_expiry;
      });
      const worst_warning = servers.reduce<string>((w, s) => (RANK[s.warning] > RANK[w] ? s.warning : w), "unknown");
      return {
        total: servers.length,
        expired_count: servers.filter(s => s.warning === "expired").length,
        renew_now_count: servers.filter(s => s.warning === "renew_now").length,
        renew_soon_count: servers.filter(s => s.warning === "renew_soon").length,
        worst_warning: servers.length ? worst_warning : "unknown",
        servers,
      };
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
    case "get_activation_lock_status": {
      const id = seg(args.device_id, "device_id");
      const dev = await api(`/devices/${id}`) as { data?: { attributes?: Record<string, unknown> } };
      const attrs = dev.data?.attributes ?? {};
      return {
        device_id: id,
        name: attrs.name ?? attrs.device_name ?? null,
        serial_number: attrs.serial_number ?? null,
        activation_lock_enabled: attrs.is_activation_lock_enabled ?? null,
        is_supervised: attrs.is_supervised ?? null,
        dep_enrolled: attrs.dep_enrolled ?? null,
      };
    }
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
    case "wipe_device": {
      requireWrites();
      validateWipeArgs(args);
      return api(`/devices/${seg(args.device_id, "device_id")}/wipe`, {
        method: "POST",
        body: j(buildWipeBody(args)),
      });
    }
    case "sync_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/push_apps`, { method: "POST" });
    case "refresh_device_inventory":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/refresh`, { method: "POST" });
    case "disable_activation_lock":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/disable_activation_lock`, { method: "POST" });
    case "push_message": {
      requireWrites();
      const msg = String(args.message ?? "");
      if (msg.length === 0 || msg.length > 225) {
        throw new Error(`push_message: message must be 1-225 characters (got ${msg.length}).`);
      }
      return api(`/devices/${seg(args.device_id, "device_id")}/push_message`, { method: "POST", body: j({ message: msg }) });
    }
    case "restart_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/restart`, { method: "POST" });
    case "shutdown_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/shutdown`, { method: "POST" });
    case "refresh_cellular_plans":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/refresh_cellular_plans`, {
        method: "POST",
        body: j({ esim_server_url: args.esim_server_url }),
      });
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

    // ── Apple device-management schema helpers ───────────────────────────────
    case "search_apple_device_management_schemas":
      return {
        source: APPLE_SCHEMA_SOURCE,
        schemas: listAppleSchemas(args),
      };
    case "get_apple_device_management_schema":
      return {
        source: APPLE_SCHEMA_SOURCE,
        schema: getAppleSchema(args.identifier, args.kind),
      };
    case "validate_apple_payload":
      return validateApplePayload({
        identifier: args.identifier,
        kind: args.kind,
        payload: args.payload,
      });
    case "build_mobileconfig":
      return buildMobileconfig({
        display_name: args.display_name,
        identifier: args.identifier,
        organization: args.organization,
        description: args.description,
        scope: args.scope,
        payloads: args.payloads,
      });
    case "build_custom_declaration_payload":
      return buildCustomDeclarationPayload({
        declaration_type: args.declaration_type,
        identifier: args.identifier,
        server_token: args.server_token,
        payload: args.payload,
      });
    case "build_wifi_profile_payload":
      return buildWifiProfilePayload({
        ssid: args.ssid,
        encryption_type: args.encryption_type,
        password: args.password,
        auto_join: args.auto_join,
        hidden_network: args.hidden_network,
        eap_client_configuration: args.eap_client_configuration,
        proxy_type: args.proxy_type,
      });
    case "build_firewall_profile_payload":
      return buildFirewallProfilePayload({
        enable_firewall: args.enable_firewall,
        block_all_incoming: args.block_all_incoming,
        enable_stealth_mode: args.enable_stealth_mode,
        applications: args.applications,
      });
    case "build_passcode_profile_payload":
      return buildPasscodeProfilePayload({
        force_pin: args.force_pin,
        min_length: args.min_length,
        min_complex_chars: args.min_complex_chars,
        max_failed_attempts: args.max_failed_attempts,
        max_inactivity: args.max_inactivity,
        allow_simple: args.allow_simple,
      });
    case "build_software_update_settings_declaration":
      return buildSoftwareUpdateSettingsDeclaration({
        identifier: args.identifier,
        server_token: args.server_token,
        automatic_actions: args.automatic_actions,
        deferrals: args.deferrals,
        rapid_security_response: args.rapid_security_response,
        beta: args.beta,
      });
    case "build_restrictions_profile_payload":
      return buildRestrictionsProfilePayload({
        allow_app_installation: args.allow_app_installation,
        allow_camera: args.allow_camera,
        allow_cloud_backup: args.allow_cloud_backup,
        allow_diagnostic_submission: args.allow_diagnostic_submission,
        allow_safari: args.allow_safari,
      });
    case "build_scep_profile_payload":
      return buildScepProfilePayload({
        url: args.url,
        name: args.name,
        challenge: args.challenge,
        key_type: args.key_type,
        key_size: args.key_size,
        key_usage: args.key_usage,
        retries: args.retries,
        retry_delay: args.retry_delay,
        subject: args.subject,
      });
    case "build_certificate_profile_payload":
      return buildCertificateProfilePayload({
        payload_content: args.payload_content,
        certificate_file_name: args.certificate_file_name,
      });
    case "build_vpn_profile_payload":
      return buildVpnProfilePayload({
        user_defined_name: args.user_defined_name,
        vpn_type: args.vpn_type,
        vpn_sub_type: args.vpn_sub_type,
        vpn: args.vpn,
        ikev2: args.ikev2,
        ipsec: args.ipsec,
        on_demand_enabled: args.on_demand_enabled,
        on_demand_rules: args.on_demand_rules,
      });
    case "build_webclip_profile_payload":
      return buildWebClipProfilePayload({
        label: args.label,
        url: args.url,
        is_removable: args.is_removable,
        full_screen: args.full_screen,
        icon: args.icon,
      });
    case "build_content_filter_profile_payload":
      return buildContentFilterProfilePayload({
        filter_type: args.filter_type,
        auto_filter_enabled: args.auto_filter_enabled,
        permitted_urls: args.permitted_urls,
        blacklisted_urls: args.blacklisted_urls,
        whitelisted_bookmarks: args.whitelisted_bookmarks,
        plugin_bundle_id: args.plugin_bundle_id,
        server_address: args.server_address,
      });
    case "build_filevault_escrow_profile_payload":
      return buildFileVaultEscrowProfilePayload({
        encrypt_cert_payload_uuid: args.encrypt_cert_payload_uuid,
        location: args.location,
        device_key: args.device_key,
      });

    // ── Custom configuration profiles ─────────────────────────────────────────
    case "list_custom_configuration_profiles": {
      const r = await collectAllPages<AnyRecord>("/custom_configuration_profiles");
      return { data: slimRelationships(r.data), has_more: r.has_more };
    }
    case "download_custom_configuration_profile": {
      const id = seg(args.profile_id, "profile_id");
      const { content, contentType } = await simpleMDMText(`/custom_configuration_profiles/${id}/download`);
      return { profile_id: String(args.profile_id), content_type: contentType, content };
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
    case "download_custom_declaration": {
      const id = seg(args.declaration_id, "declaration_id");
      const { content, contentType } = await simpleMDMText(`/custom_declarations/${id}/download`);
      return { declaration_id: String(args.declaration_id), content_type: contentType, content };
    }
    case "create_custom_declaration":
      requireWrites();
      return api("/custom_declarations", { method: "POST", body: j({ name: args.name, declaration_type: args.declaration_type, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update, user_scope: args.user_scope }) });
    case "create_safari_bookmarks_declaration": {
      requireWrites();
      const bookmarksPayload = buildSafariBookmarksPayload({
        group_title: args.group_title,
        group_identifier: args.group_identifier,
        bookmarks: args.bookmarks,
      });
      // Delivered as a DDM custom declaration. `declaration_type` names the Apple
      // configuration; `payload` carries the configuration body. SimpleMDM assigns
      // the declaration's Identifier/ServerToken.
      return api("/custom_declarations", { method: "POST", body: j({
        name: args.name,
        declaration_type: SAFARI_BOOKMARKS_DECLARATION_TYPE,
        payload: JSON.stringify(bookmarksPayload),
        user_scope: args.user_scope,
      }) });
    }
    case "update_custom_declaration":
      requireWrites();
      return api(`/custom_declarations/${seg(args.declaration_id, "declaration_id")}`, { method: "PATCH", body: j({ name: args.name, declaration_type: args.declaration_type, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update }) });
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
    // Direct-mode routes are the SimpleMDM-MunkiReport module's public controller
    // methods (MunkiReport routes modules as /module/<name>/<method>) — verified
    // against the module source; the old "/simplemdm/data/…" shapes were phantom.
    case "get_munkireport_sync_health":       return USE_LOCAL_APP ? api("/enrichment/sync_health")          : munkiReport("/get_sync_telemetry");
    case "get_munkireport_compliance":        return USE_LOCAL_APP ? api("/enrichment/compliance")            : munkiReport("/get_compliance_stats");
    case "get_munkireport_device_resources":  return USE_LOCAL_APP ? api(`/enrichment/device/${encodeURIComponent(String(args.serial_number))}`) : munkiReport(`/get_device_resources/${encodeURIComponent(String(args.serial_number))}`);
    case "get_munkireport_apple_care":        return USE_LOCAL_APP ? api("/enrichment/apple_care")            : munkiReport("/get_supplemental_applecare_stats");
    case "get_munkireport_supplemental_overview": return USE_LOCAL_APP ? api("/enrichment/supplemental_overview") : munkiReport("/get_supplemental_overview_stats");
    case "get_munkireport_alerts": {
      const params = new URLSearchParams();
      if (args.limit != null) params.set("limit", String(args.limit));
      if (args.type != null) params.set("type", String(args.type));
      const qs2 = params.size ? `?${params}` : "";
      const serialSeg = args.serial_number != null ? `/${seg(args.serial_number, "serial_number")}` : "";
      return munkiReport(`/get_events${serialSeg}${qs2}`);
    }
    case "get_munkireport_command_status":     return munkiReport("/get_command_status_stats");
    case "get_munkireport_dashboard_trend":    return munkiReport(`/get_dashboard_trend${args.days != null ? `?days=${encodeURIComponent(String(args.days))}` : ""}`);
    case "get_munkireport_supplemental_data":  return munkiReport(`/get_supplemental_data/${seg(args.serial_number, "serial_number")}`);
    case "get_munkireport_supplemental_status": return munkiReport("/get_supplemental_status");
    case "get_munkireport_client_facts":       return munkiReport(`/get_client_facts/${seg(args.serial_number, "serial_number")}`);
    case "get_munkireport_runner_status":      return munkiReport("/get_runner_status");
    case "request_munkireport_sync":
      requireWrites();
      return munkiReport("/request_sync");
    case "refresh_munkireport_supplemental":
      requireWrites();
      return munkiReport(`/refresh_supplemental_summary${args.serial_number != null ? `/${seg(args.serial_number, "serial_number")}` : ""}`);
    case "push_munkireport_findings": {
      requireWrites();
      const source = String(args.source ?? "");
      if (!/^[a-z0-9_-]{1,64}$/.test(source)) {
        throw new Error("push_munkireport_findings: source must be 1-64 chars of a-z, 0-9, _, - (got \"" + source + "\").");
      }
      const findings = args.findings;
      if (!Array.isArray(findings) || findings.length === 0) {
        throw new Error("push_munkireport_findings: at least one finding is required.");
      }
      if (findings.length > 2000) {
        throw new Error(`push_munkireport_findings: too many findings (${findings.length}; 2000 cap per push).`);
      }
      const body: Record<string, unknown> = {
        source,
        replace: args.replace !== false,
        findings,
      };
      if (args.scan_id != null) body.scan_id = String(args.scan_id);
      return munkiReportIngest("/ingest_mcp_findings", body);
    }
    case "get_munkireport_mcp_findings": {
      const params = new URLSearchParams();
      if (args.limit != null) params.set("limit", String(args.limit));
      if (args.severity != null) params.set("severity", String(args.severity));
      if (args.source != null) params.set("source", String(args.source));
      const qs3 = params.size ? `?${params}` : "";
      const serialSeg3 = args.serial_number != null ? `/${seg(args.serial_number, "serial_number")}` : "";
      return munkiReport(`/get_mcp_findings${serialSeg3}${qs3}`);
    }

    case "run_fleet_audit": {
      const format = args.format as string | undefined ?? "all";
      const serial = args.serial as string | undefined;
      const group = args.group as string | undefined;
      const lastSeen = args.last_seen as number | undefined;
      const noNetworkCache = args.no_network_cache === true;
      const customOutDir = args.out_dir as string | undefined;

      const dateStr = new Date().toISOString().slice(0, 10);
      const outDir = resolveReportPath(customOutDir ?? `reports/audit-${dateStr}`);

      const here = dirname(fileURLToPath(import.meta.url));
      const cliPath = resolve(here, "reports", "cli.js");

      const env = { ...process.env, SIMPLEMDM_API_KEY: API_KEY };

      const { buildAuditCliArgs } = await import("./reportCliArgs.js");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      try {
        const { stdout, stderr } = await execFileAsync("node", [cliPath, ...buildAuditCliArgs(args, outDir)], { env, cwd: PKG_ROOT });
        
        let summaryContent = "";
        try {
          summaryContent = readFileSync(resolve(outDir, "summary.txt"), "utf8");
        } catch (e) {
          summaryContent = `Audit ran but summary.txt could not be read: ${e instanceof Error ? e.message : String(e)}`;
        }

        let reportContent = "";
        if (["md", "all"].includes(format)) {
          try {
            reportContent = readFileSync(resolve(outDir, "full-audit.md"), "utf8");
          } catch {}
        }

        return {
          success: true,
          stdout,
          stderr,
          summary: summaryContent,
          report: reportContent ? reportContent.slice(0, 15000) : undefined,
          report_truncated: reportContent.length > 15000,
          output_dir: outDir
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          stdout: err.stdout,
          stderr: err.stderr,
        };
      }
    }

    case "run_device_logs_audit": {
      const serial = args.serial as string | undefined;
      const lastSeen = args.last_seen as number | undefined;
      const group = args.group as string | undefined;
      const all = args.all === true;
      const confirmAll = args.confirm_all === true;
      const withInventory = args.with_inventory === true;
      const withSecurity = args.with_security === true;
      const format = args.format as string | undefined ?? "all";
      const reportDetail = args.report_detail as string | undefined ?? "summary";
      const customOutDir = args.out_dir as string | undefined;

      const dateStr = new Date().toISOString().slice(0, 10);
      const outDir = resolveReportPath(customOutDir ?? `reports/logs-audit-${dateStr}`);

      const here = dirname(fileURLToPath(import.meta.url));
      const cliPath = resolve(here, "reports", "cli.js");

      const env = { ...process.env, SIMPLEMDM_API_KEY: API_KEY };

      const { buildLogsCliArgs } = await import("./reportCliArgs.js");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      try {
        const { stdout, stderr } = await execFileAsync("node", [cliPath, ...buildLogsCliArgs(args, outDir)], { env, cwd: PKG_ROOT });

        let summaryContent = "";
        try {
          summaryContent = readFileSync(resolve(outDir, "summary.txt"), "utf8");
        } catch (e) {
          summaryContent = `Logs audit ran but summary.txt could not be read: ${e instanceof Error ? e.message : String(e)}`;
        }

        let reportContent = "";
        if (["md", "all"].includes(format)) {
          try {
            reportContent = readFileSync(resolve(outDir, "report.md"), "utf8");
          } catch {}
        }

        return {
          success: true,
          stdout,
          stderr,
          summary: summaryContent,
          report: reportContent ? reportContent.slice(0, 15000) : undefined,
          report_truncated: reportContent.length > 15000,
          output_dir: outDir
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          stdout: err.stdout,
          stderr: err.stderr,
        };
      }
    }

    case "run_config_backup": {
      const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const outDir = resolveReportPath(typeof args.out_dir === "string" && args.out_dir ? String(args.out_dir) : `reports/config-backup-${ts}`);
      const errors: Array<{ item: string; error: string }> = [];
      const manifestFiles: Array<{ file: string; bytes: number; sha256: string }> = [];
      const safeName = (v: unknown) => String(v ?? "unnamed").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
      const writeEntry = (rel: string, content: string) => {
        const full = join(outDir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        manifestFiles.push({ file: rel, bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") });
      };

      // Custom profiles: the only copy of hand-crafted mobileconfig content.
      const profs = await collectAllPages<AnyRecord>("/custom_configuration_profiles");
      for (const p of profs.data) {
        try {
          const { content } = await simpleMDMText(`/custom_configuration_profiles/${encodeURIComponent(String(p.id))}/download`);
          writeEntry(`custom-profiles/${p.id}-${safeName(p.attributes?.name)}.mobileconfig`, content);
        } catch (e) {
          errors.push({ item: `custom_configuration_profile ${p.id} (${p.attributes?.name ?? ""})`, error: formatError(e) });
        }
      }
      const decls = await collectAllPages<AnyRecord>("/custom_declarations");
      for (const d of decls.data) {
        try {
          const { content } = await simpleMDMText(`/custom_declarations/${encodeURIComponent(String(d.id))}/download`);
          writeEntry(`custom-declarations/${d.id}-${safeName(d.attributes?.name)}.json`, content);
        } catch (e) {
          errors.push({ item: `custom_declaration ${d.id} (${d.attributes?.name ?? ""})`, error: formatError(e) });
        }
      }

      // Full-record JSON exports (scripts carry their content in the record;
      // native profiles have no download endpoint — metadata only).
      const jsonExports: Array<[string, string]> = [
        ["/scripts", "scripts.json"],
        ["/assignment_groups", "assignment-groups.json"],
        ["/device_groups", "device-groups.json"],
        ["/custom_attributes", "custom-attributes.json"],
        ["/profiles", "profiles-metadata.json"],
      ];
      const counts: Record<string, number> = {
        custom_profiles: profs.data.length,
        custom_declarations: decls.data.length,
      };
      for (const [path, file] of jsonExports) {
        try {
          const r = await collectAllPages<AnyRecord>(path);
          counts[file.replace(/[-.]/g, "_").replace(/_json$/, "").replace(/_metadata$/, "")] = r.data.length;
          writeEntry(file, JSON.stringify(r.data, null, 2));
        } catch (e) {
          errors.push({ item: path, error: formatError(e) });
        }
      }

      writeEntry("manifest.json", JSON.stringify({
        generated_at: new Date().toISOString(),
        counts,
        errors,
        files: manifestFiles,
      }, null, 2));
      // Re-read to include the manifest itself in the returned file list only.
      return {
        out_dir: outDir,
        counts,
        files: manifestFiles.length,
        errors,
        partial: errors.length > 0,
        note: "Local-only export (reports/ is gitignored, never committed). Native SimpleMDM-built profiles are captured as metadata only — the API has no download endpoint for them.",
      };
    }

    case "run_report_diff": {
      // Restrict to reports/ so this cannot be used to read arbitrary paths.
      const inReports = (p: unknown, label: string): string => {
        const raw = String(p ?? "");
        const full = resolveReportPath(raw);
        const root = resolve(PKG_ROOT, "reports");
        if (full !== root && !full.startsWith(root + "/")) {
          throw new Error(`${label} must be a directory under reports/ (got "${raw}")`);
        }
        return full;
      };
      const beforeDir = inReports(args.before_dir, "before_dir");
      const afterDir = inReports(args.after_dir, "after_dir");
      const { diffInventoryRuns, renderDiffMarkdown } = await import("./reports/domain/diff.js");
      const { basename } = await import("node:path");
      const d = diffInventoryRuns(beforeDir, afterDir);
      const markdown = renderDiffMarkdown(d, beforeDir, afterDir);
      const mdName = `diff-vs-${basename(beforeDir)}.md`;
      writeFileSync(join(afterDir, mdName), markdown);
      return {
        before_dir: String(args.before_dir), after_dir: String(args.after_dir),
        devices_added: d.devicesAdded, devices_removed: d.devicesRemoved,
        changed: d.changed,
        findings_new_count: d.findingsNew.length, findings_resolved_count: d.findingsResolved.length,
        counts_before: d.countsBefore, counts_after: d.countsAfter,
        diff_file: mdName, markdown,
      };
    }

    case "run_inventory_report": {
      const search = args.search as string | undefined;
      const serial = args.serial as string | undefined;
      const group = args.group as string | undefined;
      const lastSeen = args.last_seen as number | undefined;
      const all = args.all === true;
      const confirmAll = args.confirm_all === true;
      const format = args.format as string | undefined ?? "all";
      const reportDetail = args.report_detail as string | undefined ?? "summary";
      const reportStyle = args.report_style as string | undefined ?? "dossier";
      const sortSpec = args.sort as string | undefined;
      const allowPartial = args.allow_partial === true;
      const raw = args.raw === true;
      const customOutDir = args.out_dir as string | undefined;
      const outDirArg = customOutDir ? resolveReportPath(customOutDir) : undefined;

      const here = dirname(fileURLToPath(import.meta.url));
      const cliPath = resolve(here, "reports", "cli.js");

      const env = { ...process.env, SIMPLEMDM_API_KEY: API_KEY };

      const { buildInventoryCliArgs } = await import("./reportCliArgs.js");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const collectOutputs = (stdout: string | undefined) => {
        const rawOutDir = outDirArg ?? stdout?.match(/^Output: (.+)$/m)?.[1];
        const outDir = rawOutDir ? resolveReportPath(rawOutDir) : undefined;
        if (!outDir) return { outDir: undefined, summary: "", report: "" };
        let summary = "";
        try { summary = readFileSync(resolve(outDir, "summary.txt"), "utf8"); } catch {}
        let report = "";
        if (["md", "all"].includes(format)) {
          try { report = readFileSync(resolve(outDir, "report.md"), "utf8"); } catch {}
        }
        return { outDir, summary, report };
      };

      try {
        const cliArgs = buildInventoryCliArgs(outDirArg ? { ...args, out_dir: outDirArg } : args);
        const { stdout, stderr } = await execFileAsync("node", [cliPath, ...cliArgs], { env, cwd: PKG_ROOT });
        const { outDir, summary, report } = collectOutputs(stdout);
        return {
          success: true,
          stdout,
          stderr,
          summary: summary || undefined,
          report: report ? report.slice(0, 15000) : undefined,
          report_truncated: report.length > 15000,
          output_dir: outDir,
        };
      } catch (err: any) {
        // exit 2 with outputs on disk = partial per-device data (by design,
        // unless allow_partial) — surface the summary so the caller sees what
        // was written and which fetches failed.
        const { outDir, summary } = collectOutputs(err.stdout);
        return {
          success: false,
          partial_data: err.code === 2,
          error: err.message,
          stdout: err.stdout,
          stderr: err.stderr,
          summary: summary || undefined,
          output_dir: outDir,
        };
      }
    }

    case "verify_webhook_payload": {
      const payloadStr = args.payload as string;
      try {
        const payload = JSON.parse(payloadStr);
        const eventType = payload.event as string | undefined;
        if (!eventType) {
          return { valid: false, error: "Missing 'event' field indicating event type." };
        }
        const expectedFields: Record<string, string[]> = {
          "device.enrolled": ["device_id", "device_name", "serial_number"],
          "device.unenrolled": ["device_id", "device_name", "serial_number"],
          "device.changed_group": ["device_id", "device_name", "serial_number", "device_group_id"],
          "device.lock.enabled": ["device_id", "device_name", "serial_number"],
          "abm.device.added": ["serial_number", "model", "dep_server_id"],
        };

        const fields = expectedFields[eventType];
        if (!fields) {
          return {
            valid: true,
            warning: `Unknown event type '${eventType}'. Payload was parsed successfully as JSON but schema could not be verified.`,
            payload
          };
        }

        const missing: string[] = [];
        const data = payload.data ?? {};
        for (const f of fields) {
          if (data[f] == null) missing.push(f);
        }

        if (missing.length > 0) {
          return {
            valid: false,
            error: `Missing expected fields under 'data' for event type '${eventType}': ${missing.join(", ")}`,
            payload
          };
        }

        return {
          valid: true,
          event: eventType,
          message: `Payload successfully validated against schema for '${eventType}'.`,
          payload
        };
      } catch (e: any) {
        return { valid: false, error: `Invalid JSON payload: ${e.message}` };
      }
    }

    case "get_dep_device_status": {
      const serialNumber = (args.serial_number as string).trim();
      const depServers = await collectAllPages<AnyRecord>("/dep_servers");
      
      for (const server of depServers.data) {
        const serverId = server.id;
        const serverName = server.attributes?.name as string | undefined ?? "Unknown Server";
        
        try {
          const depDevices = await collectAllPages<AnyRecord>(`/dep_servers/${serverId}/dep_devices`);
          const matched = depDevices.data.find(d => {
            const sn = d.attributes?.serial_number as string | undefined;
            return sn && sn.toUpperCase() === serialNumber.toUpperCase();
          });
          
          if (matched) {
            return {
              found: true,
              dep_server: { id: serverId, name: serverName },
              device: {
                dep_device_id: matched.id,
                serial_number: matched.attributes?.serial_number,
                model: matched.attributes?.model,
                description: matched.attributes?.description,
                color: matched.attributes?.color,
                asset_tag: matched.attributes?.asset_tag,
                profile_status: matched.attributes?.profile_status,
                profile_uuid: matched.attributes?.profile_uuid,
                profile_assign_time: matched.attributes?.profile_assign_time,
                profile_push_time: matched.attributes?.profile_push_time,
                device_family: matched.attributes?.device_family,
                os_version: matched.attributes?.os_version,
              }
            };
          }
        } catch (e) {
          // Continue to next server on failure
          console.error(`Error checking DEP server ${serverId}:`, e);
        }
      }
      
      return { found: false, message: `Device with serial '${serialNumber}' not found on any DEP servers.` };
    }

    case "set_managed_app_config_schema": {
      requireWrites();
      const appId = args.app_id as string;
      const config = args.config as Record<string, unknown>;

      // 1. Get current configs
      const currentConfigs = await collectAllPages<AnyRecord>(`/apps/${seg(appId, "app_id")}/managed_configs`);
      
      const operations: Array<{ type: "delete" | "create"; key?: string; configId?: string|number; value?: unknown; kind?: string }> = [];
      const currentMap = new Map<string, { id: string|number; value: unknown; kind: string }>();
      
      for (const item of currentConfigs.data) {
        const key = item.attributes?.key as string | undefined;
        if (key) {
          currentMap.set(key, {
            id: item.id,
            value: item.attributes?.value,
            kind: item.attributes?.kind as string ?? "string"
          });
        }
      }

      // 2. Diff config inputs
      for (const [key, val] of Object.entries(config)) {
        let kind: "string" | "boolean" | "integer" = "string";
        if (typeof val === "boolean") kind = "boolean";
        else if (typeof val === "number" && Number.isInteger(val)) kind = "integer";

        const existing = currentMap.get(key);
        if (existing) {
          // If value or kind differs, we must delete and recreate (since SimpleMDM has no patch for managed config keys)
          if (existing.value !== val || existing.kind !== kind) {
            operations.push({ type: "delete", key, configId: existing.id });
            operations.push({ type: "create", key, value: val, kind });
          }
        } else {
          operations.push({ type: "create", key, value: val, kind });
        }
      }

      const results = [];
      
      // 3. Execute deletions first
      for (const op of operations.filter(o => o.type === "delete")) {
        try {
          await api(`/apps/${seg(appId, "app_id")}/managed_configs/${seg(op.configId, "config_id")}`, { method: "DELETE" });
          results.push(`Deleted existing config key '${op.key}'`);
        } catch (e: any) {
          results.push(`Error deleting config key '${op.key}': ${e.message}`);
        }
      }

      // 4. Execute creations
      for (const op of operations.filter(o => o.type === "create")) {
        try {
          await api(`/apps/${seg(appId, "app_id")}/managed_configs`, {
            method: "POST",
            body: j({ key: op.key, value: op.value, kind: op.kind })
          });
          results.push(`Created config key '${op.key}' = ${op.value} (${op.kind})`);
        } catch (e: any) {
          results.push(`Error creating config key '${op.key}': ${e.message}`);
        }
      }

      // 5. Push updates to devices
      let pushSuccess = false;
      try {
        await api(`/apps/${seg(appId, "app_id")}/managed_configs/push`, { method: "POST" });
        pushSuccess = true;
        results.push("Successfully pushed managed configuration changes to devices.");
      } catch (e: any) {
        results.push(`Error pushing managed configuration changes: ${e.message}`);
      }

      return {
        success: pushSuccess,
        results
      };
    }

    case "get_managed_app_config_templates": {
      return {
        templates: {
          chrome: {
            app_name: "Google Chrome",
            description: "Common configuration options for Google Chrome Enterprise.",
            config: {
              HomepageLocation: "https://www.google.com",
              RestoreOnStartup: 1, // 1 = Restore last session, 5 = Open Homepage
              BookmarkBarEnabled: true,
              ShowHomeButton: true,
              IncognitoModeAvailability: 0, // 0 = Enabled, 1 = Disabled, 2 = Forced
              ManagedBookmarks: JSON.stringify([
                { "name": "IT Support", "url": "https://support.example.com" },
                { "name": "Company Portal", "url": "https://portal.example.com" }
              ])
            }
          },
          zoom: {
            app_name: "Zoom",
            description: "Common configuration options for Zoom Client for IT administrators.",
            config: {
              SyncMeetingToCalendar: true,
              DisableVideoOnJoin: true,
              DisableAudioOnJoin: true,
              DisableFaceBeauty: false,
              MuteAudioOnJoin: true,
              AutoSSOLogin: true,
              SSO_URL: "example.zoom.us"
            }
          },
          teams: {
            app_name: "Microsoft Teams",
            description: "Microsoft Teams configuration settings.",
            config: {
              AutoStart: true,
              OpenAsHidden: true,
              DisableGpu: false,
              RegisterAsIMProvider: true
            }
          }
        }
      };
    }

    case "get_api_coverage": {
      const areas: Record<string, RegExp> = {
        devices:        /^(get_device|list_devices|create_device|update_device|delete_device|lock_device|wipe_device|sync_device|restart_device|shutdown_device|unenroll_device|clear_|update_os|enable_lost|disable_lost|play_lost|update_lost)/,
        recovery:       /^(rotate_|set_admin_password|clear_firmware|clear_recovery|get_activation_lock)/,
        cellular:       /cellular/,
        messaging:      /message/,
        activation_lock:/activation_lock/,
        profiles:       /(profile|declaration)/,
        apps:           /app/,
        groups:         /assignment_group|group/,
        attributes:     /attribute/,
        scripts:        /script/,
      };
      const counts: Record<string, number> = {};
      for (const [area, re] of Object.entries(areas)) {
        counts[area] = TOOLS.filter(t => re.test(t.name)).length;
      }
      return {
        total_tools: TOOLS.length,
        write_tools: TOOLS.filter(t => WRITE_TOOLS.has(t.name)).length,
        read_tools: TOOLS.filter(t => !WRITE_TOOLS.has(t.name)).length,
        coverage_by_area: counts,
        note: "Static coverage derived from registered tools; does not probe the live SimpleMDM API.",
      };
    }

    case "check_for_update": {
      const REPO = "hov172/SimpleMDM-MCP";
      const current = PKG_VERSION;
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { "User-Agent": "simplemdm-mcp", "Accept": "application/vnd.github+json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { error: `GitHub releases API returned ${res.status}`, current_version: current };
        const rel = await res.json() as { tag_name?: string; html_url?: string; published_at?: string };
        const latest = String(rel.tag_name ?? "").replace(/^v/, "");
        if (!latest) return { error: "Could not read the latest release tag", current_version: current };
        const update_available = compareVersions(latest, current) > 0;
        return {
          current_version: current,
          latest_version: latest,
          update_available,
          release_url: rel.html_url,
          published_at: rel.published_at,
          message: update_available
            ? `Update available: ${current} → ${latest}.`
            : `Up to date (running ${current}).`,
          // The server runs in a pinned, read-only Docker container and cannot update
          // itself; surface the host-side upgrade steps instead.
          upgrade: update_available ? {
            note: "Run on the host (the container cannot self-update). NOTE: repo history was rewritten at v0.30.4 — clones from before that must use fetch+reset (or re-clone); a plain `git pull` will fail on divergent histories:",
            steps: [
              "git -C <repo> fetch origin && git -C <repo> reset --hard origin/main",
              `docker build --build-arg VERSION=${latest} -t simplemdm-mcp:${latest} -t simplemdm-mcp:latest <repo>`,
              `point the MCP client config image at simplemdm-mcp:${latest}`,
              "stop the running simplemdm container, then reconnect the MCP server",
            ],
          } : undefined,
        };
      } catch (e) {
        return { error: `Update check failed: ${formatError(e)}`, current_version: current };
      }
    }

    // ── Unified Report Engine (in-process) ──────────────────────────────────
    case "generate_report": {
      const report = String(args.report ?? "");
      const scopeArg = (args.scope ?? {}) as Record<string, unknown>;
      const format = String(args.format ?? "all") as "csv" | "md" | "docx" | "all";
      const reportOnly = args.report_only === true;

      // Validate format against the engine's enum (parity with the CLI's --format guard).
      if (!["csv", "md", "docx", "all"].includes(format)) {
        return { error: `Invalid format "${format}" (csv|md|docx|all)` };
      }

      // ── Mode dispatch: exactly one of `report` (catalog) or `spec` (dynamic) ──
      const hasSpec = args.spec != null;
      const hasReport = args.report != null;
      if (hasSpec && hasReport) {
        return { error: "Provide exactly one of `report` (catalog mode) or `spec` (dynamic mode), not both." };
      }
      if (!hasSpec && !hasReport) {
        return { error: "Provide either `report` (catalog mode: audit/inventory/logs with a scope) or `spec` (dynamic mode)." };
      }

      // ── Dynamic mode: declarative spec over a dataAdapter ────────────────────
      if (hasSpec) {
        const specErr = validateDynamicSpec(args.spec);
        if (specErr) return { error: specErr };
        const spec = args.spec as unknown as DynamicReportSpec;

        let rows: unknown[];
        try {
          // Inject the cached, write-invalidated collectDevices() so repeated reports
          // (within SIMPLEMDM_CACHE_TTL_MS) reuse the fleet instead of re-paginating /devices.
          const source = new ServerDataSource(simpleMDM, undefined, undefined, collectDevices);
          rows = await adapterRows(source, spec.dataAdapter);
        } catch (e) {
          return { error: `dynamic report fetch failed: ${formatError(e)}` };
        }

        const ts = new Date();
        const dDate = ts.toISOString().slice(0, 10).replace(/-/g, "");
        const dTime = ts.toISOString().slice(11, 19).replace(/:/g, "");
        const dynOutDir = resolveReportPath(`reports/dynamic-${dDate}-${dTime}`);
        const dynResult = await buildDynamicDossier(spec, { rows }).write(dynOutDir, { format, reportOnly });
        // Always-on bundle artifacts (manifest.sha256, <dir>.zip; xlsx if a report-table exists).
        if (format === "all") {
          const extras = writeReportExtras(dynOutDir);
          dynResult.files.push(...extras.files.map((f) => ({ name: f.name, description: f.description, rows: null, sha256: "" })));
          dynResult.skipped.push(...extras.skipped);
        }
        return dynResult;
      }

      // Map scope object → LegacySelector; enforce confirm-all for whole-fleet.
      type LegacySelector =
        | { kind: "serial"; value: string[] }
        | { kind: "group"; value: string }
        | { kind: "last-seen"; value: number }
        | { kind: "all"; value: true }
        | null;

      // At most one selector key may be present (parity with the CLI, which rejects >1).
      // confirm_all is a modifier for `all`, not a selector, so it is excluded here.
      const SELECTOR_KEYS = ["serials", "group", "last_seen", "all", "search"];
      const present = SELECTOR_KEYS.filter((k) => scopeArg[k] != null && scopeArg[k] !== false);
      if (present.length > 1) {
        return {
          error: `Use at most one selector: serials | group | last_seen | all | search (got: ${present.join(", ")})`,
        };
      }

      let scope: LegacySelector;
      let search: string | null = null;

      if (scopeArg.serials != null) {
        const serials = (Array.isArray(scopeArg.serials)
          ? (scopeArg.serials as unknown[])
          : [scopeArg.serials])
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!serials.length) {
          return { error: "serials must contain at least one serial number" };
        }
        scope = { kind: "serial", value: serials };
      } else if (scopeArg.group != null) {
        const group = String(scopeArg.group).trim();
        if (!group) return { error: "group must be a non-empty group name" };
        scope = { kind: "group", value: group };
      } else if (scopeArg.last_seen != null) {
        const v = Number(scopeArg.last_seen);
        if (!Number.isInteger(v) || v < 1) {
          return { error: "last_seen must be a positive integer (number of days)" };
        }
        scope = { kind: "last-seen", value: v };
      } else if (scopeArg.all === true) {
        if (scopeArg.confirm_all !== true) {
          return {
            error: "Whole-fleet report requires confirm_all: true in the scope object. " +
              "This fetches per-device data for every enrolled device — potentially hundreds of API calls. " +
              "Pass scope: {all: true, confirm_all: true} to proceed.",
          };
        }
        scope = { kind: "all", value: true };
      } else if (scopeArg.search != null) {
        // search is an inventory-only post-fetch filter; reject it for other reports
        // instead of silently ignoring it (audit) or throwing a raw fetch error (logs).
        if (report !== "inventory") {
          return {
            error: `search scope is only supported for the inventory report (got report="${report}"). ` +
              "Use serials, group, last_seen, or all for audit/logs.",
          };
        }
        scope = null; // no device selector; filter applied post-fetch
        search = String(scopeArg.search);
      } else {
        return {
          error: "scope must be one of: {serials:[...]}, {group:\"...\"}, {last_seen:N}, {all:true,confirm_all:true}, or {search:\"...\"} (inventory only)",
        };
      }

      const now = new Date();
      const date = now.toISOString().slice(0, 10).replace(/-/g, "");
      const time = now.toISOString().slice(11, 19).replace(/:/g, "");
      const outDir = resolveReportPath(`reports/${report}-${date}-${time}`);

      return runReport({ report, scope, format, reportOnly, outDir, search });
    }

    case "get_write_audit_log": {
      const entries = readAuditEntries(auditDir(), {
        since: args.since as string | undefined,
        tool: args.tool as string | undefined,
        tier: args.tier as string | undefined,
        phase: args.phase as string | undefined,
        outcome: args.outcome as string | undefined,
        limit: args.limit as number | undefined,
      });
      return { entries, count: entries.length, audit_dir: auditDir() };
    }

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Tool annotations (applied once at startup) ───────────────────────────────
// MCP spec annotations inform clients how to render/guard each tool. A tool is
// a write if its handler calls requireWrites(); DESTRUCTIVE is a subset flagged
// for extra client confirmation.

export const WRITE_TOOLS = new Set<string>([
  "update_account",
  "create_device", "update_device", "delete_device", "delete_device_user",
  "lock_device", "wipe_device", "sync_device", "refresh_device_inventory", "disable_activation_lock", "push_message", "restart_device", "shutdown_device", "refresh_cellular_plans",
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
  "create_safari_bookmarks_declaration",
  "assign_declaration_to_device", "unassign_declaration_from_device",
  "assign_profile_to_device", "unassign_profile_from_device",
  "sync_dep_server",
  "send_enrollment_invitation", "delete_enrollment",
  "create_managed_app_config", "delete_managed_app_config", "push_managed_app_configs",
  "set_managed_app_config_schema",
  "request_munkireport_sync", "refresh_munkireport_supplemental", "push_munkireport_findings",
  "create_script", "update_script", "delete_script",
  "create_script_job", "cancel_script_job",
]);

// Derived from WRITE_TIERS — "critical" is the single source of truth for
// destructiveHint. See src/safety/tiers.ts.
const DESTRUCTIVE = new Set<string>(
  Object.entries(WRITE_TIERS).filter(([, t]) => t === "critical").map(([n]) => n)
);

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
  if (isWrite) {
    // Spec §1.1: the tier is part of every write tool's advertised metadata.
    t.description = `${t.description} [risk tier: ${WRITE_TIERS[t.name]}]`;
    const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ??= {};
    props.dry_run ??= { type: "boolean", description: "Preview only: return a plan of what would change without executing. Audited, never calls the SimpleMDM write API." };
    props.confirm_token ??= { type: "string", description: "Single-use token from a prior planning call, required to execute high/critical-tier writes when confirm mode is on. Bound to these exact arguments." };
  }
}

// ─── Resources (canonical report URIs) ────────────────────────────────────────

export const RESOURCES = [
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

export const PROMPTS = [
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
    description: "Verify and remediate onboarding gaps with the gated write workflow: assign groups and profiles, sync apps, refresh inventory (dry-run + confirm-token gated).",
    arguments: [
      { name: "device_ref", description: "Device ID or serial number of the newly enrolled device.", required: true },
    ],
  },
  {
    name: "device-offboarding",
    description: "Offboard a device with the gated write workflow: unscope groups/profiles, then lock or wipe (dry-run + confirm-token gated), verify, and report recovery notes.",
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
    description: "Find stale devices and remediate with the gated write workflow: sync borderline, lock long-stale (dry-run + confirm-token gated); never unenrolls or wipes.",
    arguments: [
      { name: "days", description: "Number of days since last check-in to consider stale. Default 14.", required: false },
    ],
  },
  {
    name: "compliance-violators-remediation",
    description: "Remediate compliance violators with the gated write workflow: update OS, assign profiles, clear passcodes by category (dry-run + confirm-token gated); escalates manual re-enrollment cases.",
    arguments: [
      { name: "max_os_major_lag", description: "Major versions behind to count as out-of-date. Default 1.", required: false },
    ],
  },
  {
    name: "profile-coverage-remediation",
    description: "Close profile coverage gaps with the gated write workflow: assign to groups (bulk) or devices (per-device), sync profiles (dry-run + confirm-token gated); fully reversible.",
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
  {
    name: "configure-webhooks-guide",
    description: "Guidance and walkthrough for manually configuring, securing, and testing SimpleMDM webhooks via the admin web console.",
    arguments: [],
  },
  {
    name: "lost-device-response",
    description: "Lost/stolen device response with the gated write workflow: enable Lost Mode, locate, optionally lock; wipe only on explicit user demand. Includes escalation and recovery guidance.",
    arguments: [
      { name: "device_ref", description: "Device ID or serial number of the lost/stolen device.", required: true },
    ],
  },
  {
    name: "emergency-patching",
    description: "Emergency OS patching with the gated write workflow: identify vulnerable devices, stage update_os pushes (dry-run + confirm-token gated), verify uptake.",
    arguments: [
      { name: "platform", description: "Platform to patch: mac, ios, or ipad.", required: true },
      { name: "max_major_lag", description: "Major versions behind to target. Default 1.", required: false },
    ],
  },
  {
    name: "semester-refresh",
    description: "Education semester refresh for one assignment group with the gated write workflow: re-baseline profiles and apps, refresh inventory, verify coverage.",
    arguments: [
      { name: "group", description: "Assignment group name to refresh (e.g. a lab or cohort).", required: true },
    ],
  },
  {
    name: "lab-provisioning",
    description: "Provision a lab cohort with the gated write workflow: ensure the assignment group exists, assign profiles/apps, push, and verify coverage.",
    arguments: [
      { name: "group", description: "Assignment group name for the lab cohort.", required: true },
      { name: "profile_ids", description: "Comma-separated profile IDs to assign. Optional.", required: false },
      { name: "app_ids", description: "Comma-separated app IDs to assign. Optional.", required: false },
    ],
  },
];

// Shared gated-write protocol appended to every write-capable prompt body.
// The 7-step order and the dry_run/confirm_token references are lint-enforced
// by test/gatedPrompts.test.mjs for every GATED_PROMPTS member.
const GATED_WORKFLOW_RULES = `
Follow the gated write protocol, in this exact order:
1. PLAN — enumerate the exact target devices/objects with read tools only; no writes yet.
2. DRY-RUN — call each intended write tool with dry_run: true and collect the returned plan objects.
3. PRESENT — show the user one consolidated plan: targets, risk tiers, and exactly what will change.
4. CONFIRM — wait for the user to explicitly approve (they must type CONFIRM). For high/critical-tier tools the first real call returns write_gate: "confirmation_required" with a single-use confirm_token; re-call with the identical arguments plus confirm_token to execute. Never proceed on inferred consent; never reuse a token.
5. EXECUTE — run the writes in the stated order; stop on the first unexpected failure and report it before continuing.
6. VERIFY — re-query state with read tools to prove each change landed.
7. REPORT — summarize outcomes (get_write_audit_log has the audit trail) and restate the RECOVERY notes for anything irreversible.`;

export const GATED_PROMPTS = new Set<string>([
  "device-offboarding",
  "new-device-onboarding",
  "stale-devices-cleanup",
  "compliance-violators-remediation",
  "profile-coverage-remediation",
  "lost-device-response",
  "emergency-patching",
  "semester-refresh",
  "lab-provisioning",
]);

export function promptBody(name: string, args: Record<string, string> | undefined): string {
  const a = args ?? {};
  switch (name) {
    case "fleet-health-dashboard":
      return "Give me a fleet health dashboard. Call get_fleet_summary, get_security_posture, get_certificate_expiration_audit, and get_dep_token_audit in parallel. Then summarize: total devices, enrolled/unenrolled split, supervised and DEP percentages, FileVault enablement rate, OS major-version distribution, APNs push certificate expiration status, DEP server token expiration status (flag any in renew_now/expired bands), and any obvious posture outliers. End with up to 3 concrete recommendations.";
    case "configure-webhooks-guide":
      return "Provide a comprehensive guide on manually configuring, securing, and testing SimpleMDM Webhooks. Explain that because the SimpleMDM REST API doesn't support webhook CRUD operations, webhooks must be created in the SimpleMDM admin portal under Settings > Webhooks. Describe how to secure webhook endpoints using a shared query parameter token (e.g. ?token=secret) and validate payload schemas using the verify_webhook_payload tool.";
    case "security-audit":
      return "Run a full security audit. Call get_security_posture. For each posture metric below 80%, note it as an outlier. Specifically check: supervised, dep_enrolled, filevault_enabled, firmware_password, recovery_lock_password, activation_lock, user_approved_mdm, passcode_compliant. For macOS specifically, if FileVault enablement is under 80%, list the Macs that are off (call the simplemdm://reports/filevault resource). End with a prioritized remediation plan.";
    case "new-device-onboarding":
      return `Verify onboarding for ${a.device_ref || "the specified device"} and remediate gaps with the gated write protocol below.
Workflow specifics:
- PLAN with get_device_full_profile (device_id or serial_number = ${a.device_ref || "{device_ref}"}): assigned profiles, installed vs pending managed apps, group memberships, supervised/DEP status, last 5 MDM commands. Flag anything unusual.
- Intended writes (only for gaps found): assign_device_to_group for a missing expected group; sync_device to re-push assigned apps; refresh_device_inventory to force fresh inventory. If no gaps, report healthy and stop after step 3.
- VERIFY by re-calling get_device_full_profile after check-in: pending apps shrinking, groups correct.
RECOVERY: all onboarding writes are reversible or repeatable (unassign_device_from_group reverses grouping; syncs/refreshes are idempotent).
${GATED_WORKFLOW_RULES}`;
    case "device-offboarding":
      return `Offboard ${a.device_ref || "the specified device"} using the gated write protocol below.
Workflow specifics:
- PLAN with get_device_full_profile (device_id or serial_number = ${a.device_ref || "{device_ref}"}): capture assignment groups, directly assigned profiles, installed managed apps, and pending MDM commands.
- Intended writes, in order: unassign_device_from_group for each group; unassign_profile_from_device for each directly assigned profile; then exactly ONE of lock_device (recoverable) or wipe_device (irreversible) — ask the user which end-state they want BEFORE the dry-run pass.
- VERIFY by re-calling get_device_full_profile: removed groups gone, profiles unassigned, and the lock/wipe command visible in the recent command log.
RECOVERY: group and profile unassignments are reversible (assign_device_to_group / assign_profile_to_device). A lock is reversible via the lock PIN or clear_passcode. A wipe is NOT reversible — the device returns to Setup Assistant and must re-enroll via DEP; if Activation Lock is enabled, the prior user's Apple ID may still be required.
${GATED_WORKFLOW_RULES}`;
    case "patch-compliance-review":
      return "Review OS version distribution. Call get_fleet_summary and inspect os_version_breakdown. Identify the latest macOS, iOS, iPadOS major version observed. List device counts that are more than one major version behind each, and summarize patch risk. Recommend which device groups to prioritize for update_os.";
    case "stale-devices-cleanup": {
      const days = a.days || "14";
      return `Clean up stale devices using the gated write protocol below.
Workflow specifics:
- PLAN with get_stale_devices (days=${days}); group results by OS major version and staleness age.
- Intended writes per device: sync_device for borderline cases (under 30 days); lock_device (high tier) only past 30 days. NEVER propose unenroll_device or wipe_device in this workflow — flag candidates for the user to handle in device-offboarding instead.
- VERIFY by re-calling get_stale_devices after devices have had time to check in; report which recovered.
RECOVERY: sync_device is idempotent; a lock is reversible via the lock PIN or clear_passcode. Devices that never check in again need physical recovery or the device-offboarding workflow.
${GATED_WORKFLOW_RULES}`;
    }
    case "compliance-violators-remediation": {
      const lag = a.max_os_major_lag || "1";
      return `Remediate compliance violators using the gated write protocol below.
Workflow specifics:
- PLAN with get_compliance_violators (max_os_major_lag=${lag}); group by failure type (passcode_not_compliant, filevault_off, not_supervised, not_user_approved_mdm, os_*_majors_behind).
- Intended writes by group: update_os (high) for OS lag; assign_profile_to_device or group assignment for FileVault/profile gaps; clear_passcode (critical) ONLY for passcode failures the user explicitly selects — surface it separately in the plan. not_supervised and not_user_approved_mdm are NOT remediable via API — report them as manual re-enrollment work.
- VERIFY by re-calling get_compliance_violators and comparing counts per failure type.
RECOVERY: profile assignments are reversible (unassign_*). OS updates are NOT reversible. clear_passcode is NOT reversible — the passcode is gone and the user must set a new one at the device.
${GATED_WORKFLOW_RULES}`;
    }
    case "profile-coverage-remediation": {
      const pid = a.profile_id || "{profile_id}";
      return `Close profile coverage gaps for profile_id=${pid} using the gated write protocol below.
Workflow specifics:
- PLAN with get_devices_missing_profile (profile_id=${pid}). If more than 20 devices are missing it, plan a group-based rollout (assign_profile_to_group on an existing or new assignment group) instead of per-device calls; otherwise plan per-device assign_profile_to_device.
- Intended writes: the chosen assignment calls, then sync_profiles_in_group (group path) to push.
- VERIFY by re-calling get_devices_missing_profile: the missing list should shrink to zero (allow time for check-ins).
RECOVERY: fully reversible — unassign_profile_from_device / unassign_profile_from_group remove the assignment.
${GATED_WORKFLOW_RULES}`;
    }
    case "app-inventory-audit": {
      const limit = a.limit || "25";
      return `Run a cross-fleet app inventory audit. Call get_top_installed_apps with limit=${limit} and get_unmanaged_apps in parallel. Then: 1) flag any unmanaged app installed on more than 50% of the fleet as a strong candidate for catalog addition (so updates and configuration can be managed); 2) flag catalog apps with very low install_pct as candidates for removal or reassignment; 3) call out anything that looks like obviously legitimate Apple/Adobe/Microsoft helper processes (don't recommend managing those). End with a 5–10 item action list ranked by impact.`;
    }
    case "lost-device-response":
      return `Respond to a lost/stolen report for ${a.device_ref || "the specified device"} using the gated write protocol below.
Workflow specifics:
- PLAN with get_device_full_profile (device_id or serial_number = ${a.device_ref || "{device_ref}"}): confirm identity (name, serial, user), supervision status (Lost Mode requires supervision), last check-in, last known location if present.
- Intended writes, in order: enable_lost_mode (high — displays a return message and phone number you compose with the user); update_lost_mode_location to request a fresh location; play_lost_mode_sound if the device may be nearby. Optionally lock_device with a PIN as a second layer. wipe_device (critical) ONLY if the user explicitly declares the device unrecoverable and accepts data loss — surface it as a separate confirmation.
- VERIFY: re-check the device's lost-mode status and location responses in the command log.
RECOVERY: Lost Mode is reversible with disable_lost_mode once recovered. A wipe is NOT reversible. Escalation guidance: file a police report with the serial number; Activation Lock keeps the device unusable by others even when wiped; do NOT disable_activation_lock on a stolen device.
${GATED_WORKFLOW_RULES}`;

    case "emergency-patching": {
      const platform = a.platform || "{platform}";
      const lag = a.max_major_lag || "1";
      return `Run emergency OS patching for platform=${platform} using the gated write protocol below.
Workflow specifics:
- PLAN with get_compliance_violators (max_os_major_lag=${lag}) and get_fleet_summary: enumerate the vulnerable ${platform} devices (IDs, names, current OS). Stage the rollout: a small pilot set first, then the remainder.
- Intended writes: update_os (high tier) per target device, pilot set first.
- VERIFY: after devices check in, re-call get_fleet_summary / get_compliance_violators and report the shrinking behind-count; refresh_device_inventory on stragglers to force fresh data.
RECOVERY: OS updates are NOT reversible — that is why the pilot set goes first; a failed pilot stops the rollout. Devices with insufficient disk or battery will silently skip the update — they surface in VERIFY, not EXECUTE.
${GATED_WORKFLOW_RULES}`;
    }

    case "semester-refresh": {
      const group = a.group || "{group}";
      return `Run a semester refresh for assignment group "${group}" using the gated write protocol below.
Workflow specifics:
- PLAN: resolve the group with list_assignment_groups; enumerate its devices, assigned profiles, and apps. Confirm with the user what "refreshed" means for this cohort (profiles re-pushed, apps updated, inventory current).
- Intended writes, in order: sync_profiles_in_group to re-push the profile baseline; update_apps_in_group then push_apps_to_group for the app baseline; refresh_device_inventory (low) per device to bring analytics current.
- VERIFY: spot-check 2-3 devices with get_device_full_profile (profiles present, apps updating) and re-run the group listing.
RECOVERY: all semester-refresh writes are re-pushes of the existing baseline — repeatable and non-destructive. Nothing in this workflow removes user data.
${GATED_WORKFLOW_RULES}`;
    }

    case "lab-provisioning": {
      const group = a.group || "{group}";
      return `Provision the lab cohort "${group}" using the gated write protocol below.
Workflow specifics:
- PLAN: check whether assignment group "${group}" exists via list_assignment_groups. Parse profile_ids=${a.profile_ids || "(none given)"} and app_ids=${a.app_ids || "(none given)"}; confirm the final profile/app baseline with the user.
- Intended writes, in order: create_assignment_group if missing (medium); assign_profile_to_group per profile; assign_app_to_group per app; then push_apps_to_group and sync_profiles_in_group to deploy.
- VERIFY: get_devices_missing_profile per assigned profile should trend to zero for group members as they check in.
RECOVERY: fully reversible — unassign_profile_from_group / unassign_app_from_group undo assignments; delete_assignment_group (critical) removes the group itself if created in error.
${GATED_WORKFLOW_RULES}`;
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

export function validateArgs(toolName: string, args: Args): void {
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
    const matches = expected.some(t =>
      t === "integer" ? typeof args[key] === "number" && Number.isInteger(args[key]) : t === actual
    );
    if (!matches) {
      throw new Error(`${toolName}: argument "${key}" must be ${expected.join("|")}, got ${actual}`);
    }
  }
}

function formatError(err: unknown): string {
  if (err instanceof HttpError) return `${err.upstream} ${err.status}${err.bodyExcerpt ? `: ${err.bodyExcerpt}` : ""}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Write-safety gate (PRD v2 Phase 1) ───────────────────────────────────────
// Runs after validateArgs, before handleTool.

function auditWrite(partial: Omit<AuditEntry, "ts" | "event_id">): void {
  writeAuditEntry(auditDir(), { ts: new Date().toISOString(), event_id: randomUUID(), ...partial });
}

// Best-effort target resolution (spec §1.2): device reads go through api(),
// which is cached, so repeated plans are cheap. Unresolvable targets are
// reported as such rather than failing the plan.
async function resolvePlanTargets(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const ids = Array.isArray(args.device_ids) ? args.device_ids
    : args.device_id != null ? [args.device_id] : [];
  const targets: Array<Record<string, unknown>> = [];
  for (const id of ids.slice(0, 25)) {
    try {
      const d = await api(`/devices/${seg(id, "device_id")}`) as
        { data?: { attributes?: { name?: string; serial_number?: string } } };
      targets.push({ id, name: d?.data?.attributes?.name ?? null, serial: d?.data?.attributes?.serial_number ?? null });
    } catch {
      targets.push({ id, name: null, serial: null, unresolved: true });
    }
  }
  return targets;
}

async function buildWritePlan(name: string, tier: RiskTier, args: Args): Promise<Record<string, unknown>> {
  const tool = TOOLS.find((t) => t.name === name);
  const { confirm_token: _t, dry_run: _d, ...cleanArgs } = args as Record<string, unknown>;
  return {
    tool: name,
    tier,
    args: redactArgs(cleanArgs),
    targets: await resolvePlanTargets(cleanArgs),
    would_execute: (tool?.description?.split(" — ")[1] ?? tool?.description ?? name)
      .replace(/ \[risk tier: \w+\]$/, ""),
  };
}

// ─── Server ───────────────────────────────────────────────────────────────────

// Exported for tests only (e.g. test/findings/actionFailureWiring.test.mjs), so a test
// can drive the real CallToolRequestSchema handler in-process via an MCP SDK
// InMemoryTransport pair instead of spawning a subprocess or duplicating its logic.
export const server = new Server(
  { name: "simplemdm-mcp", version: PKG_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  // Tracks whether we got past validateArgs before a throw, so the catch block
  // below can tell a client error (bad/missing arguments -- never worth a fleet
  // finding) apart from a real operational/API failure from handleTool (which
  // onToolError should surface). Neither this flag nor onToolError changes the
  // isError:true response returned to the caller -- see the fire-and-forget
  // .catch below, identical in spirit to afterToolCall's success-path pattern.
  let pastValidation = false;
  try {
    validateArgs(name, args as Args);
    pastValidation = true;

    // ── Write-safety gate ────────────────────────────────────────────────
    if (WRITE_TOOLS.has(name) && ALLOW_WRITES) {
      const tier = WRITE_TIERS[name];
      const a = args as Record<string, unknown>;
      const argsHash = canonicalArgsHash(name, a);

      if (a.dry_run === true) {
        auditWrite({ tool: name, tier, phase: "dry_run", args: redactArgs(a), args_hash: argsHash, outcome: "success" });
        return { content: [{ type: "text", text: JSON.stringify({
          write_gate: "dry_run", ...(await buildWritePlan(name, tier, args as Args)),
          executed: false,
          instructions: "This was a dry run. Re-call without dry_run to proceed" +
            (confirmModeOn() && CONFIRM_TIERS.has(tier) ? " (a confirm token will be required)." : "."),
        }) }] };
      }

      if (confirmModeOn() && CONFIRM_TIERS.has(tier)) {
        const provided = typeof a.confirm_token === "string" ? a.confirm_token : null;
        if (!provided) {
          const { token, expires_at } = issueToken(name, argsHash, confirmTtlMs());
          auditWrite({ tool: name, tier, phase: "plan", args: redactArgs(a), args_hash: argsHash, token_id: token.slice(0, 8), outcome: "success" });
          return { content: [{ type: "text", text: JSON.stringify({
            write_gate: "confirmation_required", ...(await buildWritePlan(name, tier, args as Args)),
            executed: false, confirm_token: token, expires_at,
            instructions: `This is a ${tier}-tier write and was NOT executed. Show the user what will ` +
              "happen and get their explicit approval, then re-call this tool with the same arguments " +
              "plus confirm_token to execute. The token is single-use and bound to these exact arguments.",
          }) }] };
        }
        const verdict = redeemToken(provided, name, argsHash);
        if (!verdict.ok) {
          auditWrite({ tool: name, tier, phase: "blocked", args: redactArgs(a), args_hash: argsHash, token_id: provided.slice(0, 8), outcome: "blocked", error: verdict.reason });
          throw new Error(
            `Confirm token rejected (${verdict.reason}). Tokens are single-use, expire after ` +
            `${confirmTtlMs() / 1000}s, and are bound to the exact tool and arguments they were issued ` +
            "for. Re-call the tool without confirm_token to get a fresh plan and token.",
          );
        }
      }

      // Execute (low/medium always; high/critical with a redeemed token or confirm mode off).
      const started = Date.now();
      const { confirm_token: _ct, dry_run: _dr, ...cleanArgs } = a;
      try {
        const result = await handleTool(name, cleanArgs as Args);
        auditWrite({ tool: name, tier, phase: "execute", args: redactArgs(a), args_hash: argsHash, outcome: "success", duration_ms: Date.now() - started });
        const prefixes = INVALIDATION_MAP[name];
        if (prefixes?.length) cacheInvalidate(...prefixes);
        afterToolCall(name, result, (m) => console.error(m)).catch(() => {});
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        auditWrite({ tool: name, tier, phase: "execute", args: redactArgs(a), args_hash: argsHash, outcome: "error",
          http_status: err instanceof HttpError ? err.status : undefined,
          error: formatError(err), duration_ms: Date.now() - started });
        throw err;
      }
    }
    // ── End write-safety gate ────────────────────────────────────────────

    const result = await handleTool(name, args as Args);
    const prefixes = INVALIDATION_MAP[name];
    if (prefixes?.length) cacheInvalidate(...prefixes);
    // Fire-and-forget: findings publishing must never add latency to a
    // successful tool response or turn it into an error (afterToolCall
    // already catches every internal failure; this .catch is defense in
    // depth against something throwing synchronously before that point).
    afterToolCall(name, result, (m) => console.error(m)).catch(() => {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    // Only surface handleTool failures (operational/API errors) to the findings
    // pipeline -- not validateArgs failures (client error / bad arguments), which
    // pastValidation being false at this point identifies. Fire-and-forget, same
    // pattern as afterToolCall: never affects the error response below.
    if (pastValidation) {
      onToolError(name, args as Record<string, unknown>, err, (m) => console.error(m)).catch(() => {});
    }
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

if (process.env.SIMPLEMDM_TEST_MODE !== "true") {
  main().catch(err => {
    console.error(`Fatal: ${formatError(err)}`);
    process.exit(1);
  });
}
