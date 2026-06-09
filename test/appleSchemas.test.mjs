import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCertificateProfilePayload,
  buildContentFilterProfilePayload,
  buildFirewallProfilePayload,
  buildFileVaultEscrowProfilePayload,
  buildCustomDeclarationPayload,
  buildMobileconfig,
  buildPasscodeProfilePayload,
  buildRestrictionsProfilePayload,
  buildScepProfilePayload,
  buildSoftwareUpdateSettingsDeclaration,
  buildVpnProfilePayload,
  buildWebClipProfilePayload,
  buildWifiProfilePayload,
  getAppleSchema,
  listAppleSchemas,
  validateApplePayload,
} from "../dist/appleSchemas.js";

test("search returns matching profile schemas without key payload", () => {
  const results = listAppleSchemas({ kind: "profile", query: "wifi" });
  assert.equal(results[0].identifier, "com.apple.wifi.managed");
  assert.equal(results[0].kind, "profile");
  assert.equal("keys" in results[0], false);
  assert.ok(results[0].keyCount > 0);
});

test("get returns full schema with keys", () => {
  const schema = getAppleSchema("com.apple.security.firewall", "profile");
  assert.equal(schema.displayName, "Firewall");
  assert.ok(schema.keys.some((key) => key.name === "EnableFirewall" && key.required));
});

test("runtime cache merges curated fallback schemas", () => {
  const scep = getAppleSchema("com.apple.security.scep", "profile");
  assert.equal(scep.identifier, "com.apple.security.scep");

  const webClip = getAppleSchema("com.apple.webClip.managed", "profile");
  assert.ok(webClip.keys.some((key) => key.name === "URL"));
});

