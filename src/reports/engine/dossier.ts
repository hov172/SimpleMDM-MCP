import { join } from "node:path";
import type { Column, Row } from "./csv.js";
import { toCsv, reportOnlyGate, type Format } from "./csv.js";
import type { DocBlock, DocSection, PageStyle, ReportDocument } from "./document.js";
import { renderMarkdown } from "./markdown.js";
import { headHtml } from "./theme.js";
import { renderReportPdf, mdToDocx } from "./pipeline.js";
import { sha256 as _sha256, manifestRows, MANIFEST_COLUMNS } from "./manifest.js";
import { writeArtifact, toFileMeta, type WrittenFile } from "./outdir.js";

export interface WriteResult {
  outDir: string;
  files: { name: string; description: string; rows: number | null; sha256: string }[];
  manifestSha256: string;
  skipped: { artifact: string; reason: string }[];
}

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
  private readonly footerTitle: string;
  private readonly mdName: string;

  constructor(opts: { title: string; pageStyle: PageStyle; footerTitle?: string; mdName?: string; baseName?: string }) {
    this.doc = { title: opts.title, pageStyle: opts.pageStyle, sections: [] };
    this.footerTitle = opts.footerTitle ?? opts.title;
    this.mdName = opts.mdName ?? "report.md";
  }

  section(heading: string): SectionBuilder {
    const s: DocSection = { heading, blocks: [] };
    this.doc.sections.push(s);
    return new SectionBuilder(s);
  }

  toDocument(): ReportDocument { return this.doc; }

  async write(
    outDir: string,
    opts: { format: Format; reportOnly?: boolean; generatedIso?: string },
  ): Promise<WriteResult> {
    const gate = reportOnlyGate(opts.format, !!opts.reportOnly);
    if (gate.error) throw new Error(gate.error);

    const files: WrittenFile[] = [];
    const skipped: { artifact: string; reason: string }[] = [];

    // 1. Data CSVs — one per table block that named a csvName
    if (gate.writeData && (opts.format === "csv" || opts.format === "all")) {
      for (const s of this.doc.sections) {
        for (const b of s.blocks) {
          if (b.kind === "table" && b.csvName) {
            files.push(writeArtifact(outDir, b.csvName, toCsv(b.columns, b.rows), s.heading, b.rows.length));
          }
        }
      }
    }

    // 2. Markdown + optional html/pdf/docx (skip for pure csv)
    if (opts.format !== "csv") {
      const md = renderMarkdown(this.doc);
      files.push(writeArtifact(outDir, this.mdName, md, "Combined dossier (Markdown)", null));

      if (opts.format === "all") {
        const htmlPath = join(outDir, this.mdName.replace(/\.md$/, ".html"));
        const pdfPath = join(outDir, this.mdName.replace(/\.md$/, ".pdf"));
        const r = renderReportPdf({
          mdPath: join(outDir, this.mdName),
          htmlPath,
          pdfPath,
          headHtml: headHtml(this.doc.pageStyle, this.footerTitle),
          label: this.doc.title,
        });
        skipped.push(...r.skipped);
      }

      if (opts.format === "docx" || opts.format === "all") {
        const docxPath = join(outDir, this.mdName.replace(/\.md$/, ".docx"));
        const docx = mdToDocx(join(outDir, this.mdName), docxPath);
        if (!docx.ok) skipped.push({ artifact: "docx", reason: docx.reason ?? "unknown" });
      }
    }

    // 3. Manifest
    const metas = files.map(toFileMeta);
    const manifestCsv = toCsv(MANIFEST_COLUMNS, manifestRows(metas, opts.generatedIso ?? new Date().toISOString()));
    const manifestFile = writeArtifact(outDir, "manifest.csv", manifestCsv, "SHA-256 integrity manifest", metas.length);

    return {
      outDir,
      files: [...files, manifestFile],
      manifestSha256: manifestFile.sha256,
      skipped,
    };
  }
}
