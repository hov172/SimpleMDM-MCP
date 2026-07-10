export type PublishMode = "auto" | "manual" | "disabled" | "dry_run";
export type Severity = "danger" | "warning" | "info";

export interface FindingsConfig {
  enabled: boolean;
  mode: PublishMode;
  minSeverity: Severity;
}

const VALID_MODES: readonly PublishMode[] = ["auto", "manual", "disabled", "dry_run"];
const VALID_SEVERITIES: readonly Severity[] = ["danger", "warning", "info"];

// Read fresh on every call (not cached at module load) so tests can mutate
// process.env between cases without needing a reset hook.
export function loadFindingsConfig(): FindingsConfig {
  const enabled = process.env.MUNKIREPORT_ENABLED === "true";

  const rawMode = (process.env.MCP_PUBLISH_MODE ?? "manual").toLowerCase();
  const mode: PublishMode = (VALID_MODES as readonly string[]).includes(rawMode) ? (rawMode as PublishMode) : "manual";

  const rawSeverity = (process.env.MCP_PUBLISH_MIN_SEVERITY ?? "warning").toLowerCase();
  const minSeverity: Severity = (VALID_SEVERITIES as readonly string[]).includes(rawSeverity) ? (rawSeverity as Severity) : "warning";

  return { enabled, mode, minSeverity };
}
