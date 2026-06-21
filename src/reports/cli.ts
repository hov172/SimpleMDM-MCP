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

  // Scope selectors
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

  // Format
  const formatArg = val("--format") ?? entry.defaultFormat;
  if (!["csv", "md", "docx", "all"].includes(formatArg)) {
    throw new Error(`Invalid --format "${formatArg}" (csv|md|docx|all)`);
  }
  const format = formatArg as Format;

  const reportOnly = has("--report-only");
  const outDir = val("--out") ?? defaultOutDir(reportName);

  const apiKey = loadEnvKey() ?? "";
  const ctx: Ctx = { apiKey };

  const fetchFn = deps?.fetchInput ?? ((_rep, sc, c) => entry.buildInput(sc, c));
  const input = await fetchFn(reportName, scope, ctx);

  const dossier = entry.build(input);
  mkdirSync(outDir, { recursive: true });
  const result = await dossier.write(outDir, { format, reportOnly, ...entry.writeOpts });

  for (const f of result.files) console.log(`  ${f.name}`);
  console.log(`Output: ${outDir}`);
  console.log("Output is local-only (reports/ is gitignored) and NOT committed.");

  return result;
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
