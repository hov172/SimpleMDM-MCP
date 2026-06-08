# SOFA Audit Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained `/audit` command and `scripts/sofa-audit.mjs` engine that joins live SimpleMDM device inventory with the SOFA feed and exports a four-section macOS security audit (Security Report, Vulnerability Check, Need Updates, All Devices) plus per-CVE detail, to CSV / Markdown / docx.

**Architecture:** Pure data/eval/render functions (no IO) in `scripts/lib/{evaluate,render}.mjs`, tested with fixtures; IO modules `scripts/lib/{sofa,simplemdm,docx}.mjs`; orchestrator `scripts/sofa-audit.mjs`. Eligibility/upgrade paths derived from SOFA `Models`/`SupportedDevices` (no static table). Output to gitignored `reports/audit-<date>/`.

**Tech Stack:** Node ≥18 ESM (`.mjs`), built-in `fetch`/`fs`, `node --test`. `pandoc` (already installed) for docx. No npm dependencies.

---

## Shared data shapes (referenced by all tasks)

```js
// A SOFA "major info" record (one per OS major), built by buildMajorTables:
// { major: 15, name: "Sequoia 15", latest: "15.7.7", latestDate: "2025-...",
//   releases: [ { ver: "15.7.7", date: "2025-..", cves: 12, exploited: 1,
//                 cveList: [ { id: "CVE-2025-1234", exploited: true }, ... ] }, ... ] }

// tables = {
//   macOS: Map<major:number, info>,
//   ios:   Map<major:number, info>,
//   supportedMacMajors: number[],   // top 3 macOS majors, e.g. [26,15,14]
//   supportedIosMajors: number[],
//   xprotectLatest: string,         // e.g. "5347"
//   modelMaxMajor: Map<modelId:string, major:number>  // from SupportedDevices
// }

// An evaluated device record (output of evaluateDevice):
// { id, name, serial, model, osVersion, platform,
//   osStatus: "current"|"outdated"|"eol"|"unknown",
//   recommended: { target, path:[..versions..], replace:bool },
//   cvesBehind:number|null, exploitedBehind:number|null,
//   filevaultOk:bool, sipOk:bool, firewallOk:bool,
//   xprotect: { value, status: "ok"|"outdated"|"invalid"|"absent" },
//   findings:[string], failCount:number }
```

---

## Task 1: Scaffolding + gitignore

**Files:**
- Create: `scripts/lib/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create the lib directory placeholder**

```bash
mkdir -p scripts/lib test/fixtures
: > scripts/lib/.gitkeep
```

- [ ] **Step 2: Ensure reports output is never committed**

Append to `.gitignore` (create the file if absent), only if `reports/` is not already ignored:

```
# Generated audit output — local only, never committed (contains live tenant data + secrets)
reports/
```

- [ ] **Step 3: Verify**

Run: `git check-ignore reports/audit-2026-06-07/x.csv`
Expected: prints the path (it is ignored).

- [ ] **Step 4: Commit**

```bash
git add .gitignore scripts/lib/.gitkeep
git commit -m "chore: scaffold sofa-audit dirs, gitignore reports/"
```

---

## Task 2: Version utilities

**Files:**
- Create: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/sofa-audit.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions } from "../scripts/lib/evaluate.mjs";

test("parseVersion splits dotted version into integers", () => {
  assert.deepEqual(parseVersion("15.6.1"), [15, 6, 1]);
  assert.deepEqual(parseVersion("26.0"), [26, 0]);
  assert.deepEqual(parseVersion(""), [0]);
});

test("compareVersions orders versions", () => {
  assert.equal(compareVersions("15.7.7", "15.6.1"), 1);
  assert.equal(compareVersions("15.6.1", "15.7.7"), -1);
  assert.equal(compareVersions("26.0", "26.0"), 0);
  assert.equal(compareVersions("15.7", "15.7.1"), -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — cannot find module export `parseVersion`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/evaluate.mjs`:

```js
export function parseVersion(v) {
  const parts = String(v ?? "").split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return parts.length ? parts : [0];
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: version parse/compare utils for sofa-audit"
```

---

## Task 2.5: Test fixtures

**Files:**
- Create: `test/fixtures/sofa-macos.json`, `test/fixtures/sofa-ios.json`, `test/fixtures/devices.json`

- [ ] **Step 1: Create trimmed SOFA macOS fixture**

Create `test/fixtures/sofa-macos.json`:

