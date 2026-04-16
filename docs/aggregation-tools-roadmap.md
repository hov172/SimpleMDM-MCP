# Fleet Analytics Tools — Roadmap

A tiered list of derived/aggregation tools (beyond the raw SimpleMDM API) that deliver real value to a Mac admin team. Tiering reflects **impact** (how often the question gets asked, how much manual work it replaces) vs **cost** (build time, API load, maintenance burden, overlap with existing tools/prompts).

> **Status (0.5.0):** 28 derived tools shipped. 2 drafted tools were rejected after senior-dev review and remain unbuilt — listed at the end with reasoning. Several shipped tools depend on optionally-populated SimpleMDM fields and degrade to empty when the field isn't there for your tenant.

Status legend per tool: `[shipped]` `[rejected]` `[deferred]`.

---

## Tier 0 — Core fleet rollups

| Tool | Status | What it answers |
|------|--------|-----------------|
| `get_top_installed_apps` | `[shipped]` | Which apps are everywhere? |
| `get_app_coverage(bundle_id)` | `[shipped]` | Is X on every Mac? |
| `get_stale_devices(days)` | `[shipped]` | Which devices have gone dark? |
| `get_storage_health` | `[shipped]` | Who's about to run out of disk / battery? |
| `get_unmanaged_apps` | `[shipped]` | What's installed but not managed? |

---

## Tier 1 — High-impact operational tools

