// Backfill (Task 6 coverage-diff gate): preserves the unit-level assertions that
// test/logs-audit.test.mjs held over the logs-export domain. Those assertions
// target dist/reports/domain/logs.js (the TS port) directly and are NOT otherwise
// re-proven by golden-parity (default bytes only) or logs-augment.test.mjs
// (buildLogsDossier integration). `flatten` has no TS port yet — the runtime
// (dist/reports/specs/logs.js, cli/inputs.js) still imports it from the live
// scripts/lib/simplemdm.mjs module, so its compatibility test is preserved here
// against that same still-live source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toIso, parseArgs, selectDevices, logRows, LOG_COLUMNS,
  statusSnapshotRows, STATUS_COLUMNS, statusSnapshotFile, statusSnapshotFiles,
  logSummaryRows, SUMMARY_COLUMNS, manifestRows, MANIFEST_COLUMNS, DISCLOSURES,
  renderDetailedReport, noisyDevices, deviceFindings, topInstalledApps,
  findingRows, FINDINGS_COLUMNS,
} from "../../dist/reports/domain/logs.js";
import { flatten } from "../../scripts/lib/simplemdm.mjs";

const RAW = JSON.parse(readFileSync(new URL("../fixtures/devices-sample.json", import.meta.url))).data;
const LOGS = JSON.parse(readFileSync(new URL("../fixtures/logs-sample.json", import.meta.url))).data;
const logsFor = (serial) => LOGS.filter((l) => l.attributes.relationships.device.data.serial_number === serial);

test("toIso reformats MM/DD/YY HH:MM:SS to ISO 8601 with no TZ shift", () => {
  assert.equal(toIso("05/12/26 18:09:21"), "2026-05-12T18:09:21");
  assert.equal(toIso("06/02/26 09:00:00"), "2026-06-02T09:00:00");
});

test("toIso returns empty string for unparseable input", () => {
  assert.equal(toIso(""), "");
  assert.equal(toIso("not a date"), "");
  assert.equal(toIso(null), "");
});

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

test("parseArgs accepts --report-detail summary|table|full and rejects others", () => {
  assert.equal(parseArgs(["--last-seen", "5"]).reportDetail, "summary");
  assert.equal(parseArgs(["--last-seen", "5", "--report-detail", "full"]).reportDetail, "full");
  assert.equal(parseArgs(["--last-seen", "5", "--report-detail", "table"]).error, null);
  assert.match(parseArgs(["--last-seen", "5", "--report-detail", "bogus"]).error, /Invalid --report-detail/);
});

test("parseArgs: --report-only flag; conflicts with --format csv", () => {
  const o = parseArgs(["--serial", "X1", "--report-only"]);
  assert.equal(o.reportOnly, true);
  assert.equal(o.error, null);
  assert.equal(parseArgs(["--serial", "X1"]).reportOnly, false);
  assert.match(parseArgs(["--serial", "X1", "--report-only", "--format", "csv"]).error, /--report-only/);
});

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
  const r = selectDevices(RAW, { kind: "group", value: "AnyName" }, new Set([7002]));
  assert.deepEqual(r.map((d) => d.id).sort(), [101, 102]);
});

test("logRows are chronologically sorted, typed, and exclude the status blob", () => {
  const rows = logRows([{ device: RAW[0], logs: logsFor("C02AAA111") }]);
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
  assert.ok(!("status_pretty" in status));
  assert.ok(LOG_COLUMNS.includes("at_iso") && !LOG_COLUMNS.includes("status_pretty"));
});

test("statusSnapshotRows isolate status.changed and reference an external snapshot file", () => {
  const rows = statusSnapshotRows([{ device: RAW[0], logs: logsFor("C02AAA111") }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sc_pending_build, "25D2128");
  assert.equal(rows[0].status_json_file, "status-snapshots/C02AAA111__L2.json");
  assert.ok(!("status_pretty" in rows[0]));
  assert.ok(STATUS_COLUMNS.includes("status_json_file") && !STATUS_COLUMNS.includes("status_pretty"));
  assert.ok(rows.every((r) => Object.values(r).every((v) => String(v).length <= 1000)));
});

test("statusSnapshotFile sanitizes serial/log id into a safe relative path", () => {
  assert.equal(statusSnapshotFile("C02/AA 1", "a b/c"), "status-snapshots/C02_AA_1__a_b_c.json");
});

test("statusSnapshotFiles emits one sidecar per status.changed log with the full status object", () => {
  const files = statusSnapshotFiles([{ device: RAW[0], logs: logsFor("C02AAA111") }]);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, "status-snapshots/C02AAA111__L2.json");
  assert.ok(files[0].json.softwareupdate);
});

