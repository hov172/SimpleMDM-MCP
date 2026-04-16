# Design: Extended wipe options for `wipe_device`

**Status:** Draft
**Date:** 2026-04-16
**Target version:** v0.8.0
**Scope:** Add five optional parameters to the existing `wipe_device` MCP tool to reach parity with the SimpleMDM admin portal's wipe dialog.

---

## 1. Motivation

SimpleMDM's `POST /api/v1/devices/{id}/wipe` now accepts five parameters that were previously available only in the admin portal. The MCP surface currently exposes only `pin`, which blocks automation of modern iOS/macOS reprovisioning workflows — most notably Return-to-Service on iOS 17+/tvOS 18+ and eSIM preservation for carrier-reused devices.

Bringing the tool to parity is low-risk: every new parameter is optional, the endpoint and semantics are unchanged, and SimpleMDM applies server-side defaults when fields are omitted.

## 2. Decision: extend, do not split

One tool — extend `wipe_device` in place (`src/index.ts:844`).

The new parameters are optional knobs on the same endpoint, same verb, same destructive semantics. Splitting into `wipe_device_advanced` or similar would:

- fragment discovery (agents would need heuristics for "which wipe tool?"),
- diverge from the existing repo pattern (`lock_device` bundles `message` + `pin` on one tool),
- force callers to switch tools when adding one optional flag.

The existing `CACHE_INVALIDATION_MAP` entry (`src/index.ts:388`) and `WRITE_TOOLS` / `DESTRUCTIVE` sets (`src/index.ts:2799`, `src/index.ts:2829`) already cover `wipe_device` and require no change.

## 3. Parameters

All fields are optional. Omitted fields are not serialized (JSON.stringify drops `undefined` values), so SimpleMDM's own defaults apply and legacy callers observe no behavior change.

| Parameter | Type | Platform | Notes |
|---|---|---|---|
| `preserve_data_plan` | boolean | iOS | Preserves eSIM / cellular data plan during wipe. |
| `disable_activation_lock` | boolean | iOS, macOS | Server default: `true`. Pass `false` to retain Activation Lock. |
| `disallow_proximity_setup` | boolean | iOS | Suppresses Proximity Setup on the wiped device. |
| `return_to_service` | boolean | iOS 17+, tvOS 18+ | Auto re-enrolls after wipe. Requires `wifi_network_id`. |
| `wifi_network_id` | string | iOS 17+, tvOS 18+ | SimpleMDM integer id (serialized as a string per repo convention) of a WiFi profile attached to the device's assignment group. Not an SSID, UUID, or profile name. Required when `return_to_service=true`. |
| `obliteration_behavior` | enum | macOS 12+ (T2 / Apple Silicon) | `DoNotObliterate` \| `ObliterateWithWarning`. Server default: `ObliterateWithWarning`. |

### 3.1 Parameter interactions

- **`pin` with `return_to_service`:** `pin` is macOS-only; `return_to_service` is iOS 17+/tvOS 18+. Passing both is nonsensical. **Policy:** no client-side rejection — SimpleMDM is the source of truth for platform gating. If SimpleMDM accepts the combo silently on one side, we do not second-guess it.
- **`wifi_network_id` without `return_to_service`:** Harmless; forwarded verbatim. SimpleMDM will ignore or 422 per its current contract. **Policy:** no warning, no client-side strip.
- **`obliteration_behavior` on non-macOS devices:** Forwarded verbatim; SimpleMDM decides.
- **`disable_activation_lock=true` when Activation Lock was never enabled:** Harmless no-op server-side.

## 4. Implementation

### 4.1 Schema change — `src/index.ts:844`

Replace the existing `wipe_device` entry:

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
    wifi_network_id: { type: "string", description: "WiFi profile id assigned to the device. Required when return_to_service=true." },
    obliteration_behavior: { type: "string", enum: ["DoNotObliterate", "ObliterateWithWarning"],
      description: "macOS 12+ (T2/Apple Silicon). Server default: ObliterateWithWarning." },
  }}},
