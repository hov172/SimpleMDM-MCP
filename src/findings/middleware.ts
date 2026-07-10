import { TOOL_MANIFEST } from "./toolManifest.js";
import type { ToolFindingAdapter } from "./toolManifest.js";
import type { McpFinding } from "../reports/domain/findings-map.js";
import { munkiReportIngest } from "../munkiReportClient.js";
import { loadFindingsConfig } from "./config.js";
import { enqueue } from "./retryQueue.js";

const SEVERITY_RANK: Record<"danger" | "warning" | "info", number> = { danger: 3, warning: 2, info: 1 };

function resolveField(result: unknown, field: string): unknown {
  if (field === "") return result;
  if (result == null || typeof result !== "object") return undefined;
  return (result as Record<string, unknown>)[field];
}

function rowsFromAdapter(result: unknown, adapter: ToolFindingAdapter): Record<string, unknown>[] {
  const value = resolveField(result, adapter.resultField);
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function substituteTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, field) => {
    const v = row[field];
    if (Array.isArray(v)) return v.join(", ");
    if (v === null || v === undefined) return "";
    return String(v);
  });
}

// Runs after a tool call has already produced its return value. Never throws --
// every failure path is caught internally so a publish problem can never turn a
// successful MCP tool response into an error, per the PRD's best-effort rule.
export async function afterToolCall(
  toolName: string,
  result: unknown,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const config = loadFindingsConfig();
  if (!config.enabled) return;
  if (config.mode === "disabled" || config.mode === "manual") return;

  const entry = TOOL_MANIFEST[toolName];
  if (!entry || !entry.publishable || !entry.supportsAutoPublish || !entry.adapters?.length) return;

  // Inventory tools are PRD-classified "Optional, off by default" -- MCP_PUBLISH_MODE=auto
  // alone must not start publishing this category. An inventory-type tool is only eligible
  // once its name is explicitly opted in via MCP_PUBLISH_INVENTORY_TOOLS. Non-inventory tool
  // types are unaffected -- this check is scoped to toolType === "inventory" only.
  if (entry.toolType === "inventory" && !config.inventoryOptIn.has(toolName)) return;

  const findings: McpFinding[] = [];
  for (const adapter of entry.adapters) {
    if (SEVERITY_RANK[adapter.severity] < SEVERITY_RANK[config.minSeverity]) continue;
    for (const row of rowsFromAdapter(result, adapter)) {
      if (adapter.conditionField) {
        const v = row[adapter.conditionField];
        if (adapter.conditionValues) {
          if (typeof v !== "string" || !adapter.conditionValues.includes(v)) continue;
        } else if (!v) {
          continue;
        }
      }
      const finding: McpFinding = {
        finding_type: adapter.findingType,
        category: adapter.category,
        severity: adapter.severity,
        message: substituteTemplate(adapter.messageTemplate, row),
      };
      if (adapter.serialField) {
        const serial = row[adapter.serialField];
        if (typeof serial === "string" && serial) finding.serial_number = serial;
      }
      findings.push(finding);
    }
  }

  if (findings.length === 0) return;

  if (config.mode === "dry_run") {
    const byCategory: Record<string, number> = {};
    for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    log(`[findings dry-run] ${toolName}: would publish ${findings.length} finding(s): ${JSON.stringify(byCategory)}`);
    return;
  }

  const ingestBody = {
    // replace:true reflects current state WITHIN this tool's own source namespace
    // (mcp_auto_<toolName>) -- cross-tool/manual-run isolation is already fully
    // provided by every tool having its own distinct source string, so replace
    // here cannot auto-resolve a different tool's or a manual run's findings.
    // Without this, repeated interactive calls to the same tool would each add a
    // fresh finding set under a new scan_id and never resolve stale ones (a
    // previously-flagged device that's since fixed would stay "open" forever).
    source: `mcp_auto_${toolName}`,
    scan_id: `mcp_auto_${toolName}_${Date.now()}`,
    replace: true,
    findings,
  };

  try {
    await munkiReportIngest("/ingest_mcp_findings", ingestBody);
    log(`[findings auto-publish] ${toolName}: published ${findings.length} finding(s)`);
  } catch (e) {
    log(`[findings auto-publish] ${toolName}: publish failed, tool response unaffected: ${(e as Error).message}`);
    // Best-effort durable retry queue (opt-in via MCP_FINDINGS_QUEUE_DIR) -- see
    // docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md §2.
    // Additive only: when queueDir is unset this is a no-op and behavior is
    // exactly the log-and-drop it's always been.
    if (config.queueDir) {
      try {
        await enqueue({ route: "/ingest_mcp_findings", body: ingestBody });
      } catch (queueErr) {
        log(`[findings auto-publish] ${toolName}: failed to enqueue for retry: ${(queueErr as Error).message}`);
      }
    }
  }
}
