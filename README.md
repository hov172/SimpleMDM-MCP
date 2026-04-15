# SimpleMDM MCP Server

An MCP (Model Context Protocol) server for [SimpleMDM](https://simplemdm.com) that lets you query and manage your fleet using natural language through Claude Desktop, Claude Code, or any MCP-compatible client.

Companion to [Report-SimpleMDM](https://github.com/hov172/Report-SimpleMDM) and [SimpleMDM-MunkiReport](https://github.com/hov172/SimpleMDM-MunkiReport).

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

Claude decides which tools to call and in what combination. You just ask the question.

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
npm install
npm run build
```

---

## Connect to Claude Desktop

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

**3. Restart Claude Desktop**

Quit and reopen the app. You should see a tools icon in the chat input bar — click it to confirm SimpleMDM tools are listed.

---

## Connect to Claude Code

```bash
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- npx simplemdm-mcp
```

Or from source:
```bash
claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=your-api-key-here \
  -- node /path/to/SimpleMDM-MCP/dist/index.js
```

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

## MunkiReport enrichment (optional)

If you run the [SimpleMDM-MunkiReport](https://github.com/hov172/SimpleMDM-MunkiReport) module, add these to your env to enable compliance, AppleCare, sync health, and per-device enrichment tools:

```json
"env": {
  "SIMPLEMDM_API_KEY": "your-api-key-here",
  "MUNKIREPORT_BASE_URL": "https://munkireport.example.com",
  "MUNKIREPORT_MODULE_PREFIX": "/module/simplemdm",
  "MUNKIREPORT_AUTH_HEADER_NAME": "X-SIMPLEMDM-API-KEY"
}
```

For cookie-authenticated MunkiReport deployments, use `MUNKIREPORT_COOKIE` instead of the header vars.

---

## Local app mode (Report-SimpleMDM users only)

If you're already running [Report-SimpleMDM](https://github.com/hov172/Report-SimpleMDM), you can connect the MCP server to the app instead of the SimpleMDM API directly. Benefits:

- **Instant responses** — data is already cached by the app, no API calls needed
- **Free fleet summary** — no pagination overhead
- **Automatic MunkiReport enrichment** — if the app is in hybrid mode, enrichment tools just work
- **No rate limit exposure**

**Setup:**

1. In Report-SimpleMDM, go to **Settings > Developer > Enable Local API** and turn it on
2. Copy the Bearer token shown in that screen
3. Add to your MCP config:

```json
"env": {
  "LOCAL_APP_MODE": "true",
  "LOCAL_APP_TOKEN": "token-from-the-app"
}
```

The app must be running on the same machine. If it quits, the MCP server will return an error until it restarts.

---

## Tools

### Read tools (always available)

| Tool | Description |
|------|-------------|
| `get_fleet_summary` | Total devices, enrolled/unenrolled, posture counts, OS breakdown |
| `list_devices` | Search/filter devices by name, serial, UDID, IMEI, MAC |
| `get_device` | Full device detail — hardware, OS, posture, battery, storage |
| `get_device_profiles` | Installed profiles on a device |
| `get_device_installed_apps` | Installed apps with managed/unmanaged state |
| `get_device_users` | Users associated with a device |
| `get_device_logs` | MDM command logs by serial number |
| `list_assignment_groups` | All assignment groups |
| `get_assignment_group` | Group detail including membership |
| `list_apps` | Full app catalog |
| `get_app` | Single app detail |
| `list_profiles` | All profiles |
| `list_custom_configuration_profiles` | Custom config profiles |
| `list_custom_declarations` | DDM declarations |
| `get_custom_declaration` | Single declaration detail |
| `list_scripts` | Script library |
| `list_script_jobs` | Script jobs, filterable by status |
| `list_enrollments` | Active enrollment configs |
| `list_dep_servers` | Registered DEP servers |
| `get_dep_devices` | DEP devices for a server |

### Write tools (require `SIMPLEMDM_ALLOW_WRITES=true`)

| Tool | SimpleMDM Permission |
|------|---------------------|
| `lock_device` | Devices: write |
| `sync_device` | Devices: write |
| `restart_device` | Devices: write |
| `shutdown_device` | Devices: write |
| `enable_lost_mode` | Devices: write |
| `disable_lost_mode` | Devices: write |
| `update_os` | Devices: write |
| `assign_device_to_group` | Assignment Groups: write |
| `unassign_device_from_group` | Assignment Groups: write |
| `push_apps_to_group` | Assignment Groups: write |
| `create_script_job` | Devices: write |

### MunkiReport enrichment tools (require module config)

| Tool | Description |
|------|-------------|
| `get_munkireport_sync_health` | Sync health telemetry |
| `get_munkireport_compliance` | Fleet compliance stats |
| `get_munkireport_device_resources` | Per-device connected resources |
| `get_munkireport_apple_care` | AppleCare coverage stats |
| `get_munkireport_supplemental_overview` | Supplemental fleet overview |

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

| Variable | Required | Description |
|----------|----------|-------------|
| `SIMPLEMDM_API_KEY` | Yes (direct mode) | SimpleMDM API key |
| `SIMPLEMDM_ALLOW_WRITES` | No | Set `true` to enable write actions. Off by default. |
| `MUNKIREPORT_BASE_URL` | No | MunkiReport site root (enables enrichment tools) |
| `MUNKIREPORT_MODULE_PREFIX` | No | Default: `/module/simplemdm` |
| `MUNKIREPORT_AUTH_HEADER_NAME` | No | Auth header name for MunkiReport |
| `MUNKIREPORT_AUTH_HEADER_VALUE` | No | Auth header value (falls back to API key if name is `X-SIMPLEMDM-API-KEY` and value is blank) |
| `MUNKIREPORT_COOKIE` | No | Session cookie for cookie-authenticated MunkiReport |
| `LOCAL_APP_MODE` | No | Set `true` to use Report-SimpleMDM as the data source |
| `LOCAL_APP_TOKEN` | Required if local mode | Bearer token from Report-SimpleMDM > Settings > Developer |
| `LOCAL_APP_BASE_URL` | No | Default: `http://127.0.0.1:49552` |

---

## Security

**Your API key stays on your machine.** It is stored in `claude_desktop_config.json` and used only by the MCP server process running locally. It is never sent to Anthropic.

**Fleet data goes through Anthropic.** The questions you ask and the tool results Claude receives — including device names, serial numbers, OS versions, and group names — are processed by Anthropic's servers as part of the conversation. Review [Anthropic's privacy policy](https://www.anthropic.com/privacy) for your compliance requirements. Teams and Enterprise plans have additional data privacy agreements.

**The config file is plaintext.** `claude_desktop_config.json` stores the API key in cleartext on disk. Treat it like a password file. Do not use a full-permission API key on a shared machine.

**Writes are off by default.** You must explicitly set `SIMPLEMDM_ALLOW_WRITES=true` to enable any action that modifies fleet state. Using a read-only key with writes disabled means the worst outcome from any unexpected query is a list of devices — not a remote wipe.

**For environments with strict data requirements** — healthcare, government, finance — use Claude for Enterprise with a BAA or DPA in place before connecting fleet data, or consult your compliance team first.

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

**Local app mode: "Could not reach Report-SimpleMDM"**
- Make sure the app is open
- Go to Settings > Developer and confirm Enable Local API is turned on
- Confirm the token in your MCP config matches what the app shows

**MunkiReport tools return "not configured"**
- `MUNKIREPORT_BASE_URL` is not set. Add it to the `env` block in your config.

---

## Related projects

- [Report-SimpleMDM](https://github.com/hov172/Report-SimpleMDM) — Native SwiftUI MDM client for macOS and iOS
- [SimpleMDM-MunkiReport](https://github.com/hov172/SimpleMDM-MunkiReport) — PHP/Python MunkiReport module for MDM device inventory sync

---

## Author

[@hov172](https://github.com/hov172) · [Bluesky](https://bsky.app/profile/ayalasolutions.bsky.social) · [Twitter/X](https://twitter.com/AyalaSolutions) · MacAdmins Slack: `@Hov172`
