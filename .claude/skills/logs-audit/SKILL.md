---
name: logs-audit
description: Generate a targeted SimpleMDM device-activity log export (legal/forensic) for selected devices — logs CSV (typed/ISO/sorted), status-snapshot CSV with externalized JSON sidecars, per-device summary/coverage, raw JSON, SHA-256 manifest, and a detailed combined dossier report in md/html/docx/pdf. Use when asked to export device logs, build a device activity/forensic/legal log report, or audit a device's /logs.
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

## Report (`--format all`)
Produces a detailed combined **dossier** in four formats — `report.md`, `report.html`, `report.docx` (pandoc), `report.pdf` (headless Chrome). Each device gets identity, security posture (with `--with-security`), activity breakdown + coverage window, notable software-update events, and software inventory (with `--with-inventory`), plus a fleet roll-up. `report.docx`/`.html`/`.pdf` are best-effort: if pandoc/Chrome are missing the run logs a warning and skips them (md still written). `--format md` writes md only; `--format docx` writes md + docx.

## Notes
- Read-only: a read-only `SIMPLEMDM_API_KEY` in `.env` is sufficient.
- Timestamps are in the account display timezone (America/New_York), reproduced verbatim plus an ISO `at_iso` column — NOT UTC. The `/logs` feed is retention-bounded; the per-device window is in `logs-summary.csv`.
- Full `status.changed` snapshots are externalized to `status-snapshots/<serial>__<logid>.json` (the `logs-status-snapshots.csv` `status_json_file` column points to each) so no spreadsheet cell is truncated; each sidecar is SHA-256-hashed in the manifest.
- `--all` is heavy (one log fetch per device) and requires `--confirm-all`.
