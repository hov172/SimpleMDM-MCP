# Logs Audit Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/logs-audit` — a targeted, legal/forensic SimpleMDM device-log export command (engine + skill), sibling to the SOFA `/audit`, with selectors, opt-in `--with-inventory`/`--with-security`, and CSV/JSON/manifest/md/docx/pdf output.

**Architecture:** A Node ESM engine `scripts/logs-audit.mjs` orchestrates: resolve devices → fetch logs (+inventory/+security) → build rows via a new pure module `scripts/lib/logs.mjs` → write artifacts. All CSV goes through the existing `render.mjs` `toCsv`/`esc`; security reuses `evaluate.mjs`; the API client `simplemdm.mjs` is extended. All transform/selection/parse logic lives in pure, unit-tested functions in `lib/logs.mjs`; the entry script and network fetchers are thin.

**Tech Stack:** Plain ESM JavaScript, Node ≥18 built-ins only (`fetch`, `node:fs`, `node:path`, `node:crypto`), `node:test`. `pandoc`/`make-audit-pdf.sh` shelled out for docx/pdf. No npm deps.

**Spec:** `docs/superpowers/specs/2026-06-09-logs-audit-command-design.md`

---

## File Structure

- **Create** `scripts/lib/logs.mjs` — pure functions: `parseArgs`, `toIso`, `selectDevices`, `logRows`, `statusSnapshotRows`, `logSummaryRows`, `manifestRows`, `DISCLOSURES`, `renderLogsMarkdown`. No network, no fs.
- **Create** `scripts/logs-audit.mjs` — entry: arg parsing (delegates to `parseArgs`), `.env` key load, orchestration, fs writes, stdout summary.
- **Modify** `scripts/lib/simplemdm.mjs` — export `flatten`; add `fetchAllDevicesRaw`, `fetchDeviceLogs`, `fetchDeviceApps`, `fetchDeviceProfiles`, `fetchDeviceUsers`, `fetchAssignmentGroups`; refactor `fetchAllDevices` to map `flatten` over `fetchAllDevicesRaw`.
- **Create** `test/logs-audit.test.mjs` — `node:test` suite over the pure functions.
- **Create** `test/fixtures/logs-sample.json`, `test/fixtures/devices-sample.json` — fixtures.
- **Create** `.claude/skills/logs-audit/SKILL.md` — the `/logs-audit` command wrapper.
- **Modify** `CHANGELOG.md` — add an Unreleased entry.

Reused unchanged: `scripts/lib/render.mjs` (`toCsv`, `esc`), `scripts/lib/evaluate.mjs` (`buildMajorTables`, `evaluateDevice`, `deviceCveRows`), `scripts/lib/sofa.mjs` (`loadSofa`), `scripts/lib/docx.mjs` (`mdToDocx`), `scripts/make-audit-pdf.sh`.

---

## Task 1: Test fixtures

**Files:**
- Create: `test/fixtures/devices-sample.json`
- Create: `test/fixtures/logs-sample.json`

- [ ] **Step 1: Create `test/fixtures/devices-sample.json`** (raw `/devices` shape, trimmed to fields the code reads)

```json
{ "data": [
  { "type": "device", "id": 101, "attributes": {
      "name": "Alice Mac - C02AAA111", "device_name": "ALICE-MBP", "serial_number": "C02AAA111",
      "udid": "UDID-101", "product_name": "MacBookPro18,1", "model": "MacBookPro18,1",
      "os_version": "15.6.1", "last_seen_at": "2026-06-09T16:00:00.000-04:00",
      "filevault_enabled": true, "system_integrity_protection_enabled": true, "firewall": { "enabled": true },
      "time_zone": "America/New_York" },
    "relationships": {
      "device_group": { "data": { "type": "device_group", "id": 91899 } },
      "groups": { "data": [ { "type": "group", "id": 7001 }, { "type": "group", "id": 7002 } ], "count": 2 },
      "custom_attribute_values": { "data": [], "count": 0 } } },
  { "type": "device", "id": 102, "attributes": {
      "name": "Bob iMac", "device_name": "BOB-IMAC", "serial_number": "D25BBB222",
      "udid": "UDID-102", "product_name": "iMac21,1", "model": "iMac21,1",
      "os_version": "14.7.1", "last_seen_at": "2026-06-09T15:59:00.000-04:00",
      "filevault_enabled": false, "system_integrity_protection_enabled": true, "firewall": { "enabled": false },
      "time_zone": null },
    "relationships": {
      "device_group": { "data": { "type": "device_group", "id": null } },
      "groups": { "data": [ { "type": "group", "id": 7002 } ], "count": 1 },
      "custom_attribute_values": { "data": [], "count": 0 } } },
  { "type": "device", "id": 103, "attributes": {
      "name": "Carol Mini", "device_name": "CAROL", "serial_number": "E33CCC333",
      "udid": "UDID-103", "product_name": "Macmini9,1", "model": "Macmini9,1",
      "os_version": "15.7.7", "last_seen_at": "2026-06-09T15:58:00.000-04:00",
      "filevault_enabled": true, "system_integrity_protection_enabled": true, "firewall": { "enabled": true },
      "time_zone": null },
    "relationships": {
      "device_group": { "data": { "type": "device_group", "id": 91899 } },
      "groups": { "data": [], "count": 0 },
      "custom_attribute_values": { "data": [], "count": 0 } } }
], "has_more": false }
```

