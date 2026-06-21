import { Dossier } from "../engine/dossier.js";
import {
  DEVICE_COLUMNS, deviceRows, APP_COLUMNS, appRows, APP_CATALOG_COLUMNS, appCatalogRows,
  ASSIGNED_COLUMNS, assignedAppRows, ASSIGNED_PROFILE_COLUMNS, assignedProfileRows,
  PROFILE_COLUMNS, profileRows, USER_COLUMNS, userRows, BY_MODEL_COLUMNS, byModelRows,
  FINDING_COLUMNS, rollupRows, renderInventoryReport,
} from "../domain/inventory-render.js";

const cols = (arr: string[]) => arr.map((n) => ({ key: n, header: n }));

export function buildInventoryDossier(input: any): Dossier {
  const { records, findings, dateStr } = input;
  const d = new Dossier({ title: "", pageStyle: "a3-landscape", footerTitle: "SimpleMDM Fleet Inventory", mdName: "report.md" });
  d.bodyMarkdown(renderInventoryReport(records, { query: null, scopeLabel: "--all", dateStr, findings, detail: "full", failures: [], account: null }));
  d.dataCsv("devices.csv",           cols(DEVICE_COLUMNS),           deviceRows(records));
  d.dataCsv("apps.csv",              cols(APP_COLUMNS),              appRows(records));
  d.dataCsv("app-catalog.csv",       cols(APP_CATALOG_COLUMNS),      appCatalogRows(records));
  d.dataCsv("assigned-apps.csv",     cols(ASSIGNED_COLUMNS),         assignedAppRows(records));
  d.dataCsv("assigned-profiles.csv", cols(ASSIGNED_PROFILE_COLUMNS), assignedProfileRows(records));
  d.dataCsv("profiles.csv",          cols(PROFILE_COLUMNS),          profileRows(records));
  d.dataCsv("users.csv",             cols(USER_COLUMNS),             userRows(records));
  d.dataCsv("by-group.csv",          cols(["device_group", "devices"]), rollupRows(records, (r) => r.device_group, "device_group"));
  d.dataCsv("by-type.csv",           cols(["type", "devices"]),      rollupRows(records, (r) => r.type, "type"));
  d.dataCsv("by-model.csv",          cols(BY_MODEL_COLUMNS),         byModelRows(records));
  d.dataCsv("by-os.csv",             cols(["os", "devices"]),        rollupRows(records, (r) => (r.os_version ? r.os_version.split(".")[0] + ".x" : ""), "os"));
  d.dataCsv("findings.csv",          cols(FINDING_COLUMNS),          findings);
  return d;
}
