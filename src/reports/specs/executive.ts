import { Dossier } from "../engine/dossier.js";
import type { Recommendation } from "../../analytics/recommendations.js";

export interface ExecutiveInput {
  dateStr: string;
  fleet: { total: number; enrolled: number; supervised_pct: number; dep_pct: number; filevault_pct: number; os_current_pct: number };
  risk: { apns_status: string; dep_worst_status: string; stale_count: number; violator_count: number };
  recommendations: Recommendation[];
  scopeLabel?: string;
}

export function buildExecutiveDossier(input: ExecutiveInput): Dossier {
  const d = new Dossier({
    title: `Executive Fleet Summary — ${input.dateStr}`,
    pageStyle: "letter-portrait",
    footerTitle: "Executive Fleet Summary",
    mdName: "executive-summary.md",
  });
  const f = input.fleet, r = input.risk;
  const recLines = input.recommendations.length
    ? input.recommendations
        .slice(0, 10)
        .map((x, i) => `${i + 1}. **[${x.severity}]** ${x.summary} — _fix via ${x.remediation.type} \`${x.remediation.name}\`_`)
        .join("\n")
    : "_No open recommendations — fleet is clean._";
  // When apns_status/dep_worst_status could not be determined via this report
  // path (the legacy CLI/generate_report input builder has no push-certificate
  // or DEP-token fetchers — see executiveInputLive in cli/inputs.ts), a bare
  // "unknown" cell reads as "nothing to worry about" rather than "not checked."
  // Surface the limitation in the rendered document itself, not just in code
  // comments, so every consumer of the report (not just engineers reading the
  // source) sees it. A future richer input path that supplies real statuses
  // should not carry this caveat.
  const statusUnknown = r.apns_status === "unknown" || r.dep_worst_status === "unknown";
  const riskCaveat = statusUnknown
    ? "\n\n_APNs certificate and DEP token status are not available via this report path — run get_certificate_expiration_audit and get_dep_token_audit for authoritative status._"
    : "";
  const recCaveat = statusUnknown
    ? "\n\n_Certificate and DEP token recommendations are not included in this report path._"
    : "";
  d.bodyMarkdown(`# Executive Fleet Summary — ${input.dateStr}

## Fleet KPIs

| Metric | Value |
|---|---|
| Total devices | ${f.total} |
| Enrolled | ${f.enrolled} |
| Supervised | ${f.supervised_pct}% |
| DEP | ${f.dep_pct}% |
| FileVault | ${f.filevault_pct}% |
| On current OS | ${f.os_current_pct}% |

## Risk Summary

| Signal | Status |
|---|---|
| APNs push certificate | ${r.apns_status} |
| DEP tokens (worst) | ${r.dep_worst_status} |
| Stale devices | ${r.stale_count} |
| Compliance violators | ${r.violator_count} |${riskCaveat}

## Top Recommendations

${recLines}${recCaveat}
`);
  d.dataCsv(
    "recommendations.csv",
    [
      { key: "id", header: "id" },
      { key: "severity", header: "severity" },
      { key: "category", header: "category" },
      { key: "affected_count", header: "affected_count" },
      { key: "summary", header: "summary" },
      { key: "remediation_type", header: "remediation_type" },
      { key: "remediation_name", header: "remediation_name" },
    ],
    input.recommendations.map((x) => ({
      id: x.id,
      severity: x.severity,
      category: x.category,
      affected_count: x.affected_count,
      summary: x.summary,
      remediation_type: x.remediation.type,
      remediation_name: x.remediation.name,
    })),
  );
  return d;
}
