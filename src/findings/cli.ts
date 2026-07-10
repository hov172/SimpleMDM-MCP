import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadFindingsConfig } from "./config.js";
import { drainQueue } from "./retryQueue.js";
import { TOOL_MANIFEST } from "./toolManifest.js";
import { findingsFromAdapters } from "./middleware.js";

// `simplemdm-mcp findings *` CLI subcommand family (PRD §12.3), implementing
// docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md §3.
//
// Deliberately NOT building a `findings publish` command — see the design doc's
// "Explicitly NOT building" note: `audit --publish` already covers the only tool
// type with a full audit-to-findings pipeline, and there's no cached tool-result
// data source to publish an arbitrary tool's last result from.

export type FindingsSubcommand = "status" | "retry" | "dry-run" | "validate";

// Parses the queue dir's `<timestamp>-<uuid>.json` filenames (written by
// retryQueue.ts's enqueue()) to find the oldest queued entry, without needing
// to stat every file's mtime. Falls back to null if nothing parses (e.g. the
// dir is empty, or contains files that don't match the expected shape).
function oldestQueuedTimestamp(filenames: string[]): Date | null {
  let oldest: number | null = null;
  for (const name of filenames) {
    const m = name.match(/^(\d+)-/);
    if (!m) continue;
    const ts = Number(m[1]);
    if (!Number.isFinite(ts)) continue;
    if (oldest === null || ts < oldest) oldest = ts;
  }
  return oldest === null ? null : new Date(oldest);
}

export async function findingsStatus(log: (msg: string) => void): Promise<void> {
  const config = loadFindingsConfig();
  log("findings status:");
  log(`  enabled:          ${config.enabled}`);
  log(`  mode:             ${config.mode}`);
  log(`  minSeverity:      ${config.minSeverity}`);
  log(`  inventoryOptIn:   ${config.inventoryOptIn.size ? [...config.inventoryOptIn].join(", ") : "(none)"}`);
  log(`  queueDir:         ${config.queueDir ?? "(unset — retry queue disabled)"}`);

  if (!config.queueDir) return;

  let filenames: string[];
  try {
    filenames = (await fs.readdir(config.queueDir)).filter((f) => f.endsWith(".json"));
  } catch {
    log(`  queued files:     0 (queue dir does not exist yet)`);
    return;
  }
  log(`  queued files:     ${filenames.length}`);
  const oldest = oldestQueuedTimestamp(filenames);
  if (oldest) log(`  oldest queued:    ${oldest.toISOString()}`);
}

export async function findingsRetry(log: (msg: string) => void): Promise<void> {
  const config = loadFindingsConfig();
  if (!config.queueDir) {
    log("findings retry: nothing to retry, MCP_FINDINGS_QUEUE_DIR is not set");
    return;
  }
  const result = await drainQueue(log);
  log(`findings retry: attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`);
}

export async function findingsDryRun(toolName: string | undefined, fixturePath: string | null, log: (msg: string) => void): Promise<void> {
  if (!toolName) {
    throw new Error("Usage: findings dry-run <tool_name> --fixture <path-to-json>");
  }
  const entry = TOOL_MANIFEST[toolName];
  if (!entry) {
    throw new Error(`findings dry-run: unknown tool "${toolName}" (no manifest entry)`);
  }
  if (!entry.adapters?.length) {
    throw new Error(`findings dry-run: "${toolName}" has no findings adapters wired (toolType: ${entry.toolType})`);
  }
  if (!fixturePath) {
    throw new Error("findings dry-run: --fixture <path-to-json> is required");
  }

  let raw: string;
  try {
    raw = await fs.readFile(fixturePath, "utf8");
  } catch (e) {
    throw new Error(`findings dry-run: could not read fixture "${fixturePath}": ${(e as Error).message}`);
  }
  let fixture: unknown;
  try {
    fixture = JSON.parse(raw);
  } catch (e) {
    throw new Error(`findings dry-run: fixture "${fixturePath}" is not valid JSON: ${(e as Error).message}`);
  }

  const config = loadFindingsConfig();
  const findings = findingsFromAdapters(entry.adapters, fixture, config.minSeverity);

  log(`findings dry-run: ${toolName} (fixture: ${fixturePath})`);
  if (findings.length === 0) {
    log(`  would publish 0 finding(s)`);
    return;
  }
  log(`  would publish ${findings.length} finding(s):`);
  for (const f of findings) {
    const serial = f.serial_number ? ` [${f.serial_number}]` : "";
    log(`    - ${f.finding_type} (${f.severity})${serial}: ${f.message}`);
  }
}

export interface ManifestDrift {
  missing: string[]; // registered tools with no manifest entry
  stale: string[]; // manifest entries for tools no longer registered
}

// Same completeness check as test/toolManifest.test.mjs's "every registered tool
// has exactly one manifest entry" test, factored out so both the test and the
// `findings validate` CLI subcommand share one implementation.
export function computeManifestDrift(registeredToolNames: string[], manifest: Record<string, unknown>): ManifestDrift {
  const registered = new Set(registeredToolNames);
  const manifested = new Set(Object.keys(manifest));
  const missing = [...registered].filter((n) => !manifested.has(n)).sort();
  const stale = [...manifested].filter((n) => !registered.has(n)).sort();
  return { missing, stale };
}

// Returns true if drift was found (caller uses this to decide exit code).
export function findingsValidate(registeredToolNames: string[], log: (msg: string) => void): boolean {
  const drift = computeManifestDrift(registeredToolNames, TOOL_MANIFEST);
  if (drift.missing.length === 0 && drift.stale.length === 0) {
    log(`findings validate: manifest is in sync (${registeredToolNames.length} tools, ${Object.keys(TOOL_MANIFEST).length} manifest entries)`);
    return false;
  }
  log("findings validate: manifest drift detected");
  if (drift.missing.length) {
    log(`  missing manifest entries (${drift.missing.length}):`);
    for (const n of drift.missing) log(`    - ${n}`);
  }
  if (drift.stale.length) {
    log(`  stale manifest entries for tools no longer registered (${drift.stale.length}):`);
    for (const n of drift.stale) log(`    - ${n}`);
  }
  return true;
}

// `argv` is everything AFTER "findings", i.e. argv[0] is the sub-subcommand
// (status|retry|dry-run|validate) and argv[1..] are its own flags.
export async function runFindingsCli(argv: string[], log: (msg: string) => void): Promise<void> {
  const sub = argv[0];
  switch (sub) {
    case "status":
      return findingsStatus(log);
    case "retry":
      return findingsRetry(log);
    case "dry-run": {
      const toolName = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
      const fixtureIdx = argv.findIndex((a) => a === "--fixture");
      const fixturePath = fixtureIdx >= 0 ? argv[fixtureIdx + 1] ?? null : null;
      await findingsDryRun(toolName, fixturePath, log);
      return;
    }
    case "validate": {
      // src/index.ts auto-starts the MCP stdio server on import unless
      // SIMPLEMDM_TEST_MODE=true (see its bottom-of-file guard) — force it here so
      // `findings validate` never spins up a stdio listener as a side effect of
      // reading TOOLS. This process is one-shot (CLI invocation), so there's no
      // need to restore the prior value afterward.
      process.env.SIMPLEMDM_TEST_MODE = "true";
      const { TOOLS } = await import("../index.js");
      const drifted = findingsValidate((TOOLS as { name: string }[]).map((t) => t.name), log);
      if (drifted) throw new Error("findings validate: manifest drift detected (see above)");
      return;
    }
    default:
      throw new Error(
        `Usage: simplemdm-mcp findings <status|retry|dry-run|validate> [flags]`,
      );
  }
}
