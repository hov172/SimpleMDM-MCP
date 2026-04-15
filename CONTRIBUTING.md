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

## Scope

This repo wraps the SimpleMDM REST API as an MCP server. Changes that
extend SimpleMDM coverage or improve MCP client compatibility are welcome.
Changes that add unrelated functionality (other MDMs, unrelated tools,
framework conversions) are likely out of scope — open an issue first to
discuss before investing time.
