import { join, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Column, Row } from "./csv.js";
import { toCsv, reportOnlyGate, type Format } from "./csv.js";
import type { DocBlock, DocSection, PageStyle, ReportDocument } from "./document.js";
import { renderMarkdown } from "./markdown.js";
import { headHtml } from "./theme.js";
import { renderReportPdf, mdToDocx } from "./pipeline.js";
import { sha256 as _sha256, manifestRows, MANIFEST_COLUMNS, type FileMeta } from "./manifest.js";
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
  subsection(heading: string): this { this.section.blocks.push({ kind: "subheading", heading }); return this; }
}

interface DataFileEntry { name: string; content: string; description: string }
interface ManifestNoteEntry { file: string; description: string }

export class Dossier {
  private readonly doc: ReportDocument;
  private readonly footerTitle: string;
  private readonly mdName: string;
  private readonly _bodyParts: string[] = [];
  private readonly _dataFiles: DataFileEntry[] = [];
  private readonly _manifestNotes: ManifestNoteEntry[] = [];

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

  bodyMarkdown(md: string): this {
    this._bodyParts.push(md);
    return this;
  }

  dataFile(name: string, content: string, description?: string): this {
    this._dataFiles.push({ name, content, description: description ?? name });
    return this;
  }

  dataCsv(name: string, columns: Column[], rows: Row[], description?: string): this {
    return this.dataFile(name, toCsv(columns, rows), description);
  }

  manifestNote(file: string, description: string): this {
    this._manifestNotes.push({ file, description });
    return this;
  }

  toDocument(): ReportDocument { return this.doc; }

  async write(
    outDir: string,
    opts: { format: Format; reportOnly?: boolean; generatedIso?: string; manifest?: boolean },
  ): Promise<WriteResult> {
    const gate = reportOnlyGate(opts.format, !!opts.reportOnly);
    if (gate.error) throw new Error(gate.error);

    const files: WrittenFile[] = [];
    const skipped: { artifact: string; reason: string }[] = [];

    // 1. Data artifacts — written for all non-report-only formats (csv/md/docx/all),
    // matching legacy engine behaviour. Gated once on writeData.
    if (gate.writeData) {
      // 1a. Data CSVs — one per table block that named a csvName.
      for (const s of this.doc.sections) {
        for (const b of s.blocks) {
          if (b.kind === "table" && b.csvName) {
            files.push(writeArtifact(outDir, b.csvName, toCsv(b.columns, b.rows), s.heading, b.rows.length));
          }
        }
      }

      // 1b. Registered data files (dataFile / dataCsv).
      for (const df of this._dataFiles) {
        const fullPath = join(outDir, df.name);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, df.content);
        const bytes = Buffer.byteLength(df.content);
        const hash = _sha256(df.content);
        files.push({ name: df.name, description: df.description, rows: null, sha256: hash, bytes });
      }
    }

    // 2. Markdown + optional html/pdf/docx (skip for pure csv)
    if (opts.format !== "csv") {
      const md = renderMarkdown(this.doc, this._bodyParts.length > 0 ? this._bodyParts : undefined);
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

    // 3. Manifest (skip when manifest:false — caller owns its own manifest)
    const writeManifest = opts.manifest !== false;
    if (writeManifest) {
      const metas = files.map(toFileMeta);
      // Append manifestNote rows (non-file disclosure rows)
      const generatedIso = opts.generatedIso ?? new Date().toISOString();
      const noteMetas: FileMeta[] = this._manifestNotes.map((n) => ({
        file: n.file,
        description: n.description,
        record_scope: "",
        data_row_count: "",
        bytes: "",
        sha256: "",
      }));
      const allMetas = [...metas, ...noteMetas];
      const manifestCsv = toCsv(MANIFEST_COLUMNS, manifestRows(allMetas, generatedIso));
      const manifestFile = writeArtifact(outDir, "manifest.csv", manifestCsv, "SHA-256 integrity manifest", metas.length);

      return {
        outDir,
        files: [...files, manifestFile],
        manifestSha256: manifestFile.sha256,
        skipped,
      };
    }

    return {
      outDir,
      files,
      manifestSha256: "",
      skipped,
    };
  }
}
