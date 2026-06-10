# SimpleMDM MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

An MCP (Model Context Protocol) server for [SimpleMDM](https://simplemdm.com) that lets you query and manage your fleet using natural language through Claude Desktop, Claude Code, or any MCP-compatible client.


## Contents

- [What this lets you do](#what-this-lets-you-do)
- [Requirements](#requirements)
- [Install](#install)
- [Quick Start](#quick-start)
- [Connect a client](#connect-a-client)
- [Enable write actions](#enable-write-actions)
- [Examples](#examples)
- [Fleet Audit (/audit)](#fleet-audit-audit)
- [Device Logs Audit (/logs-audit)](#device-logs-audit-logs-audit)
- [Tools](#tools)
- [Resources](#resources)
- [Prompts](#prompts)
- [API key permissions](#api-key-permissions)
- [Environment variables](#environment-variables)
- [Claude Code permissions (settings.json)](#claude-code-permissions-settingsjson)
- [Security](#security)
- [Rate limits and error behavior](#rate-limits-and-error-behavior)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)
- [License](#license)

---


## What this lets you do

Once connected, you can ask Claude things like:

- *"Which devices haven't checked in for 7 days?"*
- *"Show me all supervised Macs not running macOS 15.4"*
- *"Which devices in the Finance group are missing the VPN profile?"*
- *"Give me a fleet posture summary — supervised, DEP enrolled, FileVault"*
- *"How many devices are enrolled vs unenrolled?"*
- *"What apps are installed on the device with serial ABC123XYZ?"*
- *"Lock device 1234 with the message 'Contact IT at x4400'"*
- *"Run the 'rotate FileVault keys' script on every Mac in the Finance assignment group"*
- *"Set the `department` custom attribute to 'Sales' on all devices in the Sales device group"*
- *"Show me which DDM declarations are assigned to serial ABC123XYZ and which are pending"*
- *"List every managed app config pushed in the last 24 hours and the devices that received them"*

Claude decides which tools to call and in what combination. You just ask the question.

For a one-shot, exportable fleet security report (OS currency, CVEs, FileVault/SIP/Firewall/XProtect),
see the [`/audit` command](#fleet-audit-audit) — it joins your live fleet against the
[SOFA](https://sofa.macadmins.io) feed and writes CSV / Markdown / Word files. For a
targeted, legal/forensic export of a device's **activity logs** (optionally combined with
its security posture and software inventory), see [`/logs-audit`](#device-logs-audit-logs-audit).

---

## Requirements

- **Node.js 18 or later** — check with `node --version`. Install via [Homebrew](https://brew.sh): `brew install node`
- **A SimpleMDM API key** — get one from SimpleMDM > Settings > API Keys
- **Claude Desktop** or **Claude Code** (or any MCP-compatible client)

---

## Install

### Option A — From npm (recommended)
```bash
npm install -g simplemdm-mcp
```

### Option B — From source
```bash
git clone https://github.com/hov172/SimpleMDM-MCP
cd SimpleMDM-MCP
cp .env.example .env
npm install
npm run build
```

### Option C — Docker container
```bash
git clone https://github.com/hov172/SimpleMDM-MCP
cd SimpleMDM-MCP
cp .env.example .env
docker build -t simplemdm-mcp .
```

Edit `.env` and set your required values before running the container.

Run it with your env file:
```bash
docker run --rm -i --env-file .env simplemdm-mcp
```

Or pass vars directly:
```bash
docker run --rm -i \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  simplemdm-mcp
```

**Optional — bake the version into the image label** for `docker inspect` traceability:

```bash
docker build --build-arg VERSION=$(node -p "require('./package.json').version") \
  -t simplemdm-mcp:$(node -p "require('./package.json').version") .
docker inspect simplemdm-mcp:$(node -p "require('./package.json').version") | grep version
```

The `VERSION` build-arg defaults to `dev` when omitted, so the basic `docker build` above is fine for local-only use.

Notes:
- Use `-i` so the MCP server can stay attached to stdio.

---

## Quick Start

Fastest path with Claude Code + Docker:

```bash
git clone https://github.com/hov172/SimpleMDM-MCP
cd SimpleMDM-MCP
docker build -t simplemdm-mcp .
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- docker run --rm -i simplemdm-mcp
```

Replace `your-api-key-here` with a key from **SimpleMDM > Settings > API Keys**. Use a read-only key unless you plan to enable writes.

If you don't want Docker, use the npm or source options below.

---

## Connect a client

Pick your client below — all use the same `simplemdm` MCP server over stdio; only the config location differs.

### Claude Desktop

**1. Find or create the config file**

Open Finder, press `Cmd + Shift + G`, and paste this path:
```
~/Library/Application Support/Claude/
```

Open `claude_desktop_config.json` in a text editor. If the file does not exist, create it.

**2. Add the SimpleMDM server**

```json
{
  "mcpServers": {
    "simplemdm": {
      "command": "simplemdm-mcp",
      "env": {
        "SIMPLEMDM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

If you installed from source instead of npm, replace `"simplemdm-mcp"` with `"node"` and add the full path as the first argument:
```json
{
  "mcpServers": {
    "simplemdm": {
      "command": "node",
      "args": ["/path/to/SimpleMDM-MCP/dist/index.js"],
      "env": {
        "SIMPLEMDM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

If you want Claude Desktop to launch the Docker container instead:
```json
{
  "mcpServers": {
    "simplemdm": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--env-file", "/absolute/path/to/SimpleMDM-MCP/.env", "simplemdm-mcp"]
    }
  }
}
```

Build the image first:
```bash
docker build -t simplemdm-mcp /absolute/path/to/SimpleMDM-MCP
```

**3. Restart Claude Desktop**

Quit and reopen the app. You should see a tools icon in the chat input bar — click it to confirm SimpleMDM tools are listed.

---
### Claude Code (CLI)

The `claude` CLI has a built-in `mcp add` subcommand. Pick whichever transport matches how you installed the server:

**Docker:**
```bash
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- docker run --rm -i simplemdm-mcp
```

**npm (global install):**
```bash
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- npx simplemdm-mcp
```

**From source:**
```bash
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- node /path/to/SimpleMDM-MCP/dist/index.js
```

To keep secrets in a file instead of repeating `-e` flags, point Docker at an env-file:
```bash
claude mcp add simplemdm \
  -- docker run --rm -i --env-file /absolute/path/to/SimpleMDM-MCP/.env simplemdm-mcp
```

Verify the server is connected:
```bash
claude mcp list
```

Remove it later with:
```bash
claude mcp remove simplemdm
```

---
### Codex CLI (OpenAI)

The OpenAI [Codex CLI](https://github.com/openai/codex) supports stdio MCP servers via `~/.codex/config.toml`.

Open (or create) `~/.codex/config.toml` and add:

```toml
[mcp_servers.simplemdm]
command = "docker"
args = ["run", "--rm", "-i", "--env-file", "/absolute/path/to/SimpleMDM-MCP/.env", "simplemdm-mcp"]
```

Or without Docker:

```toml
[mcp_servers.simplemdm]
command = "node"
args = ["/absolute/path/to/SimpleMDM-MCP/dist/index.js"]
env = { SIMPLEMDM_API_KEY = "your-api-key-here" }
```

Restart `codex`. The SimpleMDM tools will appear in tool listings during a session.

---
### ChatGPT

ChatGPT's custom connectors require an **HTTPS URL** (SSE or streamable-HTTP transport). This server speaks stdio, so you need a bridge.

**1. Run an MCP stdio → HTTP proxy** (e.g. [`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy)):

```bash
pip install mcp-proxy

SIMPLEMDM_API_KEY=your-api-key-here \
mcp-proxy --sse-port 8080 -- \
  node /absolute/path/to/SimpleMDM-MCP/dist/index.js
```

Expose port 8080 over HTTPS (e.g. `cloudflared`, `ngrok`, or a reverse proxy with TLS). ChatGPT will not accept plain HTTP URLs.

**2. Add it as a connector in ChatGPT**

Available on ChatGPT **Pro, Business, Enterprise, and Edu** plans:

1. Open **Settings → Connectors → Advanced → Developer mode** and enable it.
2. In a chat, open **+ → Add connector → + Create**.
3. Fill in:
   - **Name:** `SimpleMDM`
   - **MCP server URL:** your HTTPS URL (e.g. `https://your-tunnel.example.com/sse`)
   - **Authentication:** whatever your proxy/tunnel requires (OAuth, header token, or none for a locked-down local tunnel)
4. Save, then enable the connector in the composer's tool picker.

**Notes:**
- Anyone with the URL can call your fleet tools. Put the proxy behind authentication or an IP-restricted tunnel — don't expose it publicly.
- ChatGPT caches connector schemas; if you add/remove tools, refresh the connector in Settings.
- If your ChatGPT plan doesn't expose developer-mode connectors, you can still use the MCP server from the **ChatGPT Apps SDK** or through any agent framework that supports MCP (LangChain, Mastra, OpenAI Agents SDK, etc.).

---
### Other MCP clients

This server is not Claude-specific. It is a standard MCP server over `stdio`, so any MCP-capable client or agent can use it if that client supports registering local MCP servers.

Use one of these commands as the MCP server process:

With Docker:
```bash
docker run --rm -i --env-file /absolute/path/to/SimpleMDM-MCP/.env simplemdm-mcp
```

From source:
```bash
node /absolute/path/to/SimpleMDM-MCP/dist/index.js
```

Generic stdio MCP configuration should include:
- command: `docker` or `node`
- args: the command arguments needed to launch the server
- env: either inline environment variables or an env-file mechanism if the client supports it

Minimum required environment:
- `SIMPLEMDM_API_KEY`

Optional environment:
- `SIMPLEMDM_ALLOW_WRITES=true`

If your client supports MCP but has a different config format, map the same command, args, and env values into that client’s schema.

---

## Enable write actions

By default the server is **read-only** — all query tools work, but lock/sync/restart/assign/script actions are blocked even if your API key has write permissions. This is intentional.

To enable write actions, add `SIMPLEMDM_ALLOW_WRITES=true` to your config:

```json
"env": {
  "SIMPLEMDM_API_KEY": "your-api-key-here",
  "SIMPLEMDM_ALLOW_WRITES": "true"
}
```

See [API key permissions](#api-key-permissions) below for what each action requires.

---

## Examples

The [`examples/`](examples/) directory ships drop-in client configs and a starter query cookbook:

- [`claude-desktop.json`](examples/claude-desktop.json) — read-only Claude Desktop block
- [`claude-desktop-with-writes.json`](examples/claude-desktop-with-writes.json) — same with `SIMPLEMDM_ALLOW_WRITES=true`
- [`claude-desktop-with-munkireport.json`](examples/claude-desktop-with-munkireport.json) — Claude Desktop + MunkiReport enrichment
- [`claude-code-add.sh`](examples/claude-code-add.sh) — one-line Claude Code registration
- [`codex.toml`](examples/codex.toml) — Codex CLI config snippet
- [`docker-run.sh`](examples/docker-run.sh) — versioned `docker build` + run
- [`query-cookbook.md`](examples/query-cookbook.md) — 30+ natural-language queries grouped by intent

---

## Fleet Audit (/audit)

A self-contained command that generates a full macOS fleet **security audit** by joining your live
SimpleMDM device inventory with the [SOFA](https://sofa.macadmins.io) feed (Simple Organized Feed
for Apple Software Updates). It reports OS currency, unfixed CVEs (including actively-exploited
ones), upgrade paths, and FileVault / SIP / Firewall / XProtect posture — and exports the results to
CSV, Markdown, and Word.

It talks **directly to the SimpleMDM API** (read-only) joined with the public SOFA feed — no external
app, service, or database. Eligibility / "latest version your hardware can run" is derived from
SOFA's `Models` map, so it stays current with Apple's support matrix automatically.

> 📖 **Deep dive:** see [`docs/fleet-audit.md`](docs/fleet-audit.md) for how the join works, how each
> metric is computed, the full output reference, and the code map.

### Running it

In Claude Code, just ask for it (the **`/audit`** skill runs the engine):

> `/audit` &nbsp;·&nbsp; *"run a fleet security audit"* &nbsp;·&nbsp; *"export the SOFA report as a Word doc"*

Or run the engine directly:

```bash
node scripts/sofa-audit.mjs --format all   # csv | md | docx | all  (default: all)
```

| Flag | Meaning |
|------|---------|
| `--format csv` | data files only (`.csv`) |
| `--format md` | combined Markdown report + CSVs |
| `--format docx` | adds a Word doc (requires [`pandoc`](https://pandoc.org)) |
| `--format all` | everything (default) |
| `--out <dir>` | output directory (default `reports/audit-YYYY-MM-DD/`) |
| `--no-network-cache` | ignore the cached SOFA feed and refetch |

**Requirements:** `SIMPLEMDM_API_KEY` in `.env` (a **read-only** key is sufficient — the audit never
writes). `pandoc` only needed for `.docx`.

### Output

Everything is written to `reports/audit-YYYY-MM-DD/` (which is **gitignored** — reports contain live
tenant data and are never committed):

| File | Contents |
|------|----------|
| `summary.txt` | the headline breakdown (see below) |
| `all-devices.csv` | one row per device: `name, device_name, serial, device_group, os_version, latest_minor, latest_major, unfixed_cves, product, fv, sip, fw, xp, last_seen` (FV/SIP/FW shown as `on`/`off`; XP as `ok`/`outdated`/`invalid`, or `N/A` when the XProtect attribute isn't collected) |
| `security-report.csv` | one row per device **with issues**, with its `device_group`, findings, CVE count, and exploited count |
| `need-updates.csv` | one row per device needing an update, with its `device_group` and `current → target` upgrade path |
| `by-group.csv` | per **device group** rollup: `device_group, devices, os_outdated, no_filevault, no_sip, no_firewall, unfixed_cve_devices` — for batching remediation by group |
| `vulnerability-check.csv` | one row per macOS/iOS release: CVEs fixed, actively-exploited, devices on it, and a multi-line `cves` cell |
| `cve-detail.csv` | one row per CVE: `cve_id, fixed_in_version, os_track, actively_exploited, devices_still_exposed` |
| `device-cves.csv` | one row per device, with **every CVE that device is still missing** collapsed into a single multi-line cell (`[exploited]` marks actively-exploited) |
| `cve-devices.csv` | the inverse — one row per CVE, with the **affected device names/serials** collapsed into a single multi-line cell (`cve_id, fixed_in_version, os_track, actively_exploited, devices_exposed, devices`) |
| `full-audit.md` | the four sections combined as Markdown |
| `full-audit.docx` | Word version of `full-audit.md` (when `--format docx`/`all`) |

### The four sections

1. **Security Report** — devices with any issue (outdated OS, FileVault/SIP/Firewall off, XProtect outdated), with per-device findings.
2. **Vulnerability Check** — a per-release table (CVEs fixed, actively-exploited, devices on the release, unfixed-to-latest); the actual CVE IDs per release are in `cve-detail.csv` / `vulnerability-check.csv`.
3. **Need Updates** — devices needing updates with supported upgrade paths (e.g. `14.6.1 → 15.7.7 → 26.5.1`); hardware that can't reach a supported macOS is flagged **REPLACE**.
4. **All Devices** — the complete inventory table (see `all-devices.csv` above), plus a **By Device Group** rollup so you can batch remediation by group.

### Headline breakdown (`summary.txt`)

```
OS Outdated <n> | No FileVault <n> | No SIP <n> | No Firewall <n> | XProtect Outdated <n> | Unfixed CVEs <n>
```

- **OS Outdated** — devices not on the newest version their **hardware** can run.
- **No FileVault** — all devices without FileVault enabled.
- **No SIP / No Firewall** — Macs reporting System Integrity Protection / firewall off.
- **XProtect Outdated** — Macs whose XProtect version is below SOFA's latest. Requires the custom attribute below; when it isn't collected this reads **`N/A (not set up)`** rather than `0`.
- **Unfixed CVEs** — number of **devices** missing at least one CVE fix.

### PDF export (optional)

The audit emits Markdown and Word directly. For a print-ready **PDF** (A3 landscape,
full-width, content-sized columns), run the generator after an audit:

```bash
scripts/make-audit-pdf.sh                       # newest reports/audit-*/
scripts/make-audit-pdf.sh reports/audit-2026-06-08
```

It renders `full-audit.md → full-audit.pdf` via `pandoc` + a headless Chromium-based
browser (Chrome / Edge / Chromium). Requires `pandoc` and one of those browsers installed.

### XProtect checks (optional)

XProtect version isn't exposed by the SimpleMDM device API, so the two XProtect checks only populate
if you collect it into a custom attribute named `xprotect_version`. A ready-to-run collector and the
exact setup steps are staged in `reports/xprotect/STAGING.md`. Until then, XProtect reports
`N/A (not set up)` (and `N/A` per device) rather than `0` / false failures.

---

## Device Logs Audit (/logs-audit)

A **targeted, legal/forensic** export of device **activity logs** from the SimpleMDM
`/logs` feed for a selected set of devices — optionally combined with each device's
security posture and software inventory. Where [`/audit`](#fleet-audit-audit) is
fleet-wide and posture-oriented, `/logs-audit` is targeted and activity-oriented: it
answers *what happened on these specific machines, when, and in what order*, and exports
the result to CSV, raw JSON, a SHA-256 integrity manifest, and a detailed combined
report (Markdown / HTML / Word / PDF).

Like `/audit`, it talks **directly to the SimpleMDM API** (read-only) — no external app
or service — and is a host-side script (`scripts/logs-audit.mjs`) plus a `/logs-audit`
skill, not an MCP tool.

> 📖 **Deep dive:** see [`docs/logs-audit.md`](docs/logs-audit.md) for the full output
> reference, fidelity/disclosure notes, code map, and more examples.

### Running it

In Claude Code, ask for it (the **`/logs-audit`** skill maps your words to flags):

> *"export the logs for serial ABC123"* &nbsp;·&nbsp; *"forensic log report for the last 10 devices seen, with security"* &nbsp;·&nbsp; *"audit the Faculty group's device logs"*

Or run the engine directly — **exactly one selector** is required:

```bash
node scripts/logs-audit.mjs <selector> [flags]
```

| Selector | Meaning |
|------|---------|
| `--serial A,B,C` | specific devices by serial number (comma-separated) |
| `--last-seen N` | the **N** most recently seen devices |
| `--group "Name"` | every device in a device/assignment group of that name |
| `--all` | the whole fleet — **requires `--confirm-all`** (heavy: one log fetch per device) |

| Flag | Meaning |
|------|---------|
| `--with-inventory` | also export per-device inventory + installed apps + profiles |
| `--with-security` | also run the SOFA evaluation on the selected devices (posture + CVEs) |
| `--format <fmt>` | `csv` \| `md` \| `docx` \| `all` (default `all`) |
| `--out <dir>` | output directory (default `reports/logs-audit-YYYY-MM-DD/`) |

**Requirements:** `SIMPLEMDM_API_KEY` in `.env` (a **read-only** key is sufficient).
`pandoc` is needed for `.docx`/`.html`/`.pdf`; the PDF prefers
[WeasyPrint](https://weasyprint.org) (`brew install weasyprint`) for footer page numbers
and falls back to headless Chrome.

### Examples

```bash
# One device, every artifact (CSV + JSON + manifest + md/html/docx/pdf report)
node scripts/logs-audit.mjs --serial C02ABC123XYZ --format all

# The 10 most recently active devices, with security posture, full report
node scripts/logs-audit.mjs --last-seen 10 --with-security --format all

# A whole group, with inventory + security, data files only
node scripts/logs-audit.mjs --group "Faculty" --with-inventory --with-security --format csv

# Two specific devices into a named directory
node scripts/logs-audit.mjs --serial ABC123,DEF456 --out reports/case-2026-06 --format all

# Whole fleet (heavy — explicit acknowledgement required)
node scripts/logs-audit.mjs --all --confirm-all --format csv
```

### Output

Written to `reports/logs-audit-YYYY-MM-DD/` (which is **gitignored** — exports contain
live tenant data and event history, and are never committed):

| File | Contents |
|------|----------|
| `logs.csv` | one row per `/logs` event — chronologically sorted, verbatim `at` + sortable `at_iso`, device name/owner, typed metadata columns |
| `logs-status-snapshots.csv` | one row per `status.changed` event; full snapshot externalized to a sidecar via the `status_json_file` column |
| `status-snapshots/` | one `<serial>__<logid>.json` per `status.changed` event with the **full** device-status snapshot (kept out of the CSV so no cell is oversized) |
| `logs-summary.csv` | per-device pivot + **coverage window** (event counts, first/last event, `span_days`) |
| `raw-logs.json` | complete, unaltered per-device log records + export metadata |
| `manifest.csv` | SHA-256 of every output (incl. each sidecar) + timezone/retention/completeness disclosures + any collection errors |
| `summary.txt` | headline counts (devices, total events, per-type totals, failed devices) |
| `inventory.csv`, `apps.csv`, `profiles.csv` | *(with `--with-inventory`)* per-device inventory / apps / profiles |
| `security-posture.csv`, `device-cves.csv` | *(with `--with-security`)* SOFA posture + per-device outstanding CVEs |
| `report.md` / `.html` / `.docx` / `.pdf` | the combined **dossier** (fleet roll-up + per-device identity, security, activity, notable software-update events, inventory), with **noisy-device flagging** when one device dominates log volume |

### Fidelity & disclosures

Timestamps are reproduced **verbatim** (`at`) plus a sortable `at_iso` — the `/logs` API
returns times in the account display timezone (`America/New_York`) with **no UTC offset**,
so `at_iso` is the same wall-clock with **no shift and no UTC claim**. The feed is
**retention-bounded** (the earliest event per device is the API's retention horizon, not
device-lifetime history). Every file and snapshot sidecar is SHA-256-hashed in the
manifest, which also records any devices that failed collection — all disclosed for legal
defensibility.

---

## Tools

The server registers **173 tools** covering the full SimpleMDM API surface (28 derived fleet-analytics tools added in 0.5.0, 5 MunkiReport enrichment tools, 16 Apple schema helper tools). Reads are always available; writes require `SIMPLEMDM_ALLOW_WRITES=true`. Every tool ships with MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so compatible clients can render the correct confirmation UI.

Apple schema helpers (`search_apple_device_management_schemas`, `get_apple_device_management_schema`, `validate_apple_payload`, `build_mobileconfig`, `build_custom_declaration_payload`, plus convenience builders for Wi-Fi, restrictions, SCEP/certificates, VPN, web clips, content filters, FileVault escrow, firewall, passcode, and software update settings) use `data/apple-device-management/schema-cache.json`, generated from Apple's public `apple/device-management` YAML schemas, with curated fallback data for high-value payloads. They do not call the third-party Apple Profile Builder site at runtime. See [`docs/apple-schema-helpers.md`](docs/apple-schema-helpers.md) for the search -> validate/build -> create SimpleMDM profile/declaration workflow and [`data/apple-device-management/README.md`](data/apple-device-management/README.md) for cache refresh/maintenance details.

👉 **See [`docs/tools.md`](docs/tools.md) for the complete catalog** — every read and write tool, grouped by area.

---

## Resources

Alongside tools, this server exposes canonical **MCP resources** that clients can browse independently of the tool surface. Each returns JSON.

| URI | What it returns |
|---|---|
| `simplemdm://fleet/summary` | Fleet KPIs (alias for `get_fleet_summary`) |
| `simplemdm://reports/security-posture` | Fleet-wide posture percentages (alias for `get_security_posture`) |
| `simplemdm://reports/os-versions` | OS version distribution across the fleet |
| `simplemdm://reports/enrollment` | Enrolled/unenrolled totals plus the list of unenrolled devices |
| `simplemdm://reports/filevault` | FileVault on/off per enrolled Mac (for compliance review) |
| `simplemdm://reports/top-apps` | Apps ranked by install count across the fleet (alias for `get_top_installed_apps`) |
| `simplemdm://reports/unmanaged-apps` | Apps installed on the fleet but missing from the catalog |
| `simplemdm://reports/stale-devices` | Enrolled devices not checked in for >14 days |
| `simplemdm://reports/storage-health` | Devices below disk/battery thresholds |
| `simplemdm://inventory/devices` | Full device list (auto-paginated) |
| `simplemdm://inventory/assignment-groups` | All assignment groups with membership |
| `simplemdm://inventory/apps` | Full app catalog (auto-paginated) |

Resources are loaded via the client's resource picker (Claude Desktop/Code → `Resources` menu; ChatGPT connectors → resource references in a chat). Tools remain the right choice when you need to pass parameters or perform mutations.

---

## Prompts

The server ships workflow **prompts** — templated starting points selectable from the MCP client's prompt picker. Each produces a ready-to-run instruction that composes the right tools for the task.

| Prompt | Arguments | What it does |
|---|---|---|
| `fleet-health-dashboard` | — | Calls `get_fleet_summary` + `get_security_posture`, summarizes posture, lists outliers, proposes up to 3 actions |
| `security-audit` | — | Full posture audit; highlights any metric under 80%; pulls FileVault-off Macs from resource |
| `new-device-onboarding` | `device_ref` (ID or serial) | Verifies profiles, apps, group membership, recent MDM log for a newly enrolled device |
| `device-offboarding` | `device_ref` | Plans offboarding steps (unscope, profile review, lock/wipe) — **never** calls destructive writes without explicit user confirmation |
| `patch-compliance-review` | — | OS version distribution, flags devices >1 major version behind, recommends groups to prioritize |
| `stale-devices-cleanup` | `days` (default 14) | Finds devices not checked in, proposes sync → lock ladder without auto-wipe |
| `app-inventory-audit` | `limit` (default 25) | Cross-fleet top-apps + unmanaged-apps audit; recommends catalog additions/removals |
| `compliance-violators-remediation` | `max_os_major_lag` (default 1) | Calls `get_compliance_violators`, groups by failure type, proposes remediation tools per group |
| `profile-coverage-remediation` | `profile_id` (required) | Calls `get_devices_missing_profile`, recommends bulk vs per-device assignment based on gap size |

Destructive prompts (offboarding, stale cleanup) include explicit guards: the LLM is told **not** to call write tools without you typing `CONFIRM`.

---

## API key permissions

**Read-only** (recommended starting point — covers all query tools):
- Devices: read
- Apps: read
- Profiles: read
- Enrollment: read

**With writes enabled** — add whichever write domains you need:
- Devices: write (lock, sync, restart, shutdown, lost mode, OS update, script jobs)
- Assignment Groups: write (assign/unassign devices, push apps)

Start with read-only. Add write permissions only if you need them, and only for the specific domains required.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIMPLEMDM_API_KEY` | Yes | — | SimpleMDM API key |
| `SIMPLEMDM_ALLOW_WRITES` | No | `false` | Set `true` to enable write actions. Off by default. |
| `SIMPLEMDM_TIMEOUT_MS` | No | `30000` | Per-request timeout in milliseconds. Requests that exceed this are aborted. |
| `SIMPLEMDM_MAX_RETRIES` | No | `3` | Retry count for `429` and `5xx` responses. Uses Retry-After when present, otherwise exponential backoff. |
| `SIMPLEMDM_MAX_PAGES` | No | `200` | Safety cap on pagination (all list tools, fleet-analytics tools, resources). Each page fetches 100 records, so `200` = 20,000 max. Raise for very large fleets. |
| `SIMPLEMDM_CACHE_TTL_MS` | No | `300000` | In-memory cache TTL in milliseconds (default 5 min). All list endpoints and fleet-iteration results are cached; write operations automatically invalidate affected entries. Set to `0` to disable caching. |
| `SIMPLEMDM_FLEET_CONCURRENCY` | No | `8` | Worker count for fleet-iteration analytics tools. Lower (`4`) if you see 429s; raise (`16`) only if your tenant tolerates it. |
| `MAC_OS_ELIGIBILITY_OVERRIDE` | No | — | JSON object mapping model-prefix → max-macOS-major. Patches the built-in support table used by `get_os_eligibility` without redeploying. Example: `{"Mac16,":15,"MacBookPro18,":15}`. |
| `CURRENT_SUPPORTED_OS_OVERRIDE` | No | — | JSON object overriding the currently-shipping major per platform (used as the OS-lag baseline by `get_compliance_violators`). Example: `{"mac":26,"ios":26,"ipad":26}`. Update on each Apple major release. |
| `LOCAL_APP_MODE` | No | `false` | Set `true` to route requests through the optional Report-SimpleMDM local app bridge instead of calling the SimpleMDM API directly. When enabled, `SIMPLEMDM_API_KEY` is not required. |
| `LOCAL_APP_BASE_URL` | No | `http://127.0.0.1:49552` | Base URL of the local app bridge (used only when `LOCAL_APP_MODE=true`). |
| `LOCAL_APP_TOKEN` | No | — | Bearer token for the local app bridge. **Required** when `LOCAL_APP_MODE=true`. |
| `LOCAL_APP_TIMEOUT_MS` | No | `15000` | Timeout when using the optional Report-SimpleMDM local app bridge. |
| `MUNKIREPORT_BASE_URL` | No | — | Base URL of your MunkiReport instance (e.g. `https://munkireport.example.com`). Required for `get_munkireport_*` tools when not using the local app bridge. |
| `MUNKIREPORT_MODULE_PREFIX` | No | `/module/simplemdm` | Path prefix for the MunkiReport simplemdm module endpoints. |
| `MUNKIREPORT_AUTH_HEADER_NAME` | No | — | HTTP header name for MunkiReport authentication (e.g. `Authorization`). |
| `MUNKIREPORT_AUTH_HEADER_VALUE` | No | — | HTTP header value for MunkiReport authentication (e.g. `Bearer <token>`). |
| `MUNKIREPORT_COOKIE` | No | — | Cookie string for MunkiReport session-based authentication (alternative to header auth). |

---

## Claude Code permissions (settings.json)

This repo ships two permission profiles for [Claude Code](https://docs.claude.com/claude-code):

| File | Scope | When to use |
|---|---|---|
| `.claude/settings.json` | Committed, team-wide | Conservative default — pre-approves read-only tools and safe shell helpers. Writes and destructive git still prompt. |
| `.claude/settings.auto.example.json` | Template | Opt-in "auto mode" profile — fewer prompts, with a deny list covering destructive shell, history-rewriting git, and SimpleMDM write tools (`wipe_device`, `delete_*`, `clear_*`). |

**To activate auto mode for your user:**

```bash
# Copy the template into your personal Claude config
cp .claude/settings.auto.example.json ~/.claude/settings.json
# …or as a project-local override (gitignored)
cp .claude/settings.auto.example.json .claude/settings.local.json
```

Key settings in the auto template:

- `"permissions.defaultMode": "auto"` — Claude Code's classifier approves routine commands without prompting and still asks for genuinely risky ones
- `allow` — all read-only MCP tools (`mcp__simplemdm__get_*`, `mcp__simplemdm__list_*`), read-only file tools, safe Bash prefixes, plus dev-workflow niceties like `git commit --amend`, `git rebase`, `git restore --staged`, `killall`/`pkill`/`kill -9`, `docker rm`/`rmi`, `chmod -R`/`chown -R`
- `deny` — destructive shell (`rm`, `sudo`, `dd`, `mkfs`, `shutdown`), data-loss git (`reset --hard`, `clean -f*`, `checkout .`, `branch -D`, `tag -d`, `filter-branch`, `reflog delete`), force-push (`push --force*`, `push --delete`), `npm publish/unpublish`, `docker system prune`/`volume rm`, `gh pr/issue/release/repo delete` — **and** SimpleMDM write tools that could impact devices (`wipe_device`, `unenroll_device`, all `delete_*`, all `clear_*` password tools)

No read tool is denied anywhere — information-gathering across the SimpleMDM surface (account, devices, apps, groups, profiles, DEP, logs, posture, MunkiReport enrichment) always flows without prompting.

### Customizing the rules

Rules are strings matched by prefix. `deny` always wins over `allow`, and both win over `defaultMode`.

**Syntax examples:**

| Rule | Meaning |
|---|---|
| `"Bash"` | All Bash commands |
| `"Bash(git status)"` | Exactly `git status`, no arguments |
| `"Bash(git status:*)"` | `git status` with any arguments |
| `"Bash(npm run:*)"` | Any `npm run <something>` |
| `"mcp__simplemdm__list_*"` | All SimpleMDM list tools (wildcard) |
| `"mcp__simplemdm__wipe_device"` | Exact tool name |
| `"Read"` | All Read tool calls |
| `"WebFetch(domain:github.com)"` | Only fetches to github.com |

**Add an allow rule** (open the right file, append a string to the `allow` array):

```bash
# Personal / global
$EDITOR ~/.claude/settings.json

# Project-local, gitignored
$EDITOR .claude/settings.local.json
```

```jsonc
{
  "permissions": {
    "allow": [
      "Bash(terraform:*)",           // new: allow terraform commands
      "mcp__simplemdm__lock_device"  // new: allow a specific MCP write
    ]
  }
}
```

**Add a deny rule:**

```jsonc
{
  "permissions": {
    "deny": [
      "Bash(gh auth logout:*)",     // new: never auto-log out of gh
      "mcp__simplemdm__wipe_device" // new: never auto-wipe a device
    ]
  }
}
```

**Remove a rule** — delete the matching line from the `allow` or `deny` array. Don't leave a trailing comma on the previous line, or JSON parse will fail and *all* rules in that file are silently ignored.

**Validate after editing:**

```bash
python3 -m json.tool ~/.claude/settings.json > /dev/null && echo ok
```

**Which file to edit:**

| Goal | File |
|---|---|
| Personal default across all projects | `~/.claude/settings.json` |
| Team-wide for this repo (committed) | `.claude/settings.json` |
| My overrides for this repo (gitignored) | `.claude/settings.local.json` |

Claude Code hot-reloads these files during a session — no restart needed.

**Settings files never contain API keys.** Secrets belong in the MCP server's `env` block in your Claude Desktop / Claude Code CLI / Codex config — not in `settings.json`.

See [CONTRIBUTING.md](CONTRIBUTING.md#claude-code-permissions) for the contributor-facing permission policy.

---

## Security

**Your API key stays on your machine.** It is stored in `claude_desktop_config.json` and used only by the MCP server process running locally. It is never sent to Anthropic.

**Fleet data goes through Anthropic.** The questions you ask and the tool results Claude receives — including device names, serial numbers, OS versions, and group names — are processed by Anthropic's servers as part of the conversation. Review [Anthropic's privacy policy](https://www.anthropic.com/privacy) for your compliance requirements. Teams and Enterprise plans have additional data privacy agreements.

**The config file is plaintext.** `claude_desktop_config.json` stores the API key in cleartext on disk. Treat it like a password file. Do not use a full-permission API key on a shared machine.

**Writes are off by default.** You must explicitly set `SIMPLEMDM_ALLOW_WRITES=true` to enable any action that modifies fleet state. Using a read-only key with writes disabled means the worst outcome from any unexpected query is a list of devices — not a remote wipe.

**Input is validated server-side.** Every tool call is checked against its declared JSON schema for required fields and primitive types before dispatch, and every URL path segment is validated + `encodeURIComponent`-encoded to block path traversal or query injection via tool arguments.

**Network calls are hardened.** All upstream requests enforce a timeout (default 30s) with automatic retry and exponential backoff on `429` / `5xx`. Upstream error bodies are truncated before being surfaced to the client so large payloads can't leak through.

**For environments with strict data requirements** — healthcare, government, finance — use Claude for Enterprise with a BAA or DPA in place before connecting fleet data, or consult your compliance team first.

---

## Rate limits and error behavior

SimpleMDM enforces an API rate limit of roughly **60 requests per minute** per account. Tools that fan out across the fleet (bulk `list_devices` pagination, `push_apps_to_group`, `create_script_job` on large groups) can hit this quickly.

The server now handles this automatically: on `429` responses it honors the `Retry-After` header when present, otherwise falls back to exponential backoff. Retries are capped by `SIMPLEMDM_MAX_RETRIES` (default 3). Only if retries are exhausted does the error reach Claude.

How the server behaves on common API responses:

| API response | Server behavior |
|---|---|
| `200 OK` | Returned to Claude as tool output |
| `204 No Content` | Returned as `{ "success": true }` |
| `401 Unauthorized` | Surfaced as an error — API key is invalid or revoked |
| `403 Forbidden` | Surfaced as an error — API key lacks the required permission domain for that tool |
| `404 Not Found` | Returned as an error with the resource identifier |
| `429 Too Many Requests` | Retried automatically with Retry-After / exponential backoff (up to `SIMPLEMDM_MAX_RETRIES`) |
| `5xx` | Retried automatically with exponential backoff; surfaced as an error only if retries exhausted |
| Timeout | Aborted after `SIMPLEMDM_TIMEOUT_MS` (default 30s) and retried |

**Tips for large fleets**
- Prefer `get_fleet_summary` over `list_devices` for posture/KPI questions — it's one call.
- All list tools auto-paginate at 100 records per page until every page is collected. No manual pagination needed.
- Fleet-wide pagination is capped at `SIMPLEMDM_MAX_PAGES` pages (default 200 × 100 = 20k records). Raise it if your fleet is larger.
- **Results are cached in-memory** (default TTL: 5 min, configurable via `SIMPLEMDM_CACHE_TTL_MS`). Repeated calls to the same list endpoint or fleet-analytics tool within the TTL window return instantly from cache with zero API calls. Write operations automatically invalidate affected cache entries so subsequent reads pick up changes.
- For writes that touch many devices (e.g. `push_apps_to_group`), SimpleMDM queues server-side — check `list_script_jobs` / app install status a minute later rather than re-triggering.
- The fleet-analytics tools (`get_top_installed_apps`, `get_app_coverage`, `get_compliance_violators`, etc.) issue 1 HTTP per device under a bounded worker pool. Tune `SIMPLEMDM_FLEET_CONCURRENCY` (default 8) up or down based on your tenant's rate-limit headroom.

---

## Troubleshooting

**Tools don't appear in Claude Desktop**
- Quit Claude Desktop completely (Cmd+Q, not just close the window) and reopen
- Check `claude_desktop_config.json` for JSON syntax errors — an extra comma or missing bracket will silently break it
- Run `node dist/index.js` from the project directory manually to check for startup errors

**"SIMPLEMDM_API_KEY is required" error**
- The env var is missing from your config. Double-check the key name spelling in the JSON.

**API returns 401**
- The API key is invalid or has been revoked. Generate a new one in SimpleMDM > Settings > API Keys.

**Write action returns "Write actions are disabled"**
- Add `SIMPLEMDM_ALLOW_WRITES: "true"` to the `env` block in your config and restart Claude Desktop.

**Write action returns 403**
- The API key lacks the required permission domain. Check the tool's required permission in the Tools table above and update the key's permissions in SimpleMDM.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## License

[MIT](LICENSE) © Jay Ayala ([@hov172](https://github.com/hov172))

---

## 🌐 Connect With Me
- [GitHub](https://github.com/hov172)  
- [PowerShell Gallery](https://www.powershellgallery.com/profiles/hov172)  
- 📨 Slack: **@Hov172**  
- 🕹️ Discord: **Jay172_**  
- [LinkedIn](https://www.linkedin.com/in/jesus-a-785bb616?trk=people-guest_people_search-card)  
- 🐦 [Twitter / X (@AyalaSolutions)](https://twitter.com/AyalaSolutions)  
- <a href="https://bsky.app/profile/ayalasolutions.bsky.social"><img src="https://raw.githubusercontent.com/bluesky-social/social-app/main/assets/logo.png" width="20" alt="Bluesky Logo"></a> [@AyalaSolutions](https://bsky.app/profile/ayalasolutions.bsky.social)  
- [![Buy Me A Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/hov172)  
- 📧 *Contact via GitHub, Social accounts issues or discussions*  

---

⭐ *If you find my tools useful, consider giving them a star to support future development!*
