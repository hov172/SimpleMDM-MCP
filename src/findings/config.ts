export type PublishMode = "auto" | "manual" | "disabled" | "dry_run";
export type Severity = "danger" | "warning" | "info";

export interface FindingsConfig {
  enabled: boolean;
  mode: PublishMode;
  minSeverity: Severity;
  // Comma-separated MCP_PUBLISH_INVENTORY_TOOLS allowlist (default: empty set = none
  // opted in). Inventory tools are PRD-classified "Optional, off by default" -- even
  // when MCP_PUBLISH_MODE=auto and a tool has a real adapter wired, an inventory-type
  // tool only auto-publishes if its name is in this set. Non-inventory tool types are
  // unaffected by this set.
  inventoryOptIn: Set<string>;
  // MCP_FINDINGS_QUEUE_DIR -- null (unset) means the on-disk retry queue is
  // disabled entirely, matching retryQueue.ts's "opt-in persistence" posture.
  queueDir: string | null;
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

  const inventoryOptIn = new Set(
    (process.env.MCP_PUBLISH_INVENTORY_TOOLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const rawQueueDir = process.env.MCP_FINDINGS_QUEUE_DIR;
  const queueDir = rawQueueDir && rawQueueDir.trim() ? rawQueueDir : null;

  return { enabled, mode, minSeverity, inventoryOptIn, queueDir };
}
