# Documentation index

| Doc | What it covers |
|-----|----------------|
| [`tools.md`](tools.md) | All 203 tools in per-domain tables, read/write/destructive markers, annotations, the write-safety gate, MCP resources, and prompts |
| [`write-safety.md`](write-safety.md) | Write-safety deep dive — risk tiers, `dry_run`, single-use confirm tokens, the JSONL audit log, env vars, Docker persistence |
| [`workflow-prompts.md`](workflow-prompts.md) | The 14 MCP prompts — the gated 7-step write protocol and all nine playbooks (offboarding, lost device, emergency patching, semester refresh, …) |
| [`recommendations.md`](recommendations.md) | `recommend_fixes` prioritized action list, the fleet-risk/audit/recommendations resources, and the `executive-summary` report |
| [`fleet-audit.md`](fleet-audit.md) | `/audit` deep dive — SOFA join, metrics, flags, outputs, PDF export, XProtect setup, code map |
| [`inventory.md`](inventory.md) | `/inventory` deep dive — query-language grammar, prompt cookbook, report styles, findings, completeness model, run diffs |
| [`logs-audit.md`](logs-audit.md) | `/logs-audit` deep dive — forensic export flags, outputs, fidelity/disclosure model, code map |
| [`findings-middleware.md`](findings-middleware.md) | Opt-in auto-publish of MCP tool results as MunkiReport findings — config, per-tool-category behavior, retry queue, CLI subcommands |
| [`apple-schema-helpers.md`](apple-schema-helpers.md) | The 16 Apple device-management schema tools — search/validate/build payloads, plist emission rules, schema-cache sync |
| [`claude-code-permissions.md`](claude-code-permissions.md) | Copy-paste `settings.json` permission templates for Claude Code (read-only and auto-mode profiles) |
| [`aggregation-tools-roadmap.md`](aggregation-tools-roadmap.md) | Design notes for the derived fleet-analytics tools: heuristics, caching, rejected ideas |

The top-level [README](../README.md) covers what the server does, install/quick start,
client setup, write gating, and the environment-variable reference. Ready-to-use client
configs live in [`examples/`](../examples/).
