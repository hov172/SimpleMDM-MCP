import { compareVersions } from "./sofa-eval.js";

export class QueryError extends Error {}

type R = Record<string, any>;
type Tri = boolean | "unknown";
interface Hits { apps: Set<string>; profiles: Set<string>; users: Set<string> }

export interface Alt {
  match: string;
  text?: string;
  re?: RegExp;
  op?: string;
  value?: string | boolean;
  lo?: string | number;
  hi?: string | number;
  days?: number;
  t?: number;
  day?: string;
  n?: number;
  name?: string;
  ver?: string;
}

export interface Term {
  neg: boolean;
  field: string | null;
  src: string;
  alts: Alt[];
  attrName?: string;
  /** Non-fatal lint messages (e.g. an unknown enum value that can't match).
   *  Only set when non-empty so a clean term deep-equals its plain shape. */
  warnings?: string[];
}

export interface Unit { terms: Term[] }
export interface Ast { units: Unit[]; warnings: string[] }

interface FieldDef {
  kind: string;
  scope: "device" | "per-device";
  section?: string;
  get?: (r: R) => any;
  /** Closed set of values the engine can emit for this field. When present, a
   *  value that is neither one of these nor a declared alias is flagged as a
   *  warning instead of silently matching nothing. */
  values?: string[];
  /** Friendly umbrella words the engine never emits, expanded to the canonical
   *  values they cover (e.g. type:mac → laptop,imac,desktop,mac). */
  aliases?: Record<string, string[]>;
}

// Canonical device-type tokens produced by deriveType() in inventory.ts. Keep in
// sync with that function. `mac` is the fallback bucket for Apple-silicon model
// IDs (Mac<n>,<n>) whose marketing name didn't resolve to a specific form factor.
const TYPE_VALUES = ["laptop", "imac", "desktop", "mac", "ipad", "iphone", "appletv", "other"];
// `type:mac`/`type:computer` span every Mac bucket so the query reliably returns
// laptops, iMacs, desktops and the unresolved-model `mac` bucket — not just the
// substring-coincidental `imac`. The others read naturally for non-Mac devices.
const TYPE_ALIASES: Record<string, string[]> = {
  mac:      ["laptop", "imac", "desktop", "mac"],
  computer: ["laptop", "imac", "desktop", "mac"],
  tablet:   ["ipad"],
  phone:    ["iphone"],
  mobile:   ["iphone"],
  tv:       ["appletv"],
};

export function tokenize(q: unknown): string[] {
  const out: string[] = [];
  const s = String(q ?? "");
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let buf = "";
    let quoted = false;
    while (i < s.length && (quoted || !/\s/.test(s[i]))) {
      if (s[i] === '"') quoted = !quoted;
      buf += s[i];
      i++;
    }
    if (quoted) throw new QueryError(`Unbalanced quote in: ${buf}`);
    out.push(buf);
  }
  return out;
}