| Tool | Status | Notes |
|------|--------|-------|
| `get_app_version_drift(bundle_identifier)` | `[shipped]` | Version distribution + per-device rows. Action: `update_installed_app` / `push_apps_to_group`. |
| `get_compliance_violators(rules)` | `[shipped]` | Single call returning enrolled devices failing one or more checks. OS-lag baseline is the per-platform currently-shipping major (override via `CURRENT_SUPPORTED_OS_OVERRIDE`); pass `skip_os_check: true` to focus on hard-compliance signals only. Returns a `failure_counts` rollup. |
| `get_devices_missing_profile(profile_id)` | `[shipped]` | Coverage check; mirrors `get_app_coverage` for profiles. |
| `get_dep_unassigned` | `[shipped]` | DEP devices not yet assigned to a SimpleMDM enrollment. |
| `get_pending_commands(min_age_hours)` | `[shipped]` | Reads global /logs and pairs sent vs acknowledged events. Returns empty if /logs doesn't expose command events. |
| `get_recently_enrolled(days)` | `[shipped]` | New-hire onboarding tracking. |
| `get_lost_mode_devices` | `[shipped]` | Daily ops review. |
| `get_dep_drift` | `[shipped]` | DEP devices whose profile_uuid differs from the dep_server's default. |
| `get_filevault_recovery_key_audit` | `[rejected]` | See [Rejected](#rejected). |

---

## Tier 2 — Catalog hygiene & operational rollups

| Tool | Status | Notes |
|------|--------|-------|
| `get_app_install_failures` | `[shipped]` | Sparse if SimpleMDM doesn't return `install_status`. |
| `get_battery_health_report` | `[shipped]` | Cycle-count / max-capacity flags require fields most tenants don't populate; falls back to level only. |
| `get_network_summary` | `[shipped]` | Carrier / Wi-Fi / IP rollup. |
| `get_user_attribution(custom_attribute_name)` | `[shipped]` | Reads a custom attribute holding the primary user. |
| `get_os_eligibility` | `[shipped]` | Static model→max-macOS table (last updated 2024-11). Override via `MAC_OS_ELIGIBILITY_OVERRIDE` env var. |
| `get_inactive_assignment_groups` | `[shipped]` | Groups with 0 devices. |
| `get_orphaned_profiles` | `[shipped]` | Profiles not in any assignment group. |
| `get_orphaned_apps` | `[shipped]` | Catalog apps not in any assignment group. |
| `get_app_size_footprint` | `[shipped]` | Sparse if SimpleMDM doesn't expose `app_size`. |
| `get_assignment_group_drift` | `[shipped]` | Devices whose installed apps diverge from their group's assigned set. |

---

## Tier 3 — Niche / context-specific

| Tool | Status | Notes |
|------|--------|-------|
| `get_certificate_expiration_audit` | `[shipped]` | APNs / push cert renewal warnings (90/60/30/expired bands). |
| `get_enrollment_token_audit(stale_days)` | `[shipped]` | Stale flag if `last_used_at` not populated → falls back to no-use-ever. |
| `get_device_user_count_outliers(min_users)` | `[shipped]` | Macs with too many local accounts. |
| `get_supervision_drift` | `[shipped]` | DEP-enrolled devices that lost supervision. |
| `get_kernel_extension_inventory` | `[rejected]` | See [Rejected](#rejected). |

---

## Tier 4 — Selectively built

| Item | Status | Why |
|------|--------|-----|
| `get_apps_by_publisher` | `[shipped]` | Surprisingly common ask; fast win on top of the existing iteration. |
| Generic count/sum tools | `[deferred]` | Already covered by `get_fleet_summary` / `get_security_posture`. |
| `export_to_csv` | `[deferred]` | Formatting belongs in the client. |
| `ai_recommend_*` tools | `[deferred]` | That's what MCP **prompts** are for. |
| `get_audit_log` | `[deferred]` | Only build if SimpleMDM exposes an audit endpoint. |
| `get_random_device` / test utilities | `[deferred]` | Clutters the catalog. |

---

## Rejected

Drafted but removed before merge — would have produced misleading or empty output. Re-attempt only after the underlying API surface is verified.

| Tool | Reason |
|------|--------|
| `get_filevault_recovery_key_audit` | SimpleMDM exposes `rotate_filevault_recovery_key` (POST) but no verified read endpoint for escrowed-key status. Implementing without it would require speculative field names that don't exist in the standard API. **Re-attempt path**: confirm whether your tenant has a `GET /devices/:id/filevault_recovery_key` endpoint; if 200/404 distinguishes escrowed vs not, the tool is ~30 lines. |
| `get_kernel_extension_inventory` | MDM API doesn't surface KEXTs/sysexts. The codebase's existing MunkiReport integration covers `sync_health`, `compliance`, `device_resources`, `apple_care`, `supplemental_overview` — none of which include kext lists. **Re-attempt path**: add a MunkiReport hardware-extensions module endpoint (e.g. `/munkireport/data/kernel_panics` or a custom `/data/sysext_inventory`) and consume it from a new tool. |

---

## Operational guidance

### Rate limits and concurrency
- SimpleMDM publishes a sustained limit of ~1 req/sec with bursts. Every fleet-iteration tool sends 1 HTTP per device (or per device pair, for `get_assignment_group_drift`).
- Default worker pool is **8** (`SIMPLEMDM_FLEET_CONCURRENCY`). Lower it (`=4`) if you start seeing 429s or your tenant has tighter limits; raise it (`=16`) only if you've confirmed your tenant tolerates it.
- The HTTP layer already retries 429/5xx with `Retry-After`-aware exponential backoff (`SIMPLEMDM_MAX_RETRIES`, default 3), so transient throttling won't fail a tool — it'll just slow it.

### When to use `LOCAL_APP_MODE`
- The Report-SimpleMDM local app exposes pre-aggregated endpoints for `get_fleet_summary` and `get_security_posture`. Those return instantly because the app already holds the device cache.
- The new derived tools **do not** have local-app shortcuts yet — they always iterate the SimpleMDM API. If you run heavy analytics regularly against a large fleet, an upcoming improvement is to add `/enrichment/top_apps`, `/enrichment/compliance_violators`, etc., in the local app.

### Caching
- Tools do **not** cache between calls. Every invocation re-iterates the fleet. For repeated questions in the same session, prefer chaining via prompts (so the LLM keeps the result in context) rather than calling the same tool twice.

### Sparse fields
The tools below depend on fields that SimpleMDM populates only when the device's MDM payload includes them, the integration is configured, or your tenant has the relevant feature enabled. They return empty when the field isn't there:

| Tool | Field |
|------|-------|
| `get_app_install_failures` | `installed_apps[].install_status` |
| `get_battery_health_report` | `battery_cycle_count`, `battery_max_capacity_pct` |
| `get_network_summary` (carrier section) | `current_carrier_network` |
| `get_enrollment_token_audit` | `enrollments[].last_used_at` |
| `get_dep_drift` | `dep_servers[].default_assignment_profile_uuid` |
| `get_app_size_footprint` | `installed_apps[].app_size` |

Verify on one device via `get_device` / `get_device_installed_apps` before relying on these in production.

---

## Testing strategy

There is **no automated test suite** for the analytics tools as of 0.5.0 — they hit a live SimpleMDM tenant, and recording fixtures for 153 tools is not yet justified by team size.

Until that changes, the validation contract is:

1. **Smoke test before each release.** From a tenant of >50 devices, invoke each newly-added tool and confirm the response shape and a non-empty result for the obvious cases. Track in a release checklist.
2. **Schema check.** `tools/list` must always parse; `npm run build` (which runs `tsc`) is the only gate today.
3. **Sparse-field verification.** For tools in the table above, manually inspect one device's raw record (`get_device`) to confirm the expected field is populated for your tenant before recommending the tool to others.

Open work (not yet started):
- Mock-server fixture suite for at least the Tier 0/1 tools.
- Snapshot tests for the static `MACOS_SUPPORT_TABLE` to catch accidental edits.

---

## Release plan

- **0.5.0** (this release): 28 derived tools. Minor bump (additive, no breaking changes).
- **Update on each macOS major release**: bump `table_last_updated` and the `MACOS_SUPPORT_TABLE` rows in `src/index.ts`. This is a forced minor bump because it changes tool output; document the table delta in the CHANGELOG.
- **Tool-count drift**: the README quotes a count (`154`); update it in the same commit that adds/removes a tool. There is no script to enforce this — discipline only.
- **Sparse-field surveys**: when a customer reports that one of the optional-field tools returns empty, capture the field name and tenant settings in `docs/aggregation-tools-roadmap.md` so future maintainers know the conditions under which it works.

---

## MCP context budget

The catalog is now **153 tools**. Every conversation pays a token tax for the full `tools/list` payload. On clients with smaller context windows (or many MCP servers configured), this matters.

Mitigations available today:
- **Per-tool hide via `skillOverrides`** (Claude Code): users can hide individual tools in their `~/.claude/settings.json` without modifying this server. Useful for clients that never use the analytics surface.
- **Plugin split (future)**: the analytics tools could move to a sibling MCP server (e.g. `simplemdm-analytics-mcp`) that's enabled only in admin contexts. Not done in 0.5.0 — single server is simpler to install — but the Tier-0/1/2/3 boundary maps cleanly to a future split if catalog size becomes a problem.
- **Description discipline**: keep tool descriptions tight. Every word in a description ships on every conversation.

---

## Build heuristics (so future tools land in the right tier)

1. **Iterate-every-device tools belong in the server, not the client.** Anything requiring N HTTP calls to answer should be a tool — otherwise the LLM blows context aggregating it.
2. **Single-device or single-resource lookups should stay raw.** Don't wrap `get_device` in twelve specialized variants — let the caller compose.
3. **Workflows belong in prompts, not tools.** "Audit X then recommend Y" is a prompt that chains the underlying tools (see `app-inventory-audit`, `compliance-violators-remediation`).
4. **Read-only by default.** Aggregation tools should never mutate. Action tools (`assign_*`, `push_*`, etc.) stay separate.
5. **Verify the field exists before shipping.** Don't ship a tool that depends on a guessed field name. If you can't verify, document the dependency in the description and the sparse-fields table above.
6. **Mark slow tools clearly in the description** so the LLM knows when to warn the user about latency.