- [ ] **Step 2: Create `test/fixtures/logs-sample.json`** (raw `/logs` shape; the four observed event types, deliberately out of chronological order)

```json
{ "data": [
  { "type": "log", "id": "L3", "attributes": { "namespace": "device", "event_type": "profile.installed",
      "level": 0, "source": "device", "at": "06/02/26 09:00:00",
      "metadata": { "profile_name": "WiFi Profile" },
      "relationships": { "account": { "data": { "type": "account", "id": 25950 } },
        "device": { "data": { "type": "device", "serial_number": "C02AAA111", "udid": "UDID-101" } } } } },
  { "type": "log", "id": "L1", "attributes": { "namespace": "device", "event_type": "app.installing",
      "level": 0, "source": "device", "at": "05/12/26 18:09:21",
      "metadata": { "name": "Google Chrome", "bundle_identifier": "com.google.Chrome", "version": "149.0", "via_munki": true },
      "relationships": { "account": { "data": { "type": "account", "id": 25950 } },
        "device": { "data": { "type": "device", "serial_number": "C02AAA111", "udid": "UDID-101" } } } } },
  { "type": "log", "id": "L2", "attributes": { "namespace": "device", "event_type": "status.changed",
      "level": 0, "source": "device", "at": "05/20/26 10:30:00",
      "metadata": { "channel": "device", "status": {
        "diskmanagement": { "filevault": { "enabled": false } },
        "softwareupdate": { "install_state": "prepared",
          "pending_version": { "os_version": "26.3.1", "build_version": "25D2128" },
          "failure_reason": { "count": 2, "reason": "BootPolicy failure" } } } },
      "relationships": { "account": { "data": { "type": "account", "id": 25950 } },
        "device": { "data": { "type": "device", "serial_number": "C02AAA111", "udid": "UDID-101" } } } } },
  { "type": "log", "id": "L4", "attributes": { "namespace": "device", "event_type": "bootstrap_token.get",
      "level": 0, "source": "device", "at": "06/01/26 08:00:00",
      "metadata": { "udid": "UDID-102" },
      "relationships": { "account": { "data": { "type": "account", "id": 25950 } },
        "device": { "data": { "type": "device", "serial_number": "D25BBB222", "udid": "UDID-102" } } } } }
], "has_more": false }
```

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/devices-sample.json test/fixtures/logs-sample.json
git commit -m "test: add logs-audit fixtures"
```

---

## Task 2: `toIso` (timestamp normalization, no TZ shift)

**Files:**
- Create: `scripts/lib/logs.mjs`
- Create: `test/logs-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (`test/logs-audit.test.mjs`)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — cannot find module `../scripts/lib/logs.mjs` / `toIso` not exported.

- [ ] **Step 3: Write minimal implementation** (`scripts/lib/logs.mjs`)

```javascript
// Pure helpers for the logs-audit engine. No network, no fs.

// "MM/DD/YY HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS". Same wall-clock, NO timezone
// shift and NO UTC claim (the /logs API does not stamp an offset). "" if unparseable.
export function toIso(at) {
  if (typeof at !== "string") return "";
  const m = at.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, mo, d, y, hh, mm, ss] = m;
  return `20${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add toIso timestamp normalization for logs-audit"
```

---

## Task 3: `parseArgs` (CLI parsing + validation)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/logs-audit.test.mjs`)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — `parseArgs` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `scripts/lib/logs.mjs`)

```javascript
// Parse argv (the slice after `node script.mjs`). Returns a normalized options
// object with `error` set to a usage string when invalid (never throws).
export function parseArgs(argv) {
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name) => argv.includes(name);

  const selectors = [];
  if (has("--serial")) selectors.push({ kind: "serial", value: (val("--serial") ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
  if (has("--last-seen")) selectors.push({ kind: "last-seen", value: parseInt(val("--last-seen") ?? "", 10) });
  if (has("--group")) selectors.push({ kind: "group", value: val("--group") ?? "" });
  if (has("--all")) selectors.push({ kind: "all", value: true });

  const opts = {
    selector: selectors[0] ?? null,
    withInventory: has("--with-inventory"),
    withSecurity: has("--with-security"),
    format: val("--format") ?? "all",
    out: val("--out") ?? null,
    error: null,
  };
  if (selectors.length !== 1) { opts.error = "Provide exactly one selector: --serial | --last-seen | --group | --all"; return opts; }
  if (opts.selector.kind === "all" && !has("--confirm-all")) { opts.error = "--all requires --confirm-all (whole-fleet export is heavy)"; return opts; }
  if (!["csv", "md", "docx", "all"].includes(opts.format)) { opts.error = `Invalid --format '${opts.format}' (use csv|md|docx|all)`; return opts; }
  return opts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add parseArgs for logs-audit CLI"
```

---

