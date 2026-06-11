// Fetch-side normalization for the inventory report: builds the searchable
// record consumed by query.mjs. Knows the SimpleMDM API shapes; knows nothing
// about query syntax.

import { LEGACY_MODELS } from "./apple-legacy-models.mjs";

export function buildModelMap(macFeed, iosFeed) {
  // Seed with the curated legacy table (pre-SOFA hardware, frozen set,
  // sourced from Apple's identify-your-model pages), then overlay SOFA —
  // anything the live feed knows wins.
  const map = new Map(Object.entries(LEGACY_MODELS).map(([id, v]) => [id, { ...v }]));
  for (const feed of [macFeed, iosFeed]) {
    for (const [id, info] of Object.entries(feed?.Models ?? {})) {
      const marketing = info?.MarketingName ?? "";
      const y = marketing.match(/\b(19|20)\d{2}\b/);
      map.set(id, { marketing, year: y ? y[0] : "" });
    }
  }
  return map;
}

export function deriveType(modelId, family = "") {
  const f = `${family} ${modelId}`.toLowerCase();
  if (f.includes("macbook")) return "laptop";
  if (f.includes("imac")) return "imac";
  if (/mac ?mini|mac ?studio|mac ?pro\b|xserve/.test(f)) return "desktop";
  if (f.includes("ipad")) return "ipad";
  if (f.includes("iphone")) return "iphone";
  if (/apple ?tv|appletv/.test(f)) return "appletv";
  if (/^mac\d/i.test(String(modelId ?? ""))) return "mac";
  return "other";
}

// profilesRaw: raw /profiles records. Profiles are assigned to device groups
// (relationships.device_groups), to assignment groups (relationships.groups —
// verified live: those ids belong to /assignment_groups), or directly to
// devices (relationships.devices).
export function profileAssignmentMap(profilesRaw) {
  const byDeviceGroup = new Map();
  const byAssignmentGroup = new Map();
  const byDevice = new Map();
  for (const p of profilesRaw ?? []) {
    const info = { profile_id: p.id, profile: p.attributes?.name ?? String(p.id), identifier: p.attributes?.profile_identifier ?? "" };
    for (const g of p.relationships?.device_groups?.data ?? []) {
      byDeviceGroup.set(g.id, [...(byDeviceGroup.get(g.id) ?? []), info]);
    }
    for (const g of p.relationships?.groups?.data ?? []) {
      byAssignmentGroup.set(g.id, [...(byAssignmentGroup.get(g.id) ?? []), info]);
    }
    for (const d of p.relationships?.devices?.data ?? []) {
      byDevice.set(d.id, [...(byDevice.get(d.id) ?? []), info]);
    }
  }
  return { byDeviceGroup, byAssignmentGroup, byDevice };
}

// agRaw: raw /assignment_groups records; appCatalog: Map app id -> name.
export function assignmentAppMap(agRaw, appCatalog) {
  const m = new Map();
  for (const g of agRaw ?? []) {
    const ids = (g.relationships?.apps?.data ?? []).map((x) => x.id);
    m.set(g.id, ids.map((id) => appCatalog.get(id)).filter(Boolean));
  }
  return m;
}