export const FIELDS: Record<string, FieldDef> = {
  name:           { kind: "text",         scope: "device",     get: (r) => [r.name] },
  devicename:     { kind: "text",         scope: "device",     get: (r) => [r.device_name] },
  serial:         { kind: "text",         scope: "device",     get: (r) => [r.serial] },
  udid:           { kind: "text",         scope: "device",     get: (r) => [r.udid] },
  imei:           { kind: "text",         scope: "device",     get: (r) => [r.imei] },
  mac:            { kind: "text",         scope: "device",     get: (r) => [r.wifi_mac, r.bluetooth_mac, ...(r.ethernet_macs ?? [])] },
  ip:             { kind: "text",         scope: "device",     get: (r) => [r.last_ip] },
  model:          { kind: "text",         scope: "device",     get: (r) => [r.model_id, r.model_name] },
  type:           { kind: "text",         scope: "device",     get: (r) => [r.type], values: TYPE_VALUES, aliases: TYPE_ALIASES },
  arch:           { kind: "text",         scope: "device",     get: (r) => [r.arch] },
  os:             { kind: "version",      scope: "device",     get: (r) => r.os_version },
  build:          { kind: "text",         scope: "device",     get: (r) => [r.build_version] },
  group:          { kind: "text",         scope: "device",     get: (r) => [r.device_group, ...(r.assignment_groups ?? [])] },
  devicegroup:    { kind: "text",         scope: "device",     get: (r) => [r.device_group] },
  assignment:     { kind: "text",         scope: "device",     get: (r) => r.assignment_groups ?? [] },
  assigned:       { kind: "text",         scope: "device",     get: (r) => r.assigned_apps ?? [] },
  seen:           { kind: "date",         scope: "device",     get: (r) => r.seen_at },
  enrolled:       { kind: "date",         scope: "device",     get: (r) => r.enrolled_at },
  storage:        { kind: "number",       scope: "device",     get: (r) => r.storage_free_gb },
  battery:        { kind: "number",       scope: "device",     get: (r) => r.battery_pct },
  filevault:      { kind: "bool",         scope: "device",     get: (r) => r.filevault },
  sip:            { kind: "bool",         scope: "device",     get: (r) => r.sip },
  firewall:       { kind: "bool",         scope: "device",     get: (r) => r.firewall },
  supervised:     { kind: "bool",         scope: "device",     get: (r) => r.supervised },
  recoverykey:    { kind: "bool",         scope: "device",     get: (r) => r.recoverykey },
  dep:            { kind: "bool",         scope: "device",     get: (r) => r.dep },
  ard:            { kind: "bool",         scope: "device",     get: (r) => r.ard },
  uamdm:          { kind: "bool",         scope: "device",     get: (r) => r.uamdm },
  ddm:            { kind: "bool",         scope: "device",     get: (r) => r.ddm },
  activationlock: { kind: "bool",         scope: "device",     get: (r) => r.activation_lock },
  lostmode:       { kind: "bool",         scope: "device",     get: (r) => r.lost_mode },
  firmwarelock:   { kind: "bool",         scope: "device",     get: (r) => r.firmware_lock },
  recoverylock:   { kind: "bool",         scope: "device",     get: (r) => r.recovery_lock },
  passcode:       { kind: "bool",         scope: "device",     get: (r) => r.passcode_present },
  status:         { kind: "text",         scope: "device",     get: (r) => [r.status] },
  app:            { kind: "app",          scope: "per-device", section: "apps" },
  profile:        { kind: "section-text", scope: "per-device", section: "profiles", get: (r) => (r.profiles ?? []).map((p: any) => p.name) },
  user:           { kind: "section-text", scope: "per-device", section: "users",    get: (r) => (r.users ?? []).flatMap((u: any) => [u.username, u.full_name]) },
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripQuotes = (s: string) => s.replace(/"/g, "");

function splitCommaQuoteAware(raw: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') { quoted = !quoted; buf += ch; continue; }
    if (ch === "," && !quoted) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

function splitRange(raw: string): [string, string] | null {
  const i = raw.indexOf("..");
  if (i > 0 && i + 2 < raw.length) return [raw.slice(0, i), raw.slice(i + 2)];
  return null;
}

const CMP_RE = /^(>=|<=|>|<)(.+)$/;

function parseDateMs(s: string, src: string): number {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(t)) throw new QueryError(`Bad date "${s}" in "${src}" — use YYYY-MM-DD or Nd (e.g. 90d)`);
  return t;
}

function parseAlt(kind: string, part: string, src: string): Alt {
  if (kind === "text" || kind === "section-text") {
    if (part.includes("*")) return { match: "glob", re: new RegExp("^" + part.split("*").map(escapeRe).join(".*") + "$", "i") };
    return { match: "substr", text: part.toLowerCase() };
  }
  if (kind === "version") {
    const m = part.match(CMP_RE);
    if (m) return { match: "cmp", op: m[1], value: m[2] };
    const r = splitRange(part);
    if (r) return { match: "range", lo: r[0], hi: r[1] };
    return { match: "verbare", value: part };
  }
  if (kind === "date") {
    const rel = part.match(/^(\d+)d$/i);
    if (rel) return { match: "rel", days: parseInt(rel[1], 10) };
    const m = part.match(CMP_RE);
    if (m) return { match: "cmp", op: m[1], t: parseDateMs(m[2], src) };
    const r = splitRange(part);
    if (r) return { match: "range", lo: parseDateMs(r[0], src), hi: parseDateMs(r[1], src) + 86399999 };
    parseDateMs(part, src);
    return { match: "day", day: part };
  }
  if (kind === "number") {
    const m = part.match(CMP_RE);
    const num = (sv: string) => { const n = parseFloat(sv); if (!Number.isFinite(n)) throw new QueryError(`Bad number "${sv}" in "${src}"`); return n; };
    if (m) return { match: "cmp", op: m[1], n: num(m[2]) };
    const r = splitRange(part);
    if (r) return { match: "range", lo: num(r[0]), hi: num(r[1]) };
    return { match: "eq", n: num(part) };
  }
  if (kind === "bool") {
    const v = part.toLowerCase();
    if (["on", "yes", "true", "1"].includes(v)) return { match: "bool", value: true };
    if (["off", "no", "false", "0"].includes(v)) return { match: "bool", value: false };
    throw new QueryError(`"${src}" takes on/off (or yes/no)`);
  }
  if (kind === "app") {
    const m = part.match(/^(.+?)(>=|<=|>|<)([\w.]+)$/);
    if (m) return { match: "app", name: m[1].toLowerCase(), op: m[2], ver: m[3] };
    return { match: "app", name: part.toLowerCase() };
  }
  throw new QueryError(`Internal: unknown kind ${kind}`);
}

function parseValue(kind: string, raw: string, src: string): Alt[] {
  const alts = splitCommaQuoteAware(raw).map((s) => stripQuotes(s).trim()).filter(Boolean).map((p) => parseAlt(kind, p, src));
  if (!alts.length) throw new QueryError(`Field needs a value in "${src}"`);
  return alts;
}

// For enum fields (those with a `values` set), expand aliases to their canonical
// tokens and report any value that can match nothing. Globs (containing *) pass
// through untouched and are never flagged — `type:mac*` is a deliberate pattern.
// Unknown values are kept verbatim so the query still parses (and matches zero),
// while the returned `unknown` list lets the caller warn loudly.
function expandEnumValue(field: FieldDef, fieldName: string, raw: string): { value: string; unknown: string[] } {
  if (!field.values) return { value: raw, unknown: [] };
  const known = new Set(field.values);
  const aliases = field.aliases ?? {};
  const out: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => { if (!seen.has(v)) { seen.add(v); out.push(v); } };
  for (const partRaw of splitCommaQuoteAware(raw)) {
    const part = stripQuotes(partRaw).trim();
    if (!part) continue;
    if (part.includes("*")) { push(part); continue; }
    const lc = part.toLowerCase();
    const expanded = aliases[lc] ?? (known.has(lc) ? [lc] : null);
    if (expanded === null) { unknown.push(part); push(part); continue; }
    expanded.forEach(push);
  }
  return { value: out.join(","), unknown };
}

function enumWarnings(field: FieldDef, fieldName: string, unknown: string[]): string[] {
  if (!unknown.length) return [];
  const valid = [...new Set([...(field.values ?? []), ...Object.keys(field.aliases ?? {})])].join(", ");
  return unknown.map(
    (u) => `${fieldName}:${u} — "${u}" is not a known ${fieldName} value, so nothing will match it. Valid: ${valid}.`,
  );
}

export function parseTerm(token: string): Term {
  const src = token;
  let tok = token;
  let neg = false;
  if (tok.startsWith("-") && tok.length > 1) { neg = true; tok = tok.slice(1); }
  const colon = tok.indexOf(":");
  const quote = tok.indexOf('"');
  if (colon > 0 && (quote === -1 || colon < quote)) {
    const fieldRaw = tok.slice(0, colon).toLowerCase();
    const valueRaw = tok.slice(colon + 1);
    const valueStripped = stripQuotes(valueRaw);
    if (fieldRaw.startsWith("attr.")) {
      const attrName = fieldRaw.slice(5);
      if (!attrName) throw new QueryError(`attr. filter needs a name, e.g. attr.xprotect_version:5305 (got "${src}")`);
      if (valueStripped === "") throw new QueryError(`Field "${fieldRaw}:" needs a value`);
      return { neg, field: "attr", attrName, src, alts: parseValue("text", valueRaw, src) };
    }
    if (fieldRaw in FIELDS) {
      if (valueStripped === "") throw new QueryError(`Field "${fieldRaw}:" needs a value`);
      const fdef = FIELDS[fieldRaw];
      const { value: expandedValue, unknown } = expandEnumValue(fdef, fieldRaw, valueRaw);
      const term: Term = { neg, field: fieldRaw, src, alts: parseValue(fdef.kind, expandedValue, src) };
      const warnings = enumWarnings(fdef, fieldRaw, unknown);
      if (warnings.length) term.warnings = warnings;
      return term;
    }
    throw new QueryError(`Unknown field "${fieldRaw}:" — valid fields: ${Object.keys(FIELDS).join(", ")}, attr.<name>`);
  }
  return { neg, field: null, src, alts: [{ match: "substr", text: stripQuotes(tok).toLowerCase() }] };
}

export function parseQuery(q: string): Ast {
  const toks = tokenize(q);
  if (!toks.length) throw new QueryError("Empty --search query");
  const units: Unit[] = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i].toUpperCase() === "OR") throw new QueryError(`"OR" needs a term on both sides`);
    const terms = [parseTerm(toks[i])];
    i++;
    while (i < toks.length && toks[i].toUpperCase() === "OR") {
      if (i + 1 >= toks.length) throw new QueryError(`"OR" needs a term on both sides`);
      terms.push(parseTerm(toks[i + 1]));
      i += 2;
    }
    units.push({ terms });
  }
  const warnings = units.flatMap((u) => u.terms).flatMap((t) => t.warnings ?? []);
  return { units, warnings };
}

