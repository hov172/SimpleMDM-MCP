import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("a3 preset equals scripts/audit-report.head.html modulo footer title", () => {
  const onDisk = readFileSync(new URL("../../scripts/audit-report.head.html", import.meta.url), "utf8");
  const norm = (s) => s.replace(/content:\s*"[^"]*"/g, 'content:"X"').replace(/\s+/g, " ").trim();
  assert.equal(norm(headHtml("a3-landscape", "SOFA Fleet Security Audit")), norm(onDisk));
});

test("letter-portrait preset equals scripts/logs-report.head.html modulo footer title", () => {
  const onDisk = readFileSync(new URL("../../scripts/logs-report.head.html", import.meta.url), "utf8");
  const norm = (s) => s.replace(/content:\s*"[^"]*"/g, 'content:"X"').replace(/\s+/g, " ").trim();
  assert.equal(norm(headHtml("letter-portrait", "SimpleMDM Device Activity & Security Dossier")), norm(onDisk));
});
