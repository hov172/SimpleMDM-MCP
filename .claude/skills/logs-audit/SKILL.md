---
name: logs-audit
description: Generate a targeted SimpleMDM device-activity log export (legal/forensic) for selected devices — logs CSV (typed/ISO/sorted), status-snapshot CSV, per-device summary/coverage, raw JSON, SHA-256 manifest, and an optional md/docx/pdf report. Use when asked to export device logs, build a device activity/forensic/legal log report, or audit a device's /logs.
---

# SimpleMDM Logs Audit

Targeted sibling to the SOFA `/audit`. Runs the engine and reports where files landed. Do NOT commit the output.

## Steps

1. Determine the selector from the request and map to exactly one flag:
   - a serial (or several) → `--serial A,B`
   - "last N seen" / "most recently seen" → `--last-seen N`
   - a group name → `--group "Name"`
   - "whole fleet" / "all devices" → `--all --confirm-all`
2. Map optional combines: "with security/posture/CVEs" → `--with-security`; "with apps/profiles/inventory" → `--with-inventory`.
3. Map format words: "csv" → `--format csv`, "word"/"docx" → `--format docx`, "markdown"/"md" → `--format md`, else `--format all`.
4. Run: `node scripts/logs-audit.mjs <flags>`
5. Read `<outDir>/summary.txt` and relay the headline (devices, total events, failed devices).
6. List the generated files. Remind the user the output is local-only (gitignored) and not committed.
7. For PDF, after the run: `scripts/make-audit-pdf.sh <outDir>`.

## Notes
- Read-only: a read-only `SIMPLEMDM_API_KEY` in `.env` is sufficient.
- Timestamps are in the account display timezone (America/New_York), reproduced verbatim plus an ISO `at_iso` column — NOT UTC. The `/logs` feed is retention-bounded; the per-device window is in `logs-summary.csv`.
- `--all` is heavy (one log fetch per device) and requires `--confirm-all`.
