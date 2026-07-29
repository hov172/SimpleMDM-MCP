// Pure mapper: turns the results of four existing audit/derived tools into a single
// prioritized action list. No imports from index.ts (keeps this testable/independent of
// the MCP transport and the SimpleMDM client).
//
// Field names below are aligned to the REAL result shapes returned by the source tools'
// handlers in src/index.ts (case labels cited), not the illustrative shapes in the task
// brief's example test:
//   - get_certificate_expiration_audit (src/index.ts ~2824-2840): returns
//     { apple_id, expires_at, days_until_expiry, warning }. The status field is named
//     `warning` (enum "ok"|"renew_soon"|"renew_now"|"expired"|"unknown"), not `status`,
//     and the day-count field is `days_until_expiry`, not `days_until_expiration`.
//   - get_dep_token_audit (src/index.ts ~2842-2890): returns
//     { total, expired_count, renew_now_count, renew_soon_count, worst_warning, servers }
//     where each server row is { id, server_name, organization_name, token_expires_at,
//     last_synced_at, days_until_expiry, warning, sync_stale }. Same `warning` field name
//     as the cert audit (not `status`).
//   - get_compliance_violators (src/index.ts ~2283-2362): returns
//     { total_enrolled, violator_count, baseline_supported_major, rules_applied,
//     failure_counts, violators } where `violators` is a per-DEVICE array
//     { id, name, serial, os, platform, failures: string[] } (NOT grouped by failure with
//     a device_ids array), and `failure_counts` is a Record<failure, count> tally computed
//     alongside it. This module derives per-failure groups from `failure_counts` (and,
//     when absent, by scanning `violators[].failures`).
//   - get_stale_devices (src/index.ts ~2114-2148): returns
//     { threshold_days, include_unenrolled, total_devices, stale_count, devices } where
//     each device row is { id, name, serial, os, last_seen_at, days_since, status }. The
//     staleness field is `days_since`, not `days_stale`.

export type Severity = "info" | "warning" | "critical";

export interface Recommendation {
  id: string;
  severity: Severity;
  category: "certificates" | "dep" | "compliance" | "stale_devices";
  affected_count: number;
  summary: string;
  remediation: { type: "tool" | "prompt" | "manual"; name: string; args_hint?: string };
  source_tool: string;
}

// ── Source tool result shapes (only the fields this module reads) ─────────────────────

type Warning = "ok" | "renew_soon" | "renew_now" | "expired" | "unknown";

export interface CertAuditResult {
  apple_id?: unknown;
  expires_at?: string | null;
  days_until_expiry: number | null;
  warning: Warning;
}

export interface DepAuditServer {
  server_name?: string;
  organization_name?: string;
  days_until_expiry: number | null;
  warning: Warning;
}

export interface DepAuditResult {
  servers: DepAuditServer[];
}

export interface ComplianceViolatorDevice {
  id: string | number;
  failures: string[];
}

export interface ComplianceViolatorsResult {
  violators: ComplianceViolatorDevice[];
  failure_counts?: Record<string, number>;
}

export interface StaleDevice {
  id: string | number;
  days_since: number;
}

export interface StaleDevicesResult {
  devices: StaleDevice[];
}

