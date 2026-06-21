// CSV row builders, rollups, findings and the markdown dossier for the
// inventory report. Pure functions over normalized records.
// Ported from the legacy inventory-render lib — verbatim logic, TypeScript types.

import { compareVersions } from "./sofa-eval.js";
import type { DeviceRecord, NormalizedApp, AssignedProfileInfo } from "./inventory.js";

const onOff = (v: boolean | null | undefined): string => (v === true ? "on" : v === false ? "off" : "");
const join = (xs: string[] | null | undefined): string => (xs ?? []).join(" | ");
const short = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : "");

export const DEVICE_COLUMNS: string[] = [
  "name", "device_name", "serial", "udid", "imei", "wifi_mac", "bluetooth_mac", "ethernet_macs", "last_ip",
  "meid", "iccid", "time_zone",
  "model_id", "model_name", "release_year", "type", "arch", "os_version", "build_version", "rsr",
  "status", "dep", "uamdm", "ddm", "enrollment_channels", "enrolled_at", "seen_at",
  "storage_free_gb", "storage_total_gb", "battery_pct",
  "filevault", "recoverykey", "sip", "firewall", "supervised", "ard",
  "activation_lock", "lost_mode", "firmware_lock", "recovery_lock", "passcode_present", "passcode_compliant",
  "cloud_backup", "cloud_backup_at",
  "device_group", "assignment_groups", "custom_attributes", "match_reasons", "sections_failed",
];

export function deviceRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.map((r) => ({
    name: r.name, device_name: r.device_name, serial: r.serial, udid: r.udid, imei: r.imei,
    wifi_mac: r.wifi_mac, bluetooth_mac: r.bluetooth_mac ?? "", ethernet_macs: join(r.ethernet_macs), last_ip: r.last_ip,
    meid: r.meid ?? "", iccid: r.iccid ?? "", time_zone: r.time_zone ?? "",
    model_id: r.model_id, model_name: r.model_name, release_year: r.model_year, type: r.type, arch: r.arch,
    os_version: r.os_version, build_version: r.build_version, rsr: r.rsr ?? "",
    status: r.status, dep: onOff(r.dep), uamdm: onOff(r.uamdm), ddm: onOff(r.ddm),
    enrollment_channels: join(r.enrollment_channels),
    enrolled_at: r.enrolled_at ?? "", seen_at: r.seen_at ?? "",
    storage_free_gb: r.storage_free_gb ?? "", storage_total_gb: r.storage_total_gb ?? "", battery_pct: r.battery_pct ?? "",
    filevault: onOff(r.filevault), recoverykey: onOff(r.recoverykey), sip: onOff(r.sip),
    firewall: onOff(r.firewall), supervised: onOff(r.supervised), ard: onOff(r.ard),
    activation_lock: onOff(r.activation_lock), lost_mode: onOff(r.lost_mode),
    firmware_lock: onOff(r.firmware_lock), recovery_lock: onOff(r.recovery_lock),
    passcode_present: onOff(r.passcode_present), passcode_compliant: onOff(r.passcode_compliant),
    cloud_backup: onOff(r.cloud_backup), cloud_backup_at: r.cloud_backup_at ?? "",
    device_group: r.device_group, assignment_groups: join(r.assignment_groups),
    custom_attributes: Object.entries(r.attrs ?? {}).map(([k, v]) => `${k}=${v}`).join(" | "),
    match_reasons: r.match_reasons ?? "",
    sections_failed: Object.entries(r.sections ?? {}).filter(([, v]) => v === "failed").map(([k]) => k).join(" | "),
  }));
}

export const APP_COLUMNS: string[] = ["serial", "device", "app_name", "identifier", "version", "managed", "matched"];
export function appRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.flatMap((r) => (r.apps ?? []).map((a) => ({
    serial: r.serial, device: r.name, app_name: a.name, identifier: a.identifier, version: a.version,
    managed: a.managed ? "yes" : "no", matched: r.hits?.apps?.has(a.name) ? "yes" : "",
  })));
}

const findInstalled = (r: DeviceRecord, appName: string): NormalizedApp | undefined =>
  (r.apps ?? []).find((a) => `${a.name} ${a.identifier}`.toLowerCase().includes(appName.toLowerCase()));
