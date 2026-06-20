# Golden Report Fixtures

These files capture the deterministic output of the three legacy report engines
(`sofa-audit`, `inventory-report`, `logs-audit`) against the committed test fixtures.
They serve as the regression oracle for the unified TypeScript engine migration.

## What's here

| Directory  | Key file         | Source engine            |
|------------|------------------|--------------------------|
| `audit/`   | `full-audit.md`  | `scripts/sofa-audit.mjs` |
| `inventory/`| `report.md`    | `scripts/inventory-report.mjs` |
| `logs/`    | `report.md`      | `scripts/logs-audit.mjs` |

Each directory also contains:
- Text CSV artifacts (`*.csv`) — compared byte-for-byte
- `_binary-manifest.json` — records `{name, bytes}` for any binary outputs
  (`.pdf`, `.docx`) that are environment-dependent and not committed

## How to re-capture

Run the harness manually after changing engine output format:

```bash
node test/golden/capture.mjs
git add test/golden
git commit -m "test: refresh golden fixtures after <reason>"
```

The harness uses **committed fixtures only** (no live API calls) and pins all
timestamps to `2026-01-01T00:00:00Z` so output is byte-stable across runs.

## Determinism

- `dateStr` is pinned to `"2026-01-01"` in all report headers.
- `now` (for stale-device / date-relative findings) is pinned to `Date.parse("2026-01-01T00:00:00Z")`.
- `manifest.csv` in the logs report pins `generated_at` to `"2026-01-01T00:00:00Z"`.
- SHA-256 values in `logs/manifest.csv` are computed from the pinned file content
  and will remain stable as long as the engine output is unchanged.
