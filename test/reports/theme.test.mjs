import { test } from "node:test";
import assert from "node:assert/strict";
import { headHtml } from "../../dist/reports/engine/theme.js";

test("a3-landscape preset embeds A3 landscape + the footer title", () => {
  const css = headHtml("a3-landscape", "SOFA Fleet Security Audit");
  assert.match(css, /size:\s*A3 landscape/);
  assert.match(css, /content:\s*"SOFA Fleet Security Audit"/);
  assert.match(css, /#0b3d5c/); // shared navy
});

test("letter-portrait preset embeds Letter portrait + the footer title", () => {
  const css = headHtml("letter-portrait", "Device Activity & Security Dossier");
  assert.match(css, /size:\s*Letter portrait/);
  assert.match(css, /content:\s*"Device Activity & Security Dossier"/);
});
