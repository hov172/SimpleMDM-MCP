import type { PageStyle } from "./document.js";

const A3_LANDSCAPE = (footerTitle: string): string => `<style>
  /* Print styling for the SOFA fleet security audit — A3 landscape (its tables
     are wide) with the same visual language as the logs-audit dossier:
     navy headings, dark table headers, zebra rows, footer page numbers. */
  @page {
    size: A3 landscape;
    margin: 12mm 12mm 14mm 12mm;
    /* Footer — honored by WeasyPrint (CSS paged media); ignored by Chrome. */
    @bottom-left  { content: "${footerTitle}"; font-size: 7.5pt; color: #9aa4ad; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7.5pt; color: #9aa4ad; }
  }

  /* Override pandoc's default narrow centered container so tables use full width. */
  html, body { max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; }

  body {
    font-family: "Helvetica Neue", -apple-system, Helvetica, Arial, sans-serif;
    font-size: 8.5pt; line-height: 1.4; color: #1a1a1a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  h1 { font-size: 18pt; color: #0b3d5c; margin: 0 0 2px; }
  h1 + p { color: #555; font-size: 9pt; margin: 0 0 6px; }
  h2 { font-size: 13pt; color: #0b3d5c; border-bottom: 2px solid #0b3d5c; padding-bottom: 3px; margin: 16px 0 8px; page-break-after: avoid; }
  h3 { font-size: 11pt; color: #111; margin: 12px 0 5px; page-break-after: avoid; }

  p { margin: 4px 0; }
  strong { color: #111; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 8pt; background: #f3f5f7; padding: 0 3px; border-radius: 3px; word-break: break-all; }

  blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid #c0392b; background: #fcf3f2; color: #7a2018; font-size: 8.5pt; page-break-inside: avoid; }
  blockquote p { margin: 0; }

  /* Wide, content-sized tables. */
  table { border-collapse: collapse; table-layout: auto; width: 100%; margin: 6px 0 12px; font-size: 8pt; }
  th, td { border: 1px solid #d0d7de; padding: 2px 6px; vertical-align: top; white-space: normal; overflow-wrap: break-word; }
  th { background: #0b3d5c; color: #fff; text-align: left; font-weight: 600; white-space: nowrap; }
  td { min-width: 40px; }
  tr:nth-child(even) td { background: #f6f8fa; }
  tr { page-break-inside: avoid; }
  colgroup col { width: auto !important; }   /* let columns size to content */

  hr { border: none; border-top: 1px solid #e1e4e8; margin: 12px 0; }
  ul { margin: 3px 0 8px 18px; }
  li { margin: 1px 0; overflow-wrap: break-word; }
</style>`;

const A4_LANDSCAPE = (footerTitle: string): string => `<style>
  /* Compact variant of the audit dossier on A4 landscape: smaller type, tighter
     cells and wrapping headers so the wide 14-column "All Devices" table fits the
     narrower page (A4 vs A3) instead of clipping. Denser, less wasted right margin;
     trade-off is more wrapping. Same visual language as A3. */
  @page {
    size: A4 landscape;
    margin: 10mm 10mm 12mm 10mm;
    @bottom-left  { content: "${footerTitle}"; font-size: 7pt; color: #9aa4ad; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7pt; color: #9aa4ad; }
  }

  html, body { max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; }

  body {
    font-family: "Helvetica Neue", -apple-system, Helvetica, Arial, sans-serif;
    font-size: 8pt; line-height: 1.35; color: #1a1a1a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  h1 { font-size: 17pt; color: #0b3d5c; margin: 0 0 2px; }
  h1 + p { color: #555; font-size: 8.5pt; margin: 0 0 6px; }
  h2 { font-size: 12pt; color: #0b3d5c; border-bottom: 2px solid #0b3d5c; padding-bottom: 3px; margin: 14px 0 7px; page-break-after: avoid; }
  h3 { font-size: 10pt; color: #111; margin: 10px 0 4px; page-break-after: avoid; }

  p { margin: 4px 0; }
  strong { color: #111; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 6.8pt; background: #f3f5f7; padding: 0 2px; border-radius: 3px; word-break: break-all; }

  blockquote { margin: 6px 0; padding: 4px 9px; border-left: 3px solid #c0392b; background: #fcf3f2; color: #7a2018; font-size: 7.5pt; page-break-inside: avoid; }
  blockquote p { margin: 0; }

  /* Shrink-to-fit tables: smaller font, tighter padding, narrower min cell, and
     wrapping headers — lets the 14-column table fit A4 width without clipping. */
  table { border-collapse: collapse; table-layout: auto; width: 100%; margin: 5px 0 10px; font-size: 6.6pt; }
  th, td { border: 1px solid #d0d7de; padding: 1px 4px; vertical-align: top; white-space: normal; overflow-wrap: break-word; }
  th { background: #0b3d5c; color: #fff; text-align: left; font-weight: 600; white-space: normal; }
  td { min-width: 24px; }
  tr:nth-child(even) td { background: #f6f8fa; }
  tr { page-break-inside: avoid; }
  colgroup col { width: auto !important; }

  hr { border: none; border-top: 1px solid #e1e4e8; margin: 10px 0; }
  ul { margin: 3px 0 7px 16px; }
  li { margin: 1px 0; overflow-wrap: break-word; }
</style>`;

