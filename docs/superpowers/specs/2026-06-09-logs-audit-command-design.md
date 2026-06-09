# Logs Audit Command — Design Spec

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session (Claude + maintainer)

## 1. Goal

Provide a real, reproducible command that generates a targeted, legal/forensic-grade export of
SimpleMDM device **activity logs** for a selected set of devices. It formalizes the ad-hoc "last 10
devices seen" export produced manually on 2026-06-09 (`audit_export/`), including the post-export
improvements reviewed that day: ISO-normalized timestamps, typed metadata columns, isolated
status-snapshot file, per-device summary/coverage, and a SHA-256 manifest with disclosures.

The command is a **sibling** to the SOFA security audit (`/audit`), not a replacement: `/audit`
stays fleet-wide and posture-oriented; `/logs-audit` is targeted and activity-oriented. They share
all plumbing (API client, CSV renderer, SOFA evaluation) and can be combined per-device via
`--with-security`.

## 2. Non-goals

- Not a UI; headless, exportable generator only.
- Not modifying `/audit` or the SOFA engine's behavior (only importing its pure functions).
- Not performing any writes to SimpleMDM (read-only; a read-only `SIMPLEMDM_API_KEY` suffices).
- Not adding new MCP server tools (this is a script + skill, like `/audit`).
- Not asserting a UTC timezone for log timestamps (the API does not stamp one — see §9).
- Not committing output (`reports/` is gitignored; live tenant data + serials stay local).

## 3. Surface & invocation

- **Engine:** `scripts/logs-audit.mjs` — standalone Node ESM script:
  `node scripts/logs-audit.mjs --last-seen 10 --format all`
- **Command wrapper:** a Claude Code skill `logs-audit` (invoked as `/logs-audit`) that maps the
  user's words to flags, runs the engine, relays the headline, and lists the files. Thin wrapper;
  all logic lives in the engine.
- **Language/deps:** Plain ESM JavaScript, Node ≥18 built-ins only (`fetch`, `fs`, `path`,
  `crypto` for SHA-256). No npm dependencies. `pandoc` / `make-audit-pdf.sh` shelled out only for
  `.docx` / `.pdf`.

## 4. CLI

```
node scripts/logs-audit.mjs <selector> [flags]

Selector (exactly one required):
  --serial A,B,C       Specific devices by serial number (comma-separated)
  --last-seen N        The N most recently seen devices (sorted by last_seen_at desc)
  --group "Name"       Every device in a device group or assignment group
  --all                Whole fleet — REQUIRES --confirm-all (heavy; hundreds of devices)

Flags:
  --with-inventory     Also emit per-device inventory + installed apps + profiles
  --with-security      Also run SOFA evaluation on the selected devices (posture + CVEs)
  --format <fmt>       csv | md | docx | all   (default: all)
  --out <dir>          Output dir (default: reports/logs-audit-<YYYY-MM-DD>/)
  --confirm-all        Required acknowledgement for --all
```

Selector precedence: exactly one of `--serial`/`--last-seen`/`--group`/`--all` must be present;
more than one (or none) is an error with a usage message.

## 5. Architecture

Mirrors `sofa-audit.mjs`; shares all plumbing. No duplicated CSV or evaluation logic.

- **`scripts/logs-audit.mjs`** — entry point. Arg parsing (`arg()`), `.env` key load
  (`loadEnvKey()`), `todayStr()` — reused patterns from `sofa-audit.mjs`. Orchestrates: resolve
  devices → fetch → build rows → write artifacts → print summary.
- **`scripts/lib/simplemdm.mjs`** (extend) — add:
  - `resolveDevices(apiKey, selector)` → array of device records for the selector. Reuses
    `fetchAllDevices` for `--last-seen`/`--all`/`--group`; uses `/devices?search=` for `--serial`.
  - `fetchDeviceLogs(apiKey, serial)` → fully paginated `/logs?serial_number=<serial>`.
  - `fetchDeviceApps(apiKey, id)`, `fetchDeviceProfiles(apiKey, id)`, `fetchDeviceUsers(apiKey, id)`
    (only called under `--with-inventory`).
  - Group-name resolution: reuse `fetchDeviceGroups`; add `fetchAssignmentGroups` for the
    `relationships.groups` (assignment-group) names.
