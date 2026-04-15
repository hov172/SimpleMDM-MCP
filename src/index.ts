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
import { localApp, checkLocalApp } from "./localAppClient.js";

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
  const out: DeviceRecord[] = [];
  for await (const d of paginateDevices()) out.push(d);
  return out;
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
  // DEVICES — read
  // ══════════════════════════════════════════════════════════════════════════
  { name: "list_devices",
    description: "List and search devices. Filter by name, serial, UDID, IMEI, or MAC. Paginate with starting_after.",
    inputSchema: { type: "object", properties: {
      search: { type: "string" },
      include_awaiting_enrollment: { type: "boolean" },
      limit: { type: "number" },
      starting_after: { type: "string" },
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
    description: "List all devices that have a specific catalog app installed.",
    inputSchema: { type: "object", required: ["app_id"], properties: {
      app_id: { type: "string" },
      limit: { type: "number" },
      starting_after: { type: "string" },
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
    description: "List DEP devices registered under a DEP server.",
    inputSchema: { type: "object", required: ["dep_server_id"], properties: {
      dep_server_id: { type: "string" },
      limit: { type: "number" },
      starting_after: { type: "string" },
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
    description: "List MDM logs. Filter by serial_number to get logs for a specific device.",
    inputSchema: { type: "object", properties: {
      serial_number: { type: "string" },
      limit: { type: "number" },
      starting_after: { type: "string" },
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
    description: "List script jobs. Filter by status: pending, acknowledged, complete, failed.",
    inputSchema: { type: "object", properties: {
      status: { type: "string" },
      limit: { type: "number" },
      starting_after: { type: "string" },
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
        api(`/devices/${id}/profiles`),
        api(`/devices/${id}/installed_apps`),
        api(`/devices/${id}/users`),
        (async () => {
          const d = await devicePromise as { data?: { attributes?: { serial_number?: string } } };
          const sn = d?.data?.attributes?.serial_number;
          if (!sn) return { data: [] };
          return api(`/logs?serial_number=${encodeURIComponent(sn)}&limit=25`);
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

    // ── Devices read ─────────────────────────────────────────────────────────
    case "list_devices": return api(`/devices${qs(args, ["search", "include_awaiting_enrollment", "limit", "starting_after"])}`);
    case "get_device": return api(`/devices/${seg(args.device_id, "device_id")}`);
    case "get_device_profiles": return api(`/devices/${seg(args.device_id, "device_id")}/profiles`);
    case "get_device_installed_apps": return api(`/devices/${seg(args.device_id, "device_id")}/installed_apps`);
    case "get_device_users": return api(`/devices/${seg(args.device_id, "device_id")}/users`);
    case "get_device_logs":
    case "list_logs":
      return api(`/logs${qs(args, ["serial_number", "limit", "starting_after"])}`);
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
    case "list_assignment_groups": return api("/assignment_groups");
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
    case "list_apps": return api(`/apps?include_shared=${args.include_shared !== false}`);
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
    case "list_app_installs": return api(`/apps/${seg(args.app_id, "app_id")}/installs${qs(args, ["limit", "starting_after"])}`);

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
    case "list_custom_attributes": return api("/custom_attributes");
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
    case "list_custom_configuration_profiles": return api("/custom_configuration_profiles");
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
    case "list_custom_declarations": return api("/custom_declarations");
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
    case "list_profiles": return api("/profiles");
    case "get_profile": return api(`/profiles/${seg(args.profile_id, "profile_id")}`);
    case "assign_profile_to_device":
      requireWrites();
      return api(`/profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "POST" });
    case "unassign_profile_from_device":
      requireWrites();
      return api(`/profiles/${seg(args.profile_id, "profile_id")}/devices/${seg(args.device_id, "device_id")}`, { method: "DELETE" });

    // ── DEP servers ───────────────────────────────────────────────────────────
    case "list_dep_servers": return api("/dep_servers");
    case "get_dep_server": return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}`);
    case "sync_dep_server":
      requireWrites();
      return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/sync`, { method: "POST" });
    case "list_dep_devices": return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/dep_devices${qs(args, ["limit", "starting_after"])}`);
    case "get_dep_device": return api(`/dep_servers/${seg(args.dep_server_id, "dep_server_id")}/dep_devices/${seg(args.dep_device_id, "dep_device_id")}`);

    // ── Device groups (legacy) ────────────────────────────────────────────────
    case "list_device_groups": return api("/device_groups");
    case "get_device_group": return api(`/device_groups/${seg(args.group_id, "group_id")}`);

    // ── Enrollments ───────────────────────────────────────────────────────────
    case "list_enrollments": return api("/enrollments");
    case "get_enrollment": return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}`);
    case "send_enrollment_invitation":
      requireWrites();
      return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}/invitations`, { method: "POST", body: j({ contact: args.contact }) });
    case "delete_enrollment":
      requireWrites();
      return api(`/enrollments/${seg(args.enrollment_id, "enrollment_id")}`, { method: "DELETE" });

    // ── Managed app configs ───────────────────────────────────────────────────
    case "list_managed_app_configs": return api(`/apps/${seg(args.app_id, "app_id")}/managed_configs`);
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
    case "list_scripts": return api("/scripts");
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
    case "list_script_jobs": return api(`/script_jobs${qs(args, ["status", "limit", "starting_after"])}`);
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
  { uri: "simplemdm://inventory/devices",      name: "Device inventory",       description: "First page of the device list. For paging, call the list_devices tool with starting_after.",       mimeType: "application/json" },
  { uri: "simplemdm://inventory/assignment-groups", name: "Assignment groups", description: "Full list of assignment groups with their apps/devices/profiles.",                                  mimeType: "application/json" },
  { uri: "simplemdm://inventory/apps",         name: "App catalog",            description: "First page of the app catalog (list_apps does not paginate).",                                     mimeType: "application/json" },
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
    case "simplemdm://inventory/devices":             return handleTool("list_devices", { limit: 100 });
    case "simplemdm://inventory/assignment-groups":   return handleTool("list_assignment_groups", {});
    case "simplemdm://inventory/apps":                return handleTool("list_apps", {});
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
      return `Find devices enrolled but not checked in for over ${days} days. Use list_devices with pagination and inspect last_seen_at in get_device for candidates. Group stale devices by device_group or assignment_group, then propose remediation per group: sync_device first, escalate to lock_device only if still unreachable. Do not unenroll or wipe anything automatically.`;
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
  { name: "simplemdm-mcp", version: "0.4.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    validateArgs(name, args as Args);
    const result = await handleTool(name, args as Args);
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
