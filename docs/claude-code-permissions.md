# Claude Code permissions (`settings.json`)

Permission templates for running the SimpleMDM MCP server under Claude Code.
(Moved here from the README; linked from its [Claude Code permissions section](../README.md#claude-code-permissions-settingsjson).)

This repo ships two permission profiles for [Claude Code](https://docs.claude.com/claude-code):

| File | Scope | When to use |
|---|---|---|
| `.claude/settings.json` | Committed, team-wide | Conservative default — pre-approves read-only tools, safe shell helpers, and routine `docker` operations (`build`/`run`/`exec`/`stop`/`rm`, etc.) for the containerized server, while a `deny` list blocks destructive docker (`system prune`, `volume rm`/`prune`, `network rm`). SimpleMDM writes and destructive git still prompt. |
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

