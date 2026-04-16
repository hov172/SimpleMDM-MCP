// src/wipe.ts
// Pure helpers for the wipe_device tool. Kept separate from index.ts so
// tests can import without triggering the MCP server bootstrap in main().

export function validateWipeArgs(args: Record<string, unknown>): void {
  if (args.return_to_service === true && !args.wifi_network_id) {
    throw new Error(
      "return_to_service=true requires wifi_network_id (id of a WiFi profile assigned to the device)."
    );
  }
}

export function buildWipeBody(args: Record<string, unknown>): Record<string, unknown> {
  return {
    pin: args.pin,
    preserve_data_plan: args.preserve_data_plan,
    disable_activation_lock: args.disable_activation_lock,
    disallow_proximity_setup: args.disallow_proximity_setup,
    return_to_service: args.return_to_service,
    wifi_network_id: args.wifi_network_id,
    obliteration_behavior: args.obliteration_behavior,
    clear_custom_attributes: args.clear_custom_attributes,
    unassign_direct_profiles: args.unassign_direct_profiles,
  };
}