const installedHas = (r: DeviceRecord, appName: string): boolean => Boolean(findInstalled(r, appName));

export const ASSIGNED_COLUMNS: string[] = ["serial", "device", "app_name", "assignment_group", "installed", "managed", "installed_as"];
export function assignedAppRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.flatMap((r) => (r.assigned_detail ?? []).map((x) => {
    const ok = r.sections?.apps === "ok";
    const hit = ok ? findInstalled(r, x.app) : null;
    return {
      serial: r.serial, device: r.name, app_name: x.app, assignment_group: x.group,
      installed: ok ? (hit ? "yes" : "no") : "unknown",
      managed: hit ? (hit.managed ? "yes" : "no") : "",
      installed_as: hit ? `${hit.name}${hit.version ? ` ${hit.version}` : ""}` : "",
    };
  }));
}

const installedProfileHas = (r: DeviceRecord, ap: AssignedProfileInfo): boolean =>
  (r.profiles ?? []).some((p) =>
    (ap.identifier && p.identifier === ap.identifier) || p.name.toLowerCase() === ap.profile.toLowerCase());

export const ASSIGNED_PROFILE_COLUMNS: string[] = ["serial", "device", "profile_name", "profile_identifier", "via", "installed"];
export function assignedProfileRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.flatMap((r) => (r.assigned_profile_detail ?? []).map((x) => ({
    serial: r.serial, device: r.name, profile_name: x.profile, profile_identifier: x.identifier, via: x.via,
    installed: r.sections?.profiles === "ok" ? (installedProfileHas(r, x) ? "yes" : "no") : "unknown",
  })));
}

export const PROFILE_COLUMNS: string[] = ["serial", "device", "profile_name", "identifier", "matched"];
export function profileRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.flatMap((r) => (r.profiles ?? []).map((p) => ({
    serial: r.serial, device: r.name, profile_name: p.name, identifier: p.identifier,
    matched: r.hits?.profiles?.has(p.name) ? "yes" : "",
  })));
}

export const USER_COLUMNS: string[] = ["serial", "device", "username", "full_name", "matched"];
export function userRows(records: DeviceRecord[]): Record<string, unknown>[] {
  return records.flatMap((r) => (r.users ?? []).map((u) => ({
    serial: r.serial, device: r.name, username: u.username, full_name: u.full_name,
    matched: r.hits?.users?.has(u.username) ? "yes" : "",
  })));
}

export const APP_CATALOG_COLUMNS: string[] = ["app_name", "identifier", "versions", "devices"];
export function appCatalogRows(records: DeviceRecord[]): Record<string, unknown>[] {
  const m = new Map<string, { app_name: string; identifier: string; versions: Set<string>; devices: Set<string> }>();
  for (const r of records) {
    for (const a of r.apps ?? []) {
      const k = a.identifier || a.name;
      if (!m.has(k)) m.set(k, { app_name: a.name, identifier: a.identifier, versions: new Set(), devices: new Set() });
      const e = m.get(k)!;
      if (a.version) e.versions.add(a.version);
      e.devices.add(r.serial);
    }
  }
  return [...m.values()]
    .map((e) => ({ app_name: e.app_name, identifier: e.identifier, versions: [...e.versions].sort().join(", "), devices: e.devices.size }))
    .sort((a, b) => (b.devices as number) - (a.devices as number));
}