```json
{
  "XProtectPlistConfigData": { "com.apple.XProtect": "5347" },
  "Models": {
    "Mac14,3": { "MarketingName": "Mac mini" },
    "iMac21,1": { "MarketingName": "iMac" }
  },
  "OSVersions": [
    { "OSVersion": "Tahoe 26",
      "Latest": { "ProductVersion": "26.5.1", "ReleaseDate": "2026-05-31T00:00:00Z",
        "SupportedDevices": ["Mac14,3", "iMac21,1"] },
      "SecurityReleases": [
        { "ProductVersion": "26.5.1", "ReleaseDate": "2026-05-31T00:00:00Z", "UniqueCVEsCount": 2,
          "CVEs": { "CVE-2025-0001": true, "CVE-2025-0002": false }, "ActivelyExploitedCVEs": ["CVE-2025-0001"] },
        { "ProductVersion": "26.0", "ReleaseDate": "2025-09-15T00:00:00Z", "UniqueCVEsCount": 0, "CVEs": {}, "ActivelyExploitedCVEs": [] }
      ] },
    { "OSVersion": "Sequoia 15",
      "Latest": { "ProductVersion": "15.7.7", "ReleaseDate": "2026-05-01T00:00:00Z",
        "SupportedDevices": ["Mac14,3", "iMac21,1"] },
      "SecurityReleases": [
        { "ProductVersion": "15.7.7", "ReleaseDate": "2026-05-01T00:00:00Z", "UniqueCVEsCount": 0, "CVEs": {}, "ActivelyExploitedCVEs": [] },
        { "ProductVersion": "15.6.1", "ReleaseDate": "2025-08-01T00:00:00Z", "UniqueCVEsCount": 3,
          "CVEs": { "CVE-2025-1001": false, "CVE-2025-1002": false, "CVE-2025-1003": true }, "ActivelyExploitedCVEs": ["CVE-2025-1003"] }
      ] },
    { "OSVersion": "Sonoma 14",
      "Latest": { "ProductVersion": "14.8.7", "ReleaseDate": "2026-04-01T00:00:00Z",
        "SupportedDevices": ["iMac21,1"] },
      "SecurityReleases": [
        { "ProductVersion": "14.8.7", "ReleaseDate": "2026-04-01T00:00:00Z", "UniqueCVEsCount": 0, "CVEs": {}, "ActivelyExploitedCVEs": [] },
        { "ProductVersion": "14.6.1", "ReleaseDate": "2025-07-01T00:00:00Z", "UniqueCVEsCount": 1,
          "CVEs": { "CVE-2025-2001": false }, "ActivelyExploitedCVEs": [] }
      ] },
    { "OSVersion": "Ventura 13",
      "Latest": { "ProductVersion": "13.7.8", "ReleaseDate": "2025-09-01T00:00:00Z", "SupportedDevices": [] },
      "SecurityReleases": [
        { "ProductVersion": "13.7.8", "ReleaseDate": "2025-09-01T00:00:00Z", "UniqueCVEsCount": 0, "CVEs": {}, "ActivelyExploitedCVEs": [] }
      ] }
  ]
}
```

- [ ] **Step 2: Create trimmed SOFA iOS fixture**

Create `test/fixtures/sofa-ios.json`:

```json
{
  "OSVersions": [
    { "OSVersion": "26",
      "Latest": { "ProductVersion": "26.5.1", "ReleaseDate": "2026-05-31T00:00:00Z", "SupportedDevices": [] },
      "SecurityReleases": [
        { "ProductVersion": "26.5.1", "ReleaseDate": "2026-05-31T00:00:00Z", "UniqueCVEsCount": 0, "CVEs": {}, "ActivelyExploitedCVEs": [] },
        { "ProductVersion": "26.4.2", "ReleaseDate": "2026-04-01T00:00:00Z", "UniqueCVEsCount": 2,
          "CVEs": { "CVE-2026-3001": false, "CVE-2026-3002": false }, "ActivelyExploitedCVEs": [] }
      ] }
  ]
}
```

- [ ] **Step 3: Create devices fixture**

Create `test/fixtures/devices.json`:

```json
[
  { "id": 1, "name": "Mac-Behind", "serial": "AAA1", "model": "Mac14,3", "osVersion": "26.0",
    "filevault_enabled": false, "firewall_enabled": false, "sip_enabled": false, "xprotect_version": "5345" },
  { "id": 2, "name": "Mac-Current", "serial": "BBB2", "model": "Mac14,3", "osVersion": "26.5.1",
    "filevault_enabled": true, "firewall_enabled": true, "sip_enabled": true, "xprotect_version": "5347" },
  { "id": 3, "name": "Mac-EOL", "serial": "CCC3", "model": "iMac21,1", "osVersion": "13.7.8",
    "filevault_enabled": false, "firewall_enabled": false, "sip_enabled": true, "xprotect_version": null },
  { "id": 4, "name": "iPad-1", "serial": "DDD4", "model": "iPad13,1", "osVersion": "26.4.2",
    "filevault_enabled": null, "firewall_enabled": null, "sip_enabled": null, "xprotect_version": null }
]
```

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/
git commit -m "test: add sofa-audit fixtures"
```

---

## Task 3: Platform detection

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append to test file)

```js
import { detectPlatform } from "../scripts/lib/evaluate.mjs";

