import type { Dossier } from "../engine/dossier.js";
import type { Format } from "../engine/csv.js";
import type { LegacySelector, Ctx } from "../cli/inputs.js";
import { auditInputLive, inventoryInputLive, logsInputLive } from "../cli/inputs.js";
import { buildAuditDossier } from "./audit.js";
import { buildInventoryDossier } from "./inventory.js";
import { buildLogsDossier } from "./logs.js";

export interface RegistryEntry {
  buildInput(scope: LegacySelector, ctx: Ctx, opts?: Record<string, any>): Promise<any>;
  build(input: any, opts?: Record<string, any>): Dossier;
  defaultFormat: Format;
  needsConfirmAll: boolean;
  writeOpts: { manifest?: boolean };
}

export const REGISTRY: Record<string, RegistryEntry> = {
  audit: {
    buildInput: (scope, ctx) => auditInputLive(scope, ctx),
    build: (input) => buildAuditDossier(input),
    defaultFormat: "all",
    needsConfirmAll: false,
    writeOpts: {},
  },
  inventory: {
    buildInput: (scope, ctx, opts) => inventoryInputLive(scope, ctx, opts),
    build: (input, opts) => buildInventoryDossier(input, opts),
    defaultFormat: "all",
    needsConfirmAll: true,
    writeOpts: {},
  },
  logs: {
    buildInput: (scope, ctx) => logsInputLive(scope, ctx),
    build: (input, opts) => buildLogsDossier(input, opts),
    defaultFormat: "all",
    needsConfirmAll: true,
    writeOpts: { manifest: false },
  },
};