export function rollupRows(
  records: DeviceRecord[],
  keyFn: (r: DeviceRecord) => string,
  label: string,
): Record<string, unknown>[] {
  const m = new Map<string, number>();
  for (const r of records) {
    const k = keyFn(r) || "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, n]) => ({ [label]: k, devices: n })).sort((a, b) => (b.devices as number) - (a.devices as number));
}

export const BY_MODEL_COLUMNS: string[] = ["model_id", "model_name", "release_year", "type", "devices"];
export function byModelRows(records: DeviceRecord[]): Record<string, unknown>[] {
  const m = new Map<string, { model_id: string; model_name: string; release_year: string; type: string; devices: number }>();
  for (const r of records) {
    const k = r.model_id || "(unknown)";
    if (!m.has(k)) m.set(k, { model_id: k, model_name: r.model_name, release_year: r.model_year, type: r.type, devices: 0 });
    m.get(k)!.devices++;
  }
  return [...m.values()].sort((a, b) => b.devices - a.devices);
}

export const FINDING_COLUMNS: string[] = ["type", "status", "serial", "name", "detail"];

export interface FindingRow {
  type: string;
  status: string;
  serial: string;
  name: string;
  detail: string;
  item?: string;
  via?: string;
}

const MAC_TYPES = new Set(["imac", "laptop", "desktop", "mac"]);

export function inventoryFindings(
  records: DeviceRecord[],
  { lowStorageGb = 10, staleDays = 90, now = Date.now() }: { lowStorageGb?: number; staleDays?: number; now?: number } = {},
): FindingRow[] {
  const out: FindingRow[] = [];
  const add = (type: string, status: string, r: DeviceRecord, detail: string, extra: Partial<FindingRow> = {}) =>
    out.push({ type, status, serial: r.serial, name: r.name, detail, ...extra });

  const byName = new Map<string, DeviceRecord[]>();
  for (const r of records) {
    if (!r.name) continue;
    byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  }
  for (const [name, rs] of byName) {
    if (rs.length > 1) for (const r of rs) add("duplicate-name", "flag", r, `${rs.length} devices share the name "${name}"`, { item: name });
  }

  const macs = records.filter((r) => MAC_TYPES.has(r.type) && r.os_version);
  const majors = new Map<string, number>();
  for (const r of macs) {
    const mj = r.os_version.split(".")[0];
    majors.set(mj, (majors.get(mj) ?? 0) + 1);
  }
  const modal = [...majors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const r of records) {
    if (r.storage_free_gb != null && r.storage_free_gb < lowStorageGb) {
      const free = `${Number(r.storage_free_gb).toFixed(1)} GB free`;
      add("low-storage", "flag", r, `${free} of ${r.storage_total_gb ?? "?"} GB`, { item: free });
    }
    const t = r.seen_at ? Date.parse(r.seen_at) : NaN;
    if (Number.isFinite(t) && now - t > staleDays * 86400000) add("stale-device", "flag", r, `last seen ${r.seen_at}`, { item: short(r.seen_at) });
    if (r.filevault === true && r.recoverykey === false) add("recovery-key-missing", "flag", r, "FileVault is on but no recovery key is escrowed");
    if (modal && MAC_TYPES.has(r.type) && r.os_version) {
      const mj = parseInt(r.os_version.split(".")[0], 10);
      if (Number.isFinite(mj) && parseInt(modal, 10) - mj > 1) add("os-outlier", "flag", r, `macOS ${r.os_version} vs fleet modal ${modal}.x`, { item: r.os_version });
    }
    for (const appName of r.assigned_apps ?? []) {
      const via = (r.assigned_detail ?? []).filter((x) => x.app === appName).map((x) => x.group).join(", ");
      if (r.sections?.apps === "ok") {
        if (!installedHas(r, appName)) add("assigned-app-missing", "flag", r, `"${appName}" is assigned via an assignment group but not installed`, { item: appName, via });
      } else if (r.sections?.apps === "failed" || r.sections?.apps === "pending") {
        add("assigned-app-missing", "unknown", r, `"${appName}" is assigned; installed-app inventory unavailable (fetch ${r.sections.apps})`, { item: appName, via });
      }
    }
    for (const ap of r.assigned_profile_detail ?? []) {
      if (r.sections?.profiles === "ok") {
        if (!installedProfileHas(r, ap)) add("assigned-profile-missing", "flag", r, `"${ap.profile}" is assigned (via ${ap.via}) but not installed`, { item: ap.profile, via: ap.via });
      } else if (r.sections?.profiles === "failed" || r.sections?.profiles === "pending") {
        add("assigned-profile-missing", "unknown", r, `"${ap.profile}" is assigned; installed-profile inventory unavailable (fetch ${r.sections.profiles})`, { item: ap.profile, via: ap.via });
      }
    }
  }
  return out;
}

const mdEsc = (v: unknown): string => String(v ?? "").replace(/\|/g, "\\|");

function mdTable(cols: string[], rows: Record<string, unknown>[]): string {
  if (!rows.length) return "_none_";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => mdEsc(r[c])).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}