```

### 4.2 Dispatch change — `src/index.ts:2487`

Add an import at the top of `src/index.ts`:

```ts
import { validateWipeArgs, buildWipeBody } from "./wipe.js";
```

Replace the one-line dispatch with a block that delegates to the two pure helpers:

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

Helpers live in a new file `src/wipe.ts` (not alongside `j()`/`seg()` in `index.ts`). Rationale: `src/index.ts` runs `main()` at module load (`src/index.ts:3125`), so importing it from test code would start the MCP server. Extracting to a sibling module keeps the helpers importable without a server-bootstrap gate, and keeps `index.ts` from growing further.

```ts
// src/wipe.ts
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

`buildWipeBody` intentionally does no pruning; the omission contract (§4.4) is enforced by `JSON.stringify` when `j()` is called by the dispatch. Keeping the helper trivial means its correctness is by inspection.

### 4.3 Validation policy (decision C)

- **Client-side pre-check:** only the obvious misuse — `return_to_service=true` without `wifi_network_id`. Rejected before the HTTP call with a clear, actionable message.
- **Server-side authority:** everything else (invalid `wifi_network_id`, wrong OS/hardware, unsupported combos) is surfaced verbatim from SimpleMDM via the existing `api()` error path. We do not duplicate SimpleMDM's validation.

Rationale: agents running autonomously benefit from the one local check that would otherwise cost a round-trip and produce a less obvious error. Beyond that, the API is the source of truth.

### 4.4 Wire semantics: `undefined` vs `null` vs explicit value

Three cases:

| Caller passes | Wire result | Server behavior |
|---|---|---|
| field omitted | key absent (`JSON.stringify` drops `undefined`) | SimpleMDM applies its own default |
| field = `null` | would serialize as `"field": null` — **but blocked earlier** by MCP schema validation (`type: "boolean"` / `type: "string"` does not permit null) | N/A — request never reaches dispatch |
| field = explicit value | key present with value | SimpleMDM honors it |

Therefore callers have exactly two observable behaviors — *omitted* and *explicit* — and cannot accidentally send `null` to SimpleMDM. This matches the existing behavior for `pin` and `lock_device.message`.

## 5. Backwards compatibility

- Existing calls `{ device_id, pin? }` produce an identical request body (`{}` or `{"pin":"..."}`).
- `WRITE_TOOLS`, `DESTRUCTIVE`, and `CACHE_INVALIDATION_MAP` membership is unchanged.
- No change to the destructive-confirmation flow or the `device-offboarding` prompt.

## 6. Testing

The repo has no test harness today (confirmed: `full_scan.mjs` is an API scanner, `summarize.mjs` parses `mcp.log` — neither tests tool dispatch). Rather than adding a framework, we use Node's built-in `node:test` runner to exercise the two pure helpers.

### 6.1 New file: `test/wipe_device.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWipeBody, validateWipeArgs } from "../dist/wipe.js";

test("legacy call — only device_id", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1" }));
  assert.equal(body, "{}");
});

test("legacy call — device_id + pin", () => {
  const body = JSON.stringify(buildWipeBody({ device_id: "1", pin: "123456" }));
  assert.equal(body, '{"pin":"123456"}');
});

test("validateWipeArgs — return_to_service without wifi_network_id throws", () => {
  assert.throws(
    () => validateWipeArgs({ return_to_service: true }),
    /wifi_network_id/
  );
});

test("validateWipeArgs — return_to_service with wifi_network_id passes", () => {
  assert.doesNotThrow(() =>
    validateWipeArgs({ return_to_service: true, wifi_network_id: "42" })
  );
});

test("validateWipeArgs — return_to_service=false does not require wifi_network_id", () => {
  assert.doesNotThrow(() => validateWipeArgs({ return_to_service: false }));
});

