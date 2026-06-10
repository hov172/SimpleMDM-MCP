// Fetch-side normalization for the inventory report: builds the searchable
// record consumed by query.mjs. Knows the SimpleMDM API shapes; knows nothing
// about query syntax.

export function buildModelMap(macFeed, iosFeed) {
  const map = new Map();
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

// agRaw: raw /assignment_groups records; appCatalog: Map app id -> name.
export function assignmentAppMap(agRaw, appCatalog) {
  const m = new Map();
  for (const g of agRaw ?? []) {
    const ids = (g.relationships?.apps?.data ?? []).map((x) => x.id);
    m.set(g.id, ids.map((id) => appCatalog.get(id)).filter(Boolean));
  }
  return m;
}

export function normalizeDevice(d, { dgMap = new Map(), agNames = new Map(), agAppsByDevice = new Map(), models = new Map() } = {}) {
  const a = d.attributes ?? {};
  const attrs = {};
  for (const c of d.relationships?.custom_attribute_values?.data ?? []) attrs[c.id] = c.attributes?.value ?? null;
  const modelId = a.product_name || a.model || "";
  const m = models.get(modelId);
  const marketing = m?.marketing || a.model_name || "";
  const agIds = (d.relationships?.groups?.data ?? []).map((g) => g.id);
  const assignedDetail = agIds.flatMap((id) =>
    (agAppsByDevice.get(id) ?? []).map((app) => ({ app, group: agNames.get(id) ?? String(id) })));
  const battery = a.battery_level == null ? NaN : parseFloat(String(a.battery_level));
  return {
    id: d.id,
    name: a.name ?? "", device_name: a.device_name ?? "", serial: a.serial_number ?? "",
    udid: a.unique_identifier ?? "", imei: a.imei ?? "",
    wifi_mac: a.wifi_mac ?? "", ethernet_macs: a.ethernet_macs ?? [], last_ip: a.last_seen_ip ?? "",
    model_id: modelId, model_name: marketing, model_year: m?.year ?? "",
    type: deriveType(modelId, marketing),
    arch: a.processor_architecture ?? "",
    os_version: a.os_version ?? "", build_version: a.build_version ?? "",
    device_group: dgMap.get(d.relationships?.device_group?.data?.id) ?? "",
    assignment_groups: agIds.map((id) => agNames.get(id)).filter(Boolean),
    assigned_apps: [...new Set(assignedDetail.map((x) => x.app))],
    assigned_detail: assignedDetail,
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
