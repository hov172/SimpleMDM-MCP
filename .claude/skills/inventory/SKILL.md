---
name: inventory
description: Generate a robust, searchable SimpleMDM fleet inventory report (devices + apps + profiles + users) with multi-keyword + field-filter search, rollups, deployment-gap findings, and CSV/md/docx/pdf dossier. Use when asked for an inventory report, device-list export, "which devices have X", or fleet hardware/app/profile breakdowns.
---

# SimpleMDM Inventory Report

Searchable sibling to `/audit` and `/logs-audit`. Runs the engine and reports where files landed. Do NOT commit the output.

## Steps

1. Map the request to a selector (at most one) and/or a `--search` query:
   - a serial (or several) → `--serial A,B`; a group name → `--group "Name"`; "last N seen" → `--last-seen N`; "whole fleet" → `--all --confirm-all`.
   - Search criteria → `--search '<query>'`: bare keywords AND together; `OR` between terms; `-term` excludes; `field:value` scopes. Fields: name, devicename, serial, udid, imei, mac, ip, model, type (imac/laptop/desktop/ipad/iphone/appletv/mac), arch, os, build, group (device + assignment groups), devicegroup (device groups ONLY — use for rosters organized by device group), assignment, assigned, app, profile, user, seen, enrolled, storage (GB free), battery (%), filevault, sip, firewall, supervised, recoverykey, dep, ard, uamdm, ddm, activationlock, lostmode, firmwarelock, recoverylock, passcode, status, attr.<name>. Values support comma-lists (OR), `*` wildcards, comparators (`os:<15.5`, `app:zoom<6.0.10`, `storage:<20`), ranges (`enrolled:2025-01-01..2025-06-30`), relative dates (`seen:90d`).
   - Examples: "faculty or staff macs seen since 2025" → `--search 'group:faculty,staff seen:>=2025-01-01'`; "Intel MacBooks without FileVault" → `--search 'type:laptop arch:intel filevault:off'`; "devices assigned Zoom but missing it" → `--search 'assigned:zoom -app:zoom' --confirm-all`; "haven't checked in for 90 days" → `--search '-seen:90d'`; "running out of disk" → `--search 'storage:<20 seen:30d'`; "who owns MAC a4:83:…" → `--search 'mac:a4:83:*'` (matches WiFi/Bluetooth/Ethernet). Full cookbook: docs/inventory.md.
2. A fleet-wide search whose terms are ALL per-device (bare keywords / app: / profile: / user: / mixed OR) needs `--confirm-all` — warn the user it fetches per-device data for the whole fleet.
3. Optional: "skip apps/profiles/users" → `--no-apps`/`--no-profiles`/`--no-users`; "accept partial" → `--allow-partial`; format words → `--format csv|md|docx|all` (default all); "full detail" → `--report-detail full`; "roster"/"device list"/"hand to the department"/"one row per device" → `--report-style roster` (people-facing: by-group sections with users + assignment groups inline; pair with `devicegroup:` populations); "one table"/"flat"/"spreadsheet view"/"with device group as a column" → `--report-style flat` (roster and flat both also write `report-table.csv`, a CSV twin of the report table); "newest first"/"most recently seen first"/"sort by model/os/year" → `--sort seen:desc` / `--sort <field[:asc|desc]>` (sorting ≠ filtering: "seen in the last N days" stays `seen:Nd` in the query); "just the report"/"no data CSVs"/"minimal output" → `--report-only` (keeps `report-table.csv` for roster/flat; not valid with `--format csv`).
   - **`--raw`** — write redacted raw device API records to `<outDir>/raw/devices.json`. Use it alongside any selector: `node dist/reports/cli.js inventory <selector> --raw`. FileVault recovery keys are always redacted from the dump.
4. Run: `node dist/reports/cli.js inventory <flags>`
5. Read `<outDir>/summary.txt`; relay the headline (matched/selected/fleet counts, findings, PARTIAL warning if any). Exit 2 with partial data is expected behavior — surface it, suggest `--allow-partial` only if the user accepts incomplete evidence.
6. List the generated files. Remind the user output is local-only (gitignored) and not committed.

## Notes
- Read-only: a read-only `SIMPLEMDM_API_KEY` in `.env` suffices. No SimpleMDM writes.
- Device-level filters run before per-device fetches, so scoped searches stay fast; the engine prints its plan.
- Model marketing names + release years come from the SOFA feed plus a curated Apple legacy table (pre-SOFA Macs back to 2009; in `src/reports/domain/inventory.ts`); truly unknown identifiers fall back to the bare model string.
- FileVault recovery keys are never written to any output (raw dumps are redacted; `--raw` is off by default).
- Findings: assigned-app-missing, assigned-profile-missing, low-storage, stale-device, recovery-key-missing, duplicate-name, os-outlier; `unknown` status means the deciding fetch failed.
- Assigned apps come from assignment groups; assigned profiles come from device-group/direct profile assignments. Both render as per-device tables in the dossier at every detail level, plus `assigned-apps.csv` / `assigned-profiles.csv`.
