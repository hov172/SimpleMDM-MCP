// test/reports/dynamic-spec.test.mjs
// Task 2.7 — dynamic report spec over MCP. buildDynamicDossier is pure (no network):
// it maps a declarative spec + already-fetched rows onto the house-style Dossier.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildDynamicDossier, validateDynamicSpec, adapterRows, applyFilter, autoPageStyle } from "../../dist/reports/specs/dynamic.js";

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

// 2.7b: type-validate optional fields so a malformed spec returns {error} rather than
// throwing a raw TypeError inside Dossier.write().
const okSection = { heading: "S", table: { columns: [{ key: "serial", header: "serial" }], from: "rows" } };

test("validateDynamicSpec rejects an invalid pageStyle", () => {
  const err = validateDynamicSpec({ title: "X", pageStyle: "wallpaper", dataAdapter: "devices", sections: [okSection] });
  assert.match(String(err), /pageStyle/i);
});

test("validateDynamicSpec rejects a non-string mdName or footerTitle", () => {
  assert.match(String(validateDynamicSpec({ title: "X", pageStyle: "a3-landscape", mdName: 123, dataAdapter: "devices", sections: [okSection] })), /mdName/i);
  assert.match(String(validateDynamicSpec({ title: "X", pageStyle: "a3-landscape", footerTitle: {}, dataAdapter: "devices", sections: [okSection] })), /footerTitle/i);
});

test("validateDynamicSpec rejects empty or malformed columns", () => {
  assert.match(String(validateDynamicSpec({ title: "X", pageStyle: "a3-landscape", dataAdapter: "devices", sections: [{ heading: "S", table: { columns: [], from: "rows" } }] })), /column/i);
  assert.match(String(validateDynamicSpec({ title: "X", pageStyle: "a3-landscape", dataAdapter: "devices", sections: [{ heading: "S", table: { columns: [{ key: "serial" }], from: "rows" } }] })), /column|key|header/i);
});

test("validateDynamicSpec accepts a spec that omits the optional mdName/footerTitle/pageStyle", () => {
  // mdName/footerTitle are optional. pageStyle is now ALSO optional — when absent it is
  // auto-selected by table width (see autoPageStyle), so omission must validate clean.
  assert.strictEqual(validateDynamicSpec({ title: "X", pageStyle: "letter-portrait", dataAdapter: "devices", sections: [okSection] }), null);
  assert.strictEqual(validateDynamicSpec({ title: "X", dataAdapter: "devices", sections: [okSection] }), null);
});

test("validateDynamicSpec still rejects an explicit invalid pageStyle value", () => {
  // optional ≠ unvalidated: a present-but-bogus value is still an error.
  assert.match(String(validateDynamicSpec({ title: "X", pageStyle: "wallpaper", dataAdapter: "devices", sections: [okSection] })), /pageStyle/i);
});

// ── autoPageStyle — orientation auto-selected by the widest table's column count ──
test("autoPageStyle honors an explicit pageStyle when present", () => {
  assert.equal(autoPageStyle({ pageStyle: "letter-portrait", sections: [{ table: { columns: Array(20).fill({ key: "k", header: "h" }) } }] }), "letter-portrait");
});

test("autoPageStyle picks portrait for narrow tables, landscape for wide ones", () => {
  const spec = (n) => ({ sections: [{ table: { columns: Array(n).fill({ key: "k", header: "h" }) } }] });
  assert.equal(autoPageStyle(spec(3)),  "letter-portrait", "3 cols → portrait");
  assert.equal(autoPageStyle(spec(6)),  "letter-portrait", "6 cols → portrait (boundary)");
  assert.equal(autoPageStyle(spec(7)),  "a4-landscape",    "7 cols → A4 landscape");
  assert.equal(autoPageStyle(spec(12)), "a4-landscape",    "12 cols → A4 landscape");
  assert.equal(autoPageStyle(spec(13)), "a3-landscape",    "13+ cols → A3 landscape");
});

test("autoPageStyle uses the WIDEST section across a multi-section spec", () => {
  const spec = { sections: [
    { table: { columns: Array(2).fill({ key: "k", header: "h" }) } },
    { table: { columns: Array(9).fill({ key: "k", header: "h" }) } },
  ]};
  assert.equal(autoPageStyle(spec), "a4-landscape");
});