export function termScope(term: Term): "device" | "per-device" {
  if (term.field === null) return "per-device";
  if (term.field === "attr") return "device";
  return FIELDS[term.field].scope;
}

export function planQuery(ast: Ast): { deviceUnits: Unit[]; perDeviceUnits: Unit[] } {
  const deviceUnits: Unit[] = [];
  const perDeviceUnits: Unit[] = [];
  for (const u of ast.units) {
    (u.terms.every((t) => termScope(t) === "device") ? deviceUnits : perDeviceUnits).push(u);
  }
  return { deviceUnits, perDeviceUnits };
}

export function sectionsReferenced(ast: Ast): Set<string> {
  const s = new Set<string>();
  for (const u of ast?.units ?? []) {
    for (const t of u.terms) {
      const sec = t.field && FIELDS[t.field]?.section;
      if (sec) s.add(sec);
    }
  }
  return s;
}

const cmpSign = (op: string, sign: number): boolean =>
  op === ">" ? sign > 0 : op === "<" ? sign < 0 : op === ">=" ? sign >= 0 : sign <= 0;

function matchTextAlt(alt: Alt, values: unknown[]): boolean {
  const hays = (values ?? []).filter((v) => v !== null && v !== undefined && v !== "").map(String);
  if (alt.match === "glob") return hays.some((h) => alt.re!.test(h));
  return hays.some((h) => h.toLowerCase().includes(alt.text!));
}

