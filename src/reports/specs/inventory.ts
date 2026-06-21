import { Dossier } from "../engine/dossier.js";
import {
  DEVICE_COLUMNS, deviceRows, APP_COLUMNS, appRows, APP_CATALOG_COLUMNS, appCatalogRows,
  ASSIGNED_COLUMNS, assignedAppRows, ASSIGNED_PROFILE_COLUMNS, assignedProfileRows,
  PROFILE_COLUMNS, profileRows, USER_COLUMNS, userRows, BY_MODEL_COLUMNS, byModelRows,
  FINDING_COLUMNS, rollupRows,
  renderInventoryReport, renderInventoryFlat, renderInventoryRoster,
  flatTableRows, rosterTableRows, FLAT_COLUMNS,
} from "../domain/inventory-render.js";

const cols = (arr: string[]) => arr.map((n) => ({ key: n, header: n }));

export interface InventoryBuildOpts {
  noApps?: boolean;
  noProfiles?: boolean;
  noUsers?: boolean;
  reportStyle?: "flat" | "roster";
  sort?: { field: string; dir: string } | null;
  reportDetail?: string;
  search?: string | null;
}

export function buildInventoryDossier(input: any, opts: InventoryBuildOpts = {}): Dossier {
  const { records, findings, dateStr } = input;
  const {
    noApps = false, noProfiles = false, noUsers = false,
    reportStyle, sort = null, reportDetail, search,
  } = opts;

  const d = new Dossier({
    title: "",
    pageStyle: "a3-landscape",
    footerTitle: "SimpleMDM Fleet Inventory",
    mdName: "report.md",
  });

  // Choose renderer based on --report-style
  if (reportStyle === "roster") {
    d.bodyMarkdown(renderInventoryRoster(records, {
      query: search ?? null, scopeLabel: "--all", dateStr, sort: sort ?? null,
    }));
  } else if (reportStyle === "flat") {
    d.bodyMarkdown(renderInventoryFlat(records, {
      query: search ?? null, scopeLabel: "--all", dateStr, sort: sort ?? null,
    }));
  } else {
    d.bodyMarkdown(renderInventoryReport(records, {
      query: search ?? null,
      scopeLabel: "--all",
      dateStr,
      findings,
      detail: reportDetail ?? "full",
      failures: [],
      account: null,
    }));
  }

  // Core device CSV always written
  d.dataCsv("devices.csv", cols(DEVICE_COLUMNS), deviceRows(records));

  // Apps CSVs — skipped when --no-apps
  if (!noApps) {
    d.dataCsv("apps.csv", cols(APP_COLUMNS), appRows(records));
    d.dataCsv("app-catalog.csv", cols(APP_CATALOG_COLUMNS), appCatalogRows(records));
  }

  // Assignment CSVs always written (separate from per-device fetches)
  d.dataCsv("assigned-apps.csv", cols(ASSIGNED_COLUMNS), assignedAppRows(records));
  d.dataCsv("assigned-profiles.csv", cols(ASSIGNED_PROFILE_COLUMNS), assignedProfileRows(records));

  // Profiles/users CSVs — skipped when --no-profiles / --no-users
  if (!noProfiles) d.dataCsv("profiles.csv", cols(PROFILE_COLUMNS), profileRows(records));
  if (!noUsers) d.dataCsv("users.csv", cols(USER_COLUMNS), userRows(records));

  // Rollups always written
  d.dataCsv("by-group.csv", cols(["device_group", "devices"]), rollupRows(records, (r) => r.device_group, "device_group"));
  d.dataCsv("by-type.csv",  cols(["type", "devices"]),         rollupRows(records, (r) => r.type, "type"));
  d.dataCsv("by-model.csv", cols(BY_MODEL_COLUMNS),            byModelRows(records));
  d.dataCsv("by-os.csv",    cols(["os", "devices"]),           rollupRows(records, (r) => (r.os_version ? r.os_version.split(".")[0] + ".x" : ""), "os"));
  d.dataCsv("findings.csv", cols(FINDING_COLUMNS),             findings);

  // report-table.csv for flat/roster styles (mirrors legacy — written alongside report.md)
  if (reportStyle === "flat") {
    d.dataCsv("report-table.csv", cols(FLAT_COLUMNS), flatTableRows(records, sort ?? null));
  } else if (reportStyle === "roster") {
    d.dataCsv("report-table.csv", cols(FLAT_COLUMNS), rosterTableRows(records, sort ?? null));
  }

  return d;
}
