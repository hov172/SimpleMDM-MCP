import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const find = (cands: string[]) =>
  cands.find((c) =>
    c.includes("/") ? existsSync(c) : spawnSync("which", [c]).status === 0
  );

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

const WEASY = ["weasyprint", "/opt/homebrew/bin/weasyprint", "/usr/local/bin/weasyprint"];

export interface PdfResult {
  produced: string[];
  skipped: { artifact: string; reason: string }[];
}

export function renderReportPdf(opts: {
  mdPath: string;
  htmlPath: string;
  pdfPath: string;
  headHtml: string;
  label?: string;
}): PdfResult {
  const { mdPath, htmlPath, pdfPath, headHtml, label = "report" } = opts;
  const produced: string[] = [];
  const skipped: PdfResult["skipped"] = [];

  if (!existsSync(mdPath)) {
    return {
      produced,
      skipped: [{ artifact: "html", reason: "source md missing" }],
    };
  }

  const styleFile = join(mkdtempSync(join(tmpdir(), "head-")), "head.html");
  writeFileSync(styleFile, headHtml);

  const pandoc = spawnSync("pandoc", [mdPath, "-s", "-H", styleFile, "-o", htmlPath]);
  if (pandoc.status === 0) {
    produced.push(htmlPath);
  } else {
    skipped.push({ artifact: "html+pdf", reason: "pandoc unavailable" });
    return { produced, skipped };
  }

  const weasy = find(WEASY);
  if (weasy) {
    const wp = spawnSync(weasy, [htmlPath, pdfPath]);
    if (wp.status === 0) {
      produced.push(pdfPath);
      return { produced, skipped };
    }
    skipped.push({
      artifact: "pdf(weasyprint)",
      reason: "weasyprint failed; trying Chrome",
    });
  }

  const chrome = find(CHROMES);
  if (!chrome) {
    skipped.push({
      artifact: "pdf",
      reason: "no WeasyPrint or Chrome/Chromium/Edge",
    });
    return { produced, skipped };
  }

  const pdf = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ]);

  if (pdf.status === 0) {
    produced.push(pdfPath);
  } else {
    skipped.push({ artifact: "pdf", reason: "Chrome render failed" });
  }

  return { produced, skipped };
}

export function mdToDocx(mdPath: string, docxPath: string): { ok: boolean; reason?: string } {
  if (spawnSync("pandoc", ["--version"], { stdio: "ignore" }).status !== 0) {
    return { ok: false, reason: "pandoc not found" };
  }
  const res = spawnSync("pandoc", [mdPath, "-o", docxPath]);
  return res.status === 0
    ? { ok: true }
    : { ok: false, reason: "pandoc docx conversion failed" };
}
