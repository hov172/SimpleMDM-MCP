# Fleet Inventory Reports (`/inventory`)

`scripts/inventory-report.mjs` builds a **searchable fleet inventory** straight from the
SimpleMDM API (read-only): devices, installed apps, assigned apps **and** assigned
profiles with deployment-gap detection, local users, and groups — selected by a
multi-keyword + field-filter query language, exported as CSVs plus a combined dossier in
Markdown / HTML / Word / PDF.

It is a host-side script + the `/inventory` Claude Code skill, **not an MCP tool**.
Siblings: [`/audit`](fleet-audit.md) (fleet security posture vs SOFA) and
[`/logs-audit`](logs-audit.md) (forensic activity logs).

- **Read-only**: a read-only `SIMPLEMDM_API_KEY` in `.env` is sufficient; zero writes.
- **Local-only output**: `reports/` is gitignored; exports contain live tenant data and
  are never committed.
- **Rendering**: `pandoc` for html/docx; PDF prefers WeasyPrint (A3 landscape,
  real footer page numbers) with headless-Chrome fallback — the same shared pipeline as
  the other two reports (`scripts/lib/report-pdf.mjs`, stylesheet
  `scripts/inventory-report.head.html`).

## CLI

```bash
node scripts/inventory-report.mjs [selector] [--search '<query>'] [flags]
```

At most **one** selector; `--search` may stand alone or combine with a selector.

| Selector | Meaning |
|---|---|
| `--serial A,B,C` | specific devices (comma-separated serials) |
| `--last-seen N` | the N most recently seen devices |
| `--group "Name"` | device **or** assignment group by (case-insensitive) exact name |
| `--all --confirm-all` | whole fleet (apps/profiles/users are fetched per device — heavy) |

