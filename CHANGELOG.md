# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[SemVer](https://semver.org/).

## [Unreleased]

## [0.31.1] - 2026-07-06

Documentation deep-dive plus four small fixes. No new tools, no tool-schema changes.

### Fixed
- Whole-fleet (`--all`) audit and inventory runs no longer print `Scope: last-seen true` in `summary.txt` — both summary scope labels lacked a case for the `all` selector kind and fell through to the last-seen branch; they now say `whole fleet`.
- Report-producing MCP tools now resolve relative `reports/` paths against the installed package root and launch the report CLI from that root, instead of depending on the MCP client's current working directory (`/`, `~`, or another unrelated directory in desktop clients) — on source installs launched by Claude Desktop, reports previously targeted `/reports/...`.
- Docker builds now include `data/`, so the Apple device-management schema helpers keep the full checked-in schema cache instead of silently falling back to the small curated seed set.
- `--allow-partial` is accepted for logs reports as documented by the partial-data model, while audit reports still reject it.

### Documentation
- **The README's Docker `claude mcp add` snippets never delivered the API key to the container** (verified empirically — `docker run` without `-e` does not forward host env; the server died at startup). Both snippets now forward with a bare `-e SIMPLEMDM_API_KEY` inside `docker run`.
- Removed the nonexistent `--no-findings` flag; documented `--findings-exclude`, the `diff` subcommand / `run_report_diff`, and `run_config_backup` in the README (the v0.31.0 headline features were absent from it).
- Requirements now cover the optional report-export toolchain (pandoc, WeasyPrint or headless Chrome, python3 — all graceful skips), OS support, and how `.env` is actually consumed (the server itself never loads it).
- PARTIAL/limitations semantics updated across README and all three report docs; inventory exit codes corrected (no exit 3; argument errors exit 1); CLI vs MCP-tool default output directories untangled.
- docs/tools.md: all 17 destructive tools now carry the `⚠️ destructive` marker (13 were missing), the stale "no message endpoint" note replaced (superseded by `push_message`), two broken links fixed.
- `.env.example` rewritten below the fold: the "Future options — do not enable" section wrongly forbade the fully-supported MunkiReport and local-app-mode variables; all ten are now documented with defaults (the file had been untouched since v0.6.0).
- Roadmap, CONTRIBUTING, PR template, SECURITY scope, and examples/README refreshed to match the current code (counts, test-suite reality, docs/tools.md as the tools reference, dead `reports/xprotect/STAGING.md` references removed).
- API-key permissions section now lists every read and write domain the 189 tools actually use.

## [0.31.0] - 2026-07-06

Tool-gap release from a usage- and API-surface analysis: seven new tools (182 → 189) and two report-quality changes. New endpoints were verified against the live tenant first — the three new device POSTs return 403 (missing API-key write scope), not 404, so enable the scopes in SimpleMDM Settings → API Keys to use them.

### Added
- **`download_custom_configuration_profile` / `download_custom_declaration`** — the `/download` endpoints were entirely unexposed: the server could not read (or back up) what a custom profile actually contains, and a deleted hand-crafted mobileconfig was unrecoverable. Live-verified (200, `application/x-apple-aspen-config`).
- **`run_config_backup`** — disaster-recovery export of the tenant's reproducible configuration: every custom profile's downloaded mobileconfig, custom declarations, scripts (with content), assignment/device groups, and custom attributes, with a sha256 manifest, under `reports/config-backup-<timestamp>/`. Per-item download failures are recorded (`partial: true`) without aborting. Native SimpleMDM-built profiles have no download endpoint — metadata only.
- **`refresh_device_inventory`** (`POST /devices/{id}/refresh`) — request fresh device info + app inventory after remediation instead of waiting for the next natural check-in. SimpleMDM throttles per device.
- **`disable_activation_lock`** (standalone, destructive-annotated) and **`push_message`** (max 225 chars, requires the SimpleMDM mobile app) — reinstated: the routes exist (verified live; the June 6 "phantom endpoint" verdict was wrong — the message endpoint is `push_message`, not `send_message`).
- **`run_report_diff`** + CLI `diff <before> <after>` — compare two inventory report runs: devices added/removed, meaningful field changes (OS, FileVault, SIP, firewall, group, …; volatile per-check-in fields ignored), findings new vs resolved. Answers "what changed since the last audit" — the same report had been re-run six times in a day for lack of it. Purely local; MCP tool paths restricted to `reports/`.

### Changed
- **`sync_device` description corrected**: it calls `POST /devices/{id}/push_apps` (re-push assigned apps) and never was a device check-in; the description now says so and points to `refresh_device_inventory`.
- **Deterministic `422 device is not enrolled` per-device fetches are now known limitations, not failures**: disclosed in `summary.txt` (`sections` value `unavailable`) but no longer stamping every whole-fleet inventory export PARTIAL forever — two permanently unenrolled devices had marked every run since June 22. Transient errors (429/5xx/network) still mark the export PARTIAL (exit 2 without `--allow-partial`).
- **`--findings-exclude <types>`** (CLI + `run_inventory_report` arg) — drop noisy finding types from the report (one type was 98% of a 3,695-finding run), with excluded counts disclosed in `summary.txt`.

## [0.30.5] - 2026-07-06

Second-pass review patch: an adversarial review of v0.30.4 plus a deep pass over previously unreviewed modules (Apple schema tooling, report support libraries, docs). No new tools; one tool description clarified.

### Fixed
- **v0.30.4's logs failure-threading was dead code on the live path**: `logsInputLive` built its failures list but never returned it, so a real per-device fetch failure still produced `Failed devices: 0`, a completeness attestation, and exit 0. The list is now returned, covered by an end-to-end test through the live input builder itself (mocked failing fetch) rather than synthetic injection.
- Profile builder emitted `<string>` where Apple requires `<data>` for data-typed schema values (certificate bodies, VPN shared secrets — 15+ key paths in the shipped schema cache): payloads passed validation but built profiles that fail to install. Data values (including nested `childKeys`/`itemKeys`) now emit `<data>`. Also: XML-1.0-illegal control characters are stripped (they made the plist unparseable), and unsafe-range integers emit as `<real>` instead of invalid `<integer>1e+21</integer>`.
- The schema sync script could silently replace the healthy 174-schema cache with the ~12 curated fallbacks when GitHub rate-limited the raw fetches. It now refuses to shrink an existing cache (new `--allow-shrink` to override), aborts when >20% of fetches fail, checks the git-trees `truncated` flag, and no longer swallows the total-bytes cap in fallback mode. The curated VPN fallback also registered identifier `VPN` instead of `com.apple.vpn.managed`, breaking the VPN payload builder after any fallback-written cache.
- A truncated or corrupt SOFA cache file bricked every `--with-security` report with a raw `SyntaxError` for up to 24 h. Cache reads are now guarded (fall back to refetch), writes are atomic (temp + rename), and a feed without `OSVersions` is rejected instead of cached — previously it silently evaluated every device as "untracked" with zero CVE data.
- `fetchDeviceGroups` was the one report fetcher with no 429 retry, and every report calls it up front — a single rate-limit hit aborted the whole run. Now routed through the retrying pagination helper.
- The reports CLI matched flag names against *value* tokens, so a search value spelled `--confirm-all` satisfied the whole-fleet confirmation guard (and flag-shaped values were rejected as unknown flags). Value positions are now tracked and exempt.
- A read starting immediately after a write could join a pre-write in-flight pagination and see stale data once; invalidation now detaches matching in-flight promises.

