import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, QueryError } from "../scripts/lib/query.mjs";

test("tokenize splits on whitespace and keeps quoted phrases together", () => {
  assert.deepEqual(tokenize('macbook os:<15.5 -group:loaners'), ["macbook", "os:<15.5", "-group:loaners"]);
  assert.deepEqual(tokenize('app:"microsoft office" type:laptop'), ['app:"microsoft office"', "type:laptop"]);
  assert.deepEqual(tokenize('  "faculty staff"   x '), ['"faculty staff"', "x"]);
});

test("tokenize throws QueryError on an unbalanced quote", () => {
  assert.throws(() => tokenize('group:"Faculty'), QueryError);
});

test("tokenize of empty/blank input returns []", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
});

import { parseTerm } from "../scripts/lib/query.mjs";

test("parseTerm: bare keyword and quoted phrase", () => {
  assert.deepEqual(parseTerm("macbook"), { neg: false, field: null, src: "macbook", alts: [{ match: "substr", text: "macbook" }] });
  assert.equal(parseTerm('"faculty staff"').alts[0].text, "faculty staff");
});

test("parseTerm: negation on keywords and fields", () => {
  assert.equal(parseTerm("-loaner").neg, true);
  const t = parseTerm("-group:loaners");
  assert.equal(t.neg, true);
  assert.equal(t.field, "group");
});

test("parseTerm: text field with comma-list OR and wildcard", () => {
  const t = parseTerm("group:faculty,staff");
  assert.equal(t.alts.length, 2);
  const w = parseTerm("serial:C02*");
  assert.equal(w.alts[0].match, "glob");
  assert.ok(w.alts[0].re.test("C02FAC111"));
  assert.ok(!w.alts[0].re.test("D25STA222"));
});

test("parseTerm: version comparators and ranges", () => {
  assert.deepEqual(parseTerm("os:<15.5").alts[0], { match: "cmp", op: "<", value: "15.5" });
  assert.deepEqual(parseTerm("os:15.1..15.7").alts[0], { match: "range", lo: "15.1", hi: "15.7" });
  assert.deepEqual(parseTerm("os:15").alts[0], { match: "verbare", value: "15" });
});

test("parseTerm: date absolute, relative, comparator, range", () => {
  assert.equal(parseTerm("seen:90d").alts[0].match, "rel");
  assert.equal(parseTerm("seen:90d").alts[0].days, 90);
  assert.equal(parseTerm("seen:>=2025-01-01").alts[0].match, "cmp");
  assert.equal(parseTerm("enrolled:2025-01-01..2025-06-30").alts[0].match, "range");
  assert.equal(parseTerm("enrolled:2025-01-10").alts[0].match, "day");
  assert.throws(() => parseTerm("seen:notadate"), /Bad date/);
});

test("parseTerm: number and bool kinds", () => {
  assert.deepEqual(parseTerm("storage:<20").alts[0], { match: "cmp", op: "<", n: 20 });
  assert.deepEqual(parseTerm("battery:50").alts[0], { match: "eq", n: 50 });
  assert.equal(parseTerm("filevault:off").alts[0].value, false);
  assert.equal(parseTerm("dep:yes").alts[0].value, true);
  assert.throws(() => parseTerm("filevault:maybe"), /on\/off/);
});

test("parseTerm: app name with optional version tail", () => {
  assert.deepEqual(parseTerm("app:zoom").alts[0], { match: "app", name: "zoom" });
  assert.deepEqual(parseTerm("app:zoom<6.0.10").alts[0], { match: "app", name: "zoom", op: "<", ver: "6.0.10" });
  assert.equal(parseTerm('app:"microsoft office"').alts[0].name, "microsoft office");
});

test("parseTerm: attr.<name> dynamic field", () => {
  const t = parseTerm("attr.xprotect_version:5305");
  assert.equal(t.field, "attr");
  assert.equal(t.attrName, "xprotect_version");
});

test("parseTerm: unknown field fails fast listing valid fields; empty value fails", () => {
  assert.throws(() => parseTerm("bogus:x"), /Unknown field "bogus:"/);
  assert.throws(() => parseTerm("bogus:x"), /valid fields/i);
  assert.throws(() => parseTerm("os:"), /needs a value/);
  assert.throws(() => parseTerm("attr.:5"), /attr\./);
});

import { parseQuery, planQuery, sectionsReferenced } from "../scripts/lib/query.mjs";

test("parseQuery groups OR-adjacent terms into one unit, ANDs the rest", () => {
  const ast = parseQuery("macbook os:<15.5 serial:C02* OR serial:FVFG*");
  assert.equal(ast.units.length, 3);
  assert.equal(ast.units[2].terms.length, 2);
});

test("parseQuery rejects dangling OR and empty queries", () => {
  assert.throws(() => parseQuery("OR x"), /both sides/);
  assert.throws(() => parseQuery("x OR"), /both sides/);
  assert.throws(() => parseQuery(""), /Empty/);
});

test("planQuery: pure device-level query has an empty per-device pass", () => {
  const p = planQuery(parseQuery("group:faculty,staff seen:>=2025-01-01"));
  assert.equal(p.deviceUnits.length, 2);
  assert.equal(p.perDeviceUnits.length, 0);
});

test("planQuery: mixed-scope OR unit is NEVER a prefilter unit (Codex finding 1)", () => {
  const p = planQuery(parseQuery("group:faculty OR app:zoom"));
  assert.equal(p.deviceUnits.length, 0);
  assert.equal(p.perDeviceUnits.length, 1);
});

test("planQuery: bare keywords and negated per-device terms are per-device", () => {
  const p = planQuery(parseQuery("macbook -app:zoom os:<15.5"));
  assert.equal(p.deviceUnits.length, 1);     // os:<15.5
  assert.equal(p.perDeviceUnits.length, 2);  // keyword + -app:
});