const FINDING_TYPE_META: Record<string, { title: string; item?: string; via?: string }> = {
  "assigned-app-missing":     { title: "Assigned apps missing",              item: "app",         via: "via assignment group" },
  "assigned-profile-missing": { title: "Assigned profiles missing",          item: "profile",     via: "via" },
  "low-storage":              { title: "Low storage",                        item: "free space" },
  "stale-device":             { title: "Stale devices",                      item: "last seen" },
  "recovery-key-missing":     { title: "FileVault recovery key not escrowed" },
  "duplicate-name":           { title: "Duplicate device names",             item: "shared name" },
  "os-outlier":               { title: "OS outliers (>1 major behind fleet)", item: "os" },
};

function renderFindingsSection(findings: FindingRow[]): string[] {
  const out = ["## 2. ⚠ Findings\n"];
  if (!findings.length) {
    out.push("_none_\n");
    return out;
  }
  const byType = new Map<string, FindingRow[]>();
  for (const f of findings) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  out.push(mdTable(["finding", "devices", "items", "undetermined"], [...byType.entries()].map(([type, fs]) => ({
    finding: type,
    devices: new Set(fs.map((f) => f.serial)).size,
    items: fs.length,
    undetermined: fs.filter((f) => f.status === "unknown").length || "",
  }))) + "\n");
  for (const [type, fs] of byType) {
    const meta = FINDING_TYPE_META[type] ?? { title: type };
    out.push(`### ${meta.title} (${fs.length})\n`);
    const itemCol = meta.item ?? "detail";
    const cols = ["device", itemCol, ...(meta.via ? [meta.via] : [])];
    const anyUnknown = fs.some((f) => f.status === "unknown");
    if (anyUnknown) cols.push("status");
    out.push(mdTable(cols, fs.map((f) => ({
      device: `${f.name} (${f.serial})`,
      [itemCol]: meta.item ? (f.item ?? f.detail) : f.detail,
      ...(meta.via ? { [meta.via]: f.via ?? "" } : {}),
      ...(anyUnknown ? { status: f.status } : {}),
    }))) + "\n");
  }
  return out;
}

