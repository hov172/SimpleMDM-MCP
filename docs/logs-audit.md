# Device Logs Audit (`/logs-audit`) — Deep Dive

A self-contained command that produces a **targeted, legal/forensic export of device
activity logs** for a selected set of devices, straight from the SimpleMDM **`/logs`**
feed — with optional security posture and software inventory combined in. It answers,
per device: *what happened on this machine, when, in what order — and (optionally) what
is its security posture and software footprint?* — and exports the results to CSV, raw
JSON, a SHA-256 integrity manifest, and a detailed combined report (Markdown / HTML /
Word / PDF).

It is a **sibling** to the [`/audit`](fleet-audit.md) command, not a replacement:

| | `/audit` (SOFA security) | `/logs-audit` (this) |
|---|---|---|
| Selection | **Fleet-wide** (all devices) | **Targeted** (serials / last-N-seen / group) |
| Source | SOFA CVE feed + device inventory | per-device `/logs` (paginated) |
| Purpose | Vulnerability / compliance posture | Activity / event timeline (legal/forensic) |
| Cadence | Run on the whole fleet regularly | Run on demand for specific devices |

It is driven by the **unified TypeScript report engine** (`src/reports/`, compiled to
`dist/reports/cli.js`), exposed via the `/logs-audit` Claude Code skill, the
`run_device_logs_audit` MCP tool (spawns the CLI as a host-side subprocess, writes files),
and the in-process `generate_report` MCP tool (catalog mode `report: "logs"`). It talks
**directly to the SimpleMDM API** (read-only) — a read-only API key is sufficient.

---

## Running it

In Claude Code, ask for it (the **`/logs-audit`** skill maps your words to flags):

> *"export the logs for serial ABC123"* · *"build a forensic log report for the last 10 devices seen, with security"* · *"audit the LibLab group's device logs"*

Or run the engine directly:

```bash
node dist/reports/cli.js logs <selector> [flags]
```

### Selectors (exactly one required)

| Selector | Meaning |
|---|---|
| `--serial A,B,C` | specific devices by serial number (comma-separated) |
| `--last-seen N` | the **N** most recently seen devices (sorted by `last_seen_at` desc) |
| `--group "Name"` | every device in a device group **or** assignment group of that name |
| `--all` | the whole fleet — **requires `--confirm-all`** (heavy: one log fetch per device) |

### Flags

| Flag | Meaning |
|---|---|
| `--with-inventory` | also export per-device inventory + installed apps + profiles |
| `--with-security` | also run the SOFA evaluation on the selected devices (posture + CVEs) |
| `--format <fmt>` | `csv` \| `md` \| `docx` \| `all` (default `all`) |
| `--report-detail <lvl>` | per-device log detail in the report document: `summary` (aggregation + findings, default) \| `table` (full per-device event table) \| `full` (both). `logs.csv`/`raw-logs.json` always keep 100% regardless |
| `--out <dir>` | output directory (default `reports/logs-audit-YYYY-MM-DD/`) |
| `--report-only` | write only the rendered report + `summary.txt` + `manifest.csv`; skip the data exports (not valid with `--format csv`) |
| `--allow-partial` | exit 0 even if some per-device log fetches failed (default exit 2 so partial data is never silent) |
| `--confirm-all` | required acknowledgement for `--all` |

**Requirements:** `SIMPLEMDM_API_KEY` in `.env` (a **read-only** key is sufficient).
`pandoc` is needed for `.docx`/`.html`/`.pdf`; PDF prefers
[WeasyPrint](https://weasyprint.org) (`brew install weasyprint`) for footer page
numbers and falls back to headless Chrome.

### Format behaviour

- `--format csv` — data files only (CSV + JSON + manifest + snapshot sidecars).
- `--format md` — adds `report.md` (the detailed dossier).
- `--format docx` — adds `report.md` + `report.docx`.
- `--format all` (default) — adds `report.md` + `report.html` + `report.docx` + `report.pdf`.

---

## Output files

Everything is written to `reports/logs-audit-YYYY-MM-DD/` (which is **gitignored** —
exports contain live tenant data, serials, and event history, and are never committed):

| File | Contents |
|---|---|
| `logs.csv` | one row per `/logs` event — chronologically sorted, with both the verbatim `at` and a sortable `at_iso`, device name/owner, and **typed metadata columns** per event type |
| `logs-status-snapshots.csv` | one row per `status.changed` event with the key fields extracted, plus a `status_json_file` column pointing to the full snapshot sidecar |
| `status-snapshots/` | one `<serial>__<logid>.json` file per `status.changed` event holding the **full** device-status snapshot (kept out of the CSV so no cell exceeds spreadsheet limits) |
| `logs-summary.csv` | per-device pivot + **coverage window**: event-type counts, `first_event_at_iso`, `last_event_at_iso`, `span_days` |
| `raw-logs.json` | the complete, unaltered per-device log records + export metadata |
| `manifest.csv` | file inventory with **SHA-256** of every output (including each snapshot sidecar), plus timezone / retention / completeness **disclosures** and any per-device collection errors |
| `summary.txt` | headline counts (devices, total events, per-event-type totals, unparseable timestamps, failed devices) |
| `inventory.csv`, `apps.csv`, `profiles.csv` | *(with `--with-inventory`)* per-device inventory, installed apps, configuration profiles |
| `security-posture.csv`, `device-cves.csv` | *(with `--with-security`)* SOFA posture for the selected devices, and every CVE each is still missing |
| `findings.csv` | auto-detected per-device findings (app-reinstall loops, software-update-failure loops, profile churn) — written when any are detected |
| `report.md` / `.html` / `.docx` / `.pdf` | the combined **dossier** (see below) |
| `manifest.sha256`, `<report-dir>.zip` | *(on `--format all`)* always-on bundle artifacts — a sha256sum-format integrity list of every deliverable and a single zip archive of the whole report directory (python3 stdlib, best-effort). This is in addition to the bespoke `manifest.csv` above (which carries the legal disclosures). |

### The combined dossier (`report.*`)

A professional, US-Letter portrait document combining everything captured into one
per-device narrative:

- **Fleet roll-up** — one row per device: OS, unfixed/exploited CVEs, FileVault/SIP/Firewall, event count, last seen.
- **Noisy-device flag** — any device contributing an outsized share (>=25%) of total log volume while dwarfing the rest is called out in a callout and marked ⚠ in the roll-up (also listed in `summary.txt`). A single flooding device skews the fleet totals and can evict other devices' events from the retention-bounded `/logs` feed, so it's surfaced automatically.
- **Findings engine** — auto-detected per-device patterns a count-only summary hides: **app-reinstall loops** (same app/version installed many times — a broken Munki installs-check), **software-update failure loops**, and **profile reinstall churn**. Surfaced as a fleet callout, a per-device ⚠ Findings block, a `summary.txt` line, and a machine-readable `findings.csv`.
- **Top installed apps (by install count)** per device — makes the *content* behind the activity counts visible (e.g. one app reinstalling hundreds of times).
- **Per-device dossier** — identity (model, OS+build, UDID, enrolment, last seen), assignment groups, local accounts, **security posture** (with `--with-security`: findings + CVE counts as a callout), **activity** (event-type breakdown + coverage window), **notable software-update events** (pending OS, install state, failure counts), and **software inventory** (with `--with-inventory`: app/profile counts).
- **Disclosures** — timezone, retention, and authoritative-source notes.

The PDF is rendered by WeasyPrint (with a "Page X of Y" footer) when available, else by
headless Chrome.

---

## Fidelity & disclosures (legal defensibility)

- **Timestamps** — the `at` field is reproduced **verbatim** from the API. SimpleMDM
  returns `/logs` times in the account's display timezone (devices report
  `America/New_York`) **without a UTC offset**, and the account endpoint does not expose
  the zone, so `at_iso` is the same wall-clock reformatted to ISO 8601 with **no shift**
  and **no UTC claim**. This is disclosed in the manifest.
