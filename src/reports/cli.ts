import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WriteResult } from "./engine/dossier.js";
import type { Format } from "./engine/csv.js";
import { REGISTRY } from "./specs/registry.js";
import { writeReportExtras } from "./engine/extras.js";
import type { LegacySelector, Ctx } from "./cli/inputs.js";
import { loadEnvKey } from "./cli/inputs.js";
import { munkiReportIngest } from "../munkiReportClient.js";
import { evaluatedDeviceToFindings } from "./domain/findings-map.js";
import { runFindingsCli } from "../findings/cli.js";

// Human-readable scope label for the report header (e.g. "--all", "--serial C02…",
// "search (whole fleet)"). Mirrors the legacy inventory header wording.
export function scopeLabelOf(scope: LegacySelector, search?: string | null): string {
  const sel = !scope ? "whole fleet"
    : scope.kind === "all" ? "--all"
    : scope.kind === "serial" ? `--serial ${(scope.value as string[]).join(",")}`
    : scope.kind === "group" ? `--group ${scope.value}`
    : `--last-seen ${scope.value}`;
  if (search) return scope ? `search (${sel})` : "search (whole fleet)";
  return sel;
}

function defaultOutDir(report: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `reports/${report}-${date}-${time}`;
}

export interface CliDeps {
  fetchInput?: (report: string, scope: LegacySelector, ctx: Ctx) => Promise<any>;
  // Sink for human-readable progress lines. Defaults to stderr (console.error) so
  // runReport is safe to call from the MCP stdio transport, where stdout is the
  // JSON-RPC channel. The CLI overrides this with console.log to keep its stdout UX.
  log?: (msg: string) => void;
}

// ── RunReport: post-parse core shared by CLI and the MCP tool ─────────────────

export interface RunReportOpts {
  report: string;
  scope: LegacySelector;
  format: Format;
  reportOnly?: boolean;
  outDir: string;
  // inventory-specific opts
  noApps?: boolean;
  noProfiles?: boolean;
  noUsers?: boolean;
  allowPartial?: boolean;
  reportDetail?: string;
  reportStyle?: "flat" | "roster" | undefined;
  sort?: { field: string; dir: string } | null;
  search?: string | null;
  raw?: boolean;
  // logs-specific opts
  withSecurity?: boolean;
  withInventory?: boolean;
  findingsExclude?: string[];
  // global opts
  noNetworkCache?: boolean;
  // audit-specific: PDF/HTML page size ("a3-landscape" roomy default | "a4-landscape" compact)
  pageStyle?: "a3-landscape" | "a4-landscape";
  // audit-specific: push derived findings to MunkiReport after the dossier writes
  publish?: boolean;
  scanId?: string;
}

