---
name: version-bump
description: Cut a release of the simplemdm-mcp server — version bump, changelog, build verification, git tag, and GitHub release. Use when asked to release, cut a version, or bump the version.
---

# Version Bump & Release — simplemdm-mcp

Release workflow for **this repo only**. simplemdm-mcp is a stdio MCP server
released via git tags + GitHub Releases. It is **not** published to npm and is
**not** a Claude plugin — ignore any generic version-bump guidance about npm
publishing, plugin manifests, marketplace files, or Discord notifications.

## Preparation

1. **Bump type** — PATCH for bug/security/dependency fixes, MINOR for new
   tools or features, MAJOR for breaking changes to tool schemas or behavior.
2. **Confirm clean start** — `git status` clean, on `main`, synced with
   `origin/main`. Releases are cut from `main`.

## Version files

The version is authored in **`package.json`** (the `"version"` field), but
`package-lock.json` mirrors it in **two** spots (top-level `"version"` and
`packages[""].version`). Bump `package.json`, then sync the lockfile:

```bash
npm install --package-lock-only      # rewrites package-lock.json to the new version
git grep -n '"version": "<OLD>"'     # must return NOTHING after the sync
git grep -n '"version": "X.Y.Z"'     # lists package.json + package-lock.json (x2)
```

Do **not** hand-edit the lockfile or leave it out of sync — an
`npm ci` against a mismatched lockfile fails. There are no plugin manifests or
marketplace files to touch. `src/index.ts` reads the version from
`package.json` at startup, and the Docker build passes it through a `VERSION`
build-arg, so the running server and image label stay in sync automatically.

## Workflow

1. **Bump** `package.json` `"version"` to `X.Y.Z`, then run
   `npm install --package-lock-only` to sync `package-lock.json`. Verify:
   `git grep -n '"version": "X.Y.Z"'` lists package.json + package-lock.json;
   `git grep -n '"version": "<OLD>"'` returns nothing.
2. **CHANGELOG.md** — Keep a Changelog format. Contributors accumulate entries
   under an `[Unreleased]` heading.
   - If an `[Unreleased]` section exists: rename it to `## [X.Y.Z] - YYYY-MM-DD`.
   - If not: add a new `## [X.Y.Z] - YYYY-MM-DD` section above the previous
     version, written from `git log <prev-tag>..HEAD`.
   - Use today's real date. Categories: Added / Changed / Deprecated / Removed
     / Fixed / Security. For a maintenance release with no tool-behavior
     change, say so in a one-line note under the heading.
3. **Verify the build** — `npm run test`. This runs `tsc` then the
   `node --test` suite; it must exit 0 with all tests passing. `dist/` is
   gitignored — never stage build artifacts.
4. **Commit** — `git add package.json package-lock.json CHANGELOG.md` then
   `git commit -m "chore: release X.Y.Z"`.
5. **Tag** — annotated: `git tag -a vX.Y.Z -m "Version X.Y.Z"`.
6. **Push** — `git push origin main && git push origin vX.Y.Z`.
7. **GitHub release** — title format matches existing releases
   (`vX.Y.Z — <short summary>`):
   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z — <short summary>" \
     --notes "<release notes>"
   ```
   Notes mirror the CHANGELOG section; end with a
   `**Full Changelog**: .../compare/v<PREV>...vX.Y.Z` link.
8. **Verify** — all of:
   - `git status` clean
   - `git rev-parse vX.Y.Z^{}` equals `git rev-parse origin/main`
   - `git ls-remote --tags origin vX.Y.Z^{}` matches the same SHA
   - `gh release view vX.Y.Z` shows `isDraft: false` and it is the latest

## Folding a fix into an already-published release

If a follow-up fix must go into a release that is only minutes old and not yet
relied upon (as opposed to cutting a new patch), the tag can be force-moved:

```bash
git tag -fa vX.Y.Z -m "Version X.Y.Z"
git push origin vX.Y.Z --force
gh release edit vX.Y.Z --notes "<updated notes>"
```

Force-moving a published tag is hard to reverse — only do it for a very fresh
release and confirm with the user first.

## Explicitly NOT part of this workflow

- **No `npm publish`** — `simplemdm-mcp` is not on the npm registry, and the
  repo's Claude Code permission profile blocks `npm publish`. Publishing would
  be a separate, deliberate decision.
- **No plugin / marketplace manifests, no `build-and-sync`, no Discord** —
  none exist in this repo.
- **No Docker registry push** — the Docker image is built ad hoc; releasing
  does not push an image.

## Checklist

- [ ] `package.json` version bumped **and** `package-lock.json` synced (`npm install --package-lock-only`); `git grep` for old version is empty
- [ ] `CHANGELOG.md` has the new dated section
- [ ] `npm run test` passes (build + tests)
- [ ] `chore: release X.Y.Z` committed
- [ ] Annotated tag `vX.Y.Z` created and pushed
- [ ] GitHub release created with notes + compare link
- [ ] Tag dereferences to `origin/main` HEAD; release shows as latest
- [ ] `git status` clean