## Task 4: `selectDevices` (pure device selection)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

Operates on **raw** device records (the `flatten`-compatible raw `data` objects). `groupNameToIds` maps a group name to the set of group ids that match it (built by the entry script from device-group + assignment-group lists).

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — `selectDevices` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `scripts/lib/logs.mjs`)

```javascript
// raw: array of raw /devices records. selector: from parseArgs. matchGroupIds:
// Set<number> of group ids the --group name resolved to (empty for other kinds).
export function selectDevices(raw, selector, matchGroupIds) {
  switch (selector.kind) {
    case "all":
      return raw.slice();
    case "last-seen": {
      const sorted = raw.slice().sort((a, b) =>
        String(b.attributes?.last_seen_at ?? "").localeCompare(String(a.attributes?.last_seen_at ?? "")));
      return sorted.slice(0, selector.value);
    }
    case "serial": {
      const bySerial = new Map(raw.map((d) => [d.attributes?.serial_number, d]));
      return selector.value.map((s) => bySerial.get(s)).filter(Boolean);
    }
    case "group":
      return raw.filter((d) => {
        const dg = d.relationships?.device_group?.data?.id;
        if (dg != null && matchGroupIds.has(dg)) return true;
        return (d.relationships?.groups?.data ?? []).some((g) => matchGroupIds.has(g.id));
      });
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add selectDevices for logs-audit selectors"
```

---

## Task 5: `logRows` (typed, sorted event rows)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

A **bundle** is `{ device: rawDeviceRecord, logs: [rawLogRecord], apps?, profiles?, users? }`. `logRows(bundles)` returns row objects (keyed by column name) for `toCsv`.

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — `logRows`/`LOG_COLUMNS` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `scripts/lib/logs.mjs`)

```javascript
export const LOG_COLUMNS = ["at_iso", "at", "device_id", "serial_number", "device_name", "device_users",
  "event_type", "summary", "namespace", "level", "source", "account_id", "log_id", "udid",
  "app_name", "app_identifier", "app_version", "via_munki", "profile_name",
  "sc_channel", "sc_filevault_enabled", "sc_sw_install_state", "sc_pending_os", "sc_pending_build",
  "sc_failure_count", "sc_failure_reason"];

function dig(o, ...path) { for (const k of path) { if (o == null || typeof o !== "object") return undefined; o = o[k]; } return o; }
function s(v) { return v === null || v === undefined ? "" : String(v); }

function ownerLabel(bundle) {
  const us = bundle.users?.data ?? bundle.users ?? [];
  return us.map((u) => `${u.attributes?.full_name ?? ""} (${u.attributes?.username ?? ""})`).join(" | ");
}

export function logRows(bundles) {
  const rows = [];
  for (const b of bundles) {
    const da = b.device.attributes ?? {};
    const owners = ownerLabel(b);
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      const md = a.metadata ?? {};
      const ddata = dig(a, "relationships", "device", "data") ?? {};
      const et = a.event_type ?? "";
      let summary;
      if (et === "app.installing") summary = `app installing: ${s(md.name)} ${s(md.version)} (${s(md.bundle_identifier)})${md.via_munki ? " via munki" : ""}`;
      else if (et === "profile.installed") summary = `profile installed: ${s(md.profile_name)}`;
      else if (et === "bootstrap_token.get") summary = `bootstrap token retrieved (udid ${s(md.udid)})`;
      else if (et === "status.changed") {
        const fv = dig(md, "status", "diskmanagement", "filevault", "enabled");
        const st = dig(md, "status", "softwareupdate", "install_state");
        const pend = dig(md, "status", "softwareupdate", "pending_version", "os_version");
        const fc = dig(md, "status", "softwareupdate", "failure_reason", "count");
        const bits = [`channel=${s(md.channel)}`];
        if (fv !== undefined) bits.push(`filevault=${fv}`);
        if (st) bits.push(`sw_install_state=${st}`);
        if (pend) bits.push(`pending_os=${pend}`);
        if (fc) bits.push(`sw_failures=${fc}`);
        summary = "status.changed: " + bits.join(", ");
      } else summary = et;
      rows.push({
        at_iso: toIso(a.at), at: s(a.at), device_id: s(b.device.id),
        serial_number: s(ddata.serial_number ?? da.serial_number), device_name: s(da.name), device_users: owners,
        event_type: et, summary, namespace: s(a.namespace), level: s(a.level), source: s(a.source),
        account_id: s(dig(a, "relationships", "account", "data", "id")), log_id: s(lg.id), udid: s(ddata.udid),
        app_name: et === "app.installing" ? s(md.name) : "", app_identifier: et === "app.installing" ? s(md.bundle_identifier) : "",
        app_version: et === "app.installing" ? s(md.version) : "", via_munki: et === "app.installing" ? s(md.via_munki) : "",
        profile_name: et === "profile.installed" ? s(md.profile_name) : "",
        sc_channel: et === "status.changed" ? s(md.channel) : "",
        sc_filevault_enabled: et === "status.changed" ? s(dig(md, "status", "diskmanagement", "filevault", "enabled")) : "",
        sc_sw_install_state: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "install_state")) : "",
        sc_pending_os: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "pending_version", "os_version")) : "",
        sc_pending_build: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "pending_version", "build_version")) : "",
        sc_failure_count: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "failure_reason", "count")) : "",
        sc_failure_reason: et === "status.changed" ? s(dig(md, "status", "softwareupdate", "failure_reason", "reason")) : "",
      });
    }
  }
  rows.sort((x, y) => (x.at_iso === "" ? 1 : 0) - (y.at_iso === "" ? 1 : 0) || x.at_iso.localeCompare(y.at_iso) || x.serial_number.localeCompare(y.serial_number));
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add logRows typed/sorted event rows"
```

