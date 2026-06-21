// test/reports/generate-report-tool.test.mjs
// Tests for the generate_report MCP tool and the shared runReport core.
// No live network calls — all fetch functions are injected fixtures.

// Must be set before dist/index.js is dynamically imported.
// SIMPLEMDM_TEST_MODE bypasses main()/Stdio transport so the test process can exit;
// SIMPLEMDM_API_KEY satisfies the key check on any code paths that read it.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAuditInput, buildInventoryInput, buildLogsInput } from "../../test/golden/capture.mjs";
import { runReport } from "../../dist/reports/cli.js";

// Lazy-loaded once; avoids static-import hoisting past the env-var assignment above.
let TOOLS;
let handleTool;
async function loadIndex() {
  if (!TOOLS) {
    ({ TOOLS, handleTool } = await import("../../dist/index.js"));
  }
}

// ── 1. Tool registration ──────────────────────────────────────────────────────

test("generate_report is registered in TOOLS", async () => {
  await loadIndex();
  const tool = TOOLS.find((t) => t.name === "generate_report");
  assert.ok(tool, "generate_report must be in the TOOLS array");
});

test("generate_report schema has required 'report' and 'scope' fields", async () => {
  await loadIndex();
  const tool = TOOLS.find((t) => t.name === "generate_report");
  assert.ok(tool, "generate_report must be registered");
  const props = tool.inputSchema?.properties ?? {};
  assert.ok(props.report, "schema must have 'report' property");
  assert.ok(props.scope, "schema must have 'scope' property");
  const required = tool.inputSchema?.required ?? [];
  assert.ok(required.includes("report"), "'report' must be required");
  assert.ok(required.includes("scope"), "'scope' must be required");
});

test("generate_report report enum includes audit, inventory, logs", async () => {
  await loadIndex();
  const tool = TOOLS.find((t) => t.name === "generate_report");
  const reportEnum = tool?.inputSchema?.properties?.report?.enum ?? [];
  assert.ok(reportEnum.includes("audit"), "enum must include audit");
  assert.ok(reportEnum.includes("inventory"), "enum must include inventory");
  assert.ok(reportEnum.includes("logs"), "enum must include logs");
});

// ── 2. runReport core with injected fetchInput (no network) ──────────────────

test("runReport audit with injected fetchInput returns WriteResult with files", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "gr-test-audit-"));
  try {
    const input = buildAuditInput();
    const result = await runReport(
      { report: "audit", scope: null, format: "md", outDir: tmp },
      { fetchInput: async () => input },
    );
    assert.strictEqual(result.outDir, tmp, "WriteResult.outDir must match provided outDir");
    assert.ok(Array.isArray(result.files), "WriteResult.files must be an array");
    assert.ok(result.files.length > 0, "WriteResult.files must be non-empty");
    assert.ok(
      result.files.some((f) => f.name === "full-audit.md"),
      "WriteResult.files must include full-audit.md",
    );
    assert.ok(existsSync(join(tmp, "full-audit.md")), "full-audit.md must exist on disk");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runReport inventory with injected fetchInput returns WriteResult", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "gr-test-inventory-"));
  try {
    const input = buildInventoryInput();
    const result = await runReport(
      { report: "inventory", scope: { kind: "serial", value: ["ABC123"] }, format: "md", outDir: tmp },
      { fetchInput: async () => input },
    );
    assert.strictEqual(result.outDir, tmp);
    assert.ok(Array.isArray(result.files));
    assert.ok(result.files.some((f) => f.name === "report.md"), "must include report.md");
    assert.ok(existsSync(join(tmp, "report.md")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runReport logs with injected fetchInput returns WriteResult", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "gr-test-logs-"));
  try {
    const input = buildLogsInput();
    const result = await runReport(
      { report: "logs", scope: { kind: "serial", value: ["ABC"] }, format: "md", outDir: tmp },
      { fetchInput: async () => input },
    );
    assert.strictEqual(result.outDir, tmp);
    assert.ok(Array.isArray(result.files));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runReport WriteResult files have required fields (name, description, sha256)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "gr-test-fields-"));
  try {
    const input = buildAuditInput();
    const result = await runReport(
      { report: "audit", scope: null, format: "md", outDir: tmp },
      { fetchInput: async () => input },
    );
    for (const f of result.files) {
      assert.ok(typeof f.name === "string", `file.name must be string, got ${typeof f.name}`);
      assert.ok(typeof f.description === "string", `file.description must be string`);
      assert.ok(typeof f.sha256 === "string", `file.sha256 must be string`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runReport writes nothing to process.stdout (MCP stdio-safety)", async () => {
  // The MCP stdio transport uses stdout for JSON-RPC. runReport called without a
  // `log` sink (the tool path) must not emit progress to stdout or it corrupts the
  // protocol stream. Capture stdout writes during a run and assert none occur.
  const tmp = mkdtempSync(join(tmpdir(), "gr-test-stdout-"));
  const captured = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    captured.push(String(chunk));
    // Swallow — do not forward to the real stdout (would itself pollute test TAP).
    if (typeof rest[rest.length - 1] === "function") rest[rest.length - 1]();
    return true;
  };
  try {
    const input = buildAuditInput();
    await runReport(
      { report: "audit", scope: null, format: "md", outDir: tmp },
      { fetchInput: async () => input }, // no `log` → defaults to stderr
    );
  } finally {
    process.stdout.write = origWrite;
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.strictEqual(
    captured.join(""),
    "",
    `runReport must not write to stdout on the MCP path; captured: ${JSON.stringify(captured)}`,
  );
});

// ── 3. Whole-fleet confirm-all guard ─────────────────────────────────────────

test("generate_report tool: whole-fleet without confirm_all returns error (not throw)", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", {
    report: "audit",
    scope: { all: true }, // confirm_all missing → must return error object
  });
  assert.ok(result && typeof result === "object", "result must be an object");
  assert.ok("error" in result, "result must have an 'error' field");
  assert.match(String(result.error), /confirm_all/i, "error must mention confirm_all");
});

test("generate_report tool: unknown scope shape returns error", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", {
    report: "audit",
    scope: { unknown_key: "value" },
  });
  assert.ok(result && typeof result === "object");
  assert.ok("error" in result, "result must have an 'error' field for unknown scope");
});

