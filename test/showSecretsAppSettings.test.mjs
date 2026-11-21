// show_secrets passes through on devices reads; com.apple.configuration.app.settings
// (binary allow/deny + app privacy defaults) validates against the synced schema cache.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const seen = [];
globalThis.fetch = async (url) => {
  seen.push(new URL(url));
  return { ok: true, status: 200, json: async () => ({ data: [], has_more: false }), text: async () => "" };
};

const { handleTool } = await import("../dist/index.js");
const { buildCustomDeclarationPayload, getAppleSchema } = await import("../dist/appleSchemas.js");

test("list_devices and get_device forward show_secrets", async () => {
  await handleTool("list_devices", { show_secrets: true });
  await handleTool("get_device", { device_id: "42", show_secrets: true });
  await handleTool("get_device", { device_id: "43" });
  assert.equal(seen[0].searchParams.get("show_secrets"), "true");
  assert.equal(seen[1].pathname, "/api/v1/devices/42");
  assert.equal(seen[1].searchParams.get("show_secrets"), "true");
  assert.equal(seen[2].searchParams.has("show_secrets"), false, "omitted when not requested");
});

test("app.settings declaration (binary restriction + privacy defaults) builds from schema", () => {
  const schema = getAppleSchema("com.apple.configuration.app.settings", "declaration");
  assert.deepEqual(schema.keys.map(k => k.name).sort(), ["Allowed", "Privacy"]);
  const out = buildCustomDeclarationPayload({
    declaration_type: "com.apple.configuration.app.settings",
    identifier: "binary-deny",
    payload: {
      Allowed: {
        DeniedBinaries: [{ BinaryIdentifier: { TeamID: "ABCDE12345" } }],
        AlwaysAllowManagedApps: true,
      },
      Privacy: { PermissionDefaults: { "com.example.app": { Camera: "Allow" } } },
    },
  });
  assert.equal(out.validation.valid, true, JSON.stringify(out.validation.issues));
});
