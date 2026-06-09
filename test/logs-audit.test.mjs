import { test } from "node:test";
import assert from "node:assert/strict";
import { toIso } from "../scripts/lib/logs.mjs";

test("toIso reformats MM/DD/YY HH:MM:SS to ISO 8601 with no TZ shift", () => {
  assert.equal(toIso("05/12/26 18:09:21"), "2026-05-12T18:09:21");
  assert.equal(toIso("06/02/26 09:00:00"), "2026-06-02T09:00:00");
});

test("toIso returns empty string for unparseable input", () => {
  assert.equal(toIso(""), "");
  assert.equal(toIso("not a date"), "");
  assert.equal(toIso(null), "");
});

import { parseArgs } from "../scripts/lib/logs.mjs";

test("parseArgs reads a single selector and flags", () => {
  const o = parseArgs(["--last-seen", "10", "--with-security", "--format", "csv"]);
  assert.deepEqual(o.selector, { kind: "last-seen", value: 10 });
  assert.equal(o.withSecurity, true);
  assert.equal(o.withInventory, false);
  assert.equal(o.format, "csv");
  assert.equal(o.error, null);
});

test("parseArgs splits --serial on commas", () => {
  const o = parseArgs(["--serial", "C02AAA111,D25BBB222"]);
  assert.deepEqual(o.selector, { kind: "serial", value: ["C02AAA111", "D25BBB222"] });
  assert.equal(o.format, "all");
});

test("parseArgs errors when no selector is given", () => {
  assert.match(parseArgs(["--format", "csv"]).error, /exactly one selector/);
});

test("parseArgs errors when multiple selectors are given", () => {
  assert.match(parseArgs(["--all", "--last-seen", "5"]).error, /exactly one selector/);
});

test("parseArgs requires --confirm-all for --all", () => {
  assert.match(parseArgs(["--all"]).error, /--confirm-all/);
  assert.equal(parseArgs(["--all", "--confirm-all"]).error, null);
});

import { selectDevices } from "../scripts/lib/logs.mjs";
import { readFileSync } from "node:fs";
const RAW = JSON.parse(readFileSync(new URL("./fixtures/devices-sample.json", import.meta.url))).data;

test("selectDevices --serial keeps matching serials in request order", () => {
  const r = selectDevices(RAW, { kind: "serial", value: ["E33CCC333", "C02AAA111"] }, new Set());
  assert.deepEqual(r.map((d) => d.attributes.serial_number), ["E33CCC333", "C02AAA111"]);
});

test("selectDevices --last-seen sorts by last_seen_at desc and limits", () => {
  const r = selectDevices(RAW, { kind: "last-seen", value: 2 }, new Set());
  assert.deepEqual(r.map((d) => d.id), [101, 102]);
});

test("selectDevices --all returns every device", () => {
  assert.equal(selectDevices(RAW, { kind: "all", value: true }, new Set()).length, 3);
});

test("selectDevices --group matches device_group id or assignment-group ids", () => {
  // group ids {7002} -> devices 101 and 102 carry group 7002
  const r = selectDevices(RAW, { kind: "group", value: "AnyName" }, new Set([7002]));
  assert.deepEqual(r.map((d) => d.id).sort(), [101, 102]);
});
