# SimpleMDM MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF.svg)](https://modelcontextprotocol.io)

An MCP (Model Context Protocol) server for [SimpleMDM](https://simplemdm.com) that lets you query and manage your fleet using natural language through Claude Desktop, Claude Code, or any MCP-compatible client.

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

---

## Requirements

- **Node.js 18 or later** — check with `node --version`. Install via [Homebrew](https://brew.sh): `brew install node`
- **A SimpleMDM API key** — get one from SimpleMDM > Settings > API Keys
- **Claude Desktop** or **Claude Code** (or any MCP-compatible client)

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

Notes:
- Use `-i` so the MCP server can stay attached to stdio.

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

## Connect to Claude Code (CLI)

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

## Connect to Codex CLI (OpenAI)

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

## Connect to ChatGPT

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

## Use With Other MCP Clients

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

## Tools

The server registers ~115 tools covering the full SimpleMDM API surface. Reads are always available; writes require `SIMPLEMDM_ALLOW_WRITES=true`.

### Read tools (always available)

**Account & fleet**
| Tool | Description |
|------|-------------|
| `get_account` | Account info: name, App Store country, subscription license counts |
| `get_fleet_summary` | Total devices, enrolled/unenrolled, posture counts, OS breakdown |

**Devices**
| Tool | Description |
|------|-------------|
| `list_devices` | Search/filter devices by name, serial, UDID, IMEI, MAC (paginated) |
| `get_device` | Full device detail — hardware, OS, posture, battery, storage |
| `get_device_profiles` | Installed configuration profiles on a device |
| `get_device_installed_apps` | Installed apps with managed/unmanaged state |
| `get_device_users` | User accounts on a device (macOS) |
| `get_device_logs` | MDM command logs for a device by serial |
| `list_device_groups` | Legacy device groups |
| `get_device_group` | Detail for a legacy device group |

**Apps**
| Tool | Description |
|------|-------------|
| `list_apps` | Full app catalog (App Store, enterprise, shared) |
| `get_app` | Single app detail |
| `list_app_installs` | Install records for an app across the fleet |
| `get_installed_app` | Detail for a specific installed-app record |
| `list_managed_app_configs` | Managed app configurations |

**Profiles & declarations**
| Tool | Description |
|------|-------------|
| `list_profiles` | All profiles |
| `get_profile` | Single profile detail |
| `list_custom_configuration_profiles` | Custom `.mobileconfig` profiles |
| `list_custom_declarations` | DDM declarations |
| `get_custom_declaration` | Single DDM declaration detail |

**Assignment groups**
| Tool | Description |
|------|-------------|
| `list_assignment_groups` | All assignment groups |
| `get_assignment_group` | Group detail including apps/devices/profiles |

**Custom attributes**
| Tool | Description |
|------|-------------|
| `list_custom_attributes` | All custom attributes |
| `get_custom_attribute` | Single attribute definition |
| `get_device_attribute_values` | Attribute values set on a device |
| `get_group_attribute_values` | Attribute values set on a group |

**Scripts**
| Tool | Description |
|------|-------------|
| `list_scripts` | Script library |
| `get_script` | Single script detail |
| `list_script_jobs` | Script jobs, filterable by status |
| `get_script_job` | Single script job detail |

**Enrollment & DEP**
| Tool | Description |
|------|-------------|
| `list_enrollments` | Active enrollment configs |
| `get_enrollment` | Single enrollment detail |
| `list_dep_servers` | Registered DEP/ABM servers |
| `get_dep_server` | Single DEP server detail |
| `list_dep_devices` | DEP devices for a server |
| `get_dep_device` | Single DEP device detail |

**Logs & certificates**
| Tool | Description |
|------|-------------|
| `list_logs` | Account-wide audit logs |
| `get_log` | Single log entry |
| `get_push_certificate` | APNs push certificate info |
| `get_signed_csr` | Signed CSR for push certificate renewal |

### Write tools (require `SIMPLEMDM_ALLOW_WRITES=true`)

All tools below modify fleet state. The API permission column tells you what the SimpleMDM API key must be scoped to.

**Device actions**
| Tool | API Permission |
|------|---------------|
| `lock_device` · `unlock` via passcode — send lock MDM cmd | Devices: write |
| `sync_device` | Devices: write |
| `restart_device` | Devices: write |
| `shutdown_device` | Devices: write |
| `wipe_device` ⚠️ destructive | Devices: write |
| `unenroll_device` ⚠️ destructive | Devices: write |
| `update_os` | Devices: write |
| `set_time_zone` | Devices: write |
| `enable_lost_mode` / `disable_lost_mode` | Devices: write |
| `play_lost_mode_sound` / `update_lost_mode_location` | Devices: write |
| `enable_remote_desktop` / `disable_remote_desktop` | Devices: write |
| `enable_bluetooth` / `disable_bluetooth` | Devices: write |
| `clear_passcode` | Devices: write |
| `clear_restrictions_password` | Devices: write |
| `clear_firmware_password` / `rotate_firmware_password` | Devices: write |
| `clear_recovery_lock_password` / `rotate_recovery_lock_password` | Devices: write |
| `rotate_filevault_recovery_key` | Devices: write |
| `rotate_admin_password` / `set_admin_password` | Devices: write |

**Device CRUD**
| Tool | API Permission |
|------|---------------|
| `create_device` | Devices: write |
| `update_device` | Devices: write |
| `delete_device` ⚠️ destructive | Devices: write |
| `delete_device_user` | Devices: write |

**Apps**
| Tool | API Permission |
|------|---------------|
| `create_app` · `update_app` · `delete_app` | Apps: write |
| `uninstall_app` | Apps: write |
| `update_installed_app` | Apps: write |
| `request_app_management` | Apps: write |
| `create_managed_app_config` · `delete_managed_app_config` | Apps: write |
| `push_managed_app_configs` | Apps: write |

**Profiles**
| Tool | API Permission |
|------|---------------|
| `assign_profile_to_device` / `unassign_profile_from_device` | Profiles: write |
| `assign_custom_profile_to_device` / `unassign_custom_profile_from_device` | Profiles: write |
| `create_custom_configuration_profile` · `update_custom_configuration_profile` · `delete_custom_configuration_profile` | Profiles: write |

**Declarations (DDM)**
| Tool | API Permission |
|------|---------------|
| `assign_declaration_to_device` / `unassign_declaration_from_device` | Profiles: write |
| `create_custom_declaration` · `update_custom_declaration` · `delete_custom_declaration` | Profiles: write |

**Assignment groups**
| Tool | API Permission |
|------|---------------|
| `create_assignment_group` · `update_assignment_group` · `delete_assignment_group` | Assignment Groups: write |
| `clone_assignment_group` | Assignment Groups: write |
| `assign_device_to_group` / `unassign_device_from_group` | Assignment Groups: write |
| `assign_app_to_group` / `unassign_app_from_group` | Assignment Groups: write |
| `assign_profile_to_group` / `unassign_profile_from_group` | Assignment Groups: write |
| `update_apps_in_group` · `push_apps_to_group` · `sync_profiles_in_group` | Assignment Groups: write |

**Custom attributes**
| Tool | API Permission |
|------|---------------|
| `create_custom_attribute` · `update_custom_attribute` · `delete_custom_attribute` | Attributes: write |
| `set_device_attribute_value` · `set_group_attribute_value` | Attributes: write |
| `set_attribute_for_multiple_devices` | Attributes: write |

**Scripts**
| Tool | API Permission |
|------|---------------|
| `create_script` · `update_script` · `delete_script` | Scripts: write |
| `create_script_job` · `cancel_script_job` | Scripts: write |

**Enrollment & DEP**
| Tool | API Permission |
|------|---------------|
| `delete_enrollment` | Enrollment: write |
| `send_enrollment_invitation` | Enrollment: write |
| `sync_dep_server` | Enrollment: write |

**Account**
| Tool | API Permission |
|------|---------------|
| `update_account` | Account: write |

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
| `SIMPLEMDM_API_KEY` | Yes | SimpleMDM API key |
| `SIMPLEMDM_ALLOW_WRITES` | No | Set `true` to enable write actions. Off by default. |

---

## Security

**Your API key stays on your machine.** It is stored in `claude_desktop_config.json` and used only by the MCP server process running locally. It is never sent to Anthropic.

**Fleet data goes through Anthropic.** The questions you ask and the tool results Claude receives — including device names, serial numbers, OS versions, and group names — are processed by Anthropic's servers as part of the conversation. Review [Anthropic's privacy policy](https://www.anthropic.com/privacy) for your compliance requirements. Teams and Enterprise plans have additional data privacy agreements.

**The config file is plaintext.** `claude_desktop_config.json` stores the API key in cleartext on disk. Treat it like a password file. Do not use a full-permission API key on a shared machine.

**Writes are off by default.** You must explicitly set `SIMPLEMDM_ALLOW_WRITES=true` to enable any action that modifies fleet state. Using a read-only key with writes disabled means the worst outcome from any unexpected query is a list of devices — not a remote wipe.

**For environments with strict data requirements** — healthcare, government, finance — use Claude for Enterprise with a BAA or DPA in place before connecting fleet data, or consult your compliance team first.

---

## Rate limits and error behavior

SimpleMDM enforces an API rate limit of roughly **60 requests per minute** per account. Tools that fan out across the fleet (bulk `list_devices` pagination, `push_apps_to_group`, `create_script_job` on large groups) can hit this quickly.

How the server behaves on common API responses:

| API response | Server behavior |
|---|---|
| `200 OK` | Returned to Claude as tool output |
| `401 Unauthorized` | Surfaced as an error — API key is invalid or revoked |
| `403 Forbidden` | Surfaced as an error — API key lacks the required permission domain for that tool |
| `404 Not Found` | Returned as an error with the resource identifier |
| `429 Too Many Requests` | Returned as an error; Claude will typically retry with a different approach or wait |
| `5xx` | Surfaced as a server error; retry the question after a short wait |

**Tips for large fleets**
- Prefer `get_fleet_summary` over `list_devices` for posture/KPI questions — it's one call.
- When iterating over devices, let Claude paginate naturally rather than asking for "all 5000 devices at once."
- For writes that touch many devices (e.g. `push_apps_to_group`), SimpleMDM queues server-side — check `list_script_jobs` / app install status a minute later rather than re-triggering.

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

## Author

[@hov172](https://github.com/hov172) · [Bluesky](https://bsky.app/profile/ayalasolutions.bsky.social) · [Twitter/X](https://twitter.com/AyalaSolutions) · MacAdmins Slack: `@Hov172`