function matchVersionAlt(alt: Alt, ver: unknown): boolean {
  if (!ver) return false;
  const v = String(ver);
  if (alt.match === "cmp") return cmpSign(alt.op!, compareVersions(v, alt.value as string));
  if (alt.match === "range") return compareVersions(v, alt.lo as string) >= 0 && compareVersions(v, alt.hi as string) <= 0;
  return v === (alt.value as string) || v.startsWith((alt.value as string) + ".");
}

function matchDateAlt(alt: Alt, iso: unknown, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return false;
  if (alt.match === "rel") return t >= now - alt.days! * 86400000;
  if (alt.match === "cmp") return cmpSign(alt.op!, t - alt.t!);
  if (alt.match === "range") return t >= (alt.lo as number) && t <= (alt.hi as number);
  return String(iso).slice(0, 10) === alt.day;
}

function matchNumberAlt(alt: Alt, n: unknown): boolean {
  if (n === null || n === undefined || !Number.isFinite(n as number)) return false;
  const num = n as number;
  if (alt.match === "cmp") return cmpSign(alt.op!, num - alt.n!);
  if (alt.match === "range") return num >= (alt.lo as number) && num <= (alt.hi as number);
  return num === alt.n;
}

function matchAppAlt(alt: Alt, apps: any[] | null | undefined, hits: Hits | null): boolean {
  let hit = false;
  for (const a of apps ?? []) {
    const hay = `${a.name ?? ""} ${a.identifier ?? ""}`.toLowerCase();
    if (!hay.includes(alt.name!)) continue;
    if (alt.op) {
      if (!a.version) continue;
      if (!cmpSign(alt.op, compareVersions(String(a.version), alt.ver!))) continue;
    }
    hit = true;
    if (hits) hits.apps.add(a.name ?? a.identifier ?? "");
  }
  return hit;
}

const triNot = (v: Tri): Tri => (v === "unknown" ? "unknown" : !v);
const triOr  = (vs: Tri[]): Tri => (vs.includes(true) ? true : vs.includes("unknown") ? "unknown" : false);
const triAnd = (vs: Tri[]): Tri => (vs.includes(false) ? false : vs.includes("unknown") ? "unknown" : true);

