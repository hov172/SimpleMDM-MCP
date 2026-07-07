# Tools

The server registers **200 tools** covering the full SimpleMDM API surface (30 derived fleet-analytics tools, 16 MunkiReport tools, 16 Apple schema helper tools). Reads are always available; writes require `SIMPLEMDM_ALLOW_WRITES=true`. Every tool ships with MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so compatible clients can render the correct confirmation UI.

## Read tools (always available)

**Account & fleet**
| Tool | Description |
|------|-------------|
| `get_account` | Account info: name, App Store country, subscription license counts |
| `get_fleet_summary` | Total devices, enrolled/unenrolled, posture counts, OS breakdown |
| `get_device_full_profile` | **Compound** — device + profiles + installed apps + users + recent logs in parallel (device_id or serial_number) |
| `get_security_posture` | **Compound** — fleet-wide percentages for supervised, DEP, FileVault, firmware/recovery lock, activation lock, UAMDM, passcode compliance |
| `get_api_coverage` | Static introspection: tool counts exposed by capability area (no API call — reads the registered tool list) |
| `check_for_update` | Compare the running server version against the latest GitHub release; reports `update_available` + the host-side upgrade steps (the container cannot self-update) |
| `run_fleet_audit` | Run the SOFA macOS security audit via the unified report engine CLI (`node dist/reports/cli.js audit`) as a host-side subprocess; writes CSV/md/html/docx/pdf to `reports/` and returns a text summary. Relative output paths resolve under the installed package root. Supports `page_size: a3\|a4`. |
| `run_device_logs_audit` | Run the forensic device-logs audit via the unified report engine CLI (`node dist/reports/cli.js logs`) as a host-side subprocess; writes dossiers + CSVs to `reports/` and returns a text summary. Relative output paths resolve under the installed package root |
| `run_inventory_report` | Run the searchable fleet inventory report via the unified report engine CLI (`node dist/reports/cli.js inventory`) as a host-side subprocess; writes CSVs + a md/html/docx/pdf dossier to `reports/` and returns a text summary. Relative output paths resolve under the installed package root |
| `run_report_diff` | Compare two local inventory report run dirs (both under the install root's `reports/`): devices added/removed, meaningful field changes, findings new vs resolved; writes `diff-vs-<before>.md` into the after dir. Purely local — no API calls |
| `run_config_backup` | Disaster-recovery export: downloads every custom profile's mobileconfig + custom declarations, plus scripts/groups/attributes records, with a sha256 manifest, to `reports/config-backup-<ts>/` under the installed package root |
| `generate_report` | Generate a fleet dossier **in-process** (audit/inventory/logs) and return `WriteResult` metadata (out_dir + per-file sha256). Relative output paths resolve under the installed package root. Two modes: catalog (`report` + `scope`, same registry as the CLI) or dynamic (`spec`, a declarative report rendered in the house style over a chosen data adapter) |

**Apple schema helpers**

See [Apple Schema Helpers](apple-schema-helpers.md) for the end-to-end workflow: search Apple's local schema cache, validate/build a payload, then create the SimpleMDM custom profile or declaration. See [Apple Device Management Schema Cache](../data/apple-device-management/README.md) for cache refresh and fixture-sync details.

| Tool | Description |
|------|-------------|
| `search_apple_device_management_schemas` | Search the local Apple `device-management` schema cache for profile payloads and DDM declarations |
| `get_apple_device_management_schema` | Get required keys, enum values, platforms, availability, and source path for one Apple payload/declaration identifier |
| `validate_apple_payload` | Validate a profile payload or DDM declaration payload object before creating a SimpleMDM custom profile/declaration |
| `build_mobileconfig` | Build `.mobileconfig` XML from one or more validated Apple profile payload objects |
| `build_custom_declaration_payload` | Build declaration JSON from a validated DDM declaration payload |
| `build_wifi_profile_payload` | Build a validated `com.apple.wifi.managed` payload |
| `build_firewall_profile_payload` | Build a validated macOS firewall payload |
| `build_passcode_profile_payload` | Build a validated passcode policy payload |
| `build_software_update_settings_declaration` | Build a validated DDM software update settings declaration |
| `build_restrictions_profile_payload` | Build a validated restrictions payload |
| `build_scep_profile_payload` | Build a validated SCEP payload with nested `PayloadContent` |
| `build_certificate_profile_payload` | Build a validated root certificate payload |
| `build_vpn_profile_payload` | Build a validated VPN payload |
| `build_webclip_profile_payload` | Build a validated web clip payload |
| `build_content_filter_profile_payload` | Build a validated content filter payload |
| `build_filevault_escrow_profile_payload` | Build a validated FileVault escrow payload |

**Devices**
| Tool | Description |
|------|-------------|
| `list_devices` | Search/filter devices by name, serial, UDID, IMEI, MAC (auto-paginates) |
| `get_device` | Full device detail — hardware, OS, posture, battery, storage |
| `get_activation_lock_status` | Whether Activation Lock is enabled on a device (`is_activation_lock_enabled`), with the device `name`, `serial_number`, supervision, and DEP status |
| `get_device_profiles` | Installed configuration profiles on a device |
| `get_device_installed_apps` | Installed apps with managed/unmanaged state |
| `get_device_users` | User accounts on a device (macOS) |
| `get_device_logs` | MDM command logs for a device by serial |
| `list_device_groups` | Legacy device groups |
| `get_device_group` | Detail for a legacy device group |

**Apps**
| Tool | Description |
|------|-------------|
| `list_apps` | Full app catalog (App Store, enterprise, shared) |
| `get_app` | Single app detail |
| `list_app_installs` | Install records for an app across the fleet |
| `get_installed_app` | Detail for a specific installed-app record |
| `list_managed_app_configs` | Managed app configurations |
| `get_managed_app_config_templates` | Retrieve managed app configuration templates (Chrome, Zoom, Teams) |

**Profiles & declarations**
| Tool | Description |
|------|-------------|
| `list_profiles` | All profiles |
| `get_profile` | Single profile detail |
| `list_custom_configuration_profiles` | Custom `.mobileconfig` profiles |
| `download_custom_configuration_profile` | Download the actual mobileconfig XML of a custom profile (list/get return metadata only) |
| `download_custom_declaration` | Download the raw content of a custom DDM declaration |
| `list_custom_declarations` | DDM declarations |
| `get_custom_declaration` | Single DDM declaration detail |

**Assignment groups**
| Tool | Description |
|------|-------------|
| `list_assignment_groups` | All assignment groups |
| `get_assignment_group` | Group detail including apps/devices/profiles |

**Custom attributes**
| Tool | Description |
|------|-------------|
| `list_custom_attributes` | All custom attributes |
| `get_custom_attribute` | Single attribute definition |
| `get_device_attribute_values` | Attribute values set on a device |
| `get_group_attribute_values` | Attribute values set on a group |

**Scripts**
| Tool | Description |
|------|-------------|
| `list_scripts` | Script library |
| `get_script` | Single script detail |
| `list_script_jobs` | Script jobs, filterable by status |
| `get_script_job` | Single script job detail |

**Enrollment & DEP**
| Tool | Description |
|------|-------------|
| `list_enrollments` | Active enrollment configs |
| `get_enrollment` | Single enrollment detail |
| `list_dep_servers` | Registered DEP/ABM servers |
| `get_dep_server` | Single DEP server detail |
| `list_dep_devices` | DEP devices for a server |
| `get_dep_device` | Single DEP device detail |
| `get_dep_device_status` | Search for a DEP device by serial across all DEP servers |

**Logs & certificates**
| Tool | Description |
|------|-------------|
| `list_logs` | Account-wide audit logs |
| `get_log` | Single log entry |
| `get_push_certificate` | APNs push certificate info |
| `get_signed_csr` | Signed CSR for push certificate renewal |
| `verify_webhook_payload` | Validate incoming SimpleMDM webhook JSON payload schema |

**Fleet analytics (derived — iterate the fleet)**

These tools answer questions the raw API can't in a single call. They iterate every enrolled device under a bounded worker pool (`SIMPLEMDM_FLEET_CONCURRENCY`, default 8). Slow on large fleets but bounded; results are cached in-memory with a configurable TTL (default 5 min, see `SIMPLEMDM_CACHE_TTL_MS`). Full per-tool reference: [`aggregation-tools-roadmap.md`](aggregation-tools-roadmap.md).

| Tool | Description |
|------|-------------|
| `get_top_installed_apps` | Apps ranked by install count across the fleet |
| `get_app_coverage` | For one bundle ID: install pct + list of devices missing it |
| `get_app_version_drift` | Version distribution + per-device rows for one bundle ID |
| `get_app_install_failures` | Devices where managed app pushes failed (sparse if `install_status` not populated). Returns `_agent_hint` when zero failures may indicate missing data rather than no problems. |
| `get_apps_by_publisher` | Top installs grouped by publisher prefix |
| `get_app_size_footprint` | Fleet-wide storage cost per app |
| `get_unmanaged_apps` | Apps installed on the fleet but not in the SimpleMDM catalog (shadow IT) |
| `get_compliance_violators` | Single call returning enrolled devices failing one or more checks. Returns `_agent_hint` when the OS baseline appears stale (devices running a higher major than the configured baseline). |
| `get_devices_missing_profile` | Coverage check for a configuration profile |
| `get_assignment_group_drift` | Devices whose installed apps diverge from their group's assigned set |
| `get_stale_devices` | Enrolled devices not seen in N days |
| `get_recently_enrolled` | Devices enrolled in the last N days |
| `get_lost_mode_devices` | Devices currently in lost mode + last known location |
| `get_storage_health` | Devices with low disk and/or low battery |
| `get_battery_health_report` | Battery rollup (level + cycle/capacity flags when populated). Returns `_agent_hint` when only level data is available, warning that aging batteries may be missed. |
| `get_network_summary` | Wi-Fi MAC, ethernet MACs, last IP, carrier breakdown |
| `get_user_attribution` | Device → primary user mapping via custom attribute |
| `get_os_eligibility` | Mac model → max supported macOS major (static table, 2026-04, macOS 26 Tahoe). Returns `_agent_hint` when unknown models are found, directing the AI to web-search for compatibility info. |
| `get_inactive_assignment_groups` | Assignment groups with zero devices |
| `get_orphaned_profiles` | Profiles not attached to any assignment group |
| `get_orphaned_apps` | Catalog apps not attached to any assignment group |
| `get_dep_unassigned` | DEP devices not yet mapped to a SimpleMDM enrollment |
| `get_dep_drift` | DEP devices whose `profile_uuid` ≠ their dep_server's default |
| `get_pending_commands` | MDM commands sent but not acknowledged in N hours. Returns `_agent_hint` when the logs API isn't surfacing command events for the tenant. |
| `get_supervision_drift` | DEP-enrolled devices that lost supervision |
| `get_device_user_count_outliers` | Macs with unusually many local user accounts |
| `get_certificate_expiration_audit` | APNs push cert renewal warning bands |
| `get_enrollment_token_audit` | Stale enrollment URLs (no use in N days) |

**MunkiReport enrichment (require MunkiReport configuration)**

These tools query a [MunkiReport](https://github.com/munkireport/munkireport-php) instance running the **[SimpleMDM-MunkiReport module](https://github.com/hov172/SimpleMDM-MunkiReport)** — the module provides the `/module/simplemdm/…` routes these tools call (the server's default `MUNKIREPORT_MODULE_PREFIX` is `/module/simplemdm`); a vanilla MunkiReport without it returns 404 for every call. Two of the five tools surface **cross-module data** the module aggregates from *other* installed MunkiReport modules (verified in the module source): `get_munkireport_supplemental_overview` (built-in sources: `filevault_status`, `findmymac`, `warranty`/AppleCare, `profile`, `managedinstalls`, plus auto-discovery of any serial-keyed third-party module table) and `get_munkireport_apple_care` (the `warranty` module's table). Sources whose module isn't installed degrade to zeros, never errors. The other three tools return the module's own SimpleMDM-synced data and sync telemetry.

**Connecting the two projects (when MunkiReport enrichment is enabled):**

1. **Install the module** in your MunkiReport instance: clone [SimpleMDM-MunkiReport](https://github.com/hov172/SimpleMDM-MunkiReport) to `local/modules/simplemdm`, add `simplemdm` to `MODULES`, run `php please migrate`, configure its SimpleMDM API key, and run a sync (its README's Quick Start covers this in 5 minutes).
2. **Point this server at the instance**: set `MUNKIREPORT_BASE_URL=https://your-munkireport.example.com` (no path — the default `MUNKIREPORT_MODULE_PREFIX=/module/simplemdm` already matches the module's routes).
3. **Authenticate**: with a module build from 2026-07-08 on, the simplest setup is the sync token header — set `MUNKIREPORT_AUTH_HEADER_NAME=X-SIMPLEMDM-API-KEY` and `MUNKIREPORT_AUTH_HEADER_VALUE` to the same SimpleMDM API key the module stores. That covers **all 13 read tools** (the module whitelists sixteen token-readable read routes) plus `push_munkireport_findings`; no browser session is needed. `MUNKIREPORT_COOKIE` (a session cookie) remains an alternative, and is still **required** for the two admin actions `request_munkireport_sync` and `refresh_munkireport_supplemental` — those hit admin-session-only module routes. On older module builds the token only covers ten dashboard routes (`alerts`, `dashboard_trend`, `supplemental_data`, `client_facts`, `runner_status`, and `mcp_findings` then need a session).
4. **Test**: call `get_munkireport_sync_health`. Note the failure symptom: a missing/expired session or token returns MunkiReport's plain-text `Authenticate first.` page with HTTP 200, which surfaces here as a **JSON parse error** — not a 401. If you see that, check the header value (or refresh the cookie).


**Deliberately not exposed** (present in the module, excluded here by design): `run_script` (executes commands on the MunkiReport server — blast radius out of proportion to MCP value), `clear_sync_runs` (destroys run history), the `api_devices` device-action passthrough (duplicates this server's own SimpleMDM write tools and would blur which API key acted), `save_config` (module config writes, including secrets), and the sync-runner `ingest`/`ingest_resources`/`ingest_commands`/`ingest_client_facts`/`webhook` endpoints (this server is not the module's sync runner — the one ingest it does use is `ingest_mcp_findings`, purpose-built for `push_munkireport_findings`). Note for module operators: the module accepts its **SimpleMDM API key as the sync token** for `save_config` — treat that key accordingly.
 Configure via `MUNKIREPORT_BASE_URL` and auth env vars (see [Environment variables](../README.md#environment-variables)), or via the optional Report-SimpleMDM local app bridge (`LOCAL_APP_TIMEOUT_MS`).

| Tool | Description |
|------|-------------|
| `get_munkireport_sync_health` | Sync health telemetry from the MunkiReport simplemdm module |
| `get_munkireport_compliance` | Fleet compliance stats from the MunkiReport simplemdm module |
| `get_munkireport_device_resources` | Per-device connected-resource context (by serial number) |
| `get_munkireport_apple_care` | AppleCare coverage stats from the MunkiReport module |
| `get_munkireport_supplemental_overview` | Supplemental fleet overview from the MunkiReport module |
| `get_munkireport_alerts` | Alert/regression EVENTS (13 built-in types + custom rules, severity-filterable) — needs the module's `get_events` route (2026-07-07 build+) |
| `get_munkireport_command_status` | MDM command status distribution from the module's command mirror — no SimpleMDM API equivalent exists |
| `get_munkireport_dashboard_trend` | Daily fleet trend snapshots up to 180 days — historical data the API cannot provide |
| `get_munkireport_supplemental_data` | Per-device cross-module detail (all enrichment sources + client facts, with freshness) |
| `get_munkireport_supplemental_status` | Fleet enrichment health: stale/refresh_failed per source (admin session) |
| `get_munkireport_client_facts` | Option-B endpoint-local facts for one device (admin session) |
| `get_munkireport_runner_status` | Sync runner/cron/Python operational status — the "syncs silently stopped" warning surface (admin session) |
| `request_munkireport_sync` | Module: write — queue a mirror sync run (admin session; acts on the module, never SimpleMDM) |
| `refresh_munkireport_supplemental` | Module: write — recompute cross-module summaries, one device or fleet-wide (admin session) |
| `push_munkireport_findings` | Module: write — push MCP-computed findings (CVE exposure, audit deltas, …) into MunkiReport's MCP Findings widget; sync-token auth, no session needed (module 2026-07-07+ build) |
| `get_munkireport_mcp_findings` | Read back MCP-pushed findings with per-severity totals |

## Write tools (require `SIMPLEMDM_ALLOW_WRITES=true`)

All tools below modify fleet state. The API permission column tells you what the SimpleMDM API key must be scoped to.

**Device actions**
| Tool | API Permission |
|------|---------------|
| `lock_device` · `unlock` via passcode — send lock MDM cmd | Devices: write |
| `sync_device` | Devices: write |
| `restart_device` | Devices: write |
| `shutdown_device` | Devices: write |
| `wipe_device` ⚠️ destructive | Devices: write — supports `preserve_data_plan`, `disable_activation_lock`, `disallow_proximity_setup`, `return_to_service` (+ integer `wifi_network_id`), `obliteration_behavior`, `clear_custom_attributes`, `unassign_direct_profiles`, `preserve_managed_apps` (iOS 17+ — keeps managed apps installed through a wipe) |
| `refresh_device_inventory` | Devices: write — request a device info + app inventory refresh (`POST /devices/{id}/refresh`; SimpleMDM throttles per device; needs the API-key refresh scope) |
| `disable_activation_lock` ⚠️ destructive | Devices: write — disable Activation Lock WITHOUT wiping (`POST /devices/{id}/disable_activation_lock`; needs the API-key write scope) |
| `push_message` | Devices: write — send a message (max 225 chars) via the SimpleMDM mobile app (`POST /devices/{id}/push_message`) |
| `unenroll_device` ⚠️ destructive | Devices: write |
| `update_os` | Devices: write |
| `set_time_zone` | Devices: write |
| `enable_lost_mode` / `disable_lost_mode` | Devices: write |
| `play_lost_mode_sound` / `update_lost_mode_location` | Devices: write |
| `enable_remote_desktop` / `disable_remote_desktop` | Devices: write |
| `enable_bluetooth` / `disable_bluetooth` | Devices: write |
| `clear_passcode` ⚠️ destructive | Devices: write |
| `clear_restrictions_password` ⚠️ destructive | Devices: write |
| `clear_firmware_password` ⚠️ destructive / `rotate_firmware_password` | Devices: write |
| `clear_recovery_lock_password` ⚠️ destructive / `rotate_recovery_lock_password` | Devices: write |
| `rotate_filevault_recovery_key` | Devices: write |
| `rotate_admin_password` / `set_admin_password` | Devices: write |
| `refresh_cellular_plans` | Devices: write — refresh a device's cellular/eSIM plans from the carrier's eSIM server (requires `esim_server_url`) |

> **Notes on Device actions:**
> - `wipe_device` covers the full "advanced wipe" feature set (sometimes referenced as `wipe_device_advanced` in the SimpleMDM spec). All advanced parameters — `return_to_service`, `wifi_network_id`, `obliteration_behavior`, `preserve_managed_apps`, and the rest — are accepted by the single `wipe_device` tool; no separate advanced-wipe tool is needed.
> - **Disabling Activation Lock** can be done two ways: the standalone `disable_activation_lock` tool (`POST /devices/{id}/disable_activation_lock` — verified live 2026-07-06; requires the API key's write scope, 403 otherwise), or the `disable_activation_lock` *parameter* on `wipe_device` (cleared during a wipe). Use `get_activation_lock_status` to check current state.
> - **Sending a device message** IS available via `push_message` (`POST /devices/{id}/push_message`, max 225 chars, delivered through the SimpleMDM mobile app; verified live 2026-07-06). Only the previously guessed endpoint name `send_message` was wrong — hence the earlier removal and the 0.31.0 reinstatement.
> - **Safari Bookmarks**: SimpleMDM has no bookmarks-specific endpoint. Managed Safari bookmarks are an Apple **Declarative Device Management** configuration (`com.apple.configuration.safari.bookmarks`, iOS/macOS/visionOS **26+**). The `create_safari_bookmarks_declaration` tool builds that declaration from a simple `{title, url}` / nested-`folder` tree and delivers it via SimpleMDM's `/custom_declarations` API. Assign the resulting declaration to devices or groups to deploy.

**Device CRUD**
| Tool | API Permission |
|------|---------------|
| `create_device` | Devices: write |
| `update_device` | Devices: write |
| `delete_device` ⚠️ destructive | Devices: write |
| `delete_device_user` ⚠️ destructive | Devices: write |

**Apps**
| Tool | API Permission |
|------|---------------|
| `create_app` · `update_app` · `delete_app` ⚠️ destructive | Apps: write |
| `uninstall_app` | Apps: write |
| `update_installed_app` | Apps: write |
| `request_app_management` | Apps: write |
| `create_managed_app_config` · `delete_managed_app_config` ⚠️ destructive | Apps: write |
| `push_managed_app_configs` | Apps: write |
| `set_managed_app_config_schema` | Apps: write — Configure multiple options (diff and write) and push |

**Profiles**
| Tool | API Permission |
|------|---------------|
| `assign_profile_to_device` / `unassign_profile_from_device` | Profiles: write |
| `assign_custom_profile_to_device` / `unassign_custom_profile_from_device` | Profiles: write |
| `create_custom_configuration_profile` · `update_custom_configuration_profile` · `delete_custom_configuration_profile` ⚠️ destructive | Profiles: write |

**Declarations (DDM)**
| Tool | API Permission |
|------|---------------|
| `assign_declaration_to_device` / `unassign_declaration_from_device` | Profiles: write |
| `create_custom_declaration` · `update_custom_declaration` · `delete_custom_declaration` ⚠️ destructive | Profiles: write — `create`/`update` accept optional `declaration_type` plus JSON `payload` |
| `create_safari_bookmarks_declaration` | Profiles: write — push managed Safari bookmarks (DDM; iOS/macOS/visionOS 26+) |

**Assignment groups**
| Tool | API Permission |
|------|---------------|
| `create_assignment_group` · `update_assignment_group` · `delete_assignment_group` ⚠️ destructive | Assignment Groups: write |
| `clone_assignment_group` | Assignment Groups: write |
| `assign_device_to_group` / `unassign_device_from_group` | Assignment Groups: write |
| `assign_app_to_group` / `unassign_app_from_group` | Assignment Groups: write |
| `assign_profile_to_group` / `unassign_profile_from_group` | Assignment Groups: write |
| `update_apps_in_group` · `push_apps_to_group` · `sync_profiles_in_group` | Assignment Groups: write |

**Custom attributes**
| Tool | API Permission |
|------|---------------|
| `create_custom_attribute` · `update_custom_attribute` · `delete_custom_attribute` ⚠️ destructive | Attributes: write |
| `set_device_attribute_value` · `set_group_attribute_value` | Attributes: write |
| `set_attribute_for_multiple_devices` | Attributes: write |

**Scripts**
| Tool | API Permission |
|------|---------------|
| `create_script` · `update_script` · `delete_script` ⚠️ destructive | Scripts: write |
| `create_script_job` · `cancel_script_job` | Scripts: write |

**Enrollment & DEP**
| Tool | API Permission |
|------|---------------|
| `delete_enrollment` ⚠️ destructive | Enrollment: write |
| `send_enrollment_invitation` | Enrollment: write |
| `sync_dep_server` | Enrollment: write |

**Account**
| Tool | API Permission |
|------|---------------|
| `update_account` | Account: write |
