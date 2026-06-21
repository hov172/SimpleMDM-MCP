// Fetch-side normalization for the inventory report.
// Ported from the legacy inventory lib — logic-identical, adds TypeScript types.

const LEGACY_MODELS: Record<string, { marketing: string; year: string }> = {
  // iMac
  "iMac20,2": { marketing: "iMac (Retina 5K, 27-inch, 2020)", year: "2020" },
  "iMac20,1": { marketing: "iMac (Retina 5K, 27-inch, 2020)", year: "2020" },
  "iMac19,1": { marketing: "iMac (Retina 5K, 27-inch, 2019)", year: "2019" },
  "iMac19,2": { marketing: "iMac (Retina 4K, 21.5-inch, 2019)", year: "2019" },
  "iMacPro1,1": { marketing: "iMac Pro (2017)", year: "2017" },
  "iMac18,3": { marketing: "iMac (Retina 5K, 27-inch, 2017)", year: "2017" },
  "iMac18,2": { marketing: "iMac (Retina 4K, 21.5-inch, 2017)", year: "2017" },
  "iMac18,1": { marketing: "iMac (21.5-inch, 2017)", year: "2017" },
  "iMac17,1": { marketing: "iMac (Retina 5K, 27-inch, Late 2015)", year: "2015" },
  "iMac16,2": { marketing: "iMac (Retina 4K, 21.5-inch, Late 2015)", year: "2015" },
  "iMac16,1": { marketing: "iMac (21.5-inch, Late 2015)", year: "2015" },
  "iMac15,1": { marketing: "iMac (Retina 5K, 27-inch, Late 2014)", year: "2014" },
  "iMac14,4": { marketing: "iMac (21.5-inch, Mid 2014)", year: "2014" },
  "iMac14,3": { marketing: "iMac (21.5-inch, Late 2013)", year: "2013" },
  "iMac14,2": { marketing: "iMac (27-inch, Late 2013)", year: "2013" },
  "iMac14,1": { marketing: "iMac (21.5-inch, Late 2013)", year: "2013" },
  "iMac13,2": { marketing: "iMac (27-inch, Late 2012)", year: "2012" },
  "iMac13,1": { marketing: "iMac (21.5-inch, Late 2012)", year: "2012" },
  "iMac12,2": { marketing: "iMac (27-inch, Mid 2011)", year: "2011" },
  "iMac12,1": { marketing: "iMac (21.5-inch, Mid 2011)", year: "2011" },
  "iMac11,3": { marketing: "iMac (27-inch, Mid 2010)", year: "2010" },
  "iMac11,2": { marketing: "iMac (21.5-inch, Mid 2010)", year: "2010" },
  "iMac10,1": { marketing: "iMac (Late 2009)", year: "2009" },
  // MacBook Pro
  "MacBookPro16,4": { marketing: "MacBook Pro (16-inch, 2019)", year: "2019" },
  "MacBookPro16,3": { marketing: "MacBook Pro (13-inch, 2020, Two Thunderbolt 3 ports)", year: "2020" },
  "MacBookPro16,2": { marketing: "MacBook Pro (13-inch, 2020, Four Thunderbolt 3 ports)", year: "2020" },
  "MacBookPro16,1": { marketing: "MacBook Pro (16-inch, 2019)", year: "2019" },
  "MacBookPro15,4": { marketing: "MacBook Pro (13-inch, 2019, Two Thunderbolt 3 ports)", year: "2019" },
  "MacBookPro15,3": { marketing: "MacBook Pro (15-inch, 2019)", year: "2019" },
  "MacBookPro15,2": { marketing: "MacBook Pro (13-inch, 2018/2019, Four Thunderbolt 3 ports)", year: "2018" },
  "MacBookPro15,1": { marketing: "MacBook Pro (15-inch, 2018/2019)", year: "2018" },
  "MacBookPro14,3": { marketing: "MacBook Pro (15-inch, 2017)", year: "2017" },
  "MacBookPro14,2": { marketing: "MacBook Pro (13-inch, 2017, Four Thunderbolt 3 ports)", year: "2017" },
  "MacBookPro14,1": { marketing: "MacBook Pro (13-inch, 2017, Two Thunderbolt 3 ports)", year: "2017" },
  "MacBookPro13,3": { marketing: "MacBook Pro (15-inch, 2016)", year: "2016" },
  "MacBookPro13,2": { marketing: "MacBook Pro (13-inch, 2016, Four Thunderbolt 3 ports)", year: "2016" },
  "MacBookPro13,1": { marketing: "MacBook Pro (13-inch, 2016, Two Thunderbolt 3 ports)", year: "2016" },
  "MacBookPro12,1": { marketing: "MacBook Pro (Retina, 13-inch, Early 2015)", year: "2015" },
  "MacBookPro11,5": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2015)", year: "2015" },
  "MacBookPro11,4": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2015)", year: "2015" },
  "MacBookPro11,3": { marketing: "MacBook Pro (Retina, 15-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro11,2": { marketing: "MacBook Pro (Retina, 15-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro11,1": { marketing: "MacBook Pro (Retina, 13-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro10,2": { marketing: "MacBook Pro (Retina, 13-inch, Late 2012/Early 2013)", year: "2012" },
  "MacBookPro10,1": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2012/Early 2013)", year: "2012" },
  "MacBookPro9,2": { marketing: "MacBook Pro (13-inch, Mid 2012)", year: "2012" },
  "MacBookPro9,1": { marketing: "MacBook Pro (15-inch, Mid 2012)", year: "2012" },
  // MacBook Air
  "MacBookAir9,1": { marketing: "MacBook Air (Retina, 13-inch, 2020)", year: "2020" },
  "MacBookAir8,2": { marketing: "MacBook Air (Retina, 13-inch, 2019)", year: "2019" },
  "MacBookAir8,1": { marketing: "MacBook Air (Retina, 13-inch, 2018)", year: "2018" },
  "MacBookAir7,2": { marketing: "MacBook Air (13-inch, Early 2015/2017)", year: "2015" },
  "MacBookAir7,1": { marketing: "MacBook Air (11-inch, Early 2015)", year: "2015" },
  "MacBookAir6,2": { marketing: "MacBook Air (13-inch, Mid 2013/Early 2014)", year: "2013" },
  "MacBookAir6,1": { marketing: "MacBook Air (11-inch, Mid 2013/Early 2014)", year: "2013" },
  "MacBookAir5,2": { marketing: "MacBook Air (13-inch, Mid 2012)", year: "2012" },
  "MacBookAir5,1": { marketing: "MacBook Air (11-inch, Mid 2012)", year: "2012" },
  // MacBook
  "MacBook10,1": { marketing: "MacBook (Retina, 12-inch, 2017)", year: "2017" },
  "MacBook9,1": { marketing: "MacBook (Retina, 12-inch, Early 2016)", year: "2016" },
  "MacBook8,1": { marketing: "MacBook (Retina, 12-inch, Early 2015)", year: "2015" },
  // Mac mini
  "Macmini8,1": { marketing: "Mac mini (2018)", year: "2018" },
  "Macmini7,1": { marketing: "Mac mini (Late 2014)", year: "2014" },
  "Macmini6,2": { marketing: "Mac mini (Late 2012)", year: "2012" },
  "Macmini6,1": { marketing: "Mac mini (Late 2012)", year: "2012" },
  "Macmini5,3": { marketing: "Mac mini (Mid 2011)", year: "2011" },
  "Macmini5,2": { marketing: "Mac mini (Mid 2011)", year: "2011" },
  "Macmini5,1": { marketing: "Mac mini (Mid 2011)", year: "2011" },
  // Mac Pro
  "MacPro7,1": { marketing: "Mac Pro (2019)", year: "2019" },
  "MacPro6,1": { marketing: "Mac Pro (Late 2013)", year: "2013" },
  "MacPro5,1": { marketing: "Mac Pro (Mid 2010/Mid 2012)", year: "2010" },
};

export interface NormalizedApp {
  name: string;
  identifier: string;
  version: string;
  managed: boolean;
}

export interface NormalizedProfile {
  name: string;
  identifier: string;
}

export interface NormalizedUser {
  username: string;
  full_name: string;
}

export interface AssignedProfileInfo {
  profile_id: number | string;
  profile: string;
  identifier: string;
  via: string;
}

export type SectionStatus = "ok" | "failed" | "pending" | "skipped";

export interface DeviceRecord {
  id: number | string;
  name: string;
  device_name: string;
  serial: string;
  udid: string;
  imei: string;
  wifi_mac: string;
  ethernet_macs: string[];
  last_ip: string;
  model_id: string;
  model_name: string;
  model_year: string;
  type: string;
  arch: string;
  os_version: string;
  build_version: string;
  device_group: string;
  assignment_groups: string[];
  assigned_apps: string[];
  assigned_detail: { app: string; group: string }[];
  assigned_profile_detail: AssignedProfileInfo[];
  seen_at: string | null;
  enrolled_at: string | null;
  storage_total_gb: number | null;
  storage_free_gb: number | null;
  battery_pct: number | null;
  filevault: boolean | null;
  recoverykey: boolean | null;
  sip: boolean | null;
  firewall: boolean | null;
  supervised: boolean | null;
  dep: boolean | null;
  status: string;
  ard: boolean | null;
  uamdm: boolean | null;
  ddm: boolean | null;
  activation_lock: boolean | null;
  lost_mode: boolean | null;
  firmware_lock: boolean | null;
  recovery_lock: boolean | null;
  passcode_present: boolean | null;
  passcode_compliant: boolean | null;
  rsr: string;
  bluetooth_mac: string;
  meid: string;
  iccid: string;
  time_zone: string;
  cloud_backup: boolean | null;
  cloud_backup_at: string | null;
  enrollment_channels: string[];
  attrs: Record<string, string | null>;
  apps: NormalizedApp[] | null;
  profiles: NormalizedProfile[] | null;
  users: NormalizedUser[] | null;
  sections: Record<string, SectionStatus>;
  match_reasons?: string;
  match_status?: string;
  hits?: { apps: Set<string>; profiles: Set<string>; users: Set<string> };
}

export function buildModelMap(
  macFeed: any,
  iosFeed: any,
): Map<string, { marketing: string; year: string }> {
  const map = new Map(Object.entries(LEGACY_MODELS).map(([id, v]) => [id, { ...v }]));
  for (const feed of [macFeed, iosFeed]) {
    for (const [id, info] of Object.entries((feed?.Models ?? {}) as Record<string, any>)) {
      const marketing = (info as any)?.MarketingName ?? "";
      const y = (marketing as string).match(/\b(19|20)\d{2}\b/);
      map.set(id, { marketing, year: y ? y[0] : "" });
    }
  }
  return map;
}

export function deriveType(modelId: string, family = ""): string {
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

export function profileAssignmentMap(profilesRaw: any[]): {
  byDeviceGroup: Map<number | string, AssignedProfileInfo[]>;
  byAssignmentGroup: Map<number | string, AssignedProfileInfo[]>;
  byDevice: Map<number | string, AssignedProfileInfo[]>;
} {
  const byDeviceGroup = new Map<number | string, AssignedProfileInfo[]>();
  const byAssignmentGroup = new Map<number | string, AssignedProfileInfo[]>();
  const byDevice = new Map<number | string, AssignedProfileInfo[]>();
  for (const p of profilesRaw ?? []) {
    const info: AssignedProfileInfo = {
      profile_id: p.id,
      profile: p.attributes?.name ?? String(p.id),
      identifier: p.attributes?.profile_identifier ?? "",
      via: "",
    };
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

export function assignmentAppMap(
  agRaw: any[],
  appCatalog: Map<number | string, string>,
): Map<number | string, string[]> {
  const m = new Map<number | string, string[]>();
  for (const g of agRaw ?? []) {
    const ids: (number | string)[] = (g.relationships?.apps?.data ?? []).map((x: any) => x.id);
    m.set(g.id, ids.map((id) => appCatalog.get(id)).filter(Boolean) as string[]);
  }
  return m;
}

export function normalizeDevice(
  d: any,
  {
    dgMap = new Map<number | string, string>(),
    agNames = new Map<number | string, string>(),
    agAppsByDevice = new Map<number | string, string[]>(),
    models = new Map<string, { marketing: string; year: string }>(),
    profileAssign = {
      byDeviceGroup: new Map<number | string, AssignedProfileInfo[]>(),
      byAssignmentGroup: new Map<number | string, AssignedProfileInfo[]>(),
      byDevice: new Map<number | string, AssignedProfileInfo[]>(),
    },
  }: {
    dgMap?: Map<number | string, string>;
    agNames?: Map<number | string, string>;
    agAppsByDevice?: Map<number | string, string[]>;
    models?: Map<string, { marketing: string; year: string }>;
    profileAssign?: {
      byDeviceGroup: Map<number | string, AssignedProfileInfo[]>;
      byAssignmentGroup: Map<number | string, AssignedProfileInfo[]>;
      byDevice: Map<number | string, AssignedProfileInfo[]>;
    };
  } = {},
): DeviceRecord {
  const a = d.attributes ?? {};
  const attrs: Record<string, string | null> = {};
  for (const c of d.relationships?.custom_attribute_values?.data ?? []) attrs[c.id] = c.attributes?.value ?? null;
  const modelId: string = a.product_name || a.model || "";
  const m = models.get(modelId);
  const marketing: string = m?.marketing || a.model_name || "";
  const modelYear: string = m?.year || (marketing.match(/\b(19|20)\d{2}\b/)?.[0] ?? "");
  const agIds: (number | string)[] = (d.relationships?.groups?.data ?? []).map((g: any) => g.id);
  const assignedDetail: { app: string; group: string }[] = agIds.flatMap((id) =>
    (agAppsByDevice.get(id) ?? []).map((app) => ({ app, group: agNames.get(id) ?? String(id) })));
  const dgId: number | string | undefined = d.relationships?.device_group?.data?.id;
  const assignedProfiles = new Map<number | string, AssignedProfileInfo>();
  for (const p of profileAssign.byDeviceGroup.get(dgId as any) ?? []) {
    assignedProfiles.set(p.profile_id, { ...p, via: dgMap.get(dgId as any) ?? "device group" });
  }
  for (const agId of agIds) {
    for (const p of profileAssign.byAssignmentGroup?.get(agId) ?? []) {
      if (!assignedProfiles.has(p.profile_id)) assignedProfiles.set(p.profile_id, { ...p, via: agNames.get(agId) ?? String(agId) });
    }
  }
  for (const p of profileAssign.byDevice.get(d.id) ?? []) {
    if (!assignedProfiles.has(p.profile_id)) assignedProfiles.set(p.profile_id, { ...p, via: "direct" });
  }
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
    device_group: dgMap.get(dgId as any) ?? "",
    assignment_groups: agIds.map((id) => agNames.get(id)).filter(Boolean) as string[],
    assigned_apps: [...new Set(assignedDetail.map((x) => x.app))],
    assigned_detail: assignedDetail,
    assigned_profile_detail: [...assignedProfiles.values()],
    seen_at: a.last_seen_at ?? null, enrolled_at: a.enrolled_at ?? null,
    storage_total_gb: a.device_capacity ?? null, storage_free_gb: a.available_device_capacity ?? null,
    battery_pct: Number.isFinite(battery) ? battery : null,
    filevault: a.filevault_enabled ?? null,
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

// raw API dumps must never carry secret values.
export const SECRET_DEVICE_ATTRS = ["filevault_recovery_key", "firmware_password", "recovery_lock_password"];
export function redactDeviceRaw(d: any): any {
  const c = JSON.parse(JSON.stringify(d));
  if (c.attributes) {
    for (const k of SECRET_DEVICE_ATTRS) {
      if (k in c.attributes) c.attributes[k] = c.attributes[k] ? "[REDACTED set=yes]" : null;
    }
  }
  return c;
}

export const normalizeApps = (raw: any[]): NormalizedApp[] => (raw ?? []).map((x) => ({
  name: x.attributes?.name ?? "", identifier: x.attributes?.identifier ?? "",
  version: x.attributes?.version ?? "", managed: Boolean(x.attributes?.managed),
}));

export const normalizeProfiles = (raw: any[]): NormalizedProfile[] => (raw ?? []).map((x) => ({
  name: x.attributes?.name ?? "", identifier: x.attributes?.identifier ?? String(x.id ?? ""),
}));

export const normalizeUsers = (raw: any[]): NormalizedUser[] => (raw ?? []).map((x) => ({
  username: x.attributes?.username ?? "", full_name: x.attributes?.full_name ?? "",
}));
