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
