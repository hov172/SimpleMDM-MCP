// Unit tests for REGISTRY.{logs,inventory}.summaryText() content parity.
// Covers the reviewer findings from Task 7a: restored lines that were dropped
// vs the legacy scripts/logs-audit.mjs and scripts/inventory-report.mjs.
//
// These functions are pure (input → string) so no filesystem or API is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY } from "../../dist/reports/specs/registry.js";
import { findingRows } from "../../dist/reports/domain/logs.js";
import { buildLogsInput, buildInventoryInput } from "../../test/golden/capture.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a synthetic logs bundle where every device has ≥10 identical app installs,
// guaranteeing findingRows() produces at least one finding (app-reinstall-loop).
function buildLogsInputWithFindings() {
  const base = buildLogsInput();
  // Inject 10 identical app.installing events onto the first device's logs.
  const appEvent = {
    id: "LOG-SYNTH-1",
    attributes: {
      at: "06/01/26 10:00:00",
      event_type: "app.installing",
      namespace: "devices",
      level: "info",
      source: "mdm",
      metadata: { name: "TestApp", version: "1.0", bundle_identifier: "com.test.app", via_munki: false },
      relationships: { account: { data: { id: "1" } } },
    },
  };
  const syntheticLogs = Array.from({ length: 11 }, (_, i) => ({
    ...appEvent,
    id: `LOG-SYNTH-${i}`,
  }));

  const bundles = base.bundles.map((b, i) =>
    i === 0 ? { ...b, logs: [...(b.logs ?? []), ...syntheticLogs] } : b,
  );
  return { ...base, bundles };
}

// ── Logs summaryText ──────────────────────────────────────────────────────────

test("logs summaryText: Findings line present when findingRows is non-empty", () => {
  const input = buildLogsInputWithFindings();
  const fr = findingRows(input.bundles);
  assert.ok(fr.length > 0, "fixture must produce ≥1 finding (pre-condition)");

  const text = REGISTRY.logs.summaryText(input, {});
  const deviceCount = new Set(fr.map((r) => r.serial_number)).size;
  assert.ok(
    text.includes(`Findings: ${fr.length} across ${deviceCount} device`),
    `expected 'Findings: ${fr.length} across ${deviceCount} device' in:\n${text}`,
  );
});

test("logs summaryText: Findings line includes ' — see findings.csv' when reportOnly is falsy", () => {
  const input = buildLogsInputWithFindings();
  const text = REGISTRY.logs.summaryText(input, { reportOnly: false });
  assert.ok(
    text.includes("— see findings.csv"),
    `expected '— see findings.csv' in:\n${text}`,
  );
});

test("logs summaryText: Findings line omits findings.csv suffix when reportOnly=true", () => {
  const input = buildLogsInputWithFindings();
  const text = REGISTRY.logs.summaryText(input, { reportOnly: true });
  assert.ok(!text.includes("findings.csv"), `'findings.csv' should be absent when reportOnly:\n${text}`);
  // But the Findings: count line itself must still appear.
  assert.ok(text.includes("Findings:"), `'Findings:' count must still appear when reportOnly:\n${text}`);
});

test("logs summaryText: no Findings line when zero findings", () => {
  // Build a minimal input with zero logs (guaranteed no findings).
  const input = {
    bundles: [{ device: { id: "1", attributes: { serial_number: "TESTSERIAL" } }, logs: [] }],
    dateStr: "2026-01-01",
    nowIso: "2026-01-01T00:00:00Z",
  };
  const text = REGISTRY.logs.summaryText(input, {});
  assert.ok(!text.includes("Findings:"), `no Findings line expected:\n${text}`);
});

test("logs summaryText: baseline lines still present (regression guard)", () => {
  const input = buildLogsInput();
  const text = REGISTRY.logs.summaryText(input, {});
  assert.ok(text.startsWith("Logs Audit 2026-01-01"), "header line");
  assert.ok(text.includes("Devices:"), "Devices line");
  assert.ok(text.includes("Total events:"), "Total events line");
  assert.ok(text.includes("By type:"), "By type line");
  assert.ok(text.includes("Failed devices: 0"), "Failed devices line");
});

