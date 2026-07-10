# Security Policy

## Reporting a vulnerability

If you discover a security issue in this project — particularly one that could
leak SimpleMDM API keys, allow unauthorized fleet actions, or bypass the
`SIMPLEMDM_ALLOW_WRITES` gate — please report it privately.

**Preferred channel:** open a
[GitHub Security Advisory](https://github.com/hov172/SimpleMDM-MCP/security/advisories/new)
on this repository. This keeps the report private until a fix is available.

**Alternative:** DM [@hov172](https://github.com/hov172) on the MacAdmins Slack.

Please include:
- A description of the issue and its impact
- Steps to reproduce (or a minimal proof of concept)
- The version / commit SHA you observed it on
- Your environment (Node version, install method — Docker / source)

Please **do not** file a public GitHub issue for security reports.

## What's in scope

- The server process itself — everything under `src/` (including the HTTP/auth layer `src/simplemdm-client.ts` and the report engine `src/reports/`, which writes files and spawns render subprocesses) and the runtime libraries under `scripts/lib/`
- The Docker image build (the package is not yet published to npm)
- Default permission configuration and the write-gate logic
- Input validation and URL path sanitization (`seg()`), request
  timeouts/retries, and upstream error-body truncation

## What's out of scope

- SimpleMDM's own API behavior — report those to SimpleMDM directly.
- Anthropic / OpenAI client-side issues — report to the respective vendors.
- Third-party MCP bridges (mcp-proxy, tunnels) used to expose the server over HTTP.

## Handling your SimpleMDM API key

This MCP server runs locally and uses the API key you configure. The key is
**never sent to Anthropic or OpenAI** — only the tool results (device names,
serials, OS versions, etc.) are relayed through the LLM provider as part of
the conversation.

If you configure the optional MunkiReport integration (`MUNKIREPORT_BASE_URL`),
there is a second outbound channel: the server sends fleet data (device serials,
finding messages, severities) to **your** MunkiReport instance — via the
`push_munkireport_findings` tool, `audit --publish`, or the findings
auto-publish middleware (see
[`docs/findings-middleware.md`](docs/findings-middleware.md)). On the
`ingest_mcp_findings` path **only**, the SimpleMDM API key is transmitted as the
sync-token header (`X-SimpleMDM-API-Key`) to authenticate against the
[SimpleMDM-MunkiReport module](https://github.com/hov172/SimpleMDM-MunkiReport),
which already stores that key. Session-authenticated reads never carry the key.
Point `MUNKIREPORT_BASE_URL` only at a MunkiReport instance you operate and
trust, ideally over HTTPS.

If you suspect a key has been exposed:

1. Rotate it immediately in SimpleMDM → Settings → API Keys.
2. Remove the old key from `claude_desktop_config.json`, `~/.codex/config.toml`,
   any `.env` files, and any MCP client configs that reference it.
3. Audit recent fleet activity in SimpleMDM's audit log.
