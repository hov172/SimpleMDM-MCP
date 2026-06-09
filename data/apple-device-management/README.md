# Apple Device Management Schema Cache

This directory contains the normalized JSON cache used at runtime for Apple's
public `apple/device-management` schema repository:

https://github.com/apple/device-management

Refresh it with:

```sh
node scripts/sync-apple-device-schemas.mjs --ref release --out data/apple-device-management/schema-cache.json
```

Check the upstream sync without writing:

```sh
node scripts/sync-apple-device-schemas.mjs --ref release --dry-run
```

For deterministic local regeneration without network access:

```sh
node scripts/sync-apple-device-schemas.mjs --offline --dry-run
```

The sync script enumerates schema YAML files under the Apple repository's
supported profile and declarative declaration paths, parses them with `yaml`,
normalizes them into the shape used by `src/appleSchemas.ts`, and writes stable
sorted JSON. Fetching is intentionally conservative: the script validates refs
and paths, allows only Apple GitHub API/raw hosts, disables redirects, applies
request timeouts, and caps per-file and total response sizes.

The generated cache currently covers profiles from `mdm/profiles/` and
declarations from `declarative/declarations/`. Recursive YAML anchors, such as
Safari bookmark folders, are normalized with cycle/depth protection so they can
be represented safely in JSON.

If the runtime cache is missing or incomplete, `src/appleSchemas.ts` merges in
curated fallback data for high-value schemas such as Wi-Fi, Restrictions, SCEP,
certificates, VPN, web clips, content filter, FileVault escrow, firewall,
passcode, Safari bookmarks, and software update settings. Use `--no-fallback`
in CI if cache refreshes should fail closed.

## Runtime Behavior

`src/appleSchemas.ts` reads `data/apple-device-management/schema-cache.json` at
server startup and then serves schema search/detail/validation from memory. The
MCP server does not fetch Apple schemas during tool calls. If the cache cannot
be read, the curated fallback seed is used so core builders remain available.

## Test Coverage

- `test/syncAppleSchemas.test.mjs` runs the sync script against real fixture YAML
  for nested dictionaries, arrays, enums, required keys, platform metadata,
  deprecations, and defaults.
- `test/appleSchemas.test.mjs` covers runtime cache fallback, payload builders,
  nested validation, and semantic validation.
- `test/mcpSmoke.test.mjs` starts the compiled MCP server over stdio and verifies
  `initialize` plus `tools/list`.
