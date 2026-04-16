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
- The server binary path is `dist/index.js` after `npm run build`, or `node_modules/.bin/simplemdm-mcp` after `npm install -g simplemdm-mcp` (when published).

## See also

- [`../README.md`](../README.md) — full installation, env-var reference, and tool catalog
- [`../docs/aggregation-tools-roadmap.md`](../docs/aggregation-tools-roadmap.md) — fleet-analytics tool reference and tier rationale
- [`../CHANGELOG.md`](../CHANGELOG.md) — what shipped in each release