| Flag | Meaning |
|---|---|
| `--format csv\|md\|docx\|all` | `csv` → CSVs + summary only; `md` adds `report.md`; `docx` adds Word; `all` (default) adds HTML + PDF |
| `--report-detail summary\|table\|full` | per-device dossier tables: `summary` = facts + assigned apps/profiles tables; `table` adds the installed-apps table; `full` adds installed profiles + local users |
| `--report-style dossier\|roster` | `dossier` (default) = audit style (rollups → findings → per-device facts); `roster` = people-facing list — by-group summary with total, type/model breakdowns, then one section per device group with one row per device (model #, marketing name, year, device name, serial, **local users**, **assignment groups**, macOS, last seen), sorted oldest-seen first |
| `--no-apps` / `--no-profiles` / `--no-users` | skip a per-device section entirely (its CSV is skipped; a query referencing it errors) |
| `--no-findings` | skip the findings pass |
| `--raw` | write `raw/devices.json` (redacted — see Secrets) |
| `--allow-partial` | exit 0 despite failed per-device fetches (default exit 2 — see Completeness) |
| `--out <dir>` | output directory (default `reports/inventory-YYYY-MM-DD/`, auto-suffixed `-2`, `-3`… if it exists) |

Exit codes: `0` ok · `1` fatal · `2` argument/query error **or** partial data without
`--allow-partial` · `3` selector matched nothing.

## The query language (`--search`)

Tokens split on whitespace; `"double quotes"` glue spaces (and protect commas) inside a
token. Bare keywords match case-insensitively across every indexed field and AND
together. `OR` joins adjacent terms; `-term` negates; `field:value` scopes a term.

Value syntax, per field kind:

- **comma-list = OR**: `group:faculty,staff` — quotes protect embedded commas:
  `model:"iMac (24-inch, M1, 2021)"` stays one alternative
- **wildcards**: `serial:C02*` (anchored glob, case-insensitive)
- **comparators** `>` `<` `>=` `<=` — numeric-aware for versions (`os:<15.5`,
  `15.10 > 15.9`), epoch-aware for dates (`seen:>=2025-01-01`), plain numeric for
  `storage:`/`battery:`
- **ranges**: `os:15.1..15.7`, `enrolled:2025-01-01..2025-06-30` (date ranges include the
  whole end day)
- **relative dates**: `seen:90d` = within the last 90 days
- **booleans**: `on/off` (also `yes/no/true/false/1/0`); a `null` posture (e.g. FileVault
  on an iPad) matches **neither** `on` nor `off`
- **app version tails**: `app:zoom<6.0.10` (name substring across name + bundle id, then
  version compare)

| Field | Kind | Notes |
|---|---|---|
| `name` `devicename` `serial` `udid` `imei` | text | identity |
| `mac` | text | matches WiFi, Bluetooth, and Ethernet MACs |
| `ip` | text | last-seen IP |
| `model` | text | matches the model identifier **and** the SOFA marketing name |
| `type` | text | derived class: `imac` `laptop` `desktop` `ipad` `iphone` `appletv` `mac` `other` |
| `arch` | text | `processor_architecture` (e.g. `intel`, `arm64`) |
| `os` `build` | version / text | `os` compares numerically |
| `group` | text | device **and** assignment group names |
| `devicegroup` | text | device group name only (use when assignment-group matches would over-select) |
| `assignment` | text | assignment group names only |
| `assigned` | text | apps assigned via the device's assignment groups ("should have") |
| `app` | app | installed apps ("does have"), optional version tail |
| `profile` `user` | text | installed profile names; local usernames/full names |
| `seen` `enrolled` | date | absolute, relative, ranges |
| `storage` | number | GB free |
| `battery` | number | percent |
| `filevault` `recoverykey` `sip` `firewall` `supervised` `dep` `ard` `uamdm` `ddm` `activationlock` `lostmode` `firmwarelock` `recoverylock` `passcode` | bool | security/management posture (`ard` = Remote Desktop, `uamdm` = user-approved MDM, `ddm` = declarative management) |
| `status` | text | enrollment status (`enrolled`, `awaiting enrollment`, …) |
| `attr.<name>` | text | any custom attribute, e.g. `attr.xprotect_version:<5305` |

Unknown fields fail fast with the valid-field list — they are never silently treated as
keywords.

### Query planning (why scoped searches are fast)

After parsing, the query is an AND of units (a unit = one term or one OR group). A unit
is **device-level** only if *every* OR alternative is answerable from the fleet sweep
alone. The engine prefilters on the conjunction of device-level units **before** paying
any per-device API calls, then evaluates per-device units (`app:` `profile:` `user:`,
bare keywords, and any mixed-scope OR group) in a second pass. Mixed OR groups like
`group:faculty OR app:zoom` are never used to prefilter — a device outside the group
could still match via the app branch. A fleet-wide search with **no** device-level unit
must fetch per-device data for every device and therefore requires `--confirm-all`. The
engine prints its plan: `prefilter N unit(s) → M device(s); per-device pass K unit(s)`.

## Assigned vs installed

- **Assigned apps** come from assignment groups (`/assignment_groups` →
  `relationships.apps`, names resolved via `/apps`). Each row reports `installed`
  (yes/no/unknown), `managed` (is the matched installed copy MDM-managed), and
  `installed_as` (the live installed app + version that matched). Matching is a
  case-insensitive substring heuristic against installed name + bundle id — installer
  packages/scripts may legitimately read `installed: no` because they never appear in app
  inventory under their catalog name.
- **Assigned profiles** come from `/profiles` relationships, which carry **three**
  assignment paths (all verified live): `device_groups`, `groups` (= assignment groups),
  and `devices` (direct). Matching uses the exact `profile_identifier` with name-equality
  fallback, so `installed` is reliable.

## Findings

Always written to `findings.csv` (header-only when empty) and rendered in the dossier as
a rollup table plus one compact table per type:

| Type | Trigger |
|---|---|
| `assigned-app-missing` | assigned via an assignment group, no installed match |
| `assigned-profile-missing` | assigned via device group / assignment group / direct, no installed match |
| `low-storage` | < 10 GB free |
| `stale-device` | not seen in 90+ days |
| `recovery-key-missing` | FileVault on but no recovery key escrowed |
| `duplicate-name` | 2+ devices share a name |
| `os-outlier` | mac more than 1 major version behind the fleet's modal major |

## Completeness model (partial data is never silent)

Every per-device section (`apps`, `profiles`, `users`) tracks `ok` / `failed` /
`skipped`. When a fetch **fails**:

- query terms needing that section evaluate to **undetermined** — the device is included
  and flagged (`match_reasons` says why), never silently dropped or counted as a non-match;
- findings that depend on it are emitted with status `unknown`, never asserted;
- the device's `sections_failed` column and the dossier's ⚠ Incomplete callout say so;
- `summary.txt` lists each failure (serial, section, message) and the run **exits 2**
  unless `--allow-partial`.

`--no-apps`-style skips are deliberate exclusions, not unknowns. App-catalog/rollup
exclusions due to incomplete data are disclosed in `summary.txt` and the dossier.

## Secrets

`filevault_recovery_key`, `firmware_password`, and `recovery_lock_password` are actual
secret values in the SimpleMDM device payload. They never reach **any** output file: the
normalized record carries only booleans (`recoverykey`, `firmwarelock`, `recoverylock`),
and `--raw` dumps replace the values with `[REDACTED set=yes]`. The engine tests assert
fixture secrets appear in no output.

## Prompt cookbook

Common phrasings and what they translate to. (In Claude Code the `/inventory` skill — or
the `run_inventory_report` MCP tool — does this mapping for you.)

### Everyday inventory

| Say this | Runs |
|---|---|
| "inventory the Faculty group" | `--group "Faculty"` |
| "full inventory of the 10 most recently seen devices" | `--last-seen 10 --report-detail full` |
| "all faculty and staff devices seen since 2025" | `--search 'group:faculty,staff seen:>=2025-01-01'` |
| "which devices haven't checked in for 90 days?" | `--search '-seen:90d'` |
| "every Intel Mac still in service" | `--search 'arch:intel seen:90d'` |
| "all the M1 iMacs" | `--search 'model:"iMac (24-inch, M1, 2021)"'` |
| "iPads only, as a PDF" | `--search 'type:ipad' --format all` |

### Security & compliance

| Say this | Runs |
|---|---|
| "unencrypted Macs that are actively used" | `--search 'filevault:off seen:30d'` |
| "FileVault on but recovery key not escrowed" | `--search 'filevault:on recoverykey:no'` |
| "Remote Desktop enabled but no firewall" | `--search 'ard:on firewall:off'` |
| "anything still below macOS 15" | `--search 'os:<15 type:laptop,imac,desktop,mac'` |
| "devices not enrolled through ADE/DEP" | `--search 'dep:no'` |
| "who's not on declarative management yet?" | `--search 'ddm:off'` |

### Deployment gaps & app management

| Say this | Runs |
|---|---|
| "assigned Zoom but don't have it" | `--search 'assigned:zoom -app:zoom' --confirm-all` |
| "who has Zoom older than 6.0?" | `--search 'app:zoom<6.0' --confirm-all` |
| "is the assigned software actually installed in this lab?" | `--group "<Lab>" --report-detail table` → `assigned-apps.csv` (`installed` / `managed` / `installed_as`) |
| "unmanaged copies of assigned apps" | any scope → filter `assigned-apps.csv` for `installed=yes, managed=no` |

### Lifecycle & housekeeping

| Say this | Runs |
|---|---|
| "devices running out of disk" | `--search 'storage:<20 seen:30d'` |
| "laptops with dying batteries" | `--search 'type:laptop battery:<50 seen:7d'` |
| "everything enrolled this semester" | `--search 'enrolled:2026-01-15..2026-06-10'` |
| "hardware age report" | any scope → `by-model.csv` (marketing name + release year) |

### Targeted hunts

| Say this | Runs |
|---|---|
| "who owns MAC address a4:83:e7…?" | `--search 'mac:a4:83:e7*'` (WiFi, Bluetooth, Ethernet) |
| "which device had IP 148.74.x?" | `--search 'ip:148.74.*'` |
| "serials starting C02 or FVFG, on macOS 13" | `--search 'serial:C02* OR serial:FVFG* os:13'` |

Composite phrasings translate directly: *"intel laptops without filevault seen this month,
excluding loaners"* → `arch:intel type:laptop filevault:off seen:30d -group:loaners`.

### Recipe: people-facing roster export

To produce a roster-style report ("Faculty/Staff Device Inventory" — by-group summary,
type/model breakdowns, then one compact section per device group with one row per device:
model #, marketing name, release year, device name, serial, local users, assignment
groups, macOS, last seen) — one command:

```bash
node scripts/inventory-report.mjs \
  --search 'devicegroup:faculty,staff' --report-style roster --format all
```

Add `seen:>=2026-01-01` for an "active this year" variant. Note `devicegroup:` (not
`group:`): the roster is organized by *device* group, and `group:` would also pull in
devices whose *assignment* groups happen to match the keywords. Full data still lands in
the CSVs (`devices.csv` + `users.csv`), and the same roster renders in md/html/docx/pdf.

### Quick command templates

Fill in the `<angle brackets>`; everything else is ready to paste.

```bash
# GENERAL TEMPLATE
node scripts/inventory-report.mjs \
  --search '<query>' \
  --report-style <dossier|roster> --report-detail <summary|table|full> \
  --format <csv|md|docx|all> [--out reports/<name>]

# COMMON ─────────────────────────────────────────────────────────────────────
# Group roster (people-facing PDF/Word)
node scripts/inventory-report.mjs --search 'devicegroup:<groups>' --report-style roster --format all

# Full audit dossier for one group
node scripts/inventory-report.mjs --group "<Group>" --report-detail full --format all

# Most recently active devices, everything
node scripts/inventory-report.mjs --last-seen <N> --report-detail full --format all

# Stale sweep: not seen in N days
node scripts/inventory-report.mjs --search '-seen:<N>d' --format csv

# SPECIALIZED ────────────────────────────────────────────────────────────────
# Compliance pack: unencrypted + actively used (leadership-ready PDF)
node scripts/inventory-report.mjs --search 'filevault:off seen:30d' --format all

# Escrow gap: encrypted but no recovery key
node scripts/inventory-report.mjs --search 'filevault:on recoverykey:no' --format csv

# Deployment gap: assigned an app but missing it (fleet-wide per-device scan)
node scripts/inventory-report.mjs --search 'assigned:<app> -app:<app>' --confirm-all

# Refresh planning: old Intel machines still in use
node scripts/inventory-report.mjs --search 'arch:intel seen:30d os:<15' --format all

# Low disk before it bites
node scripts/inventory-report.mjs --search 'storage:<20 seen:30d' --format csv

# Forensic hunt by network identity
node scripts/inventory-report.mjs --search 'mac:<prefix>*' --format csv
node scripts/inventory-report.mjs --search 'ip:<prefix>*' --format csv

# Semester intake: everything enrolled in a window
node scripts/inventory-report.mjs --search 'enrolled:<YYYY-MM-DD>..<YYYY-MM-DD>' --report-style roster --format all
```

When `/inventory` isn't the right tool: what's *vulnerable* (CVEs, upgrade paths) →
[`/audit`](fleet-audit.md); what *happened* (activity timeline, forensic dossier) →
[`/logs-audit`](logs-audit.md).

## Output reference

See the [README section](../README.md#fleet-inventory-reports-inventory) for the
file-by-file table. Every output (summary.txt included) is SHA-256-hashed in
`manifest.sha256`. The dossier's md/html/docx/pdf are rendered from the same `report.md`,
so content is identical across formats; dossier dates are shortened to `YYYY-MM-DD` while
CSVs keep full ISO timestamps.

## Code map

| File | Responsibility |
|---|---|
| `scripts/inventory-report.mjs` | CLI engine: guards → fleet sweeps → prefilter → per-device fetches → evaluate → write |
| `scripts/lib/query.mjs` | pure query language: tokenizer → parser → planner → tri-state evaluator (no I/O) |
| `scripts/lib/inventory.mjs` | API-shape normalization: searchable record, model enrichment (SOFA `Models` overlaid on the legacy table), assignment maps, CLI args |
| `scripts/lib/apple-legacy-models.mjs` | curated identifier → marketing name + release year for pre-SOFA Macs (iMac14,1 → "iMac (21.5-inch, Late 2013)"), sourced from Apple's identify-your-model pages (e.g. [108054](https://support.apple.com/en-us/108054)); SOFA wins whenever it knows the model |
| `scripts/lib/inventory-render.mjs` | CSV row builders, rollups, findings, markdown dossier |
| `scripts/inventory-report.head.html` | A3-landscape PDF stylesheet (shared renderer: `scripts/lib/report-pdf.mjs`) |
| `test/query.test.mjs`, `test/inventory-report.test.mjs`, `test/inventory-engine.test.mjs` | parser/evaluator units, normalization/render units, end-to-end engine with mocked fetch |