function keywordHaystack(r: R): string[] {
  return [
    r.name, r.device_name, r.serial, r.udid, r.imei, r.wifi_mac, r.bluetooth_mac, ...(r.ethernet_macs ?? []), r.last_ip,
    r.model_id, r.model_name, r.model_year, r.type, r.arch, r.os_version, r.build_version, r.rsr,
    r.device_group, ...(r.assignment_groups ?? []), ...(r.assigned_apps ?? []),
    r.meid, r.iccid, r.time_zone, ...(r.enrollment_channels ?? []),
    r.status, ...Object.values(r.attrs ?? {}),
  ].filter((v) => v !== null && v !== undefined).map(String);
}

function evalKeyword(alt: Alt, r: R, hits: Hits | null): Tri {
  if (matchTextAlt(alt, keywordHaystack(r))) return true;
  let unavailable = false;
  const hitsMap = hits as Record<string, Set<string>> | null;
  for (const [section, getter] of [
    ["apps",     (a: any) => [a.name, a.identifier, a.version]],
    ["profiles", (p: any) => [p.name, p.identifier]],
    ["users",    (u: any) => [u.username, u.full_name]],
  ] as Array<[string, (x: any) => unknown[]]>) {
    const st: string | undefined = (r.sections as Record<string, string> | undefined)?.[section];
    if (st === "ok") {
      for (const it of (r[section] as any[]) ?? []) {
        if (matchTextAlt(alt, getter(it))) {
          if (hitsMap) hitsMap[section].add(it.name ?? it.username ?? "");
          return true;
        }
      }
    } else if (st === "failed" || st === "pending") {
      unavailable = true;
    }
  }
  return unavailable ? "unknown" : false;
}

function evalTerm(term: Term, r: R, now: number, hits: Hits): Tri {
  let v: Tri;
  if (term.field === null) {
    v = triOr(term.alts.map((alt) => evalKeyword(alt, r, term.neg ? null : hits)));
  } else if (term.field === "attr") {
    v = triOr(term.alts.map((alt) => matchTextAlt(alt, [(r.attrs as any)?.[term.attrName!]])));
  } else {
    const f = FIELDS[term.field];
    if (f.scope === "per-device") {
      const st: string | undefined = (r.sections as Record<string, string> | undefined)?.[f.section!];
      if (st === "failed" || st === "pending") {
        v = "unknown";
      } else if (f.kind === "app") {
        v = triOr(term.alts.map((alt) => matchAppAlt(alt, r.apps as any[], term.neg ? null : hits)));
      } else {
        v = triOr(term.alts.map((alt) => matchTextAlt(alt, f.get!(r))));
        if (v === true && !term.neg) {
          const items: any[] = (f.section === "profiles" ? r.profiles : r.users) as any[] ?? [];
          const hitsMap = hits as unknown as Record<string, Set<string>>;
          for (const it of items) {
            const names = f.section === "profiles" ? [it.name, it.identifier] : [it.username, it.full_name];
            if (term.alts.some((alt) => matchTextAlt(alt, names))) hitsMap[f.section!].add(it.name ?? it.username ?? "");
          }
        }
      }
    } else if (f.kind === "version") v = triOr(term.alts.map((alt) => matchVersionAlt(alt, f.get!(r))));
    else if (f.kind === "date")    v = triOr(term.alts.map((alt) => matchDateAlt(alt, f.get!(r), now)));
    else if (f.kind === "number")  v = triOr(term.alts.map((alt) => matchNumberAlt(alt, f.get!(r))));
    else if (f.kind === "bool")    v = triOr(term.alts.map((alt) => f.get!(r) === alt.value));
    else                           v = triOr(term.alts.map((alt) => matchTextAlt(alt, f.get!(r))));
  }
  return term.neg ? triNot(v!) : v!;
}

export function evaluate(
  ast: Ast,
  record: R,
  { now = Date.now() }: { now?: number } = {},
): { matched: Tri; reasons: string[]; hits: Hits } {
  const hits: Hits = { apps: new Set(), profiles: new Set(), users: new Set() };
  const reasons: string[] = [];
  const unitVals: Tri[] = [];
  for (const u of ast.units) {
    const termVals = u.terms.map((t) => {
      const v = evalTerm(t, record, now, hits);
      if (v === true) reasons.push(t.src);
      if (v === "unknown") reasons.push(`${t.src} (undetermined: data unavailable)`);
      return v;
    });
    unitVals.push(triOr(termVals));
  }
  return { matched: triAnd(unitVals), reasons, hits };
}
