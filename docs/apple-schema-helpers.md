# Apple Schema Helpers

The Apple schema helper tools turn Apple's public `device-management` schemas into a local, MCP-native workflow for custom SimpleMDM profiles and DDM declarations. They are read-only helpers until you pass the generated output to a SimpleMDM write tool.

The helpers load `data/apple-device-management/schema-cache.json`, which is generated from Apple's public `apple/device-management` YAML schemas. If the cache is missing or incomplete, the runtime merges in curated fallback data for high-value payloads. The helpers do not call the third-party Apple Profile Builder site at runtime, and they do not fetch Apple schemas while the MCP server is handling requests.

## What Is Included

- Runtime schema cache: `data/apple-device-management/schema-cache.json`, generated from Apple's `release` branch and checked into the package.
- Cache refresh script: `scripts/sync-apple-device-schemas.mjs`, which enumerates supported Apple profile/declaration YAML paths, parses them with `yaml`, and writes normalized JSON. Flags: `--ref <ref>`, `--out <path>`, `--offline` (embedded curated cache only), `--source-dir <dir>` (local YAML fixtures instead of network), `--no-fallback` (fail instead of merging curated fallbacks on errors), `--dry-run`, `--allow-shrink`, `--help`. Safety guards (0.30.5): the script **refuses to overwrite an existing cache with fewer schemas** ("Refusing to shrink … pass `--allow-shrink` to override"), aborts when >20% of raw fetches fail (a rate-limited GitHub must not silently collapse the cache to the fallbacks), and rejects truncated GitHub tree listings.
- Plist emission rules (0.30.5): schema keys typed `data` (certificate bodies, VPN shared secrets — including nested `childKeys`/`itemKeys`) emit `<data>`, not `<string>`; XML-1.0-illegal control characters are stripped (they would make the plist unparseable); integers outside the safe range emit as `<real>` instead of invalid exponent-notation `<integer>`.
- Curated fallback schemas for high-value payloads: Wi-Fi, Restrictions, SCEP, certificates, VPN, web clips, content filter, FileVault escrow, firewall, passcode, Safari bookmarks, and software update settings.
- Recursive validation for nested dictionaries and arrays, including recursive Safari bookmark folders.
- Semantic validation for cases where schema shape alone is not enough, including Wi-Fi Enterprise/EAP, SCEP HTTPS, certificate content, and Safari bookmark URL/folder exclusivity.
- Tests for fixture YAML normalization, runtime fallback behavior, builder output, semantic validation, static tool counts, and MCP stdio `initialize` plus `tools/list`.

## End-to-End Flow

1. Search for the Apple payload or declaration type.

   Use `search_apple_device_management_schemas` with a plain-language query, and optionally restrict by `kind` or `platform`.

   ```json
   {
     "kind": "profile",
     "query": "firewall",
     "platform": "macOS"
   }
   ```

2. Inspect the exact schema.

   Use `get_apple_device_management_schema` with the identifier from search results. Check required keys, enum values, platform availability, and the source path before drafting payload JSON.

   ```json
   {
     "identifier": "com.apple.security.firewall",
     "kind": "profile"
   }
   ```

3. Validate the payload before writing anything to SimpleMDM.

   For profile payloads, include the Apple `PayloadType`. For declarations, validate only the declaration `Payload` object.

   ```json
   {
     "identifier": "com.apple.security.firewall",
     "kind": "profile",
     "payload": {
       "PayloadType": "com.apple.security.firewall",
       "EnableFirewall": true,
       "EnableStealthMode": true
     }
   }
   ```