export function renderInventoryReport(
  records: DeviceRecord[],
  {
    query = null as string | null,
    scopeLabel = "",
    dateStr = "",
    findings = [] as FindingRow[],
    detail = "summary",
    failures = [] as Record<string, unknown>[],
    account = null as any,
  } = {},
): string {
  const out: string[] = [];
  out.push(`# SimpleMDM Fleet Inventory — ${dateStr}\n`);
  out.push(`> **Confidential** — contains device identifiers and user names. Local-only; delete when no longer needed.\n`);
  if (account) {
    out.push(`Account: **${mdEsc(account.name)}**${account.total != null ? ` · licenses ${account.total - (account.available ?? 0)} used of ${account.total} (${account.available ?? "?"} available)` : ""}\n`);
  }
  out.push(`Scope: ${scopeLabel}${query ? ` · Query: \`${query}\`` : ""} · Devices: **${records.length}**` +
    (failures.length ? ` · **PARTIAL** (${failures.length} failed section fetch(es))` : "") + "\n");
  const undetermined = records.filter((r) => r.match_status === "unknown");
  if (undetermined.length) {
    out.push(`> ${undetermined.length} device(s) had an **undetermined** match (data unavailable) and are included, flagged: ${undetermined.map((r) => r.serial).join(", ")}\n`);
  }

  out.push("## 1. Fleet Overview\n");
  out.push("### By Device Group\n");
  out.push(mdTable(["device_group", "devices"], rollupRows(records, (r) => r.device_group, "device_group")) + "\n");
  out.push("### By Type\n");
  out.push(mdTable(["type", "devices"], rollupRows(records, (r) => r.type, "type")) + "\n");
  out.push("### By Model\n");
  out.push(mdTable(BY_MODEL_COLUMNS, byModelRows(records)) + "\n");
  out.push("### By OS\n");
  out.push(mdTable(["os", "devices"], rollupRows(records, (r) => (r.os_version ? r.os_version.split(".")[0] + ".x" : ""), "os")) + "\n");

  const appExcluded = records.filter((r) => r.sections?.apps !== "ok").length;
  if (appExcluded) out.push(`_App catalog and app-based rollups exclude ${appExcluded} device(s) whose installed-app inventory was unavailable._\n`);

  out.push(...renderFindingsSection(findings));

  out.push("## 3. Per-Device Inventory\n");
  for (const r of records) {
    out.push(`### ${mdEsc(r.name)} (\`${r.serial}\`)\n`);
    const facts: [string, string][] = [
      ["Serial / UDID", `\`${r.serial}\` · \`${r.udid}\``],
      ["Network", `WiFi \`${r.wifi_mac}\`${r.ethernet_macs?.length ? ` · Ethernet ${r.ethernet_macs.map((m) => `\`${m}\``).join(", ")}` : ""} · last IP \`${r.last_ip}\``],
      ["Hardware", `${r.model_name || r.model_id} (\`${r.model_id}\`${r.model_year ? `, ${r.model_year}` : ""}) · ${r.type} · ${r.arch}`],
      ["Storage / battery", `${r.storage_free_gb ?? "?"} / ${r.storage_total_gb ?? "?"} GB free${r.battery_pct != null ? ` · battery ${r.battery_pct}%` : ""}`],
      ["OS", `${r.os_version} (${r.build_version})${r.rsr ? ` · RSR ${r.rsr}` : ""}`],
      ["Security", `FileVault ${onOff(r.filevault) || "n/a"} · recovery key ${onOff(r.recoverykey) || "n/a"} · SIP ${onOff(r.sip) || "n/a"} · firewall ${onOff(r.firewall) || "n/a"} · ` +
        `ARD ${onOff(r.ard) || "n/a"} · activation lock ${onOff(r.activation_lock) || "n/a"} · firmware lock ${onOff(r.firmware_lock) || "n/a"} · recovery lock ${onOff(r.recovery_lock) || "n/a"}`],
      ["Enrollment", `${r.status || "?"} · supervised ${onOff(r.supervised) || "n/a"} · DEP ${onOff(r.dep) || "n/a"} · UAMDM ${onOff(r.uamdm) || "n/a"} · DDM ${onOff(r.ddm) || "n/a"} · enrolled ${short(r.enrolled_at) || "?"}`],
      ["Last seen", short(r.seen_at) || "?"],
      ["Device group", r.device_group || "(none)"],
      [`Assignment groups (${r.assignment_groups?.length ?? 0})`, (r.assignment_groups ?? []).join(", ") || "(none)"],
    ];
    if (r.match_reasons) facts.push(["Match reasons", r.match_reasons]);
    out.push(mdTable(["field", "value"], facts.map(([field, value]) => ({ field, value }))) + "\n");
    const failed = Object.entries(r.sections ?? {}).filter(([, v]) => v === "failed").map(([k]) => k);
    if (failed.length) out.push(`> ⚠ **Incomplete:** ${failed.join(", ")} fetch failed — counts below exclude those sections.`);
    const nApps = r.apps?.length ?? "?", nProf = r.profiles?.length ?? "?", nUsers = r.users?.length ?? "?";
    out.push(`**Inventory** — ${nApps} installed apps · ${nProf} profiles · ${nUsers} local users · ` +
      `${r.assigned_apps?.length ?? 0} assigned apps · ${r.assigned_profile_detail?.length ?? 0} assigned profiles\n`);
    out.push(`**Assigned apps** (via assignment groups):\n`);
    out.push(mdTable(["app_name", "assignment_group", "installed", "managed", "installed_as"],
      assignedAppRows([r]).map(({ serial, device, ...rest }) => rest)) + "\n");
    out.push(`**Assigned profiles** (via device group / direct):\n`);
    out.push(mdTable(["profile_name", "via", "installed"],
      assignedProfileRows([r]).map(({ serial, device, profile_identifier, ...rest }) => rest)) + "\n");
    if (detail !== "summary") {
      out.push(`**Installed apps:**\n`);
      out.push(mdTable(["app_name", "identifier", "version", "managed", "matched"],
        appRows([r]).map(({ serial, device, ...rest }) => rest)) + "\n");
      if (detail === "full") {
        out.push(`**Installed profiles:**\n`);
        out.push(mdTable(["profile_name", "identifier", "matched"], profileRows([r]).map(({ serial, device, ...rest }) => rest)) + "\n");
        out.push(`**Local users:**\n`);
        out.push(mdTable(["username", "full_name", "matched"], userRows([r]).map(({ serial, device, ...rest }) => rest)) + "\n");
      }
    }
  }

  out.push("## 4. Methodology & Disclosures\n");
  out.push("- Inventory data reflects the device's last MDM check-in (`last_seen_at`), not a live poll.");
  out.push("- Assigned-vs-installed app matching is a case-insensitive substring heuristic (catalog name vs installed name/bundle id); profile matching uses the exact profile identifier when available, else name equality.");
  out.push("- Assigned \"apps\" include installer packages and scripts; pkg-type payloads may never appear in the installed-app inventory under their catalog name, so `installed: no` can mean \"unmatchable\" rather than genuinely missing for those.");
  out.push("- Dossier dates are shortened to YYYY-MM-DD for readability; full ISO timestamps are preserved in the CSVs.");
  out.push("- Assigned apps come from assignment groups; assigned profiles come from device-group and direct-device profile assignments.");
  out.push("- Findings with status `unknown` could not be decided because a per-device fetch failed; they are never asserted.");
  out.push("- FileVault recovery keys are never written to any output; only the escrowed yes/no fact is reported.");
  if (failures.length) {
    out.push("\n### Failed section fetches\n");
    out.push(mdTable(["serial", "section", "message"], failures) + "\n");
  }
  return out.join("\n");
}

