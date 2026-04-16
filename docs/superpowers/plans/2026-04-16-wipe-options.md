# Extended `wipe_device` Options Implementation Plan

> **Status:** Shipped in v0.8.0, corrected in v0.8.1. See the post-ship notes below before editing this plan — two changes diverged from what is written here.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Post-ship notes (v0.8.1)

After the initial ship of v0.8.0 this plan specified, the implementation was cross-checked against SimpleMDM's published API docs. Two corrections:

1. **`wifi_network_id` type is `integer`, not `string`.** Everywhere this plan shows `wifi_network_id: { type: "string", ... }`, `"42"`, or describes it as a string, read "integer ≥ 1". The shipped schema is `{ type: "integer", minimum: 1, ... }` and the tests use the numeric literal `42`.
2. **Two additional parameters were added:** `clear_custom_attributes` and `unassign_direct_profiles` — both optional booleans (server default `false`), already supported by the endpoint but not listed in the original user-supplied feature description. Now exposed in the schema and `buildWipeBody`.

Also, Task 2's `test` script was written as `npm run build && node --test test/` in this plan; the implementer switched to `node --test test/*.mjs` because bare directory discovery fails on Node 25.2.1 (`MODULE_NOT_FOUND`). The glob form is what shipped.

The design spec (`docs/superpowers/specs/2026-04-16-wipe-options-design.md`) carries the amended schema and test samples — use that as the source of truth for field shapes. This plan is preserved as-written for a chronology of the decisions; the v0.8.1 follow-up is a separate ad-hoc commit rather than a revised plan.

---

**Goal:** Extend the `wipe_device` MCP tool with five optional parameters (`preserve_data_plan`, `disable_activation_lock`, `disallow_proximity_setup`, `return_to_service` + `wifi_network_id`, `obliteration_behavior`) to reach parity with the SimpleMDM admin portal's wipe dialog.

**Architecture:** Extract body-building and cross-field validation into a new pure-function module `src/wipe.ts`. Keep dispatch in `src/index.ts` slim. Test the helpers with Node's built-in `node:test` runner — no new dependencies. See spec at `docs/superpowers/specs/2026-04-16-wipe-options-design.md`.

**Tech Stack:** TypeScript (ES2022 / Node16 modules), @modelcontextprotocol/sdk 1.29, Node ≥18 built-in `node:test`.

---

## File Structure

**New files:**
- `src/wipe.ts` — two pure exports: `validateWipeArgs()`, `buildWipeBody()`
- `test/wipe_device.test.mjs` — node:test suite against `dist/wipe.js`

**Modified files:**
- `src/index.ts`
  - Line 1 region: add import from `./wipe.js`
  - Line 844-849: replace `wipe_device` tool schema (add 5 new optional params, update description)
  - Line 2487-2489: replace one-line dispatch with helper-delegated block
- `package.json` — add `"test"` script; bump `version` to `0.8.0`
- `README.md` line 507: annotate `wipe_device` row with new parameter mention
- `CHANGELOG.md`: prepend `[0.8.0]` section

---

## Task 1: Create the pure-function module

**Files:**
- Create: `src/wipe.ts`

- [ ] **Step 1: Write `src/wipe.ts`**

```ts
// src/wipe.ts
// Pure helpers for the wipe_device tool. Kept separate from index.ts so
// tests can import without triggering the MCP server bootstrap in main().

export function validateWipeArgs(args: Record<string, unknown>): void {
  if (args.return_to_service === true && !args.wifi_network_id) {
    throw new Error(
      "return_to_service=true requires wifi_network_id (id of a WiFi profile assigned to the device)."
    );
  }
}

export function buildWipeBody(args: Record<string, unknown>): Record<string, unknown> {
  return {
    pin: args.pin,
    preserve_data_plan: args.preserve_data_plan,
    disable_activation_lock: args.disable_activation_lock,
    disallow_proximity_setup: args.disallow_proximity_setup,
    return_to_service: args.return_to_service,
    wifi_network_id: args.wifi_network_id,
    obliteration_behavior: args.obliteration_behavior,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds; `dist/wipe.js` and `dist/wipe.d.ts` are produced.

- [ ] **Step 3: Commit**

```bash
git add src/wipe.ts
git commit -m "feat(wipe): extract pure helpers for wipe_device args"
```

---

## Task 2: Add the test suite

**Files:**
- Create: `test/wipe_device.test.mjs`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Create the test directory and file**

Run: `mkdir -p test`

Write `test/wipe_device.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWipeBody, validateWipeArgs } from "../dist/wipe.js";

test("buildWipeBody — legacy call, only device_id, serializes to {}", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1" }));
  assert.equal(body, "{}");
});

test("buildWipeBody — legacy call with pin serializes pin only", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1", pin: "123456" }));
  assert.equal(body, '{"pin":"123456"}');
});

test("validateWipeArgs — return_to_service=true without wifi_network_id throws", () => {
  assert.throws(
    () => validateWipeArgs({ return_to_service: true }),
    /wifi_network_id/
  );
});

