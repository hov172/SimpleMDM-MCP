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

import { logRows, LOG_COLUMNS } from "../scripts/lib/logs.mjs";
const LOGS = JSON.parse(readFileSync(new URL("./fixtures/logs-sample.json", import.meta.url))).data;

test("logRows are chronologically sorted, typed, and exclude the status blob", () => {
  const bundle = { device: RAW[0], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "C02AAA111") };
  const rows = logRows([bundle]);
  assert.deepEqual(rows.map((r) => r.at_iso), ["2026-05-12T18:09:21", "2026-05-20T10:30:00", "2026-06-02T09:00:00"]);
  const app = rows[0];
  assert.equal(app.event_type, "app.installing");
  assert.equal(app.app_name, "Google Chrome");
  assert.equal(app.app_identifier, "com.google.Chrome");
  assert.equal(app.device_name, "Alice Mac - C02AAA111");
  assert.match(app.summary, /Google Chrome/);
  const status = rows[1];
  assert.equal(status.sc_filevault_enabled, "false");
  assert.equal(status.sc_pending_os, "26.3.1");
  assert.equal(status.sc_failure_count, "2");
  assert.ok(!("status_pretty" in status), "main rows must not carry the full status blob");
  assert.ok(LOG_COLUMNS.includes("at_iso") && !LOG_COLUMNS.includes("status_pretty"));
});

import { statusSnapshotRows, STATUS_COLUMNS } from "../scripts/lib/logs.mjs";

test("statusSnapshotRows isolate status.changed and carry a multi-line status_pretty cell", () => {
  const bundle = { device: RAW[0], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "C02AAA111") };
  const rows = statusSnapshotRows([bundle]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sc_pending_build, "25D2128");
  assert.ok(rows[0].status_pretty.includes("\n"), "status_pretty must be multi-line (pretty JSON)");
  assert.match(rows[0].status_pretty, /softwareupdate/);
  assert.ok(STATUS_COLUMNS.includes("status_pretty"));
});

import { logSummaryRows, SUMMARY_COLUMNS } from "../scripts/lib/logs.mjs";

test("logSummaryRows pivot event types and compute the coverage window", () => {
  const b1 = { device: RAW[0], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "C02AAA111") };
  const b2 = { device: RAW[1], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "D25BBB222") };
  const rows = logSummaryRows([b1, b2]);
  const a = rows.find((r) => r.serial_number === "C02AAA111");
  assert.equal(a.total_log_records, 3);
  assert.equal(a.app_installing, 1);
  assert.equal(a.status_changed, 1);
  assert.equal(a.profile_installed, 1);
  assert.equal(a.first_event_at_iso, "2026-05-12T18:09:21");
  assert.equal(a.last_event_at_iso, "2026-06-02T09:00:00");
  assert.equal(a.span_days, 21);
  assert.ok(SUMMARY_COLUMNS.includes("span_days"));
});

import { manifestRows, MANIFEST_COLUMNS, DISCLOSURES } from "../scripts/lib/logs.mjs";

test("manifestRows pass files through and append disclosures", () => {
  const files = [{ file: "logs.csv", description: "events", record_scope: "3 events", data_row_count: 3, bytes: 100, sha256: "abc" }];
  const rows = manifestRows(files, "2026-06-09T12:00:00-04:00");
  assert.equal(rows[0].file, "logs.csv");
  assert.equal(rows[0].generated_at, "2026-06-09T12:00:00-04:00");
  assert.equal(rows.length, files.length + DISCLOSURES.length);
  assert.ok(rows.some((r) => /timezone/i.test(r.file) && /NOT UTC/i.test(r.description)));
  assert.ok(rows.some((r) => /retention/i.test(r.file)));
  assert.ok(MANIFEST_COLUMNS.includes("sha256"));
});

import { renderLogsMarkdown } from "../scripts/lib/logs.mjs";

test("renderLogsMarkdown includes a logs summary and omits security when not requested", () => {
  const summary = logSummaryRows([{ device: RAW[0], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "C02AAA111") }]);
  const md = renderLogsMarkdown(summary, null, "2026-06-09");
  assert.match(md, /# SimpleMDM Logs Audit/);
  assert.match(md, /Activity Summary/);
  assert.match(md, /C02AAA111/);
  assert.doesNotMatch(md, /Security Posture/);
});

test("renderLogsMarkdown includes a security section when eval is provided", () => {
  const summary = logSummaryRows([{ device: RAW[0], logs: [] }]);
  const md = renderLogsMarkdown(summary, [{ serial: "C02AAA111", osVersion: "15.6.1", findings: ["FileVault disabled"], cvesBehind: 3 }], "2026-06-09");
  assert.match(md, /Security Posture/);
  assert.match(md, /FileVault disabled/);
});

// Fix 1: parseArgs invalid-value guards
test("parseArgs --last-seen with non-integer value errors with positive integer message", () => {
  assert.match(parseArgs(["--last-seen", "foo"]).error, /positive integer/);
});

test("parseArgs --last-seen with missing value errors with positive integer message", () => {
  assert.match(parseArgs(["--last-seen"]).error, /positive integer/);
});

test("parseArgs --serial with empty string errors with at least one serial message", () => {
  assert.match(parseArgs(["--serial", ""]).error, /at least one serial/);
});

test("parseArgs --group with missing value errors with group name message", () => {
  assert.match(parseArgs(["--group"]).error, /group name/);
});

test("parseArgs --group with valid value succeeds", () => {
  const o = parseArgs(["--group", "Faculty"]);
  assert.deepEqual(o.selector, { kind: "group", value: "Faculty" });
  assert.equal(o.error, null);
});

// Fix 4: Markdown pipe-escaping
test("renderLogsMarkdown escapes pipe characters in device_name", () => {
  const summary = logSummaryRows([{ device: { id: 999, attributes: { name: "Pipe|Device", serial_number: "X99XXX999" } }, logs: [] }]);
  const md = renderLogsMarkdown(summary, null, "2026-06-09");
  assert.match(md, /Pipe\\|Device/);
});

// Fix 7: Missing-coverage tests
test("logRows, statusSnapshotRows, logSummaryRows tolerate logs: undefined", () => {
  const bundle = { device: RAW[0], logs: undefined };
  assert.deepEqual(logRows([bundle]), []);
  assert.deepEqual(statusSnapshotRows([bundle]), []);
  const sum = logSummaryRows([bundle]);
  assert.equal(sum[0].total_log_records, 0);
});

test("logRows populates device_users from a bundle with a users array", () => {
  const bundle = {
    device: RAW[0],
    users: [
      { attributes: { full_name: "Full A", username: "a" } },
      { attributes: { full_name: "Full B", username: "b" } },
    ],
    logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "C02AAA111"),
  };
  const rows = logRows([bundle]);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].device_users, "Full A (a) | Full B (b)");
});

test("logSummaryRows second device D25BBB222 has correct counts and span_days", () => {
  const b2 = { device: RAW[1], logs: LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === "D25BBB222") };
  const rows = logSummaryRows([b2]);
  const d = rows[0];
  assert.equal(d.serial_number, "D25BBB222");
  assert.equal(d.bootstrap_token_get, 1);
  assert.equal(d.total_log_records, 1);
  assert.equal(d.span_days, 0);
});

test("statusSnapshotRows returns empty array when logs contain only app.installing", () => {
  const bundle = { device: RAW[0], logs: LOGS.filter((l) => l.attributes.event_type === "app.installing") };
  assert.deepEqual(statusSnapshotRows([bundle]), []);
});
