# SOFA Audit Command — Design Spec

**Date:** 2026-06-07
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session (Claude + maintainer)

## 1. Goal

Provide a real, reproducible command that generates a full macOS fleet security audit by joining
live SimpleMDM device inventory against the SOFA feed, with optional export to `.csv` and a
document format (`.md` / `.docx`). The output mirrors the four report tabs of the Report-SimpleMDM
companion app — Security Report, Vulnerability Check, Need Updates, All Devices — and additionally
emits per-CVE detail.

This formalizes the ad-hoc audit produced manually on 2026-06-07. That run's figures matched the
Report-SimpleMDM app exactly (No SIP 274, No Firewall 399), validating the methodology.

## 2. Non-goals

- Not a UI. Report-SimpleMDM already renders these tabs; this is a headless, exportable generator.
- Not adding SOFA-join tools to the MCP server (a possible future follow-up — see §13).
- Not performing any writes to SimpleMDM (no remediation, no attribute/script creation).
- Not collecting XProtect on devices (separate staged pipeline; this command only *reports* the
  `xprotect_version` custom attribute if present).

## 3. Surface & invocation

- **Engine:** `scripts/sofa-audit.mjs` — standalone Node ESM script, runnable directly:
  `node scripts/sofa-audit.mjs --format all`
- **Command wrapper:** a Claude Code skill `audit` (invoked as `/audit`) that runs the engine and
  reports where files were written. The skill is a thin wrapper; all logic lives in the engine.
- **Language/deps:** Plain ESM JavaScript, Node ≥18 built-ins only (`fetch`, `fs`, `path`). No npm
  dependencies. `pandoc` (already installed) is shelled out to only for `.docx`.
- **Sections:** always all four. No per-section selection in v1 (YAGNI).

## 4. CLI

```
node scripts/sofa-audit.mjs [--format <md|csv|docx|all>] [--out <dir>] [--no-network-cache]
```

- `--format` (default `all`): `csv` = data files only; `md` = combined Markdown + CSVs;
  `docx` = Markdown + CSVs + Word doc; `all` = everything.
- `--out` (default `reports/audit-YYYY-MM-DD/`): output directory.
- `--no-network-cache`: ignore any cached SOFA feed and refetch.

Exit non-zero on auth failure, SOFA fetch failure (with no cache), or write failure.

## 5. Architecture / modules

Split into pure (testable) logic and IO:

- `scripts/sofa-audit.mjs` — entrypoint: parse args, orchestrate, write files.
- `scripts/lib/sofa.mjs` — fetch + parse SOFA feeds; build per-major release tables, CVE maps,
  XProtect baseline, and model→max-supported-major map (from SOFA `Models`/`SupportedDevices`).
- `scripts/lib/simplemdm.mjs` — fetch all devices (paginated, 429 backoff) using the read-only key.
- `scripts/lib/evaluate.mjs` — **pure** join/eval functions (no IO): platform bucketing, version
  comparison, releases/CVEs/exploited-behind, upgrade-path derivation, per-check compliance,
  XProtect comparison.
- `scripts/lib/render.mjs` — **pure** functions producing Markdown strings and CSV rows per section.
- `scripts/lib/docx.mjs` — pandoc invocation (the only place that shells out).

Only `evaluate.mjs` and `render.mjs` are exercised by unit tests; they take plain data in and return
strings/objects, no network or fs.

## 6. Data sources

1. **SimpleMDM** `GET /api/v1/devices` (read-only `SIMPLEMDM_API_KEY` from `.env`, Basic auth).
   Auto-paginates (`has_more` / `starting_after`). Per device, used fields:
   `name`, `serial_number`, `model`, `model_name`, `product_name`, `os_version`,
   `filevault_enabled`, `firewall.enabled`, `system_integrity_protection_enabled`, `last_seen_at`,
   and `relationships.custom_attribute_values` (for `xprotect_version`).
2. **SOFA** `macos_data_feed.json` + `ios_data_feed.json` from `https://sofafeed.macadmins.io/v1/`.
   Provides per-OSVersion `Latest`, `SecurityReleases` (with `UniqueCVEsCount`, `CVEs`,
   `ActivelyExploitedCVEs`), `XProtectPlistConfigData`, and `Models`/`SupportedDevices`.

Optional on-disk SOFA cache under the out dir's parent; refetched if older than 24h or
`--no-network-cache`.

## 7. Eligibility / upgrade paths (SOFA-derived)

For each Mac model identifier, max-supported macOS major = the highest SOFA OSVersion whose
`SupportedDevices` includes that model. Upgrade path = chain from current major to the newest
**actively-supported** major the hardware allows, e.g. `14.6.1 → 15.7.7 → 26.5.1`. Macs whose ceiling
is an EOL major (≤ 13) are flagged **REPLACE** (cannot reach a supported macOS). No static table is
maintained in this command.

Actively-supported macOS majors = the set SOFA still issues security releases for (currently
Sonoma 14, Sequoia 15, Tahoe 26). Recommended target is the newest supported major the hardware
allows; EOL versions are never recommended.

