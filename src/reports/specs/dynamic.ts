import { Dossier } from "../engine/dossier.js";
import type { Column, Row } from "../engine/csv.js";
import type { PageStyle } from "../engine/document.js";
import type { DataSource, Scope } from "../data/source.js";

// Data adapters a dynamic spec may draw rows from. Each maps to a DataSource fetch
// (wired in cli/index); buildDynamicDossier itself is pure and takes already-fetched data.
export const DATA_ADAPTERS = ["devices", "apps", "profiles", "users", "logs", "posture"] as const;
export type DataAdapter = (typeof DATA_ADAPTERS)[number];

export interface DynamicSection {
  heading: string;
  table: { columns: Column[]; from: string; csvName?: string };
}

export interface DynamicReportSpec {
  title: string;
  pageStyle: PageStyle;
  footerTitle?: string;
  mdName?: string;
  dataAdapter: DataAdapter;
  sections: DynamicSection[];
}

// Maps a declarative spec onto the house-style Dossier. `data` is a bag keyed by the
// adapter's result shape; each section's `table.from` selects an array of rows from it.
export function buildDynamicDossier(spec: DynamicReportSpec, data: Record<string, unknown>): Dossier {
  const dossier = new Dossier({
    title: spec.title,
    pageStyle: spec.pageStyle,
    footerTitle: spec.footerTitle ?? spec.title,
    mdName: spec.mdName,
  });

  for (const sec of spec.sections) {
    const rows = (data[sec.table.from] as Row[] | undefined) ?? [];
    dossier.section(sec.heading).table(sec.table.columns, rows, sec.table.csvName);
  }

  return dossier;
}

// Validates a caller-supplied spec object. Returns an error string, or null if valid.
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
  for (const sec of s.sections as Array<Record<string, unknown>>) {
    if (!sec || typeof sec.heading !== "string") return "each section needs a heading";
    const table = sec.table as Record<string, unknown> | undefined;
    if (!table || !Array.isArray(table.columns) || typeof table.from !== "string") {
      return "each section needs a table with { columns, from }";
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
