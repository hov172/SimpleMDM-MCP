# Fleet Audit (`/audit`) — Deep Dive

The fleet audit is a self-contained command that produces a full **macOS security
posture report** for your SimpleMDM fleet by joining your **live device inventory**
with the **[SOFA](https://sofa.macadmins.io) feed** (Simple Organized Feed for Apple
Software Updates). It answers, for every device: *is the OS current, how many unfixed
(and actively-exploited) CVEs is it exposed to, what's the supported upgrade path, and
are FileVault / SIP / Firewall / XProtect in the right state?* — and exports the
results to CSV, Markdown, Word, and PDF.

It is **not** part of the MCP server's tool surface. It's a host-side script
(`scripts/sofa-audit.mjs`) plus a `/audit` Claude Code skill wrapper. It talks
**directly to the SimpleMDM API** (read-only) and the public SOFA feed — no external
app, service, or database.

---

## Why it exists

The raw SimpleMDM API tells you each device's `os_version`, `filevault_enabled`, etc.,
but not *what that means for security*: which OS versions still get patches, how many
CVEs a device is behind, which are being exploited, or what version a given Mac can
actually upgrade to. SOFA publishes exactly that Apple-update intelligence. The audit
joins the two so a Mac admin gets an actionable, exportable posture report in one
command instead of cross-referencing spreadsheets by hand.

---

## How it works

```
 SimpleMDM API  ──GET /devices (paginated, read-only)──┐
 GET /device_groups (id → name)                        │
                                                        ▼
 SOFA feed ──macos_data_feed.json / ios_data_feed.json──►  join + evaluate (pure JS)
   • latest version per OS major                            • per-device checks
   • SecurityReleases (CVEs, actively-exploited)            • per-CVE aggregation
   • Models map (model → supported OS majors)               • per-group rollup
   • XProtect baseline                                      • headline summary
                                                        ▼
                              CSV · Markdown · Word (docx) · PDF
                              written to reports/audit-YYYY-MM-DD/  (gitignored)
```

### Data sources

1. **SimpleMDM** — `GET /api/v1/devices` (auto-paginated, 429 backoff) and
   `GET /api/v1/device_groups` (to resolve group names). Read-only; a read-only API
   key is sufficient. Per device the audit uses: `name`, `device_name`,
   `serial_number`, `product_name` (the model identifier, e.g. `MacBookPro15,2`),
   `os_version`, `filevault_enabled`, `firewall.enabled`,
   `system_integrity_protection_enabled`, `last_seen_at`, the
   `device_group` relationship, and any `xprotect_version` custom attribute.
2. **SOFA** — `macos_data_feed.json` and `ios_data_feed.json`. The audit reads:
   - `OSVersions[].Latest.ProductVersion` — latest release per OS major.
   - `OSVersions[].SecurityReleases[]` — each release's `UniqueCVEsCount`, `CVEs`
     map, and `ActivelyExploitedCVEs` list.
   - `Models` — maps a model identifier to the list of OS majors it supports
     (`{ "Mac14,9": { "OSVersions": [26,15,14] } }`). This is the source of
     "the newest version this hardware can run."
   - `XProtectPlistConfigData["com.apple.XProtect"]` — the latest XProtect config
     version (the XProtect baseline).

   The feed is cached on disk per audit run (24h TTL; `--no-network-cache` forces a
   refetch).

---

## Running it

In Claude Code, ask for it (the `/audit` skill runs the engine):

> `/audit` · *"run a fleet security audit"* · *"export the SOFA report as a Word doc"*

Or run the engine directly:

```bash
node scripts/sofa-audit.mjs --format all     # csv | md | docx | all  (default: all)
```

| Flag | Meaning |
|---|---|
| `--format csv` | data files only |
| `--format md` | combined Markdown report + CSVs |
| `--format docx` | adds a Word document (needs `pandoc`) |
| `--format all` | everything (default) |
| `--serial A,B` | scope the audit to these devices (whole fleet if omitted) |
| `--group "Name"` | scope to a **device or assignment** group (at most one selector) |
| `--last-seen N` | scope to the N most recently seen devices |
| `--out <dir>` | output directory (default `reports/audit-YYYY-MM-DD/`) |
| `--no-network-cache` | ignore the cached SOFA feed and refetch |

By default the audit covers the **whole fleet**. The optional selectors above scope it to a
subset; `--group` understands both legacy **device groups** and **assignment groups** (the same
resolution `/logs-audit --group` uses), and the chosen scope is recorded in `summary.txt`. On a
scoped run the **Vulnerability Check** is also trimmed to the OS major-version ladders the selected
devices are on — empty tracks (e.g. iOS/iPadOS for a macs-only scope) and unrelated macOS majors
are dropped, while the full upgrade ladder within a kept major is preserved.

