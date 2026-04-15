# Contributing

Thanks for your interest in improving SimpleMDM-MCP.

## Getting set up

```bash
git clone https://github.com/hov172/SimpleMDM-MCP
cd SimpleMDM-MCP
nvm use          # reads .nvmrc (Node 20)
npm install
npm run build
```

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
  - a line in `CHANGELOG.md` under `[Unreleased]`
- If you change or remove a tool, note it in `CHANGELOG.md` and call out any
  breaking behavior in the PR description.

## Before you open the PR

```bash
npm run build          # must succeed on Node 18 / 20 / 22
npm pack --dry-run     # inspect tarball contents if packaging changed
```

CI runs `npm run build` across the Node version matrix on every push and PR.

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

This repo ships a committed `.claude/settings.json` that pre-approves the
read-only SimpleMDM MCP tools and a handful of safe shell utilities (`jq`,
`awk`, `git status`/`diff`/`log`, `npm run`, `docker build`, etc.). That
means contributors using Claude Code don't see a prompt for every
`list_devices` or `git status` call.

Deliberately **not** pre-approved:
- Write tools: `lock_device`, `wipe_device`, `unenroll_device`, all
  `create_*` / `update_*` / `delete_*` / `clear_*` / `rotate_*`, and
  anything that mutates fleet state. These still prompt per call.
- Destructive git (`git reset --hard`, `git push --force`, `git rebase`).

Personal overrides go in `.claude/settings.local.json` (gitignored). Don't
commit destructive allows to the tracked `.claude/settings.json`.

## Scope

This repo wraps the SimpleMDM REST API as an MCP server. Changes that
extend SimpleMDM coverage or improve MCP client compatibility are welcome.
Changes that add unrelated functionality (other MDMs, unrelated tools,
framework conversions) are likely out of scope — open an issue first to
discuss before investing time.
