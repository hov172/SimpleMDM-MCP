// CSV row builders, rollups, findings and the markdown dossier for the
// inventory report. Pure functions over normalized records.

const onOff = (v) => (v === true ? "on" : v === false ? "off" : "");
const join = (xs) => (xs ?? []).join(" | ");

export const DEVICE_COLUMNS = [
  "name", "device_name", "serial", "udid", "imei", "wifi_mac", "ethernet_macs", "last_ip",
  "model_id", "model_name", "release_year", "type", "arch", "os_version", "build_version",
  "status", "dep", "enrolled_at", "seen_at", "storage_free_gb", "storage_total_gb", "battery_pct",
  "filevault", "recoverykey", "sip", "firewall", "supervised",
  "device_group", "assignment_groups", "custom_attributes", "match_reasons", "sections_failed",
];

export function deviceRows(records) {
  return records.map((r) => ({
    name: r.name, device_name: r.device_name, serial: r.serial, udid: r.udid, imei: r.imei,
    wifi_mac: r.wifi_mac, ethernet_macs: join(r.ethernet_macs), last_ip: r.last_ip,
    model_id: r.model_id, model_name: r.model_name, release_year: r.model_year, type: r.type, arch: r.arch,
    os_version: r.os_version, build_version: r.build_version,
    status: r.status, dep: onOff(r.dep), enrolled_at: r.enrolled_at ?? "", seen_at: r.seen_at ?? "",
    storage_free_gb: r.storage_free_gb ?? "", storage_total_gb: r.storage_total_gb ?? "", battery_pct: r.battery_pct ?? "",
    filevault: onOff(r.filevault), recoverykey: onOff(r.recoverykey), sip: onOff(r.sip),
    firewall: onOff(r.firewall), supervised: onOff(r.supervised),
    device_group: r.device_group, assignment_groups: join(r.assignment_groups),
    custom_attributes: Object.entries(r.attrs ?? {}).map(([k, v]) => `${k}=${v}`).join(" | "),
    match_reasons: r.match_reasons ?? "",
    sections_failed: Object.entries(r.sections ?? {}).filter(([, v]) => v === "failed").map(([k]) => k).join(" | "),
  }));
}

export const APP_COLUMNS = ["serial", "device", "app_name", "identifier", "version", "managed", "matched"];
export function appRows(records) {
  return records.flatMap((r) => (r.apps ?? []).map((a) => ({
    serial: r.serial, device: r.name, app_name: a.name, identifier: a.identifier, version: a.version,
    managed: a.managed ? "yes" : "no", matched: r.hits?.apps?.has(a.name) ? "yes" : "",
  })));
}

const installedHas = (r, appName) =>
  (r.apps ?? []).some((a) => `${a.name} ${a.identifier}`.toLowerCase().includes(appName.toLowerCase()));

export const ASSIGNED_COLUMNS = ["serial", "device", "app_name", "assignment_group", "installed"];
export function assignedAppRows(records) {
  return records.flatMap((r) => (r.assigned_detail ?? []).map((x) => ({
    serial: r.serial, device: r.name, app_name: x.app, assignment_group: x.group,
    installed: r.sections?.apps === "ok" ? (installedHas(r, x.app) ? "yes" : "no") : "unknown",
  })));
}

// Assigned profile -> installed match: exact profile_identifier when the
// catalog provides one, else case-insensitive name equality.
const installedProfileHas = (r, ap) =>
  (r.profiles ?? []).some((p) =>
    (ap.identifier && p.identifier === ap.identifier) || p.name.toLowerCase() === ap.profile.toLowerCase());

export const ASSIGNED_PROFILE_COLUMNS = ["serial", "device", "profile_name", "profile_identifier", "via", "installed"];
export function assignedProfileRows(records) {
  return records.flatMap((r) => (r.assigned_profile_detail ?? []).map((x) => ({
    serial: r.serial, device: r.name, profile_name: x.profile, profile_identifier: x.identifier, via: x.via,
    installed: r.sections?.profiles === "ok" ? (installedProfileHas(r, x) ? "yes" : "no") : "unknown",
  })));
}

export const PROFILE_COLUMNS = ["serial", "device", "profile_name", "identifier", "matched"];
export function profileRows(records) {
  return records.flatMap((r) => (r.profiles ?? []).map((p) => ({
    serial: r.serial, device: r.name, profile_name: p.name, identifier: p.identifier,
    matched: r.hits?.profiles?.has(p.name) ? "yes" : "",
  })));
}

