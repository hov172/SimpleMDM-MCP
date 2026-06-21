// Pure helpers for the logs-audit engine. No network, no fs.

// "MM/DD/YY HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS". Same wall-clock, NO timezone
// shift and NO UTC claim (the /logs API does not stamp an offset). "" if unparseable.
export function toIso(at: unknown): string {
  if (typeof at !== "string") return "";
  const m = at.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, mo, d, y, hh, mm, ss] = m;
  return `20${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
}

// Parse argv (the slice after `node script.mjs`). Returns a normalized options
// object with `error` set to a usage string when invalid (never throws).
export function parseArgs(argv: string[]): Record<string, any> {
  const val = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name: string) => argv.includes(name);

  const selectors: any[] = [];
  if (has("--serial")) selectors.push({ kind: "serial", value: (val("--serial") ?? "").split(",").map((s: string) => s.trim()).filter(Boolean) });
  if (has("--last-seen")) selectors.push({ kind: "last-seen", value: parseInt(val("--last-seen") ?? "", 10) });
  if (has("--group")) selectors.push({ kind: "group", value: val("--group") ?? "" });
  if (has("--all")) selectors.push({ kind: "all", value: true });

  const opts: Record<string, any> = {
    selector: selectors[0] ?? null,
    withInventory: has("--with-inventory"),
    withSecurity: has("--with-security"),
    format: val("--format") ?? "all",
    reportDetail: val("--report-detail") ?? "summary",
    reportOnly: has("--report-only"),
    out: val("--out") ?? null,
    error: null,
  };
  if (selectors.length !== 1) { opts.error = "Provide exactly one selector: --serial | --last-seen | --group | --all"; return opts; }
  if (opts.selector.kind === "all" && !has("--confirm-all")) { opts.error = "--all requires --confirm-all (whole-fleet export is heavy)"; return opts; }
  if (opts.selector.kind === "last-seen" && (!Number.isInteger(opts.selector.value) || opts.selector.value < 1)) { opts.error = "--last-seen requires a positive integer"; return opts; }
  if (opts.selector.kind === "serial" && opts.selector.value.length === 0) { opts.error = "--serial requires at least one serial number"; return opts; }
  if (opts.selector.kind === "group" && !opts.selector.value) { opts.error = "--group requires a group name"; return opts; }
  if (!["csv", "md", "docx", "all"].includes(opts.format)) { opts.error = `Invalid --format '${opts.format}' (use csv|md|docx|all)`; return opts; }
  if (!["summary", "table", "full"].includes(opts.reportDetail)) { opts.error = `Invalid --report-detail '${opts.reportDetail}' (use summary|table|full)`; return opts; }
  if (opts.reportOnly && opts.format === "csv") { opts.error = "--report-only with --format csv writes no report — drop one of them"; return opts; }
  return opts;
}

// raw: array of raw /devices records. selector: from parseArgs. matchGroupIds:
// Set<number> of group ids the --group name resolved to (empty for other kinds).
export function selectDevices(raw: any[], selector: any, matchGroupIds: Set<number>): any[] {
  switch (selector.kind) {
    case "all":
      return raw.slice();
    case "last-seen": {
      const t = (d: any) => Date.parse(d.attributes?.last_seen_at ?? "") || 0;
      const sorted = raw.slice().sort((a, b) => t(b) - t(a));
      return sorted.slice(0, selector.value);
    }
    case "serial": {
      const bySerial = new Map(raw.map((d) => [d.attributes?.serial_number, d]));
      return selector.value.map((s: string) => bySerial.get(s)).filter(Boolean);
    }
    case "group":
      return raw.filter((d) => {
        const dg = d.relationships?.device_group?.data?.id;
        if (dg != null && matchGroupIds.has(dg)) return true;
        return (d.relationships?.groups?.data ?? []).some((g: any) => matchGroupIds.has(g.id));
      });
    default:
      return [];
  }
}

export const LOG_COLUMNS: string[] = ["at_iso", "at", "device_id", "serial_number", "device_name", "device_users",
  "event_type", "summary", "namespace", "level", "source", "account_id", "log_id", "udid",
  "app_name", "app_identifier", "app_version", "via_munki", "profile_name",
  "sc_channel", "sc_filevault_enabled", "sc_sw_install_state", "sc_pending_os", "sc_pending_build",
  "sc_failure_count", "sc_failure_reason"];

function dig(o: any, ...path: string[]): any { for (const k of path) { if (o == null || typeof o !== "object") return undefined; o = o[k]; } return o; }
function s(v: unknown): string { return v === null || v === undefined ? "" : String(v); }
function statusFields(md: any): Record<string, string> {
  return {
    sc_channel: s(md.channel),
    sc_filevault_enabled: s(dig(md, "status", "diskmanagement", "filevault", "enabled")),
    sc_sw_install_state: s(dig(md, "status", "softwareupdate", "install_state")),
    sc_pending_os: s(dig(md, "status", "softwareupdate", "pending_version", "os_version")),
    sc_pending_build: s(dig(md, "status", "softwareupdate", "pending_version", "build_version")),
    sc_failure_count: s(dig(md, "status", "softwareupdate", "failure_reason", "count")),
    sc_failure_reason: s(dig(md, "status", "softwareupdate", "failure_reason", "reason")),
  };
}
const EMPTY_STATUS_FIELDS: Record<string, string> = { sc_channel: "", sc_filevault_enabled: "", sc_sw_install_state: "", sc_pending_os: "", sc_pending_build: "", sc_failure_count: "", sc_failure_reason: "" };

function ownerLabel(bundle: any): string {
  const us = bundle.users?.data ?? bundle.users ?? [];
  return us.map((u: any) => `${u.attributes?.full_name ?? ""} (${u.attributes?.username ?? ""})`).join(" | ");
}

export function logRows(bundles: any[]): any[] {
  const rows: any[] = [];
  for (const b of bundles) {
    const da = b.device.attributes ?? {};
    const owners = ownerLabel(b);
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      const md = a.metadata ?? {};
      const ddata = dig(a, "relationships", "device", "data") ?? {};
      const et = a.event_type ?? "";
      let summary: string;
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
        ...(et === "status.changed" ? statusFields(md) : EMPTY_STATUS_FIELDS),
      });
    }
  }
  rows.sort((x, y) => (x.at_iso === "" ? 1 : 0) - (y.at_iso === "" ? 1 : 0) || x.at_iso.localeCompare(y.at_iso) || x.serial_number.localeCompare(y.serial_number));
  return rows;
}

// Relative path of the sidecar JSON file holding one status.changed snapshot.
export function statusSnapshotFile(serial: unknown, logId: unknown): string {
  const safe = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  return `status-snapshots/${safe(serial)}__${safe(logId)}.json`;
}

export const STATUS_COLUMNS: string[] = ["at_iso", "at", "device_id", "serial_number", "device_name", "log_id",
  "sc_channel", "sc_filevault_enabled", "sc_sw_install_state", "sc_pending_os", "sc_pending_build",
  "sc_failure_count", "sc_failure_reason", "status_json_file"];

export function statusSnapshotRows(bundles: any[]): any[] {
  const rows: any[] = [];
  for (const b of bundles) {
    const da = b.device.attributes ?? {};
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      if (a.event_type !== "status.changed") continue;
      const md = a.metadata ?? {};
      rows.push({
        at_iso: toIso(a.at), at: s(a.at), device_id: s(b.device.id), serial_number: s(da.serial_number),
        device_name: s(da.name), log_id: s(lg.id), ...statusFields(md),
        status_json_file: statusSnapshotFile(da.serial_number, lg.id),
      });
    }
  }
  rows.sort((x, y) => (x.at_iso === "" ? 1 : 0) - (y.at_iso === "" ? 1 : 0) || x.at_iso.localeCompare(y.at_iso) || x.serial_number.localeCompare(y.serial_number));
  return rows;
}

export function statusSnapshotFiles(bundles: any[]): { file: string; json: any }[] {
  const files: { file: string; json: any }[] = [];
  for (const b of bundles) {
    const serial = b.device.attributes?.serial_number;
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      if (a.event_type !== "status.changed") continue;
      files.push({ file: statusSnapshotFile(serial, lg.id), json: a.metadata?.status ?? {} });
    }
  }
  return files;
}

export const SUMMARY_COLUMNS: string[] = ["device_id", "serial_number", "device_name", "total_log_records",
  "app_installing", "profile_installed", "status_changed", "bootstrap_token_get",
  "first_event_at_iso", "last_event_at_iso", "span_days"];

const EVENT_TYPES = ["app.installing", "profile.installed", "status.changed", "bootstrap_token.get"];

export function logSummaryRows(bundles: any[]): any[] {
  return bundles.map((b) => {
    const da = b.device.attributes ?? {};
    const isos = (b.logs ?? []).map((l: any) => toIso(l.attributes?.at)).filter(Boolean).sort();
    const counts = Object.fromEntries(EVENT_TYPES.map((et) => [et, (b.logs ?? []).filter((l: any) => l.attributes?.event_type === et).length]));
    const first = isos[0] ?? "", last = isos[isos.length - 1] ?? "";
    const span = first && last ? Math.round((Date.parse(last + "Z") - Date.parse(first + "Z")) / 86400000) : "";
    return {
      device_id: s(b.device.id), serial_number: s(da.serial_number), device_name: s(da.name),
      total_log_records: (b.logs ?? []).length,
      app_installing: counts["app.installing"], profile_installed: counts["profile.installed"],
      status_changed: counts["status.changed"], bootstrap_token_get: counts["bootstrap_token.get"],
      first_event_at_iso: first, last_event_at_iso: last, span_days: span,
    };
  });
}

export const MANIFEST_COLUMNS: string[] = ["file", "description", "record_scope", "data_row_count", "bytes", "sha256", "generated_at"];

export const DISCLOSURES = [
  { file: "(disclosure: timezone)", description: "Log 'at' timestamps are returned by SimpleMDM /logs in the account's display timezone (devices report America/New_York). The API does NOT stamp a UTC offset and the account endpoint does not expose the zone. 'at' is verbatim; 'at_iso' is the same wall-clock reformatted to ISO 8601 with NO shift. Values are NOT UTC." },
  { file: "(disclosure: log retention)", description: "The /logs feed is retention-bounded. The earliest event per device (see logs-summary first_event_at_iso) reflects the API's retention horizon, NOT the device's full lifetime history." },
  { file: "(disclosure: completeness)", description: "All collections returned has_more=false at export time. Records reproduced verbatim; derived columns are additive and clearly named." },
];

export function manifestRows(fileMetas: any[], generatedAt: string): any[] {
  const rows = fileMetas.map((m) => ({ ...m, generated_at: generatedAt }));
  for (const d of DISCLOSURES) rows.push({ file: d.file, description: d.description, record_scope: "", data_row_count: "", bytes: "", sha256: "", generated_at: generatedAt });
  return rows;
}

export function noisyDevices(bundles: any[], threshold = 0.25): any[] {
  const counts = bundles.map((b) => b.logs?.length ?? 0);
  const total = counts.reduce((a: number, b: number) => a + b, 0);
  if (bundles.length < 2 || total === 0) return [];
  return bundles
    .map((b, i) => {
      const events = counts[i];
      const meanOthers = (total - events) / (bundles.length - 1);
      return {
        serial: b.device.attributes?.serial_number ?? "",
        name: b.device.attributes?.name ?? "",
        events,
        share: events / total,
        _dominant: events >= 2 * meanOthers,
      };
    })
    .filter((d) => d.share >= threshold && d._dominant)
    .sort((a, b) => b.events - a.events)
    .map(({ _dominant, ...d }: any) => d);
}

export function topInstalledApps(bundle: any, limit = 8): any[] {
  const map = new Map<string, any>();
  for (const l of bundle.logs ?? []) {
    if (l.attributes?.event_type !== "app.installing") continue;
    const m = l.attributes.metadata ?? {};
    const key = `${m.bundle_identifier || m.name || ""}@@${m.version ?? ""}`;
    const e = map.get(key) || { name: m.name ?? "", version: m.version ?? "", identifier: m.bundle_identifier ?? "", count: 0 };
    e.count++; map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function deviceFindings(bundle: any, { appLoop = 10, updateLoop = 10, profileChurn = 5 } = {}): any[] {
  const logs = bundle.logs ?? [];
  const findings: any[] = [];

  for (const a of topInstalledApps(bundle, Infinity)) {
    if (a.count >= appLoop) {
      findings.push({
        type: "app-reinstall-loop", severity: "warning",
        title: `App reinstall loop — ${a.name || a.identifier || "unknown app"}`,
        detail: `${a.name || a.identifier} (${a.identifier || "?"}) v${a.version || "?"} installed ${a.count}× — the same version reinstalling repeatedly points to a broken Munki installs-check/version (perpetual reinstall).`,
      });
    }
  }

  const fails = logs.filter((l: any) => l.attributes?.event_type === "status.changed" &&
    dig(l.attributes?.metadata, "status", "softwareupdate", "failure_reason", "count"));
  if (fails.length >= updateLoop) {
    const reason = s(dig(fails[fails.length - 1].attributes?.metadata, "status", "softwareupdate", "failure_reason", "reason"));
    findings.push({
      type: "update-failure-loop", severity: "warning",
      title: "Software-update failure loop",
      detail: `${fails.length} status.changed events report a software-update failure${reason ? ` — ${reason.slice(0, 140)}` : ""}.`,
    });
  }

  const profCounts = new Map<string, number>();
  for (const l of logs) {
    if (l.attributes?.event_type !== "profile.installed") continue;
    const n = l.attributes.metadata?.profile_name ?? "(unnamed)";
    profCounts.set(n, (profCounts.get(n) ?? 0) + 1);
  }
  for (const [name, count] of profCounts) {
    if (count >= profileChurn) {
      findings.push({
        type: "profile-churn", severity: "warning",
        title: `Profile reinstall churn — ${name}`,
        detail: `Configuration profile "${name}" (re)installed ${count}× — a profile failing its install check or being re-pushed repeatedly.`,
      });
    }
  }
  return findings;
}

export const FINDINGS_COLUMNS: string[] = ["device_id", "serial_number", "device_name", "type", "severity", "title", "detail"];

export function findingRows(bundles: any[], thresholds?: any): any[] {
  return bundles.flatMap((b) => deviceFindings(b, thresholds).map((f) => ({
    device_id: String(b.device?.id ?? ""),
    serial_number: b.device?.attributes?.serial_number ?? "",
    device_name: b.device?.attributes?.name ?? "",
    type: f.type, severity: f.severity, title: f.title, detail: f.detail,
  })));
}

export function renderDetailedReport(bundles: any[], securityEval: any[] | null, dateStr: string, groupNameMap: Record<string, string> = {}, opts: any = {}): string {
  const detail = opts.detail ?? "summary";
  const out: string[] = [];
  const P = (x = "") => out.push(x);
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
  const onoff = (v: unknown) => (v === true ? "enabled" : v === false ? "disabled" : "unknown");
  const evBySerial = new Map((securityEval || []).map((e: any) => [e.serial, e]));
  const hasInventory = bundles.some((b) => b.apps || b.profiles || b.users);
  const totalEvents = bundles.reduce((n, b) => n + (b.logs?.length ?? 0), 0);
  const fvOff = bundles.filter((b) => b.device.attributes?.filevault_enabled !== true).length;
  const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const noisy = noisyDevices(bundles);
  const noisySerials = new Set(noisy.map((d) => d.serial));
  const deviceFinds = new Map(bundles.map((b) => [b, deviceFindings(b, opts.thresholds)]));
  const flagged = bundles.filter((b) => (deviceFinds.get(b) as any[]).length);
  const totalFindings = bundles.reduce((n, b) => n + (deviceFinds.get(b) as any[]).length, 0);

  P(`# SimpleMDM Device Activity & Security Dossier — ${dateStr}`); P("");
  const account = opts.account ?? null;
  if (account) {
    P(`Account: **${cell(account.name)}**${account.total != null ? ` • licenses ${account.total - (account.available ?? 0)} used of ${account.total}` : ""}`); P("");
  }
  P(`Devices: **${bundles.length}** • Total log events: **${comma(totalEvents)}** • FileVault disabled: **${fvOff}/${bundles.length}**`); P("");
  const parts = ["the SimpleMDM /logs activity record"];
  if (securityEval) parts.push("the SOFA-evaluated security posture");
  if (hasInventory) parts.push("software inventory");
  const partsList = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  P(`This report combines, per device, ${partsList}. ${opts.reportOnly
    ? "This is a report-only export: the underlying records were not written alongside it — re-run without --report-only for the verbatim CSV/JSON artifacts."
    : "The CSV/JSON artifacts in this export remain authoritative; this document is a derived synthesis."}`); P("");

  if (noisy.length) {
    P(`> ⚠ **Noisy device${noisy.length > 1 ? "s" : ""}:** ` +
      noisy.map((d) => `${cell(d.name || d.serial)} (${d.serial}) — ${comma(d.events)} events, ${Math.round(d.share * 100)}% of all activity`).join("; ") +
      `. A single device dominating log volume skews the fleet totals above and can evict other devices' events from the retention-bounded /logs feed — read the per-device pivot, not just the totals. Marked ⚠ in the roll-up below.`);
    P("");
  }

  P(`## 1. Fleet Roll-up`); P("");
  P(`| # | Device | Serial | OS | Unfixed CVEs | FileVault | SIP | Firewall | Events | Last seen |`);
  P(`|---|---|---|---|---|---|---|---|---|---|`);
  bundles.forEach((b, i) => {
    const a = b.device.attributes ?? {};
    const ev = evBySerial.get(a.serial_number);
    const cve = ev ? `${ev.cvesBehind ?? 0}${ev.exploitedBehind ? ` (${ev.exploitedBehind} expl)` : ""}` : "—";
    const events = `${comma(b.logs?.length ?? 0)}${noisySerials.has(a.serial_number) ? " ⚠" : ""}`;
    P(`| ${i + 1} | ${cell((a.name || "").slice(0, 38))} | ${cell(a.serial_number)} | ${cell(a.os_version)} | ${cve} | ${onoff(a.filevault_enabled)} | ${onoff(a.system_integrity_protection_enabled)} | ${onoff(a.firewall?.enabled)} | ${events} | ${(a.last_seen_at || "").slice(0, 10)} |`);
  });
  P("");

  if (totalFindings) {
    P(`> 🔎 **Findings:** ${totalFindings} flagged across ${flagged.length} device${flagged.length > 1 ? "s" : ""} — see the ⚠ Findings blocks in the per-device sections. ` +
      `Highlights: ${flagged.slice(0, 3).map((b) => `${cell(b.device.attributes?.name || b.device.attributes?.serial_number)} — ${cell((deviceFinds.get(b) as any[])[0].title)}`).join("; ")}.`);
    P("");
  }

  P(`## 2. Per-Device Dossiers`); P("");
  bundles.forEach((b, i) => {
    const a = b.device.attributes ?? {};
    const ev = evBySerial.get(a.serial_number);
    const groupIds = (b.device.relationships?.groups?.data ?? []).map((g: any) => g.id);
    const groupNames = groupIds.map((id: any) => groupNameMap[String(id)]).filter(Boolean);
    const users = (b.users ?? []).map((u: any) => u.attributes?.username).filter(Boolean);
    const logs = b.logs ?? [];
    const counts = Object.fromEntries(EVENT_TYPES.map((et) => [et, logs.filter((l: any) => l.attributes?.event_type === et).length]));
    const isos = logs.map((l: any) => l.attributes?.at).filter(Boolean);
    const apps = b.apps ?? [];
    const managed = apps.filter((ap: any) => ap.attributes?.managed).length;
    const profiles = b.profiles ?? [];
    const swEvents = logs.filter((l: any) => l.attributes?.event_type === "status.changed").map((l: any) => {
      const m = l.attributes?.metadata ?? {};
      return { at: l.attributes.at, pend: dig(m, "status", "softwareupdate", "pending_version", "os_version"),
        state: dig(m, "status", "softwareupdate", "install_state"), fails: dig(m, "status", "softwareupdate", "failure_reason", "count") };
    }).filter((e: any) => e.fails || (e.pend && e.state && e.state !== "none"));

    P(`### 2.${i + 1}  ${cell(a.name || a.serial_number)}`); P("");
    P(`**Identity** — Serial \`${a.serial_number}\` • Model ${a.product_name || a.model || "—"} • OS ${a.os_version || "—"} (${a.build_version || ""}) • UDID \`${a.unique_identifier || ""}\` • Enrolled ${(a.enrolled_at || "").slice(0, 10)} • Last seen ${(a.last_seen_at || "").slice(0, 19).replace("T", " ")}`); P("");
    if (groupIds.length) { P(`**Assignment groups (${groupIds.length}):** ${groupNames.slice(0, 8).map(cell).join(", ")}${groupNames.length > 8 ? `, +${groupNames.length - 8} more` : ""}`); P(""); }
    if (users.length) { P(`**Local accounts:** ${users.slice(0, 8).map(cell).join(", ")}${users.length > 8 ? `, +${users.length - 8} more` : ""}`); P(""); }
    if (ev) {
      P(`**Security posture** — FileVault ${onoff(a.filevault_enabled)}; SIP ${onoff(a.system_integrity_protection_enabled)}; Firewall ${onoff(a.firewall?.enabled)}. Unfixed CVEs: **${ev.cvesBehind ?? 0}**${ev.exploitedBehind ? ` (${ev.exploitedBehind} actively exploited)` : ""}.`);
      if ((ev.findings || []).length) { P(""); P(`> Findings: ${cell(ev.findings.join("; "))}`); }
      P("");
    } else {
      P(`**Security posture** — FileVault ${onoff(a.filevault_enabled)}; SIP ${onoff(a.system_integrity_protection_enabled)}; Firewall ${onoff(a.firewall?.enabled)}. _(run with --with-security for CVE evaluation)_`); P("");
    }
    P(`**Activity (${logs.length} events)** — app installs ${counts["app.installing"]}, profile installs ${counts["profile.installed"]}, status changes ${counts["status.changed"]}, bootstrap-token ${counts["bootstrap_token.get"]}. Window: ${isos[0] || "—"} → ${isos[isos.length - 1] || "—"}.`); P("");
    if (apps.length || profiles.length) { P(`**Software inventory** — ${apps.length} installed apps (${managed} MDM-managed); ${profiles.length} configuration profiles.`); P(""); }
    if (swEvents.length) {
      P(`**Notable software-update events:**`); P("");
      P(`| When (at) | Pending OS | Install state | Failures |`); P(`|---|---|---|---|`);
      for (const e of swEvents.slice(0, 6)) P(`| ${cell(e.at)} | ${cell(e.pend || "—")} | ${cell(e.state || "—")} | ${e.fails || 0} |`);
      if (swEvents.length > 6) P(`| …+${swEvents.length - 6} more | | | |`);
      P("");
    }
    const topApps = topInstalledApps(b);
    if (detail !== "table" && topApps.length) {
      P(`**Top installed apps (by install count):**`); P("");
      P(`| App | Version | Installs |`); P(`|---|---|---|`);
      for (const ap of topApps) P(`| ${cell(ap.name || ap.identifier || "—")} | ${cell(ap.version || "—")} | ${ap.count} |`);
      P("");
    }
    const finds = deviceFinds.get(b) as any[];
    if (finds.length) {
      P(`> ⚠ **Findings (${finds.length}):**`);
      for (const f of finds) P(`> - **${cell(f.title)}** — ${cell(f.detail)}`);
      P("");
    }
    if (detail === "table" || detail === "full") {
      P(`**Full event log (${logs.length} events):**`); P("");
      P(`| at_iso | at | event | summary |`); P(`|---|---|---|---|`);
      for (const r of logRows([b])) P(`| ${r.at_iso} | ${cell(r.at)} | ${r.event_type} | ${cell(r.summary)} |`);
      P("");
    }
    P(`---`); P("");
  });

  P(`## 3. Disclosures`); P("");
  P(`- **Timestamps:** \`at\` is verbatim from /logs (account display timezone, America/New_York; no UTC offset stamped). ISO renderings apply no shift and are NOT UTC.`);
  P(`- **Retention:** the /logs feed is retention-bounded; the earliest event per device is the API retention horizon, not device-lifetime history.`);
  P(opts.reportOnly
    ? `- **Authoritative sources:** this is a report-only export — the verbatim per-event records were not written. Re-run without --report-only to export the CSV/JSON artifacts and full status.changed snapshots.`
    : `- **Authoritative sources:** the CSV and raw-logs.json artifacts are the verbatim record; this document is a derived synthesis. Full status.changed snapshots are in status-snapshots/ and raw-logs.json.`); P("");
  return out.join("\n");
}
