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
| `wifi_network_id` | string | iOS 17+, tvOS 18+ | Id of a WiFi profile assigned to the device. Required when `return_to_service=true`. |
| `obliteration_behavior` | enum | macOS 12+ (T2 / Apple Silicon) | `DoNotObliterate` \| `ObliterateWithWarning`. Server default: `ObliterateWithWarning`. |

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

Replace the one-line dispatch with a block that performs cross-field validation, then forwards every field:

```ts
case "wipe_device": {
  requireWrites();
  if (args.return_to_service === true && !args.wifi_network_id) {
    throw new Error(
      "return_to_service=true requires wifi_network_id (id of a WiFi profile assigned to the device)."
    );
  }
  return api(`/devices/${seg(args.device_id, "device_id")}/wipe`, {
    method: "POST",
    body: j({
      pin: args.pin,
      preserve_data_plan: args.preserve_data_plan,
      disable_activation_lock: args.disable_activation_lock,
      disallow_proximity_setup: args.disallow_proximity_setup,
      return_to_service: args.return_to_service,
      wifi_network_id: args.wifi_network_id,
      obliteration_behavior: args.obliteration_behavior,
    }),
  });
}
```

### 4.3 Validation policy (decision C)

- **Client-side pre-check:** only the obvious misuse — `return_to_service=true` without `wifi_network_id`. Rejected before the HTTP call with a clear, actionable message.
- **Server-side authority:** everything else (invalid `wifi_network_id`, wrong OS/hardware, unsupported combos) is surfaced verbatim from SimpleMDM via the existing `api()` error path. We do not duplicate SimpleMDM's validation.

Rationale: agents running autonomously benefit from the one local check that would otherwise cost a round-trip and produce a less obvious error. Beyond that, the API is the source of truth.

### 4.4 Omission semantics

`j()` is `JSON.stringify`, which elides object properties whose value is `undefined`. Therefore any parameter the caller omits is not present on the wire, and SimpleMDM applies its documented server-side default. This matches the existing behavior for `pin` and `lock_device.message`.

A caller that wants to *explicitly* set `disable_activation_lock=true` may do so — it will be serialized. No special-casing required.

## 5. Backwards compatibility

- Existing calls `{ device_id, pin? }` produce an identical request body (JSON keys in object-literal order are preserved, but SimpleMDM does not depend on key ordering). Verified by inspection of `j()`.
- `WRITE_TOOLS`, `DESTRUCTIVE`, and `CACHE_INVALIDATION_MAP` membership is unchanged.
- No change to the destructive-confirmation flow or the `device-offboarding` prompt.

## 6. Testing

Manual verification (no test harness exists in-repo today):

1. **Legacy call** — `wipe_device { device_id }`: body equals `{}`. No regression.
2. **Legacy + pin** — `wipe_device { device_id, pin: "123456" }`: body equals `{"pin":"123456"}`.
3. **Missing wifi** — `wipe_device { device_id, return_to_service: true }`: throws the validation error before any HTTP call.
4. **Return-to-service happy path** — `{ device_id, return_to_service: true, wifi_network_id: "42" }`: body contains both keys, HTTP call fires.
5. **Obliteration enum** — invalid value rejected by MCP's schema validator before dispatch (JSON-schema `enum` enforcement).
6. **All fields set** — body includes all seven keys.

Checked via `node --inspect` + `mcp.log` inspection, or by running one of the provided smoke scripts (`full_scan.mjs`, `summarize.mjs`) adapted for the wipe endpoint in a sandbox tenant.

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
- Test infrastructure (the repo does not yet have one; adding it is a separate initiative).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Caller passes `return_to_service=true` with a `wifi_network_id` not assigned to the device. | SimpleMDM rejects; error surfaces verbatim. Not worth a client-side roundtrip to pre-validate. |
| Agent sets `obliteration_behavior=DoNotObliterate` expecting it to be less destructive. | Description makes clear this is a macOS 12+ variant, not a "safer" wipe. Destructive-confirmation gate still runs. |
| SimpleMDM extends the endpoint again with more fields. | Current additive pattern scales; next addition is another optional-field row. |

## 10. Open questions

None. Decisions C (validation policy), extend-don't-split (tool shape), and omit-on-undefined (wire semantics) are confirmed.
