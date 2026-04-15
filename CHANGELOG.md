# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[SemVer](https://semver.org/).

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
