# SimpleMDM API Modernization Implementation Plan

> ⚠️ **ADDENDUM (2026-06-06, post-implementation reality check):** This plan was
> built from a product spec (`SimpleMDM_Master_API_Modernization_Specification.docx`)
> that turned out to be **partly aspirational**. After implementation, the tools were
> reconciled against the **live SimpleMDM API reference**, which revealed:
> - **`send_message`** — no such public REST endpoint exists (web-console + mobile-app
>   feature only). Tasks 5 & 6 (`send_device_message`, `send_bulk_device_message`) were
>   **removed**.
> - **`disable_activation_lock`** — no standalone endpoint; it exists only as a `wipe`
>   parameter. Tasks 3 & 4's standalone/bulk tools were **removed** (kept
>   `get_activation_lock_status`, which reads a real device attribute).
> - **`refresh_cellular_plans`** — real, but **requires `esim_server_url`** (was missing).
>   Fixed.
> - **Safari Bookmarks (Task 8)** — no API endpoint; achievable only via a Configuration
>   Profile. Correctly not implemented as a dedicated tool.
>
> Net result actually shipped: `preserve_managed_apps` (wipe param), `refresh_cellular_plans`
> (with `esim_server_url`), `get_activation_lock_status`, and `get_api_coverage`. See the
> "fix/api-reality-alignment" branch and CHANGELOG `[Unreleased]`. **Always verify a spec
> against the live API before building.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the SimpleMDM API additions through API v1.55 (advanced wipe, send message, disable activation lock, refresh cellular plans, plus API coverage tracking) as new MCP tools in `simplemdm-mcp`.

**Architecture:** Each device action follows the existing repeating pattern in `src/index.ts`: a tool object in the `TOOLS` array (schema + description), a `case` in the `handleTool()` switch that calls `api()`, registration in the `WRITE_TOOLS` set, and a cache-invalidation entry in `INVALIDATION_MAP`. Pure, testable logic (body builders, validators, the bulk runner) is isolated in standalone files (`src/wipe.ts` precedent) so `node --test` can import it from `dist/` without booting the MCP server.

**Tech Stack:** TypeScript 6 (compiled with `tsc` to `dist/`), Node ≥18 ESM, `@modelcontextprotocol/sdk`, `node:test` for tests.

---

## Scope Note — read before starting

The two source documents (`SimpleMDM_Master_API_Modernization_Specification.docx` and `SimpleMDM_API_Update_Reference_Updated.docx`) describe **two products at once**: this MCP server **and** a separate Swift app called *Report-SimpleMDM*. Everything below covers only the MCP server. The following items from the spec are **out of scope for this repo** because they are UI features of Report-SimpleMDM, not API surface:

- Recovery Center / Communication Center / Cellular Dashboard / API Explorer / Compliance reporting UIs
- Safari Bookmark "preview rendering", "nested folders", "advanced editor", "assignment analytics"
- Custom Profile "advanced editor", "clone/export", "assignment analytics", "payload validation UI"

What the MCP *can* legitimately do for Safari Bookmarks and Custom Profiles is covered in **Phase 3** (a thin helper over the existing `/custom_configuration_profiles` endpoint), and it is flagged as needing live-API confirmation.

### Gap analysis (spec vs. current code)

| Spec item | Endpoint | Status in repo today | This plan |
|---|---|---|---|
| Advanced Wipe | `POST /devices/{id}/wipe` | `wipe_device` already supports 7 of 8 advanced params | **Task 1:** add the 1 missing param `preserve_managed_apps` |
| Refresh Cellular Plans | `POST /devices/{id}/refresh_cellular_plans` | absent | **Task 2:** new tool `refresh_cellular_plans` |
| Disable Activation Lock | `POST /devices/{id}/disable_activation_lock` | absent | **Task 3:** `disable_activation_lock`, `get_activation_lock_status` |
| Disable Activation Lock (bulk) | iterate per-device | absent | **Task 4:** `disable_activation_lock_bulk` + `runBulk` helper |
| Send Message | `POST /devices/{id}/send_message` | absent | **Task 5:** `send_device_message` |
| Send Message (bulk) | iterate per-device | absent | **Task 6:** `send_bulk_device_message` |
| API discovery / coverage tracking | n/a (introspection) | absent | **Task 7:** read-only `get_api_coverage` |
| Safari Bookmarks profile | `POST /custom_configuration_profiles` | generic create exists | **Task 8 (flagged):** `create_safari_bookmarks_profile` helper |