// ── Inventory summaryText ─────────────────────────────────────────────────────

test("inventory summaryText: Devices line includes fleet total", () => {
  const input = buildInventoryInput();
  const text = REGISTRY.inventory.summaryText(input, {});
  // fleet ${fleetCount} must appear — fleetCount equals DEVICES.length from the fixture.
  assert.ok(
    text.includes(`fleet ${input.fleetCount}`),
    `expected 'fleet ${input.fleetCount}' in:\n${text}`,
  );
});

test("inventory summaryText: Devices line format matches legacy pattern", () => {
  const input = buildInventoryInput();
  const text = REGISTRY.inventory.summaryText(input, {});
  // Pattern: "Devices: N matched (of M selected, fleet K)"
  const match = text.match(/Devices: \d+ matched \(of \d+ selected, fleet \d+\)/);
  assert.ok(match, `expected legacy Devices format in:\n${text}`);
});

test("inventory summaryText: Findings (N unknown) suffix present when unknown findings exist", () => {
  // Inject a synthetic finding with status "unknown" to test the suffix.
  const base = buildInventoryInput();
  const input = {
    ...base,
    findings: [...base.findings, { type: "assigned-app-missing", status: "unknown", serial: "X", name: "X", detail: "test" }],
  };
  const text = REGISTRY.inventory.summaryText(input, {});
  assert.ok(
    text.match(/Findings: \d+ \(1 unknown\)/),
    `expected '(1 unknown)' suffix in:\n${text}`,
  );
});

test("inventory summaryText: no unknown suffix when all findings are flag-status", () => {
  const input = buildInventoryInput();
  // Golden fixture findings are all "flag" status — no unknown suffix.
  const hasUnknown = input.findings.some((f) => f.status === "unknown");
  if (!hasUnknown) {
    const text = REGISTRY.inventory.summaryText(input, {});
    assert.ok(!text.includes("unknown)"), `no unknown suffix expected:\n${text}`);
  }
});

test("inventory summaryText: app-catalog-exclude line present when apps section is not ok", () => {
  const base = buildInventoryInput();
  // Force one device's apps section to "failed" to trigger the exclude line.
  const records = base.records.map((r, i) =>
    i === 0 ? { ...r, sections: { ...r.sections, apps: "failed" } } : r,
  );
  const input = { ...base, records };
  const text = REGISTRY.inventory.summaryText(input, {});
  assert.ok(
    text.includes("App catalog/rollups exclude"),
    `expected App catalog/rollups exclude line in:\n${text}`,
  );
  assert.ok(
    text.includes("1 device(s) with unavailable app inventory"),
    `expected device count in exclude line:\n${text}`,
  );
});

test("inventory summaryText: app-catalog-exclude line absent when all apps sections ok", () => {
  const input = buildInventoryInput();
  // Golden fixture has all apps sections = "ok".
  const allOk = input.records.every((r) => r.sections?.apps === "ok");
  if (allOk) {
    const text = REGISTRY.inventory.summaryText(input, {});
    assert.ok(!text.includes("App catalog/rollups exclude"), `exclude line should be absent:\n${text}`);
  }
});

test("inventory summaryText: baseline lines still present (regression guard)", () => {
  const input = buildInventoryInput();
  const text = REGISTRY.inventory.summaryText(input, {});
  assert.ok(text.startsWith("Inventory Report 2026-01-01"), "header line");
  assert.ok(text.includes("Scope:"), "Scope line");
  assert.ok(text.includes("Devices:"), "Devices line");
  assert.ok(text.includes("Findings:"), "Findings line");
  assert.ok(text.includes("Failed section fetches: 0"), "Failed section fetches line");
});
