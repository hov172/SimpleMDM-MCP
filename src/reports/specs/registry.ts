import type { Dossier } from "../engine/dossier.js";
import type { Format } from "../engine/csv.js";
import type { LegacySelector, Ctx } from "../cli/inputs.js";
import { auditInputLive, inventoryInputLive, logsInputLive } from "../cli/inputs.js";
import { buildAuditDossier } from "./audit.js";
import { buildInventoryDossier } from "./inventory.js";
import { buildLogsDossier } from "./logs.js";
import { findingRows } from "../domain/logs.js";

export interface RegistryEntry {
  buildInput(scope: LegacySelector, ctx: Ctx, opts?: Record<string, any>): Promise<any>;
  build(input: any, opts?: Record<string, any>): Dossier;
  defaultFormat: Format;
  writeOpts: { manifest?: boolean };
  summaryText?(input: any, opts?: Record<string, any>): string;
}

export const REGISTRY: Record<string, RegistryEntry> = {
  audit: {
    buildInput: (scope, ctx) => auditInputLive(scope, ctx),
    build: (input, opts) => buildAuditDossier(input, { pageStyle: opts?.pageStyle }),
    defaultFormat: "all",
    writeOpts: {},
    summaryText(input: any, opts: any): string {
      const s = input.summary;
      const sel = opts?.scope as LegacySelector;
      const scopeLabel = sel
        ? sel.kind === "group" ? `group "${sel.value}"`
          : sel.kind === "serial" ? `serial ${(sel.value as string[]).join(",")}`
          : `last-seen ${sel.value}`
        : "whole fleet";
      return (
        `SOFA Audit ${input.dateStr}\nScope: ${scopeLabel}\n` +
        `Devices: ${s.total} (issues: ${s.withIssues})\n` +
        `OS Outdated ${s.osOutdated} | No FileVault ${s.noFileVault} | No SIP ${s.noSip} | ` +
        `No Firewall ${s.noFirewall} | ` +
        `XProtect Outdated ${s.xprotectCollected ? s.xprotectOutdated : "N/A (not set up)"} | ` +
        `Unfixed CVEs ${s.unfixedCves}\n`
      );
    },
  },
  inventory: {
    buildInput: (scope, ctx, opts) => inventoryInputLive(scope, ctx, opts),
    build: (input, opts) => buildInventoryDossier(input, opts),
    defaultFormat: "all",
    writeOpts: {},
    summaryText(input: any, opts: any): string {
      const records: any[] = input.records ?? [];
      const findings: any[] = input.findings ?? [];
      const failures: any[] = input.failures ?? [];
      const queryWarnings: string[] = input.queryWarnings ?? [];
      const dateStr: string = input.dateStr ?? "";
      const rawById: Map<any, any> | undefined = input.rawById;
      const sel = opts?.scope as LegacySelector;
      const scopeLabel = sel
        ? sel.kind === "group" ? `group "${sel.value}"`
          : sel.kind === "serial" ? `serial ${(sel.value as string[]).join(",")}`
          : `last-seen ${sel.value}`
        : "whole fleet";
      const undetermined = records.filter((r: any) => r.match_status === "unknown").length;
      const fleetCount: number | undefined = input.fleetCount;
      const unknownFindings = findings.filter((f: any) => f.status === "unknown").length;
      const appsExcluded = records.filter((r: any) => r.sections?.apps !== "ok").length;
      const lines: (string | null)[] = [
        `Inventory Report ${dateStr}`,
        opts?.search ? `Query: ${opts.search}` : null,
        ...queryWarnings.map((w: string) => `Query warning: ${w}`),
        `Scope: ${scopeLabel}`,
        `Devices: ${records.length} matched (of ${rawById?.size ?? "?"} selected${fleetCount != null ? `, fleet ${fleetCount}` : ""})`,
        undetermined ? `Undetermined matches (included, flagged): ${undetermined}` : null,
        `Findings: ${findings.length}${unknownFindings ? ` (${unknownFindings} unknown)` : ""}`,
        findings.length
          ? `Findings by type: ${[...findings.reduce((m: Map<string, number>, f: any) => m.set(f.type, (m.get(f.type) ?? 0) + 1), new Map<string, number>())].map(([t, n]) => `${t} ${n}`).join(" | ")}`
          : null,
        appsExcluded ? `App catalog/rollups exclude ${appsExcluded} device(s) with unavailable app inventory` : null,
        failures.length
          ? `Failed section fetches: ${failures.length} — export is PARTIAL`
          : "Failed section fetches: 0",
        ...failures.map((f: any) => `  failed: ${f.serial} ${f.section} — ${f.message}`),
        opts?.outDir ? `Output: ${opts.outDir}` : null,
      ];
      return lines.filter(Boolean).join("\n") + "\n";
    },
  },
  logs: {
    buildInput: (scope, ctx, opts) => logsInputLive(scope, ctx, opts),
    build: (input, opts) => buildLogsDossier(input, opts),
    defaultFormat: "all",
    writeOpts: { manifest: false },
    summaryText(input: any, opts: any): string {
      const { bundles, dateStr } = input;
      const allLogs: any[] = (bundles as any[]).flatMap((b: any) => b.logs ?? []);
      const totalEvents = allLogs.length;
      const byType = allLogs.reduce(
        (acc: any, e: any) => {
          if (e.type === "app.installing") acc.app_installing++;
          else if (e.type === "profile.installed") acc.profile_installed++;
          else if (e.type === "status.changed") acc.status_changed++;
          else if (e.type === "bootstrap_token.get") acc.bootstrap_token_get++;
          return acc;
        },
        { app_installing: 0, profile_installed: 0, status_changed: 0, bootstrap_token_get: 0 },
      );
      const unparseableTimestamps = allLogs.filter((e: any) => e.at_iso === "").length;
      const byCnt = (bundles as any[]).map((b: any) => ({
        serial: b.device?.attributes?.serial_number ?? "",
        n: (b.logs ?? []).length,
      }));
      const noisy = totalEvents > 0 ? byCnt.filter((d: any) => d.n / totalEvents >= 0.25) : [];
      const lines: (string | null)[] = [
        `Logs Audit ${dateStr}`,
        `Devices: ${(bundles as any[]).length}`,
        `Total events: ${totalEvents}`,
        `By type: app.installing ${byType.app_installing} | profile.installed ${byType.profile_installed} | status.changed ${byType.status_changed} | bootstrap_token.get ${byType.bootstrap_token_get}`,
        `Unparseable timestamps: ${unparseableTimestamps}`,
        noisy.length
          ? `Noisy devices (>=25% of events): ${noisy.map((d: any) => `${d.serial} (${Math.round((d.n / totalEvents) * 100)}%)`).join(", ")}`
          : null,
        (() => {
          const fr = findingRows(bundles as any[]);
          return fr.length
            ? `Findings: ${fr.length} across ${new Set(fr.map((r: any) => r.serial_number)).size} device(s)${opts?.reportOnly ? "" : " — see findings.csv"}`
            : null;
        })(),
        `Failed devices: 0`,
        opts?.outDir ? `Output: ${opts.outDir}` : null,
      ];
      return lines.filter(Boolean).join("\n") + "\n";
    },
  },
};