test("buildWipeBody — all fields serialize", () => {
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
```

Run: `npm run build && node --test test/`. Add script `"test": "npm run build && node --test test/"` to `package.json`.

### 6.2 What is *not* tested here

- **Live HTTP to SimpleMDM.** A live test would require a sandbox tenant and a device willing to be wiped — unacceptable risk for CI. Integration testing remains manual against a staging tenant.
- **MCP schema validation.** The MCP SDK validates the `inputSchema` before dispatch; we trust that code path. Tests cover only our own logic.
- **Destructive-confirmation gate.** Unchanged behavior, covered by existing code paths.

### 6.3 Manual staging checklist

Before release, against a sandbox tenant with one throwaway device:

1. Dry call (no wipe trigger needed) — validate tool schema appears correctly in an MCP client's tool list.
2. Happy path: `wipe_device { device_id, return_to_service: true, wifi_network_id: <real id> }` — confirm device re-enrolls.
3. Error path: invalid `wifi_network_id` — confirm SimpleMDM's 422 surfaces verbatim.

## 7. Documentation

- **README.md** — update the `wipe_device` row in the tools table with a one-line mention of the new parameters and a link to this spec.
- **CHANGELOG.md** — add a new section for v0.8.0:
  > ### Added
  > - `wipe_device`: `preserve_data_plan`, `disable_activation_lock`, `disallow_proximity_setup`, `return_to_service` (+ required `wifi_network_id`), `obliteration_behavior`. Parity with the SimpleMDM admin portal wipe dialog.
- **package.json** — bump `version` to `0.8.0`.

## 8. Out of scope

- Splitting into a second "advanced wipe" tool.
- Auto-resolving `wifi_network_id` from a WiFi profile name.
- A new MCP prompt for Return-to-Service reprovisioning workflows.
- Changes to the destructive-confirmation gate.
- A broader test framework (jest/vitest/etc). We use `node:test` for this change only; adopting a framework repo-wide is a separate initiative.
- Retry/idempotency logic, concurrent-wipe deduplication, per-field audit logging (see §9.2).

## 9. Risks

### 9.1 New in this change

| Risk | Mitigation |
|---|---|
| Caller passes `return_to_service=true` with a `wifi_network_id` not assigned to the device. | SimpleMDM 422s; error surfaces verbatim via `api()`. Not worth a client-side roundtrip to pre-validate — that would require a new tool call and add latency for no real safety gain. |
| Agent sets `obliteration_behavior=DoNotObliterate` expecting it to be less destructive. | Tool description is explicit: macOS 12+ T2/Apple Silicon variant, not a "safer" wipe. Destructive-confirmation gate still runs. |
| SimpleMDM extends the endpoint again with more fields. | Additive pattern via `buildWipeBody` scales; next addition is another line in the helper and another row in the schema. |
| Agent discovers the new `return_to_service` flag and uses it without realizing the device needs a pre-assigned WiFi profile. | Validation error message names `wifi_network_id` explicitly. Description repeats the requirement. Beyond that, it's a SimpleMDM configuration prerequisite — outside this tool's responsibility. |

### 9.2 Inherited from existing `wipe_device`

These are not introduced here but noted for completeness — a reviewer should know they remain unchanged:

- **Retry/idempotency on timeout.** `POST /wipe` is not idempotent from SimpleMDM's perspective. If `api()` times out, the caller does not know whether SimpleMDM received the command. No retry logic is added. Callers receive the underlying fetch error.
- **Concurrent wipes on the same device.** Two in-flight wipe requests: SimpleMDM queues both MDM commands to the device. No client-side deduplication.
- **Audit trail.** Parameter values sent are not logged separately from the raw `api()` request. Users who need audit must enable `mcp.log` at transport level.

These are pre-existing properties of the destructive-endpoint surface and are out of scope for this change.

## 10. Open questions

None. Decisions C (validation policy), extend-don't-split (tool shape), and omit-on-undefined (wire semantics) are confirmed.
