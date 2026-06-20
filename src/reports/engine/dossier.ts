import type { Column, Row } from "./csv.js";
import type { DocBlock, DocSection, PageStyle, ReportDocument } from "./document.js";

class SectionBuilder {
  constructor(private readonly section: DocSection) {}
  summary(markdown: string): this { this.section.blocks.push({ kind: "summary", markdown }); return this; }
  paragraph(markdown: string): this { this.section.blocks.push({ kind: "paragraph", markdown }); return this; }
  callout(markdown: string): this { this.section.blocks.push({ kind: "callout", markdown }); return this; }
  table(columns: Column[], rows: Row[], csvName?: string): this {
    const block: DocBlock = { kind: "table", columns, rows };
    if (csvName) block.csvName = csvName;
    this.section.blocks.push(block);
    return this;
  }
}

export class Dossier {
  private readonly doc: ReportDocument;
  constructor(opts: { title: string; pageStyle: PageStyle }) {
    this.doc = { title: opts.title, pageStyle: opts.pageStyle, sections: [] };
  }
  section(heading: string): SectionBuilder {
    const s: DocSection = { heading, blocks: [] };
    this.doc.sections.push(s);
    return new SectionBuilder(s);
  }
  toDocument(): ReportDocument { return this.doc; }
}