For a print-ready **PDF**, run `scripts/make-audit-pdf.sh [audit-dir]` after the audit
(see [PDF export](#pdf-export)).

**Requirements:** `SIMPLEMDM_API_KEY` in `.env` (read-only is fine — the audit never
writes). `pandoc` for `.docx`; `pandoc` + a Chromium browser for `.pdf`.

---

## What it evaluates

For each device the audit determines:

- **OS status** — `current` (on the latest of an actively-supported major),
  `outdated` (behind, on a supported major), `eol` (on a major in the feed but no
  longer actively patched), or `untracked` (major not in the feed at all, e.g. macOS
  10/11).
- **Unfixed CVEs** — the cumulative count of CVEs (and the actively-exploited subset)
  fixed in releases **strictly newer** than the device's version, within its OS major.
- **Upgrade path** — the chain to the newest version the **hardware** can run
  (e.g. `14.6.1 → 15.7.7 → 26.5.1`); hardware that can't reach a supported macOS is
  flagged **REPLACE**.
- **FileVault / SIP / Firewall** — from the native device fields (Mac-only checks).
- **XProtect** — the device's XProtect version vs SOFA's latest (requires the
  `xprotect_version` custom attribute; otherwise reported as N/A — see
  [XProtect](#xprotect-optional)).

### How the numbers are computed

- **Supported majors** = the three highest OS majors present in the feed (macOS
  currently 26 / 15 / 14; iOS/iPadOS 26 / 18 / 17). Older majors that are still in the
  feed (e.g. macOS 13/12) are treated as **EOL** for *status*, but their CVE counts
  are still computed up to that major's final release. Majors absent from the feed
  entirely are `untracked`.
- **Unfixed CVE count** = sum of `UniqueCVEsCount` over releases whose version is
  strictly greater than the device's version, within its major. A device already has
  the fixes from releases ≤ its version, so only newer releases count. (This matches
  the reference tooling exactly.)
- **Eligibility / upgrade target** comes from SOFA's `Models` map, not from
  `SupportedDevices` (which lists board IDs that don't match SimpleMDM model
  identifiers). The newest version the hardware can run = the latest release of the
  highest major in `Models[modelId].OSVersions`.

---

## Headline breakdown (`summary.txt`)

```
OS Outdated <n> | No FileVault <n> | No SIP <n> | No Firewall <n> | XProtect Outdated <n> | Unfixed CVEs <n>
```

| Metric | Definition |
|---|---|
| **OS Outdated** | devices **not on the newest version their hardware can run** |
| **No FileVault** | **all** devices without FileVault enabled (non-Macs count as "no") |
| **No SIP** | Macs reporting System Integrity Protection off |
| **No Firewall** | Macs reporting the application firewall off |
| **XProtect Outdated** | Macs below SOFA's XProtect baseline; **`N/A (not set up)`** when the attribute isn't collected |
| **Unfixed CVEs** | number of **devices** missing at least one CVE fix |

---

## Output files

Everything is written to `reports/audit-YYYY-MM-DD/`, which is **gitignored** — reports
contain live tenant data and are never committed.

| File | Granularity | Contents |
|---|---|---|
| `summary.txt` | fleet | the headline breakdown |
| `all-devices.csv` | per device (all) | `name, device_name, serial, device_group, os_version, latest_minor, latest_major, unfixed_cves, product, fv, sip, fw, xp, last_seen` (FV/SIP/FW = `on`/`off`; XP = `ok`/`outdated`/`invalid`/`N/A`) |
| `security-report.csv` | per device with issues | `name, serial, device_group, model, os, findings, unfixed_cves, exploited, fail_count, last_seen` |
| `need-updates.csv` | per device needing update | `name, serial, device_group, model, current, path, target, replace` |
| `by-group.csv` | per device group | `device_group, devices, os_outdated, no_filevault, no_sip, no_firewall, unfixed_cve_devices` |
| `vulnerability-check.csv` | per OS release | `version, track, date, cves_fixed, actively_exploited, devices_on_release, unfixed_to_latest, cves` |
| `cve-detail.csv` | per CVE | `cve_id, fixed_in_version, os_track, actively_exploited, devices_still_exposed` |
| `device-cves.csv` | per device | each device's full list of unfixed CVEs in one multi-line `cves` cell (`[exploited]` marks actively-exploited) |
| `cve-devices.csv` | per CVE | the inverse: each CVE's affected device names/serials in one multi-line `devices` cell (`cve_id, fixed_in_version, os_track, actively_exploited, devices_exposed, devices`) |
| `full-audit.md` | combined | the four sections + By Device Group, as Markdown |
| `full-audit.docx` | combined | Word version (via pandoc) |
| `full-audit.pdf` | combined | print-ready PDF, written automatically by `--format all` (WeasyPrint/Chrome) |

### Report sections (`full-audit.md`)

1. **Security Report** — every device with an issue, with its findings, CVE count, and group.
2. **Vulnerability Check** — a per-release table: CVEs fixed, actively-exploited, devices on the release, and unfixed-to-latest. The actual CVE IDs per release live in `cve-detail.csv` / `vulnerability-check.csv`. On a scoped run it is trimmed to the OS major-version ladders the selected devices are on (see the scoping note above).
3. **Need Updates** — devices needing updates with their supported upgrade paths.
4. **By Device Group** — the `by-group.csv` rollup, for batching remediation by group.
5. **All Devices** — the complete inventory table.

---

## Device group

Every per-device output carries the device's **device group** (resolved live from
`/device_groups`), and `by-group.csv` + the "By Device Group" section roll the posture
up per group (devices, OS-outdated, FileVault/SIP/Firewall, unfixed-CVE counts). This
lets you target remediation by group ("the whole *Library Labs* group is EOL") instead
of scanning individual serials. Per-release and per-CVE tables omit the group, since a
release or CVE spans many groups.

---

## PDF export

`--format all` writes `full-audit.pdf` **automatically**. To regenerate it standalone
(e.g. after a `--format md` run):

```bash
scripts/make-audit-pdf.sh                       # newest reports/audit-*/
scripts/make-audit-pdf.sh reports/audit-2026-06-08
```

It renders `full-audit.md → full-audit.html → full-audit.pdf` with `pandoc` + the shared
renderer (`scripts/lib/report-pdf.mjs`), using `scripts/audit-report.head.html` for
styling: **A3 landscape, full page width, dynamic content-sized columns**, with the same
navy/zebra look and **footer page numbers** as the `/logs-audit` dossier. PDF rendering
prefers **WeasyPrint** (`brew install weasyprint`) for the "Page X of Y" footer and falls
back to headless Chrome / Edge / Chromium (which renders correctly but without page
numbers). Edit `scripts/audit-report.head.html` to tweak fonts, margins, or page size.

---

## XProtect (optional)

XProtect version isn't exposed by the SimpleMDM device API, so the XProtect checks only
populate if you collect it into a custom attribute named `xprotect_version`. Until then
XProtect reports `N/A (not set up)` (per device and in the headline) rather than a
misleading `0`. A ready-to-run, no-secrets collector and the exact setup steps are
staged in `reports/xprotect/STAGING.md`. Once values flow in, the audit compares each
device's value to SOFA's latest XProtect config: lower → *outdated*, non-numeric →
*invalid*.

---

## Architecture / code map

| File | Responsibility |
|---|---|
| `scripts/sofa-audit.mjs` | orchestrator + CLI: fetch, evaluate, write files |
| `scripts/lib/evaluate.mjs` | **pure** logic: version math, platform detection, SOFA tables, OS assessment, upgrade paths, per-device evaluation, CVE aggregation, group rollup, summary |
| `scripts/lib/render.mjs` | **pure** rendering: CSV row builders + escaping, Markdown |
| `scripts/lib/sofa.mjs` | fetch + cache the SOFA feeds |
| `scripts/lib/simplemdm.mjs` | paginated device + device-group fetch (429 backoff) |
| `scripts/lib/docx.mjs` | pandoc → docx |
| `scripts/lib/report-pdf.mjs` · `scripts/audit-report.head.html` · `scripts/make-audit-pdf.sh` | PDF export (shared WeasyPrint/Chrome renderer + A3 stylesheet + standalone regenerator) |
| `test/sofa-audit.test.mjs` | unit tests for the pure logic (fixtures, no network) |

The pure modules (`evaluate`, `render`) are fixture-tested with `node --test` and carry
no IO, so the join/CVE/eligibility logic is verifiable without hitting the network.

---

## Caveats

- **EOL "—" understates risk.** A device on a major no longer in the feed
  (`untracked`) can't have its CVE count computed; treat it as maximally exposed.
- **XProtect** needs the custom attribute (above); otherwise N/A.
- **Live feed vs. a fixed snapshot.** Headline numbers shift slightly over time as
  SOFA publishes new releases/CVEs and devices check in — the *definitions* are stable.
- **Read-only & local.** The audit performs no SimpleMDM writes, and all output stays
  in the gitignored `reports/` directory — it is never committed.
