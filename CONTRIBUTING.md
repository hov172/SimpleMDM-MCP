# Contributing

Thanks for your interest in improving SimpleMDM-MCP.

## Getting set up

```bash
git clone https://github.com/hov172/SimpleMDM-MCP
cd SimpleMDM-MCP
nvm use          # reads .nvmrc
npm install
npm run build
```

Node 18 is the minimum supported version. CI runs against 18, 20, and 22;
the published Docker image uses `node:22-alpine`.

Run against your own SimpleMDM account for testing:

```bash
cp .env.example .env
# Edit .env and set SIMPLEMDM_API_KEY
npm run dev      # runs src/index.ts via tsx (no build step)
```

## Making changes

- Keep PRs focused. One logical change per PR makes review easy.
- If you add a new MCP tool, update:
  - the tool definition + `case` handler in `src/index.ts`
  - the Tools table in `README.md` under the right domain heading
  - the tool count in `README.md` (search for "tools covering the full SimpleMDM API surface")
  - a line in `CHANGELOG.md` under `[Unreleased]`
  - if it's a derived/aggregation tool, also add it to `docs/aggregation-tools-roadmap.md` with `[shipped]` and the appropriate tier
- If your tool depends on static knowledge (e.g. a hardcoded table) or could
  return an empty result that the AI might misread as "all clear," add an
  `_agent_hint` string to the response in that condition. Document it in the
  tool's README description and the "Agent hints" table in
  `docs/aggregation-tools-roadmap.md`. See existing examples in
  `get_os_eligibility` and `get_app_install_failures`.
- If you change or remove a tool, note it in `CHANGELOG.md` and call out any
  breaking behavior in the PR description.

## Before you open the PR

```bash
npm run build          # must succeed on Node 18 / 20 / 22
npm test               # runs unit tests via node:test
npm pack --dry-run     # inspect tarball contents if packaging changed
```

CI runs `npm run build` across the Node version matrix on every push and PR.

## Tests

Unit tests live in `test/` and run via Node's built-in `node:test` runner — no
test framework dependency. The `test` script builds first and then runs
`node --test test/*.mjs`, so tests always exercise the compiled `dist/` output.

Current coverage is scoped to pure helpers that can be tested without a live
SimpleMDM tenant (see `test/wipe_device.test.mjs` for the pattern). If you add
a helper that makes sense to test in isolation, prefer extracting it to a
sibling module under `src/` and adding a `*.test.mjs` file. Do **not** add live
API tests here — integration testing against SimpleMDM is manual and requires
a sandbox tenant.

## Commit style

- Subject line under ~70 characters, imperative mood ("Add X", not "Added X").
- Body explains *why*, not *what* — the diff shows *what*.
- Reference issues with `Fixes #NN` if applicable.

## Reporting bugs

Use the issue templates in `.github/ISSUE_TEMPLATE/`. Include your Node
version, install method (npm / Docker / source), and a redacted snippet
of the error. Do **not** paste raw API keys.

Security issues: see [SECURITY.md](SECURITY.md) for the private disclosure path.

## Claude Code permissions

This repo ships two permission profiles:

- **`.claude/settings.json`** (committed, conservative) — pre-approves the
  read-only SimpleMDM MCP tools and a handful of safe shell utilities (`jq`,
  `awk`, `git status`/`diff`/`log`, `npm run`, `docker build`, etc.).
  Contributors using Claude Code don't see a prompt for every
  `list_devices` or `git status` call.
- **`.claude/settings.auto.example.json`** (template, opt-in) — same allow
  set plus `defaultMode: "auto"` and a deny list covering data-loss shell
  (`rm`, `sudo`, `dd`, `mkfs`, `shutdown`), destructive git (`reset --hard`,
  `clean -f*`, `checkout .`, `branch -D`, `tag -d`, `filter-branch`),
  force-push (`push --force*`, `push --delete`), `npm publish/unpublish`,
  `docker system prune`/`volume rm`, `gh pr/issue/release/repo delete`, and
  the SimpleMDM tools that can impact devices (`wipe_device`,
  `unenroll_device`, all `delete_*`, all `clear_*` password tools). Copy to
  `.claude/settings.local.json` (gitignored) or `~/.claude/settings.json`
  to use it.

  Common dev-workflow commands are deliberately **allowed** in the template
  even though they sound scary: `git commit --amend`, `git rebase`,
  `git restore --staged`, `killall`/`pkill`/`kill -9`, `docker rm`/`rmi`,
  `chmod -R`/`chown -R`. None of these lose data on their own, and
  `git push --force*` is still denied so rewritten local history can't
  overwrite the remote.

Deliberately **not** pre-approved anywhere:
- SimpleMDM writes that mutate fleet state (`lock_device`, `create_*`,
  `update_*`, `rotate_*`, etc.) — these prompt per call.
- Hard data-loss git (`reset --hard`, `clean -f*`, `checkout .`,
  `push --force*`).

Personal overrides go in `.claude/settings.local.json` (gitignored). Don't
commit destructive allows to the tracked `.claude/settings.json`.

## Scope

This repo wraps the SimpleMDM REST API as an MCP server. Changes that
extend SimpleMDM coverage or improve MCP client compatibility are welcome.
Changes that add unrelated functionality (other MDMs, unrelated tools,
framework conversions) are likely out of scope — open an issue first to
discuss before investing time.
