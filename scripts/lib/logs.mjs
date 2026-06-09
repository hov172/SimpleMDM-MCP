// Pure helpers for the logs-audit engine. No network, no fs.

// "MM/DD/YY HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS". Same wall-clock, NO timezone
// shift and NO UTC claim (the /logs API does not stamp an offset). "" if unparseable.
export function toIso(at) {
  if (typeof at !== "string") return "";
  const m = at.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, mo, d, y, hh, mm, ss] = m;
  return `20${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
}

// Parse argv (the slice after `node script.mjs`). Returns a normalized options
// object with `error` set to a usage string when invalid (never throws).
export function parseArgs(argv) {
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name) => argv.includes(name);

  const selectors = [];
  if (has("--serial")) selectors.push({ kind: "serial", value: (val("--serial") ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
  if (has("--last-seen")) selectors.push({ kind: "last-seen", value: parseInt(val("--last-seen") ?? "", 10) });
  if (has("--group")) selectors.push({ kind: "group", value: val("--group") ?? "" });
  if (has("--all")) selectors.push({ kind: "all", value: true });

  const opts = {
    selector: selectors[0] ?? null,
    withInventory: has("--with-inventory"),
    withSecurity: has("--with-security"),
    format: val("--format") ?? "all",
    out: val("--out") ?? null,
    error: null,
  };
  if (selectors.length !== 1) { opts.error = "Provide exactly one selector: --serial | --last-seen | --group | --all"; return opts; }
  if (opts.selector.kind === "all" && !has("--confirm-all")) { opts.error = "--all requires --confirm-all (whole-fleet export is heavy)"; return opts; }
  if (!["csv", "md", "docx", "all"].includes(opts.format)) { opts.error = `Invalid --format '${opts.format}' (use csv|md|docx|all)`; return opts; }
  return opts;
}

// raw: array of raw /devices records. selector: from parseArgs. matchGroupIds:
// Set<number> of group ids the --group name resolved to (empty for other kinds).
export function selectDevices(raw, selector, matchGroupIds) {
  switch (selector.kind) {
    case "all":
      return raw.slice();
    case "last-seen": {
      const sorted = raw.slice().sort((a, b) =>
        String(b.attributes?.last_seen_at ?? "").localeCompare(String(a.attributes?.last_seen_at ?? "")));
      return sorted.slice(0, selector.value);
    }
    case "serial": {
      const bySerial = new Map(raw.map((d) => [d.attributes?.serial_number, d]));
      return selector.value.map((s) => bySerial.get(s)).filter(Boolean);
    }
    case "group":
      return raw.filter((d) => {
        const dg = d.relationships?.device_group?.data?.id;
        if (dg != null && matchGroupIds.has(dg)) return true;
        return (d.relationships?.groups?.data ?? []).some((g) => matchGroupIds.has(g.id));
      });
    default:
      return [];
  }
}

export const LOG_COLUMNS = ["at_iso", "at", "device_id", "serial_number", "device_name", "device_users",
  "event_type", "summary", "namespace", "level", "source", "account_id", "log_id", "udid",
  "app_name", "app_identifier", "app_version", "via_munki", "profile_name",
  "sc_channel", "sc_filevault_enabled", "sc_sw_install_state", "sc_pending_os", "sc_pending_build",
  "sc_failure_count", "sc_failure_reason"];

function dig(o, ...path) { for (const k of path) { if (o == null || typeof o !== "object") return undefined; o = o[k]; } return o; }
function s(v) { return v === null || v === undefined ? "" : String(v); }

function ownerLabel(bundle) {
  const us = bundle.users?.data ?? bundle.users ?? [];
  return us.map((u) => `${u.attributes?.full_name ?? ""} (${u.attributes?.username ?? ""})`).join(" | ");
}

export function logRows(bundles) {
  const rows = [];
  for (const b of bundles) {
    const da = b.device.attributes ?? {};
    const owners = ownerLabel(b);
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      const md = a.metadata ?? {};
      const ddata = dig(a, "relationships", "device", "data") ?? {};
      const et = a.event_type ?? "";
      let summary;
      if (et === "app.installing") summary = `app installing: ${s(md.name)} ${s(md.version)} (${s(md.bundle_identifier)})${md.via_munki ? " via munki" : ""}`;
      else if (et === "profile.installed") summary = `profile installed: ${s(md.profile_name)}`;
      else if (et === "bootstrap_token.get") summary = `bootstrap token retrieved (udid ${s(md.udid)})`;
      else if (et === "status.changed") {
        const fv = dig(md, "status", "diskmanagement", "filevault", "enabled");
        const st = dig(md, "status", "softwareupdate", "install_state");
        const pend = dig(md, "status", "softwareupdate", "pending_version", "os_version");
        const fc = dig(md, "status", "softwareupdate", "failure_reason", "count");
        const bits = [`channel=${s(md.channel)}`];
        if (fv !== undefined) bits.push(`filevault=${fv}`);
        if (st) bits.push(`sw_install_state=${st}`);
        if (pend) bits.push(`pending_os=${pend}`);
        if (fc) bits.push(`sw_failures=${fc}`);
        summary = "status.changed: " + bits.join(", ");
      } else summary = et;
      rows.push({
        at_iso: toIso(a.at), at: s(a.at), device_id: s(b.device.id),
        serial_number: s(ddata.serial_number ?? da.serial_number), device_name: s(da.name), device_users: owners,
        event_type: et, summary, namespace: s(a.namespace), level: s(a.level), source: s(a.source),
        account_id: s(dig(a, "relationships", "account", "data", "id")), log_id: s(lg.id), udid: s(ddata.udid),
        app_name: et === "app.installing" ? s(md.name) : "", app_identifier: et === "app.installing" ? s(md.bundle_identifier) : "",
        app_version: et === "app.installing" ? s(md.version) : "", via_munki: et === "app.installing" ? s(md.via_munki) : "",
        profile_name: et === "profile.installed" ? s(md.profile_name) : "",
        sc_channel: et === "status.changed" ? s(md.channel) : "",
        sc_filevault_enabled: et === "status.changed" ? s(dig(md, "status", "diskmanagement", "filevault", "enabled")) : "",
        sc_sw_install_state: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "install_state")) : "",
        sc_pending_os: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "pending_version", "os_version")) : "",
        sc_pending_build: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "pending_version", "build_version")) : "",
        sc_failure_count: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "failure_reason", "count")) : "",
        sc_failure_reason: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "failure_reason", "reason")) : "",
      });
    }
  }
  rows.sort((x, y) => (x.at_iso === "" ? 1 : 0) - (y.at_iso === "" ? 1 : 0) || x.at_iso.localeCompare(y.at_iso) || x.serial_number.localeCompare(y.serial_number));
  return rows;
}
