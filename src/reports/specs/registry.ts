import type { Dossier } from "../engine/dossier.js";
import type { Format } from "../engine/csv.js";
import type { LegacySelector, Ctx } from "../cli/inputs.js";
import { auditInputLive, inventoryInputLive, logsInputLive } from "../cli/inputs.js";
import { buildAuditDossier } from "./audit.js";
import { buildInventoryDossier } from "./inventory.js";
import { buildLogsDossier } from "./logs.js";

export interface RegistryEntry {
  buildInput(scope: LegacySelector, ctx: Ctx): Promise<any>;
  build(input: any): Dossier;
  defaultFormat: Format;
  needsConfirmAll: boolean;
  writeOpts: { manifest?: boolean };
}

export const REGISTRY: Record<string, RegistryEntry> = {
  audit: {
    buildInput: auditInputLive,
    build: buildAuditDossier,
    defaultFormat: "all",
    needsConfirmAll: false,
    writeOpts: {},
  },
  inventory: {
    buildInput: inventoryInputLive,
    build: buildInventoryDossier,
    defaultFormat: "all",
    needsConfirmAll: true,
    writeOpts: {},
  },
  logs: {
    buildInput: logsInputLive,
    build: buildLogsDossier,
    defaultFormat: "all",
    needsConfirmAll: true,
    writeOpts: { manifest: false },
  },
};