test("detectPlatform maps model identifiers", () => {
  assert.equal(detectPlatform({ model: "Mac14,3" }), "macOS");
  assert.equal(detectPlatform({ model: "MacBookPro18,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iMac21,1" }), "macOS");
  assert.equal(detectPlatform({ model: "iPad13,1" }), "iPadOS");
  assert.equal(detectPlatform({ model: "iPhone15,2" }), "iOS");
  assert.equal(detectPlatform({ model: "iPod9,1" }), "iOS");
  assert.equal(detectPlatform({ model: "" }), "unknown");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `detectPlatform` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `evaluate.mjs`)

```js
export function detectPlatform(device) {
  const id = String(device.model ?? device.product_name ?? "");
  if (/^iPad/i.test(id)) return "iPadOS";
  if (/^(iPhone|iPod)/i.test(id)) return "iOS";
  if (/^(MacBook|iMac|Macmini|MacPro|MacStudio|Mac\d)/i.test(id)) return "macOS";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: platform detection for sofa-audit"
```

---

## Task 4: SOFA table builder

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { buildMajorTables } from "../scripts/lib/evaluate.mjs";
import { readFileSync } from "node:fs";
const macFeed = JSON.parse(readFileSync(new URL("./fixtures/sofa-macos.json", import.meta.url)));
const iosFeed = JSON.parse(readFileSync(new URL("./fixtures/sofa-ios.json", import.meta.url)));

test("buildMajorTables builds majors, xprotect, supported, model map", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  assert.equal(t.xprotectLatest, "5347");
  assert.equal(t.macOS.get(15).latest, "15.7.7");
  assert.equal(t.macOS.get(26).releases.find(r => r.ver === "26.5.1").exploited, 1);
  assert.deepEqual(t.supportedMacMajors, [26, 15, 14]);
  assert.equal(t.modelMaxMajor.get("Mac14,3"), 26);
  assert.equal(t.modelMaxMajor.get("iMac21,1"), 26);
  // CVE list captured with exploited flag (CVEs are fixed in the latest release)
  const r2651 = t.macOS.get(26).releases.find(r => r.ver === "26.5.1");
  assert.deepEqual(r2651.cveList.find(c => c.id === "CVE-2025-0001"), { id: "CVE-2025-0001", exploited: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `buildMajorTables` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `evaluate.mjs`)

```js
function buildMajorMap(feed) {
  const map = new Map();
  for (const osv of feed.OSVersions ?? []) {
    const latest = osv.Latest?.ProductVersion;
    if (!latest) continue;
    const major = parseVersion(latest)[0];
    const releases = (osv.SecurityReleases ?? [])
      .filter((r) => r.ProductVersion)
      .map((r) => ({
        ver: r.ProductVersion,
        date: (r.ReleaseDate ?? "").slice(0, 10),
        cves: r.UniqueCVEsCount ?? 0,
        exploited: (r.ActivelyExploitedCVEs ?? []).length,
        cveList: Object.entries(r.CVEs ?? {}).map(([id, ex]) => ({ id, exploited: !!ex })),
      }));
    map.set(major, {
      major,
      name: osv.OSVersion ?? String(major),
      latest,
      latestDate: (osv.Latest?.ReleaseDate ?? "").slice(0, 10),
      releases,
      supportedDevices: osv.Latest?.SupportedDevices ?? [],
    });
  }
  return map;
}

function topMajors(map, n = 3) {
  return [...map.keys()].sort((a, b) => b - a).slice(0, n);
}

export function buildMajorTables(macFeed, iosFeed) {
  const macOS = buildMajorMap(macFeed);
  const ios = buildMajorMap(iosFeed);
  const modelMaxMajor = new Map();
  for (const info of macOS.values()) {
    for (const model of info.supportedDevices) {
      const prev = modelMaxMajor.get(model) ?? 0;
      if (info.major > prev) modelMaxMajor.set(model, info.major);
    }
  }
  return {
    macOS,
    ios,
    supportedMacMajors: topMajors(macOS),
    supportedIosMajors: topMajors(ios),
    xprotectLatest: macFeed.XProtectPlistConfigData?.["com.apple.XProtect"] ?? null,
    modelMaxMajor,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: SOFA major/table builder for sofa-audit"
```

---

## Task 5: OS assessment

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { assessOS } from "../scripts/lib/evaluate.mjs";

test("assessOS computes behind counts and status", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const a = assessOS("26.0", "macOS", t);
  assert.equal(a.status, "outdated");
  assert.equal(a.latest, "26.5.1");
  assert.equal(a.cvesBehind, 2);
  assert.equal(a.exploitedBehind, 1);

  const cur = assessOS("26.5.1", "macOS", t);
  assert.equal(cur.status, "current");

  const eol = assessOS("13.7.8", "macOS", t);
  assert.equal(eol.status, "eol"); // major 13 not in supportedMacMajors

  const unknown = assessOS("", "macOS", t);
  assert.equal(unknown.status, "unknown");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `assessOS` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```js
export function assessOS(version, platform, tables) {
  if (!version) return { status: "unknown", latest: null, releasesBehind: null, cvesBehind: null, exploitedBehind: null, isLatest: false };
  const map = platform === "macOS" ? tables.macOS : tables.ios;
  const supported = platform === "macOS" ? tables.supportedMacMajors : tables.supportedIosMajors;
  const major = parseVersion(version)[0];
  const info = map.get(major);
  if (!info || !supported.includes(major)) {
    return { status: "eol", latest: info?.latest ?? null, releasesBehind: null, cvesBehind: null, exploitedBehind: null, isLatest: false };
  }
  let releasesBehind = 0, cvesBehind = 0, exploitedBehind = 0;
  for (const r of info.releases) {
    if (compareVersions(r.ver, version) > 0) {
      releasesBehind++; cvesBehind += r.cves; exploitedBehind += r.exploited;
    }
  }
  const isLatest = compareVersions(version, info.latest) >= 0;
  return { status: isLatest ? "current" : "outdated", latest: info.latest, releasesBehind, cvesBehind, exploitedBehind, isLatest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: OS assessment (behind counts/status) for sofa-audit"
```

---

## Task 6: Upgrade recommendation

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { recommendTarget } from "../scripts/lib/evaluate.mjs";

test("recommendTarget builds supported upgrade path", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  // Mac14,3 ceiling 26, currently 14.6.1 -> 15.7.7 -> 26.5.1
  const r1 = recommendTarget("14.6.1", "Mac14,3", t);
  assert.equal(r1.replace, false);
  assert.equal(r1.target, "26.5.1");
  assert.deepEqual(r1.path, ["14.6.1", "15.7.7", "26.5.1"]);

  // currently 26.0 -> only minor update to 26.5.1
  const r2 = recommendTarget("26.0", "Mac14,3", t);
  assert.deepEqual(r2.path, ["26.0", "26.5.1"]);

  // unknown model -> replace=false but target null, path just current
  const r3 = recommendTarget("13.0", "UnknownModel", t);
  assert.equal(r3.target, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `recommendTarget` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```js
export function recommendTarget(version, model, tables) {
  const ceiling = tables.modelMaxMajor.get(model) ?? null;
  const supported = tables.supportedMacMajors; // macOS only
  const currentMajor = parseVersion(version)[0];
  if (ceiling === null) {
    return { target: null, path: [version], replace: false };
  }
  // Supported majors the hardware can run, ascending, that are >= currentMajor
  const reachable = supported
    .filter((m) => m <= ceiling)
    .sort((a, b) => a - b);
  if (reachable.length === 0) {
    return { target: null, path: [version], replace: true }; // capped below supported
  }
  const path = [version];
  for (const m of reachable) {
    if (m > currentMajor) path.push(tables.macOS.get(m).latest);
  }
  // same-major minor update
  if (path.length === 1) {
    const info = tables.macOS.get(currentMajor);
    if (info && compareVersions(version, info.latest) < 0) path.push(info.latest);
  }
  const target = path.length > 1 ? path[path.length - 1] : null;
  return { target, path, replace: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: SOFA-derived upgrade path recommendation"
```

---

## Task 7: Device evaluation (composes all checks)

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { evaluateDevice } from "../scripts/lib/evaluate.mjs";

test("evaluateDevice composes findings", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const d = { id: 1, name: "Mac-Behind", serial: "AAA1", model: "Mac14,3", osVersion: "26.0",
    filevault_enabled: false, firewall_enabled: false, sip_enabled: false, xprotect_version: "5345" };
  const e = evaluateDevice(d, t);
  assert.equal(e.platform, "macOS");
  assert.equal(e.osStatus, "outdated");
  assert.equal(e.filevaultOk, false);
  assert.equal(e.sipOk, false);
  assert.equal(e.firewallOk, false);
  assert.equal(e.xprotect.status, "outdated");
  assert.equal(e.failCount, 5); // OS + FV + SIP + FW + XProtect

  const ok = evaluateDevice({ id: 2, model: "Mac14,3", osVersion: "26.5.1",
    filevault_enabled: true, firewall_enabled: true, sip_enabled: true, xprotect_version: "5347" }, t);
  assert.equal(ok.failCount, 0);

  // iPad: Mac-only checks N/A, not counted as failures
  const ipad = evaluateDevice({ id: 4, model: "iPad13,1", osVersion: "26.4.2",
    filevault_enabled: null, firewall_enabled: null, sip_enabled: null, xprotect_version: null }, t);
  assert.equal(ipad.platform, "iPadOS");
  assert.equal(ipad.filevaultOk, true); // N/A treated as not-a-failure off-platform
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `evaluateDevice` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```js
function assessXProtect(value, latest) {
  if (value === null || value === undefined || value === "") return { value: value ?? null, status: "absent" };
  if (!/^\d+$/.test(String(value))) return { value, status: "invalid" };
  if (latest && parseInt(value, 10) < parseInt(latest, 10)) return { value, status: "outdated" };
  return { value, status: "ok" };
}

export function evaluateDevice(device, tables) {
  const platform = detectPlatform(device);
  const osVersion = device.osVersion ?? device.os_version ?? "";
  const os = assessOS(osVersion, platform, tables);
  const isMac = platform === "macOS";
  const findings = [];

  // OS
  if (os.status === "outdated") {
    findings.push(`OS outdated (${os.cvesBehind} CVEs${os.exploitedBehind ? `, ${os.exploitedBehind} exploited` : ""})`);
  } else if (os.status === "eol") {
    findings.push("OS end-of-life");
  }

  // Mac-only security checks; off-platform => treated OK (N/A), not a failure
  const filevaultOk = isMac ? device.filevault_enabled === true : true;
  const sipOk = isMac ? device.sip_enabled !== false : true; // explicit false only
  const firewallOk = isMac ? device.firewall_enabled === true : true;
  if (isMac && !filevaultOk) findings.push("FileVault disabled");
  if (isMac && !sipOk) findings.push("SIP disabled");
  if (isMac && !firewallOk) findings.push("Firewall disabled");

  const xprotect = isMac ? assessXProtect(device.xprotect_version, tables.xprotectLatest) : { value: null, status: "absent" };
  if (xprotect.status === "outdated") findings.push(`XProtect outdated (${xprotect.value} -> ${tables.xprotectLatest})`);
  if (xprotect.status === "invalid") findings.push("XProtect invalid");

  const recommended = isMac ? recommendTarget(osVersion, device.model ?? "", tables) : { target: os.latest, path: [osVersion, os.latest].filter(Boolean), replace: false };

  return {
    id: device.id, name: device.name ?? "", serial: device.serial ?? device.serial_number ?? "",
    model: device.model ?? "", osVersion, platform,
    osStatus: os.status, latest: os.latest,
    recommended, cvesBehind: os.cvesBehind, exploitedBehind: os.exploitedBehind,
    filevaultOk, sipOk, firewallOk, xprotect,
    findings, failCount: findings.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: per-device evaluation composing all checks"
```

---

## Task 8: CVE-detail aggregation + summary

**Files:**
- Modify: `scripts/lib/evaluate.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { aggregateCveDetail, summarize } from "../scripts/lib/evaluate.mjs";
const devices = JSON.parse(readFileSync(new URL("./fixtures/devices.json", import.meta.url)));

test("aggregateCveDetail lists CVEs with exposure counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const rows = aggregateCveDetail(devices.map(d => evaluateDevice(d, t)), t);
  const c = rows.find(r => r.cve_id === "CVE-2025-0001");
  assert.equal(c.actively_exploited, true);
  assert.equal(c.fixed_in_version, "26.5.1");
  assert.equal(c.os_track, "macOS");
  // CVE-2025-0001 is fixed in 26.5.1; device id 1 on 26.0 (< 26.5.1) is still exposed.
  assert.equal(c.devices_still_exposed, 1);
});

test("summarize produces headline counts", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const s = summarize(ev);
  assert.equal(s.total, 4);
  assert.equal(typeof s.osOutdated, "number");
  assert.equal(typeof s.noFileVault, "number");
  assert.equal(typeof s.noSip, "number");
  assert.equal(typeof s.noFirewall, "number");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `aggregateCveDetail`/`summarize` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```js
export function aggregateCveDetail(evaluatedDevices, tables) {
  const rows = [];
  for (const [track, map] of [["macOS", tables.macOS], ["iOS", tables.ios]]) {
    const platforms = track === "macOS" ? ["macOS"] : ["iOS", "iPadOS"];
    for (const info of map.values()) {
      for (const r of info.releases) {
        for (const cve of r.cveList) {
          const exposed = evaluatedDevices.filter((d) =>
            platforms.includes(d.platform) &&
            parseVersion(d.osVersion)[0] === info.major &&
            compareVersions(d.osVersion, r.ver) < 0
          ).length;
          rows.push({
            cve_id: cve.id,
            fixed_in_version: r.ver,
            os_track: track,
            actively_exploited: cve.exploited,
            devices_still_exposed: exposed,
          });
        }
      }
    }
  }
  return rows;
}

export function summarize(evaluatedDevices) {
  const macs = evaluatedDevices.filter((d) => d.platform === "macOS");
  return {
    total: evaluatedDevices.length,
    withIssues: evaluatedDevices.filter((d) => d.failCount > 0).length,
    osOutdated: evaluatedDevices.filter((d) => d.osStatus === "outdated" || d.osStatus === "eol").length,
    noFileVault: macs.filter((d) => !d.filevaultOk).length,
    noSip: macs.filter((d) => !d.sipOk).length,
    noFirewall: macs.filter((d) => !d.firewallOk).length,
    xprotectOutdated: macs.filter((d) => d.xprotect.status === "outdated").length,
    unfixedCves: evaluatedDevices.reduce((sum, d) => sum + (d.cvesBehind || 0), 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/evaluate.mjs test/sofa-audit.test.mjs
git commit -m "feat: CVE-detail aggregation and summary counts"
```

---

## Task 9: CSV rendering

**Files:**
- Create: `scripts/lib/render.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { toCsv, securityRows, allDeviceRows, cveRows } from "../scripts/lib/render.mjs";

test("toCsv escapes and joins", () => {
  const csv = toCsv([["a", "b"]], [{ a: "x,y", b: 'q"z' }]);
  assert.equal(csv, 'a,b\r\n"x,y","q""z"');
});

test("section row builders return arrays of objects", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  assert.ok(securityRows(ev).length >= 1);
  assert.equal(allDeviceRows(ev).length, 4);
  assert.ok(cveRows(aggregateCveDetail(ev, t)).length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — module `render.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/render.mjs`:

```js
function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// header: [[colKey, ...]] flattened; rows: array of objects keyed by colKey
export function toCsv(header, rows) {
  const cols = header[0];
  const lines = [cols.map(esc).join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\r\n");
}

export function securityRows(ev) {
  return ev.filter((d) => d.failCount > 0).map((d) => ({
    name: d.name, serial: d.serial, model: d.model, os: d.osVersion,
    findings: d.findings.join("; "), unfixed_cves: d.cvesBehind ?? "",
    exploited: d.exploitedBehind ?? "", fail_count: d.failCount,
  }));
}

export function needUpdateRows(ev) {
  return ev.filter((d) => d.recommended?.target).map((d) => ({
    name: d.name, serial: d.serial, model: d.model,
    current: d.osVersion, path: d.recommended.path.join(" -> "),
    target: d.recommended.target, replace: d.recommended.replace,
  }));
}

export function allDeviceRows(ev) {
  return ev.map((d) => ({
    name: d.name, serial: d.serial, model: d.model, platform: d.platform, os: d.osVersion,
    filevault: d.filevaultOk ? "ok" : "off", sip: d.sipOk ? "ok" : "off",
    firewall: d.firewallOk ? "ok" : "off", xprotect: d.xprotect.status,
  }));
}

export function cveRows(cveDetail) {
  return cveDetail.map((c) => ({
    cve_id: c.cve_id, fixed_in_version: c.fixed_in_version, os_track: c.os_track,
    actively_exploited: c.actively_exploited, devices_still_exposed: c.devices_still_exposed,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs test/sofa-audit.test.mjs
git commit -m "feat: CSV row builders + escaping for sofa-audit"
```

---

## Task 10: Markdown rendering

**Files:**
- Modify: `scripts/lib/render.mjs`
- Test: `test/sofa-audit.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { renderMarkdown } from "../scripts/lib/render.mjs";

test("renderMarkdown produces all four sections + CVE detail", () => {
  const t = buildMajorTables(macFeed, iosFeed);
  const ev = devices.map(d => evaluateDevice(d, t));
  const md = renderMarkdown(ev, aggregateCveDetail(ev, t), summarize(ev), t, "2026-06-07");
  assert.match(md, /## Security Report/);
  assert.match(md, /## Vulnerability Check/);
  assert.match(md, /## Need Updates/);
  assert.match(md, /## All Devices/);
  assert.match(md, /CVE-2025-0001/);          // CVE detail present
  assert.match(md, /🔴/);                      // exploited marker present
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sofa-audit.test.mjs`
Expected: FAIL — `renderMarkdown` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `render.mjs`)

```js
function mdTable(cols, rows) {
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${body}` : "_none_";
}

export function renderMarkdown(ev, cveDetail, summary, tables, dateStr) {
  const out = [];
  out.push(`# SOFA Fleet Audit — ${dateStr}\n`);

  out.push("## Security Report\n");
  out.push(`Devices with issues: **${summary.withIssues}** / ${summary.total}. ` +
    `OS Outdated ${summary.osOutdated} · No FileVault ${summary.noFileVault} · ` +
    `No SIP ${summary.noSip} · No Firewall ${summary.noFirewall} · ` +
    `XProtect Outdated ${summary.xprotectOutdated} · Unfixed CVEs ${summary.unfixedCves}\n`);
  out.push(mdTable(["name", "serial", "os", "findings", "unfixed_cves", "fail_count"], securityRows(ev)) + "\n");

  out.push("## Vulnerability Check\n");
  for (const [track, map] of [["macOS", tables.macOS], ["iOS/iPadOS", tables.ios]]) {
    out.push(`### ${track}\n`);
    for (const info of [...map.values()].sort((a, b) => b.major - a.major)) {
      for (const r of info.releases) {
        const devs = ev.filter((d) => d.osVersion === r.ver).length;
        out.push(`- **${r.ver}** (${r.date}) — ${r.cves} CVEs, ${r.exploited} exploited, ${devs} device(s)`);
        if (r.cveList.length) {
          const list = r.cveList.map((c) => (c.exploited ? `🔴 ${c.id}` : c.id)).join(", ");
          out.push(`  - ${list}`);
        }
      }
    }
  }
  out.push("");

  out.push("## Need Updates\n");
  out.push(mdTable(["name", "serial", "current", "path", "target", "replace"], needUpdateRows(ev)) + "\n");

  out.push("## All Devices\n");
  out.push(mdTable(["name", "serial", "model", "platform", "os", "filevault", "sip", "firewall", "xprotect"], allDeviceRows(ev)) + "\n");

  return out.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sofa-audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs test/sofa-audit.test.mjs
git commit -m "feat: Markdown rendering (4 sections + CVE detail)"
```

---

## Task 11: SOFA fetch module (IO)

**Files:**
- Create: `scripts/lib/sofa.mjs`

- [ ] **Step 1: Write implementation**

Create `scripts/lib/sofa.mjs`:

```js
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FEEDS = {
  macos: "https://sofafeed.macadmins.io/v1/macos_data_feed.json",
  ios: "https://sofafeed.macadmins.io/v1/ios_data_feed.json",
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SOFA fetch failed ${res.status} for ${url}`);
  return res.json();
}

// cacheDir: where to read/write cached copies; maxAgeMs: reuse cache if newer
export async function loadSofa(cacheDir, { noCache = false, maxAgeMs = 86400000 } = {}) {
  const out = {};
  for (const [key, url] of Object.entries(FEEDS)) {
    const path = `${cacheDir}/sofa-${key}.json`;
    let data;
    const fresh = !noCache && existsSync(path) && (Date.now() - statSync(path).mtimeMs) < maxAgeMs;
    if (fresh) {
      data = JSON.parse(readFileSync(path, "utf8"));
    } else {
      try {
        data = await fetchJson(url);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(data));
      } catch (err) {
        if (existsSync(path)) {
          console.warn(`WARN: ${err.message} — using cached ${path}`);
          data = JSON.parse(readFileSync(path, "utf8"));
        } else {
          throw err;
        }
      }
    }
    out[key] = data;
  }
  return { macFeed: out.macos, iosFeed: out.ios };
}
```

- [ ] **Step 2: Manual verification (network)**

Run: `node -e "import('./scripts/lib/sofa.mjs').then(m=>m.loadSofa('/tmp/sofa-cache')).then(f=>console.log('macOS majors:', f.macFeed.OSVersions.length, 'xprotect:', f.macFeed.XProtectPlistConfigData['com.apple.XProtect']))"`
Expected: prints a positive count and the XProtect version (e.g. `5347`).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/sofa.mjs
git commit -m "feat: SOFA feed fetch with on-disk cache"
```

---

## Task 12: SimpleMDM device fetch module (IO)

**Files:**
- Create: `scripts/lib/simplemdm.mjs`

- [ ] **Step 1: Write implementation**

Create `scripts/lib/simplemdm.mjs`. Normalizes the nested API shape into the flat record the evaluator expects:

```js
const BASE = "https://a.simplemdm.com/api/v1";

function authHeader(apiKey) {
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function getPage(apiKey, startingAfter) {
  const url = new URL(`${BASE}/devices`);
  url.searchParams.set("limit", "100");
  if (startingAfter) url.searchParams.set("starting_after", String(startingAfter));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: authHeader(apiKey) } });
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(2 ** attempt * 1000, 16000);
      console.warn(`429 rate-limited, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401) throw new Error("SimpleMDM auth failed (401) — check SIMPLEMDM_API_KEY");
    if (!res.ok) throw new Error(`SimpleMDM /devices failed ${res.status}`);
    return res.json();
  }
}

function flatten(d) {
  const a = d.attributes ?? {};
  const cav = {};
  for (const c of d.relationships?.custom_attribute_values?.data ?? []) {
    cav[c.id] = c.attributes?.value ?? null;
  }
  return {
    id: d.id,
    name: a.name,
    serial: a.serial_number,
    model: a.product_name || a.model,
    osVersion: a.os_version,
    filevault_enabled: a.filevault_enabled,
    firewall_enabled: a.firewall?.enabled ?? null,
    sip_enabled: a.system_integrity_protection_enabled ?? null,
    last_seen_at: a.last_seen_at,
    xprotect_version: cav.xprotect_version ?? null,
  };
}

export async function fetchAllDevices(apiKey) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  const all = [];
  let after;
  for (;;) {
    const page = await getPage(apiKey, after);
    const data = page.data ?? [];
    all.push(...data.map(flatten));
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}
```

> Note: `a.product_name` is the model identifier (e.g. `MacBookPro18,1`) used by `detectPlatform`/`modelMaxMajor`; `a.model` is a marketing code. Prefer `product_name`.

- [ ] **Step 2: Manual verification (network, read-only)**

Run: `node -e "import('./scripts/lib/simplemdm.mjs').then(async m=>{const d=await m.fetchAllDevices(process.env.SIMPLEMDM_API_KEY);console.log('devices:',d.length,'sample model:',d[0]?.model)})" ` (with `SIMPLEMDM_API_KEY` exported from `.env`).
Expected: prints total device count (~449) and a model identifier.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/simplemdm.mjs
git commit -m "feat: SimpleMDM device fetch (paginated, 429 backoff)"
```

---

## Task 13: docx export module

**Files:**
- Create: `scripts/lib/docx.mjs`

- [ ] **Step 1: Write implementation**

Create `scripts/lib/docx.mjs`:

```js
import { spawnSync } from "node:child_process";

export function hasPandoc() {
  return spawnSync("pandoc", ["--version"], { stdio: "ignore" }).status === 0;
}

// Convert a Markdown file to .docx. Returns true on success, false if pandoc missing/failed.
export function mdToDocx(mdPath, docxPath) {
  if (!hasPandoc()) {
    console.warn("WARN: pandoc not found — skipping .docx export");
    return false;
  }
  const res = spawnSync("pandoc", [mdPath, "-o", docxPath], { stdio: "inherit" });
  return res.status === 0;
}
```

- [ ] **Step 2: Manual verification**

Run: `printf '# Hi\n\nbody\n' > /tmp/x.md && node -e "import('./scripts/lib/docx.mjs').then(m=>console.log('ok:', m.mdToDocx('/tmp/x.md','/tmp/x.docx')))" && ls -l /tmp/x.docx`
Expected: prints `ok: true` and lists the `.docx`.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/docx.mjs
git commit -m "feat: pandoc-based docx export"
```

---

## Task 14: Orchestrator entrypoint + CLI

**Files:**
- Create: `scripts/sofa-audit.mjs`

- [ ] **Step 1: Write implementation**

Create `scripts/sofa-audit.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { loadSofa } from "./lib/sofa.mjs";
import { fetchAllDevices } from "./lib/simplemdm.mjs";
import { buildMajorTables, evaluateDevice, aggregateCveDetail, summarize } from "./lib/evaluate.mjs";
import {
  toCsv, securityRows, needUpdateRows, allDeviceRows, cveRows, renderMarkdown,
} from "./lib/render.mjs";
import { mdToDocx } from "./lib/docx.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function loadEnvKey() {
  if (process.env.SIMPLEMDM_API_KEY) return process.env.SIMPLEMDM_API_KEY;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^\s*SIMPLEMDM_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}
function todayStr() {
  // Date is allowed in a normal Node script (not a workflow); format YYYY-MM-DD.
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const format = arg("format", "all");
  const dateStr = todayStr();
  const outDir = arg("out", `reports/audit-${dateStr}`);
  const noCache = process.argv.includes("--no-network-cache");

  const apiKey = loadEnvKey();
  const { macFeed, iosFeed } = await loadSofa(`${outDir}/.cache`, { noCache });
  const tables = buildMajorTables(macFeed, iosFeed);
  const devices = await fetchAllDevices(apiKey);
  const ev = devices.map((d) => evaluateDevice(d, tables));
  const cveDetail = aggregateCveDetail(ev, tables);
  const summary = summarize(ev);

  mkdirSync(outDir, { recursive: true });
  const write = (name, content) => writeFileSync(`${outDir}/${name}`, content);

  if (["csv", "all", "md", "docx"].includes(format)) {
    write("security-report.csv", toCsv([["name", "serial", "model", "os", "findings", "unfixed_cves", "exploited", "fail_count"]], securityRows(ev)));
    write("need-updates.csv", toCsv([["name", "serial", "model", "current", "path", "target", "replace"]], needUpdateRows(ev)));
    write("all-devices.csv", toCsv([["name", "serial", "model", "platform", "os", "filevault", "sip", "firewall", "xprotect"]], allDeviceRows(ev)));
    write("cve-detail.csv", toCsv([["cve_id", "fixed_in_version", "os_track", "actively_exploited", "devices_still_exposed"]], cveRows(cveDetail)));
  }

  const md = renderMarkdown(ev, cveDetail, summary, tables, dateStr);
  if (["md", "docx", "all"].includes(format)) write("full-audit.md", md);
  if (["docx", "all"].includes(format)) mdToDocx(`${outDir}/full-audit.md`, `${outDir}/full-audit.docx`);

  write("summary.txt",
    `SOFA Audit ${dateStr}\nDevices: ${summary.total} (issues: ${summary.withIssues})\n` +
    `OS Outdated ${summary.osOutdated} | No FileVault ${summary.noFileVault} | No SIP ${summary.noSip} | ` +
    `No Firewall ${summary.noFirewall} | XProtect Outdated ${summary.xprotectOutdated} | Unfixed CVEs ${summary.unfixedCves}\n`);

  console.log(`Audit written to ${outDir}/`);
  console.log(readFileSync(`${outDir}/summary.txt`, "utf8"));
}

main().catch((err) => { console.error("AUDIT FAILED:", err.message); process.exit(1); });
```

- [ ] **Step 2: Manual verification (full run, read-only against tenant)**

Run: `node scripts/sofa-audit.mjs --format all`
Expected: prints `Audit written to reports/audit-<date>/` and a summary with non-zero counts; the directory contains the 5 CSVs, `full-audit.md`, `full-audit.docx`, `summary.txt`.

- [ ] **Step 3: Verify reports stay untracked**

Run: `git status --short reports/`
Expected: `reports/` shows as ignored/untracked (no staged files).

- [ ] **Step 4: Commit**

```bash
git add scripts/sofa-audit.mjs
git commit -m "feat: sofa-audit orchestrator + CLI"
```

---

## Task 15: /audit skill wrapper

**Files:**
- Create: `.claude/skills/audit/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/audit/SKILL.md`:

```markdown
---
name: audit
description: Generate a full SOFA-based macOS fleet security audit (Security Report, Vulnerability Check, Need Updates, All Devices + CVE detail) and export to CSV/Markdown/docx. Use when asked to run a fleet audit, security report, or SOFA report.
---

# SOFA Fleet Audit

Run the audit engine and report where the files landed. Do NOT commit the output.

## Steps

1. Determine the format from the user's request (default `all`). Map words to flags:
   - "csv" → `--format csv`, "word"/"docx" → `--format docx`, "markdown"/"md" → `--format md`, otherwise `--format all`.
2. Run: `node scripts/sofa-audit.mjs --format <format>`
3. Read `reports/audit-<today>/summary.txt` and relay the headline counts to the user.
4. List the generated files. Remind the user the output is local-only (gitignored) and not committed.

## Notes
- Read-only: the engine performs no SimpleMDM writes.
- Requires `SIMPLEMDM_API_KEY` in `.env` (read-only key is sufficient).
- XProtect checks populate only if the `xprotect_version` custom attribute is collected; otherwise they report 0 / "absent".
```

- [ ] **Step 2: Verify skill is discoverable**

Run: `cat .claude/skills/audit/SKILL.md | head -3`
Expected: shows the YAML frontmatter `name: audit`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat: /audit skill wrapper for sofa-audit"
```

---

## Task 16: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a documentation section**

Append to `README.md` a section titled `## Fleet Audit (/audit)` containing:

```markdown
## Fleet Audit (/audit)

Generate a full SOFA-based macOS security audit:

```bash
node scripts/sofa-audit.mjs --format all   # csv | md | docx | all
```

Outputs to `reports/audit-YYYY-MM-DD/` (gitignored): `security-report.csv`, `need-updates.csv`,
`all-devices.csv`, `cve-detail.csv`, `full-audit.md`, and `full-audit.docx` (via pandoc).
Sections mirror the Report-SimpleMDM tabs: Security Report, Vulnerability Check, Need Updates,
All Devices — plus per-CVE detail. Read-only; requires `SIMPLEMDM_API_KEY` in `.env`.
XProtect checks require the `xprotect_version` custom attribute (see `reports/xprotect/STAGING.md`).
```

- [ ] **Step 2: Verify**

Run: `grep -n "Fleet Audit" README.md`
Expected: prints the new heading line.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document /audit fleet audit command"
```

---

## Task 17: Full test sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test file**

Run: `node --test test/sofa-audit.test.mjs`
Expected: all tests PASS, 0 failures.

- [ ] **Step 2: Run the existing project test suite to confirm no regressions**

Run: `npm test`
Expected: existing suite still passes (the new files are additive).

- [ ] **Step 3: Final commit (if any lint/format fixups were needed)**

```bash
git add -A ':!reports'
git commit -m "chore: sofa-audit final cleanup" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** §3 surface → Tasks 14/15; §6 data sources → Tasks 11/12; §7 eligibility-from-SOFA → Tasks 4/6; §8 four sections → Tasks 9/10/14; §9 CVE detail → Tasks 8/9/10; §10 output layout/formats → Tasks 13/14; §11 error/edges → Tasks 5/7/11/12/13; §12 testing → Tasks 2–10/17; §13 security/no-commit → Tasks 1/14/15.
- **No placeholders:** every code step contains complete code; commands have expected output.
- **Type consistency:** evaluated-device fields (`osStatus`, `filevaultOk`, `sipOk`, `firewallOk`, `xprotect.status`, `recommended.path/target/replace`, `cvesBehind`, `exploitedBehind`) are defined in Task 7 and consumed identically in Tasks 8–10/14. `buildMajorTables` shape from Task 4 used unchanged in Tasks 5/6/8/10/14.
