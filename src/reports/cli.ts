import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import type { WriteResult } from "./engine/dossier.js";
import type { Format } from "./engine/csv.js";
import { REGISTRY } from "./specs/registry.js";
import type { LegacySelector, Ctx } from "./cli/inputs.js";
import { loadEnvKey } from "./cli/inputs.js";

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
  const ctx: Ctx = { apiKey };

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
  };

  const fetchFn = deps?.fetchInput ?? ((_rep: string, sc: LegacySelector, c: Ctx) => entry.buildInput(sc, c, entryOpts));
  const rawInput = await fetchFn(opts.report, opts.scope, ctx);

  // ── Apply --search filter for inventory (post-fetch bridge) ───────────────
  let input = rawInput;
  if (opts.report === "inventory" && opts.search) {
    const { parseQuery, evaluate } = await import("./domain/query.js");
    const ast = parseQuery(opts.search);
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
    input = { ...rawInput, records: kept, findings };
  }

  const dossier = entry.build(input, entryOpts);
  mkdirSync(opts.outDir, { recursive: true });
  const result = await dossier.write(opts.outDir, { format: opts.format, reportOnly: opts.reportOnly, ...entry.writeOpts });

  // Surface partial-fetch failures (mirrors legacy --allow-partial / exit-2 behavior)
  if (!opts.allowPartial && (input.failures as any[] | undefined)?.length) {
    console.warn(
      `inventory: ${(input.failures as any[]).length} per-device section fetch(es) failed` +
      ` (use --allow-partial to suppress this warning)`,
    );
  }

  for (const f of result.files) log(`  ${f.name}`);
  log(`Output: ${opts.outDir}`);
  log("Output is local-only (reports/ is gitignored) and NOT committed.");

  return result;
}

export async function runCli(argv: string[], deps?: CliDeps): Promise<WriteResult> {
  const reportName = argv[0];
  if (!reportName || reportName.startsWith("--")) {
    throw new Error(
      "Usage: node dist/reports/cli.js <report> [flags]  (report: audit|inventory|logs)",
    );
  }
  const entry = REGISTRY[reportName];
  if (!entry) {
    throw new Error(
      `Unknown report "${reportName}". Valid reports: ${Object.keys(REGISTRY).join(", ")}`,
    );
  }

  const flags = argv.slice(1);
  const val = (name: string): string | null => {
    const i = flags.indexOf(name);
    return i >= 0 && i + 1 < flags.length ? flags[i + 1] : null;
  };
  const has = (name: string): boolean => flags.includes(name);

  // ── Per-report flag validation ────────────────────────────────────────────────
  // Define allowed flags per report
  const COMMON_FLAGS = new Set([
    "--serial", "--group", "--last-seen", "--all", "--confirm-all",
    "--format", "--out", "--report-only",
    "--report-detail",
  ]);
  const INVENTORY_ONLY_FLAGS = new Set([
    "--search", "--no-apps", "--no-profiles", "--no-users",
    "--report-style", "--sort", "--allow-partial", "--raw",
  ]);
  const LOGS_ONLY_FLAGS = new Set([
    "--with-security", "--with-inventory",
  ]);

  // Build the set of allowed flags for this report
  const allowedForReport = new Set([...COMMON_FLAGS]);
  if (reportName === "inventory") {
    INVENTORY_ONLY_FLAGS.forEach((f) => allowedForReport.add(f));
  }
  if (reportName === "logs") {
    LOGS_ONLY_FLAGS.forEach((f) => allowedForReport.add(f));
  }

  // Validate flags: must be either known and allowed for this report, or rejected with guidance
  for (const f of flags) {
    if (f.startsWith("--")) {
      if (!allowedForReport.has(f)) {
        if (INVENTORY_ONLY_FLAGS.has(f)) {
          throw new Error(`${f} is only supported for the inventory report`);
        } else if (LOGS_ONLY_FLAGS.has(f)) {
          throw new Error(`${f} is only supported for the logs report`);
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
  const reportDetailRaw = val("--report-detail");
  const reportStyleRaw = val("--report-style");
  const sortRaw = val("--sort");
  // Inventory-only: --raw; Logs-only: --with-security, --with-inventory
  const raw = has("--raw");
  const withSecurity = has("--with-security");
  const withInventory = has("--with-inventory");

  // ── Validate wired flags ───────────────────────────────────────────────────
  if (reportStyleRaw !== null && reportStyleRaw !== undefined && !["flat", "roster"].includes(reportStyleRaw)) {
    throw new Error(`Invalid --report-style "${reportStyleRaw}" (flat|roster)`);
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
    raw, withSecurity, withInventory,
  }, { ...deps, log: deps?.log ?? console.log });
}

export async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