## 8. The four sections

### 8.1 Security Report
Devices with ≥1 issue. Summary counts: `OS Outdated`, `No FileVault`, `No SIP`, `No Firewall`,
`XProtect Outdated`, `Unfixed CVEs (total)`, and `N devices with issues`. Per-device rows: name,
serial, model, OS, badges (Minor update needed / Update to macOS N / FileVault disabled / SIP
disabled / Firewall disabled / XProtect outdated), unfixed-CVE count, last-seen.

### 8.2 Vulnerability Check
Per macOS release (newest→oldest): release name + track, date, `CVEs fixed`, `actively exploited`,
`devices on this release`, and `unfixed-to-latest`. Header totals: `Releases`, `CVEs Fixed`,
`Actively Exploited`. **Includes CVE detail** — see §9.

### 8.3 Need Updates
Devices needing updates with supported upgrade paths. Header: `Needs Update`, `Up to Date`,
`% compliant`. Per-device: `current → target` chain (REPLACE where hardware-capped).

### 8.4 All Devices
Complete inventory: name, serial, model identifier, OS version, FV/SIP/FW/XP status icons,
last-seen timestamp. Includes iPad/iPod; Mac-only checks shown as N/A off-platform.

## 9. CVE detail

Two representations:

- **Inline** in Vulnerability Check Markdown: under each release, the list of fixed CVE IDs, with
  🔴 marking actively-exploited entries. Long lists are kept readable (grouped, exploited first).
- **Dedicated `cve-detail.csv`**: one row per CVE — `cve_id`, `fixed_in_version`, `os_track`,
  `actively_exploited` (bool), `devices_still_exposed` (count of fleet devices on an older version
  in that track). This makes CVE data independently sortable/filterable.

## 10. Output layout & formats

Output dir `reports/audit-YYYY-MM-DD/` (override with `--out`):

| File | When | Content |
|---|---|---|
| `security-report.csv` | always | §8.1 per-device rows |
| `vulnerability-check.csv` | always | §8.2 per-release rows |
| `need-updates.csv` | always | §8.3 per-device rows |
| `all-devices.csv` | always | §8.4 inventory |
| `cve-detail.csv` | always | §9 per-CVE rows |
| `full-audit.md` | `md`/`docx`/`all` | all four sections + CVE detail, combined |
| `full-audit.docx` | `docx`/`all` | pandoc conversion of `full-audit.md` |

A short `summary.txt` with headline counts is always written for quick console echo.

## 11. Error handling & edge cases

- **Auth/API:** missing key → clear error before any work; 401 → explain; **429 → exponential
  backoff** with cap, then fail with progress note.
- **SOFA fetch fail:** use cache if present (warn it's stale); else exit non-zero.
- **pandoc missing:** emit `.md` + CSVs, warn, skip `.docx` (don't fail the run).
- **Data edges:** null/empty `os_version` → "unknown", excluded from version math, surfaced in a
  "needs attention" note; unknown model → max-supported unknown, flagged; iPad/iPod → iOS/iPadOS
  track, Mac-only checks N/A.
- **XProtect absent:** no `xprotect_version` attribute → `XProtect Outdated = 0`, devices show "—"
  (matches the app), never a false failure. Non-numeric value → "XProtect invalid".

## 12. Testing

`test/sofa-audit.test.mjs` (Node `node --test`, matching existing tests). Fixtures: trimmed SOFA
macOS+iOS JSON and a handful of synthetic device records. Cases:

- version-behind / CVE-behind / exploited-behind math against a known release chain
- upgrade-path derivation incl. REPLACE (hardware-capped) and Tahoe-capable
- platform bucketing (Mac / iPad / iPod, by model identifier)
- per-check compliance (FV/SIP/FW true/false/null handling)
- XProtect: numeric-behind, numeric-current, missing, non-numeric
- CSV row shape and CVE-detail aggregation (`devices_still_exposed`)

Pure functions only; no network, no fs, no pandoc in tests.

## 13. Security & conventions

- Uses the existing **read-only** `SIMPLEMDM_API_KEY`; performs **no writes**. No secrets embedded.
- Output under `reports/` is **gitignored / never committed** (maintainer preference).
- Follows repo conventions: ESM `.mjs`, `node --test`, no build step for the script.

## 14. Future (out of scope here)

Promote `evaluate.mjs`/`sofa.mjs` logic into MCP server compound tools (`get_security_report`,
`get_vulnerability_check`, `get_update_paths`) so other clients and Report-SimpleMDM share one
implementation. The pure functions are designed to port directly.

## 15. File manifest (to be created)

- `scripts/sofa-audit.mjs`
- `scripts/lib/{sofa,simplemdm,evaluate,render,docx}.mjs`
- `test/sofa-audit.test.mjs`
- `test/fixtures/{sofa-macos,sofa-ios,devices}.json`
- `.claude/skills/audit/SKILL.md` (the `/audit` wrapper)
- `.gitignore` entry for `reports/` (if not already present)
- `README.md` section documenting `/audit` and the script