- **`scripts/lib/logs.mjs`** (**new — pure functions, no network, fully unit-testable**):
  - `toIso(at)` — `"MM/DD/YY HH:MM:SS"` → `"YYYY-MM-DDTHH:MM:SS"`, **same wall-clock, no TZ shift**;
    returns `""` if unparseable.
  - `logRows(bundles)` — one row per event: `at_iso` + verbatim `at`, identity (device id/serial/
    name/users), event fields, typed metadata columns, human `summary`; sorted by `at_iso` then
    serial; **excludes** the large `status.changed` snapshot blob.
  - `statusSnapshotRows(bundles)` — one row per `status.changed`: extracted key fields + full
    `status` as a multi-line pretty `status_pretty` cell.
  - `logSummaryRows(bundles)` — per-device: event-type pivot + coverage window
    (`first_event_at_iso`, `last_event_at_iso`, `span_days`, `total_log_records`).
  - `manifestRows(fileMeta, disclosures)` — file inventory (name, description, scope, data row
    count, bytes, sha256) + disclosure rows (§9).
  - `renderLogsMarkdown(bundles, summary, securityEval?)` — the human report (§7).
- **Reused unchanged:** `render.mjs` `toCsv`/`esc` (RFC-4180 minimal quoting, CRLF terminators,
  `\n`-joined multi-line cells); `evaluate.mjs` `buildMajorTables`/`evaluateDevice`/`deviceCveRows`
  for `--with-security`; `sofa.mjs` `loadSofa`; `docx.mjs` `mdToDocx`; `make-audit-pdf.sh` for PDF.

## 6. Data flow

1. Parse args → selector + flags + format + outDir. Validate exactly-one-selector; `--all` requires
   `--confirm-all`.
2. Load API key from env or `.env`; missing → exit 1.
3. `resolveDevices()` → target device set. Empty → exit with a clear "no devices matched" message.
   For `--all`, print the resolved device count before the heavy per-device fetch.
4. For each device (continue-on-error, see §8): fetch fully-paginated logs; under `--with-inventory`
   also apps/profiles/users; assemble a per-device **bundle** (device record + groups + logs
   [+ apps/profiles/users]).
5. If `--with-security`: `loadSofa()` once, `buildMajorTables()`, `evaluateDevice()` per selected
   device → posture + per-device CVEs.
6. Build rows via `lib/logs.mjs`; resolve assignment-group + legacy-device-group names.
7. Write artifacts (§7) using `toCsv`; raw JSON via `JSON.stringify`; manifest with SHA-256;
   `report.md` if format in {md,docx,all}; docx via `mdToDocx`; PDF via `make-audit-pdf.sh`.
8. Print headline (device count, total events, per-event-type totals, partial-failure count if any),
   list files, remind output is local-only and not committed.

## 7. Outputs

In `reports/logs-audit-<YYYY-MM-DD>/` (gitignored):

