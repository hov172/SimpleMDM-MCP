import type { Column, Row } from "./csv.js";
import type { DocBlock, ReportDocument } from "./document.js";

function mdTable(columns: Column[], rows: Row[]): string {
  const head = `| ${columns.map((c) => c.header).join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${columns.map((c) => String(r[c.key] ?? "")).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

function block(b: DocBlock): string {
  switch (b.kind) {
    case "summary":
    case "paragraph": return b.markdown;
    case "callout": return b.markdown.split("\n").map((l) => `> ${l}`).join("\n");
    case "table": return mdTable(b.columns, b.rows);
  }
}

export function renderMarkdown(doc: ReportDocument): string {
  const out: string[] = [`# ${doc.title}\n`];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}\n`);
    for (const b of s.blocks) out.push(block(b) + "\n");
  }
  return out.join("\n");
}
