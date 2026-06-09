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

It is **not** part of the MCP server's tool surface. It's a host-side script
(`scripts/logs-audit.mjs`) plus a `/logs-audit` Claude Code skill wrapper. It talks
**directly to the SimpleMDM API** (read-only) — a read-only API key is sufficient.

---

## Running it

In Claude Code, ask for it (the **`/logs-audit`** skill maps your words to flags):

> *"export the logs for serial ABC123"* · *"build a forensic log report for the last 10 devices seen, with security"* · *"audit the LibLab group's device logs"*

Or run the engine directly:

```bash
node scripts/logs-audit.mjs <selector> [flags]
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
| `--out <dir>` | output directory (default `reports/logs-audit-YYYY-MM-DD/`) |
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
| `report.md` / `.html` / `.docx` / `.pdf` | the combined **dossier** (see below) |

### The combined dossier (`report.*`)

A professional, US-Letter portrait document combining everything captured into one
per-device narrative:

- **Fleet roll-up** — one row per device: OS, unfixed/exploited CVEs, FileVault/SIP/Firewall, event count, last seen.
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
node scripts/logs-audit.mjs --serial C02ABC123XYZ --format all

# The 10 most recently active devices, with security posture, full report
node scripts/logs-audit.mjs --last-seen 10 --with-security --format all

# A whole group, with inventory + security, data files only
node scripts/logs-audit.mjs --group "Faculty" --with-inventory --with-security --format csv

# Two specific devices into a named directory
node scripts/logs-audit.mjs --serial ABC123,DEF456 --out reports/case-2026-06 --format all

# Whole fleet (heavy — explicit acknowledgement required)
node scripts/logs-audit.mjs --all --confirm-all --format csv
```

---

## Architecture / code map

| File | Responsibility |
|---|---|
| `scripts/logs-audit.mjs` | entry point — arg parsing, `.env` key load, device resolution, per-device fetch (continue-on-error), artifact writing, manifest + summary |
| `scripts/lib/logs.mjs` | **pure** functions (no network/fs): `parseArgs`, `selectDevices`, `toIso`, `logRows`, `statusSnapshotRows`/`statusSnapshotFiles`, `logSummaryRows`, `manifestRows`/`DISCLOSURES`, `renderDetailedReport` |
| `scripts/lib/simplemdm.mjs` | API client — paginated device / `/logs` / apps / profiles / users / group fetchers |
| `scripts/lib/evaluate.mjs`, `sofa.mjs` | reused from `/audit` for the `--with-security` SOFA evaluation |
| `scripts/lib/render.mjs` | reused `toCsv` / `esc` (RFC-4180, CRLF, multi-line cells) |
| `scripts/logs-report.head.html` | the US-Letter portrait report stylesheet (page footer, callouts, table styling) |
| `.claude/skills/logs-audit/SKILL.md` | the `/logs-audit` skill wrapper |

All transform/selection/parse logic lives in the pure `lib/logs.mjs` and is unit-tested
in `test/logs-audit.test.mjs`; the entry script is thin I/O orchestration.

---

## Caveats

- **`--all` is heavy** — it fetches `/logs` for every device in the fleet (hundreds of
  paginated calls). It is gated behind `--confirm-all`.
- **No single "owner" field** — SimpleMDM devices have no canonical owner; the report uses
  the device `name` and macOS local-account users instead.
- **PDF tooling** — `.pdf`/`.html`/`.docx` are best-effort; if `pandoc` / WeasyPrint /
  Chrome are absent the run logs a warning and still writes everything else (including
  `report.md`).