export function normalizeDevice(d, { dgMap = new Map(), agNames = new Map(), agAppsByDevice = new Map(), models = new Map(), profileAssign = { byDeviceGroup: new Map(), byAssignmentGroup: new Map(), byDevice: new Map() } } = {}) {
  const a = d.attributes ?? {};
  const attrs = {};
  for (const c of d.relationships?.custom_attribute_values?.data ?? []) attrs[c.id] = c.attributes?.value ?? null;
  const modelId = a.product_name || a.model || "";
  const m = models.get(modelId);
  const marketing = m?.marketing || a.model_name || "";
  // year from SOFA when known, else from whatever name we ended up with
  // (some SimpleMDM model_name values embed the year, e.g. "iMac (24-inch, 2023)")
  const modelYear = m?.year || (marketing.match(/\b(19|20)\d{2}\b/)?.[0] ?? "");
  const agIds = (d.relationships?.groups?.data ?? []).map((g) => g.id);
  const assignedDetail = agIds.flatMap((id) =>
    (agAppsByDevice.get(id) ?? []).map((app) => ({ app, group: agNames.get(id) ?? String(id) })));
  const dgId = d.relationships?.device_group?.data?.id;
  const assignedProfiles = new Map(); // by profile id — device-group, then assignment-group, then direct
  for (const p of profileAssign.byDeviceGroup.get(dgId) ?? []) assignedProfiles.set(p.profile_id, { ...p, via: dgMap.get(dgId) ?? "device group" });
  for (const agId of agIds) {
    for (const p of profileAssign.byAssignmentGroup?.get(agId) ?? []) {
      if (!assignedProfiles.has(p.profile_id)) assignedProfiles.set(p.profile_id, { ...p, via: agNames.get(agId) ?? String(agId) });
    }
  }
  for (const p of profileAssign.byDevice.get(d.id) ?? []) if (!assignedProfiles.has(p.profile_id)) assignedProfiles.set(p.profile_id, { ...p, via: "direct" });
  const battery = a.battery_level == null ? NaN : parseFloat(String(a.battery_level));
  return {
    id: d.id,
    name: a.name ?? "", device_name: a.device_name ?? "", serial: a.serial_number ?? "",
    udid: a.unique_identifier ?? "", imei: a.imei ?? "",
    wifi_mac: a.wifi_mac ?? "", ethernet_macs: a.ethernet_macs ?? [], last_ip: a.last_seen_ip ?? "",
    model_id: modelId, model_name: marketing, model_year: modelYear,
    type: deriveType(modelId, marketing),
    arch: a.processor_architecture ?? "",
    os_version: a.os_version ?? "", build_version: a.build_version ?? "",
    device_group: dgMap.get(dgId) ?? "",
    assignment_groups: agIds.map((id) => agNames.get(id)).filter(Boolean),
    assigned_apps: [...new Set(assignedDetail.map((x) => x.app))],
    assigned_detail: assignedDetail,
    assigned_profile_detail: [...assignedProfiles.values()],
    seen_at: a.last_seen_at ?? null, enrolled_at: a.enrolled_at ?? null,
    storage_total_gb: a.device_capacity ?? null, storage_free_gb: a.available_device_capacity ?? null,
    battery_pct: Number.isFinite(battery) ? battery : null,
    filevault: a.filevault_enabled ?? null,
    // never carry the key itself — only the escrowed fact (null = posture unknown, e.g. iPad)
    recoverykey: a.filevault_enabled == null ? null : Boolean(a.filevault_recovery_key),
    sip: a.system_integrity_protection_enabled ?? null,
    firewall: a.firewall?.enabled ?? null,
    supervised: a.is_supervised ?? null,
    dep: a.is_dep_enrollment ?? null,
    status: a.status ?? "",
    ard: a.remote_desktop_enabled ?? null,
    uamdm: a.is_user_approved_enrollment ?? null,
    ddm: a.ddm_enabled ?? null,
    activation_lock: a.is_activation_lock_enabled ?? null,
    lost_mode: a.lost_mode_enabled ?? null,
    // booleans only — the password VALUES are secrets and never enter the record
    firmware_lock: a.firmware_password_enabled ?? null,
    recovery_lock: a.recovery_lock_password_enabled ?? null,
    passcode_present: a.passcode_present ?? null,
    passcode_compliant: a.passcode_compliant ?? null,
    rsr: a.supplemental_os_version_extra || a.supplemental_build_version || "",
    bluetooth_mac: a.bluetooth_mac ?? "", meid: a.meid ?? "", iccid: a.iccid ?? "",
    time_zone: a.time_zone ?? "",
    cloud_backup: a.is_cloud_backup_enabled ?? null,
    cloud_backup_at: a.last_cloud_backup_date ?? null,
    enrollment_channels: a.enrollment_channels ?? [],
    attrs,
    apps: null, profiles: null, users: null,
    sections: { apps: "pending", profiles: "pending", users: "pending" },
  };
}