export const USER_COLUMNS = ["serial", "device", "username", "full_name", "matched"];
export function userRows(records) {
  return records.flatMap((r) => (r.users ?? []).map((u) => ({
    serial: r.serial, device: r.name, username: u.username, full_name: u.full_name,
    matched: r.hits?.users?.has(u.username) ? "yes" : "",
  })));
}

export const APP_CATALOG_COLUMNS = ["app_name", "identifier", "versions", "devices"];
export function appCatalogRows(records) {
  const m = new Map();
  for (const r of records) {
    for (const a of r.apps ?? []) {
      const k = a.identifier || a.name;
      if (!m.has(k)) m.set(k, { app_name: a.name, identifier: a.identifier, versions: new Set(), devices: new Set() });
      const e = m.get(k);
      if (a.version) e.versions.add(a.version);
      e.devices.add(r.serial);
    }
  }
  return [...m.values()]
    .map((e) => ({ app_name: e.app_name, identifier: e.identifier, versions: [...e.versions].sort().join(", "), devices: e.devices.size }))
    .sort((a, b) => b.devices - a.devices);
}

export function rollupRows(records, keyFn, label) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r) || "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, n]) => ({ [label]: k, devices: n })).sort((a, b) => b.devices - a.devices);
}

export const BY_MODEL_COLUMNS = ["model_id", "model_name", "release_year", "type", "devices"];
export function byModelRows(records) {
  const m = new Map();
  for (const r of records) {
    const k = r.model_id || "(unknown)";
    if (!m.has(k)) m.set(k, { model_id: k, model_name: r.model_name, release_year: r.model_year, type: r.type, devices: 0 });
    m.get(k).devices++;
  }
  return [...m.values()].sort((a, b) => b.devices - a.devices);
}

export const FINDING_COLUMNS = ["type", "status", "serial", "name", "detail"];

const MAC_TYPES = new Set(["imac", "laptop", "desktop", "mac"]);

// status: "flag" = asserted finding; "unknown" = the section needed to decide
// failed for this device, so the finding is reported but never asserted.
export function inventoryFindings(records, { lowStorageGb = 10, staleDays = 90, now = Date.now() } = {}) {
  const out = [];
  const add = (type, status, r, detail) => out.push({ type, status, serial: r.serial, name: r.name, detail });

  const byName = new Map();
  for (const r of records) {
    if (!r.name) continue;
    byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  }
  for (const [name, rs] of byName) {
    if (rs.length > 1) for (const r of rs) add("duplicate-name", "flag", r, `${rs.length} devices share the name "${name}"`);
  }

  const macs = records.filter((r) => MAC_TYPES.has(r.type) && r.os_version);
  const majors = new Map();
  for (const r of macs) {
    const mj = r.os_version.split(".")[0];
    majors.set(mj, (majors.get(mj) ?? 0) + 1);
  }
  const modal = [...majors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const r of records) {
    if (r.storage_free_gb != null && r.storage_free_gb < lowStorageGb) {
      add("low-storage", "flag", r, `${Number(r.storage_free_gb).toFixed(1)} GB free of ${r.storage_total_gb ?? "?"} GB`);
    }
    const t = r.seen_at ? Date.parse(r.seen_at) : NaN;
    if (Number.isFinite(t) && now - t > staleDays * 86400000) add("stale-device", "flag", r, `last seen ${r.seen_at}`);
    if (r.filevault === true && r.recoverykey === false) add("recovery-key-missing", "flag", r, "FileVault is on but no recovery key is escrowed");
    if (modal && MAC_TYPES.has(r.type) && r.os_version) {
      const mj = parseInt(r.os_version.split(".")[0], 10);
      if (Number.isFinite(mj) && parseInt(modal, 10) - mj > 1) add("os-outlier", "flag", r, `macOS ${r.os_version} vs fleet modal ${modal}.x`);
    }
    for (const appName of r.assigned_apps ?? []) {
      if (r.sections?.apps === "ok") {
        if (!installedHas(r, appName)) add("assigned-app-missing", "flag", r, `"${appName}" is assigned via an assignment group but not installed`);
      } else if (r.sections?.apps === "failed" || r.sections?.apps === "pending") {
        add("assigned-app-missing", "unknown", r, `"${appName}" is assigned; installed-app inventory unavailable (fetch ${r.sections.apps})`);
      }
    }
    for (const ap of r.assigned_profile_detail ?? []) {
      if (r.sections?.profiles === "ok") {
        if (!installedProfileHas(r, ap)) add("assigned-profile-missing", "flag", r, `"${ap.profile}" is assigned (via ${ap.via}) but not installed`);
      } else if (r.sections?.profiles === "failed" || r.sections?.profiles === "pending") {
        add("assigned-profile-missing", "unknown", r, `"${ap.profile}" is assigned; installed-profile inventory unavailable (fetch ${r.sections.profiles})`);
      }
    }
  }
  return out;
}

