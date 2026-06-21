import type { Column, Row } from "./csv.js";

export type PageStyle = "a3-landscape" | "a4-landscape" | "letter-portrait";

export type DocBlock =
  | { kind: "summary"; markdown: string }
  | { kind: "paragraph"; markdown: string }
  | { kind: "callout"; markdown: string }
  | { kind: "table"; columns: Column[]; rows: Row[]; csvName?: string }
  | { kind: "subheading"; heading: string };

export interface DocSection { heading: string; blocks: DocBlock[] }
export interface ReportDocument { title: string; pageStyle: PageStyle; sections: DocSection[] }
