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