test("statusSnapshotRows returns empty array when logs contain only app.installing", () => {
  const bundle = { device: RAW[0], logs: LOGS.filter((l) => l.attributes.event_type === "app.installing") };
  assert.deepEqual(statusSnapshotRows([bundle]), []);
});

test("logSummaryRows pivot event types and compute the coverage window", () => {
  const b1 = { device: RAW[0], logs: logsFor("C02AAA111") };
  const b2 = { device: RAW[1], logs: logsFor("D25BBB222") };
  const a = logSummaryRows([b1, b2]).find((r) => r.serial_number === "C02AAA111");
  assert.equal(a.total_log_records, 3);
  assert.equal(a.app_installing, 1);
  assert.equal(a.status_changed, 1);
  assert.equal(a.profile_installed, 1);
  assert.equal(a.first_event_at_iso, "2026-05-12T18:09:21");
  assert.equal(a.last_event_at_iso, "2026-06-02T09:00:00");
  assert.equal(a.span_days, 21);
  assert.ok(SUMMARY_COLUMNS.includes("span_days"));
});

test("logSummaryRows second device D25BBB222 has correct counts and span_days", () => {
  const d = logSummaryRows([{ device: RAW[1], logs: logsFor("D25BBB222") }])[0];
  assert.equal(d.serial_number, "D25BBB222");
  assert.equal(d.bootstrap_token_get, 1);
  assert.equal(d.total_log_records, 1);
  assert.equal(d.span_days, 0);
});

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

test("logRows, statusSnapshotRows, logSummaryRows tolerate logs: undefined", () => {
  const bundle = { device: RAW[0], logs: undefined };
  assert.deepEqual(logRows([bundle]), []);
  assert.deepEqual(statusSnapshotRows([bundle]), []);
  assert.equal(logSummaryRows([bundle])[0].total_log_records, 0);
});

test("logRows populates device_users from a bundle with a users array", () => {
  const bundle = {
    device: RAW[0],
    users: [
      { attributes: { full_name: "Full A", username: "a" } },
      { attributes: { full_name: "Full B", username: "b" } },
    ],
    logs: logsFor("C02AAA111"),
  };
  const rows = logRows([bundle]);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].device_users, "Full A (a) | Full B (b)");
});

test("flatten exposes the evaluateDevice-compatible shape (still legacy-sourced by the runtime)", () => {
  const d = flatten(RAW[1]);
  assert.equal(d.serial, "D25BBB222");
  assert.equal(d.model, "iMac21,1");
  assert.equal(d.osVersion, "14.7.1");
  assert.equal(d.filevault_enabled, false);
  assert.equal(d.firewall_enabled, false);
  assert.equal(d.device_group_id, null);
});

const mkBundle = (id, serial, n, name) => ({
  device: { id, attributes: { serial_number: serial, name: name ?? serial } },
  logs: Array.from({ length: n }, () => ({ attributes: { event_type: "status.changed", at: "05/01/26 00:00:00" } })),
});

test("noisyDevices flags a single device dominating log volume", () => {
  const out = noisyDevices([mkBundle(1, "A", 90), mkBundle(2, "B", 5), mkBundle(3, "C", 5)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].serial, "A");
  assert.equal(out[0].events, 90);
  assert.ok(out[0].share >= 0.25 && out[0].share <= 1);
});

test("noisyDevices does NOT flag an even distribution (no dominant device)", () => {
  assert.deepEqual(noisyDevices([mkBundle(1, "A", 10), mkBundle(2, "B", 10), mkBundle(3, "C", 10), mkBundle(4, "D", 10)]), []);
});

test("noisyDevices returns [] for a single device or zero events", () => {
  assert.deepEqual(noisyDevices([mkBundle(1, "A", 100)]), []);
  assert.deepEqual(noisyDevices([mkBundle(1, "A", 0), mkBundle(2, "B", 0)]), []);
});

test("renderDetailedReport escapes pipe characters in device_name", () => {
  const md = renderDetailedReport([{ device: { id: 999, attributes: { name: "Pipe|Device", serial_number: "X99XXX999" } }, logs: [] }], null, "2026-06-09");
  assert.match(md, /Pipe\\|Device/);
});

test("renderDetailedReport surfaces a noisy-device callout and ⚠ marker", () => {
  const md = renderDetailedReport([mkBundle(1, "NOISY1", 900, "Loud Mac"), mkBundle(2, "B", 50), mkBundle(3, "C", 50)], null, "2026-06-09");
  assert.match(md, /⚠ \*\*Noisy device:\*\* Loud Mac \(NOISY1\) — 900 events, 90% of all activity/);
  assert.match(md, /\| 900 ⚠ \|/);
});

