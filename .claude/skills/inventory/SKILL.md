---
name: inventory
description: Generate a robust, searchable SimpleMDM fleet inventory report (devices + apps + profiles + users) with multi-keyword + field-filter search, rollups, deployment-gap findings, and CSV/md/docx/pdf dossier. Use when asked for an inventory report, device-list export, "which devices have X", or fleet hardware/app/profile breakdowns.
---

# SimpleMDM Inventory Report

Searchable sibling to `/audit` and `/logs-audit`. Runs the engine and reports where files landed. Do NOT commit the output.

## Steps

1. Map the request to a selector (at most one) and/or a `--search` query:
   - a serial (or several) → `--serial A,B`; a group name → `--group "Name"`; "last N seen" → `--last-seen N`; "whole fleet" → `--all --confirm-all`.
   - Search criteria → `--search '<query>'`: bare keywords AND together; `OR` between terms; `-term` excludes; `field:value` scopes. Fields: name, devicename, serial, udid, imei, mac, ip, model, type (imac/laptop/desktop/ipad/iphone/appletv/mac), arch, os, build, group, assignment, assigned, app, profile, user, seen, enrolled, storage (GB free), battery (%), filevault, sip, firewall, supervised, recoverykey, dep, status, attr.<name>. Values support comma-lists (OR), `*` wildcards, comparators (`os:<15.5`, `app:zoom<6.0.10`, `storage:<20`), ranges (`enrolled:2025-01-01..2025-06-30`), relative dates (`seen:90d`).
   - Examples: "faculty or staff macs seen since 2025" → `--search 'group:faculty,staff seen:>=2025-01-01'`; "Intel MacBooks without FileVault" → `--search 'type:laptop arch:intel filevault:off'`; "devices assigned Zoom but missing it" → `--search 'assigned:zoom -app:zoom' --confirm-all`.
2. A fleet-wide search whose terms are ALL per-device (bare keywords / app: / profile: / user: / mixed OR) needs `--confirm-all` — warn the user it fetches per-device data for the whole fleet.
3. Optional: "skip apps/profiles/users" → `--no-apps`/`--no-profiles`/`--no-users`; "with raw JSON" → `--raw`; "accept partial" → `--allow-partial`; format words → `--format csv|md|docx|all` (default all); "full detail" → `--report-detail full`.
4. Run: `node scripts/inventory-report.mjs <flags>`
5. Read `<outDir>/summary.txt`; relay the headline (matched/selected/fleet counts, findings, PARTIAL warning if any). Exit 2 with partial data is expected behavior — surface it, suggest `--allow-partial` only if the user accepts incomplete evidence.
6. List the generated files. Remind the user output is local-only (gitignored), owner-only permissions, and not committed.

## Notes
- Read-only: a read-only `SIMPLEMDM_API_KEY` in `.env` suffices. No SimpleMDM writes.
- Device-level filters run before per-device fetches, so scoped searches stay fast; the engine prints its plan.
- FileVault recovery keys are never written to any output (raw dumps are redacted; `--raw` is off by default).
- Findings: assigned-app-missing, low-storage, stale-device, recovery-key-missing, duplicate-name, os-outlier; `unknown` status means the deciding fetch failed.