const LETTER_PORTRAIT = (footerTitle: string): string => `<style>
  /* Print-ready styling for the logs-audit device dossier.
     US Letter portrait, professional typography, readable per-device flow. */
  @page {
    size: Letter portrait;
    margin: 16mm 15mm 18mm 15mm;
    /* Page footer — honored by WeasyPrint (CSS paged media); ignored by Chrome. */
    @bottom-left  { content: "${footerTitle}"; font-size: 7.5pt; color: #9aa4ad; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7.5pt; color: #9aa4ad; }
  }

  /* Override pandoc's default 36em centered container so we use the page width. */
  html, body { max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; }

  body {
    font-family: "Helvetica Neue", -apple-system, Helvetica, Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.45; color: #1a1a1a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  h1 { font-size: 20pt; color: #0b3d5c; margin: 0 0 2px; }
  /* The subtitle line (Devices / events) and intro paragraph right under H1. */
  h1 + p { color: #555; font-size: 10pt; margin: 0 0 4px; }
  h2 {
    font-size: 14pt; color: #0b3d5c; border-bottom: 2px solid #0b3d5c;
    padding-bottom: 3px; margin: 22px 0 10px; page-break-after: avoid;
  }
  h3 { font-size: 12pt; color: #111; margin: 16px 0 6px; page-break-after: avoid; }

  p { margin: 5px 0; orphans: 3; widows: 3; }
  strong { color: #111; }

  /* Inline identifiers (serial / UDID). break-all so long UDIDs never overflow. */
  code {
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9pt;
    background: #f3f5f7; padding: 0 3px; border-radius: 3px; word-break: break-all;
  }

  /* "Findings" callout. */
  blockquote {
    margin: 6px 0; padding: 5px 10px; border-left: 3px solid #c0392b;
    background: #fcf3f2; color: #7a2018; font-size: 9.5pt; page-break-inside: avoid;
  }
  blockquote p { margin: 0; }

  table {
    border-collapse: collapse; width: 100%; margin: 8px 0 14px;
    font-size: 8.6pt; page-break-inside: auto;
  }
  th, td { border: 1px solid #d0d7de; padding: 3px 6px; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #0b3d5c; color: #fff; text-align: left; font-weight: 600; }
  tr:nth-child(even) td { background: #f6f8fa; }
  tr { page-break-inside: avoid; }

  hr { border: none; border-top: 1px solid #e1e4e8; margin: 14px 0; }

  ul { margin: 4px 0 8px 18px; }
  li { margin: 2px 0; }
</style>`;

export function headHtml(pageStyle: PageStyle, footerTitle: string): string {
  switch (pageStyle) {
    case "letter-portrait": return LETTER_PORTRAIT(footerTitle);
    case "a4-landscape":    return A4_LANDSCAPE(footerTitle);
    default:                return A3_LANDSCAPE(footerTitle);
  }
}