### Documentation
- `check_for_update` upgrade steps no longer say `git pull`, which fails for every pre-v0.30.4 clone after the history rewrite; they now use `git fetch && git reset --hard origin/main` with an explanatory note. The README gained the same upgrade guidance.
- The README no longer recommends `npm install -g simplemdm-mcp` — the package is not published to npm and that command 404s. Source install is the recommended path; SECURITY.md scope updated accordingly.
- `LOCAL_APP_MODE` docs and the keyless-mode error message now state exactly which tools work without `SIMPLEMDM_API_KEY` (the local-app-bridged ones), instead of over-promising (README) and under-promising (error message).
- `get_battery_health_report` no longer claims cycle-count/max-capacity data requires MunkiReport (it reads SimpleMDM device attributes; MunkiReport battery data lives in `get_munkireport_device_resources`). `get_pending_commands` documents the family-pairing fallback's masking window.
- `examples/claude-desktop-with-munkireport.json` gained the required `MUNKIREPORT_AUTH_HEADER_VALUE` placeholder — as shipped, copying it made every MunkiReport call throw.

## [0.30.4] - 2026-07-06

Correctness and security patch from a full-codebase review: eleven fixes, no new tools, no tool-schema changes.

### Security
- Removed `mcp.log` — a committed MCP session transcript containing live tenant data (device-group names, device IDs, app inventory) — from the repository **and from all git history**. The history rewrite changed every commit SHA and tag from v0.4.0 onward: **existing clones must be re-cloned**. The one-off scratch scripts `full_scan.mjs`/`summarize.mjs` were untracked alongside it, and the `.gitignore` now covers all three.
- Local-only planning docs (`docs/superpowers/`) can no longer ship in an npm tarball: `docs/.npmignore` excludes them even though `"docs"` is in the package `files` whitelist (npm packs from disk, not git; verified with `npm pack --dry-run`).

### Fixed
- `wipe_device` Return-to-Service was unusable: the arg validator compared `typeof` against the literal `"integer"`, so `wifi_network_id` — the only integer-typed parameter — was rejected for **every** input. Integer params now accept whole JS numbers and still reject fractions and strings.
- Dynamic `generate_report` with the `posture` adapter produced entirely wrong security data: it fed normalized `DeviceRecord`s into `evaluateDevice()`, which reads raw API field names, so every device evaluated as `platform:"unknown"` with FileVault/SIP/Firewall passing vacuously and current OSes flagged end-of-life. The adapter now evaluates the raw device shape (same as the audit path) and keeps the resolved group name.
- The logs (forensic/legal) export silently dropped devices whose log fetch failed while `summary.txt` hardcoded `Failed devices: 0` and the manifest attested completeness. Failures (including missing-serial skips) are now recorded in the report body, `summary.txt`, the manifest completeness disclosure (flips to `PARTIAL EXPORT`), and the CLI partial flag (exit 2 without `--allow-partial`).
- Cache invalidation gaps broke the "write → read to verify" agent loop: per-device assignment writes (`assign_profile_to_device`, `uninstall_app`, …) and group-level app/profile pushes now invalidate the `/devices/{id}/…` sub-resource caches; `set_managed_app_config_schema` was the only write tool missing from the invalidation map entirely (a new test enforces full coverage). Separately, a pagination in flight when a write invalidated could re-cache pre-write data for a full TTL — paginations now snapshot a generation counter and skip caching if an invalidation landed mid-flight.
- Battery normalization inverted the most critical reading: `"1%"` became 100% (treated as a 0-1 fraction) and `0%` was dropped outright, so the devices most in need of flagging were excluded from `get_storage_health` and `get_battery_health_report`. Percent-suffixed strings are now always percentages; only bare numbers strictly below 1 are treated as fractions.
- `get_device_full_profile` with a `serial_number` silently fell back to the **first search hit** when no exact serial matched — returning a full dossier for the wrong device. It now errors, listing near matches.
- `get_pending_commands` reported permanent false positives when `/logs` entries lack `command_uuid`: the fallback pairing key embedded the event name and timestamp, so a `…sent` entry could never be matched by its `…acknowledged` entry. Events now pair by device + command family.
- Fleet tools in a keyless `LOCAL_APP_MODE` failed with an opaque `SimpleMDM 401`; they now fail fast naming `SIMPLEMDM_API_KEY` and the two tools that work without it.
- `check_for_update` had no fetch timeout (a stalled GitHub connection hung the tool for minutes); now bounded at 10 s like every other outbound call.
- Markdown tables in dynamic reports and the SOFA audit body now escape `|` in cell values, so a device named e.g. `Loaner | Library iPad` no longer splits its table row (CSVs were always correct).

### Changed
- Inventory test fixtures use the realistic `Apple Silicon` processor-architecture value instead of `arm64` (test-only; no behavior change).

### Documentation
- Corrected the version-bump skill's lockfile guidance (version lives in `package.json` **and** two spots in `package-lock.json`) and switched doc examples to the `type:mac` alias.
- Documented that `dep_enrolled` (current DEP state, server tools) and `is_dep_enrollment` (enrollment channel, inventory `dep` column) are **distinct real API fields** — verified against 478 device snapshots — so neither should be "unified" into the other.

## [0.30.3] - 2026-06-26

