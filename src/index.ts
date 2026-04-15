#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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

if (!USE_LOCAL_APP && !API_KEY) {
  console.error("ERROR: SIMPLEMDM_API_KEY is required unless LOCAL_APP_MODE=true.");
  process.exit(1);
}
if (USE_LOCAL_APP) await checkLocalApp();

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function simpleMDM(path: string, opts: RequestInit = {}): Promise<unknown> {
  const creds = Buffer.from(`${API_KEY}:`).toString("base64");
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SimpleMDM ${res.status}: ${await res.text()}`);
  // 204 No Content — return success object
  if (res.status === 204) return { success: true };
  return res.json();
}

async function munkiReport(route: string): Promise<unknown> {
  if (!MR_BASE) throw new Error("MunkiReport not configured — set MUNKIREPORT_BASE_URL.");
  const headers: Record<string, string> = {};
  if (MR_COOKIE) headers["Cookie"] = MR_COOKIE;
  if (MR_HNAME)  headers[MR_HNAME] = MR_HVALUE || API_KEY;
  const res = await fetch(`${MR_BASE}${MR_PREFIX}${route}`, { headers });
  if (!res.ok) throw new Error(`MunkiReport ${res.status}: ${await res.text()}`);
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
    description: "Derived fleet KPIs: total devices, enrolled/unenrolled counts, supervised/DEP/FileVault posture counts, and OS version breakdown. In local app mode this is instant.",
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
      include_shared: { type: "boolean" },
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
      type Page = { data: Array<{ id: string; attributes: { enrollment_status: string; os_version: string; is_supervised: boolean; dep_enrolled: boolean; filevault_enabled: boolean } }>; has_more: boolean };
      let all: Page["data"] = [];
      let cursor = "";
      let more = true;
      while (more) {
        const p = await simpleMDM(`/devices?limit=100${cursor ? `&starting_after=${cursor}` : ""}`) as Page;
        all = all.concat(p.data);
        more = p.has_more;
        cursor = p.data.at(-1)?.id ?? "";
      }
      const enrolled = all.filter(d => d.attributes.enrollment_status === "enrolled").length;
      const osCounts: Record<string, number> = {};
      for (const d of all) { const v = d.attributes.os_version || "unknown"; osCounts[v] = (osCounts[v] ?? 0) + 1; }
      return {
        total: all.length, enrolled, unenrolled: all.length - enrolled,
        posture: {
          supervised: all.filter(d => d.attributes.is_supervised).length,
          dep_enrolled: all.filter(d => d.attributes.dep_enrolled).length,
          filevault_enabled: all.filter(d => d.attributes.filevault_enabled).length,
        },
        os_version_breakdown: osCounts,
      };
    }

    // ── Devices read ─────────────────────────────────────────────────────────
    case "list_devices": return api(`/devices${qs(args, ["search", "include_awaiting_enrollment", "limit", "starting_after"])}`);
    case "get_device": return api(`/devices/${args.device_id}`);
    case "get_device_profiles": return api(`/devices/${args.device_id}/profiles`);
    case "get_device_installed_apps": return api(`/devices/${args.device_id}/installed_apps`);
    case "get_device_users": return api(`/devices/${args.device_id}/users`);
    case "get_device_logs":
    case "list_logs": {
      const p = new URLSearchParams();
      const sn = (args.serial_number ?? (name === "get_device_logs" ? args.serial_number : undefined)) as string | undefined;
      if (sn) p.set("serial_number", sn);
      if (args.limit) p.set("limit", String(args.limit));
      if (args.starting_after) p.set("starting_after", String(args.starting_after));
      const s = p.toString();
      return api(`/logs${s ? `?${s}` : ""}`);
    }
    case "get_log": return api(`/logs/${args.log_id}`);

    // ── Devices write ────────────────────────────────────────────────────────
    case "create_device":
      requireWrites();
      return api("/devices", { method: "POST", body: j({ name: args.name, group_id: args.group_id }) });
    case "update_device":
      requireWrites();
      return api(`/devices/${args.device_id}`, { method: "PATCH", body: j({ name: args.name, device_name: args.device_name }) });
    case "delete_device":
      requireWrites();
      return api(`/devices/${args.device_id}`, { method: "DELETE" });
    case "delete_device_user":
      requireWrites();
      return api(`/devices/${args.device_id}/users/${args.user_id}`, { method: "DELETE" });

    // ── Device actions ───────────────────────────────────────────────────────
    case "lock_device":
      requireWrites();
      return api(`/devices/${args.device_id}/lock`, { method: "POST", body: j({ message: args.message, pin: args.pin }) });
    case "wipe_device":
      requireWrites();
      return api(`/devices/${args.device_id}/wipe`, { method: "POST", body: j({ pin: args.pin }) });
    case "sync_device":
      requireWrites();
      return api(`/devices/${args.device_id}/push_apps`, { method: "POST" });
    case "restart_device":
      requireWrites();
      return api(`/devices/${args.device_id}/restart`, { method: "POST" });
    case "shutdown_device":
      requireWrites();
      return api(`/devices/${args.device_id}/shutdown`, { method: "POST" });
    case "unenroll_device":
      requireWrites();
      return api(`/devices/${args.device_id}/unenroll`, { method: "POST" });
    case "clear_passcode":
      requireWrites();
      return api(`/devices/${args.device_id}/clear_passcode`, { method: "POST" });
    case "clear_restrictions_password":
      requireWrites();
      return api(`/devices/${args.device_id}/clear_restrictions_password`, { method: "POST" });
    case "update_os":
      requireWrites();
      return api(`/devices/${args.device_id}/update_os`, { method: "POST" });
    case "enable_lost_mode":
      requireWrites();
      return api(`/devices/${args.device_id}/lost_mode`, { method: "POST", body: j({ message: args.message, phone_number: args.phone_number, footnote: args.footnote }) });
    case "disable_lost_mode":
      requireWrites();
      return api(`/devices/${args.device_id}/lost_mode`, { method: "DELETE" });
    case "play_lost_mode_sound":
      requireWrites();
      return api(`/devices/${args.device_id}/lost_mode/play_sound`, { method: "POST" });
    case "update_lost_mode_location":
      requireWrites();
      return api(`/devices/${args.device_id}/lost_mode/update_location`, { method: "POST" });
    case "clear_firmware_password":
      requireWrites();
      return api(`/devices/${args.device_id}/clear_firmware_password`, { method: "POST" });
    case "rotate_firmware_password":
      requireWrites();
      return api(`/devices/${args.device_id}/rotate_firmware_password`, { method: "POST" });
    case "clear_recovery_lock_password":
      requireWrites();
      return api(`/devices/${args.device_id}/clear_recovery_lock_password`, { method: "POST" });
    case "rotate_recovery_lock_password":
      requireWrites();
      return api(`/devices/${args.device_id}/rotate_recovery_lock_password`, { method: "POST" });
    case "rotate_filevault_recovery_key":
      requireWrites();
      return api(`/devices/${args.device_id}/rotate_filevault_recovery_key`, { method: "POST" });
    case "set_admin_password":
      requireWrites();
      return api(`/devices/${args.device_id}/set_admin_password`, { method: "POST", body: j({ new_password: args.new_password }) });
    case "rotate_admin_password":
      requireWrites();
      return api(`/devices/${args.device_id}/rotate_admin_password`, { method: "POST" });
    case "enable_remote_desktop":
      requireWrites();
      return api(`/devices/${args.device_id}/enable_remote_desktop`, { method: "POST" });
    case "disable_remote_desktop":
      requireWrites();
      return api(`/devices/${args.device_id}/disable_remote_desktop`, { method: "POST" });
    case "enable_bluetooth":
      requireWrites();
      return api(`/devices/${args.device_id}/enable_bluetooth`, { method: "POST" });
    case "disable_bluetooth":
      requireWrites();
      return api(`/devices/${args.device_id}/disable_bluetooth`, { method: "POST" });
    case "set_time_zone":
      requireWrites();
      return api(`/devices/${args.device_id}/set_time_zone`, { method: "POST", body: j({ time_zone: args.time_zone }) });

    // ── Assignment groups ────────────────────────────────────────────────────
    case "list_assignment_groups": return api("/assignment_groups");
    case "get_assignment_group": return api(`/assignment_groups/${args.group_id}`);
    case "create_assignment_group":
      requireWrites();
      return api("/assignment_groups", { method: "POST", body: j({ name: args.name, auto_deploy: args.auto_deploy }) });
    case "update_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}`, { method: "PATCH", body: j({ name: args.name, auto_deploy: args.auto_deploy }) });
    case "delete_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}`, { method: "DELETE" });
    case "assign_device_to_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/devices/${args.device_id}`, { method: "POST" });
    case "unassign_device_from_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/devices/${args.device_id}`, { method: "DELETE" });
    case "assign_app_to_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/apps/${args.app_id}`, { method: "POST", body: j({ deployment_type: args.deployment_type, install_type: args.install_type }) });
    case "unassign_app_from_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/apps/${args.app_id}`, { method: "DELETE" });
    case "assign_profile_to_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/profiles/${args.profile_id}`, { method: "POST" });
    case "unassign_profile_from_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/profiles/${args.profile_id}`, { method: "DELETE" });
    case "push_apps_to_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/push_apps`, { method: "POST" });
    case "update_apps_in_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/update_apps`, { method: "POST" });
    case "sync_profiles_in_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/sync_profiles`, { method: "POST" });
    case "clone_assignment_group":
      requireWrites();
      return api(`/assignment_groups/${args.group_id}/clone`, { method: "POST" });

    // ── Apps ─────────────────────────────────────────────────────────────────
    case "list_apps": return api(`/apps?include_shared=${args.include_shared !== false}`);
    case "get_app": return api(`/apps/${args.app_id}`);
    case "create_app":
      requireWrites();
      return api("/apps", { method: "POST", body: j({ app_store_id: args.app_store_id, bundle_id: args.bundle_id, name: args.name }) });
    case "update_app":
      requireWrites();
      return api(`/apps/${args.app_id}`, { method: "PATCH", body: j({ name: args.name, deploy_to: args.deploy_to }) });
    case "delete_app":
      requireWrites();
      return api(`/apps/${args.app_id}`, { method: "DELETE" });
    case "list_app_installs": return api(`/apps/${args.app_id}/installs${qs(args, ["limit", "starting_after"])}`);

    // ── Installed apps ────────────────────────────────────────────────────────
    case "get_installed_app": return api(`/installed_apps/${args.installed_app_id}`);
    case "request_app_management":
      requireWrites();
      return api(`/installed_apps/${args.installed_app_id}/request_management`, { method: "POST" });
    case "update_installed_app":
      requireWrites();
      return api(`/installed_apps/${args.installed_app_id}/update`, { method: "POST" });
    case "uninstall_app":
      requireWrites();
      return api(`/installed_apps/${args.installed_app_id}`, { method: "DELETE" });

    // ── Custom attributes ─────────────────────────────────────────────────────
    case "list_custom_attributes": return api("/custom_attributes");
    case "get_custom_attribute": return api(`/custom_attributes/${args.attribute_name}`);
    case "create_custom_attribute":
      requireWrites();
      return api("/custom_attributes", { method: "POST", body: j({ name: args.name, default_value: args.default_value }) });
    case "update_custom_attribute":
      requireWrites();
      return api(`/custom_attributes/${args.attribute_name}`, { method: "PATCH", body: j({ default_value: args.default_value }) });
    case "delete_custom_attribute":
      requireWrites();
      return api(`/custom_attributes/${args.attribute_name}`, { method: "DELETE" });
    case "get_device_attribute_values": return api(`/custom_attributes/devices/${args.device_id}`);
    case "set_device_attribute_value":
      requireWrites();
      return api(`/custom_attributes/${args.attribute_name}/devices/${args.device_id}`, { method: "PUT", body: j({ value: args.value }) });
    case "set_attribute_for_multiple_devices":
      requireWrites();
      return api(`/custom_attributes/${args.attribute_name}/devices`, { method: "PUT", body: j({ device_ids: args.device_ids, value: args.value }) });
    case "get_group_attribute_values": return api(`/custom_attributes/assignment_groups/${args.group_id}`);
    case "set_group_attribute_value":
      requireWrites();
      return api(`/custom_attributes/${args.attribute_name}/assignment_groups/${args.group_id}`, { method: "PUT", body: j({ value: args.value }) });

    // ── Custom configuration profiles ─────────────────────────────────────────
    case "list_custom_configuration_profiles": return api("/custom_configuration_profiles");
    case "create_custom_configuration_profile":
      requireWrites();
      return api("/custom_configuration_profiles", { method: "POST", body: j({ name: args.name, mobileconfig: args.mobileconfig, user_scope: args.user_scope, attribute_support: args.attribute_support }) });
    case "update_custom_configuration_profile":
      requireWrites();
      return api(`/custom_configuration_profiles/${args.profile_id}`, { method: "PATCH", body: j({ name: args.name, mobileconfig: args.mobileconfig, user_scope: args.user_scope }) });
    case "delete_custom_configuration_profile":
      requireWrites();
      return api(`/custom_configuration_profiles/${args.profile_id}`, { method: "DELETE" });
    case "assign_custom_profile_to_device":
      requireWrites();
      return api(`/custom_configuration_profiles/${args.profile_id}/devices/${args.device_id}`, { method: "POST" });
    case "unassign_custom_profile_from_device":
      requireWrites();
      return api(`/custom_configuration_profiles/${args.profile_id}/devices/${args.device_id}`, { method: "DELETE" });

    // ── Custom declarations ───────────────────────────────────────────────────
    case "list_custom_declarations": return api("/custom_declarations");
    case "get_custom_declaration": return api(`/custom_declarations/${args.declaration_id}`);
    case "create_custom_declaration":
      requireWrites();
      return api("/custom_declarations", { method: "POST", body: j({ name: args.name, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update, user_scope: args.user_scope }) });
    case "update_custom_declaration":
      requireWrites();
      return api(`/custom_declarations/${args.declaration_id}`, { method: "PATCH", body: j({ name: args.name, payload: args.payload, reinstall_after_os_update: args.reinstall_after_os_update }) });
    case "delete_custom_declaration":
      requireWrites();
      return api(`/custom_declarations/${args.declaration_id}`, { method: "DELETE" });
    case "assign_declaration_to_device":
      requireWrites();
      return api(`/custom_declarations/${args.declaration_id}/devices/${args.device_id}`, { method: "POST" });
    case "unassign_declaration_from_device":
      requireWrites();
      return api(`/custom_declarations/${args.declaration_id}/devices/${args.device_id}`, { method: "DELETE" });

    // ── Profiles ─────────────────────────────────────────────────────────────
    case "list_profiles": return api("/profiles");
    case "get_profile": return api(`/profiles/${args.profile_id}`);
    case "assign_profile_to_device":
      requireWrites();
      return api(`/profiles/${args.profile_id}/devices/${args.device_id}`, { method: "POST" });
    case "unassign_profile_from_device":
      requireWrites();
      return api(`/profiles/${args.profile_id}/devices/${args.device_id}`, { method: "DELETE" });

    // ── DEP servers ───────────────────────────────────────────────────────────
    case "list_dep_servers": return api("/dep_servers");
    case "get_dep_server": return api(`/dep_servers/${args.dep_server_id}`);
    case "sync_dep_server":
      requireWrites();
      return api(`/dep_servers/${args.dep_server_id}/sync`, { method: "POST" });
    case "list_dep_devices": return api(`/dep_servers/${args.dep_server_id}/dep_devices${qs(args, ["limit", "starting_after"])}`);
    case "get_dep_device": return api(`/dep_servers/${args.dep_server_id}/dep_devices/${args.dep_device_id}`);

    // ── Device groups (legacy) ────────────────────────────────────────────────
    case "list_device_groups": return api("/device_groups");
    case "get_device_group": return api(`/device_groups/${args.group_id}`);

    // ── Enrollments ───────────────────────────────────────────────────────────
    case "list_enrollments": return api("/enrollments");
    case "get_enrollment": return api(`/enrollments/${args.enrollment_id}`);
    case "send_enrollment_invitation":
      requireWrites();
      return api(`/enrollments/${args.enrollment_id}/invitations`, { method: "POST", body: j({ contact: args.contact }) });
    case "delete_enrollment":
      requireWrites();
      return api(`/enrollments/${args.enrollment_id}`, { method: "DELETE" });

    // ── Logs ─────────────────────────────────────────────────────────────────
    case "get_log": return api(`/logs/${args.log_id}`);

    // ── Managed app configs ───────────────────────────────────────────────────
    case "list_managed_app_configs": return api(`/apps/${args.app_id}/managed_configs`);
    case "create_managed_app_config":
      requireWrites();
      return api(`/apps/${args.app_id}/managed_configs`, { method: "POST", body: j({ key: args.key, value: args.value, kind: args.kind }) });
    case "delete_managed_app_config":
      requireWrites();
      return api(`/apps/${args.app_id}/managed_configs/${args.config_id}`, { method: "DELETE" });
    case "push_managed_app_configs":
      requireWrites();
      return api(`/apps/${args.app_id}/managed_configs/push`, { method: "POST" });

    // ── Push certificate ──────────────────────────────────────────────────────
    case "get_push_certificate": return api("/push_certificate");
    case "get_signed_csr": return api("/push_certificate/scsr");

    // ── Scripts ───────────────────────────────────────────────────────────────
    case "list_scripts": return api("/scripts");
    case "get_script": return api(`/scripts/${args.script_id}`);
    case "create_script":
      requireWrites();
      return api("/scripts", { method: "POST", body: j({ name: args.name, content: args.content }) });
    case "update_script":
      requireWrites();
      return api(`/scripts/${args.script_id}`, { method: "PATCH", body: j({ name: args.name, content: args.content }) });
    case "delete_script":
      requireWrites();
      return api(`/scripts/${args.script_id}`, { method: "DELETE" });

    // ── Script jobs ───────────────────────────────────────────────────────────
    case "list_script_jobs": return api(`/script_jobs${qs(args, ["status", "limit", "starting_after"])}`);
    case "get_script_job": return api(`/script_jobs/${args.job_id}`);
    case "create_script_job":
      requireWrites();
      return api("/script_jobs", { method: "POST", body: j({ script_id: args.script_id, device_ids: args.device_ids }) });
    case "cancel_script_job":
      requireWrites();
      return api(`/script_jobs/${args.job_id}`, { method: "DELETE" });

    // ── MunkiReport enrichment ────────────────────────────────────────────────
    case "get_munkireport_sync_health":       return USE_LOCAL_APP ? api("/enrichment/sync_health")          : munkiReport("/data/sync_health");
    case "get_munkireport_compliance":        return USE_LOCAL_APP ? api("/enrichment/compliance")            : munkiReport("/simplemdm/data/compliance_stats");
    case "get_munkireport_device_resources":  return USE_LOCAL_APP ? api(`/enrichment/device/${encodeURIComponent(String(args.serial_number))}`) : munkiReport(`/get_device_resources/${encodeURIComponent(String(args.serial_number))}`);
    case "get_munkireport_apple_care":        return USE_LOCAL_APP ? api("/enrichment/apple_care")            : munkiReport("/simplemdm/data/apple_care_stats");
    case "get_munkireport_supplemental_overview": return USE_LOCAL_APP ? api("/enrichment/supplemental_overview") : munkiReport("/simplemdm/data/supplemental_overview");

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "simplemdm-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = await handleTool(name, args as Args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
