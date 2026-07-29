// JSONL write-audit log. One line per write-tool invocation (plan, dry_run,
// execute, blocked). Daily files (audit-YYYYMMDD.jsonl) keep retention a
// simple delete-old-files operation. Logging must never block or fail a tool
// call — writeAuditEntry degrades to a stderr warning on any error.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type AuditPhase = "plan" | "dry_run" | "execute" | "blocked";
export type AuditOutcome = "success" | "error" | "blocked";

export interface AuditEntry {
  ts: string;
  event_id: string;
  tool: string;
  tier: string;
  phase: AuditPhase;
  args: Record<string, unknown>;
  args_hash: string;
  token_id?: string;
  outcome: AuditOutcome;
  http_status?: number;
  error?: string;
  duration_ms?: number;
}

const SENSITIVE_KEY_FRAGMENTS = ["pin", "password", "passcode", "secret", "token", "key", "cookie", "auth"];

export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const lk = k.toLowerCase();
    out[k] = SENSITIVE_KEY_FRAGMENTS.some((f) => lk.includes(f)) ? "[REDACTED]" : v;
  }
  return out;
}

export function writeAuditEntry(dir: string, entry: AuditEntry): void {
  try {
    mkdirSync(dir, { recursive: true });
    const day = entry.ts.slice(0, 10).replace(/-/g, "");
    appendFileSync(join(dir, `audit-${day}.jsonl`), JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`[write-audit] failed to write audit entry: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readAuditEntries(
  dir: string,
  filters: { since?: string; tool?: string; tier?: string; phase?: string; outcome?: string; limit?: number } = {},
): AuditEntry[] {
  if (!existsSync(dir)) return [];
  const entries: AuditEntry[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^audit-\d{8}\.jsonl$/.test(f)) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line) as AuditEntry); } catch { /* skip corrupt line */ }
    }
  }
  const since = filters.since ? Date.parse(filters.since) : null;
  const filtered = entries.filter((e) =>
    (since === null || Date.parse(e.ts) >= since) &&
    (!filters.tool || e.tool === filters.tool) &&
    (!filters.tier || e.tier === filters.tier) &&
    (!filters.phase || e.phase === filters.phase) &&
    (!filters.outcome || e.outcome === filters.outcome)
  );
  filtered.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return filtered.slice(0, filters.limit ?? 100);
}
