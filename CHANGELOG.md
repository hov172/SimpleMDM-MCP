# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[SemVer](https://semver.org/).

## [Unreleased]

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