test("sectionsReferenced lists the per-device sections a query touches", () => {
  assert.deepEqual([...sectionsReferenced(parseQuery("app:zoom user:alice os:15"))].sort(), ["apps", "users"]);
  assert.deepEqual([...sectionsReferenced(parseQuery("os:15"))], []);
});

import { evaluate } from "../scripts/lib/query.mjs";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const REC = {
  name: "Alice MBP", device_name: "ALICE-MBP", serial: "C02FAC111", udid: "UDID-201", imei: "",
  wifi_mac: "a4:83:e7:11:11:11", ethernet_macs: ["a4:83:e7:11:11:12"], last_ip: "10.42.1.10",
  model_id: "MacBookPro18,1", model_name: "MacBook Pro (16-inch, M1 Pro, 2021)", model_year: "2021",
  type: "laptop", arch: "arm64", os_version: "15.5", build_version: "24F74",
  device_group: "Faculty", assignment_groups: ["Faculty Apps"], assigned_apps: ["Zoom", "Google Chrome"],
  seen_at: "2026-06-09T16:00:00.000-04:00", enrolled_at: "2025-02-01T10:00:00.000-04:00",
  storage_free_gb: 512.5, storage_total_gb: 994.66, battery_pct: 88,
  filevault: true, sip: true, firewall: true, supervised: true, recoverykey: true, dep: true,
  status: "enrolled", attrs: { xprotect_version: "5305" },
  apps: [{ name: "zoom.us", identifier: "us.zoom.xos", version: "5.9.0", managed: true }],
  profiles: [{ name: "WiFi - Campus", identifier: "edu.slc.wifi" }],
  users: [{ username: "alice", full_name: "Alice Anderson" }],
  sections: { apps: "ok", profiles: "ok", users: "ok" },
};

test("evaluate: keywords AND across fields; reasons carry the source tokens", () => {
  const r = evaluate(parseQuery("macbook faculty"), REC, { now: NOW });
  assert.equal(r.matched, true);
  assert.deepEqual(r.reasons, ["macbook", "faculty"]);
  assert.equal(evaluate(parseQuery("macbook windows"), REC, { now: NOW }).matched, false);
});

test("evaluate: version compare is numeric not lexicographic (15.10 > 15.9)", () => {
  const rec = { ...REC, os_version: "15.10" };
  assert.equal(evaluate(parseQuery("os:>15.9"), rec, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("os:<15.9"), rec, { now: NOW }).matched, false);
  assert.equal(evaluate(parseQuery("os:15"), rec, { now: NOW }).matched, true); // bare = major prefix
});

test("evaluate: dates — relative window, comparator, range, exact day", () => {
  assert.equal(evaluate(parseQuery("seen:90d"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("seen:>=2025-01-01"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("enrolled:2025-01-01..2025-06-30"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("enrolled:2025-02-01"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("seen:1d"), { ...REC, seen_at: "2024-11-01T09:00:00.000-04:00" }, { now: NOW }).matched, false);
});

test("evaluate: booleans, null posture matches neither on nor off", () => {
  assert.equal(evaluate(parseQuery("filevault:on"), REC, { now: NOW }).matched, true);
  const ipad = { ...REC, filevault: null };
  assert.equal(evaluate(parseQuery("filevault:on"), ipad, { now: NOW }).matched, false);
  assert.equal(evaluate(parseQuery("filevault:off"), ipad, { now: NOW }).matched, false);
});

test("evaluate: app term matches name or identifier, with version tail", () => {
  assert.equal(evaluate(parseQuery("app:zoom"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("app:zoom<6.0.10"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("app:zoom>=6.0.10"), REC, { now: NOW }).matched, false);
  assert.equal(evaluate(parseQuery("app:photoshop"), REC, { now: NOW }).matched, false);
});

test("evaluate: OR units, negation, comma-lists, attr fields, groups", () => {
  assert.equal(evaluate(parseQuery("group:faculty,staff"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("serial:ZZZ* OR serial:C02*"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("-group:loaners"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("-group:faculty"), REC, { now: NOW }).matched, false);
  assert.equal(evaluate(parseQuery("attr.xprotect_version:5305"), REC, { now: NOW }).matched, true);
  assert.equal(evaluate(parseQuery("assigned:zoom -app:photoshop"), REC, { now: NOW }).matched, true);
});

test("evaluate: failed section makes dependent terms unknown, not false (Codex finding 3)", () => {
  const broken = { ...REC, apps: null, sections: { ...REC.sections, apps: "failed" } };
  assert.equal(evaluate(parseQuery("app:zoom"), broken, { now: NOW }).matched, "unknown");
  assert.equal(evaluate(parseQuery("-app:zoom"), broken, { now: NOW }).matched, "unknown");
  // device-level term still decides on its own
  assert.equal(evaluate(parseQuery("os:15 app:zoom"), { ...broken, os_version: "14.1" }, { now: NOW }).matched, false);
  // keyword that matches an available field is still true
  assert.equal(evaluate(parseQuery("macbook"), broken, { now: NOW }).matched, true);
  // keyword with no hit and a failed section is unknown
  assert.equal(evaluate(parseQuery("photoshop"), broken, { now: NOW }).matched, "unknown");
});

test("evaluate: row hits flag the matching app rows for matched=yes CSV columns", () => {
  const r = evaluate(parseQuery("app:zoom user:alice"), REC, { now: NOW });
  assert.ok(r.hits.apps.has("zoom.us"));
  assert.ok(r.hits.users.has("alice"));
  assert.equal(r.hits.profiles.size, 0);
});
