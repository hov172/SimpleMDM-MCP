// Risk tiers for every write tool. Invariant-tested against WRITE_TOOLS in
// test/safety/tiers.test.mjs — adding a write tool without a tier fails the
// build. CONFIRM_TIERS members require a confirm token when confirm mode is on.
//
// low      — idempotent/trivially repeatable; no user-visible device change
// medium   — changes management state; reversible via another API call
// high     — user-visible device impact or security-state change
// critical — irreversible or destructive (superset source for destructiveHint)

export type RiskTier = "low" | "medium" | "high" | "critical";

export const WRITE_TIERS: Record<string, RiskTier> = {
  // ── low: syncs, refreshes, pushes with no state change ──────────────────
  sync_device: "low",
  refresh_device_inventory: "low",
  refresh_cellular_plans: "low",
  sync_dep_server: "low",
  request_munkireport_sync: "low",
  refresh_munkireport_supplemental: "low",
  push_munkireport_findings: "low",
  push_message: "low",
  play_lost_mode_sound: "low",

  // ── medium: management-state changes, reversible via another call ───────
  update_account: "medium",
  create_device: "medium",
  update_device: "medium",
  update_lost_mode_location: "medium",
  set_time_zone: "medium",
  enable_bluetooth: "medium",
  disable_bluetooth: "medium",
  create_assignment_group: "medium",
  update_assignment_group: "medium",
  assign_device_to_group: "medium",
  unassign_device_from_group: "medium",
  assign_app_to_group: "medium",
  unassign_app_from_group: "medium",
  assign_profile_to_group: "medium",
  unassign_profile_from_group: "medium",
  push_apps_to_group: "medium",
  update_apps_in_group: "medium",
  sync_profiles_in_group: "medium",
  clone_assignment_group: "medium",
  create_app: "medium",
  update_app: "medium",
  request_app_management: "medium",
  update_installed_app: "medium",
  create_custom_attribute: "medium",
  update_custom_attribute: "medium",
  set_device_attribute_value: "medium",
  set_attribute_for_multiple_devices: "medium",
  set_group_attribute_value: "medium",
  create_custom_configuration_profile: "medium",
  update_custom_configuration_profile: "medium",
  assign_custom_profile_to_device: "medium",
  unassign_custom_profile_from_device: "medium",
  create_custom_declaration: "medium",
  update_custom_declaration: "medium",
  create_safari_bookmarks_declaration: "medium",
  assign_declaration_to_device: "medium",
  unassign_declaration_from_device: "medium",
  assign_profile_to_device: "medium",
  unassign_profile_from_device: "medium",
  send_enrollment_invitation: "medium",
  create_managed_app_config: "medium",
  push_managed_app_configs: "medium",
  set_managed_app_config_schema: "medium",
  create_script: "medium",
  update_script: "medium",
  cancel_script_job: "medium",

  // ── high: user-visible device impact or security-state change ───────────
  lock_device: "high",
  restart_device: "high",
  shutdown_device: "high",
  update_os: "high",
  enable_lost_mode: "high",
  disable_lost_mode: "high",
  rotate_firmware_password: "high",
  rotate_recovery_lock_password: "high",
  rotate_filevault_recovery_key: "high",
  set_admin_password: "high",
  rotate_admin_password: "high",
  enable_remote_desktop: "high",
  disable_remote_desktop: "high",
  uninstall_app: "high",
  create_script_job: "high",

  // ── critical: irreversible/destructive (== legacy DESTRUCTIVE set) ──────
  wipe_device: "critical",
  disable_activation_lock: "critical",
  unenroll_device: "critical",
  delete_device: "critical",
  delete_device_user: "critical",
  delete_app: "critical",
  delete_assignment_group: "critical",
  delete_custom_attribute: "critical",
  delete_custom_configuration_profile: "critical",
  delete_custom_declaration: "critical",
  delete_enrollment: "critical",
  delete_managed_app_config: "critical",
  delete_script: "critical",
  clear_passcode: "critical",
  clear_restrictions_password: "critical",
  clear_firmware_password: "critical",
  clear_recovery_lock_password: "critical",
};

export const CONFIRM_TIERS: ReadonlySet<RiskTier> = new Set(["high", "critical"]);
