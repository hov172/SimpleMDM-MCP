#!/usr/bin/env bash
#
# Generate full-audit.pdf from full-audit.md using pandoc + WeasyPrint (preferred,
# for real "Page X of Y" footers) or a headless Chromium-based browser (fallback).
# Produces an A3-landscape, full-width report with the shared report styling
# (see scripts/audit-report.head.html). `node scripts/sofa-audit.mjs --format all`
# already produces this PDF automatically; this script regenerates it standalone.
#
# Usage:
#   scripts/make-audit-pdf.sh [audit-dir]
#     audit-dir  Optional. Defaults to the newest reports/audit-*/ directory.
#
# Requirements: pandoc, and WeasyPrint (brew install weasyprint) or Chrome/Chromium/Edge.
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STYLE="$HERE/audit-report.head.html"
[ -f "$STYLE" ] || { echo "Missing stylesheet: $STYLE" >&2; exit 1; }

# Resolve the audit directory (argument, else newest reports/audit-*/).
DIR="${1:-}"
if [ -z "$DIR" ]; then
  DIR="$(ls -d reports/audit-*/ 2>/dev/null | sort | tail -1 || true)"
fi
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "No audit directory found. Pass one as an argument, or run the audit first." >&2; exit 1; }
DIR="$(cd "$DIR" && pwd)"

MD="$DIR/full-audit.md"
[ -f "$MD" ] || { echo "No full-audit.md in $DIR — run: node scripts/sofa-audit.mjs --format md (or all)" >&2; exit 1; }

command -v pandoc >/dev/null 2>&1 || { echo "pandoc not found. Install it (e.g. 'brew install pandoc')." >&2; exit 1; }

# Markdown -> styled HTML.
pandoc "$MD" -s -H "$STYLE" -o "$DIR/full-audit.html"

# HTML -> PDF: prefer WeasyPrint (real @page footer page numbers), else headless Chrome.
WEASY="$(command -v weasyprint 2>/dev/null || true)"
[ -n "$WEASY" ] || { [ -x /opt/homebrew/bin/weasyprint ] && WEASY=/opt/homebrew/bin/weasyprint; }
if [ -n "$WEASY" ]; then
  "$WEASY" "$DIR/full-audit.html" "$DIR/full-audit.pdf"
  echo "Wrote $DIR/full-audit.pdf (WeasyPrint)"
  exit 0
fi

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$(command -v google-chrome 2>/dev/null || true)" \
  "$(command -v chromium 2>/dev/null || true)" \
  "$(command -v chromium-browser 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
done
[ -n "$CHROME" ] || { echo "No WeasyPrint or Chrome/Chromium/Edge found for PDF rendering." >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$DIR/full-audit.pdf" "file://$DIR/full-audit.html" >/dev/null 2>&1
echo "Wrote $DIR/full-audit.pdf (Chrome — no page numbers; install weasyprint for footers)"
