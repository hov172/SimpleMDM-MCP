# Findings Auto-Publish Middleware

The findings middleware turns eligible MCP tool calls into MunkiReport findings
automatically, without a human running `run_fleet_audit --publish` by hand. It
implements PRD Phase 4 (`SimpleMDM_MCP_MunkiReport_Findings_Platform_PRD_SDS_v4`
§6-8, §12) scoped to this repo only — no MunkiReport-php schema, route, or
widget changes; findings still use the existing 3-value severity model
(`danger`/`warning`/`info`) and travel over the same `push_munkireport_findings`
/ `ingest_mcp_findings` wire contract this server already shipped.

It requires a [SimpleMDM-MunkiReport module](https://github.com/hov172/SimpleMDM-MunkiReport)
instance — see [`MUNKIREPORT_*`](../README.md#environment-variables) in the
main README for connection config. The middleware is off by default; nothing
changes for installs that don't set `MUNKIREPORT_ENABLED`.

## How it decides what to publish

After every tool call succeeds (or, for action tools, fails against the real
SimpleMDM API), the middleware checks the tool's entry in the internal manifest
(`src/findings/toolManifest.ts`, one entry per registered tool) and, if
eligible, builds `McpFinding[]` and pushes them via the same ingest path
`push_munkireport_findings` uses — `source: mcp_auto_<toolName>`,
`replace: true` (so repeated calls reflect current state instead of piling up
duplicates). A publish failure never affects the tool's own response to the
caller — it's logged (and optionally queued for retry, see below), not thrown.

| Tool category | Publishes by default? | Notes |
|---|---|---|
| **Compliance / Health-check** (`get_compliance_violators`, `get_stale_devices`, `get_certificate_expiration_audit`, …) | Yes, in `auto` mode | 14 tools with a per-row/per-object adapter, verified against each tool's real return shape. 5 of them (`get_dep_unassigned`, `get_device_user_count_outliers`, `get_enrollment_token_audit`, `get_os_eligibility`, `get_pending_commands`) only emit `severity: "info"` findings, so they publish nothing at the default `MCP_PUBLISH_MIN_SEVERITY=warning` — set it to `info` to include them. |
| **Inventory** (`get_unmanaged_apps`, `get_app_coverage`, `get_orphaned_apps`, …) | No — opt-in only | See `MCP_PUBLISH_INVENTORY_TOOLS` below. All findings are `severity: "info"`. |
| **Action** (`lock_device`, `wipe_device`, `restart_device`, …) | Only on **failure** | Publishes a single `severity: "danger"` finding when the action genuinely fails against SimpleMDM (a non-2xx API response) — never on success (there's no "healthy" state for an action), and never for a client/config error (bad arguments, `SIMPLEMDM_ALLOW_WRITES` unset) that never reached the network. Failure findings use their own source namespace `mcp_auto_action_<toolName>` (not `mcp_auto_<toolName>`), category `Action Failure`, finding type `action_failed_<toolName>`. |
| **Audit** (`run_fleet_audit`) | Only via the existing `publish`/`scan_id` params (CLI `--publish`/`--scan-id`) | Unchanged, separate code path (`src/reports/domain/findings-map.ts`) — not part of this middleware. `run_device_logs_audit` (the `logs` report) has no findings-publish path at all. |
| Config-write / Read-only query / Reporting-export | Never | No per-tool "issue" signal to publish. |

Run `node dist/reports/cli.js findings validate` any time to confirm every
currently-registered tool has exactly one manifest entry (see [CLI
subcommands](#cli-subcommands) below) — useful after adding a new tool.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MUNKIREPORT_ENABLED` | `false` | Master switch. `false` means the middleware never runs, regardless of the other settings below. |
| `MCP_PUBLISH_MODE` | `manual` | `auto` — publish eligible findings automatically. `dry_run` — log what *would* publish, never actually push. `manual` — middleware never fires; the existing explicit `push_munkireport_findings` / `audit --publish` paths remain how you publish. `disabled` — same as `manual`, unconditionally. Values are case-insensitive; an unrecognized value silently falls back to `manual` (it is not an error). |
| `MCP_PUBLISH_MIN_SEVERITY` | `warning` | Skip findings below this severity (`danger` > `warning` > `info`). Action-tool failures are always `danger`, so this threshold can't filter them out. Case-insensitive; an unrecognized value silently falls back to `warning`. |
| `MCP_PUBLISH_INVENTORY_TOOLS` | *(empty)* | Comma-separated allowlist of inventory tool names to opt into auto-publish (e.g. `get_unmanaged_apps,get_orphaned_apps`). `MCP_PUBLISH_MODE=auto` alone never starts publishing this category — a tool must also be named here. |
| `MCP_FINDINGS_QUEUE_DIR` | *(unset)* | Path to a directory for the persistent on-disk retry queue (see below). Unset means the queue is disabled — a failed publish is just logged, matching the original best-effort behavior. |

`MUNKIREPORT_BASE_URL` / `MUNKIREPORT_MODULE_PREFIX` (already documented in the
main README) are reused as-is — there's no separate connection config for this
middleware.

## Persistent retry queue

Failed publishes (after `fetchWithRetry`'s in-process backoff is exhausted)
are, by default, logged and dropped — nothing survives a process restart. Set
`MCP_FINDINGS_QUEUE_DIR` to a writable directory to durably queue them instead:
each failed publish becomes one JSON file there, later replayed by
`findings retry` (below) in chronological order. A file is deleted only on a
successful retry; a still-down MunkiReport instance just leaves it queued.
Draining is **not** automatic (no background timer in a stdio MCP server) —
run `findings retry` yourself, e.g. from cron, after a known outage.

## CLI subcommands

Reachable today via the built CLI entry point (`node dist/reports/cli.js`, the
same binary that runs `audit`/`inventory`/`logs`/`diff`) — **not yet** wired
into the `simplemdm-mcp` package binary itself, which always starts the MCP
stdio server. Run these from a checkout with `dist/` built (`npm run build`).

```
node dist/reports/cli.js findings status
```
Prints the current config (`enabled`, `mode`, `minSeverity`,
`inventoryOptIn`, `queueDir`) and, if a queue dir is set, the number of queued
files and the oldest one's timestamp. Read-only, no network call.

```
node dist/reports/cli.js findings retry
```
Drains the retry queue, printing `attempted`/`succeeded`/`failed` counts.
Prints a clear "nothing to retry" message (not an error) if
`MCP_FINDINGS_QUEUE_DIR` isn't set.

```
node dist/reports/cli.js findings dry-run <tool_name> --fixture <path-to-json>
```
Developer/debugging aid: runs a JSON fixture file (what you expect a tool's
result to look like) through the exact same adapter-transform logic the live
middleware uses, and prints what would be published — without ever calling
MunkiReport. Errors clearly if the tool has no adapters wired or the fixture
doesn't parse.

```
node dist/reports/cli.js findings validate
```
Compares the internal manifest against every tool actually registered in
`src/index.ts`, reporting any drift (a registered tool with no manifest entry,
or a stale entry for a tool that no longer exists) with a nonzero exit code —
useful as a CI/pre-commit gate after adding or removing tools.

## Known limitations (tracked follow-up work)

- Action-tool failure findings link by the tool's own id field (`device_id`,
  `group_id`, `job_id`, …, packed into the finding's `data`) — resolving a
  `device_id` to its `serial_number` would need an extra live API call on an
  error path, so it's omitted.
- The retry queue only drains when you run `findings retry` — there is no
  background scheduler.
- `findings *` is only reachable via `node dist/reports/cli.js findings …`
  today, not `simplemdm-mcp findings …` (the packaged binary always starts the
  MCP server; it has no argv subcommand routing yet).