**Always (logs core):**
- `logs.csv` — one row per event; typed columns, ISO + verbatim timestamps, chronologically sorted.
- `logs-status-snapshots.csv` — `status.changed` snapshots isolated; multi-line `status_pretty`.
- `logs-summary.csv` — per-device event pivot + coverage window.
- `raw-logs.json` — complete unaltered per-device log records + export metadata.
- `manifest.csv` — file inventory + SHA-256 + disclosures.
- `summary.txt` — headline counts (mirrors audit's `summary.txt`).

**With `--with-inventory`:** `inventory.csv`, `apps.csv`, `profiles.csv`.

**With `--with-security`:** `security-posture.csv` (per device: OS, latest minor/major, FileVault/
SIP/firewall, unfixed/exploited CVE counts, last_seen), `device-cves.csv` (per device, every CVE it
is still missing — reuses `deviceCveRows`).

**Document (format in {md,docx,all}):** `report.md`, and `report.docx` (pandoc) / `report.pdf`
(`make-audit-pdf.sh`). The document contains:
- A **logs summary** section — per-device activity overview: event counts by type, coverage window,
  notable events (e.g., software-update failures surfaced from `status.changed`).
- A **security summary** section — included **only when `--with-security`**: per-device posture and
  outstanding CVEs.
Both summaries are derived/aggregated views; the CSV/JSON artifacts remain authoritative and
unaltered.

## 8. Error handling

- Missing API key → `LOGS-AUDIT FAILED: Missing SIMPLEMDM_API_KEY` → exit 1.
- No/invalid selector (zero or multiple) → usage message → exit 2.
- `--all` without `--confirm-all` → print fleet device count + warning, instruct to re-run with
  `--confirm-all` → exit 2 (no heavy fetch performed).
- Selector matched zero devices → clear message ("no devices matched <selector>") → exit 3, so
  automation can distinguish "ran fine, nothing matched" from a successful export.
- Per-device fetch failure (network/API error after retries) → record an **error row** in
  `manifest.csv` (`file="(error: <serial>)"`, description = error text), skip that device's
  artifacts, **continue** the run. Final summary reports `N device(s) failed; export is partial`.
- Unparseable `at` → keep `at` verbatim, `at_iso=""`, increment an "unparseable_timestamps" counter
  shown in `summary.txt`.

## 9. Fidelity & disclosures (legal defensibility)

Carried over from the reviewed ad-hoc export:
- **Timestamps:** `at` reproduced verbatim; `at_iso` is the same wall-clock reformatted to ISO 8601
  with **no timezone shift** and **no UTC claim**. The `/logs` API returns times in the account's
  display timezone (devices report `America/New_York`) without an offset, and the account endpoint
  does not expose the zone. Disclosed in the manifest.
- **Retention horizon:** the `/logs` feed is retention-bounded; the earliest event per device is the
  API's retention horizon, not device-lifetime history. Surfaced per device in `logs-summary.csv`
  and disclosed in the manifest.
- **Completeness:** every collection is fully paginated; `manifest.csv` notes that all returned
  `has_more=false` at export time, records are verbatim, and derived columns are additive.
- **Integrity:** SHA-256 of each output file in the manifest.

## 10. Testing

- `test/logs-audit.test.mjs` (node:test, matching the existing runner) over fixtures in
  `test/fixtures/` (sample `/logs` payloads covering all four observed event types —
  `app.installing`, `profile.installed`, `status.changed`, `bootstrap_token.get` — plus a small
  device list). All assertions run against the **pure** functions in `lib/logs.mjs`; no network.
- Cases: `toIso` valid/invalid; `logRows` typed columns + chronological sort + status blob excluded;
  `statusSnapshotRows` multi-line cell + extracted fields; `logSummaryRows` pivot counts + coverage
  window + `span_days`; `manifestRows` includes all disclosures; CSV round-trips through `esc`
  (multi-line cell survives a parse).
- A doc/consistency note: extend the existing tooling that keeps docs in sync, if applicable, to
  reference the new skill.

## 11. Skill

`.claude/skills/logs-audit/SKILL.md`, mirroring `.claude/skills/audit/SKILL.md`:
- Map words → flags: "last 10 seen" → `--last-seen 10`; a serial → `--serial`; a group name →
  `--group`; "whole fleet/all" → `--all --confirm-all`; "with security/posture" →
  `--with-security`; "with apps/profiles/inventory" → `--with-inventory`; format words → `--format`.
- Run `node scripts/logs-audit.mjs <flags>`, read `summary.txt`, relay the headline, list files,
  remind the output is local-only (gitignored) and not committed.

## 12. Open questions / future work

- Resolving a single "assigned owner" per device is out of scope (devices have no canonical owner
  field); the report uses the device `name` and macOS local-account users instead.
- Possible future: incremental/append mode keyed on `last_seen` to extend a prior export window;
  not in v1 (YAGNI).