export interface RecommendationInputs {
  certAudit: CertAuditResult | null | undefined;
  depAudit: DepAuditResult | null | undefined;
  complianceViolators: ComplianceViolatorsResult | null | undefined;
  staleDevices: StaleDevicesResult | null | undefined;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const CERT_MANUAL_REMEDIATION = "Renew the APNs push certificate in the SimpleMDM admin portal (Settings > Push Certificate)";
const DEP_MANUAL_REMEDIATION = "Renew the DEP server token in Apple Business Manager and re-upload in SimpleMDM";
const REENROLLMENT_MANUAL_REMEDIATION = "Requires device re-enrollment — not remediable via API";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function buildCertRecommendation(certAudit: CertAuditResult | null | undefined): Recommendation | null {
  if (!certAudit) return null;
  const { warning, days_until_expiry } = certAudit;
  let severity: Severity | null = null;
  if (warning === "expired" || warning === "renew_now") severity = "critical";
  else if (warning === "renew_soon") severity = "warning";
  if (!severity) return null;
  return {
    id: "apns-certificate",
    severity,
    category: "certificates",
    affected_count: 1,
    summary: `APNs push certificate is ${warning}${days_until_expiry !== null ? ` (${days_until_expiry} days until expiry)` : ""}`,
    remediation: { type: "manual", name: CERT_MANUAL_REMEDIATION },
    source_tool: "get_certificate_expiration_audit",
  };
}

function buildDepRecommendations(depAudit: DepAuditResult | null | undefined): Recommendation[] {
  if (!depAudit || !Array.isArray(depAudit.servers)) return [];
  const recs: Recommendation[] = [];
  for (const server of depAudit.servers) {
    let severity: Severity | null = null;
    if (server.warning === "expired" || server.warning === "renew_now") severity = "critical";
    else if (server.warning === "renew_soon") severity = "warning";
    if (!severity) continue;
    const name = server.server_name ?? "unknown DEP server";
    recs.push({
      id: `dep-${slugify(name)}`,
      severity,
      category: "dep",
      affected_count: 1,
      summary: `DEP server token "${name}" is ${server.warning}${server.days_until_expiry !== null ? ` (${server.days_until_expiry} days until expiry)` : ""}`,
      remediation: { type: "manual", name: DEP_MANUAL_REMEDIATION },
      source_tool: "get_dep_token_audit",
    });
  }
  return recs;
}

function complianceFailureCounts(result: ComplianceViolatorsResult): Record<string, number> {
  if (result.failure_counts) return result.failure_counts;
  const counts: Record<string, number> = {};
  for (const v of result.violators ?? []) {
    for (const f of v.failures ?? []) counts[f] = (counts[f] ?? 0) + 1;
  }
  return counts;
}

const OS_MAJORS_BEHIND_RE = /^os_(.+)_majors_behind$/;

function buildComplianceRecommendations(complianceViolators: ComplianceViolatorsResult | null | undefined): Recommendation[] {
  if (!complianceViolators || !Array.isArray(complianceViolators.violators)) return [];
  const counts = complianceFailureCounts(complianceViolators);
  const recs: Recommendation[] = [];
  for (const [failure, count] of Object.entries(counts)) {
    if (count < 1) continue;
    const osMatch = failure.match(OS_MAJORS_BEHIND_RE);
    if (osMatch) {
      // The regex capture is the platform label on illustrative fixtures (e.g.
      // "os_mac_majors_behind" -> "mac") but on live compliance data it can be a
      // numeric lag count instead (e.g. "os_2_majors_behind" -> "2") -- the
      // emergency-patching prompt's argument is a platform, not a lag number, so
      // only forward the capture as args_hint when it isn't purely numeric.
      const captureIsNumeric = /^\d+$/.test(osMatch[1]);
      recs.push({
        id: `compliance-${failure}`,
        severity: "warning",
        category: "compliance",
        affected_count: count,
        summary: `${count} device(s) are behind on OS major version updates (${failure})`,
        remediation: captureIsNumeric
          ? { type: "prompt", name: "emergency-patching" }
          : { type: "prompt", name: "emergency-patching", args_hint: osMatch[1] },
        source_tool: "get_compliance_violators",
      });
    } else if (failure === "os_unsupported") {
      // An unsupported OS cannot be patched current -- there is no version to
      // upgrade to that keeps the device supported, so this is critical (not the
      // "warning" level used for majors-behind, which can still be patched).
      recs.push({
        id: `compliance-${failure}`,
        severity: "critical",
        category: "compliance",
        affected_count: count,
        summary: `${count} device(s) are running an unsupported OS`,
        remediation: { type: "prompt", name: "emergency-patching" },
        source_tool: "get_compliance_violators",
      });
    } else if (failure === "filevault_off") {
      recs.push({
        id: `compliance-${failure}`,
        severity: "warning",
        category: "compliance",
        affected_count: count,
        summary: `${count} Mac(s) have FileVault disabled`,
        remediation: { type: "prompt", name: "compliance-violators-remediation" },
        source_tool: "get_compliance_violators",
      });
    } else if (failure === "passcode_not_compliant") {
      recs.push({
        id: `compliance-${failure}`,
        severity: "warning",
        category: "compliance",
        affected_count: count,
        summary: `${count} device(s) have a non-compliant passcode`,
        remediation: { type: "prompt", name: "compliance-violators-remediation" },
        source_tool: "get_compliance_violators",
      });
    } else if (failure === "not_supervised" || failure === "not_user_approved_mdm") {
      recs.push({
        id: `compliance-${failure}`,
        severity: "info",
        category: "compliance",
        affected_count: count,
        summary: `${count} device(s) fail ${failure}`,
        remediation: { type: "manual", name: REENROLLMENT_MANUAL_REMEDIATION },
        source_tool: "get_compliance_violators",
      });
    }
    // Other failure keys are outside the authoritative mapping table and
    // intentionally produce no recommendation.
  }
  return recs;
}

function buildStaleDevicesRecommendation(staleDevices: StaleDevicesResult | null | undefined): Recommendation | null {
  if (!staleDevices || !Array.isArray(staleDevices.devices) || staleDevices.devices.length === 0) return null;
  const devices = staleDevices.devices;
  const maxDaysStale = devices.reduce((max, d) => Math.max(max, d.days_since ?? 0), 0);
  const severity: Severity = maxDaysStale > 30 ? "warning" : "info";
  return {
    id: "stale-devices",
    severity,
    category: "stale_devices",
    affected_count: devices.length,
    summary: `${devices.length} device(s) have not checked in recently (up to ${maxDaysStale} days stale)`,
    remediation: { type: "prompt", name: "stale-devices-cleanup", args_hint: String(maxDaysStale) },
    source_tool: "get_stale_devices",
  };
}

export function buildRecommendations(inputs: RecommendationInputs): Recommendation[] {
  const recs: Recommendation[] = [];

  const certRec = buildCertRecommendation(inputs?.certAudit);
  if (certRec) recs.push(certRec);

  recs.push(...buildDepRecommendations(inputs?.depAudit));
  recs.push(...buildComplianceRecommendations(inputs?.complianceViolators));

  const staleRec = buildStaleDevicesRecommendation(inputs?.staleDevices);
  if (staleRec) recs.push(staleRec);

  recs.sort((a, b) => {
    const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rankDiff !== 0) return rankDiff;
    return b.affected_count - a.affected_count;
  });

  return recs;
}