- **Retention** — the `/logs` feed is retention-bounded; the earliest event per device
  (`logs-summary.csv` → `first_event_at_iso`) is the API's retention horizon, **not** the
  device's full lifetime history.
- **Completeness** — every collection is fully paginated (`has_more=false` at export
  time); records are reproduced verbatim and all derived columns are additive.
- **Integrity** — every output file (and every snapshot sidecar) is SHA-256-hashed in
  `manifest.csv`. Devices that fail collection are recorded there too, so a partial export
  is self-evident.

---

## Examples

```bash
# One device, every artifact (CSV + JSON + manifest + md/html/docx/pdf report)
node dist/reports/cli.js logs --serial C02ABC123XYZ --format all

# The 10 most recently active devices, with security posture, full report
node dist/reports/cli.js logs --last-seen 10 --with-security --format all

# A whole group, with inventory + security, data files only
node dist/reports/cli.js logs --group "Faculty" --with-inventory --with-security --format csv

# Two specific devices into a named directory
node dist/reports/cli.js logs --serial ABC123,DEF456 --out reports/case-2026-06 --format all

# Whole fleet (heavy — explicit acknowledgement required)
node dist/reports/cli.js logs --all --confirm-all --format csv
```

---

## Architecture / code map

The logs audit is one report in the **unified TypeScript report engine** under
`src/reports/` (compiled to `dist/reports/`):

| File | Responsibility |
|---|---|
| `src/reports/cli.ts` | CLI entrypoint (`dist/reports/cli.js`) + shared `runReport` core: arg parsing, selectors, `--with-security`/`--with-inventory` toggles |
| `src/reports/specs/logs.ts` · `specs/registry.ts` | the logs report spec — device resolution, per-device fetch (continue-on-error), snapshot sidecars, bespoke `manifest.csv` + summary — wired into the registry |
| `src/reports/domain/logs.ts` | **pure** functions (no network/fs): `selectDevices`, `toIso`, `logRows`, `statusSnapshotRows`/`statusSnapshotFiles`, `logSummaryRows`, `manifestRows`/`DISCLOSURES`, `renderDetailedReport` |
| `src/reports/data/server-source.ts` · `scripts/lib/simplemdm.mjs` | read-only data source — paginated device / `/logs` / apps / profiles / users / group fetchers |
| `src/reports/domain/sofa-eval.ts` · `scripts/lib/sofa.mjs` | reused from `/audit` for the `--with-security` SOFA evaluation |
| `src/reports/engine/{csv,theme,document,extras}.ts` | shared rendering: `toCsv` (RFC-4180, CRLF, multi-line cells), the US-Letter portrait theme (page footer, callouts), and always-on bundle artifacts (`manifest.sha256`, `<dir>.zip`) |
| `.claude/skills/logs-audit/SKILL.md` | the `/logs-audit` skill wrapper |

All transform/selection/parse logic lives in the pure `domain/logs.ts` and is unit-tested
(plus the golden-parity test against `test/golden/logs/`); the spec is thin I/O
orchestration.

---

## Caveats

- **`--all` is heavy** — it fetches `/logs` for every device in the fleet (hundreds of
  paginated calls). It is gated behind `--confirm-all`.
- **No single "owner" field** — SimpleMDM devices have no canonical owner; the report uses
  the device `name` and macOS local-account users instead.
- **PDF tooling** — `.pdf`/`.html`/`.docx` are best-effort; if `pandoc` / WeasyPrint /
  Chrome are absent the run logs a warning and still writes everything else (including
  `report.md`).