export async function runReport(opts: RunReportOpts, deps?: CliDeps): Promise<WriteResult> {
  // Default to stderr: stdout is the MCP JSON-RPC channel and must stay clean.
  const log = deps?.log ?? console.error;
  const entry = REGISTRY[opts.report];
  if (!entry) {
    throw new Error(
      `Unknown report "${opts.report}". Valid reports: ${Object.keys(REGISTRY).join(", ")}`,
    );
  }

  const apiKey = loadEnvKey() ?? "";
  const ctx: Ctx = { apiKey, noNetworkCache: opts.noNetworkCache };

  const entryOpts = {
    noApps: opts.noApps,
    noProfiles: opts.noProfiles,
    noUsers: opts.noUsers,
    allowPartial: opts.allowPartial,
    reportDetail: opts.reportDetail,
    reportStyle: opts.reportStyle,
    sort: opts.sort ?? null,
    search: opts.search ?? null,
    raw: opts.raw,
    withSecurity: opts.withSecurity,
    withInventory: opts.withInventory,
    pageStyle: opts.pageStyle,
  };

  const fetchFn = deps?.fetchInput ?? ((_rep: string, sc: LegacySelector, c: Ctx) => entry.buildInput(sc, c, entryOpts));
  const rawInput = await fetchFn(opts.report, opts.scope, ctx);

  // ── Apply --search filter for inventory (post-fetch bridge) ───────────────
  let input = rawInput;
  if (opts.report === "inventory" && opts.search) {
    const { parseQuery, evaluate } = await import("./domain/query.js");
    const ast = parseQuery(opts.search);
    for (const w of ast.warnings) log(`Warning: ${w}`);
    const now = Date.now();
    const kept = (rawInput.records as any[]).filter((r: any) => {
      const res = evaluate(ast, r, { now });
      r.match_reasons = res.reasons.join("; ");
      r.match_status = res.matched === true ? "matched" : res.matched === "unknown" ? "unknown" : "no";
      r.hits = res.hits;
      return res.matched === true || res.matched === "unknown";
    });
    const { inventoryFindings } = await import("./domain/inventory-render.js");
    const findings = inventoryFindings(kept);
    input = { ...rawInput, records: kept, findings, queryWarnings: ast.warnings };
  }

  // Thread the human scope label into the dossier header (account is fetched in the
  // live input builders). Both are consumed by the report renderers' header block.
  if (input && typeof input === "object") {
    input.scopeLabel = scopeLabelOf(opts.scope, opts.search);
  }

  // --findings-exclude: drop named finding types (noise control), disclosing the
  // excluded counts in summary.txt rather than silently shrinking the report.
  if (opts.findingsExclude?.length && Array.isArray(input.findings)) {
    const excluded = new Set(opts.findingsExclude);
    const counts = new Map<string, number>();
    for (const f of input.findings as any[]) {
      if (excluded.has(f.type)) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    }
    input.findings = (input.findings as any[]).filter((f) => !excluded.has(f.type));
    input.findingsExcluded = [...counts].map(([type, count]) => ({ type, count }));
  }

  const dossier = entry.build(input, entryOpts);
  mkdirSync(opts.outDir, { recursive: true });
  const result = await dossier.write(opts.outDir, { format: opts.format, reportOnly: opts.reportOnly, ...entry.writeOpts });

  // Audit-only: derive per-check findings from the same typed evaluation data
  // the dossier just rendered from, and push them to MunkiReport. Never lets a
  // publish failure take down report generation — the files above are already
  // on disk and are the primary deliverable.
  if (opts.report === "audit" && opts.publish) {
    const ev = (input as { ev?: unknown }).ev;
    const findings = Array.isArray(ev) ? (ev as Parameters<typeof evaluatedDeviceToFindings>[0][]).flatMap(evaluatedDeviceToFindings) : [];
    const scanId = opts.scanId ?? `scan_mcp_audit_${opts.outDir.match(/(\d{8}-\d{6})/)?.[1] ?? Date.now()}`;
    if (findings.length === 0) {
      log("publish: no findings to push (fleet is clean)");
    } else {
      try {
        await munkiReportIngest("/ingest_mcp_findings", { source: "sofa_audit", scan_id: scanId, replace: true, findings });
        log(`publish: pushed ${findings.length} finding(s) to MunkiReport as scan_id ${scanId}`);
      } catch (e) {
        log(`publish failed: ${(e as Error).message} — report files were still written to ${opts.outDir}`);
      }
    }
  }

  // Write summary.txt if the registry entry provides a summaryText function
  if (entry.summaryText) {
    const summaryOpts = { ...entryOpts, scope: opts.scope, search: opts.search, outDir: opts.outDir };
    writeFileSync(join(opts.outDir, "summary.txt"), entry.summaryText(input, summaryOpts));
  }

  // Always-on bundle artifacts (manifest.sha256, report-table.xlsx, <dir>.zip) on the
  // full-output format. Best-effort; runs after every deliverable is on disk.
  if (opts.format === "all") {
    const extras = writeReportExtras(opts.outDir);
    result.files.push(...extras.files.map((f) => ({ name: f.name, description: f.description, rows: null, sha256: "" })));
    result.skipped.push(...extras.skipped);
  }

  // Surface partial-fetch failures (mirrors legacy --allow-partial / exit-2 behavior)
  const partial = !opts.allowPartial && Boolean((input.failures as any[] | undefined)?.length);
  if (partial) {
    console.warn(
      `${opts.report}: ${(input.failures as any[]).length} per-device fetch(es) failed` +
      ` (use --allow-partial to suppress this warning)`,
    );
  }
  result.partial = partial;

  for (const f of result.files) log(`  ${f.name}`);
  log(`Output: ${opts.outDir}`);
  log("Output is local-only (reports/ is gitignored) and NOT committed.");

  return result;
}

