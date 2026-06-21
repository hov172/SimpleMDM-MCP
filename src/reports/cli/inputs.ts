// Live input builders for the three report types.
// Each builder fetches data from the SimpleMDM API (and SOFA) using the
// legacy scripts/lib fetch functions, then assembles the typed input that
// each buildXDossier spec expects.
//
// Legacy fetch functions used:
//   scripts/lib/simplemdm.mjs — fetchAllDevices, fetchAllDevicesRaw, fetchDeviceGroups,
//     fetchAssignmentGroups, fetchAssignmentGroupsRaw, fetchAppCatalog, fetchProfilesRaw,
//     fetchDeviceLogs, fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers, flatten
//   scripts/lib/sofa.mjs — loadSofa
//
// TypeScript domain functions (no .mjs import needed):
//   src/reports/domain/sofa-eval.ts — buildMajorTables, evaluateDevice, aggregateCveDetail, summarize
//   src/reports/domain/inventory.ts — buildModelMap, assignmentAppMap, profileAssignmentMap,
//     normalizeDevice, normalizeApps, normalizeProfiles, normalizeUsers
//   src/reports/domain/inventory-render.ts — inventoryFindings
//   src/reports/domain/logs.ts — selectDevices

import { existsSync, readFileSync } from "node:fs";
import { buildMajorTables, evaluateDevice, aggregateCveDetail, summarize } from "../domain/sofa-eval.js";
import {
  buildModelMap, assignmentAppMap, profileAssignmentMap,
  normalizeDevice, normalizeApps, normalizeProfiles, normalizeUsers,
} from "../domain/inventory.js";
import { inventoryFindings } from "../domain/inventory-render.js";
import { selectDevices } from "../domain/logs.js";

export type LegacySelector =
  | { kind: "serial"; value: string[] }
  | { kind: "group"; value: string }
  | { kind: "last-seen"; value: number }
  | { kind: "all"; value: true }
  | null;

export interface Ctx {
  apiKey: string;
  cacheDir?: string;
  noNetworkCache?: boolean;
}

