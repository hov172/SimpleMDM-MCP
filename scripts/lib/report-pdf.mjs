// Shared report renderer for /audit and /logs-audit: markdown -> HTML (pandoc)
// -> PDF (WeasyPrint preferred for real @page footer page numbers; headless
// Chrome fallback). Best-effort — missing tooling logs a warning and skips,
// never throws. Returns the list of produced absolute paths.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const find = (cands) => cands.find((c) => (c.includes("/") ? existsSync(c) : spawnSync("which", [c]).status === 0));

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "google-chrome", "chromium", "chromium-browser",
];
const WEASY = ["weasyprint", "/opt/homebrew/bin/weasyprint", "/usr/local/bin/weasyprint"];

export function renderReportPdf({ mdPath, htmlPath, pdfPath, style, label = "report" }) {
  const produced = [];
  if (!existsSync(mdPath)) return produced;

  const pandoc = spawnSync("pandoc", [mdPath, "-s", ...(style && existsSync(style) ? ["-H", style] : []), "-o", htmlPath]);
  if (pandoc.status === 0) produced.push(htmlPath);
  else { console.warn(`${label}: html skipped (pandoc unavailable)`); return produced; }

  // Prefer WeasyPrint — honors CSS paged media (@page footer with page numbers).
  const weasy = find(WEASY);
  if (weasy) {
    const wp = spawnSync(weasy, [htmlPath, pdfPath]);
    if (wp.status === 0) { produced.push(pdfPath); return produced; }
    console.warn(`${label}: weasyprint failed, falling back to Chrome (no page numbers)`);
  }
  const chrome = find(CHROMES);
  if (!chrome) { console.warn(`${label}: pdf skipped (no WeasyPrint or Chrome/Chromium/Edge)`); return produced; }
  const pdf = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`]);
  if (pdf.status === 0) produced.push(pdfPath);
  else console.warn(`${label}: pdf skipped (Chrome render failed)`);
  return produced;
}