export async function runCli(argv: string[], deps?: CliDeps): Promise<WriteResult> {
  const reportName = argv[0];
  if (!reportName || reportName.startsWith("--")) {
    throw new Error(
      "Usage: node dist/reports/cli.js <report> [flags]  (report: audit|inventory|logs)  |  diff <beforeDir> <afterDir>  |  findings <status|retry|dry-run|validate>",
    );
  }

  // `diff <beforeDir> <afterDir>` — compare two inventory run directories.
  // Purely local; writes diff-vs-<before>.md into the after directory.
  if (reportName === "diff") {
    const [dirBefore, dirAfter] = [argv[1], argv[2]];
    if (!dirBefore || !dirAfter) throw new Error("Usage: diff <beforeDir> <afterDir>");
    const { diffInventoryRuns, renderDiffMarkdown } = await import("./domain/diff.js");
    const { basename } = await import("node:path");
    const d = diffInventoryRuns(dirBefore, dirAfter);
    const md = renderDiffMarkdown(d, dirBefore, dirAfter);
    const name = `diff-vs-${basename(dirBefore)}.md`;
    writeFileSync(join(dirAfter, name), md);
    console.log(`Devices: +${d.devicesAdded.length} -${d.devicesRemoved.length} ~${d.changed.length} changed · Findings: +${d.findingsNew.length} new, ${d.findingsResolved.length} resolved`);
    console.log(`  ${name}`);
    return {
      outDir: dirAfter,
      files: [{ name, description: "Inventory diff report", rows: null, sha256: "" }],
      manifestSha256: "",
      skipped: [],
      partial: false,
    };
  }
  // `findings <status|retry|dry-run|validate>` — operational subcommands for the
  // findings-publishing middleware (docs/superpowers/specs/2026-07-10-findings-
  // phase4-followups-design.md §3). Not a WriteResult-producing report — handled
  // entirely in src/findings/cli.ts and returned as a stub WriteResult here,
  // following the same early-return pattern the `diff` branch above established.
  if (reportName === "findings") {
    const log = deps?.log ?? console.log;
    await runFindingsCli(argv.slice(1), log);
    return {
      outDir: "",
      files: [],
      manifestSha256: "",
      skipped: [],
      partial: false,
    };
  }

  const entry = REGISTRY[reportName];
  if (!entry) {
    throw new Error(
      `Unknown report "${reportName}". Valid reports: ${Object.keys(REGISTRY).join(", ")}`,
    );
  }

  const flags = argv.slice(1);

  // Track which argv positions are VALUES (the token after a value-taking flag).
  // Without this, a value spelled like a flag — e.g. --search "--confirm-all" —
  // satisfies has("--confirm-all") and bypasses the whole-fleet guard.
  const VALUE_FLAGS = new Set([
    "--serial", "--group", "--last-seen", "--format", "--out", "--report-detail",
    "--search", "--report-style", "--sort", "--page-size", "--findings-exclude", "--scan-id",
  ]);
  const valuePos = new Set<number>();
  for (let i = 0; i < flags.length; i++) {
    if (valuePos.has(i)) continue;
    if (VALUE_FLAGS.has(flags[i]) && i + 1 < flags.length) valuePos.add(i + 1);
  }
  const val = (name: string): string | null => {
    const i = flags.findIndex((f, idx) => f === name && !valuePos.has(idx));
    return i >= 0 && i + 1 < flags.length ? flags[i + 1] : null;
  };
  const has = (name: string): boolean => flags.some((f, idx) => f === name && !valuePos.has(idx));

  // ── Per-report flag validation ────────────────────────────────────────────────
  // Define allowed flags per report
  const COMMON_FLAGS = new Set([
    "--serial", "--group", "--last-seen", "--all", "--confirm-all",
    "--format", "--out", "--report-only",
    "--report-detail", "--no-network-cache",
  ]);
  const INVENTORY_ONLY_FLAGS = new Set([
    "--search", "--no-apps", "--no-profiles", "--no-users",
    "--report-style", "--sort", "--raw", "--findings-exclude", "--allow-partial",
  ]);
  const LOGS_ONLY_FLAGS = new Set([
    "--with-security", "--with-inventory", "--allow-partial",
  ]);
  const AUDIT_ONLY_FLAGS = new Set([
    "--page-size", "--publish", "--scan-id",
  ]);

  // Build the set of allowed flags for this report
  const allowedForReport = new Set([...COMMON_FLAGS]);
  if (reportName === "inventory") {
    INVENTORY_ONLY_FLAGS.forEach((f) => allowedForReport.add(f));
  }
  if (reportName === "logs") {
    LOGS_ONLY_FLAGS.forEach((f) => allowedForReport.add(f));
  }
  if (reportName === "audit") {
    AUDIT_ONLY_FLAGS.forEach((f) => allowedForReport.add(f));
  }

  // Validate flags: must be either known and allowed for this report, or rejected
  // with guidance. Value positions are data, not flags — skip them.
  for (const [i, f] of flags.entries()) {
    if (valuePos.has(i)) continue;
    if (f.startsWith("--")) {
      if (!allowedForReport.has(f)) {
        if (INVENTORY_ONLY_FLAGS.has(f)) {
          throw new Error(`${f} is only supported for the inventory report`);
        } else if (LOGS_ONLY_FLAGS.has(f)) {
          throw new Error(`${f} is only supported for the logs report`);
        } else if (AUDIT_ONLY_FLAGS.has(f)) {
          throw new Error(`${f} is only supported for the audit report`);
        } else {
          throw new Error(`unknown flag: ${f}`);
        }
      }
    }
  }


  // ── Scope selectors ────────────────────────────────────────────────────────
  const selectorArgs: LegacySelector[] = [];
  if (val("--serial") !== null) {
    const v = (val("--serial") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!v.length) throw new Error("--serial requires at least one serial number");
    selectorArgs.push({ kind: "serial", value: v });
  }
  if (val("--group") !== null) {
    const v = val("--group") ?? "";
    if (!v) throw new Error("--group requires a group name");
    selectorArgs.push({ kind: "group", value: v });
  }
  if (val("--last-seen") !== null) {
    const v = parseInt(val("--last-seen") ?? "", 10);
    if (!Number.isInteger(v) || v < 1) throw new Error("--last-seen requires a positive integer");
    selectorArgs.push({ kind: "last-seen", value: v });
  }
  if (has("--all")) {
    if (!has("--confirm-all")) {
      throw new Error(
        "--all fetches data for every device in the fleet; add --confirm-all to proceed",
      );
    }
    selectorArgs.push({ kind: "all", value: true });
  }
  if (selectorArgs.length > 1) {
    throw new Error("Use at most one selector: --serial | --group | --last-seen | --all");
  }
  const scope: LegacySelector = selectorArgs[0] ?? null;

  // ── §8 Fleet-wide-search confirm guard ────────────────────────────────────
  // inventory --search with no selector and no device-scoped prefilter fetches per-device
  // data for the whole fleet — same guard as legacy inventory-report.mjs:76-81
  if (reportName === "inventory" && scope === null && val("--search") !== null && !has("--confirm-all")) {
    const { parseQuery, planQuery } = await import("./domain/query.js");
    const ast = parseQuery(val("--search") as string);
    const { deviceUnits } = planQuery(ast);
    if (deviceUnits.length === 0) {
      throw new Error(
        "--search with no selector and no device-scoped prefilter fetches per-device data for the whole fleet; add --confirm-all to proceed",
      );
    }
  }

  // ── Format ─────────────────────────────────────────────────────────────────
  const formatArg = val("--format") ?? entry.defaultFormat;
  if (!["csv", "md", "docx", "all"].includes(formatArg)) {
    throw new Error(`Invalid --format "${formatArg}" (csv|md|docx|all)`);
  }
  const format = formatArg as Format;

  const reportOnly = has("--report-only");
  const outDir = val("--out") ?? defaultOutDir(reportName);

  // ── Report-specific flags ──────────────────────────────────────────────────
  // Inventory: wired
  const searchQuery = val("--search");
  const noApps = has("--no-apps");
  const noProfiles = has("--no-profiles");
  const noUsers = has("--no-users");
  const allowPartial = has("--allow-partial");
  const findingsExclude = (val("--findings-exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reportDetailRaw = val("--report-detail");
  const reportStyleRaw = val("--report-style");
  const sortRaw = val("--sort");
  // Inventory-only: --raw; Logs-only: --with-security, --with-inventory
  const raw = has("--raw");
  const withSecurity = has("--with-security");
  const withInventory = has("--with-inventory");
  const noNetworkCache = has("--no-network-cache");
  // Audit-only: --page-size a3|a4 (accepts the long form too).
  const pageSizeRaw = val("--page-size");
  const publish = has("--publish");
  const scanIdRaw = val("--scan-id");

  // ── Validate wired flags ───────────────────────────────────────────────────
  if (reportStyleRaw !== null && reportStyleRaw !== undefined && !["flat", "roster"].includes(reportStyleRaw)) {
    throw new Error(`Invalid --report-style "${reportStyleRaw}" (flat|roster)`);
  }
  let pageStyle: "a3-landscape" | "a4-landscape" | undefined;
  if (pageSizeRaw != null) {
    const v = pageSizeRaw.toLowerCase();
    if (v === "a3" || v === "a3-landscape") pageStyle = "a3-landscape";
    else if (v === "a4" || v === "a4-landscape") pageStyle = "a4-landscape";
    else throw new Error(`Invalid --page-size "${pageSizeRaw}" (a3|a4)`);
  }
  if (reportDetailRaw !== null && reportDetailRaw !== undefined && !["summary", "table", "full"].includes(reportDetailRaw)) {
    throw new Error(`Invalid --report-detail "${reportDetailRaw}" (summary|table|full)`);
  }

  // Parse --sort: "field" or "field:asc" or "field:desc"
  let sort: { field: string; dir: string } | null = null;
  if (sortRaw) {
    const parts = sortRaw.split(":");
    const field = parts[0].toLowerCase();
    const dir = (parts[1] ?? "asc").toLowerCase();
    const VALID_SORT_FIELDS = ["seen", "name", "serial", "model", "group", "year", "os"];
    if (!VALID_SORT_FIELDS.includes(field)) {
      throw new Error(`Invalid --sort field "${field}" (seen|name|serial|model|group|year|os)`);
    }
    if (!["asc", "desc"].includes(dir)) {
      throw new Error(`Invalid --sort direction "${dir}" (asc|desc)`);
    }
    sort = { field, dir };
  }


  return runReport({
    report: reportName,
    scope,
    format,
    reportOnly,
    outDir,
    noApps, noProfiles, noUsers, allowPartial,
    reportDetail: reportDetailRaw ?? undefined,
    reportStyle: (reportStyleRaw as "flat" | "roster" | undefined) ?? undefined,
    sort,
    search: searchQuery,
    raw, withSecurity, withInventory, noNetworkCache, pageStyle,
    findingsExclude: findingsExclude.length ? findingsExclude : undefined,
    publish, scanId: scanIdRaw ?? undefined,
  }, { ...deps, log: deps?.log ?? console.log });
}

export async function main(): Promise<void> {
  try {
    const result = await runCli(process.argv.slice(2));
    if (result.partial) process.exit(2);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