test("renderDetailedReport omits the noisy callout when volume is balanced", () => {
  const md = renderDetailedReport([mkBundle(1, "A", 10), mkBundle(2, "B", 10)], null, "2026-06-09");
  assert.doesNotMatch(md, /Noisy device/);
});

test("renderDetailedReport builds a per-device dossier with roll-up, identity, activity and disclosures", () => {
  const bundle = {
    device: RAW[0],
    logs: logsFor("C02AAA111"),
    users: [{ attributes: { full_name: "Alice", username: "alice" } }],
    apps: [{ attributes: { name: "Falcon", managed: true } }, { attributes: { name: "Chrome", managed: false } }],
    profiles: [{ attributes: { name: "WiFi" } }],
  };
  const md = renderDetailedReport([bundle], null, "2026-06-09", { "7001": "Falcon", "7002": "Faculty" });
  assert.match(md, /# SimpleMDM Device Activity & Security Dossier/);
  assert.match(md, /## 1\. Fleet Roll-up/);
  assert.match(md, /## 2\. Per-Device Dossiers/);
  assert.match(md, /\*\*Identity\*\* — Serial `C02AAA111`/);
  assert.match(md, /Assignment groups \(2\):.*Falcon.*Faculty/);
  assert.match(md, /Local accounts:\*\* alice/);
  assert.match(md, /2 installed apps \(1 MDM-managed\); 1 configuration profiles/);
  assert.match(md, /Notable software-update events/);
  assert.match(md, /## 3\. Disclosures/);
  assert.doesNotMatch(md, /actively exploited/);
});

test("renderDetailedReport includes per-device CVE findings when securityEval is provided", () => {
  const bundle = { device: RAW[0], logs: [] };
  const md = renderDetailedReport([bundle], [{ serial: "C02AAA111", osVersion: "15.6.1", cvesBehind: 12, exploitedBehind: 2, findings: ["OS outdated", "FileVault disabled"] }], "2026-06-09");
  assert.match(md, /Unfixed CVEs: \*\*12\*\* \(2 actively exploited\)/);
  assert.match(md, /Findings: OS outdated; FileVault disabled/);
  assert.match(md, /\n\n> Findings:/);
});

const appLog = (name, id, ver) => ({ attributes: { event_type: "app.installing", at: "05/01/26 00:00:00", metadata: { name, bundle_identifier: id, version: ver } } });
const statusFail = () => ({ attributes: { event_type: "status.changed", at: "05/01/26 00:00:00", metadata: { status: { softwareupdate: { failure_reason: { count: 5, reason: "boom" } } } } } });
const profLog = (n) => ({ attributes: { event_type: "profile.installed", at: "05/01/26 00:00:00", metadata: { profile_name: n } } });

test("topInstalledApps ranks apps by install-event count", () => {
  const t = topInstalledApps({ logs: [appLog("Photoshop", "com.adobe.ps", "0.0"), appLog("Photoshop", "com.adobe.ps", "0.0"), appLog("Chrome", "com.google.Chrome", "1")] });
  assert.equal(t[0].name, "Photoshop");
  assert.equal(t[0].count, 2);
});

test("deviceFindings flags an app reinstall loop (same app+version many times)", () => {
  const logs = Array.from({ length: 12 }, () => appLog("Adobe Photoshop", "com.adobe.Photoshop", "0.0"));
  const loop = deviceFindings({ logs }).find((x) => x.type === "app-reinstall-loop");
  assert.ok(loop);
  assert.match(loop.detail, /installed 12×/);
  assert.match(loop.title, /Photoshop/);
});

test("deviceFindings does NOT flag normal app installs (distinct versions, low counts)", () => {
  const logs = [appLog("Firefox", "org.mozilla.firefox", "150"), appLog("Firefox", "org.mozilla.firefox", "151"), appLog("Chrome", "com.google.Chrome", "1")];
  assert.deepEqual(deviceFindings({ logs }).filter((x) => x.type === "app-reinstall-loop"), []);
});

test("deviceFindings flags a software-update failure loop", () => {
  const upd = deviceFindings({ logs: Array.from({ length: 11 }, statusFail) }).find((x) => x.type === "update-failure-loop");
  assert.ok(upd);
  assert.match(upd.detail, /11 status.changed/);
  assert.match(upd.detail, /boom/);
});

test("deviceFindings flags profile churn", () => {
  const f = deviceFindings({ logs: Array.from({ length: 6 }, () => profLog("WiFi")) });
  assert.ok(f.find((x) => x.type === "profile-churn" && /WiFi/.test(x.title)));
});

test("deviceFindings returns [] for a healthy device", () => {
  assert.deepEqual(deviceFindings({ logs: [appLog("Firefox", "org.mozilla.firefox", "150"), profLog("WiFi"), statusFail()] }), []);
});

test("findingRows flattens per-device findings into csv rows", () => {
  const dev = { id: 7, attributes: { serial_number: "S7", name: "Loud" } };
  const logs = Array.from({ length: 12 }, () => appLog("Photoshop", "com.adobe.ps", "0.0"));
  const rows = findingRows([{ device: dev, logs }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serial_number, "S7");
  assert.equal(rows[0].type, "app-reinstall-loop");
  assert.ok(FINDINGS_COLUMNS.includes("title") && FINDINGS_COLUMNS.includes("detail"));
});

test("renderDetailedReport surfaces a top-apps table and a per-device Findings block", () => {
  const dev = { id: 1, attributes: { serial_number: "S1", name: "Loud Mac" } };
  const logs = Array.from({ length: 12 }, () => appLog("Adobe Photoshop", "com.adobe.Photoshop", "0.0"));
  const md = renderDetailedReport([{ device: dev, logs }, { device: { id: 2, attributes: { serial_number: "S2", name: "Quiet" } }, logs: [appLog("Chrome", "com.google.Chrome", "1")] }], null, "2026-06-09");
  assert.match(md, /🔎 \*\*Findings:\*\*/);
  assert.match(md, /\*\*Top installed apps \(by install count\):\*\*/);
  assert.match(md, /\| Adobe Photoshop \| 0\.0 \| 12 \|/);
  assert.match(md, /> ⚠ \*\*Findings \(1\):\*\*/);
  assert.match(md, /App reinstall loop/);
});

test("renderDetailedReport detail modes: summary omits the full table, full includes it", () => {
  const b = { device: { id: 1, attributes: { serial_number: "S1", name: "M" } }, logs: [appLog("Chrome", "com.google.Chrome", "1")] };
  const summary = renderDetailedReport([b, b], null, "2026-06-09", {}, { detail: "summary" });
  const full = renderDetailedReport([b, b], null, "2026-06-09", {}, { detail: "full" });
  assert.doesNotMatch(summary, /Full event log/);
  assert.match(full, /\*\*Full event log \(1 events\):\*\*/);
});

test("renderDetailedReport: report-only wording drops references to CSV/JSON artifacts", () => {
  const b = { device: { id: 1, attributes: { name: "A", serial_number: "X1XXX1111" } }, logs: [] };
  const normal = renderDetailedReport([b], null, "2026-06-11", {}, {});
  assert.match(normal, /CSV\/JSON artifacts in this export remain authoritative/);
  assert.match(normal, /status-snapshots\//);
  const ro = renderDetailedReport([b], null, "2026-06-11", {}, { reportOnly: true });
  assert.doesNotMatch(ro, /remain authoritative/);
  assert.doesNotMatch(ro, /are the verbatim record/);
  assert.doesNotMatch(ro, /status-snapshots\//);
  assert.doesNotMatch(ro, /raw-logs\.json/);
  assert.match(ro, /report-only export/i);
  assert.match(ro, /re-run without --report-only/i);
});

test("manifestRows completeness disclosure flips to PARTIAL when failures are present", () => {
  const files = [{ file: "logs.csv", description: "events", record_scope: "3 events", data_row_count: 3, bytes: 100, sha256: "abc" }];
  const failures = [{ serial: "FAIL1", section: "logs", message: "SimpleMDM /logs failed 429" }];
  const rows = manifestRows(files, "2026-06-09T12:00:00-04:00", failures);
  const completeness = rows.find((r) => /completeness/i.test(r.file));
  assert.ok(completeness, "completeness disclosure must still be present");
  assert.match(completeness.description, /PARTIAL/i, "must disclose the export is partial");
  assert.match(completeness.description, /FAIL1/, "must name the failed device");
  assert.doesNotMatch(completeness.description, /All collections returned has_more=false/,
    "must not attest completeness when devices failed");
});

test("manifestRows without failures keeps the completeness attestation", () => {
  const files = [{ file: "logs.csv", description: "events", record_scope: "3 events", data_row_count: 3, bytes: 100, sha256: "abc" }];
  const rows = manifestRows(files, "2026-06-09T12:00:00-04:00");
  const completeness = rows.find((r) => /completeness/i.test(r.file));
  assert.match(completeness.description, /has_more=false/);
  assert.doesNotMatch(completeness.description, /PARTIAL/i);
});