test("validateWipeArgs — return_to_service=true with wifi_network_id passes", () => {
  assert.doesNotThrow(() =>
    validateWipeArgs({ return_to_service: true, wifi_network_id: "42" })
  );
});

test("validateWipeArgs — return_to_service=false does not require wifi_network_id", () => {
  assert.doesNotThrow(() => validateWipeArgs({ return_to_service: false }));
});

test("validateWipeArgs — return_to_service omitted does not require wifi_network_id", () => {
  assert.doesNotThrow(() => validateWipeArgs({}));
});

test("buildWipeBody — all fields serialize verbatim", () => {
  const body = JSON.parse(JSON.stringify(buildWipeBody({
    device_id: "1",
    pin: "123456",
    preserve_data_plan: true,
    disable_activation_lock: false,
    disallow_proximity_setup: true,
    return_to_service: true,
    wifi_network_id: "42",
    obliteration_behavior: "DoNotObliterate",
  })));
  assert.deepEqual(body, {
    pin: "123456",
    preserve_data_plan: true,
    disable_activation_lock: false,
    disallow_proximity_setup: true,
    return_to_service: true,
    wifi_network_id: "42",
    obliteration_behavior: "DoNotObliterate",
  });
});

test("buildWipeBody — undefined fields are dropped by JSON.stringify", () => {
  const body = JSON.parse(JSON.stringify(buildWipeBody({
    device_id: "1",
    preserve_data_plan: true,
  })));
  assert.deepEqual(body, { preserve_data_plan: true });
});
```

- [ ] **Step 2: Add the `test` script to `package.json`**

Edit `package.json` to add a new `test` script in the `scripts` block. After the change the block should look like:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx src/index.ts",
  "start": "node dist/index.js",
  "clean": "rm -rf dist",
  "test": "npm run build && node --test test/",
  "prepublishOnly": "npm run clean && npm run build"
}
```

- [ ] **Step 3: Run tests — they must pass**

Run: `npm test`

Expected: all 8 tests pass. Sample output:

```
# tests 8
# pass 8
# fail 0
```

- [ ] **Step 4: Commit**

```bash
git add test/wipe_device.test.mjs package.json
git commit -m "test(wipe): add node:test suite for wipe_device helpers"
```

---

## Task 3: Wire new schema into `wipe_device` tool definition

**Files:**
- Modify: `src/index.ts:844-849`

- [ ] **Step 1: Replace the tool definition**

Find the current entry (at `src/index.ts:844`):

```ts
  { name: "wipe_device",
    description: "⚠️ WRITE DESTRUCTIVE — Remote wipe. Erases all data on the device. Irreversible.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      pin: { type: "string", description: "Optional 6-digit PIN to set after wipe (macOS)." },
    }}},
```

Replace with:

```ts
  { name: "wipe_device",
    description: "⚠️ WRITE DESTRUCTIVE — Remote wipe. Erases all data on the device. Irreversible. " +
                 "Supports iOS 17+ Return-to-Service and eSIM/data-plan preservation.",
    inputSchema: { type: "object", required: ["device_id"], properties: {
      device_id: { type: "string" },
      pin: { type: "string", description: "Optional 6-digit PIN to set after wipe (macOS)." },
      preserve_data_plan: { type: "boolean", description: "iOS. Preserve eSIM/cellular data plan during wipe." },
      disable_activation_lock: { type: "boolean", description: "iOS/macOS. Server default: true. Pass false to retain Activation Lock." },
      disallow_proximity_setup: { type: "boolean", description: "iOS. Suppress Proximity Setup on the wiped device." },
      return_to_service: { type: "boolean", description: "iOS 17+/tvOS 18+. Auto re-enrolls after wipe. Requires wifi_network_id." },
      wifi_network_id: { type: "string", description: "SimpleMDM id of a WiFi profile attached to the device's assignment group. Required when return_to_service=true. Not an SSID, UUID, or profile name." },
      obliteration_behavior: { type: "string", enum: ["DoNotObliterate", "ObliterateWithWarning"],
        description: "macOS 12+ (T2/Apple Silicon). Server default: ObliterateWithWarning." },
    }}},
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Do NOT commit yet**

Leave this unstaged; the next task modifies the same file.

---

## Task 4: Wire dispatch through new helpers

**Files:**
- Modify: `src/index.ts` (import block near the top) and `src/index.ts:2487-2489`

- [ ] **Step 1: Add the helper import**

Find the existing import block at the top of `src/index.ts`. The file currently imports from `@modelcontextprotocol/sdk` and `./localAppClient.js`. Add one more import line immediately after the existing `localAppClient` import:

Run `grep -n "localAppClient" src/index.ts | head -1` to confirm the line. Insert directly after it:

```ts
import { validateWipeArgs, buildWipeBody } from "./wipe.js";
```

- [ ] **Step 2: Replace the dispatch**

Find the current dispatch at `src/index.ts:2487`:

```ts
    case "wipe_device":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/wipe`, { method: "POST", body: j({ pin: args.pin }) });
```

Replace with:

