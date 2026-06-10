import { compareVersions } from "./evaluate.mjs";

export class QueryError extends Error {}

// Whitespace-split tokenizer; double quotes glue spaces into one token and are
// kept in the token (stripped later by the term parser).
export function tokenize(q) {
  const out = [];
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

// Field registry. scope "device" = answerable from the fleet sweep; "per-device"
// needs per-device fetches. section names match record.sections keys.
export const FIELDS = {
  name:        { kind: "text",    scope: "device",     get: (r) => [r.name] },
  devicename:  { kind: "text",    scope: "device",     get: (r) => [r.device_name] },
  serial:      { kind: "text",    scope: "device",     get: (r) => [r.serial] },
  udid:        { kind: "text",    scope: "device",     get: (r) => [r.udid] },
  imei:        { kind: "text",    scope: "device",     get: (r) => [r.imei] },
  mac:         { kind: "text",    scope: "device",     get: (r) => [r.wifi_mac, ...(r.ethernet_macs ?? [])] },
  ip:          { kind: "text",    scope: "device",     get: (r) => [r.last_ip] },
  model:       { kind: "text",    scope: "device",     get: (r) => [r.model_id, r.model_name] },
  type:        { kind: "text",    scope: "device",     get: (r) => [r.type] },
  arch:        { kind: "text",    scope: "device",     get: (r) => [r.arch] },
  os:          { kind: "version", scope: "device",     get: (r) => r.os_version },
  build:       { kind: "text",    scope: "device",     get: (r) => [r.build_version] },
  group:       { kind: "text",    scope: "device",     get: (r) => [r.device_group, ...(r.assignment_groups ?? [])] },
  assignment:  { kind: "text",    scope: "device",     get: (r) => r.assignment_groups ?? [] },
  assigned:    { kind: "text",    scope: "device",     get: (r) => r.assigned_apps ?? [] },
  seen:        { kind: "date",    scope: "device",     get: (r) => r.seen_at },
  enrolled:    { kind: "date",    scope: "device",     get: (r) => r.enrolled_at },
  storage:     { kind: "number",  scope: "device",     get: (r) => r.storage_free_gb },
  battery:     { kind: "number",  scope: "device",     get: (r) => r.battery_pct },
  filevault:   { kind: "bool",    scope: "device",     get: (r) => r.filevault },
  sip:         { kind: "bool",    scope: "device",     get: (r) => r.sip },
  firewall:    { kind: "bool",    scope: "device",     get: (r) => r.firewall },
  supervised:  { kind: "bool",    scope: "device",     get: (r) => r.supervised },
  recoverykey: { kind: "bool",    scope: "device",     get: (r) => r.recoverykey },
  dep:         { kind: "bool",    scope: "device",     get: (r) => r.dep },
  status:      { kind: "text",    scope: "device",     get: (r) => [r.status] },
  app:         { kind: "app",          scope: "per-device", section: "apps" },
  profile:     { kind: "section-text", scope: "per-device", section: "profiles", get: (r) => (r.profiles ?? []).map((p) => p.name) },
  user:        { kind: "section-text", scope: "per-device", section: "users",    get: (r) => (r.users ?? []).flatMap((u) => [u.username, u.full_name]) },
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripQuotes = (s) => s.replace(/"/g, "");

function splitRange(raw) {
  const i = raw.indexOf("..");
  if (i > 0 && i + 2 < raw.length) return [raw.slice(0, i), raw.slice(i + 2)];
  return null;
}

const CMP_RE = /^(>=|<=|>|<)(.+)$/;

function parseDateMs(s, src) {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(t)) throw new QueryError(`Bad date "${s}" in "${src}" — use YYYY-MM-DD or Nd (e.g. 90d)`);
  return t;
}

function parseAlt(kind, part, src) {
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
    parseDateMs(part, src); // validates
    return { match: "day", day: part };
  }
  if (kind === "number") {
    const m = part.match(CMP_RE);
    const num = (s) => { const n = parseFloat(s); if (!Number.isFinite(n)) throw new QueryError(`Bad number "${s}" in "${src}"`); return n; };
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

function parseValue(kind, raw, src) {
  const alts = raw.split(",").map((s) => s.trim()).filter(Boolean).map((p) => parseAlt(kind, p, src));
  if (!alts.length) throw new QueryError(`Field needs a value in "${src}"`);
  return alts;
}

export function parseTerm(token) {
  const src = token;
  let tok = token;
  let neg = false;
  if (tok.startsWith("-") && tok.length > 1) { neg = true; tok = tok.slice(1); }
  const colon = tok.indexOf(":");
  const quote = tok.indexOf('"');
  if (colon > 0 && (quote === -1 || colon < quote)) {
    const fieldRaw = tok.slice(0, colon).toLowerCase();
    const valueRaw = stripQuotes(tok.slice(colon + 1));
    if (fieldRaw.startsWith("attr.")) {
      const attrName = fieldRaw.slice(5);
      if (!attrName) throw new QueryError(`attr. filter needs a name, e.g. attr.xprotect_version:5305 (got "${src}")`);
      if (valueRaw === "") throw new QueryError(`Field "${fieldRaw}:" needs a value`);
      return { neg, field: "attr", attrName, src, alts: parseValue("text", valueRaw, src) };
    }
    if (fieldRaw in FIELDS) {
      if (valueRaw === "") throw new QueryError(`Field "${fieldRaw}:" needs a value`);
      return { neg, field: fieldRaw, src, alts: parseValue(FIELDS[fieldRaw].kind, valueRaw, src) };
    }
    throw new QueryError(`Unknown field "${fieldRaw}:" — valid fields: ${Object.keys(FIELDS).join(", ")}, attr.<name>`);
  }
  return { neg, field: null, src, alts: [{ match: "substr", text: stripQuotes(tok).toLowerCase() }] };
}

export function parseQuery(q) {
  const toks = tokenize(q);
  if (!toks.length) throw new QueryError("Empty --search query");
  const units = [];
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
  return { units };
}

export function termScope(term) {
  if (term.field === null) return "per-device";           // bare keyword can match anything
  if (term.field === "attr") return "device";
  return FIELDS[term.field].scope;
}

// A unit prefilters ONLY if every OR alternative is device-level: every match
// must satisfy every AND unit, so conjunctive device-level units are a sound
// prefilter; a mixed OR could be satisfied by its per-device branch alone.
export function planQuery(ast) {
  const deviceUnits = [];
  const perDeviceUnits = [];
  for (const u of ast.units) {
    (u.terms.every((t) => termScope(t) === "device") ? deviceUnits : perDeviceUnits).push(u);
  }
  return { deviceUnits, perDeviceUnits };
}

export function sectionsReferenced(ast) {
  const s = new Set();
  for (const u of ast?.units ?? []) {
    for (const t of u.terms) {
      const sec = t.field && FIELDS[t.field]?.section;
      if (sec) s.add(sec);
    }
  }
  return s;
}
