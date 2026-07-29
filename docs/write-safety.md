# Write Safety — Deep Dive

The write-safety layer (added in 0.36.0) makes write-enabled operation safe by
default: every one of the 87 write tools is risk-tiered, previewable via
`dry_run`, audit-logged, and — for the dangerous tiers — impossible to execute
in a single call. It exists so that an LLM client (or a confused human) can
never wipe, unenroll, or delete anything without an explicit second step.

**With `SIMPLEMDM_ALLOW_WRITES` unset (the default), none of this activates** —
every write tool refuses to run with "Write actions are disabled", exactly as in
earlier releases. The gate only engages once writes are deliberately enabled.

---

## Risk tiers

Every write tool carries exactly one tier, defined in
[`src/safety/tiers.ts`](../src/safety/tiers.ts) and surfaced as a
`[risk tier: X]` suffix on the tool's description. A build-failing invariant
test keeps the map complete: a write tool without a tier (or a tiered tool that
isn't registered) fails CI.

| Tier | Meaning | Confirm token? | Examples |
|---|---|---|---|
| `low` | Idempotent / trivially repeatable; no user-visible device change | No | `sync_device`, `refresh_device_inventory`, DEP syncs, MunkiReport pushes |
| `medium` | Changes management state; reversible via another API call | No | group/profile/app assignment, custom attribute values, `create_*` catalog objects |
| `high` | User-visible device impact or security-state change | **Yes** | `lock_device`, `restart_device`, `update_os`, lost-mode enable/disable, password/key rotation, `create_script_job` |
| `critical` | Irreversible or destructive | **Yes** | `wipe_device`, `unenroll_device`, `disable_activation_lock`, all `delete_*`, all `clear_*` |

The `critical` tier is the single source of truth for the MCP
`destructiveHint` annotation.

## The two-step confirm flow (high / critical)

With writes enabled and confirm mode on (the default), the first call to a
high/critical tool does **not** execute. It returns a plan:

```json
{
  "write_gate": "confirmation_required",
  "tool": "wipe_device",
  "tier": "critical",
  "args": { "device_id": "42" },
  "targets": [{ "id": "42", "name": "iPhone-42", "serial": "F2LW1234ABCD" }],
  "would_execute": "Remote wipe. Erases all data on the device. Irreversible. ...",
  "executed": false,
  "confirm_token": "3f9a…",
  "expires_at": "2026-07-29T05:02:00.000Z",
  "instructions": "…show the user what will happen and get their explicit approval…"
}
```

Re-calling the tool with the **identical arguments** plus `confirm_token`
executes it. Semantics that matter:

- **Single-use** — a token is deleted the moment it is redeemed.
- **Bound to the exact arguments** — the token wraps a SHA-256 hash of the tool
  name + canonicalized arguments (key order doesn't matter; `confirm_token` and
  `dry_run` are excluded). Change any argument and the token is rejected.
- **Expiring** — TTL defaults to 120 s (`SIMPLEMDM_CONFIRM_TTL_SECONDS`).
  Malformed TTL values **fail closed** to 120 with a stderr warning.
- **In-memory** — a server restart clears tokens; the only consequence is
  requesting a fresh plan.
- Rejected tokens (unknown / expired / argument mismatch) return a clear error
  and are audit-logged as `blocked`; they never create MunkiReport findings.

The **execute response is the raw SimpleMDM API result** — there is no
`executed: true` wrapper. The absence of a `write_gate` field is what indicates
the write actually ran. `targets` resolve only for writes that name devices
(`device_id`/`device_ids`); other writes show `targets: []` with `args` as the
source of truth.

## `dry_run`

Every write tool — any tier — accepts `dry_run: true` and returns the same plan
shape (`write_gate: "dry_run"`) without ever calling the SimpleMDM write API.
Dry runs never require or consume tokens and are audit-logged as phase
`dry_run`.

## Audit log

Every write invocation is appended to a JSONL file — one line per event:

| Field | Values / meaning |
|---|---|
| `phase` | `plan` \| `dry_run` \| `execute` \| `blocked` |
| `outcome` | `success` \| `error` \| `blocked` |
| `tool`, `tier`, `ts`, `event_id` | what, how risky, when, unique id |
| `args` | redacted — keys containing pin/password/passcode/secret/token/key/cookie/auth become `[REDACTED]` |
| `args_hash`, `token_id` | correlate a plan with its execution |
| `http_status`, `error`, `duration_ms` | execute-path details |

Files are daily (`audit-YYYYMMDD.jsonl`) under `MCP_WRITE_AUDIT_DIR` (default
`audit_log/`, resolved against the install root), which makes retention a
simple delete-old-files operation. The writer **never throws** — an unwritable
directory degrades to a stderr warning rather than failing the tool call.

Query it with the `get_write_audit_log` tool (filters: `since`, `tool`, `tier`,
`phase`, `outcome`, `limit`) or the `simplemdm://audit/recent-writes` resource.

**Docker:** the default directory lives inside the per-session `--rm`
container. Mount it to keep the trail: `-v "$PWD/audit_log:/app/audit_log"`
(the image pre-creates the directory for the container user; every documented
Docker example includes the mount).

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `SIMPLEMDM_ALLOW_WRITES` | unset | Master switch — unset means every write refuses to run |
| `SIMPLEMDM_CONFIRM_MODE` | `on` (when writes enabled) | `off` executes high/critical directly; read per-call; `off` logs a startup stderr warning |
| `SIMPLEMDM_CONFIRM_TTL_SECONDS` | `120` | Token lifetime; malformed values fail closed to 120 |
| `MCP_WRITE_AUDIT_DIR` | `audit_log/` | JSONL audit destination |

## Interactions worth knowing

- **Findings middleware** — plan/dry-run/blocked paths return before the tool
  handler runs, so cache invalidation and MunkiReport auto-publish fire only on
  real executions. Gate rejections are plain client errors and never become
  fleet findings.
- **API-key scope is an independent second gate** — a read-only SimpleMDM key
  403s every write even when the server-side gate approves. Running with a
  read-only key plus `SIMPLEMDM_ALLOW_WRITES=true` is a safe way to exercise
  the gate end-to-end (plans issue, executions 403).
- **The 9 gated workflow prompts** walk the client through this machinery in a
  fixed order — see [`workflow-prompts.md`](workflow-prompts.md).

## See also

- [`tools.md`](tools.md) — the Write-safety gate summary + full tool catalog
- [`workflow-prompts.md`](workflow-prompts.md) — the playbooks built on the gate
- [README — Write safety](../README.md#write-safety) — quick-start walkthrough
