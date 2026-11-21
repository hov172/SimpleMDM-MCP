# Examples

Sample MCP client configurations and a query cookbook for SimpleMDM-MCP.

## Files

| File | Purpose |
|------|---------|
| [`claude-desktop.json`](claude-desktop.json) | Drop-in `mcpServers` block for Claude Desktop. Read-only by default. |
| [`claude-desktop-with-writes.json`](claude-desktop-with-writes.json) | Same as above, with `SIMPLEMDM_ALLOW_WRITES=true` and the write-safety knobs (`SIMPLEMDM_CONFIRM_MODE`, `SIMPLEMDM_CONFIRM_TTL_SECONDS`, `MCP_WRITE_AUDIT_DIR`). High/critical writes require a confirm token; every write is audit-logged. Docker users: also mount `audit_log/` (see below) or the audit trail vanishes with the `--rm` container. |
| [`claude-desktop-with-munkireport.json`](claude-desktop-with-munkireport.json) | Adds MunkiReport enrichment so `get_munkireport_*` tools resolve to your MR instance. See the short setup in [README.md](../README.md#munkireport-setup). |
| [`claude-code-add.sh`](claude-code-add.sh) | One-line `claude mcp add` invocation. |
| [`codex.toml`](codex.toml) | Codex CLI MCP server configuration. |
| [`opencode.json`](opencode.json) | OpenCode config: Ollama local-model provider + SimpleMDM MCP server (Docker). |
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
### OpenCode + Ollama (local models)

[OpenCode](https://opencode.ai) is an open-source terminal coding agent that supports stdio MCP servers and any OpenAI-compatible provider, so it can drive this server with a **local Ollama model** — no cloud API key for the LLM side at all. Drop-in config: [`opencode.json`](opencode.json).

**1. Install and pull a tool-calling model.**

```bash
brew install ollama opencode        # or: curl -fsSL https://opencode.ai/install | bash
ollama pull qwen3:32b               # alternatives: llama3.3:70b, devstral
```

Pick a model that genuinely supports tool calling. Small or older models ignore tools or invent arguments — that is a model limit, not a server one.

> **Verified working (2026-11-21, 16 GB M2):** qwen3:14b + `codemode: false` + `SIMPLEMDM_TOOL_ALLOWLIST` + the `mdm` agent in [`opencode.json`](opencode.json) called `simplemdm_get_fleet_summary` and answered in ~3.5 minutes per turn. Three things were required, in order of importance:
>
> 1. **`"codemode": false` on the MCP server entry.** OpenCode v2 hides MCP tools behind an `execute` code tool by default; a local model never sees `simplemdm_*` and silently returns an empty "stop" message. This is the root cause of "tool calls ignored" with Ollama.
> 2. **A custom agent with a short `prompt` and OpenCode's built-in tools switched off** (the `tools: {bash: false, …}` map in the example). The built-in tool schemas, not the system prompt, are most of OpenCode's ~23k-token baseline; with them off a turn is ~3k tokens, cutting prompt-read time from minutes to seconds. Verified both ways: the same run took 23,366 input tokens without the map and 2,932 with it.
> 3. **Provider timeouts** (`headerTimeout`/`timeout` = 1500000) so a slow first turn is not cut off at OpenCode's 5-minute default.
>
> Model notes: qwen3:14b works (its thinking phase is what makes the turn ~2 min). qwen2.5:7b was faster (25 s/turn) but wrote the tool call as text instead of a structured call, so it never executed. qwen3:4b never completed a call. Set `small_model` to a tiny model so title generation does not compete for the GPU.
>
> **Earlier measurement, before `codemode: false` was found (2026-11-20):** the full catalog is ~24k tokens of tool schema per turn. qwen3:4b and qwen3:14b both failed to complete a single tool call — the 14B model ingests prompts at ~65 tok/s, so it needs ~6 minutes just to *read* the tool list, longer than OpenCode's 5-minute provider timeout. 32B/70B models are slower still on this class of hardware. **On a laptop, set `SIMPLEMDM_TOOL_ALLOWLIST`** (step 3) to expose a handful of tools; that removes the server's share of the prompt. It is not sufficient on its own: with 3 tools exposed, OpenCode's own system prompt and built-in tools still measured ~23k tokens, and qwen3:14b still took 10+ minutes per turn on the same M2. Treat local Ollama under OpenCode as viable only on much faster hardware (M-series Max/Ultra) or with a hosted model; the allowlist is what keeps this server from making it worse.

**2. Raise Ollama's context window.** This server exposes 300+ tools, and their schemas cost roughly 30–40k tokens before you type anything. Ollama's default context (4k–8k) silently truncates the tool list, and [Ollama's OpenCode guide](https://docs.ollama.com/integrations/opencode) states OpenCode needs **64k or higher**:

```bash
OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_KEEP_ALIVE=-1 ollama serve   # 32k fits the ~3k-token mdm-agent turn; keep-alive pins the model so later turns reuse the cached prefix
```

Or bake it into a model variant:

```bash
printf 'FROM qwen3:32b
PARAMETER num_ctx 65536
' > Modelfile
ollama create qwen3-mdm -f Modelfile      # then reference "qwen3-mdm" in opencode.json
```

**3. Build the server image** (once per release) **and trim the tool list**:

```bash
cd /absolute/path/to/SimpleMDM-MCP
cp .env.example .env    # set SIMPLEMDM_API_KEY (read-only key recommended)
docker build -t simplemdm-mcp .
```

Add an allowlist to `.env` so a local model only sees the tools it needs (names or `*` globs, comma-separated):

```bash
SIMPLEMDM_TOOL_ALLOWLIST=check_for_update,get_fleet_summary,get_security_posture,get_stale_devices,list_devices,get_device
```

Hidden tools are absent from `tools/list` and refused by `tools/call`. Widen the list as the model proves it can handle more; leave the variable unset for hosted models (Claude, GPT) that take the full catalog without trouble. If a local model still times out, raise OpenCode's provider timeouts (`provider.ollama.options.headerTimeout` / `timeout`, milliseconds) — the default 5-minute header timeout is shorter than a 14B model's prompt-ingestion time on a laptop.

**4. Configure OpenCode.** Copy [`opencode.json`](opencode.json) to `~/.config/opencode/opencode.json` (global) or `./opencode.json` in a project directory, and replace `/absolute/path/to/SimpleMDM-MCP`. The file registers Ollama as an `@ai-sdk/openai-compatible` provider at `http://localhost:11434/v1` and the SimpleMDM server under `mcp.servers` as a `local` (stdio) MCP server launched through `docker run --rm -i`. Servers connect automatically; add `"disabled": true` to keep one configured but off (there is no `enabled` field). Shortcut: `ollama launch opencode --config` writes the Ollama provider block for you, after which you only add the `mcp` section.

Without Docker, swap the `command` array for the built entry point. The field is `environment` (not `env`), and `{env:NAME}` reads from your shell — `$NAME` is not expanded:

```json
"command": ["node", "/absolute/path/to/SimpleMDM-MCP/dist/index.js"],
"environment": { "SIMPLEMDM_API_KEY": "{env:SIMPLEMDM_API_KEY}" }
```

**5. Run it.**

```bash
opencode
```

Use `/models` to confirm the Ollama model is selected, then ask: *"Give me a fleet summary."* The SimpleMDM tools appear in OpenCode's tool list; `check_for_update` is a cheap first call to prove the server is up.

**Notes**

- The write-safety gate (plan → dry-run → confirm token) is ordinary tool calls, so it works identically under a local model. Keep `SIMPLEMDM_ALLOW_WRITES` unset unless you need writes.
- Expect slower turns than a hosted model: a 32B model on Apple silicon takes several seconds per tool decision, and multi-step audits chain many calls.
- Report files (`run_fleet_audit`, `run_inventory_report`) land in the mounted `reports/` directory on the host.

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
docker run --rm -i --env-file /absolute/path/to/SimpleMDM-MCP/.env \
  -v /absolute/path/to/SimpleMDM-MCP/reports:/app/reports \
  -v /absolute/path/to/SimpleMDM-MCP/audit_log:/app/audit_log simplemdm-mcp
```
(The mounts keep report output and the write-safety audit trail on disk after the
`--rm` container exits; both are optional for read-only use.)

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
