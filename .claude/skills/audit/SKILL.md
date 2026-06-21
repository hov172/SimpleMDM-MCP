---
name: audit
description: Generate a full SOFA-based macOS fleet security audit (Security Report, Vulnerability Check, Need Updates, All Devices + CVE detail) and export to CSV/Markdown/docx. Use when asked to run a fleet audit, security report, or SOFA report.
---

# SOFA Fleet Audit

Run the audit engine and report where the files landed. Do NOT commit the output.

## Steps

1. Determine the format from the user's request (default `all`). Map words to flags:
   - "csv" → `--format csv`, "word"/"docx" → `--format docx`, "markdown"/"md" → `--format md`, otherwise `--format all`. "just the report"/"no data CSVs" → add `--report-only` (skips the CSV exports; not valid with `--format csv`). "compact"/"fit to A4"/"standard page" → `--page-size a4` (default is roomy `a3`).
2. Optional scope (at most one; omit for the whole fleet): a serial (or several) → `--serial A,B`; a group name → `--group "Name"` (matches device **and** assignment groups); "last N seen" → `--last-seen N`. A scoped run also trims the Vulnerability Check to the OS major-version ladders the selected devices are on (drops the iOS/iPadOS table and unrelated macOS majors).
3. Run: `node dist/reports/cli.js audit --format <format> [selector]`
3. Read `reports/audit-<today>/summary.txt` and relay the headline counts to the user
   (OS Outdated, No FileVault, No SIP, No Firewall, XProtect Outdated, Unfixed CVEs, devices with issues).
4. List the generated files. Remind the user the output is local-only (gitignored) and not committed.

## Outputs (in `reports/audit-<today>/`)
- `summary.txt` — headline breakdown.
- `all-devices.csv` — full inventory: name, device_name, serial, device_group, os_version, latest_minor, latest_major, unfixed_cves, product, FV/SIP/FW/XP, last_seen.
- `by-group.csv` — per device-group rollup (devices, os_outdated, no_filevault, no_sip, no_firewall, unfixed_cve_devices).
- `security-report.csv` — devices with issues + findings.
- `need-updates.csv` — per-device upgrade paths.
- `vulnerability-check.csv` — per-release CVEs (with a multi-line CVE cell).
- `cve-detail.csv` — per-CVE catalog with devices-exposed counts.
- `device-cves.csv` — per device, every CVE it is still missing (one multi-line cell).
- `cve-devices.csv` — the inverse: per CVE, the affected device names/serials (one multi-line cell).
- `full-audit.md` / `full-audit.docx` / `full-audit.pdf` — combined report. `--format all` writes the PDF automatically (A3 landscape, footer page numbers; WeasyPrint preferred, headless-Chrome fallback). Regenerate standalone with `scripts/make-audit-pdf.sh [audit-dir]`.

## Notes
- Read-only: the engine performs no SimpleMDM writes; a read-only `SIMPLEMDM_API_KEY` in `.env` is enough.
- XProtect checks populate only if the `xprotect_version` custom attribute is collected (see `reports/xprotect/STAGING.md`); otherwise they report `N/A (not set up)` (and `N/A` per device).
- Requires `SIMPLEMDM_API_KEY` in `.env` (read-only key is sufficient).
- Page size: `--page-size a3` (default, roomy A3-landscape) or `--page-size a4` (compact A4-landscape that shrinks the wide All Devices table to fit a standard page). Maps to the `page_size` param on `run_fleet_audit`.
- On `--format all`, the run also writes always-on bundle artifacts: `manifest.sha256` (SHA-256 integrity list) and `<report-dir>.zip` (single archive), via python3 stdlib (best-effort).