export const normalizeApps = (raw) => (raw ?? []).map((x) => ({
  name: x.attributes?.name ?? "", identifier: x.attributes?.identifier ?? "",
  version: x.attributes?.version ?? "", managed: Boolean(x.attributes?.managed),
}));
export const normalizeProfiles = (raw) => (raw ?? []).map((x) => ({
  name: x.attributes?.name ?? "", identifier: x.attributes?.identifier ?? String(x.id ?? ""),
}));
export const normalizeUsers = (raw) => (raw ?? []).map((x) => ({
  username: x.attributes?.username ?? "", full_name: x.attributes?.full_name ?? "",
}));

export function parseInvArgs(argv) {
  const o = {
    selector: null, search: null, confirmAll: false, format: "all", reportDetail: "summary", reportStyle: "dossier",
    noApps: false, noProfiles: false, noUsers: false, noFindings: false,
    raw: false, allowPartial: false, out: null, error: null,
  };
  const selectors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--serial") {
      const v = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!v.length) { o.error = "--serial needs at least one serial"; return o; }
      selectors.push({ kind: "serial", value: v });
    } else if (a === "--group") {
      const v = next();
      if (!v) { o.error = "--group needs a group name"; return o; }
      selectors.push({ kind: "group", value: v });
    } else if (a === "--last-seen") {
      const v = parseInt(next(), 10);
      if (!Number.isInteger(v) || v <= 0) { o.error = "--last-seen needs a positive integer"; return o; }
      selectors.push({ kind: "last-seen", value: v });
    } else if (a === "--all") selectors.push({ kind: "all", value: true });
    else if (a === "--confirm-all") o.confirmAll = true;
    else if (a === "--search") {
      const v = next();
      if (!v) { o.error = "--search needs a query string"; return o; }
      o.search = v;
    } else if (a === "--format") {
      const v = next();
      if (!["csv", "md", "docx", "all"].includes(v)) { o.error = `Invalid --format "${v}" (csv|md|docx|all)`; return o; }
      o.format = v;
    } else if (a === "--report-detail") {
      const v = next();
      if (!["summary", "table", "full"].includes(v)) { o.error = `Invalid --report-detail "${v}" (summary|table|full)`; return o; }
      o.reportDetail = v;
    } else if (a === "--report-style") {
      const v = next();
      if (!["dossier", "roster"].includes(v)) { o.error = `Invalid --report-style "${v}" (dossier|roster)`; return o; }
      o.reportStyle = v;
    } else if (a === "--no-apps") o.noApps = true;
    else if (a === "--no-profiles") o.noProfiles = true;
    else if (a === "--no-users") o.noUsers = true;
    else if (a === "--no-findings") o.noFindings = true;
    else if (a === "--raw") o.raw = true;
    else if (a === "--allow-partial") o.allowPartial = true;
    else if (a === "--out") {
      const v = next();
      if (!v) { o.error = "--out needs a directory"; return o; }
      o.out = v;
    } else { o.error = `Unknown flag "${a}"`; return o; }
  }
  if (selectors.length > 1) { o.error = "use exactly one selector (--serial | --group | --last-seen | --all), optionally combined with --search"; return o; }
  o.selector = selectors[0] ?? null;
  if (!o.selector && !o.search) { o.error = "give a selector (--serial/--group/--last-seen/--all) and/or a --search query"; return o; }
  if (o.selector?.kind === "all" && !o.confirmAll) { o.error = "--all fetches apps/profiles/users for every device in the fleet; add --confirm-all to proceed"; return o; }
  return o;
}
