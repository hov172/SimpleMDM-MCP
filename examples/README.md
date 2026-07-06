# Examples

Sample MCP client configurations and a query cookbook for SimpleMDM-MCP.

## Files

| File | Purpose |
|------|---------|
| [`claude-desktop.json`](claude-desktop.json) | Drop-in `mcpServers` block for Claude Desktop. Read-only by default. |
| [`claude-desktop-with-writes.json`](claude-desktop-with-writes.json) | Same as above, with `SIMPLEMDM_ALLOW_WRITES=true`. Writes still prompt per call via MCP annotations. |
| [`claude-desktop-with-munkireport.json`](claude-desktop-with-munkireport.json) | Adds MunkiReport enrichment so `get_munkireport_*` tools resolve to your MR instance. |
| [`claude-code-add.sh`](claude-code-add.sh) | One-line `claude mcp add` invocation. |
| [`codex.toml`](codex.toml) | Codex CLI MCP server configuration. |
| [`docker-run.sh`](docker-run.sh) | `docker run` with version-tagged build. |
| [`query-cookbook.md`](query-cookbook.md) | 30+ example natural-language queries grouped by intent — copy/paste into Claude. |

## Pattern

All examples assume:

- You have a SimpleMDM API key. Use a **read-only key** unless you need writes.
- Replace `your-api-key-here` and any path placeholders before using.
- The server entry point is `dist/index.js` after `npm run build`. (The package is not yet published to npm, so there is no globally installable `simplemdm-mcp` binary.)

## See also

- [`../README.md`](../README.md) — full installation, env-var reference, and tool catalog
- [`../docs/aggregation-tools-roadmap.md`](../docs/aggregation-tools-roadmap.md) — fleet-analytics tool reference and tier rationale
- [`../CHANGELOG.md`](../CHANGELOG.md) — what shipped in each release

---

# Client setup walkthroughs

(Moved from the main README — the same server process works in any stdio MCP client.)

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