export function loadEnvKey(): string | null {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const nowIsoFn = () => new Date().toISOString();

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function auditInputLive(scope: LegacySelector, ctx: Ctx): Promise<any> {
  const { loadSofa } = await import("../../../scripts/lib/sofa.mjs");
  const { fetchAllDevices, fetchAllDevicesRaw, fetchDeviceGroups, fetchAssignmentGroups, flatten } =
    await import("../../../scripts/lib/simplemdm.mjs");

  const { apiKey, cacheDir = "reports/.audit-cache" } = ctx;
  const { macFeed, iosFeed } = await loadSofa(cacheDir, { noCache: ctx.noNetworkCache ?? false });
  const tables = buildMajorTables(macFeed, iosFeed);
  const groups: Map<any, string> = await fetchDeviceGroups(apiKey);

  let devices: any[];
  if (scope) {
    const raw: any[] = await fetchAllDevicesRaw(apiKey);
    const matchGroupIds = new Set<number>();
    if (scope.kind === "group") {
      const ag: Map<any, string> = await fetchAssignmentGroups(apiKey);
      const wanted = scope.value.toLowerCase();
      for (const [id, name] of [...groups, ...ag]) {
        if (String(name).toLowerCase() === wanted) matchGroupIds.add(id as number);
      }
      if (matchGroupIds.size === 0) throw new Error(`No device or assignment group named "${scope.value}"`);
    }
    const picked = selectDevices(raw, scope, matchGroupIds);
    if (picked.length === 0) throw new Error("No devices matched the selector");
    devices = picked.map((d: any) => flatten(d));
  } else {
    devices = await fetchAllDevices(apiKey);
  }
  for (const d of devices) d.device_group = groups.get(d.device_group_id) ?? "";

  const ev = devices.map((d: any) => evaluateDevice(d, tables));
  const cveDetail = aggregateCveDetail(ev, tables);
  const summary = summarize(ev, cveDetail);

  return { ev, tables, cveDetail, summary, dateStr: todayStr(), scoped: scope !== null };
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryInputOpts {
  noApps?: boolean;
  noProfiles?: boolean;
  noUsers?: boolean;
  allowPartial?: boolean;
}

export async function inventoryInputLive(
  scope: LegacySelector,
  ctx: Ctx,
  opts: InventoryInputOpts = {},
): Promise<any> {
  const {
    fetchAllDevicesRaw, fetchDeviceGroups, fetchAssignmentGroupsRaw, fetchAppCatalog,
    fetchProfilesRaw, fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers,
  } = await import("../../../scripts/lib/simplemdm.mjs");
  const { loadSofa } = await import("../../../scripts/lib/sofa.mjs");

  const { apiKey } = ctx;
  const rawDevices: any[] = await fetchAllDevicesRaw(apiKey);
  const dgMap: Map<any, string> = await fetchDeviceGroups(apiKey);
  const agRaw: any[] = await fetchAssignmentGroupsRaw(apiKey);
  const agNames = new Map<any, string>(agRaw.map((g: any) => [g.id, g.attributes?.name ?? String(g.id)]));

  let appCatalog = new Map<any, string>();
  try { appCatalog = await fetchAppCatalog(apiKey); }
  catch (e) { console.warn(`inventory: app catalog unavailable (${(e as Error).message})`); }

  let profileAssign: ReturnType<typeof profileAssignmentMap> = { byDeviceGroup: new Map(), byAssignmentGroup: new Map(), byDevice: new Map() };
  try { profileAssign = profileAssignmentMap(await fetchProfilesRaw(apiKey)); }
  catch (e) { console.warn(`inventory: profiles unavailable (${(e as Error).message})`); }

  let models = new Map<string, any>();
  try {
    const { macFeed, iosFeed } = await loadSofa("reports/.inventory-cache", { noCache: ctx.noNetworkCache ?? false });
    models = buildModelMap(macFeed, iosFeed);
  } catch (e) { console.warn(`inventory: SOFA enrichment unavailable (${(e as Error).message})`); }

  const matchGroupIds = new Set<number>();
  if (scope?.kind === "group") {
    const wanted = scope.value.toLowerCase();
    for (const [id, name] of [...dgMap, ...agNames]) {
      if (String(name).toLowerCase() === wanted) matchGroupIds.add(id as number);
    }
    if (matchGroupIds.size === 0) throw new Error(`No group named "${scope.value}"`);
  }
  const selectedRaw = scope ? selectDevices(rawDevices, scope, matchGroupIds) : rawDevices;
  if (scope && selectedRaw.length === 0) throw new Error("No devices matched the selector");

  const agApps = assignmentAppMap(agRaw, appCatalog);
  const records: any[] = selectedRaw.map((d: any) =>
    normalizeDevice(d, { dgMap, agNames, agAppsByDevice: agApps, models, profileAssign }));

  // Per-device section fetches: skip sections requested via opts, track failures.
  const failures: Array<{ serial: string; section: string; message: string }> = [];
  for (const r of records) {
    if (opts.noApps) {
      r.sections.apps = "skipped";
    } else {
      try { r.apps = normalizeApps(await fetchDeviceApps(apiKey, r.id)); r.sections.apps = "ok"; }
      catch (e) { r.sections.apps = "failed"; failures.push({ serial: r.serial, section: "apps", message: (e as Error).message ?? String(e) }); }
    }
    if (opts.noProfiles) {
      r.sections.profiles = "skipped";
    } else {
      try { r.profiles = normalizeProfiles(await fetchDeviceProfiles(apiKey, r.id)); r.sections.profiles = "ok"; }
      catch (e) { r.sections.profiles = "failed"; failures.push({ serial: r.serial, section: "profiles", message: (e as Error).message ?? String(e) }); }
    }
    if (opts.noUsers) {
      r.sections.users = "skipped";
    } else {
      try { r.users = normalizeUsers(await fetchDeviceUsers(apiKey, r.id)); r.sections.users = "ok"; }
      catch (e) { r.sections.users = "failed"; failures.push({ serial: r.serial, section: "users", message: (e as Error).message ?? String(e) }); }
    }
    r.match_reasons = "";
    r.match_status = "matched";
    r.hits = { apps: new Set(), profiles: new Set(), users: new Set() };
  }

  const findings = inventoryFindings(records);
  return { records, findings, dateStr: todayStr(), failures, rawById: new Map(selectedRaw.map((d: any) => [d.id, d])), fleetCount: rawDevices.length };
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface LogsInputOpts {
  withSecurity?: boolean;
  withInventory?: boolean;
}

export async function logsInputLive(scope: LegacySelector, ctx: Ctx, opts: LogsInputOpts = {}): Promise<any> {
  if (!scope) throw new Error("logs report requires a selector (--serial | --group | --last-seen | --all)");
  const { fetchAllDevicesRaw, fetchDeviceLogs, fetchDeviceGroups, fetchAssignmentGroups } =
    await import("../../../scripts/lib/simplemdm.mjs");

  const { apiKey } = ctx;
  const raw: any[] = await fetchAllDevicesRaw(apiKey);

  const matchGroupIds = new Set<number>();
  if (scope.kind === "group") {
    const dg: Map<any, string> = await fetchDeviceGroups(apiKey);
    const ag: Map<any, string> = await fetchAssignmentGroups(apiKey);
    const wanted = scope.value.toLowerCase();
    for (const [id, name] of [...dg, ...ag]) {
      if (String(name).toLowerCase() === wanted) matchGroupIds.add(id as number);
    }
    if (matchGroupIds.size === 0) throw new Error(`No group named "${scope.value}"`);
  }

  const selected = selectDevices(raw, scope, matchGroupIds);
  if (selected.length === 0) throw new Error("No devices matched the selector");

  let fetchDeviceApps: any, fetchDeviceProfiles: any, fetchDeviceUsers: any;
  if (opts?.withInventory) {
    ({ fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers } = await import("../../../scripts/lib/simplemdm.mjs"));
  }

  const bundles: any[] = [];
  for (const device of selected) {
    const serial: string | undefined = device.attributes?.serial_number;
    if (!serial) continue;
    try {
      const bundle: any = { device, logs: await fetchDeviceLogs(apiKey, serial) };
      if (opts?.withInventory) {
        bundle.apps = await fetchDeviceApps(apiKey, device.id);
        bundle.profiles = await fetchDeviceProfiles(apiKey, device.id);
        bundle.users = await fetchDeviceUsers(apiKey, device.id);
      }
      bundles.push(bundle);
    } catch (e) {
      console.warn(`logs: failed to fetch logs for ${serial}: ${(e as Error).message}`);
    }
  }

  let security;
  if (opts?.withSecurity) {
    const { loadSofa } = await import("../../../scripts/lib/sofa.mjs");
    const { flatten } = await import("../../../scripts/lib/simplemdm.mjs");
    const { buildMajorTables, evaluateDevice } = await import("../domain/sofa-eval.js");
    const { macFeed, iosFeed } = await loadSofa("reports/.logs-audit-cache", { noCache: ctx.noNetworkCache ?? false });
    const tables = buildMajorTables(macFeed, iosFeed);
    security = { tables, evald: bundles.map((b: any) => evaluateDevice(flatten(b.device), tables)) };
  }
  return { bundles, dateStr: todayStr(), nowIso: nowIsoFn(), security };
}
