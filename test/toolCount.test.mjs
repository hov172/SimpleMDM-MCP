import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function registeredToolNames() {
  const source = read("src/index.ts");
  const start = source.indexOf("const TOOLS: Tool[] = [");
  const end = source.indexOf("const WRITE_TOOLS", start);
  assert.notEqual(start, -1, "TOOLS array not found");
  assert.notEqual(end, -1, "WRITE_TOOLS marker not found");

  const block = source.slice(start, end);
  return [...block.matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function documentedToolCount(path) {
  const doc = read(path);
  const match = doc.match(/server registers \*\*(\d+) tools\*\*/i);
  assert.ok(match, `${path} does not document the total tool count`);
  return Number(match[1]);
}

test("documented tool count matches static registry", () => {
  const toolNames = registeredToolNames();
  assert.equal(new Set(toolNames).size, toolNames.length, "duplicate tool names found");
  assert.equal(toolNames.length, documentedToolCount("README.md"));
  assert.equal(toolNames.length, documentedToolCount("docs/tools.md"));
});

test("Apple schema helper docs list the registered helper tools", () => {
  const toolNames = registeredToolNames();
  const helperTools = [
    "search_apple_device_management_schemas",
    "get_apple_device_management_schema",
    "validate_apple_payload",
    "build_mobileconfig",
    "build_custom_declaration_payload",
    "build_wifi_profile_payload",
    "build_firewall_profile_payload",
    "build_passcode_profile_payload",
    "build_software_update_settings_declaration",
    "build_restrictions_profile_payload",
    "build_scep_profile_payload",
    "build_certificate_profile_payload",
    "build_vpn_profile_payload",
    "build_webclip_profile_payload",
    "build_content_filter_profile_payload",
    "build_filevault_escrow_profile_payload",
  ];

  for (const name of helperTools) {
    assert.ok(toolNames.includes(name), `${name} is not registered`);
  }

  const docs = [
    read("README.md"),
    read("docs/tools.md"),
    read("docs/apple-schema-helpers.md"),
  ].join("\n");

  for (const name of helperTools) {
    assert.match(docs, new RegExp(`\\\`${name}\\\``), `${name} is not documented`);
  }
});
