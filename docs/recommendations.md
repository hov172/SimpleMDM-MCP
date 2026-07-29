# Recommendations, Risk Resources & the Executive Summary — Deep Dive

Phase 3 of the 0.36.0 release closes the loop between *observing* fleet problems
and *acting* on them: a `recommend_fixes` tool that turns the existing audits
into a prioritized action list, three new MCP resources for risk surfaces, and
an `executive-summary` report for leadership.

---

## `recommend_fixes`

A read-only aggregation tool. It runs four source audits in parallel —
`get_certificate_expiration_audit`, `get_dep_token_audit`,
`get_compliance_violators`, `get_stale_devices` — and maps their results into
one ranked list. No new API surface: everything comes from cached read paths.

**Parameters:** `min_severity` (`info` | `warning` | `critical`, default
`warning`), `categories` (subset of `certificates` / `dep` / `compliance` /
`stale_devices`), `limit` (max items; note `0` means "none", not "unlimited").

**Result shape:**

```json
{
  "recommendations": [ …filtered by the params above… ],
  "count": 18,
  "generated_from": ["get_certificate_expiration_audit", "…"],
  "all_recommendations": [ …unfiltered; OMITTED when any source audit failed… ]
}
```

Each recommendation:

```json
{
  "id": "compliance-os_unsupported",
  "severity": "critical",
  "category": "compliance",
  "affected_count": 338,
  "summary": "338 device(s) are running an unsupported OS",
  "remediation": { "type": "prompt", "name": "emergency-patching" },
  "source_tool": "get_compliance_violators"
}
```

`remediation.type` is `"prompt"` (a [gated workflow prompt](workflow-prompts.md)
fixes it) or `"manual"` (portal work the API cannot do — APNs certificate
renewal, DEP token renewal in Apple Business Manager, device re-enrollment).
Ids are stable across runs (`apns-certificate`, `dep-<server-slug>`,
`compliance-<failure>`, `stale-devices`), which matters for dashboards — see
below.

**Severity mapping highlights:** expired / renew-now certificates and DEP
tokens are `critical`; renew-soon is `warning`; `os_unsupported` devices are
`critical`; OS-lag / FileVault / passcode groups are `warning`; supervision and
UAMDM failures are `info` (manual re-enrollment). Sorting is severity rank,
then `affected_count` descending. Failed sources are skipped (and dropped from
`generated_from`) rather than failing the call.

**MunkiReport auto-publish:** when the [findings
middleware](findings-middleware.md) is enabled, recommendations publish
automatically — from `all_recommendations` (never the filtered list, so a
`min_severity: "critical"` call can't silently auto-resolve open warnings), and
only when **all four** sources succeeded (a partial run publishes nothing
rather than erasing state). Critical items publish as `danger`, warnings as
`warning`; each finding carries the stable recommendation `id` as its serial
key so the dashboard shows one row per issue with meaningful occurrence counts.

## The three risk resources (15 resources total)

| URI | Content |
|---|---|
| `simplemdm://fleet/risk` | One rollup: security posture, APNs certificate audit, DEP token status, stale devices, plus the last 10 write-audit **errors** |
| `simplemdm://audit/recent-writes` | Last 50 write-audit entries — pure local file read, no API call |
| `simplemdm://recommendations` | Current `recommend_fixes` output (default params) |

Each source inside `fleet/risk` degrades to `null` on failure instead of
failing the whole read.

## The `executive-summary` report

The fourth catalog report in the unified report engine (`generate_report` with
`report: "executive-summary"`, or `dist/reports/cli.js executive-summary`).
One dossier — markdown/CSV by default, docx/pdf via `format` — containing:

- **Fleet KPIs** — totals, enrolled, supervised/DEP/FileVault/OS-current percentages
- **Risk Summary** — APNs status, worst DEP token, stale count, devices with
  security findings (SOFA)
- **Top Recommendations** — the ranked `recommend_fixes` list (top 10 in the
  body, full list as CSV)

**Known limitation:** the report's input path cannot fetch APNs-certificate or
DEP-token data, so those two Risk Summary rows currently render `unknown` — the
document itself carries a caveat pointing at `get_certificate_expiration_audit`
/ `get_dep_token_audit` for authoritative status, and the recommendations
section notes that cert/DEP items are not included via this path. The
"Devices with security findings (SOFA)" row is the SOFA `withIssues` count,
not the `get_compliance_violators` count.

## See also

- [`write-safety.md`](write-safety.md) — the gate that makes acting on
  recommendations safe
- [`workflow-prompts.md`](workflow-prompts.md) — the playbooks recommendations
  point at
- [`findings-middleware.md`](findings-middleware.md) — how auto-publish decides
  what lands on the MunkiReport dashboard
