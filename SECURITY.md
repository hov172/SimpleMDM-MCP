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
- Your environment (Node version, install method — npm / Docker / source)

Please **do not** file a public GitHub issue for security reports.

## What's in scope

- The server process itself (`src/index.ts`, `src/localAppClient.ts`)
- The published npm package and Docker image build
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

If you suspect a key has been exposed:

1. Rotate it immediately in SimpleMDM → Settings → API Keys.
2. Remove the old key from `claude_desktop_config.json`, `~/.codex/config.toml`,
   any `.env` files, and any MCP client configs that reference it.
3. Audit recent fleet activity in SimpleMDM's audit log.