---

## Task 6: `statusSnapshotRows` (isolated, multi-line)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```javascript
export const STATUS_COLUMNS = ["at_iso", "at", "device_id", "serial_number", "device_name", "log_id",
  "sc_channel", "sc_filevault_enabled", "sc_sw_install_state", "sc_pending_os", "sc_pending_build",
  "sc_failure_count", "sc_failure_reason", "status_pretty"];

export function statusSnapshotRows(bundles) {
  const rows = [];
  for (const b of bundles) {
    const da = b.device.attributes ?? {};
    for (const lg of b.logs ?? []) {
      const a = lg.attributes ?? {};
      if (a.event_type !== "status.changed") continue;
      const md = a.metadata ?? {};
      rows.push({
        at_iso: toIso(a.at), at: s(a.at), device_id: s(b.device.id), serial_number: s(da.serial_number),
        device_name: s(da.name), log_id: s(lg.id), sc_channel: s(md.channel),
        sc_filevault_enabled: s(dig(md, "status", "diskmanagement", "filevault", "enabled")),
        sc_sw_install_state: s(dig(md, "status", "softwareupdate", "install_state")),
        sc_pending_os: s(dig(md, "status", "softwareupdate", "pending_version", "os_version")),
        sc_pending_build: s(dig(md, "status", "softwareupdate", "pending_version", "build_version")),
        sc_failure_count: s(dig(md, "status", "softwareupdate", "failure_reason", "count")),
        sc_failure_reason: s(dig(md, "status", "softwareupdate", "failure_reason", "reason")),
        status_pretty: JSON.stringify(md.status ?? {}, null, 2),
      });
    }
  }
  rows.sort((x, y) => x.at_iso.localeCompare(y.at_iso) || x.serial_number.localeCompare(y.serial_number));
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add statusSnapshotRows with multi-line status cell"
```

---

## Task 7: `logSummaryRows` (per-device pivot + coverage window)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```javascript
export const SUMMARY_COLUMNS = ["device_id", "serial_number", "device_name", "total_log_records",
  "app_installing", "profile_installed", "status_changed", "bootstrap_token_get",
  "first_event_at_iso", "last_event_at_iso", "span_days"];

const EVENT_TYPES = ["app.installing", "profile.installed", "status.changed", "bootstrap_token.get"];

export function logSummaryRows(bundles) {
  return bundles.map((b) => {
    const da = b.device.attributes ?? {};
    const isos = (b.logs ?? []).map((l) => toIso(l.attributes?.at)).filter(Boolean).sort();
    const counts = Object.fromEntries(EVENT_TYPES.map((et) => [et, (b.logs ?? []).filter((l) => l.attributes?.event_type === et).length]));
    const first = isos[0] ?? "", last = isos[isos.length - 1] ?? "";
    const span = first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 86400000) : "";
    return {
      device_id: s(b.device.id), serial_number: s(da.serial_number), device_name: s(da.name),
      total_log_records: (b.logs ?? []).length,
      app_installing: counts["app.installing"], profile_installed: counts["profile.installed"],
      status_changed: counts["status.changed"], bootstrap_token_get: counts["bootstrap_token.get"],
      first_event_at_iso: first, last_event_at_iso: last, span_days: span,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add logSummaryRows pivot and coverage window"
```

---

## Task 8: `manifestRows` + `DISCLOSURES`

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

`manifestRows` is pure: it takes precomputed file metadata (sha256/bytes computed by the entry script) and appends the disclosure rows.

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```javascript
export const MANIFEST_COLUMNS = ["file", "description", "record_scope", "data_row_count", "bytes", "sha256", "generated_at"];

export const DISCLOSURES = [
  { file: "(disclosure: timezone)", description: "Log 'at' timestamps are returned by SimpleMDM /logs in the account's display timezone (devices report America/New_York). The API does NOT stamp a UTC offset and the account endpoint does not expose the zone. 'at' is verbatim; 'at_iso' is the same wall-clock reformatted to ISO 8601 with NO shift. Values are NOT UTC." },
  { file: "(disclosure: log retention)", description: "The /logs feed is retention-bounded. The earliest event per device (see logs-summary first_event_at_iso) reflects the API's retention horizon, NOT the device's full lifetime history." },
  { file: "(disclosure: completeness)", description: "All collections returned has_more=false at export time. Records reproduced verbatim; derived columns are additive and clearly named." },
];

export function manifestRows(fileMetas, generatedAt) {
  const rows = fileMetas.map((m) => ({ ...m, generated_at: generatedAt }));
  for (const d of DISCLOSURES) rows.push({ file: d.file, description: d.description, record_scope: "", data_row_count: "", bytes: "", sha256: "", generated_at: generatedAt });
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add manifestRows with legal disclosures"
```

---

## Task 9: `renderLogsMarkdown` (logs summary + optional security summary)

**Files:**
- Modify: `scripts/lib/logs.mjs`
- Modify: `test/logs-audit.test.mjs`

`securityEval` is `null` unless `--with-security`; when present it is an array of `evaluateDevice` results (each has `serial`, `osVersion`, `findings`, `cvesBehind`).

- [ ] **Step 1: Write the failing test** (append)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```javascript
export function renderLogsMarkdown(summaryRows, securityEval, dateStr) {
  const out = [`# SimpleMDM Logs Audit — ${dateStr}`, "",
    `Devices: ${summaryRows.length}. Total events: ${summaryRows.reduce((n, r) => n + r.total_log_records, 0)}.`, "",
    "## Activity Summary", "",
    "| Device | Serial | Events | app.installing | profile.installed | status.changed | First | Last |",
    "|---|---|---|---|---|---|---|---|"];
  for (const r of summaryRows) {
    out.push(`| ${r.device_name} | ${r.serial_number} | ${r.total_log_records} | ${r.app_installing} | ${r.profile_installed} | ${r.status_changed} | ${r.first_event_at_iso} | ${r.last_event_at_iso} |`);
  }
  if (securityEval) {
    out.push("", "## Security Posture", "", "| Serial | OS | Unfixed CVEs | Findings |", "|---|---|---|---|");
    for (const d of securityEval) out.push(`| ${d.serial} | ${d.osVersion} | ${d.cvesBehind ?? ""} | ${(d.findings ?? []).join("; ")} |`);
  }
  out.push("", "_Times are in the account display timezone (America/New_York), not UTC. The /logs feed is retention-bounded._", "");
  return out.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logs-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logs.mjs test/logs-audit.test.mjs
git commit -m "feat: add renderLogsMarkdown with optional security section"
```

---

## Task 10: Extend the API client

**Files:**
- Modify: `scripts/lib/simplemdm.mjs`
- Modify: `test/logs-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append — verifies the refactor exports `flatten` and keeps its shape)

```javascript
import { flatten } from "../scripts/lib/simplemdm.mjs";

test("flatten exposes the evaluateDevice-compatible shape", () => {
  const d = flatten(RAW[1]); // Bob iMac, FileVault off, firewall off
  assert.equal(d.serial, "D25BBB222");
  assert.equal(d.model, "iMac21,1");
  assert.equal(d.osVersion, "14.7.1");
  assert.equal(d.filevault_enabled, false);
  assert.equal(d.firewall_enabled, false);
  assert.equal(d.device_group_id, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logs-audit.test.mjs`
Expected: FAIL — `flatten` is not exported.

- [ ] **Step 3: Edit `scripts/lib/simplemdm.mjs`**

3a. Add `export` to the existing `flatten` declaration:

```javascript
export function flatten(d) {
```

3b. Refactor `fetchAllDevices` and add `fetchAllDevicesRaw` (replace the existing `fetchAllDevices` body):

```javascript
export async function fetchAllDevicesRaw(apiKey) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  const all = [];
  let after;
  for (;;) {
    const page = await getPage(apiKey, after);
    const data = page.data ?? [];
    all.push(...data);
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}

export async function fetchAllDevices(apiKey) {
  return (await fetchAllDevicesRaw(apiKey)).map(flatten);
}
```

3c. Add the new fetchers at the end of the file:

```javascript
async function getJson(apiKey, path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader(apiKey) } });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 16000))); continue; }
    if (res.status === 401) throw new Error("SimpleMDM auth failed (401) — check SIMPLEMDM_API_KEY");
    if (!res.ok) throw new Error(`SimpleMDM ${path} failed ${res.status}`);
    return res.json();
  }
}

// Fully paginated collection GET for an arbitrary endpoint, cursor on last id.
async function getAll(apiKey, base) {
  const all = [];
  let after;
  for (;;) {
    const sep = base.includes("?") ? "&" : "?";
    const page = await getJson(apiKey, `${base}${sep}limit=100${after ? `&starting_after=${after}` : ""}`);
    const data = page.data ?? [];
    all.push(...data);
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}

export async function fetchDeviceLogs(apiKey, serial) {
  return getAll(apiKey, `/logs?serial_number=${encodeURIComponent(serial)}`);
}
export async function fetchDeviceApps(apiKey, id) { return getAll(apiKey, `/devices/${id}/installed_apps`); }
export async function fetchDeviceProfiles(apiKey, id) { return getAll(apiKey, `/devices/${id}/profiles`); }
export async function fetchDeviceUsers(apiKey, id) { return getAll(apiKey, `/devices/${id}/users`); }

// id -> name map of all assignment groups (for resolving relationships.groups).
export async function fetchAssignmentGroups(apiKey) {
  const map = new Map();
  for (const g of await getAll(apiKey, `/assignment_groups`)) map.set(g.id, g.attributes?.name ?? String(g.id));
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes** (and that the existing audit tests still pass)

Run: `node --test test/logs-audit.test.mjs test/sofa-audit.test.mjs`
Expected: PASS (the `flatten` test plus all existing sofa-audit tests — the refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/simplemdm.mjs test/logs-audit.test.mjs
git commit -m "feat: extend simplemdm client with logs/inventory/assignment-group fetchers"
```

---

## Task 11: Entry script `scripts/logs-audit.mjs`

**Files:**
- Create: `scripts/logs-audit.mjs`

This wires the pure functions to the network and the filesystem. It has no unit test (it is I/O orchestration); it is verified by the manual live smoke in Task 14 and by the fact that every function it calls is already tested.

- [ ] **Step 1: Create `scripts/logs-audit.mjs`**

```javascript
#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  fetchAllDevicesRaw, fetchDeviceLogs, fetchDeviceApps, fetchDeviceProfiles, fetchDeviceUsers,
  fetchDeviceGroups, fetchAssignmentGroups, flatten,
} from "./lib/simplemdm.mjs";
import { loadSofa } from "./lib/sofa.mjs";
import { buildMajorTables, evaluateDevice, deviceCveRows } from "./lib/evaluate.mjs";
import { toCsv, allDeviceRows } from "./lib/render.mjs";
import { mdToDocx } from "./lib/docx.mjs";
import {
  parseArgs, selectDevices, logRows, LOG_COLUMNS, statusSnapshotRows, STATUS_COLUMNS,
  logSummaryRows, SUMMARY_COLUMNS, manifestRows, MANIFEST_COLUMNS, renderLogsMarkdown,
} from "./lib/logs.mjs";

function loadEnvKey() {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) { console.error(`logs-audit: ${opts.error}`); process.exit(2); }

  const apiKey = loadEnvKey();
  if (!apiKey) { console.error("LOGS-AUDIT FAILED: Missing SIMPLEMDM_API_KEY (set it in .env or the environment)"); process.exit(1); }

  const raw = await fetchAllDevicesRaw(apiKey);

  // Resolve --group name -> set of matching group ids (device-group + assignment-group).
  let matchGroupIds = new Set();
  if (opts.selector.kind === "group") {
    const dg = await fetchDeviceGroups(apiKey);
    const ag = await fetchAssignmentGroups(apiKey);
    const wanted = opts.selector.value.toLowerCase();
    for (const [id, name] of [...dg, ...ag]) if (String(name).toLowerCase() === wanted) matchGroupIds.add(id);
    if (matchGroupIds.size === 0) { console.error(`logs-audit: no group named "${opts.selector.value}"`); process.exit(3); }
  }
  if (opts.selector.kind === "all") console.warn(`logs-audit: --all selected ${raw.length} devices; fetching logs for each…`);

  const selected = selectDevices(raw, opts.selector, matchGroupIds);
  if (selected.length === 0) { console.error("logs-audit: no devices matched the selector"); process.exit(3); }

  // Build per-device bundles (continue-on-error).
  const bundles = [];
  const errors = [];
  for (const device of selected) {
    const serial = device.attributes?.serial_number;
    try {
      const bundle = { device, logs: await fetchDeviceLogs(apiKey, serial) };
      if (opts.withInventory) {
        bundle.apps = await fetchDeviceApps(apiKey, device.id);
        bundle.profiles = await fetchDeviceProfiles(apiKey, device.id);
        bundle.users = await fetchDeviceUsers(apiKey, device.id);
      }
      bundles.push(bundle);
    } catch (e) { errors.push({ serial, message: String(e.message ?? e) }); }
  }

  // Optional security evaluation on the selected devices.
  let securityEval = null;
  if (opts.withSecurity) {
    const { macFeed, iosFeed } = await loadSofa(`reports/.logs-audit-cache`, { noCache: false });
    const tables = buildMajorTables(macFeed, iosFeed);
    const evald = bundles.map((b) => evaluateDevice(flatten(b.device), tables));
    securityEval = evald;
    main._securityCsv = { tables, evald };
  }

  const dateStr = todayStr();
  const outDir = opts.out ?? `reports/logs-audit-${dateStr}`;
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const writeFile = (name, content, description, scope) => {
    const path = `${outDir}/${name}`;
    writeFileSync(path, content);
    written.push({ name, path, description, record_scope: scope });
  };

  // CSV + JSON core (always).
  const lr = logRows(bundles), sr = statusSnapshotRows(bundles), mr = logSummaryRows(bundles);
  writeFile("logs.csv", toCsv([LOG_COLUMNS], lr), "Activity events: one row per event, ISO+verbatim time, typed, sorted", `${lr.length} events`);
  writeFile("logs-status-snapshots.csv", toCsv([STATUS_COLUMNS], sr), "status.changed snapshots; multi-line status_pretty", `${sr.length} snapshots`);
  writeFile("logs-summary.csv", toCsv([SUMMARY_COLUMNS], mr), "Per-device pivot + coverage window", `${bundles.length} devices`);
  writeFile("raw-logs.json", JSON.stringify({ generated_at: nowIso(), selector: opts.selector, devices: bundles.map((b) => ({ device: b.device, logs: b.logs })) }, null, 2), "Verbatim per-device log records", `${bundles.length} devices`);

  if (opts.withInventory) {
    const invRows = bundles.map((b) => flatten(b.device));
    writeFile("inventory.csv", toCsv([["id", "name", "serial", "model", "osVersion", "last_seen_at", "filevault_enabled", "sip_enabled", "firewall_enabled", "device_group_id"]], invRows), "Per-device inventory", `${invRows.length} devices`);
    const appRows = bundles.flatMap((b) => (b.apps ?? []).map((a) => ({ serial: b.device.attributes?.serial_number, name: a.attributes?.name, identifier: a.attributes?.identifier, version: a.attributes?.version, managed: a.attributes?.managed })));
    writeFile("apps.csv", toCsv([["serial", "name", "identifier", "version", "managed"]], appRows), "Installed apps per device", `${appRows.length} app records`);
    const profRows = bundles.flatMap((b) => (b.profiles ?? []).map((p) => ({ serial: b.device.attributes?.serial_number, type: p.type, id: p.id, name: p.attributes?.name })));
    writeFile("profiles.csv", toCsv([["serial", "type", "id", "name"]], profRows), "Profiles per device", `${profRows.length} profile records`);
  }

  if (opts.withSecurity && main._securityCsv) {
    const { tables, evald } = main._securityCsv;
    writeFile("security-posture.csv", toCsv([["name", "device_name", "serial", "device_group", "os_version", "latest_minor", "latest_major", "unfixed_cves", "product", "fv", "sip", "fw", "xp", "last_seen"]], allDeviceRows(evald)), "SOFA posture for selected devices", `${evald.length} devices`);
    writeFile("device-cves.csv", toCsv([["name", "serial", "device_group", "model", "os", "unfixed_count", "exploited_count", "cves"]], deviceCveRows(evald, tables)), "Per-device outstanding CVEs", `${evald.length} devices`);
  }

  // Document (md/docx/all).
  if (["md", "docx", "all"].includes(opts.format)) {
    const md = renderLogsMarkdown(mr, securityEval, dateStr);
    writeFile("report.md", md, "Human-readable report (logs summary + optional security)", "1 document");
    if (["docx", "all"].includes(opts.format)) {
      // mdToDocx(mdPath, docxPath) takes a FILE PATH (report.md is written just above)
      // and returns a boolean (it does not throw) — matches scripts/sofa-audit.mjs.
      const ok = mdToDocx(`${outDir}/report.md`, `${outDir}/report.docx`);
      if (ok) written.push({ name: "report.docx", path: `${outDir}/report.docx`, description: "Word report", record_scope: "1 document" });
      else console.warn("logs-audit: docx skipped (pandoc unavailable or failed)");
    }
  }

  // Manifest (hash everything written so far).
  const fileMetas = written.map((w) => {
    const buf = readFileSync(w.path);
    return { file: w.name, description: w.description, record_scope: w.record_scope, data_row_count: "", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  writeFileSync(`${outDir}/manifest.csv`, toCsv([MANIFEST_COLUMNS], manifestRows(fileMetas, nowIso())));

  // summary.txt + stdout headline.
  const totalEvents = bundles.reduce((n, b) => n + b.logs.length, 0);
  const head = [`Logs Audit ${dateStr}`, `Devices: ${bundles.length}`, `Total events: ${totalEvents}`,
    errors.length ? `Failed devices: ${errors.length} (export is PARTIAL)` : `Failed devices: 0`,
    `Output: ${outDir}`].join("\n");
  writeFileSync(`${outDir}/summary.txt`, head + "\n");
  console.log(head);
  for (const w of written) console.log(`  ${w.name}`);
  console.log("  manifest.csv");
  console.log("Output is local-only (reports/ is gitignored) and NOT committed.");
  if (opts.format === "all") console.log("For PDF: run scripts/make-audit-pdf.sh " + outDir);
}

main().catch((e) => { console.error("LOGS-AUDIT FAILED:", e.message ?? e); process.exit(1); });
```

- [ ] **Step 2: Verify the script parses and the usage guard works (no network)**

Run: `node scripts/logs-audit.mjs --all`
Expected: prints `logs-audit: --all requires --confirm-all (whole-fleet export is heavy)` and exits non-zero.

- [ ] **Step 3: Commit**

```bash
git add scripts/logs-audit.mjs
git commit -m "feat: add logs-audit entry script"
```

---

## Task 12: Skill `/logs-audit`

**Files:**
- Create: `.claude/skills/logs-audit/SKILL.md`

- [ ] **Step 1: Create `.claude/skills/logs-audit/SKILL.md`**

```markdown
---
name: logs-audit
description: Generate a targeted SimpleMDM device-activity log export (legal/forensic) for selected devices — logs CSV (typed/ISO/sorted), status-snapshot CSV, per-device summary/coverage, raw JSON, SHA-256 manifest, and an optional md/docx/pdf report. Use when asked to export device logs, build a device activity/forensic/legal log report, or audit a device's /logs.
---

# SimpleMDM Logs Audit

Targeted sibling to the SOFA `/audit`. Runs the engine and reports where files landed. Do NOT commit the output.

## Steps

1. Determine the selector from the request and map to exactly one flag:
   - a serial (or several) → `--serial A,B`
   - "last N seen" / "most recently seen" → `--last-seen N`
   - a group name → `--group "Name"`
   - "whole fleet" / "all devices" → `--all --confirm-all`
2. Map optional combines: "with security/posture/CVEs" → `--with-security`; "with apps/profiles/inventory" → `--with-inventory`.
3. Map format words: "csv" → `--format csv`, "word"/"docx" → `--format docx`, "markdown"/"md" → `--format md`, else `--format all`.
4. Run: `node scripts/logs-audit.mjs <flags>`
5. Read `<outDir>/summary.txt` and relay the headline (devices, total events, failed devices).
6. List the generated files. Remind the user the output is local-only (gitignored) and not committed.
7. For PDF, after the run: `scripts/make-audit-pdf.sh <outDir>`.

## Notes
- Read-only: a read-only `SIMPLEMDM_API_KEY` in `.env` is sufficient.
- Timestamps are in the account display timezone (America/New_York), reproduced verbatim plus an ISO `at_iso` column — NOT UTC. The `/logs` feed is retention-bounded; the per-device window is in `logs-summary.csv`.
- `--all` is heavy (one log fetch per device) and requires `--confirm-all`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/logs-audit/SKILL.md
git commit -m "feat: add /logs-audit skill"
```

---

## Task 13: Docs + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an Unreleased entry at the top of `CHANGELOG.md`** (under the existing `## [Unreleased]` header if present, else create it above the latest version)

```markdown
## [Unreleased]

### Added
- `/logs-audit` command (`scripts/logs-audit.mjs` + `logs-audit` skill): targeted device-activity
  log export for selected devices (`--serial`/`--last-seen`/`--group`/`--all`), with opt-in
  `--with-inventory` and `--with-security` combine. Emits typed/ISO/sorted logs CSV, isolated
  status-snapshot CSV, per-device summary/coverage CSV, raw JSON, a SHA-256 manifest with
  timezone/retention disclosures, and an optional md/docx/pdf report (logs + security summary).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: build succeeds and all tests pass (existing + new `test/logs-audit.test.mjs`).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for logs-audit command"
```

---

## Task 14: Live smoke test (manual, optional but recommended)

**Files:** none (verification only)

- [ ] **Step 1: Run a tiny live export against the real API**

Run: `node scripts/logs-audit.mjs --last-seen 2 --format csv`
Expected: creates `reports/logs-audit-<date>/` with `logs.csv`, `logs-status-snapshots.csv`, `logs-summary.csv`, `raw-logs.json`, `manifest.csv`, `summary.txt`; prints the headline; exits 0.

- [ ] **Step 2: Spot-check fidelity**

Run: `head -2 "reports/logs-audit-$(date +%F)/logs.csv"` and confirm an `at_iso` value and verbatim `at` are both present; confirm `manifest.csv` contains the three `(disclosure: …)` rows.

- [ ] **Step 3: Confirm gitignored**

Run: `git status --short reports/` → expect no output (already ignored).

---

## Self-Review

**Spec coverage:**
- §3 engine + skill → Tasks 11, 12. ✓
- §4 CLI / selectors / `--confirm-all` → Task 3 (`parseArgs`), Task 11. ✓
- §5 architecture / shared libs / `lib/logs.mjs` → Tasks 2–9; client extension Task 10. ✓
- §6 data flow (resolve → fetch → build → write, continue-on-error) → Task 11. ✓
- §7 outputs (logs core, `--with-inventory`, `--with-security`, md/docx/pdf, dual summary) → Tasks 5–9, 11; dual summary Task 9. ✓
- §8 error handling (missing key/exit1, bad selector/exit2, zero match/exit3, per-device continue, unparseable at) → Task 3, Task 11, Task 2. ✓
- §9 fidelity/disclosures → Task 2 (`toIso`), Task 8 (`DISCLOSURES`). ✓
- §10 testing → Tasks 2–10 each ship tests; full run Task 13. ✓
- §11 skill → Task 12. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** Column constants (`LOG_COLUMNS`, `STATUS_COLUMNS`, `SUMMARY_COLUMNS`, `MANIFEST_COLUMNS`) and function names (`parseArgs`, `selectDevices`, `logRows`, `statusSnapshotRows`, `logSummaryRows`, `manifestRows`, `renderLogsMarkdown`, `toIso`, `flatten`, `fetchAllDevicesRaw`, `fetchDeviceLogs`) are referenced identically across the lib, the entry script, and tests. Bundle shape `{ device, logs, apps?, profiles?, users? }` is consistent in Tasks 5–9 and 11. `securityEval` shape (`serial`, `osVersion`, `findings`, `cvesBehind`) in Task 9 matches `evaluateDevice` output fields used by `allDeviceRows`/`deviceCveRows`. ✓
