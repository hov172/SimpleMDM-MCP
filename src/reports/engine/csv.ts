export interface Column { key: string; header: string; nowrap?: boolean }
export type Row = Record<string, unknown>;

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: Column[], rows: Row[]): string {
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(","));
  return lines.join("\r\n");
}

export type Format = "csv" | "md" | "docx" | "all";
export function reportOnlyGate(format: Format, reportOnly: boolean): { writeData: boolean; error: string | null } {
  if (!reportOnly) return { writeData: true, error: null };
  if (format === "csv") return { writeData: false, error: "--report-only with --format csv writes no report — drop one of them" };
  return { writeData: false, error: null };
}
