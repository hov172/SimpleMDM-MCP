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
3. Read `reports/audit-<today>/summary.txt` and relay the headline counts to the user.
4. List the generated files. Remind the user the output is local-only (gitignored) and not committed.

## Notes
- Per-device breakdown lives in `security-report.csv` / `all-devices.csv` / `need-updates.csv`; the per-device × per-CVE listing (which specific CVEs each device is missing) is in `device-cves.csv`.
- Read-only: the engine performs no SimpleMDM writes.
- Requires `SIMPLEMDM_API_KEY` in `.env` (read-only key is sufficient).
- XProtect checks populate only if the `xprotect_version` custom attribute is collected; otherwise they report 0 / "absent".
