# Workflow Prompts — Deep Dive

The server exposes **14 MCP prompts** — reusable playbooks a client renders into
its context and follows with the server's tools. Five are read-only analyses;
**nine are write-capable and follow a single gated 7-step protocol** built on the
[write-safety layer](write-safety.md) (added in 0.36.0).

Prompts are advertised via standard MCP `prompts/list` / `prompts/get`. In
Claude, they surface as slash-selectable prompts on the connected server.

---

## The gated 7-step protocol

Every write-capable prompt embeds the same shared protocol (single source in
`src/index.ts`, lint-enforced per prompt by `test/gatedPrompts.test.mjs` — step
order, `dry_run`/`confirm_token` references, and a `RECOVERY:` section are all
asserted, and a completeness assertion guarantees every prompt is either gated
or explicitly read-only):

1. **PLAN** — enumerate exact targets with read tools only.
2. **DRY-RUN** — call each intended write tool with `dry_run: true`; collect plans.
3. **PRESENT** — show the user one consolidated plan: targets, tiers, what changes.
4. **CONFIRM** — the user explicitly approves (types CONFIRM); high/critical
   tools then issue and redeem their single-use `confirm_token`.
5. **EXECUTE** — run writes in order; stop on first unexpected failure.
6. **VERIFY** — re-query with read tools to prove each change landed.
7. **REPORT** — summarize outcomes (`get_write_audit_log` has the trail) and
   restate the recovery notes for anything irreversible.

User approval happens **before** the first token is issued, so the
plan-call → execute-call pair runs back-to-back at machine speed and never
races the 120 s token TTL.

There is no rollback pretense: each playbook's `RECOVERY:` section states
honestly what is reversible (and with which tool) and what is not (a wipe, a
cleared passcode, an OS update).

## The nine gated playbooks

| Prompt | Arguments | What it does |
|---|---|---|
| `device-offboarding` | `device_ref` | Unscope groups/profiles, then lock (recoverable) **or** wipe (irreversible — user chooses before the dry-run pass); verify; DEP re-enroll guidance |
| `new-device-onboarding` | `device_ref` | Verify profiles/apps/groups/DEP on a fresh enrollment; remediate gaps (group assignment, `sync_device`, inventory refresh) |
| `stale-devices-cleanup` | `days` (default 14) | `sync_device` for borderline devices, `lock_device` past 30 days; **never** proposes unenroll/wipe — routes those to device-offboarding |
| `compliance-violators-remediation` | `max_os_major_lag` (default 1) | Groups violators by failure type; `update_os` for OS lag, profile reassignment for FileVault; surfaces `clear_passcode` (critical, irreversible) as a separate opt-in; flags supervision/UAMDM failures as manual re-enrollment work |
| `profile-coverage-remediation` | `profile_id` | Closes coverage gaps — group-based rollout when >20 devices are missing the profile, per-device assignment otherwise; verifies via `get_devices_missing_profile` |
| `lost-device-response` | `device_ref` | Lost Mode (iOS/iPadOS; Macs go straight to `lock_device` with a PIN), location request, sound, optional lock; wipe only on explicit user demand as a separate confirmation; never disable Activation Lock on a stolen device |
| `emergency-patching` | `platform`, `max_major_lag` | Pilot-first staged `update_os` rollout to vulnerable devices; a failed pilot stops the rollout; verifies uptake after check-ins |
| `semester-refresh` | `group` | Education cycle re-baseline for one assignment group: re-push profiles, update/push apps, refresh inventory; non-destructive by construction |
| `lab-provisioning` | `group`, `profile_ids?`, `app_ids?` | Ensure the group exists, assign profiles/apps, push, verify coverage trends to zero |

## The five read-only prompts

`fleet-health-dashboard` (posture + cert/DEP expiry snapshot),
`security-audit`, `patch-compliance-review`, `app-inventory-audit`,
`configure-webhooks-guide`. These never carry the gated skeleton and are
excluded from the gated set by the same lint test.

## See also

- [`write-safety.md`](write-safety.md) — the gate the playbooks are built on
- [`recommendations.md`](recommendations.md) — `recommend_fixes` maps each fleet
  issue to the playbook that fixes it
- [README prompt table](../README.md) — one-line summaries with arguments