**Note:** the spec names a tool `wipe_device_advanced`. The existing `wipe_device` tool **is** the advanced wipe (it already accepts `return_to_service`, `wifi_network_id`, `obliteration_behavior`, etc.). Do **not** create a duplicate tool — extend `wipe_device`. Task 9 documents this naming decision.

---

## File Structure

- `src/wipe.ts` — **modify.** Add `preserve_managed_apps` to `buildWipeBody`.
- `src/deviceActions.ts` — **create.** Pure helpers for the new actions: `validateSendMessageArgs`, `buildSendMessageBody`, and the generic `runBulk` iterator. Mirrors the `wipe.ts` "pure logic, no server bootstrap" precedent so it is unit-testable.
- `src/index.ts` — **modify.** Add tool definitions, `handleTool` cases, `WRITE_TOOLS` / `DESTRUCTIVE` / `INVALIDATION_MAP` entries, and import `deviceActions.ts`.
- `test/deviceActions.test.mjs` — **create.** Unit tests for the pure helpers.
- `test/wipe_device.test.mjs` — **modify.** Add a `preserve_managed_apps` assertion.
- `README.md`, `CHANGELOG.md` — **modify.** Document the new tools (Task 9).

### Where things live in `src/index.ts` (line numbers approximate — search for the anchor string)

- `INVALIDATION_MAP` — search `const INVALIDATION_MAP` (~line 385). Add write-tool → cache-prefix entries here.
- `TOOLS` array — search `const TOOLS: Tool[] = [` (~line 563). Tool definition objects.
- "DEVICES — actions" comment block — search `// DEVICES — actions` (~line 837). Add device-action tool defs after `wipe_device`.
- `handleTool` switch — search `async function handleTool` (~line 1481); device-action cases are around the `case "wipe_device"` block (~line 2502).
- `WRITE_TOOLS` set — search `const WRITE_TOOLS = new Set` (~line 2816).
- `DESTRUCTIVE` set — search `const DESTRUCTIVE = new Set` (~line 2848).

---

## Task 1: Add `preserve_managed_apps` to advanced wipe

The spec's advanced-wipe parameter list is `preserve_data_plan, disable_activation_lock, disallow_proximity_setup, return_to_service, wifi_network_id, obliteration_behavior, unassign_direct_profiles, preserve_managed_apps`. Seven are already wired through `buildWipeBody`. Only `preserve_managed_apps` is missing.