4. Build the deployable SimpleMDM input.

   For common payloads, prefer the convenience builders first:

   | Tool | Use it for | Notes |
   |------|------------|-------|
   | `build_wifi_profile_payload` | Managed Wi-Fi profiles | Adds Wi-Fi semantic checks, including Enterprise/EAP requirements. |
   | `build_firewall_profile_payload` | macOS firewall profiles | Defaults `EnableFirewall` to `true`. |
   | `build_passcode_profile_payload` | Passcode policy profiles | Emits Apple passcode keys such as `forcePIN` and length/attempt limits. |
   | `build_software_update_settings_declaration` | DDM software update settings | Returns `declaration_type` and `simplemdm_payload` for SimpleMDM custom declarations. |
   | `build_restrictions_profile_payload` | Application access/restrictions | Covers common restriction booleans such as camera and AirDrop. |
   | `build_scep_profile_payload` | SCEP certificate enrollment | Emits Apple’s nested `PayloadContent` shape and requires HTTPS semantically. |
   | `build_certificate_profile_payload` | Root certificate payloads | Accepts base64/string certificate content and optional file name. |
   | `build_vpn_profile_payload` | VPN profiles | Uses Apple `UserDefinedName`, `VPNType`, and optional VPN/IKEv2/IPSec dictionaries. |
   | `build_webclip_profile_payload` | Web clips | Builds URL, label, removable/full-screen, and optional icon fields. |
   | `build_content_filter_profile_payload` | Built-in or plugin web content filters | Defaults to `BuiltIn`; pass `filter_type: "Plugin"` for plugin filters. |
   | `build_filevault_escrow_profile_payload` | FileVault recovery key escrow | Requires the encryption certificate payload UUID. |

   Example Wi-Fi payload:

   ```json
   {
     "ssid": "CorpNet",
     "encryption_type": "WPA2",
     "password": "use-a-real-secret-outside-chat"
   }
   ```

   Pass the returned `payload` to `build_mobileconfig`.

   Example SCEP payload builder call:

   ```json
   {
     "name": "Device SCEP",
     "url": "https://ca.example.com/scep",
     "challenge": "use-a-real-secret-outside-chat"
   }
   ```

   This produces a profile payload with SCEP settings nested under `PayloadContent`, matching Apple's upstream schema.

   For custom configuration profiles, call `build_mobileconfig`, review the returned `.mobileconfig` XML, then pass that XML to `create_custom_configuration_profile`.

   ```json
   {
     "display_name": "Firewall Policy",
     "identifier": "com.example.mdm.firewall",
     "payloads": [
       {
         "PayloadType": "com.apple.security.firewall",
         "EnableFirewall": true,
         "EnableStealthMode": true
       }
     ]
   }
   ```

   Then create the SimpleMDM custom profile:

   ```json
   {
     "name": "Firewall Policy",
     "mobileconfig": "<mobileconfig XML returned by build_mobileconfig>"
   }
   ```

   For DDM custom declarations, call `build_custom_declaration_payload`, review the returned declaration JSON, then pass `declaration_type` and `simplemdm_payload` to `create_custom_declaration`.

   ```json
   {
     "declaration_type": "com.apple.configuration.safari.bookmarks",
     "identifier": "com.example.mdm.safari-bookmarks",
     "payload": {
       "ManagedBookmarks": [
         {
           "GroupIdentifier": "com.example.links",
           "Title": "Company Links",
           "Bookmarks": [
             {
               "Title": "Helpdesk",
               "URL": "https://help.example.com"
             }
           ]
         }
       ]
     }
   }
   ```

   For software update settings, `build_software_update_settings_declaration` returns the same `declaration_type` and `simplemdm_payload` fields without requiring you to type the declaration identifier manually.

   Then create the SimpleMDM custom declaration:

   ```json
   {
     "name": "Company Safari Bookmarks",
     "declaration_type": "com.apple.configuration.safari.bookmarks",
     "payload": "<simplemdm_payload returned by build_custom_declaration_payload>"
   }
   ```

5. Assign or scope the result.

   After creation, use the normal SimpleMDM assignment tools, such as `assign_custom_profile_to_device`, `assign_profile_to_group`, or `assign_declaration_to_device`, depending on how the profile or declaration should be deployed.

## Limits

- Validation is schema-backed but local. Always review Apple's deployment notes and test generated profiles on a small device group before broad rollout.
- The helper tools do not create or assign SimpleMDM objects by themselves. Writes still go through the existing SimpleMDM create and assignment tools and require `SIMPLEMDM_ALLOW_WRITES=true`.
- Local validation checks key names, required keys, basic value types, enum values, nested dictionaries/arrays, and selected semantic rules. It does not guarantee Apple will accept or apply a payload on every OS version or enrollment mode.
- The documented total tool count is guarded by `test/toolCount.test.mjs` using static source parsing, so it can run without booting the MCP server.
- The MCP stdio smoke test in `test/mcpSmoke.test.mjs` boots `dist/index.js`, sends `initialize`, then verifies `tools/list` includes the Apple helper tools.

## Refreshing The Cache

Refresh from Apple's public `release` branch:

```sh
node scripts/sync-apple-device-schemas.mjs --ref release --out data/apple-device-management/schema-cache.json
```

Validate the upstream sync without writing:

```sh
node scripts/sync-apple-device-schemas.mjs --ref release --dry-run
```

Run deterministic offline fallback generation:

```sh
node scripts/sync-apple-device-schemas.mjs --offline --dry-run
```

Run the fixture-backed parser test:

```sh
npm test -- --test-name-pattern "sync script normalizes fixture YAML"
```
