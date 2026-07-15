import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("src/index.ts", root), "utf8");

test("fleet-health-dashboard prompt references get_dep_token_audit", () => {
  const idx = source.indexOf('case "fleet-health-dashboard":');
  assert.notEqual(idx, -1, "fleet-health-dashboard prompt case not found");
  const promptText = source.slice(idx, idx + 1200);
  assert.match(promptText, /get_dep_token_audit/, "prompt does not call get_dep_token_audit");
  assert.match(promptText, /DEP (server )?token/i, "prompt summary does not mention DEP token status");
});