// ── 3b. Per-report scope validation (parity with the CLI guards) ─────────────

test("generate_report tool: search scope on audit returns error (no silent swallow)", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", {
    report: "audit",
    scope: { search: "model:MacBook" },
  });
  assert.ok(result && typeof result === "object");
  assert.ok("error" in result, "search on audit must return an error, not run silently");
  assert.match(String(result.error), /search/i, "error must mention search/inventory");
});

test("generate_report tool: search scope on logs returns error (not a raw throw)", async () => {
  await loadIndex();
  // Must return a friendly {error}, not throw a raw Error from the live fetch path.
  const result = await handleTool("generate_report", {
    report: "logs",
    scope: { search: "anything" },
  });
  assert.ok(result && typeof result === "object");
  assert.ok("error" in result, "search on logs must return a friendly error object");
  assert.match(String(result.error), /search/i);
});

test("generate_report tool: search scope on inventory is accepted (no validation error)", async () => {
  await loadIndex();
  // Inventory legitimately supports search; the guard must NOT reject it.
  // It may fail downstream on network, but must not return a scope-validation error.
  let result, threw = false;
  try {
    result = await handleTool("generate_report", { report: "inventory", scope: { search: "x" }, format: "md" });
  } catch { threw = true; }
  if (!threw && result && typeof result === "object" && "error" in result) {
    assert.doesNotMatch(String(result.error), /only supported|must be one of/i,
      "inventory search must not trigger a scope-validation error");
  }
});

test("generate_report tool: last_seen non-positive-integer returns error", async () => {
  await loadIndex();
  for (const bad of [0, -5, 1.5, "abc"]) {
    const result = await handleTool("generate_report", { report: "audit", scope: { last_seen: bad } });
    assert.ok(result && typeof result === "object" && "error" in result,
      `last_seen=${JSON.stringify(bad)} must return an error`);
    assert.match(String(result.error), /last_seen|positive integer/i);
  }
});

test("generate_report tool: empty serials array returns error", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", { report: "audit", scope: { serials: [] } });
  assert.ok(result && typeof result === "object" && "error" in result,
    "empty serials must return an error");
  assert.match(String(result.error), /serial/i);
});

test("generate_report tool: invalid format returns error", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", {
    report: "audit",
    scope: { serials: ["ABC"] },
    format: "xlsx",
  });
  assert.ok(result && typeof result === "object" && "error" in result,
    "invalid format must return an error");
  assert.match(String(result.error), /format/i);
});

test("generate_report tool: multiple selectors returns error", async () => {
  await loadIndex();
  const result = await handleTool("generate_report", {
    report: "audit",
    scope: { serials: ["ABC"], group: "Engineering" },
  });
  assert.ok(result && typeof result === "object" && "error" in result,
    "multiple selectors must return an error");
  assert.match(String(result.error), /one selector|at most one/i);
});

test("generate_report tool: serial scope accepted (returns error only from missing network, not guard)", async () => {
  await loadIndex();
  // We can't run the full tool without network; just verify the guard doesn't reject serial scopes.
  // A real run would fail on fetch — test only that no confirm-all error is returned for serial scope.
  // We test the guard logic path only; network errors are acceptable here.
  let threw = false;
  let result;
  try {
    result = await handleTool("generate_report", {
      report: "audit",
      scope: { serials: ["ABC123"] },
      format: "md",
    });
  } catch {
    threw = true;
  }
  // Either it ran (network stub may succeed or fail) or threw a fetch error.
  // Crucially: if it returned an object it must NOT be a confirm_all guard error.
  if (!threw && result && typeof result === "object" && "error" in result) {
    assert.doesNotMatch(
      String(result.error),
      /confirm_all/i,
      "serial scope must not trigger the confirm_all guard",
    );
  }
  // No assertion needed on the network outcome — just confirming no guard false-positive.
});
