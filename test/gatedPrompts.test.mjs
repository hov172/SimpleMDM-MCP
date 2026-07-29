// Prompt-lint: every write-capable prompt follows the 7-step gated skeleton
// in order and references the Phase 1 gate contract (dry_run, confirm_token)
// plus a RECOVERY section. Spec §2.1/§2.4.
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "test-dummy-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const { PROMPTS, promptBody, GATED_PROMPTS } = await import("../dist/index.js");

const STEP_MARKERS = ["1. PLAN", "2. DRY-RUN", "3. PRESENT", "4. CONFIRM", "5. EXECUTE", "6. VERIFY", "7. REPORT"];
const READ_ONLY = ["fleet-health-dashboard", "security-audit", "patch-compliance-review", "app-inventory-audit", "configure-webhooks-guide"];

test("GATED_PROMPTS is non-empty and every member is a registered prompt", () => {
  assert.ok(GATED_PROMPTS.size >= 1);
  const names = new Set(PROMPTS.map((p) => p.name));
  for (const g of GATED_PROMPTS) assert.ok(names.has(g), `${g} not in PROMPTS`);
  assert.equal(PROMPTS.length, GATED_PROMPTS.size + READ_ONLY.length, "every prompt must be either gated or in the READ_ONLY list");
});

test("every gated prompt body carries the 7 steps in order plus gate references", () => {
  for (const g of GATED_PROMPTS) {
    const body = promptBody(g, {});
    let idx = -1;
    for (const m of STEP_MARKERS) {
      const at = body.indexOf(m);
      assert.ok(at > idx, `${g}: marker "${m}" missing or out of order (found at ${at}, previous at ${idx})`);
      idx = at;
    }
    assert.match(body, /dry_run/, `${g}: must reference dry_run`);
    assert.match(body, /confirm_token/, `${g}: must reference confirm_token`);
    assert.match(body, /RECOVERY:/, `${g}: must carry a RECOVERY section`);
  }
});

test("read-only prompts are not gated and do not carry the skeleton", () => {
  for (const name of READ_ONLY) {
    assert.ok(!GATED_PROMPTS.has(name), `${name} must not be gated`);
    assert.ok(!promptBody(name, {}).includes("2. DRY-RUN"), `${name} must not carry the skeleton`);
  }
});