```ts
    case "wipe_device": {
      requireWrites();
      validateWipeArgs(args);
      return api(`/devices/${seg(args.device_id, "device_id")}/wipe`, {
        method: "POST",
        body: j(buildWipeBody(args)),
      });
    }
```

- [ ] **Step 3: Build & re-run tests**

Run: `npm test`
Expected: all 8 tests still pass. This proves the new dispatch does not break the helper contract and the build is clean.

- [ ] **Step 4: Smoke-check the tool still loads**

Run: `node -e "import('./dist/index.js').catch(e => { console.error(e.message); process.exit(1); })"`

Wait — `index.ts` calls `main()` which requires `SIMPLEMDM_API_KEY`. Instead run a quick parse check:

Run: `node --check dist/index.js`
Expected: no output (syntax valid).

- [ ] **Step 5: Commit schema + dispatch together**

```bash
git add src/index.ts
git commit -m "feat(wipe): expose preserve_data_plan, return_to_service, and obliteration options"
```

---

## Task 5: Update README parameter mention

**Files:**
- Modify: `README.md:507`

- [ ] **Step 1: Update the tools table row**

Find the line (currently):

```
| `wipe_device` ⚠️ destructive | Devices: write |
```

Replace with:

```
| `wipe_device` ⚠️ destructive | Devices: write — supports `preserve_data_plan`, `disable_activation_lock`, `disallow_proximity_setup`, `return_to_service` (+ `wifi_network_id`), `obliteration_behavior` |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): note new wipe_device parameters in tools table"
```

---

## Task 6: Update CHANGELOG and bump version

**Files:**
- Modify: `CHANGELOG.md` (prepend new entry)
- Modify: `package.json` (`version: "0.7.1"` → `"0.8.0"`)

- [ ] **Step 1: Prepend the CHANGELOG entry**

Insert this block between line 6 (the horizontal description ending) and line 7 (the existing `## [0.7.1]` heading) of `CHANGELOG.md`:

```markdown
## [0.8.0] - 2026-04-16

### Added
- **`wipe_device` parity with the SimpleMDM admin portal wipe dialog.** Five
  new optional parameters:
  - `preserve_data_plan` — preserves eSIM / cellular data plan (iOS).
  - `disable_activation_lock` — controls whether Activation Lock is disabled
    during wipe (iOS/macOS). Server default: `true`.
  - `disallow_proximity_setup` — suppresses Proximity Setup on the wiped
    device (iOS).
  - `return_to_service` + `wifi_network_id` — auto re-enrolls the device
    after wipe (iOS 17+/tvOS 18+). `wifi_network_id` refers to a WiFi profile
    attached to the device's assignment group. Client-side validation rejects
    `return_to_service=true` without `wifi_network_id` before the HTTP call.
  - `obliteration_behavior` — `DoNotObliterate` | `ObliterateWithWarning`
    for macOS 12+ (T2/Apple Silicon). Server default: `ObliterateWithWarning`.
- **`src/wipe.ts`** — pure-function module extracting body-building and
  validation, enabling unit tests via Node's built-in `node:test` runner.
- **`test/wipe_device.test.mjs`** — first unit tests in the repo; run with
  `npm test`.

### Changed
- `package.json`: new `test` script (`npm run build && node --test test/`).

### Backwards compatibility
- Existing `wipe_device` calls (`device_id` ± `pin`) produce identical request
  bodies. All new parameters are optional; when omitted they are not serialized,
  so SimpleMDM applies its documented server-side defaults.

```

- [ ] **Step 2: Bump the version in `package.json`**

Change line 3 of `package.json` from:

```json
  "version": "0.7.1",
```

to:

```json
  "version": "0.8.0",
```

- [ ] **Step 3: Sanity-check the build still passes**

Run: `npm run build && npm test`
Expected: build succeeds; all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "chore(release): v0.8.0 — extended wipe_device options"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full test + build from clean**

Run: `npm run clean && npm test`
Expected: clean build, all 8 tests pass.

- [ ] **Step 2: Review git log**

Run: `git log --oneline HEAD~5..HEAD`

Expected to see exactly five commits in order (oldest at the bottom):
1. `feat(wipe): extract pure helpers for wipe_device args`
2. `test(wipe): add node:test suite for wipe_device helpers`
3. `feat(wipe): expose preserve_data_plan, return_to_service, and obliteration options`
4. `docs(readme): note new wipe_device parameters in tools table`
5. `chore(release): v0.8.0 — extended wipe_device options`

(The two `docs:` commits for the spec itself are upstream of this series.)

- [ ] **Step 3: Confirm manual-staging checklist from spec §6.3 is ready**

Before the user invokes the release, they must run the three manual staging steps from the spec against a sandbox tenant with a throwaway device. List them here for quick reference:

1. Verify the updated tool schema appears correctly in an MCP client's tool list.
2. Happy path: `wipe_device { device_id, return_to_service: true, wifi_network_id: <real id> }` — confirm device re-enrolls.
3. Error path: call with an invalid `wifi_network_id` — confirm SimpleMDM's 422 surfaces verbatim.

This step produces no code; mark complete once the author (not the implementer) has confirmed they'll run these.