**Files:**
- Modify: `src/wipe.ts:13-25` (`buildWipeBody`)
- Modify: `src/index.ts` `wipe_device` schema (search `name: "wipe_device"`, ~line 848)
- Test: `test/wipe_device.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `test/wipe_device.test.mjs`:

```js
test("buildWipeBody — preserve_managed_apps serializes through", () => {
  const body = JSON.parse(JSON.stringify(buildWipeBody({
    device_id: "1",
    preserve_managed_apps: true,
  })));
  assert.equal(body.preserve_managed_apps, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/wipe_device.test.mjs`
Expected: FAIL — `preserve_managed_apps` is `undefined` (assert.equal expected `true`).

- [ ] **Step 3: Add the field to `buildWipeBody`**

In `src/wipe.ts`, add one line inside the returned object (after `unassign_direct_profiles`):

```ts
export function buildWipeBody(args: Record<string, unknown>): Record<string, unknown> {
  return {
    pin: args.pin,
    preserve_data_plan: args.preserve_data_plan,
    disable_activation_lock: args.disable_activation_lock,
    disallow_proximity_setup: args.disallow_proximity_setup,
    return_to_service: args.return_to_service,
    wifi_network_id: args.wifi_network_id,
    obliteration_behavior: args.obliteration_behavior,
    clear_custom_attributes: args.clear_custom_attributes,
    unassign_direct_profiles: args.unassign_direct_profiles,
    preserve_managed_apps: args.preserve_managed_apps,
  };
}
```

- [ ] **Step 4: Add the param to the `wipe_device` input schema**

In `src/index.ts`, inside the `wipe_device` tool's `inputSchema.properties`, after the `unassign_direct_profiles` line, add:

```ts
      preserve_managed_apps: { type: "boolean", description: "iOS 17+. Keep managed apps and their data installed through the wipe (Return-to-Service style). Defaults to false." },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test test/wipe_device.test.mjs`
Expected: PASS — all wipe tests green including the new one.

- [ ] **Step 6: Commit**

```bash
git add src/wipe.ts src/index.ts test/wipe_device.test.mjs
git commit -m "feat: add preserve_managed_apps to advanced wipe"
```

---

## Task 2: `refresh_cellular_plans` tool

Simplest new action — no body, establishes the new-tool pattern that Tasks 3–6 reuse.

**Files:**
- Modify: `src/index.ts` — `TOOLS`, `handleTool`, `WRITE_TOOLS`, `INVALIDATION_MAP`

- [ ] **Step 1: Add the tool definition**

In `src/index.ts`, in the "DEVICES — actions" block (after the `restart_device`/`shutdown_device` group, before `unenroll_device` is fine), add:

```ts
  { name: "refresh_cellular_plans",
    description: "WRITE — Refresh the device's cellular plans (eSIM). Prompts the device to re-query carrier provisioning. iOS/iPadOS with cellular.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},
```

- [ ] **Step 2: Add the handler case**

In `handleTool`, next to the other device-action cases (after `case "restart_device":`), add:

```ts
    case "refresh_cellular_plans":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/refresh_cellular_plans`, { method: "POST" });
```

- [ ] **Step 3: Register as a write tool + cache invalidation**

In the `WRITE_TOOLS` set, add `"refresh_cellular_plans"` to the device-actions line.
In `INVALIDATION_MAP`, add:

```ts
  refresh_cellular_plans:              ["/devices"],
```

- [ ] **Step 4: Write the registration test**

Create `test/deviceActions.test.mjs` (will be extended in later tasks). For now it asserts the new tool is registered with the right shape. Because `index.ts` boots the server on import, we test the **schema** indirectly via a tiny structural check on the compiled tool list is not possible without import side-effects — instead assert registration through the smoke harness:

Run: `node --test` is not used for this; instead verify via the existing smoke script:

```bash
npm run build
SIMPLEMDM_API_KEY=dummy node .smoke.mjs 2>&1 | grep -c "refresh_cellular_plans"
```

Expected: `1` (tool present in the registered list). If `.smoke.mjs` does not grep tool names, fall back to:

```bash
npm run build && node -e "import('./dist/index.js')" 2>&1 | head -1
```

Expected: no crash (clean module load). The authoritative check is Step 5.

- [ ] **Step 5: Build and smoke-test the server**

Run: `npm run build && npm test`
Expected: build succeeds, existing tests still pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/deviceActions.test.mjs
git commit -m "feat: add refresh_cellular_plans device action"
```

---

## Task 3: `disable_activation_lock` + `get_activation_lock_status`

`disable_activation_lock` is a destructive-ish recovery action (it removes the Find My / Activation Lock binding). `get_activation_lock_status` is read-only and derives from the device record's existing `is_activation_lock_enabled` attribute (already surfaced at `posture.activation_lock`, ~line 1576).

**Files:**
- Modify: `src/index.ts` — `TOOLS`, `handleTool`, `WRITE_TOOLS`, `INVALIDATION_MAP`

- [ ] **Step 1: Add both tool definitions**

In the "DEVICES — actions" block, add:

```ts
  { name: "disable_activation_lock",
    description: "WRITE — Clear Activation Lock on a supervised/DEP device so it can be re-set-up after wipe or reassignment. Recovery action.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},

  { name: "get_activation_lock_status",
    description: "Read — Whether Activation Lock is currently enabled on a device. Reads is_activation_lock_enabled from the device record.",
    inputSchema: { type: "object", required: ["device_id"], properties: { device_id: { type: "string" } }}},
```

- [ ] **Step 2: Add the handler cases**

In `handleTool`, add (write case near the other actions, read case near `case "get_device":`):

```ts
    case "disable_activation_lock":
      requireWrites();
      return api(`/devices/${seg(args.device_id, "device_id")}/disable_activation_lock`, { method: "POST" });
```

```ts
    case "get_activation_lock_status": {
      const id = seg(args.device_id, "device_id");
      const dev = await api(`/devices/${id}`) as { data?: { attributes?: Record<string, unknown> } };
      const attrs = dev.data?.attributes ?? {};
      return {
        device_id: id,
        activation_lock_enabled: attrs.is_activation_lock_enabled ?? null,
        is_supervised: attrs.is_supervised ?? null,
        dep_enrolled: attrs.dep_enrolled ?? null,
      };
    }
```

- [ ] **Step 3: Register `disable_activation_lock` as write + invalidation**

In `WRITE_TOOLS`, add `"disable_activation_lock"`. (Do **not** add `get_activation_lock_status` — it is read-only.)
In `INVALIDATION_MAP`, add:

```ts
  disable_activation_lock:             ["/devices"],
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: build succeeds, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add disable_activation_lock and get_activation_lock_status"
```

---

## Task 4: `disable_activation_lock_bulk` + shared `runBulk` helper

There is no native bulk endpoint, so we iterate explicit `device_ids` with bounded concurrency. The iterator is a pure, generic helper in `src/deviceActions.ts` so it is unit-testable (mirrors the `wipe.ts` precedent). Bulk takes an **explicit** `device_ids` array — never an implicit fleet-wide blast — for safety.

**Files:**
- Create: `src/deviceActions.ts`
- Modify: `src/index.ts` — import, `TOOLS`, `handleTool`, `WRITE_TOOLS`
- Test: `test/deviceActions.test.mjs`

- [ ] **Step 1: Write the failing test for `runBulk`**

Create/extend `test/deviceActions.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBulk } from "../dist/deviceActions.js";

test("runBulk — all succeed", async () => {
  const out = await runBulk(["1", "2", "3"], 2, async (id) => id);
  assert.equal(out.succeeded, 3);
  assert.equal(out.failed, 0);
  assert.equal(out.results.length, 3);
  assert.ok(out.results.every(r => r.ok));
});

test("runBulk — one fails, others still run", async () => {
  const out = await runBulk(["1", "2", "3"], 2, async (id) => {
    if (id === "2") throw new Error("boom");
    return id;
  });
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 1);
  const bad = out.results.find(r => r.device_id === "2");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /boom/);
});

test("runBulk — empty list is a no-op", async () => {
  const out = await runBulk([], 4, async () => { throw new Error("should not run"); });
  assert.deepEqual(out, { results: [], succeeded: 0, failed: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: FAIL — `Cannot find module '../dist/deviceActions.js'`.

- [ ] **Step 3: Create `src/deviceActions.ts`**

```ts
// src/deviceActions.ts
// Pure helpers for the new device-action tools (send message, bulk actions).
// Kept separate from index.ts so tests can import without booting the MCP
// server — same pattern as wipe.ts.

export interface BulkResult {
  results: Array<{ device_id: string; ok: boolean; error?: string }>;
  succeeded: number;
  failed: number;
}

// Run `fn` against each device id with bounded concurrency. Per-device errors
// are captured (not thrown) so one bad device does not abort the batch.
export async function runBulk(
  ids: string[],
  concurrency: number,
  fn: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
  const queue = [...ids];
  const results: BulkResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await fn(id);
        results.push({ device_id: id, ok: true });
        succeeded++;
      } catch (e) {
        results.push({ device_id: id, ok: false, error: e instanceof Error ? e.message : String(e) });
        failed++;
      }
    }
  };
  const conc = Math.max(1, Math.min(16, concurrency));
  await Promise.all(Array.from({ length: conc }, worker));
  return { results, succeeded, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: PASS — all three `runBulk` tests green.

- [ ] **Step 5: Import the helper in `index.ts`**

Near the top of `src/index.ts`, beside the existing wipe import (`import { validateWipeArgs, buildWipeBody } from "./wipe.js";`), add:

```ts
import { runBulk } from "./deviceActions.js";
```

- [ ] **Step 6: Add the bulk tool definition**

In the "DEVICES — actions" block:

```ts
  { name: "disable_activation_lock_bulk",
    description: "WRITE — Clear Activation Lock on many devices at once. Pass an explicit list of device_ids. Returns a per-device success/failure report.",
    inputSchema: { type: "object", required: ["device_ids"], properties: {
      device_ids: { type: "array", description: "Array of device id strings to clear Activation Lock on." },
      concurrency: { type: "integer", minimum: 1, maximum: 16, description: "Parallel requests. Default 5." },
    }}},
```

- [ ] **Step 7: Add the handler case**

```ts
    case "disable_activation_lock_bulk": {
      requireWrites();
      const ids = (args.device_ids as unknown[]).map(x => seg(x, "device_ids[]"));
      const conc = typeof args.concurrency === "number" ? args.concurrency : 5;
      return runBulk(ids, conc, (id) =>
        api(`/devices/${id}/disable_activation_lock`, { method: "POST" }));
    }
```

- [ ] **Step 8: Register as write + invalidation**

In `WRITE_TOOLS`, add `"disable_activation_lock_bulk"`.
In `INVALIDATION_MAP`, add:

```ts
  disable_activation_lock_bulk:        ["/devices"],
```

- [ ] **Step 9: Build and full test**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/deviceActions.ts src/index.ts test/deviceActions.test.mjs
git commit -m "feat: add disable_activation_lock_bulk with runBulk helper"
```

---

## Task 5: `send_device_message`

> ⚠️ **API-shape verification required.** The source spec gives the endpoint (`POST /api/v1/devices/{id}/send_message`) but **not the request body field names**. Before/while implementing, confirm the body schema against the live SimpleMDM API docs (https://api.simplemdm.com/) — the implementation below uses `message` as the field name and a optional `title`. If the real field is e.g. `body`/`text`, update `buildSendMessageBody` and its test together. This is a known unknown, called out deliberately, not a placeholder.

**Files:**
- Modify: `src/deviceActions.ts` — add `validateSendMessageArgs`, `buildSendMessageBody`
- Modify: `src/index.ts` — `TOOLS`, `handleTool`, `WRITE_TOOLS`, `INVALIDATION_MAP`
- Test: `test/deviceActions.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `test/deviceActions.test.mjs`:

```js
import { buildSendMessageBody, validateSendMessageArgs } from "../dist/deviceActions.js";

test("buildSendMessageBody — message only", () => {
  const body = buildSendMessageBody({ message: "Please restart" });
  assert.deepEqual(body, { message: "Please restart" });
});

test("buildSendMessageBody — message + title", () => {
  const body = buildSendMessageBody({ message: "Hi", title: "IT Notice" });
  assert.deepEqual(body, { message: "Hi", title: "IT Notice" });
});

test("validateSendMessageArgs — empty message throws", () => {
  assert.throws(() => validateSendMessageArgs({ message: "" }), /message/);
});

test("validateSendMessageArgs — non-empty message passes", () => {
  assert.doesNotThrow(() => validateSendMessageArgs({ message: "ok" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: FAIL — `buildSendMessageBody`/`validateSendMessageArgs` not exported.

- [ ] **Step 3: Add the helpers to `src/deviceActions.ts`**

```ts
export function validateSendMessageArgs(args: Record<string, unknown>): void {
  const msg = args.message;
  if (typeof msg !== "string" || msg.trim() === "") {
    throw new Error("send message requires a non-empty message.");
  }
}

// NOTE: field names ("message", "title") are best-effort from the spec; confirm
// against live SimpleMDM API docs and update this body + its tests together.
export function buildSendMessageBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { message: args.message };
  if (typeof args.title === "string" && args.title !== "") body.title = args.title;
  return body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Import the new helpers in `index.ts`**

Update the import added in Task 4:

```ts
import { runBulk, validateSendMessageArgs, buildSendMessageBody } from "./deviceActions.js";
```

- [ ] **Step 6: Add the tool definition**

In the "DEVICES — actions" block:

```ts
  { name: "send_device_message",
    description: "WRITE — Send a text message / notification to a supervised device (appears as an MDM message). Requires a non-empty message.",
    inputSchema: { type: "object", required: ["device_id", "message"], properties: {
      device_id: { type: "string" },
      message: { type: "string", description: "Message body shown on the device." },
      title: { type: "string", description: "Optional message title." },
    }}},
```

- [ ] **Step 7: Add the handler case**

```ts
    case "send_device_message":
      requireWrites();
      validateSendMessageArgs(args);
      return api(`/devices/${seg(args.device_id, "device_id")}/send_message`, {
        method: "POST",
        body: j(buildSendMessageBody(args)),
      });
```

- [ ] **Step 8: Register as write + invalidation**

In `WRITE_TOOLS`, add `"send_device_message"`.
In `INVALIDATION_MAP`, add:

```ts
  send_device_message:                 ["/devices"],
```

- [ ] **Step 9: Build and full test**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/deviceActions.ts src/index.ts test/deviceActions.test.mjs
git commit -m "feat: add send_device_message device action"
```

---

## Task 6: `send_bulk_device_message`

Reuses `runBulk` (Task 4) and `buildSendMessageBody` (Task 5). Same explicit-`device_ids` safety rule as Task 4.

**Files:**
- Modify: `src/index.ts` — `TOOLS`, `handleTool`, `WRITE_TOOLS`, `INVALIDATION_MAP`

- [ ] **Step 1: Add the tool definition**

In the "DEVICES — actions" block:

```ts
  { name: "send_bulk_device_message",
    description: "WRITE — Send the same message to many devices. Pass an explicit list of device_ids. Returns a per-device success/failure report.",
    inputSchema: { type: "object", required: ["device_ids", "message"], properties: {
      device_ids: { type: "array", description: "Array of device id strings." },
      message: { type: "string", description: "Message body shown on each device." },
      title: { type: "string", description: "Optional message title." },
      concurrency: { type: "integer", minimum: 1, maximum: 16, description: "Parallel requests. Default 5." },
    }}},
```

- [ ] **Step 2: Add the handler case**

```ts
    case "send_bulk_device_message": {
      requireWrites();
      validateSendMessageArgs(args);
      const ids = (args.device_ids as unknown[]).map(x => seg(x, "device_ids[]"));
      const conc = typeof args.concurrency === "number" ? args.concurrency : 5;
      const body = buildSendMessageBody(args);
      return runBulk(ids, conc, (id) =>
        api(`/devices/${id}/send_message`, { method: "POST", body: j(body) }));
    }
```

- [ ] **Step 3: Register as write + invalidation**

In `WRITE_TOOLS`, add `"send_bulk_device_message"`.
In `INVALIDATION_MAP`, add:

```ts
  send_bulk_device_message:            ["/devices"],
```

- [ ] **Step 4: Build and full test**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add send_bulk_device_message"
```

---

## Task 7: `get_api_coverage` — API coverage tracking

The spec asks for "automated API capability scanning" and a "coverage dashboard." For the MCP, the honest, low-risk version is a **read-only introspection tool** that reports which SimpleMDM capability areas this server exposes — derived from the already-registered `TOOLS`. It does not probe the live API (that would require write-scope guessing); it reports static coverage so an operator can see gaps at a glance.

**Files:**
- Modify: `src/index.ts` — `TOOLS`, `handleTool`

- [ ] **Step 1: Add the tool definition**

In a sensible spot in `TOOLS` (e.g. near other read/meta tools — search for an existing `list_*` meta tool, or place at the end of the array before the closing `];`):

```ts
  { name: "get_api_coverage",
    description: "Read — Report which SimpleMDM capability areas this MCP server exposes (tool count per area, total tools, write vs read). Static introspection of the registered tool list.",
    inputSchema: { type: "object", properties: {} } },
```

- [ ] **Step 2: Add the handler case**

Place near other read cases in `handleTool`. It reads from `TOOLS` and `WRITE_TOOLS`, both in scope at module level:

```ts
    case "get_api_coverage": {
      const areas: Record<string, RegExp> = {
        devices:        /^(get_device|list_devices|create_device|update_device|delete_device|lock_device|wipe_device|sync_device|restart_device|shutdown_device|unenroll_device|clear_|update_os|enable_lost|disable_lost|play_lost|update_lost)/,
        recovery:       /^(rotate_|set_admin_password|clear_firmware|clear_recovery|disable_activation_lock|get_activation_lock)/,
        cellular:       /cellular/,
        messaging:      /message/,
        activation_lock:/activation_lock/,
        profiles:       /(profile|declaration)/,
        apps:           /app/,
        groups:         /assignment_group|group/,
        attributes:     /attribute/,
        scripts:        /script/,
      };
      const counts: Record<string, number> = {};
      for (const [area, re] of Object.entries(areas)) {
        counts[area] = TOOLS.filter(t => re.test(t.name)).length;
      }
      return {
        total_tools: TOOLS.length,
        write_tools: TOOLS.filter(t => WRITE_TOOLS.has(t.name)).length,
        read_tools: TOOLS.filter(t => !WRITE_TOOLS.has(t.name)).length,
        coverage_by_area: counts,
        note: "Static coverage derived from registered tools; does not probe the live SimpleMDM API.",
      };
    }
```

- [ ] **Step 3: Build and test**

Run: `npm run build && npm test`
Expected: build succeeds, no regressions. (`get_api_coverage` is read-only — do **not** add to `WRITE_TOOLS` or `INVALIDATION_MAP`.)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add get_api_coverage introspection tool"
```

---

## Task 8 (FLAGGED — confirm before building): Safari Bookmarks helper

> ⚠️ **Needs live-API confirmation.** SimpleMDM has historically had **no dedicated REST resource** for Safari bookmarks; bookmarks are delivered via a configuration profile (`com.apple.bookmarks` payload) created through `POST /custom_configuration_profiles` (which this server already wraps as `create_custom_configuration_profile`). Before implementing, confirm whether API v1.55 added a first-class bookmarks endpoint. If it did **not**, the value-add here is a convenience wrapper that builds the mobileconfig for the operator. If a real endpoint exists, model this on Task 2 instead.

This task is **optional** and intentionally minimal — the rich bookmark UX in the spec (nested folders, preview, analytics) belongs to Report-SimpleMDM, not the MCP.

**Files:**
- Modify: `src/deviceActions.ts` — `buildSafariBookmarksMobileconfig`
- Modify: `src/index.ts` — `TOOLS`, `handleTool`, `WRITE_TOOLS`, `INVALIDATION_MAP`
- Test: `test/deviceActions.test.mjs`

- [ ] **Step 1: Decision checkpoint**

Confirm against SimpleMDM docs whether a native bookmarks endpoint exists. Record the answer in the commit message. If unsure, **stop and ask the maintainer** — do not guess a payload format into production.

- [ ] **Step 2: Write the failing test (mobileconfig builder)**

Add to `test/deviceActions.test.mjs`:

```js
import { buildSafariBookmarksMobileconfig } from "../dist/deviceActions.js";

test("buildSafariBookmarksMobileconfig — embeds each bookmark URL and title", () => {
  const xml = buildSafariBookmarksMobileconfig("Company Links", [
    { title: "Intranet", url: "https://intra.example.com" },
  ]);
  assert.match(xml, /<\?xml/);
  assert.match(xml, /com\.apple\.bookmarks/);
  assert.match(xml, /Intranet/);
  assert.match(xml, /https:\/\/intra\.example\.com/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: FAIL — `buildSafariBookmarksMobileconfig` not exported.

- [ ] **Step 4: Implement the builder in `src/deviceActions.ts`**

```ts
export interface SafariBookmark { title: string; url: string; }

// Builds a minimal com.apple.bookmarks mobileconfig payload. XML-escapes
// user-supplied strings. Confirm the exact payload keys SimpleMDM expects
// before relying on this in production.
export function buildSafariBookmarksMobileconfig(name: string, bookmarks: SafariBookmark[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = bookmarks.map(b => `
        <dict>
          <key>Title</key><string>${esc(b.title)}</string>
          <key>URL</key><string>${esc(b.url)}</string>
        </dict>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>${esc(name)}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.bookmarks</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>Bookmarks</key>
      <array>${items}
      </array>
    </dict>
  </array>
</dict>
</plist>`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && node --test test/deviceActions.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add the tool definition + handler**

Import the builder (extend the `deviceActions.js` import). Tool def near the custom-configuration-profile tools:

```ts
  { name: "create_safari_bookmarks_profile",
    description: "WRITE — Create a custom configuration profile that installs Safari bookmarks. Convenience wrapper over create_custom_configuration_profile.",
    inputSchema: { type: "object", required: ["name", "bookmarks"], properties: {
      name: { type: "string", description: "Profile display name." },
      bookmarks: { type: "array", description: "Array of {title, url} objects." },
    }}},
```

Handler (model the body on `create_custom_configuration_profile`, ~line of `case "create_custom_configuration_profile"`):

```ts
    case "create_safari_bookmarks_profile": {
      requireWrites();
      const marks = (args.bookmarks as Array<{ title: string; url: string }>);
      const mobileconfig = buildSafariBookmarksMobileconfig(seg(args.name, "name"), marks);
      return api("/custom_configuration_profiles", {
        method: "POST",
        body: j({ name: args.name, mobileconfig }),
      });
    }
```

- [ ] **Step 7: Register as write + invalidation**

In `WRITE_TOOLS`, add `"create_safari_bookmarks_profile"`.
In `INVALIDATION_MAP`, add:

```ts
  create_safari_bookmarks_profile:     ["/custom_configuration_profiles"],
```

- [ ] **Step 8: Build, test, commit**

```bash
npm run build && npm test
git add src/deviceActions.ts src/index.ts test/deviceActions.test.mjs
git commit -m "feat: add create_safari_bookmarks_profile helper (custom profile wrapper)"
```

---

## Task 9: Documentation + naming decision

**Files:**
- Modify: `README.md` (tool reference section)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the `wipe_device_advanced` naming decision**

In `README.md`, in the wipe section, add a one-line note:

> The spec's `wipe_device_advanced` is implemented as the existing `wipe_device` tool, which accepts all advanced parameters (`return_to_service`, `wifi_network_id`, `obliteration_behavior`, `preserve_managed_apps`, …).

- [ ] **Step 2: Add the new tools to the README tool reference**

List the new tools under appropriate headings: `refresh_cellular_plans`, `disable_activation_lock`, `disable_activation_lock_bulk`, `get_activation_lock_status`, `send_device_message`, `send_bulk_device_message`, `get_api_coverage`, and (if Task 8 shipped) `create_safari_bookmarks_profile`.

- [ ] **Step 3: Add a CHANGELOG entry**

Under a new unreleased/next-version heading, following the existing CHANGELOG style:

```markdown
### Added
- `refresh_cellular_plans` — refresh eSIM/cellular plans on a device.
- `disable_activation_lock`, `disable_activation_lock_bulk`, `get_activation_lock_status` — Activation Lock recovery actions.
- `send_device_message`, `send_bulk_device_message` — push MDM messages to devices.
- `preserve_managed_apps` parameter on `wipe_device`.
- `get_api_coverage` — static introspection of exposed capability areas.

### Notes
- `send_*message` request body field names are best-effort pending SimpleMDM API confirmation.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document new device-action tools and wipe_device_advanced mapping"
```

- [ ] **Step 5: Cut the release (optional)**

Use the repo's `/version-bump` skill to bump the version, tag, and publish a GitHub release once the maintainer has confirmed the `send_message` body shape against the live API.

---

## Self-Review

**Spec coverage check:**

- Safari Bookmarks → Task 8 (MCP-relevant slice; UI parts marked out of scope). ✅
- Custom Configuration Profile enhancements → existing `create/update/delete/assign` tools already cover the API; UI "advanced editor" is out of scope (noted in Scope Note). ✅
- Return To Service → already in `wipe_device` (`return_to_service` + `wifi_network_id`). ✅
- Preserve Managed Apps During Wipe → Task 1. ✅
- Refresh Cellular Plans → Task 2. ✅
- Send Message → Tasks 5–6. ✅
- Disable Activation Lock → Tasks 3–4. ✅
- Advanced Wipe Parameters → Task 1 closes the only gap (`preserve_managed_apps`). ✅
- API Discovery / Coverage Tracking → Task 7. ✅
- Report-SimpleMDM modules (Recovery/Communication/Cellular Center, API Explorer, dashboards) → out of scope, documented in Scope Note. ✅

**Placeholder scan:** The two `⚠️` flags (send-message body fields, Safari endpoint existence) are explicit verification steps with concrete best-effort code + tests, not TODOs. No "TBD"/"implement later"/bare "add validation" remain.

**Type consistency:** `runBulk(ids, concurrency, fn)` signature is identical in Tasks 4 and 6. `buildSendMessageBody`/`validateSendMessageArgs` defined in Task 5, reused in Task 6. `seg()`, `api()`, `j()`, `requireWrites()` used exactly as the existing code defines them. New write tools are added to `WRITE_TOOLS` **and** `INVALIDATION_MAP`; read-only tools (`get_activation_lock_status`, `get_api_coverage`) are added to neither — consistent with the existing convention.