test("buildDynamicDossier auto-selects landscape when pageStyle is omitted for a wide table", () => {
  const spec = {
    title: "Wide Report", dataAdapter: "devices",
    sections: [{ heading: "Wide", table: {
      columns: Array(8).fill(0).map((_, i) => ({ key: "c" + i, header: "C" + i })),
      from: "rows",
    }}],
  };
  const doc = buildDynamicDossier(spec, { rows: [] }).toDocument();
  assert.equal(doc.pageStyle, "a4-landscape", "8-column table with no pageStyle → landscape");
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

// ── applyFilter (generic row filtering for dynamic specs over any adapter) ────

const ROWS = [
  { serial: "A1", os_version: "13.7.8", filevault_enabled: false, last_seen_at: "2025-02-01", attributes: { name: "Old iMac" } },
  { serial: "B2", os_version: "15.7.4", filevault_enabled: true,  last_seen_at: "2026-06-01", attributes: { name: "New iMac" } },
  { serial: "C3", os_version: "14.6.1", filevault_enabled: false, last_seen_at: "2026-05-15", attributes: { name: "Laptop" } },
];

test("applyFilter eq / ne match flat fields", () => {
  assert.deepEqual(applyFilter(ROWS, [{ field: "serial", op: "eq", value: "B2" }]).map(r => r.serial), ["B2"]);
  assert.deepEqual(applyFilter(ROWS, [{ field: "serial", op: "ne", value: "B2" }]).map(r => r.serial), ["A1", "C3"]);
});

test("applyFilter boolean and exists/absent", () => {
  assert.deepEqual(applyFilter(ROWS, [{ field: "filevault_enabled", op: "eq", value: false }]).map(r => r.serial), ["A1", "C3"]);
  assert.deepEqual(applyFilter(ROWS, [{ field: "attributes.name", op: "exists" }]).length, 3);
  assert.deepEqual(applyFilter(ROWS, [{ field: "nope", op: "absent" }]).length, 3);
});

test("applyFilter dot-path into nested objects (works for raw adapter rows)", () => {
  assert.deepEqual(applyFilter(ROWS, [{ field: "attributes.name", op: "icontains", value: "imac" }]).map(r => r.serial), ["A1", "B2"]);
});

test("applyFilter comparators (string/version + lexical date)", () => {
  // lexical comparison works for ISO dates: stale = last_seen before a cutoff
  assert.deepEqual(applyFilter(ROWS, [{ field: "last_seen_at", op: "lt", value: "2026-01-01" }]).map(r => r.serial), ["A1"]);
});

test("applyFilter conditions are ANDed", () => {
  const r = applyFilter(ROWS, [
    { field: "filevault_enabled", op: "eq", value: false },
    { field: "last_seen_at", op: "gte", value: "2026-01-01" },
  ]);
  assert.deepEqual(r.map(x => x.serial), ["C3"]);
});

test("applyFilter 'in' membership", () => {
  assert.deepEqual(applyFilter(ROWS, [{ field: "serial", op: "in", value: ["A1", "C3"] }]).map(r => r.serial), ["A1", "C3"]);
});

test("buildDynamicDossier applies a section's table.filter before rendering", () => {
  const spec = {
    title: "Stale Devices", pageStyle: "a4-landscape", dataAdapter: "devices",
    sections: [{ heading: "Stale", table: {
      columns: [{ key: "serial", header: "serial" }],
      from: "rows",
      filter: [{ field: "last_seen_at", op: "lt", value: "2026-01-01" }],
    }}],
  };
  const doc = buildDynamicDossier(spec, { rows: ROWS }).toDocument();
  const tableBlock = doc.sections[0].blocks.find(b => b.kind === "table");
  assert.deepEqual(tableBlock.rows.map(r => r.serial), ["A1"], "only the filtered row reaches the table");
});

test("validateDynamicSpec accepts a4-landscape and a valid filter; rejects a bad op", () => {
  const base = { title: "X", pageStyle: "a4-landscape", dataAdapter: "devices",
    sections: [{ heading: "S", table: { columns: [{ key: "serial", header: "serial" }], from: "rows",
      filter: [{ field: "serial", op: "eq", value: "A1" }] } }] };
  assert.strictEqual(validateDynamicSpec(base), null, "a4-landscape + valid filter should pass");
  const bad = JSON.parse(JSON.stringify(base));
  bad.sections[0].table.filter[0].op = "regex";
  assert.match(String(validateDynamicSpec(bad)), /filter|op/i);
});
