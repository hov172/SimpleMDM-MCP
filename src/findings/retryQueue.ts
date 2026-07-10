import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { munkiReportIngest } from "../munkiReportClient.js";

// Persistent on-disk retry queue for failed munkiReportIngest publish calls
// (docs/superpowers/specs/2026-07-10-findings-phase4-followups-design.md §2).
//
// Opt-in via MCP_FINDINGS_QUEUE_DIR -- unset means the queue is disabled entirely
// (the "best-effort, opt-in persistence" posture: most installs run ephemerally
// and don't need this). Read fresh on every call (not cached at module load),
// matching config.ts's convention so tests can mutate process.env between cases.
//
// Design choice on guarding: middleware.ts only calls enqueue() after already
// confirming config.queueDir is set, so in principle this module could just
// trust its caller. We guard anyway (enqueue/drainQueue both no-op cleanly when
// MCP_FINDINGS_QUEUE_DIR is unset) because (a) it's a one-line check, (b) it
// makes both functions safe to call directly -- e.g. from the future `findings
// retry` CLI subcommand -- without every caller having to re-check the env var
// first, and (c) a no-op-when-unset is a more defensible default for a queue
// module than silently writing to an undefined path.

export interface RetryQueuePayload {
  route: string;
  body: unknown;
}

export interface DrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

function getQueueDir(): string | null {
  const dir = process.env.MCP_FINDINGS_QUEUE_DIR;
  return dir && dir.trim() ? dir : null;
}

// Writes one JSON file per failed publish to `${dir}/<timestamp>-<uuid>.json`.
// Directory creation is lazy -- no pre-existing dir required. No-ops (does not
// throw) if MCP_FINDINGS_QUEUE_DIR isn't set.
export async function enqueue(payload: RetryQueuePayload): Promise<void> {
  const dir = getQueueDir();
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${randomUUID()}.json`;
  await fs.writeFile(path.join(dir, filename), JSON.stringify(payload), "utf8");
}

// Reads all queued files in chronological (filename-sorted) order, retries each
// via munkiReportIngest, deletes the file on success, leaves it in place on
// failure so a still-down MunkiReport doesn't lose anything. No-ops (returns all
// zero counts) if MCP_FINDINGS_QUEUE_DIR isn't set -- "nothing to retry".
export async function drainQueue(log: (msg: string) => void = () => {}): Promise<DrainResult> {
  const dir = getQueueDir();
  if (!dir) return { attempted: 0, succeeded: 0, failed: 0 };

  let filenames: string[];
  try {
    filenames = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    // Missing/unreadable dir means nothing is queued -- not an error condition.
    log(`[findings retry-queue] could not read queue dir ${dir}: ${(e as Error).message}`);
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  for (const filename of filenames) {
    const filePath = path.join(dir, filename);
    let payload: RetryQueuePayload;
    try {
      payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (e) {
      failed++;
      log(`[findings retry-queue] ${filename}: unreadable/corrupt, leaving in place: ${(e as Error).message}`);
      continue;
    }
    try {
      await munkiReportIngest(payload.route, payload.body);
      await fs.unlink(filePath);
      succeeded++;
      log(`[findings retry-queue] ${filename}: retried successfully`);
    } catch (e) {
      failed++;
      log(`[findings retry-queue] ${filename}: retry failed, leaving queued: ${(e as Error).message}`);
    }
  }

  return { attempted: filenames.length, succeeded, failed };
}
