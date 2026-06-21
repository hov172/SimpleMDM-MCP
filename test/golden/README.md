# Golden Report Fixtures

These files capture the deterministic output of the three report engines (audit,
inventory, logs) against the committed test fixtures. They were originally captured from
the legacy `.mjs` engines as the regression oracle for the unified TypeScript engine
migration; the capture harness (`capture.mjs`) and `test/golden-parity.test.mjs` now
exercise the unified engine's domain modules under `dist/reports/domain/`.

## What's here

| Directory  | Key file         | Source module (unified engine)        |
|------------|------------------|---------------------------------------|
| `audit/`   | `full-audit.md`  | `dist/reports/domain/sofa-eval.js` + `audit-render.js` |
| `inventory/`| `report.md`    | `dist/reports/domain/inventory.js` + `inventory-render.js` |
| `logs/`    | `report.md`      | `dist/reports/domain/logs.js`        |

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

## Logs parity test — groupNameMap limitation

The logs report fetches device- and assignment-group names via the SimpleMDM API at
run time and passes the resulting map to `renderDetailedReport`. Because no live API
key is available during offline testing, the capture harness passes `groupNameMap = {}`
instead, which causes group names in the dossier to appear blank.

The parity test (`test/golden-parity.test.mjs`) therefore passes `groupNameMap = {}` on
**both** sides of the comparison (golden capture and the unified engine under test) so the
comparison stays valid — populating the map from fixtures on only one side would make the
strings differ for every device that belongs to a group.
