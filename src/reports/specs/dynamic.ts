import { Dossier } from "../engine/dossier.js";
import type { Column, Row } from "../engine/csv.js";
import type { PageStyle } from "../engine/document.js";
import type { DataSource, Scope } from "../data/source.js";

// Data adapters a dynamic spec may draw rows from. Each maps to a DataSource fetch
// (wired in cli/index); buildDynamicDossier itself is pure and takes already-fetched data.
export const DATA_ADAPTERS = ["devices", "apps", "profiles", "users", "logs", "posture"] as const;
export type DataAdapter = (typeof DATA_ADAPTERS)[number];

// Generic row filter — works over ANY adapter's rows (dot-path field access),
// independent of the device-specific inventory query engine.
export const FILTER_OPS = ["eq", "ne", "contains", "icontains", "gt", "lt", "gte", "lte", "exists", "absent", "in"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export interface FilterCond { field: string; op: FilterOp; value?: unknown }

export interface DynamicSection {
  heading: string;
  // `filter` (optional): keep only rows matching ALL conditions before rendering.
  table: { columns: Column[]; from: string; csvName?: string; filter?: FilterCond[] };
}

// Dot-path field access ("attributes.name" → row.attributes.name).
function getPath(row: any, path: string): unknown {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row);
}

function condPasses(row: any, c: FilterCond): boolean {
  const v = getPath(row, c.field);
  switch (c.op) {
    case "exists": return v != null && v !== "";
    case "absent": return v == null || v === "";
    case "in": return Array.isArray(c.value) && (c.value as unknown[]).some((x) => String(x) === String(v));
    case "contains": return String(v ?? "").includes(String(c.value ?? ""));
    case "icontains": return String(v ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
    case "eq": return typeof c.value === "boolean" ? v === c.value : String(v) === String(c.value);
    case "ne": return typeof c.value === "boolean" ? v !== c.value : String(v) !== String(c.value);
    default: { // gt/lt/gte/lte: numeric when both look numeric, else lexical (works for ISO dates/versions)
      const a = v, b = c.value as any;
      const na = Number(a), nb = Number(b);
      const numeric = a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb);
      const cmp = numeric ? (na < nb ? -1 : na > nb ? 1 : 0) : String(a ?? "").localeCompare(String(b ?? ""));
      return c.op === "gt" ? cmp > 0 : c.op === "lt" ? cmp < 0 : c.op === "gte" ? cmp >= 0 : cmp <= 0;
    }
  }
}

// Keep rows matching EVERY condition (AND). No conditions → all rows.
export function applyFilter<T extends Record<string, any>>(rows: T[], conds?: FilterCond[]): T[] {
  if (!conds || conds.length === 0) return rows;
  return rows.filter((r) => conds.every((c) => condPasses(r, c)));
}

export interface DynamicReportSpec {
  title: string;
  pageStyle?: PageStyle;   // optional — auto-selected by table width when omitted (see autoPageStyle)
  footerTitle?: string;
  mdName?: string;
  dataAdapter: DataAdapter;
  sections: DynamicSection[];
}

// Pick page orientation from the widest table when the spec omits pageStyle.
// Portrait reads best for narrow tables; landscape (compact A4, then roomy A3)
// for wide ones — mirroring why the built-in audit report defaults to A3.
// Thresholds: ≤6 cols → portrait, 7–12 → A4 landscape, ≥13 → A3 landscape.
export function autoPageStyle(spec: { pageStyle?: PageStyle; sections: Array<{ table: { columns: unknown[] } }> }): PageStyle {
  if (spec.pageStyle) return spec.pageStyle;
  const maxCols = spec.sections.reduce((m, s) => Math.max(m, s.table.columns.length), 0);
  if (maxCols >= 13) return "a3-landscape";
  if (maxCols >= 7) return "a4-landscape";
  return "letter-portrait";
}

// Maps a declarative spec onto the house-style Dossier. `data` is a bag keyed by the
// adapter's result shape; each section's `table.from` selects an array of rows from it.
export function buildDynamicDossier(spec: DynamicReportSpec, data: Record<string, unknown>): Dossier {
  const dossier = new Dossier({
    title: spec.title,
    pageStyle: autoPageStyle(spec),
    footerTitle: spec.footerTitle ?? spec.title,
    mdName: spec.mdName,
  });

  for (const sec of spec.sections) {
    const all = (data[sec.table.from] as Row[] | undefined) ?? [];
    const rows = applyFilter(all, sec.table.filter);
    dossier.section(sec.heading).table(sec.table.columns, rows, sec.table.csvName);
  }

  return dossier;
}

const PAGE_STYLES: PageStyle[] = ["a3-landscape", "a4-landscape", "letter-portrait"];

// Validates a caller-supplied spec object. Returns an error string, or null if valid.
// Type-checks every field a malformed caller could otherwise sneak through to
// Dossier.write() / headHtml(), where it would throw a raw TypeError instead of a
// clean {error} response.
export function validateDynamicSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "spec must be an object";
  const s = spec as Record<string, unknown>;
  if (typeof s.title !== "string" || !s.title.trim()) return "spec must have a non-empty title";
  if (!Array.isArray(s.sections) || s.sections.length === 0) {
    return "spec must have at least one section";
  }
  if (!DATA_ADAPTERS.includes(s.dataAdapter as DataAdapter)) {
    return `unknown dataAdapter "${String(s.dataAdapter)}"; valid: ${DATA_ADAPTERS.join(", ")}`;
  }
  // pageStyle is optional (auto-selected by table width when absent); validate only if present.
  if (s.pageStyle != null && !PAGE_STYLES.includes(s.pageStyle as PageStyle)) {
    return `spec.pageStyle must be one of: ${PAGE_STYLES.join(", ")}`;
  }
  if (s.mdName != null && typeof s.mdName !== "string") return "spec.mdName must be a string when present";
  if (s.footerTitle != null && typeof s.footerTitle !== "string") return "spec.footerTitle must be a string when present";
  for (const sec of s.sections as Array<Record<string, unknown>>) {
    if (!sec || typeof sec.heading !== "string") return "each section needs a heading";
    const table = sec.table as Record<string, unknown> | undefined;
    if (!table || !Array.isArray(table.columns) || typeof table.from !== "string") {
      return "each section needs a table with { columns, from }";
    }
    if (table.columns.length === 0) return "each section table needs at least one column";
    for (const col of table.columns as Array<Record<string, unknown>>) {
      if (!col || typeof col.key !== "string" || typeof col.header !== "string") {
        return "each table column needs string { key, header }";
      }
    }
    if (table.filter != null) {
      if (!Array.isArray(table.filter)) return "table.filter must be an array of { field, op, value? } conditions";
      for (const f of table.filter as Array<Record<string, unknown>>) {
        if (!f || typeof f.field !== "string") return "each filter condition needs a string field";
        if (!FILTER_OPS.includes(f.op as FilterOp)) return `each filter condition needs op one of: ${FILTER_OPS.join(", ")}`;
      }
    }
  }
  return null;
}

// Routes a dataAdapter to its DataSource method. Injectable source → unit-testable
// offline. Returns the adapter's row array (placed under the "rows" key by the caller).
export function adapterRows(source: DataSource, adapter: DataAdapter, scope?: Scope): Promise<any[]> {
  switch (adapter) {
    case "devices": return source.devices(scope);
    case "apps": return source.apps(scope);
    case "profiles": return source.profiles(scope);
    case "users": return source.users(scope);
    case "posture": return source.securityPosture(scope);
    case "logs": return source.logs(scope ?? { kind: "all" });
  }
}
