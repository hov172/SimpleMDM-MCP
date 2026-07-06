// download_custom_configuration_profile / download_custom_declaration —
// the /download endpoints return raw file content (mobileconfig XML / JSON),
// not the usual {data} JSON envelope. Live-verified 2026-07-06: profile
// download returns 200 application/x-apple-aspen-config.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const MOBILECONFIG = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string></dict></plist>`;

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/api/v1/custom_configuration_profiles/104996/download") {
    return {
      ok: true, status: 200,
      headers: new Headers({ "content-type": "application/x-apple-aspen-config" }),
      text: async () => MOBILECONFIG,
      json: async () => { throw new Error("not JSON"); },
    };
  }
  if (u.pathname === "/api/v1/custom_declarations/55/download") {
    return {
      ok: true, status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => '{"Type":"com.apple.configuration.test"}',
      json: async () => ({}),
    };
  }
  throw new Error(`Unhandled mock fetch: ${url}`);
};

const { handleTool } = await import("../dist/index.js");

test("download_custom_configuration_profile returns the raw mobileconfig content", async () => {
  const r = await handleTool("download_custom_configuration_profile", { profile_id: "104996" });
  assert.equal(r.profile_id, "104996");
  assert.match(r.content, /^<\?xml/, "content must be the raw mobileconfig XML");
  assert.match(r.content, /PayloadType/);
  assert.equal(r.content_type, "application/x-apple-aspen-config");
});

test("download_custom_declaration returns the raw declaration content", async () => {
  const r = await handleTool("download_custom_declaration", { declaration_id: "55" });
  assert.equal(r.declaration_id, "55");
  assert.match(r.content, /com\.apple\.configuration\.test/);
});
