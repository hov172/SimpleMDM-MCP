// src/deviceActions.ts
// Pure helpers for the new device-action tools (bulk actions, send message).
// Kept separate from index.ts so tests can import without booting the MCP
// server — same pattern as wipe.ts.

export interface BulkResult {
  results: Array<{ device_id: string; ok: boolean; error?: string }>;
  succeeded: number;
  failed: number;
}

// Run `fn` against each device id with bounded concurrency. Per-device errors
// are captured (not thrown) so one bad device does not abort the batch.
export async function runBulk(
  ids: string[],
  concurrency: number,
  fn: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
  const queue = [...ids];
  const results: BulkResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await fn(id);
        results.push({ device_id: id, ok: true });
        succeeded++;
      } catch (e) {
        results.push({ device_id: id, ok: false, error: e instanceof Error ? e.message : String(e) });
        failed++;
      }
    }
  };
  const conc = Math.max(1, Math.min(16, concurrency));
  await Promise.all(Array.from({ length: conc }, worker));
  return { results, succeeded, failed };
}

export function validateSendMessageArgs(args: Record<string, unknown>): void {
  const msg = args.message;
  if (typeof msg !== "string" || msg.trim() === "") {
    throw new Error("send message requires a non-empty message.");
  }
}

// NOTE: field names ("message", "title") are best-effort from the spec; confirm
// against live SimpleMDM API docs and update this body + its tests together.
export function buildSendMessageBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { message: args.message };
  if (typeof args.title === "string" && args.title !== "") body.title = args.title;
  return body;
}
