// Unit tests for the "executive-summary" report: REGISTRY wiring + Dossier
// markdown content. No network — build() is a pure function over a hand-built
// fixture matching the ExecutiveInput interface (src/reports/specs/executive.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGISTRY } from "../../dist/reports/specs/registry.js";
import { buildExecutiveDossier } from "../../dist/reports/specs/executive.js";

const FIXTURE_INPUT = {
  dateStr: "2026-07-28",
  fleet: { total: 42, enrolled: 40, supervised_pct: 90, dep_pct: 80, filevault_pct: 95, os_current_pct: 70 },
  risk: { apns_status: "ok", dep_worst_status: "renew_soon", stale_count: 3, violator_count: 5 },
  recommendations: [
    {
      id: "apns-certificate",
      severity: "critical",
      category: "certificates",
      affected_count: 1,
      summary: "APNs push certificate is expired",
      remediation: { type: "manual", name: "Renew the APNs push certificate in the SimpleMDM admin portal (Settings > Push Certificate)" },
      source_tool: "get_certificate_expiration_audit",
    },
    {
      id: "stale-devices",
      severity: "warning",
      category: "stale_devices",
      affected_count: 3,
      summary: "3 device(s) have not checked in recently (up to 45 days stale)",
      remediation: { type: "prompt", name: "stale-devices-cleanup", args_hint: "45" },
      source_tool: "get_stale_devices",
    },
  ],
};

// ── Registry wiring ─────────────────────────────────────────────────────────

test("REGISTRY.executive-summary exists with buildInput/build/defaultFormat", () => {
  const entry = REGISTRY["executive-summary"];
  assert.ok(entry, "REGISTRY must have an 'executive-summary' entry");
  assert.equal(typeof entry.buildInput, "function");
  assert.equal(typeof entry.build, "function");
  assert.ok(entry.defaultFormat, "defaultFormat must be set");
});

// ── Dossier content ─────────────────────────────────────────────────────────

async function writeAndReadMd(input) {
  const dossier = buildExecutiveDossier(input);
  const out = mkdtempSync(join(tmpdir(), "executive-summary-"));
  await dossier.write(out, { format: "md", reportOnly: false, generatedIso: "2026-07-28T00:00:00Z" });
  return readFileSync(join(out, "executive-summary.md"), "utf8");
}

test("build(FIXTURE) returns a Dossier with Fleet KPIs / Risk Summary / Top Recommendations", async () => {
  const dossier = REGISTRY["executive-summary"].build(FIXTURE_INPUT);
  const out = mkdtempSync(join(tmpdir(), "executive-summary-"));
  await dossier.write(out, { format: "md", reportOnly: false, generatedIso: "2026-07-28T00:00:00Z" });
  const md = readFileSync(join(out, "executive-summary.md"), "utf8");
  assert.ok(md.includes("Fleet KPIs"), "must contain 'Fleet KPIs' section");
  assert.ok(md.includes("Risk Summary"), "must contain 'Risk Summary' section");
  assert.ok(md.includes("Top Recommendations"), "must contain 'Top Recommendations' section");
  assert.ok(md.includes("APNs push certificate is expired"), "must render recommendation summaries");
});

test("buildExecutiveDossier is directly importable and matches the registry build", () => {
  const dossier = buildExecutiveDossier(FIXTURE_INPUT);
  const doc = dossier.toDocument();
  assert.ok(doc, "toDocument() should return a document");
});

// ── Unknown-status caveats (data-limitation disclosure) ────────────────────
// executiveInputLive (the CLI/generate_report path) cannot determine
// apns_status/dep_worst_status — no push-cert/DEP-token fetchers on that path
// — and reports "unknown" for both. A bare "unknown" cell in the rendered
// document reads as "nothing to worry about" rather than "not checked," so
// the document itself must carry an explicit caveat in that case, and the
// caveat must NOT appear when real statuses are supplied (e.g. a future
// richer input path, or FIXTURE_INPUT above with "ok"/"renew_soon").

const UNKNOWN_RISK_INPUT = {
  ...FIXTURE_INPUT,
  risk: { ...FIXTURE_INPUT.risk, apns_status: "unknown", dep_worst_status: "unknown" },
};

test("Risk Summary carries an in-document caveat when apns_status/dep_worst_status are unknown", async () => {
  const md = await writeAndReadMd(UNKNOWN_RISK_INPUT);
  assert.ok(
    md.includes("APNs certificate and DEP token status are not available via this report path"),
    "expected Risk Summary caveat when status is unknown",
  );
});

test("Top Recommendations carries a caveat noting cert/DEP recommendations are excluded when status is unknown", async () => {
  const md = await writeAndReadMd(UNKNOWN_RISK_INPUT);
  assert.ok(
    md.includes("Certificate and DEP token recommendations are not included in this report path"),
    "expected Top Recommendations caveat when status is unknown",
  );
});

test("no caveats are rendered when apns_status/dep_worst_status are real (known) values", async () => {
  const md = await writeAndReadMd(FIXTURE_INPUT);
  assert.ok(
    !md.includes("are not available via this report path"),
    "Risk Summary caveat must be absent for known statuses",
  );
  assert.ok(
    !md.includes("are not included in this report path"),
    "Top Recommendations caveat must be absent for known statuses",
  );
});

test("caveat triggers when only one of apns_status/dep_worst_status is unknown", async () => {
  const partial = { ...FIXTURE_INPUT, risk: { ...FIXTURE_INPUT.risk, apns_status: "unknown" } };
  const md = await writeAndReadMd(partial);
  assert.ok(md.includes("are not available via this report path"), "caveat should trigger on partial unknown");
});