// ── Additional exports for completeness (roster/flat styles) ─────────────────

const SORT_GETTERS: Record<string, (r: DeviceRecord) => string> = {
  seen: (r) => r.seen_at ?? "", name: (r) => (r.name ?? "").toLowerCase(), serial: (r) => r.serial ?? "",
  model: (r) => r.model_id ?? "", group: (r) => (r.device_group ?? "").toLowerCase(), year: (r) => r.model_year ?? "",
};

export function sortRecords(records: DeviceRecord[], sort: { field: string; dir: string } | null): DeviceRecord[] {
  const rows = [...records];
  if (!sort) {
    return rows.sort((a, b) =>
      SORT_GETTERS.group(a).localeCompare(SORT_GETTERS.group(b)) ||
      String(SORT_GETTERS.seen(a)).localeCompare(String(SORT_GETTERS.seen(b))));
  }
  const sgn = sort.dir === "desc" ? -1 : 1;
  if (sort.field === "os") {
    return rows.sort((a, b) => sgn * compareVersions(a.os_version || "0", b.os_version || "0") || (a.serial ?? "").localeCompare(b.serial ?? ""));
  }
  const get = SORT_GETTERS[sort.field];
  return rows.sort((a, b) => sgn * String(get(a)).localeCompare(String(get(b))) || (a.serial ?? "").localeCompare(b.serial ?? ""));
}

function rosterCells(r: DeviceRecord): Record<string, unknown> {
  return {
    model_id: r.model_id, model_name: r.model_name || "—", release_year: r.model_year || "—",
    device_name: r.name, serial: r.serial,
    users: r.sections?.users === "ok" ? ((r.users ?? []).map((u) => u.full_name || u.username).join(", ") || "—") : "—",
    assignment_groups: (r.assignment_groups ?? []).join(", ") || "—",
    os: r.os_version, last_seen: short(r.seen_at) || "—",
  };
}

