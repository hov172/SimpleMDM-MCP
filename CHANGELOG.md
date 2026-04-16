# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- Server version reported via MCP `initialize` was hardcoded and would
  drift from `package.json` on every release (was reporting `0.4.0`
  while the package was at `0.5.0`). Now read from the sibling
  `package.json` at startup so it stays in sync automatically.

### Added
- Dockerfile `VERSION` build-arg, baked into the image's
  `org.opencontainers.image.version` label. Inspect via
  `docker inspect simplemdm-mcp | grep version`. Defaults to `dev`.

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
