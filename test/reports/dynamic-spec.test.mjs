// test/reports/dynamic-spec.test.mjs
// Task 2.7 — dynamic report spec over MCP. buildDynamicDossier is pure (no network):
// it maps a declarative spec + already-fetched rows onto the house-style Dossier.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildDynamicDossier, validateDynamicSpec, adapterRows } from "../../dist/reports/specs/dynamic.js";

test("a dynamic spec renders the house-style dossier", async () => {
  const spec = {
    title: "Stale Devices",
    pageStyle: "a3-landscape",
    footerTitle: "Stale Devices",
    dataAdapter: "devices",
    sections: [
      { heading: "Stale", table: { columns: [{ key: "serial", header: "serial" }], from: "rows" } },
    ],
  };
  const out = mkdtempSync(join(tmpdir(), "dyn-"));
  try {
    await buildDynamicDossier(spec, { rows: [{ serial: "C02" }] }).write(out, { format: "md", reportOnly: false });
    assert.match(readFileSync(join(out, "report.md"), "utf8"), /## Stale[\s\S]*C02/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("dynamic spec honors mdName and writes a per-section data CSV", async () => {
  const spec = {
    title: "Stale Devices",
    pageStyle: "letter-portrait",
    footerTitle: "Stale",
    mdName: "stale.md",
    dataAdapter: "devices",
    sections: [
      { heading: "Stale", table: { columns: [{ key: "serial", header: "Serial" }], from: "rows", csvName: "stale.csv" } },
    ],
  };
  const out = mkdtempSync(join(tmpdir(), "dyn-csv-"));
  try {
    const result = await buildDynamicDossier(spec, { rows: [{ serial: "C02" }] })
      .write(out, { format: "all", reportOnly: false });
    assert.ok(existsSync(join(out, "stale.md")), "mdName must be honored");
    assert.ok(existsSync(join(out, "stale.csv")), "named table must emit a data CSV");
    assert.ok(result.files.some((f) => f.name === "stale.csv"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ── validateDynamicSpec ──────────────────────────────────────────────────────

test("validateDynamicSpec accepts a well-formed spec", () => {
  const spec = {
    title: "X", pageStyle: "a3-landscape", dataAdapter: "devices",
    sections: [{ heading: "S", table: { columns: [{ key: "serial", header: "serial" }], from: "rows" } }],
  };
  assert.strictEqual(validateDynamicSpec(spec), null);
});

test("validateDynamicSpec rejects unknown dataAdapter", () => {
  const err = validateDynamicSpec({ title: "X", dataAdapter: "nope", sections: [{ heading: "S", table: { columns: [], from: "rows" } }] });
  assert.match(String(err), /adapter|nope/i);
});

test("validateDynamicSpec rejects missing title and empty sections", () => {
  assert.match(String(validateDynamicSpec({ dataAdapter: "devices", sections: [{ heading: "S", table: { columns: [], from: "rows" } }] })), /title/i);
  assert.match(String(validateDynamicSpec({ title: "X", dataAdapter: "devices", sections: [] })), /section/i);
});

// ── adapterRows (offline routing via a fake DataSource) ──────────────────────

test("adapterRows routes each adapter to its DataSource method", async () => {
  const calls = [];
  const fake = {
    devices: async () => (calls.push("devices"), [{ serial: "D" }]),
    apps: async () => (calls.push("apps"), [{ a: 1 }]),
    profiles: async () => (calls.push("profiles"), [{ p: 1 }]),
    users: async () => (calls.push("users"), [{ u: 1 }]),
    securityPosture: async () => (calls.push("posture"), [{ s: 1 }]),
    logs: async () => (calls.push("logs"), [{ l: 1 }]),
  };
  assert.deepStrictEqual(await adapterRows(fake, "devices"), [{ serial: "D" }]);
  await adapterRows(fake, "apps");
  await adapterRows(fake, "profiles");
  await adapterRows(fake, "users");
  await adapterRows(fake, "posture");
  await adapterRows(fake, "logs");
  assert.deepStrictEqual(calls, ["devices", "apps", "profiles", "users", "posture", "logs"]);
});
