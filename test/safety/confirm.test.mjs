import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { canonicalArgsHash, issueToken, redeemToken, _clearTokensForTests } =
  await import("../../dist/safety/confirm.js");

beforeEach(() => _clearTokensForTests());

test("canonicalArgsHash is stable across key order and ignores confirm_token/dry_run", () => {
  const a = canonicalArgsHash("wipe_device", { device_id: "1", pin: "123456" });
  const b = canonicalArgsHash("wipe_device", { pin: "123456", device_id: "1" });
  const c = canonicalArgsHash("wipe_device", { device_id: "1", pin: "123456", confirm_token: "x", dry_run: false });
  assert.equal(a, b);
  assert.equal(a, c);
  assert.notEqual(a, canonicalArgsHash("wipe_device", { device_id: "2", pin: "123456" }));
  assert.notEqual(a, canonicalArgsHash("lock_device", { device_id: "1", pin: "123456" }));
});

test("issue → redeem succeeds once, then token is unknown", () => {
  const h = canonicalArgsHash("wipe_device", { device_id: "1" });
  const { token, expires_at } = issueToken("wipe_device", h, 120_000);
  assert.match(token, /^[0-9a-f]{32,}$/);
  assert.ok(!Number.isNaN(Date.parse(expires_at)));
  assert.deepEqual(redeemToken(token, "wipe_device", h), { ok: true });
  assert.deepEqual(redeemToken(token, "wipe_device", h), { ok: false, reason: "unknown" });
});

test("redeem fails with mismatch when args differ from those planned", () => {
  const h = canonicalArgsHash("wipe_device", { device_id: "1" });
  const { token } = issueToken("wipe_device", h, 120_000);
  const other = canonicalArgsHash("wipe_device", { device_id: "2" });
  assert.deepEqual(redeemToken(token, "wipe_device", other), { ok: false, reason: "mismatch" });
  // mismatch does NOT consume the token
  assert.deepEqual(redeemToken(token, "wipe_device", h), { ok: true });
});

test("redeem fails with mismatch when the tool differs", () => {
  const h = canonicalArgsHash("wipe_device", { device_id: "1" });
  const { token } = issueToken("wipe_device", h, 120_000);
  assert.deepEqual(redeemToken(token, "lock_device", h), { ok: false, reason: "mismatch" });
});

test("expired tokens are rejected and deleted", () => {
  const h = canonicalArgsHash("wipe_device", { device_id: "1" });
  const t0 = 1_000_000;
  const { token } = issueToken("wipe_device", h, 120_000, t0);
  assert.deepEqual(redeemToken(token, "wipe_device", h, t0 + 120_001), { ok: false, reason: "expired" });
  assert.deepEqual(redeemToken(token, "wipe_device", h, t0), { ok: false, reason: "unknown" });
});

test("unknown token", () => {
  assert.deepEqual(redeemToken("deadbeef", "wipe_device", "h"), { ok: false, reason: "unknown" });
});