test("validation catches required keys and enum values", () => {
  const result = validateApplePayload({
    identifier: "com.apple.wifi.managed",
    kind: "profile",
    payload: {
      PayloadType: "com.apple.wifi.managed",
      SSID_STR: "CorpNet",
      EncryptionType: "DefinitelyNotApple",
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /must be one of/);
});

test("nested validation catches child enum values", () => {
  const result = validateApplePayload({
    identifier: "com.apple.configuration.softwareupdate.settings",
    kind: "declaration",
    payload: {
      AutomaticActions: {
        Download: "Sometimes",
      },
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /AutomaticActions\.Download/);
});

test("validation accepts valid firewall payload", () => {
  const result = validateApplePayload({
    identifier: "com.apple.security.firewall",
    kind: "profile",
    payload: {
      PayloadType: "com.apple.security.firewall",
      EnableFirewall: true,
      EnableStealthMode: true,
    },
  });
  assert.equal(result.valid, true);
});

test("buildMobileconfig emits plist XML after validation", () => {
  const result = buildMobileconfig({
    display_name: "Firewall Policy",
    identifier: "com.example.firewall",
    payloads: [
      {
        PayloadType: "com.apple.security.firewall",
        EnableFirewall: true,
        EnableStealthMode: true,
      },
    ],
  });
  assert.match(result.mobileconfig, /<key>PayloadType<\/key>\n\s+<string>Configuration<\/string>/);
  assert.match(result.mobileconfig, /<key>EnableFirewall<\/key>\n\s+<true\/>/);
  assert.equal(result.validation[0].identifier, "com.apple.security.firewall");
});

test("buildCustomDeclarationPayload wraps and validates declaration payload", () => {
  const result = buildCustomDeclarationPayload({
    declaration_type: "com.apple.configuration.safari.bookmarks",
    identifier: "com.example.bookmarks",
    payload: {
      ManagedBookmarks: [
        {
          GroupIdentifier: "com.example.links",
          Title: "Links",
          Bookmarks: [{ Title: "Help", URL: "https://help.example.com" }],
        },
      ],
    },
  });
  const parsed = JSON.parse(result.declaration);
  assert.equal(parsed.Type, "com.apple.configuration.safari.bookmarks");
  assert.equal(parsed.Identifier, "com.example.bookmarks");
  assert.equal(parsed.Payload.ManagedBookmarks[0].Title, "Links");
  assert.equal(result.declaration_type, "com.apple.configuration.safari.bookmarks");
  assert.equal(JSON.parse(result.simplemdm_payload).ManagedBookmarks[0].Title, "Links");
});

test("convenience profile builders emit validated payloads", () => {
  const wifi = buildWifiProfilePayload({ ssid: "CorpNet", encryption_type: "WPA2", password: "not-a-real-secret" });
  assert.equal(wifi.validation.valid, true);
  assert.equal(wifi.payload.PayloadType, "com.apple.wifi.managed");
  assert.equal(wifi.payload.SSID_STR, "CorpNet");

  const firewall = buildFirewallProfilePayload({ enable_stealth_mode: true });
  assert.equal(firewall.validation.valid, true);
  assert.equal(firewall.payload.EnableFirewall, true);

  const passcode = buildPasscodeProfilePayload({ min_length: 8, max_failed_attempts: 10 });
  assert.equal(passcode.validation.valid, true);
  assert.equal(passcode.payload.forcePIN, true);
});

test("software update convenience builder returns SimpleMDM declaration fields", () => {
  const result = buildSoftwareUpdateSettingsDeclaration({
    identifier: "com.example.software-update",
    automatic_actions: { Download: "AlwaysOn", InstallSecurityResponses: "AlwaysOn" },
    rapid_security_response: { Enable: true },
  });
  assert.equal(result.declaration_type, "com.apple.configuration.softwareupdate.settings");
  assert.equal(JSON.parse(result.simplemdm_payload).AutomaticActions.Download, "AlwaysOn");
});

test("expanded convenience profile builders emit validated payloads", () => {
  const restrictions = buildRestrictionsProfilePayload({ allow_camera: false, allow_airdrop: false });
  assert.equal(restrictions.validation.valid, true);
  assert.equal(restrictions.payload.allowCamera, false);

  const scep = buildScepProfilePayload({ name: "Device SCEP", url: "https://ca.example.com/scep", challenge: "secret" });
  assert.equal(scep.validation.valid, true);
  assert.equal(scep.payload.PayloadContent.URL, "https://ca.example.com/scep");

  const certificate = buildCertificateProfilePayload({ certificate_file_name: "Root CA", payload_content: "MIIexample==" });
  assert.equal(certificate.validation.valid, true);
  assert.equal(certificate.payload.PayloadCertificateFileName, "Root CA");

  const vpn = buildVpnProfilePayload({ user_defined_name: "Corp VPN", vpn_type: "VPN" });
  assert.equal(vpn.validation.valid, true);
  assert.equal(vpn.payload.VPNType, "VPN");

  const webClip = buildWebClipProfilePayload({ label: "Helpdesk", url: "https://help.example.com", full_screen: false });
  assert.equal(webClip.validation.valid, true);
  assert.equal(webClip.payload.URL, "https://help.example.com");

  const contentFilter = buildContentFilterProfilePayload({ filter_type: "Plugin", plugin_bundle_id: "com.example.filter" });
  assert.equal(contentFilter.validation.valid, true);
  assert.equal(contentFilter.payload.FilterType, "Plugin");

  const escrow = buildFileVaultEscrowProfilePayload({ encrypt_cert_payload_uuid: "CERT-PAYLOAD-UUID", location: "Company MDM" });
  assert.equal(escrow.validation.valid, true);
  assert.equal(escrow.payload.Location, "Company MDM");
});

test("semantic validation warns on complex payload issues", () => {
  const wifi = validateApplePayload({
    identifier: "com.apple.wifi.managed",
    kind: "profile",
    payload: {
      PayloadType: "com.apple.wifi.managed",
      SSID_STR: "CorpNet",
      EncryptionType: "WPA2",
      EAPClientConfiguration: {},
    },
  });
  assert.equal(wifi.valid, false);
  assert.match(wifi.issues.map((issue) => issue.message).join("\n"), /AcceptEAPTypes/);

  const scep = buildScepProfilePayload({ name: "Device SCEP", url: "http://ca.example.com/scep" });
  assert.equal(scep.validation.valid, false);
  assert.match(scep.validation.issues.map((issue) => issue.message).join("\n"), /HTTPS/);

  const bookmarks = validateApplePayload({
    identifier: "com.apple.configuration.safari.bookmarks",
    kind: "declaration",
    payload: {
      ManagedBookmarks: [
        {
          GroupIdentifier: "com.example.links",
          Title: "Links",
          Bookmarks: [{ Title: "Broken", URL: "https://help.example.com", Folder: [] }],
        },
      ],
    },
  });
  assert.equal(bookmarks.valid, false);
  assert.match(bookmarks.issues.map((issue) => issue.message).join("\n"), /exactly one of URL or Folder/);
});
