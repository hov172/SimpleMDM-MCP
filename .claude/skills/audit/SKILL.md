---
name: audit
description: Generate a full SOFA-based macOS fleet security audit (Security Report, Vulnerability Check, Need Updates, All Devices + CVE detail) and export to CSV/Markdown/docx. Use when asked to run a fleet audit, security report, or SOFA report.
---

# SOFA Fleet Audit

Run the audit engine and report where the files landed. Do NOT commit the output.

## Steps

1. Determine the format from the user's request (default `all`). Map words to flags:
   - "csv" → `--format csv`, "word"/"docx" → `--format docx`, "markdown"/"md" → `--format md`, otherwise `--format all`.
2. Run: `node scripts/sofa-audit.mjs --format <format>`
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
- `full-audit.md` / `full-audit.docx` — combined report (docx needs pandoc).
- For a print-ready PDF, after the audit run `scripts/make-audit-pdf.sh [audit-dir]` (pandoc + headless Chrome; A3 landscape, full-width tables).

## Notes
- Read-only: the engine performs no SimpleMDM writes; a read-only `SIMPLEMDM_API_KEY` in `.env` is enough.
- XProtect checks populate only if the `xprotect_version` custom attribute is collected (see `reports/xprotect/STAGING.md`); otherwise they report `N/A (not set up)` (and `N/A` per device).
- Requires `SIMPLEMDM_API_KEY` in `.env` (read-only key is sufficient).
- XProtect checks populate only if the `xprotect_version` custom attribute is collected; otherwise they report 0 / "absent".