### Fixed
- Inventory `--search` `type:mac` now matches **every Mac form factor**. The `type` field only ever emits `laptop`/`imac`/`desktop` (plus a `mac` fallback bucket for Apple-silicon model IDs whose marketing name didn't resolve), so the documented `type:mac` filter substring-matched only `imac` and silently dropped laptops and desktops. `type:mac` (and `type:computer`) are now umbrella aliases that expand to all Mac buckets; `tablet`→`ipad`, `phone`/`mobile`→`iphone`, and `tv`→`appletv` are also recognized. Globs such as `type:mac*` still pass through unchanged.

### Changed
- An inventory `--search` value that cannot match any known token for an enum field now **emits a `Query warning`** (printed on stdout and recorded in `summary.txt`) instead of silently returning zero rows. For example, `type:macbook` now reports `"macbook" is not a known type value` along with the valid values, so a typo no longer looks like an empty fleet.

### Documentation
- Corrected the `arch` field reference in the inventory docs: the real `processor_architecture` values are `intel` and `Apple Silicon` (filter Apple Silicon with `arch:apple*`). The previously documented `arm64` does **not** match. Documented the new `type` aliases and warning behavior, and added cookbook examples for `type:mac` and `type:mac arch:apple*`.

## [0.30.2] - 2026-06-21

### Fixed
- Report headers once again show the `Account: <name> · licenses X used of Y` line and a **real scope label** (`--all` / `--serial …` / `--group …` / `search (whole fleet)`) instead of a hardcoded `--all`. The unified-report-engine migration had dropped the `/account` fetch and scope-label threading; the renderers still supported `account` but the builders stopped passing it. The account is now fetched best-effort (a failure degrades to omitting the line, never aborting the report) in all three live input builders, and the account line renders consistently across the inventory, audit, and logs dossiers.

### Changed
- The dynamic-report writer (`Dossier.write`) now **rejects colliding artifact names** before writing anything. A spec whose `csvName` equals its `mdName`, or whose `mdName` lacks the `.md` extension (so the derived `.html`/`.pdf`/`.docx` paths fold onto it), previously caused the CSV, Markdown, and PDF to overwrite each other at one path — leaving a single file and a manifest whose hashes no longer matched disk. The writer now enumerates every planned output name and throws a clear error on the first duplicate, so malformed specs fail loudly instead of silently clobbering outputs.

## [0.30.1] - 2026-06-21

### Fixed
- Dynamic `generate_report` (devices adapter) now resolves device-group and assignment-group **names** instead of leaving the `device_group`/`assignment_groups` fields blank. The adapter fetches `/device_groups` and `/assignment_groups`, builds the id→name maps, and passes them to `normalizeDevice` — so a `Group` column renders e.g. `HLAB_Faculty` like the inventory report does, not blank. Best-effort: a failed group fetch degrades to blank names rather than failing the report.

## [0.30.0] - 2026-06-21

### Added
- Dynamic `generate_report` specs auto-select page orientation when `pageStyle` is omitted (now optional). Orientation is chosen from the widest table's column count: ≤6 columns → `letter-portrait`, 7-12 → `a4-landscape`, ≥13 → `a3-landscape`. A wide custom report no longer renders cramped in portrait just because the caller didn't set `pageStyle`. An explicit `pageStyle` still takes precedence (and a present-but-invalid value is still rejected). Built-in audit/inventory (landscape) and logs (portrait) defaults are unchanged.

## [0.29.2] - 2026-06-21

### Changed
- `generate_report` (dynamic mode) now routes its `devices` fetch through the cached, write-invalidated `collectDevices()` — the same fleet collection the regular tools use — instead of re-paginating `/devices` on every run. Back-to-back reports within `SIMPLEMDM_CACHE_TTL_MS` (default 5 min) make zero extra device API calls, reducing load against the SimpleMDM API. `ServerDataSource` gained an optional `deviceFetcher` constructor arg (falls back to direct pagination when absent). The client-side row filter is unchanged.

## [0.29.1] - 2026-06-21

### Added
- `check_for_update` MCP tool (read-only) — compares the running server version against the latest GitHub release and returns `{current_version, latest_version, update_available, release_url, upgrade}`. The server cannot self-update (it runs in a pinned, read-only Docker container), so when an update is available it returns the host-side upgrade steps. Tool count 181 → 182.

## [0.29.0] - 2026-06-21

### Added
- Row filtering for dynamic `generate_report` specs: each section's `table` takes an optional `filter` — an array of `{field, op, value?}` conditions (ANDed). Ops: `eq|ne|contains|icontains|gt|lt|gte|lte|exists|absent|in`; `field` supports dot-paths (`attributes.name`). Generic (independent of the device-specific inventory query engine), so it applies uniformly across all six data adapters — enabling custom topic reports like "stale devices" or "devices missing FileVault".
- The `devices` adapter now attaches the original raw `/devices` API object under `.raw`, so dynamic filters can target any SimpleMDM device attribute (`{field: "raw.attributes.<field>", …}`), not just the ~47 normalized keys.
- Dynamic specs may now use `pageStyle: "a4-landscape"` (0.27.0 added it to the engine but not to the dynamic-spec validator).

## [0.28.0] - 2026-06-21

### Added
- Always-on bundle artifacts on `format: all` for every report (audit, inventory, logs, and dynamic `generate_report` specs): `manifest.sha256` (sha256sum-format integrity list), a `<report-dir>.zip` archive of the whole report, and `report-table.xlsx` (Excel twin of `report-table.csv` for inventory flat/roster styles). Generated via python3 stdlib only (already in the image) — no new dependencies; best-effort (skips if python3 is unavailable, like the pdf/docx pipeline).

## [0.27.0] - 2026-06-21

### Added
- Selectable audit page size via `page_size` (`run_fleet_audit` MCP tool) / `--page-size` (CLI): `a3` (default, roomy A3-landscape with larger text) or `a4` (compact A4-landscape that shrinks the wide 14-column All Devices table to fit a standard page without clipping). Render-only change — no effect on CSV/markdown output.

## [0.26.0] - 2026-06-21

### Added
- Unified TypeScript report engine (`src/reports/`) — a single Dossier engine (typed CSV, declarative document model, theme/PDF/docx pipeline, SHA-256 manifest) backing all three reports (audit, inventory, logs).
- `generate_report` MCP tool — generates any of the three reports in-process and returns `WriteResult` metadata (out_dir + per-file sha256). Supports both a catalog mode (`report` + `scope`) and a declarative dynamic-spec mode (`spec`) rendered in the house style over a chosen data adapter.
- `--raw` (inventory, redacted device dump), `--with-security` (logs SOFA section), and `--with-inventory` (logs per-device inventory) are now supported on the unified CLI.

### Changed
- `run_fleet_audit`, `run_inventory_report`, and `run_device_logs_audit` now run the unified engine CLI (`node dist/reports/cli.js`) as a host-side subprocess instead of the legacy `.mjs` scripts — with full flag parity (`--no-network-cache`, report styles, partial-data exit code, fleet-search confirm guard).
- The logs forensic export (`raw-logs.json`) now redacts secret device attributes (FileVault recovery key, firmware/recovery-lock passwords), matching the inventory `--raw` invariant.

### Removed
- Retired the legacy `.mjs` report engines (`sofa-audit.mjs`, `inventory-report.mjs`, `logs-audit.mjs`) and their superseded libs (`scripts/lib/{render,evaluate,query,inventory,inventory-render,logs,report-pdf,docx,apple-legacy-models}.mjs`) and HTML style headers. All three reports plus `--raw`/`--with-security`/`--with-inventory` now run on the unified TypeScript engine via `dist/reports/cli.js` (host-side subprocess, invoked by the `run_fleet_audit`, `run_inventory_report`, and `run_device_logs_audit` MCP tools) and `generate_report` (in-process). Legacy test suites superseded by the unified `test/reports/` suite were also removed.

## [0.25.1] - 2026-06-11

### Fixed
- Logs-audit dossier disclosures no longer cite artifacts that `--report-only` intentionally skips: in report-only mode the intro and Authoritative-sources lines now state it is a report-only export and direct the reader to re-run without `--report-only` for the verbatim CSV/JSON records, instead of pointing at `status-snapshots/` and `raw-logs.json` that were not written.

## [0.25.0] - 2026-06-11

### Added
- **`--report-only`** on all three report engines (inventory, fleet audit, logs audit) — write only the rendered report + `summary.txt` (+ integrity manifest where the engine has one), skipping the data CSV/JSON exports. Inventory keeps `report-table.csv` for roster/flat styles. `--report-only` with `--format csv` is rejected (it would write no report at all). Exposed as `report_only` on the `run_inventory_report`, `run_fleet_audit`, and `run_device_logs_audit` MCP tools.

## [0.24.0] - 2026-06-11

### Added
- **`report-table.csv`** — flat and roster inventory styles now also write a CSV twin of the report's device table(s): same columns (`model_id` … `last_seen`, local users + assignment groups inline, `device_group` as a column), same cells, same row order as `report.md`/`.pdf`; roster rows follow the report's section reading order. The rendered tables and the CSV share one row source, so they cannot drift. Covered by `manifest.sha256`; documented on the `run_inventory_report` MCP tool.

## [0.23.0] - 2026-06-10

### Added
- **`--report-style flat`** — single-table report (model #, marketing name, release year, **device_group as a column**, device name, serial, local users, assignment groups, macOS, last seen); the spreadsheet-like hand-off view, in all four formats. Also on the `run_inventory_report` MCP tool.
- **`--sort <field[:asc|desc]>`** for roster/flat styles (`seen|name|serial|model|os|group|year`; `os` compares numerically) — e.g. `--sort seen:desc` puts the most recently seen devices first. Defaults preserved: roster oldest-seen first per group, flat by group then last seen.

## [0.22.0] - 2026-06-10

### Added
- **Legacy Apple model enrichment** — curated identifier → marketing-name + release-year table (`scripts/lib/apple-legacy-models.mjs`, sourced from Apple's identify-your-model pages) fills the gap for pre-SOFA hardware: iMac14,1/14,2 now report "Late 2013 / 2013" instead of blanks; SOFA overlays the table whenever it knows the model.

### Fixed
- Engine integration tests no longer poison the real SOFA cache (`reports/.inventory-cache`) with mock feed data — tests run from a scratch cwd; release year also falls back to parsing the model-name string.

## [0.21.0] - 2026-06-10

### Added
- **`--report-style roster`** for `/inventory` (also via `run_inventory_report` `report_style`): people-facing roster layout — by-group summary with total, device-type and type/model breakdowns, then one section per device group with one row per device (model #, marketing name, release year, device name, serial, **local users**, **assignment groups**, macOS, last seen), sorted oldest-seen first. Renders in all four formats via the same pipeline.
- **`devicegroup:` query field** — matches device-group names only (`group:` matches device *and* assignment groups), so rosters and populations organized strictly by device group are now expressible.
- **Prompt cookbook + quick command templates** in `docs/inventory.md` (everyday, compliance, deployment-gap, lifecycle, hunt recipes; copy-paste templates for common and specialized reports), with README pointers.

## [0.20.0] - 2026-06-10

### Added
- **`run_inventory_report` MCP tool** — the searchable fleet inventory report (`scripts/inventory-report.mjs`) is now MCP-invokable like its siblings (`run_fleet_audit`, `run_device_logs_audit`): accepts `search`/selector/format/report_detail/allow_partial/raw arguments, returns the structured summary + markdown report preview, surfaces partial-data runs (engine exit 2) with `partial_data: true` and the written output directory. Tool count: 180.

### Fixed
- **Report MCP tools failed with `EACCES` in the Docker image** — `/app` is root-owned and the server runs as `node`, so `run_fleet_audit`, `run_device_logs_audit`, and `run_inventory_report` could not create `reports/`. The image now pre-creates `/app/reports` owned by `node`; mount `-v "$PWD/reports:/app/reports"` to persist generated reports on the host.

## [0.19.0] - 2026-06-10

### Added
- `/inventory` deep-dive hardening: profiles assigned via assignment groups now resolved (previously invisible), firmware/Recovery-Lock password values defensively redacted from `--raw` dumps, new posture columns + query fields (ard, uamdm, ddm, activationlock, lostmode, firmwarelock, recoverylock, passcode), RSR supplemental OS version, identity columns (bluetooth_mac, meid, iccid, time_zone, cloud backup, enrollment channels), and account/license header from `/account`.
- `/inventory` skill + `scripts/inventory-report.mjs`: searchable fleet inventory reports (devices/apps/profiles/users) with a multi-keyword + field-filter query language (`--search`), sound device-level prefilter planning, SOFA model enrichment, assigned-vs-installed deployment-gap findings for both apps (via assignment groups) and profiles (via device-group/direct assignment, with per-device assigned tables in the dossier at every detail level), per-section completeness model (exit 2 on partial data unless `--allow-partial`), redacted opt-in raw dumps, and CSV/md/docx/pdf dossier output.
- **Audit MCP Tools (`run_fleet_audit` / `run_device_logs_audit`)**: Exposed the host-side SOFA and activity log audits as native MCP tools, returning structured summaries and markdown report previews directly to the LLM.
- **Webhooks Verification & Guidance**: Added `verify_webhook_payload` tool to validate JSON payloads by event type, and `configure-webhooks-guide` prompt to walk admins through manually configuring secure webhooks.
- **APNs Expiration Checking in Prompt**: Enhanced `fleet-health-dashboard` prompt to query APNs certificate expiration and bubble up expiration alerts.
- **Global DEP Device Serial Search**: Added `get_dep_device_status` tool to find and retrieve enrollment status of a DEP device by serial across all registered DEP servers.
- **Bulk App Configuration Writing & Templates**: Added `set_managed_app_config_schema` to bulk write, delete, and diff app config settings in a single action, and `get_managed_app_config_templates` to retrieve standard templates for Chrome, Zoom, and Teams.
- **Mock Testing Framework (DX)**: Created `test/mock_api.test.mjs` test runner using native fetch mocking to test complex derived analytics tools offline.

## [0.18.0] - 2026-06-09

### Added
- **`/audit` can now be scoped to a subset** instead of always auditing the whole fleet:
  `--serial A,B`, `--group "Name"`, or `--last-seen N` (at most one; omit for the whole fleet).
  `--group` understands **both legacy device groups and assignment groups** (reusing the same
  `selectDevices` resolution as `/logs-audit`), so you can run a fleet *security* audit for just
  one group. `summary.txt` records the scope.
- **Scoped runs trim the Vulnerability Check to what's relevant.** When a selector is active, the
  Vulnerability Check (Markdown section and `vulnerability-check.csv`) is limited to the OS
  major-version ladders the in-scope devices are actually on — empty tracks (e.g. the iOS/iPadOS
  table for a macs-only scope) and unrelated macOS majors are dropped, while the full upgrade
  ladder within a kept major is preserved so you still see every release the devices are missing.
  Whole-fleet runs are unchanged (full SOFA catalog).

## [0.17.0] - 2026-06-09

### Changed
- **`/audit` (SOFA security report) now renders via the shared PDF pipeline.** `--format all`
  writes `full-audit.pdf` **automatically** (previously a separate `make-audit-pdf.sh` step), and
  the report adopts the same visual language as the `/logs-audit` dossier — navy headings, dark
  table headers, zebra rows, and **footer page numbers** — while keeping **A3 landscape** for its
  wide tables. PDF rendering prefers **WeasyPrint** (page numbers) and falls back to headless
  Chrome. `make-audit-pdf.sh` remains for standalone regeneration and is upgraded the same way.
  New shared `scripts/lib/report-pdf.mjs` renderer + `scripts/audit-report.head.html` stylesheet;
  `/logs-audit` now uses the same shared renderer.

## [0.16.0] - 2026-06-09

### Added
- `/logs-audit` **findings engine** — the report now auto-detects and flags per-device
  patterns that a count-only summary hides: **app-reinstall loops** (the same app/version
  installed many times — e.g. a broken Munki installs-check), **software-update failure
  loops**, and **profile reinstall churn**. Findings appear as a fleet callout, a per-device
  ⚠ Findings block, a `summary.txt` line, and a machine-readable `findings.csv`.
- `/logs-audit` per-device **"top installed apps (by install count)"** table in the dossier,
  so repeated installs (the content behind the counts) are visible.
- `/logs-audit` `--report-detail summary|table|full` flag controlling how much per-device log
  detail the report document includes: `summary` (aggregation + findings, default), `table`
  (full per-device event table), `full` (both). `logs.csv`/`raw-logs.json` always retain 100%
  of the logs regardless.

## [0.15.0] - 2026-06-09

### Added
- `/logs-audit` report now flags **noisy devices** — any device contributing an
  outsized share (>=25%) of total log volume while dwarfing the rest is surfaced in a
  report callout, marked ⚠ in the fleet roll-up, and listed in `summary.txt`. Such a
  device skews fleet aggregates and can evict other devices' events from the
  retention-bounded `/logs` feed, so it's called out automatically.

## [0.14.2] - 2026-06-09

### Changed
- Docker image now bundles the optional report toolchain — `pandoc`, **WeasyPrint**,
  base fonts, and the `scripts/` directory — so `node scripts/logs-audit.mjs --format all`
  can render md/html/docx/pdf reports in-container. The MCP server itself does not use
  these; the trade-off is a larger image (~279 MB → ~744 MB).

## [0.14.1] - 2026-06-09

### Changed
- `/logs-audit` report is now a professional **US-Letter portrait** document
  (`scripts/logs-report.head.html`) instead of reusing the SOFA audit's
  A3-landscape sheet. PDF generation prefers **WeasyPrint** (real `@page` footer
  with "Page X of Y") and falls back to headless Chrome when WeasyPrint is absent.

### Fixed
- `/logs-audit` report: per-device **Findings** now render as a styled blockquote
  callout (a missing blank line had caused literal `> Findings:` text), and the
  intro sentence uses a correct "and" conjunction when listing combined sections.

## [0.14.0] - 2026-06-09

### Added
- `/logs-audit` command (`scripts/logs-audit.mjs` + `logs-audit` skill): targeted device-activity
  log export for selected devices (`--serial`/`--last-seen`/`--group`/`--all`), with opt-in
  `--with-inventory` and `--with-security` combine. Emits typed/ISO/sorted logs CSV, per-device
  summary/coverage CSV, raw JSON, and a SHA-256 manifest with timezone/retention disclosures.
  - **Report:** `--format all` produces a detailed combined **dossier** (`report.md`/`.html`/
    `.docx`/`.pdf`) — per-device identity, security posture, activity, notable software-update
    events, and software inventory, plus a fleet roll-up.
  - **status.changed snapshots** are externalized to `status-snapshots/<serial>__<logid>.json`
    (referenced by the `status_json_file` column) so no CSV cell exceeds spreadsheet limits; each
    sidecar is individually SHA-256-hashed in the manifest.

## [0.13.0] - 2026-06-09

### Added
- Apple device-management schema helpers: search/detail tools over a local
  runtime schema cache generated from Apple's public YAML schemas, curated
  fallback data for high-value payloads, payload validation, generic
  `.mobileconfig` generation, DDM declaration JSON generation, recursive
  nested-key validation, and convenience builders for Wi-Fi, restrictions,
  SCEP/certificates, VPN, web clips, content filter, FileVault escrow,
  firewall, passcode, and software update settings. These helpers make custom
  SimpleMDM profiles/declarations schema-backed without depending on the
  third-party Apple Profile Builder app at runtime.
- `scripts/sync-apple-device-schemas.mjs` now enumerates supported Apple repo
  schema paths, parses fixture or upstream YAML with `yaml`, normalizes nested
  dictionaries, arrays, enums, required keys, platform metadata, deprecations,
  and defaults, and writes `data/apple-device-management/schema-cache.json`.
- User-facing Apple schema helper workflow docs, fixture-backed schema sync
  tests, a true MCP stdio smoke test for `initialize` plus `tools/list`, and a
  static documented tool count guard.

### Security
- Generated Apple profiles and declarations should still be reviewed and tested
  on a small device group before broad deployment; local schema validation can
  catch structure and common semantic mistakes, but it is not a replacement for
  Apple/SimpleMDM deployment testing.

## [0.12.1] - 2026-06-08

### Changed
- README restructured for readability: the five per-client setup guides are
  grouped under one **Connect a client** section; **Install** now precedes
  **Quick Start**; the **Fleet Audit** section moved up to sit right after
  **Examples**; and the full 157-tool catalog moved to **`docs/tools.md`** (the
  README keeps a short Tools summary + link). No content removed.

## [0.12.0] - 2026-06-08

### Added
- `cve-devices.csv` audit output — the inverse of `device-cves.csv`: one row per
  CVE with the affected device names/serials collapsed into a single multi-line
  `devices` cell (`cve_id, fixed_in_version, os_track, actively_exploited,
  devices_exposed, devices`). Answers "which devices are exposed to CVE-X?".

## [0.11.3] - 2026-06-08

### Changed
- Audit report **Vulnerability Check** is now a clean per-release **table**
  (`version, date, cves_fixed, actively_exploited, devices_on_release,
  unfixed_to_latest`) instead of bulleted lists with inline CVE-ID dumps and
  emoji markers. The full CVE IDs per release remain in `cve-detail.csv` /
  `vulnerability-check.csv`. Looks consistent with the other report sections.

### Added
- `docs/fleet-audit.md` — a deep-dive explaining the `/audit` command: the
  SimpleMDM × SOFA join, how each metric/check is computed, the full output
  reference, the device-group rollup, PDF export, and the code map. Linked from
  the README.

## [0.11.2] - 2026-06-08

### Added
- Reproducible PDF export for the audit report: `scripts/make-audit-pdf.sh`
  (+ `scripts/audit-pdf.head.html`) renders `full-audit.md → full-audit.pdf`
  via pandoc + a headless Chromium browser, in A3 landscape with full page
  width and dynamic, content-sized columns (so the `findings` and other wide
  columns expand instead of being cramped into equal widths).

## [0.11.1] - 2026-06-08

### Fixed
- Audit report readability: the Vulnerability Check CVE list per release is now
  capped (all actively-exploited CVEs are kept, plus up to 15 others, then
  `…+N more (see cve-detail.csv)`) instead of dumping 80+ IDs on one 2,400-char
  line that overflowed PDF/Word. `last_seen` is trimmed to `YYYY-MM-DD HH:MM`.

## [0.11.0] - 2026-06-07

### Added
- Audit now includes each device's **device group**: a `device_group` column on
  every per-device output (`all-devices.csv`, `security-report.csv`,
  `need-updates.csv`, `device-cves.csv`, and the Security Report / Need Updates /
  All Devices Markdown tables), plus a new `by-group.csv` rollup (devices,
  OS-outdated, FileVault/SIP/Firewall, and unfixed-CVE counts per group) and a
  "By Device Group" section in the Markdown report — so remediation can be
  batched by group. (Per-release / per-CVE tables omit it, as it doesn't apply.)

## [0.10.1] - 2026-06-07

### Fixed
- Audit CSV exports now use ASCII-only cell values so they render correctly in
  any spreadsheet app. FileVault/SIP/Firewall show `on`/`off`, XProtect shows
  `ok`/`outdated`/`invalid`/`N/A`, and actively-exploited CVEs are marked
  `[exploited]`. Previously the Unicode ✓/✗/🔴 glyphs were mangled when a `.csv`
  was opened as MacRoman (e.g. `✓` → `‚úì`). The Markdown report keeps the glyphs.

## [0.10.0] - 2026-06-07

### Added
- **Fleet Audit (`/audit`)** — a self-contained command (`scripts/sofa-audit.mjs` + the `/audit`
  Claude Code skill) that joins the live SimpleMDM device inventory with the
  [SOFA](https://sofa.macadmins.io) feed and produces a full macOS security audit. Four sections
  (Security Report, Vulnerability Check, Need Updates, All Devices) plus a per-CVE catalog and a
  per-device CVE listing, exported to CSV / Markdown / Word (`.docx` via pandoc). Read-only; output
  is written to the gitignored `reports/audit-YYYY-MM-DD/` directory. See the README
  [Fleet Audit](README.md#fleet-audit-audit) section.
- `all-devices.csv` device-overview layout: `name, device_name, serial, os_version, latest_minor,
  latest_major, unfixed_cves, product, fv, sip, fw, xp, last_seen`.
- Per-device upgrade eligibility ("latest version your hardware can run") derived from SOFA's
  `Models` map, so it tracks Apple's support matrix without a maintained static table.
- Staged XProtect collection pipeline (`reports/xprotect/STAGING.md`) and a no-secrets collector
  script (`reports/xprotect/xprotect-version-check.sh`) to populate the `xprotect_version` custom
  attribute and enable the XProtect checks.

### Notes
- The audit performs **no** SimpleMDM writes and works with a read-only API key.
- Generated reports are never committed to git (they contain live tenant data).

## [0.9.1] - 2026-06-06

### Changed
- `get_activation_lock_status` now also returns the device `name` and
  `serial_number` so the result is human-identifiable, not just a numeric
  `device_id`.

## [0.9.0] - 2026-06-06

### Added
- `preserve_managed_apps` parameter on `wipe_device` (iOS 17+) — keeps managed
  apps installed through a wipe. Optional boolean; when omitted SimpleMDM applies
  its server-side default.
- `refresh_cellular_plans` (WRITE) — refresh a device's cellular/eSIM plans from
  the carrier's eSIM server (`POST /devices/{id}/refresh_cellular_plans`).
  **Requires** `esim_server_url` (the carrier-provided eSIM server URL), per the
  SimpleMDM API.
- `get_activation_lock_status` (READ) — report whether Activation Lock is
  enabled on a device (reads `is_activation_lock_enabled`).
- `get_api_coverage` (READ) — static introspection: counts of exposed tools
  by capability area (no API call).
- `create_safari_bookmarks_declaration` (WRITE) — push managed Safari bookmarks.
  Builds Apple's `com.apple.configuration.safari.bookmarks` DDM configuration from
  a simple `{title, url}` / nested-`folder` tree and delivers it via SimpleMDM's
  `/custom_declarations` API. Requires iOS 26+, macOS 26+, or visionOS 26+.

### Notes
These features were drafted from a product spec, then **reconciled against the
live SimpleMDM API reference** before release. The spec claimed several endpoints
that the public REST API does not actually expose; each was resolved as follows:

- **`send_message` — no REST endpoint.** SimpleMDM's "Send Message" is a
  web-console / mobile-app feature with no public API. The drafted
  `send_device_message` / `send_bulk_device_message` tools were **removed** (they
  would have returned 404). To display text on a device via the API, use
  `lock_device` with a `message`.
- **`disable_activation_lock` — no standalone endpoint.** Activation Lock is
  cleared only via the `disable_activation_lock` *parameter* of `wipe_device`. The
  drafted standalone `disable_activation_lock` / `disable_activation_lock_bulk`
  tools were **removed**; use `get_activation_lock_status` to check current state.
- **`refresh_cellular_plans` — requires `esim_server_url`.** The endpoint is real
  but rejects calls without the carrier-provided eSIM server URL; the tool now
  sends it.
- **Safari Bookmarks — no endpoint, but a real Apple DDM configuration.** Managed
  bookmarks are delivered as `com.apple.configuration.safari.bookmarks`
  (iOS/macOS/visionOS 26+), now supported via `create_safari_bookmarks_declaration`
  over the `/custom_declarations` API (see Added). The SimpleMDM declaration
  envelope (`declaration_type` + inner `payload`) follows the documented API and
  should be validated against your tenant on first use.

## [0.8.3] - 2026-05-22

Maintenance release — no change to MCP tool behavior.

### Security
- **`npm audit fix` cleared 4 advisories** in transitive dependencies of
  `@modelcontextprotocol/sdk` (lockfile-only): `fast-uri` 3.1.0 → 3.1.2
  (high — path traversal / host confusion), `hono` 4.12.12 → 4.12.21,
  `ip-address` 10.1.0 → 10.2.0, and `express-rate-limit` 8.3.2 → 8.5.2.
  `npm audit` now reports zero vulnerabilities. The vulnerable code paths
  live in the SDK's HTTP/SSE transport, which this stdio server does not
  use, so real-world exposure was already low.

### Changed
- **Dev toolchain upgraded** via Dependabot: `typescript` 5.9 → 6.0.3,
  `@types/node` 22 → 25, `tsx` 4.21 → 4.22.
- **`tsconfig.json` now sets `"types": ["node"]`.** TypeScript 6.0 no
  longer auto-discovers `@types/*` packages the way 5.x did; without this,
  the 6.0 build failed to resolve Node globals. Backward-compatible with
  5.x.
- CI/runtime image bumps: Docker base `node` 22-alpine → 26-alpine,
  `actions/checkout` v4 → v6, `actions/setup-node` v4 → v6.
- `.mcp.json` added to `.gitignore` to prevent accidental commit of the
  SimpleMDM API key it carries.

## [0.8.2] - 2026-05-22

### Fixed
- **Pagination loops now guard against non-array `data` in API responses.**
  `paginateDevices`, `collectInstalledApps`, `collectAllPages`, and the
  serial-number device lookup previously iterated `response.data` directly.
  If the SimpleMDM API returned a `200` with an unexpected body shape, the
  iteration threw a `TypeError` instead of degrading gracefully. Each call
  site now applies an `Array.isArray()` check and falls back to an empty
  page, so a malformed response yields an empty result rather than a crash.
- **`checkLocalApp()` guards the `/health` response against non-object JSON.**
  The local-app health check asserted the response shape and then read
  `data.connected` outside the `try`/`catch`. A response body of JSON `null`
  or a non-object threw an uncaught `TypeError`. Any non-object parse result
  now coalesces to `{}`, so a malformed health response is treated as "not
  connected" instead of crashing startup.

## [0.8.1] - 2026-04-16

### Fixed
- **`wifi_network_id` schema type corrected from `string` to `integer`.**
  SimpleMDM's `POST /devices/{id}/wipe` expects an unquoted integer;
  serializing as a quoted string risked a 422 from the server. Schema now
  declares `{ type: "integer", minimum: 1 }` so the MCP SDK validates the
  correct JSON shape before dispatch, and `JSON.stringify` emits
  `"wifi_network_id":42` instead of `"wifi_network_id":"42"`.

### Added
- `clear_custom_attributes` and `unassign_direct_profiles` parameters on
  `wipe_device`. Both are optional booleans (server default: `false`) and
  were already supported by SimpleMDM's endpoint but not exposed in the
  MCP surface. Now wired through `buildWipeBody` and the schema.
- Three additional tests covering the integer serialization of
  `wifi_network_id` and solo-field serialization of the two new booleans.

### Changed
- **Tool descriptions no longer include a `⚠️` warning emoji prefix.** All
  `WRITE` and `WRITE DESTRUCTIVE` tool descriptions still carry those
  literal words, and the `destructiveHint: true` annotation is unchanged,
  so MCP clients retain both structured and textual signals. The emoji was
  decorative and redundant with those two channels. 78 occurrences removed
  from `src/index.ts`.

### Verified live (2026-04-16)
- Smoke-tested the rebuilt Docker image — `tools/list` returns the full
  `wipe_device` schema with all 10 properties, `wifi_network_id` typed as
  `integer` with `minimum: 1`, and both new booleans present.
- Live-tested against a real iPad (supervised, iPadOS 26.4.1) through the
  MCP:
  - `wipe_device { return_to_service: true }` (no `wifi_network_id`) —
    `validateWipeArgs` throws before any HTTP call. Device untouched.
  - `wipe_device { preserve_data_plan: true }` with a read-only API key —
    SimpleMDM returns `403: This API Key does not have access to this
    resource.` Confirms the full request path reaches SimpleMDM and the
    error propagates cleanly. End-to-end field-name acceptance still
    requires a write-scoped key against a sandbox tenant.

## [0.8.0] - 2026-04-16

### Added
- **`wipe_device` parity with the SimpleMDM admin portal wipe dialog.** Five
  new optional parameters:
  - `preserve_data_plan` — preserves eSIM / cellular data plan (iOS).
  - `disable_activation_lock` — controls whether Activation Lock is disabled
    during wipe (iOS/macOS). Server default: `true`.
  - `disallow_proximity_setup` — suppresses Proximity Setup on the wiped
    device (iOS).
  - `return_to_service` + `wifi_network_id` — auto re-enrolls the device
    after wipe (iOS 17+/tvOS 18+). `wifi_network_id` refers to a WiFi profile
    attached to the device's assignment group. Client-side validation rejects
    `return_to_service=true` without `wifi_network_id` before the HTTP call.
  - `obliteration_behavior` — `DoNotObliterate` | `ObliterateWithWarning`
    for macOS 12+ (T2/Apple Silicon). Server default: `ObliterateWithWarning`.
- **`src/wipe.ts`** — pure-function module extracting body-building and
  validation, enabling unit tests via Node's built-in `node:test` runner.
- **`test/wipe_device.test.mjs`** — first unit tests in the repo; run with
  `npm test`.

### Changed
- `package.json`: new `test` script (`npm run build && node --test test/*.mjs`).

### Backwards compatibility
- Existing `wipe_device` calls (`device_id` ± `pin`) produce identical request
  bodies. All new parameters are optional; when omitted they are not serialized,
  so SimpleMDM applies its documented server-side defaults.

## [0.7.1] - 2026-04-15

### Changed
- **`MACOS_SUPPORT_TABLE` refreshed for macOS 26 Tahoe** (shipped 2025-09).
  All Apple Silicon Mac families bumped from 15 → 26. Four Intel models
  added/bumped to 26 (the only Intel Macs that get Tahoe): `MacPro7,`,
  `iMac20,`, `MacBookPro16,1/2/4` (16,3 explicitly capped at 15).
- **`CURRENT_SUPPORTED_OS` defaults bumped** from `{mac:15, ios:18, ipad:18}`
  to `{mac:26, ios:26, ipad:26}` to match Apple's unified year-based
  versioning introduced at WWDC25.

### Added
- Missing legacy Apple Silicon entries that use pre-`Mac{N},` naming:
  `Macmini9,` (M1 Mac mini 2020), and explicit notes on `MacBookAir10,`,
  `MacBookPro17,`, `MacBookPro18,`, `iMac21,` all bumping to 26.
- Pre-Sequoia entries the table previously omitted: `iMac14,1/2/3` (Catalina),
  `iMac14,4` (Big Sur), `iMac15,` (Big Sur), `iMac16,` (Monterey).

### Fixed
- `iMac17,` (iMac 27" Retina 5K Late 2015) max corrected from `11` (Big Sur)
  to `12` (Monterey) — Apple's official support list extends through Monterey.
- `table_last_updated` and all `_agent_hint` strings referencing `2024-11`
  bumped to `2026-04`.

## [0.7.0] - 2026-04-15

### Added
- **Response slimming on heavy list endpoints.** `list_devices`, `list_apps`,
  `list_assignment_groups`, `list_custom_configuration_profiles`, and
  `list_custom_declarations` now collapse oversized relationship arrays
  (>200 IDs) into a `count`-only summary, and strip extra per-item fields
  from kept arrays. Prevents MCP transport truncation on large fleets where
  raw payloads exceeded ~350K characters.
- **Agent hints on knowledge gaps and silent-empty results.** Several tools
  now return an `_agent_hint` field directing the AI to either look up missing
  info or warn the admin when results may be misleading:
  - `get_os_eligibility` — when Mac model identifiers are not in the built-in
    support table, hints the AI to web-search for compatibility and suggests
    setting `MAC_OS_ELIGIBILITY_OVERRIDE`.
  - `get_compliance_violators` — when devices are running a higher OS major
    than the configured baseline, prompts the AI to verify the current
    shipping OS and suggest updating `CURRENT_SUPPORTED_OS_OVERRIDE`.
  - `get_app_install_failures` — when zero failures are returned, warns that
    this may mean the `install_status` field isn't populated for the tenant
    rather than no actual failures.
  - `get_battery_health_report` — when only `battery_level` is present
    (no `battery_cycle_count` / `battery_max_capacity_pct`), warns that
    aging batteries with degraded capacity will not be flagged.
  - `get_pending_commands` — when log entries are scanned but no command
    events are paired, warns that the tenant's `/logs` endpoint may not
    surface command-level events.
- README now documents all 5 MunkiReport enrichment tools (`get_munkireport_*`)
  and the MunkiReport-related environment variables (`MUNKIREPORT_BASE_URL`,
  `MUNKIREPORT_MODULE_PREFIX`, `MUNKIREPORT_AUTH_HEADER_NAME`,
  `MUNKIREPORT_AUTH_HEADER_VALUE`, `MUNKIREPORT_COOKIE`). These tools were
  always registered but previously undocumented (removed from README in 0.3.0).

### Fixed
- `docs/aggregation-tools-roadmap.md` status and release plan updated to
  reflect 0.6.0 shipping.
- Fixed incorrect `skillOverrides` reference in roadmap doc — replaced with
  the correct Claude Code `permissions.deny` mechanism.

## [0.6.0]

### Fixed
- Server version reported via MCP `initialize` was hardcoded and would
  drift from `package.json` on every release (was reporting `0.4.0`
  while the package was at `0.5.0`). Now read from the sibling
  `package.json` at startup so it stays in sync automatically.

### Added
- Dockerfile `VERSION` build-arg, baked into the image's
  `org.opencontainers.image.version` label. Inspect via
  `docker inspect simplemdm-mcp | grep version`. Defaults to `dev`.
- **Auto-pagination on all list tools.** Every list endpoint now
  automatically fetches all pages (100 records per page) until the full
  result set is collected. No more `starting_after` / `limit` params —
  callers always get the complete list. Applies to all 16 `list_*` tools,
  plus derived tools that previously truncated at 100 records
  (`get_inactive_assignment_groups`, `get_orphaned_profiles`,
  `get_orphaned_apps`, `get_assignment_group_drift`, `get_dep_drift`,
  `get_dep_unassigned`, `get_enrollment_token_audit`, `get_unmanaged_apps`).
- **In-memory TTL cache** for all paginated list results, `collectDevices()`
  fleet iterations, and per-device `collectInstalledApps()` calls. Default
  TTL is 5 minutes, configurable via `SIMPLEMDM_CACHE_TTL_MS`. Repeated
  calls within the TTL window return instantly from cache with zero API
  calls, significantly reducing token usage and API load.
- **Automatic cache invalidation** — all 78 write tools are mapped to
  cache key prefixes. When a write succeeds, affected cache entries are
  cleared so subsequent reads return fresh data. Cross-resource
  invalidation is handled (e.g. `assign_app_to_group` invalidates both
  `/assignment_groups` and `/apps` caches).
- **Stampede protection** — concurrent identical `collectAllPages()`
  requests are deduplicated so only one fetch runs; all callers share the
  result.
- `SIMPLEMDM_CACHE_TTL_MS` env var (default `300000` / 5 min). Set to `0`
  to disable caching.

### Changed
- `get_compliance_violators` OS-lag check now uses a stable per-platform
  baseline (`CURRENT_SUPPORTED_OS`, defaults macOS 15 / iOS 18 / iPadOS 18,
  override via `CURRENT_SUPPORTED_OS_OVERRIDE` env var) instead of the
  fleet's highest observed OS. A single device on a beta or future major
  no longer skews the result for the rest of the fleet.
- `get_compliance_violators` default `max_os_major_lag` raised from 1 to
  2 (one major behind is normal during a transition window).
- `get_compliance_violators` adds `skip_os_check` boolean and
  `unsupported_lag_threshold` (default 3) — devices past Apple's typical
  support window are now labeled `os_unsupported` instead of a numeric
  `os_N_majors_behind`, making the output filterable.
- `get_compliance_violators` response now includes `baseline_supported_major`
  (the per-platform baseline used) and `failure_counts` (rollup so callers
  can act on the dominant failure type without re-iterating).

## [0.5.0]

Fleet-analytics release. Adds 28 derived/aggregation tools that iterate the
fleet to answer questions the raw SimpleMDM API can't in a single call. All
new tools are read-only and idempotent. No breaking changes — existing
`tools/list` entries, resource URIs, and prompt names are unchanged.

### Added
- 28 derived fleet-analytics tools across four maturity tiers
  (`get_top_installed_apps`, `get_app_coverage`, `get_compliance_violators`,
  `get_app_version_drift`, `get_pending_commands`, `get_dep_drift`,
  `get_os_eligibility`, and 21 more — see
  `docs/aggregation-tools-roadmap.md`).
- 4 new resources: `simplemdm://reports/{top-apps,unmanaged-apps,stale-devices,storage-health}`.
- 3 new prompts: `app-inventory-audit`, `compliance-violators-remediation`,
  `profile-coverage-remediation`.
- `SIMPLEMDM_FLEET_CONCURRENCY` env var (default 8) tuning worker count
  for fleet-iteration tools. Lower it on tenants seeing 429s.
- `MAC_OS_ELIGIBILITY_OVERRIDE` env var — JSON map of model-prefix →
  max-macOS-major to patch the built-in support table without redeploying.
- Static macOS support table (last updated 2024-11) used by
  `get_os_eligibility`.

### Changed
- `collectInstalledApps` now throws on `MAX_PAGES` exhaustion (previously
  silently truncated, producing wrong rollups in aggregations).
- `get_assignment_group_drift` rewritten from a sequential per-device loop
  into a bounded worker pool — uses the same concurrency knob as the
  other fleet tools.
- README tool count updated from 125 → 153.

### Notes
- Several Tier 1/2 tools depend on optionally-populated SimpleMDM fields
  (`install_status`, `battery_cycle_count`, `last_used_at` on enrollments,
  `current_carrier_network`, `default_assignment_profile_uuid` on dep_servers).
  They degrade gracefully (return empty) when the upstream field isn't
  populated for your tenant — verify on a sample before relying on them in
  production.
- Two tools were drafted but **not shipped** after senior-dev review:
  `get_filevault_recovery_key_audit` (no verified read endpoint) and
  `get_kernel_extension_inventory` (MDM API doesn't expose KEXTs; needs
  a MunkiReport hardware module not in this codebase). See
  `docs/aggregation-tools-roadmap.md`.

## [0.4.0]

Security-hardening and reliability release. No breaking changes for
existing callers — every `tools/list` entry, resource URI, and prompt
name is unchanged. New behavior is additive and tunable via env vars.

### Added
- Committed `.claude/settings.json` pre-approving all read-only SimpleMDM
  MCP tools and safe shell helpers for Claude Code contributors. Write
  and destructive tools still prompt per call.
- `.claude/settings.auto.example.json` — opt-in auto-mode permission profile
  for Claude Code users who want `defaultMode: "auto"` with a curated deny
  list. Denies genuine data-loss operations (`rm`, `git reset --hard`,
  `git clean -f*`, force-push, `npm publish`, `docker system prune`,
  `gh repo delete`, etc.) and SimpleMDM write tools that can impact devices
  (`wipe_device`, `delete_*`, `clear_*`). Common dev-workflow commands
  (`git commit --amend`, `git rebase`, `killall`, `docker rm`) are allowed
  — they're only dangerous when pushed, which the force-push deny still
  blocks. Template; never contains credentials.
- `CONTRIBUTING.md` section documenting the permission policy.
- Server-side input validation against each tool's declared `inputSchema`
  (required fields + primitive type checks) before dispatch.
- URL path-segment validator (`seg()`) that rejects disallowed characters
  (`/`, `?`, `#`, control chars) and `encodeURIComponent`-encodes every
  interpolated path parameter — blocks path traversal / query injection
  through tool arguments.
- Request timeouts via `AbortSignal.timeout` on all upstream calls
  (SimpleMDM, MunkiReport, Report-SimpleMDM). Tunable via
  `SIMPLEMDM_TIMEOUT_MS` / `LOCAL_APP_TIMEOUT_MS`.
- Automatic retry with exponential backoff for `429` / `5xx` responses,
  honoring `Retry-After`. Tunable via `SIMPLEMDM_MAX_RETRIES`.
- Hard cap on fleet-wide pagination (`SIMPLEMDM_MAX_PAGES`, default 200)
  to bound memory and request volume on large fleets.
- OCI labels on the published Docker image (title, description, source,
  license).

### Changed
- Dockerfile base bumped to `node:22-alpine`; image now runs as the
  non-root `node` user (`COPY --chown=node:node`, `USER node`).
- Fleet-wide device pagination consolidated behind a shared
  `paginateDevices()` async generator; removed four duplicated while-loops
  in `get_fleet_summary`, `get_security_posture`, and the
  `simplemdm://reports/enrollment` / `.../reports/filevault` resources.
- Write-tool annotation is now driven by an explicit `WRITE_TOOLS` set
  rather than a description-string emoji prefix; `readOnlyHint` can no
  longer silently flip when a description is rewritten.
- Basic-auth header pre-computed once at module load instead of on every
  request.
- Tool and resource responses are serialized as compact JSON (no
  indentation) — reduces LLM token usage.
- Top-level side effects (`process.exit`, `checkLocalApp`, `server.connect`)
  moved into a `main()` entry point; the module is now safely importable.
  `main()` catches errors and exits cleanly, and registers SIGINT/SIGTERM
  handlers that call `server.close()` before exit.
- `checkLocalApp()` now throws on misconfiguration instead of calling
  `process.exit(1)` from inside the module.

### Fixed
- **FileVault compliance resource** previously used an `os_version` regex
  that matched iOS versions (10–19) as well as macOS. It now gates strictly
  on `model_name` matching `/Mac/i`.
- **`get_device_full_profile`** no longer fetches the device record twice
  (once for the parallel call, once inside the logs closure); the promise
  is reused.
- **`list_logs` / `get_device_logs`** handler had a tautological ternary
  (`args.serial_number ?? (name === "get_device_logs" ? args.serial_number : undefined)`)
  — both branches read the same value. Replaced with the existing `qs()`
  helper.
- **MunkiReport auth fallback** previously fell back to the SimpleMDM API
  key when `MUNKIREPORT_AUTH_HEADER_VALUE` was empty. It now throws an
  explicit configuration error, so the SimpleMDM key cannot leak to the
  MunkiReport endpoint.
- `Content-Type: application/json` is now only set on requests with a body.

## [0.3.0]

### Added
- **MCP tool annotations** on every tool: `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`, plus a human-friendly `title`. Reads are
  annotated read-only; writes are annotated mutations; `wipe_device`,
  `unenroll_device`, all `delete_*`, and the `clear_*` password tools are
  flagged destructive so clients can render an extra confirmation step.
- **MCP Resources** — 8 canonical report URIs served alongside tools:
  `simplemdm://fleet/summary`, `.../reports/security-posture`,
  `.../reports/os-versions`, `.../reports/enrollment`,
  `.../reports/filevault`, `.../inventory/devices`,
  `.../inventory/assignment-groups`, `.../inventory/apps`.
- **MCP Prompts** — 6 workflow templates selectable from the MCP client UI:
  `fleet-health-dashboard`, `security-audit`, `new-device-onboarding`,
  `device-offboarding`, `patch-compliance-review`, `stale-devices-cleanup`.
  Prompts with destructive steps (offboarding) do not call write tools
  without explicit user confirmation.
- **Compound tools** to reduce LLM round-trips:
  - `get_device_full_profile` — device + profiles + installed apps + users
    + recent logs in parallel (accepts device_id or serial_number).
  - `get_security_posture` — fleet-wide percentages and counts for every
    posture metric + OS-major breakdown in one call.
- Full tool catalog documentation in README (~125 tools grouped by domain).
- Setup instructions for Claude Code CLI, Codex CLI, and ChatGPT connectors.
- Rate-limit guidance and error-behavior notes.
- `LICENSE` file (MIT) at repo root.
- `.nvmrc` pinning Node 20 for local dev consistency.
- GitHub Actions CI that builds the project on push and pull requests.
- `files` allowlist in `package.json` so `npm publish` only ships runtime artifacts.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates, PR template, Dependabot config.

### Changed
- Server now advertises the `resources` and `prompts` capabilities.
- Bumped `@modelcontextprotocol/sdk` to `^1.29.0`.
- Hardened `.dockerignore` to exclude `.env`, `.env.*`, and `.claude/`.

### Removed
- README references to Report-SimpleMDM local app mode and SimpleMDM-MunkiReport
  enrichment. Server-side scaffolding remains behind undocumented env vars
  pending companion-app support.

## [0.2.0] - Prior release
- Initial public release on npm with core read tools, write gating, and Docker/npm/source install paths.
