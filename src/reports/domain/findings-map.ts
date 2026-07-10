import type { EvaluatedDevice } from "./sofa-eval.js";

export interface McpFinding {
  serial_number: string;
  finding_type: string;
  category: string;
  severity: "danger" | "warning" | "info";
  message: string;
  data?: Record<string, unknown>;
}

// Derives one finding per FAILED check from EvaluatedDevice's typed fields —
// not by parsing its `findings: string[]` prose array, which is rendering-
// oriented and fragile to reformat. A device with no failed checks yields [].
export function evaluatedDeviceToFindings(device: EvaluatedDevice): McpFinding[] {
  const out: McpFinding[] = [];
  const serial_number = device.serial;

  if (!device.filevaultOk) {
    out.push({ serial_number, finding_type: "filevault_disabled", category: "FileVault", severity: "warning", message: "FileVault is disabled." });
  }
  if (!device.sipOk) {
    out.push({ serial_number, finding_type: "sip_disabled", category: "SIP", severity: "warning", message: "System Integrity Protection is disabled." });
  }
  if (!device.firewallOk) {
    out.push({ serial_number, finding_type: "firewall_disabled", category: "Firewall", severity: "warning", message: "Firewall is disabled." });
  }
  if (device.xprotect.status === "outdated") {
    out.push({
      serial_number, finding_type: "xprotect_outdated", category: "XProtect", severity: "warning",
      message: `XProtect definitions are outdated (current: ${String(device.xprotect.value)}).`,
      data: { xprotect_version: device.xprotect.value },
    });
  }
  if ((device.cvesBehind ?? 0) > 0) {
    const exploited = device.exploitedBehind ?? 0;
    out.push({
      serial_number, finding_type: "cve_exposure", category: "Compliance",
      severity: exploited > 0 ? "danger" : "warning",
      message: `${device.cvesBehind} unfixed CVE(s)${exploited > 0 ? `, ${exploited} actively exploited` : ""}.`,
      data: { cves_behind: device.cvesBehind, exploited_behind: exploited },
    });
  }
  if (device.osStatus === "eol") {
    out.push({
      serial_number, finding_type: "os_eol", category: "OS", severity: "danger",
      message: `OS version ${device.osVersion} is end-of-life (latest supported: ${device.latestMinor ?? "unknown"}).`,
      data: { os_version: device.osVersion, latest: device.latestMinor },
    });
  }

  return out;
}