function rosterGroups(records: DeviceRecord[]): [string, DeviceRecord[]][] {
  const byGroup = new Map<string, DeviceRecord[]>();
  for (const r of records) {
    const g = r.device_group || "(no device group)";
    byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  return [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);
}

export function rosterTableRows(records: DeviceRecord[], sort: { field: string; dir: string } | null = null): Record<string, unknown>[] {
  return rosterGroups(records).flatMap(([g, rs]) =>
    sortRecords(rs, sort ?? { field: "seen", dir: "asc" }).map((r) => ({ ...rosterCells(r), device_group: g })));
}

export function renderInventoryRoster(
  records: DeviceRecord[],
  { query = null as string | null, scopeLabel = "", dateStr = "", failures = [] as Record<string, unknown>[], account = null as any, sort = null as { field: string; dir: string } | null } = {},
): string {
  const out: string[] = [];
  out.push(`# SimpleMDM Device Roster — ${dateStr}\n`);
  out.push(`> **Confidential** — contains device identifiers and user names. Local-only; delete when no longer needed.\n`);
  if (account) {
    out.push(`Account: **${mdEsc(account.name)}**${account.total != null ? ` · licenses ${account.total - (account.available ?? 0)} used of ${account.total}` : ""}\n`);
  }
  out.push(`Scope: ${scopeLabel}${query ? ` · Query: \`${query}\`` : ""} · Devices: **${records.length}**` +
    (failures.length ? ` · **PARTIAL** (${failures.length} failed section fetch(es))` : "") + "\n");
  out.push("## Summary — by Device Group\n");
  const groupRollup = rollupRows(records, (r) => r.device_group, "device_group");
  out.push(mdTable(["device_group", "devices"], [...groupRollup, { device_group: "**Total**", devices: `**${records.length}**` }]) + "\n");
  out.push("## Breakdown by Device Type\n");
  out.push(mdTable(["type", "devices"], rollupRows(records, (r) => r.type, "type")) + "\n");
  out.push("### By type and model\n");
  const models = [...byModelRows(records)].sort((a, b) => {
    const at = a.type as string, bt = b.type as string;
    return at < bt ? -1 : at > bt ? 1 : (b.devices as number) - (a.devices as number);
  });
  out.push(mdTable(["type", "model_id", "model_name", "release_year", "devices"], models) + "\n");
  for (const [g, rs] of rosterGroups(records)) {
    out.push(`## ${mdEsc(g)} (${rs.length})\n`);
    const rows = sortRecords(rs, sort ?? { field: "seen", dir: "asc" });
    out.push(mdTable(["model_id", "model_name", "release_year", "device_name", "serial", "users", "assignment_groups", "os", "last_seen"],
      rows.map(rosterCells)) + "\n");
  }
  if (failures.length) {
    out.push("### Failed section fetches\n");
    out.push(mdTable(["serial", "section", "message"], failures) + "\n");
  }
  out.push(`_Generated ${dateStr} by simplemdm-mcp /inventory (roster style). Full data in the accompanying CSVs; integrity hashes in manifest.sha256._`);
  return out.join("\n");
}

export const FLAT_COLUMNS: string[] = ["model_id", "model_name", "release_year", "device_group", "device_name", "serial", "users", "assignment_groups", "os", "last_seen"];
export function flatTableRows(records: DeviceRecord[], sort: { field: string; dir: string } | null = null): Record<string, unknown>[] {
  return sortRecords(records, sort).map((r) => ({ ...rosterCells(r), device_group: r.device_group || "(none)" }));
}
export function renderInventoryFlat(
  records: DeviceRecord[],
  { query = null as string | null, scopeLabel = "", dateStr = "", failures = [] as Record<string, unknown>[], account = null as any, sort = null as { field: string; dir: string } | null } = {},
): string {
  const out: string[] = [];
  out.push(`# SimpleMDM Device Inventory (flat) — ${dateStr}\n`);
  out.push(`> **Confidential** — contains device identifiers and user names. Local-only; delete when no longer needed.\n`);
  if (account) {
    out.push(`Account: **${mdEsc(account.name)}**${account.total != null ? ` · licenses ${account.total - (account.available ?? 0)} used of ${account.total}` : ""}\n`);
  }
  out.push(`Scope: ${scopeLabel}${query ? ` · Query: \`${query}\`` : ""} · Devices: **${records.length}**` +
    (failures.length ? ` · **PARTIAL** (${failures.length} failed section fetch(es))` : "") + "\n");
  out.push(mdTable(FLAT_COLUMNS, flatTableRows(records, sort)) + "\n");
  if (failures.length) {
    out.push("### Failed section fetches\n");
    out.push(mdTable(["serial", "section", "message"], failures) + "\n");
  }
  out.push(`_Generated ${dateStr} by simplemdm-mcp /inventory (flat style). Full data in the accompanying CSVs; integrity hashes in manifest.sha256._`);
  return out.join("\n");
}