const mdEsc = (v) => String(v ?? "").replace(/\|/g, "\\|");

function mdTable(cols, rows) {
  if (!rows.length) return "_none_";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => mdEsc(r[c])).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}

export function renderInventoryReport(records, { query, scopeLabel, dateStr, findings = [], detail = "summary", failures = [] } = {}) {
  const out = [];
  out.push(`# SimpleMDM Fleet Inventory — ${dateStr}\n`);
  out.push(`> **Confidential** — contains device identifiers and user names. Local-only; delete when no longer needed.\n`);
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

  out.push("## 2. ⚠ Findings\n");
  out.push(mdTable(FINDING_COLUMNS, findings) + "\n");

  out.push("## 3. Per-Device Inventory\n");
  for (const r of records) {
    out.push(`### ${mdEsc(r.name)} (\`${r.serial}\`)\n`);
    out.push(`**Identity** — Serial \`${r.serial}\` · UDID \`${r.udid}\` · WiFi MAC \`${r.wifi_mac}\` · Last IP \`${r.last_ip}\``);
    out.push(`**Hardware** — ${mdEsc(r.model_name || r.model_id)} (\`${r.model_id}\`${r.model_year ? `, ${r.model_year}` : ""}) · ${r.type} · ${r.arch} · ` +
      `${r.storage_free_gb ?? "?"}/${r.storage_total_gb ?? "?"} GB free${r.battery_pct != null ? ` · battery ${r.battery_pct}%` : ""}`);
    out.push(`**OS** — ${r.os_version} (${r.build_version}) · **Posture** — FileVault ${onOff(r.filevault) || "n/a"}, recovery key ${onOff(r.recoverykey) || "n/a"}, ` +
      `SIP ${onOff(r.sip) || "n/a"}, firewall ${onOff(r.firewall) || "n/a"}, supervised ${onOff(r.supervised) || "n/a"} · DEP ${onOff(r.dep) || "n/a"}`);
    out.push(`**Groups** — device group: ${mdEsc(r.device_group || "(none)")} · assignment groups: ${mdEsc(join(r.assignment_groups) || "(none)")}`);
    out.push(`**Dates** — enrolled ${r.enrolled_at ?? "?"} · last seen ${r.seen_at ?? "?"}`);
    if (r.match_reasons) out.push(`**Match reasons** — ${mdEsc(r.match_reasons)}`);
    const failed = Object.entries(r.sections ?? {}).filter(([, v]) => v === "failed").map(([k]) => k);
    if (failed.length) out.push(`> ⚠ **Incomplete:** ${failed.join(", ")} fetch failed — counts below exclude those sections.`);
    const nApps = r.apps?.length ?? "?", nProf = r.profiles?.length ?? "?", nUsers = r.users?.length ?? "?";
    out.push(`**Inventory** — ${nApps} installed apps · ${nProf} profiles · ${nUsers} local users · ` +
      `${r.assigned_apps?.length ?? 0} assigned apps · ${r.assigned_profile_detail?.length ?? 0} assigned profiles\n`);
    // Assigned apps/profiles render at EVERY detail level — they are the deployment
    // contract for the device and stay small, unlike the installed-app table.
    out.push(`**Assigned apps** (via assignment groups):\n`);
    out.push(mdTable(["app_name", "assignment_group", "installed"],
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
  out.push("- Assigned apps come from assignment groups; assigned profiles come from device-group and direct-device profile assignments.");
  out.push("- Findings with status `unknown` could not be decided because a per-device fetch failed; they are never asserted.");
  out.push("- FileVault recovery keys are never written to any output; only the escrowed yes/no fact is reported.");
  if (failures.length) {
    out.push("\n### Failed section fetches\n");
    out.push(mdTable(["serial", "section", "message"], failures) + "\n");
  }
  return out.join("\n");
}
