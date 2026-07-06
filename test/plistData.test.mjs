// plist emission edge cases.
// Regression: data-typed schema values (cert bodies, shared secrets) serialized
// as <string> where Apple requires <data>, producing profiles that fail to
// install or misparse. Also: XML-1.0-illegal control chars passed through
// (unparseable plist) and huge integers emitted in exponent notation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMobileconfig } from "../dist/appleSchemas.js";

// Built via escapes so this source file itself contains no control characters.
const CTRL = String.fromCharCode(1); // U+0001, illegal in XML 1.0
const ILLEGAL_XML_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]");

test("buildMobileconfig emits <data> for data-typed schema keys (root cert PayloadContent)", () => {
  const b64 = "TUlJQ2VqQ0NBZUNnQXdJQkFnSUpBSjNGdkVyRXFNc3M=";
  const { mobileconfig } = buildMobileconfig({
    display_name: "Root CA",
    identifier: "com.test.rootca",
    payloads: [{ PayloadType: "com.apple.security.root", PayloadContent: b64 }],
  });
  assert.match(mobileconfig, new RegExp(`<data>\\s*${b64}\\s*</data>`),
    "base64 cert body must serialize as <data>, not <string>");
  assert.doesNotMatch(mobileconfig, new RegExp(`<string>${b64}</string>`));
});

test("buildMobileconfig strips XML-1.0-illegal control chars from strings", () => {
  const { mobileconfig } = buildMobileconfig({
    display_name: "WiFi",
    identifier: "com.test.wifi",
    payloads: [{ PayloadType: "com.apple.wifi.managed", SSID_STR: `Lab${CTRL}Net`, Password: "pw" }],
  });
  assert.ok(!ILLEGAL_XML_RE.test(mobileconfig),
    "output must contain no XML-1.0-illegal control characters");
  assert.match(mobileconfig, /LabNet/, "legal characters survive with control chars stripped");
});

test("buildMobileconfig never emits <integer> in exponent notation", () => {
  const { mobileconfig } = buildMobileconfig({
    display_name: "T",
    identifier: "com.test.big",
    payloads: [{ PayloadType: "com.apple.wifi.managed", SSID_STR: "x", HugeCustomValue: 1e21 }],
  });
  assert.doesNotMatch(mobileconfig, /<integer>[^<]*e[^<]*<\/integer>/i,
    "1e21 must not become <integer>1e+21</integer>");
});
