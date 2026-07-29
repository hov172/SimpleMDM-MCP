// Single-use confirm tokens for high/critical write tools. In-memory by
// design: stdio MCP runs one server per client session, so the token is
// issued and redeemed inside the same process. A restart just means the
// client re-requests a plan. See PRD v2 §1.3.

import { createHash, randomBytes } from "node:crypto";

type TokenRecord = { tool: string; argsHash: string; expiresAtMs: number };

const tokens = new Map<string, TokenRecord>();

// Deterministic JSON: objects get sorted keys at every depth so the same
// logical args always hash identically regardless of client key order.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalArgsHash(tool: string, args: Record<string, unknown>): string {
  const { confirm_token: _t, dry_run: _d, ...rest } = args;
  return createHash("sha256").update(`${tool}\n${stableStringify(rest)}`).digest("hex");
}

export function issueToken(
  tool: string, argsHash: string, ttlMs: number, now: number = Date.now(),
): { token: string; expires_at: string } {
  const token = randomBytes(16).toString("hex");
  const expiresAtMs = now + ttlMs;
  tokens.set(token, { tool, argsHash, expiresAtMs });
  return { token, expires_at: new Date(expiresAtMs).toISOString() };
}

export function redeemToken(
  token: string, tool: string, argsHash: string, now: number = Date.now(),
): { ok: true } | { ok: false; reason: "unknown" | "expired" | "mismatch" } {
  const rec = tokens.get(token);
  if (!rec) return { ok: false, reason: "unknown" };
  if (now > rec.expiresAtMs) { tokens.delete(token); return { ok: false, reason: "expired" }; }
  if (rec.tool !== tool || rec.argsHash !== argsHash) return { ok: false, reason: "mismatch" };
  tokens.delete(token);
  return { ok: true };
}

export function _clearTokensForTests(): void { tokens.clear(); }
