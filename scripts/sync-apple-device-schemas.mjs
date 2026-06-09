#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const REPO_OWNER = "apple";
const REPO_NAME = "device-management";
const DEFAULT_REF = "release";
const DEFAULT_OUT = "data/apple-device-management/schema-cache.json";
const USER_AGENT = "SimpleMDM-MCP apple-schema-sync";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RAW_BYTES = 1024 * 1024;
const MAX_TREE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const SCHEMA_PREFIXES = ["mdm/profiles/", "declarative/declarations/"];

const repoRoot = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");

const CURATED_FALLBACKS = [
  schema("profile", "mdm/profiles/com.apple.wifi.managed.yaml", "com.apple.wifi.managed", "Wi-Fi", "Configures managed Wi-Fi network settings.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("SSID_STR", "string", { description: "SSID of the Wi-Fi network." }),
    key("AutoJoin", "boolean", { default: true, description: "Automatically join this network." }),
    key("HIDDEN_NETWORK", "boolean", { description: "Whether the SSID is hidden." }),
    key("EncryptionType", "string", { enumValues: ["WEP", "WPA", "WPA2", "WPA3", "Any", "None"], default: "Any", description: "Wireless encryption type." }),
    key("Password", "string", { description: "Pre-shared key for personal networks." }),
    key("EAPClientConfiguration", "dictionary", { description: "Enterprise EAP configuration.", childKeys: [
      key("AcceptEAPTypes", "array", { required: true, itemKeys: [key("EAPType", "integer", { enumValues: [13, 17, 18, 21, 23, 25, 43] })] }),
      key("UserName", "string"),
      key("UserPassword", "string"),
      key("TLSTrustedServerNames", "array", { itemKeys: [key("TLSTrustedServerName", "string")] }),
      key("TLSAllowTrustExceptions", "boolean"),
    ] }),
    key("ProxyType", "string", { enumValues: ["None", "Manual", "Auto"], default: "None" }),
  ]),
  schema("profile", "mdm/profiles/com.apple.mobiledevice.passwordpolicy.yaml", "com.apple.mobiledevice.passwordpolicy", "Passcode", "Configures passcode policy requirements.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("allowSimple", "boolean"),
    key("forcePIN", "boolean"),
    key("minLength", "integer"),
    key("minComplexChars", "integer"),
    key("maxFailedAttempts", "integer"),
    key("maxInactivity", "integer"),
  ]),
  schema("profile", "mdm/profiles/com.apple.applicationaccess.yaml", "com.apple.applicationaccess", "Restrictions", "Configures device restrictions and feature access.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("allowAppInstallation", "boolean"),
    key("allowCamera", "boolean"),
    key("allowCloudBackup", "boolean"),
    key("allowDiagnosticSubmission", "boolean"),
    key("allowSafari", "boolean"),
  ], { supervised: true }),
  schema("profile", "mdm/profiles/com.apple.security.firewall.yaml", "com.apple.security.firewall", "Firewall", "Configures the macOS application firewall.", ["macOS"], [
    key("EnableFirewall", "boolean", { required: true }),
    key("BlockAllIncoming", "boolean"),
    key("EnableStealthMode", "boolean"),
    key("Applications", "array", { itemKeys: [key("BundleID", "string"), key("Allowed", "boolean", { required: true })] }),
  ]),
  schema("profile", "mdm/profiles/com.apple.security.scep.yaml", "com.apple.security.scep", "SCEP", "Configures SCEP certificate enrollment.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("URL", "string", { required: true }),
    key("Name", "string", { required: true }),
    key("Subject", "array"),
    key("Challenge", "string"),
    key("Key Type", "string", { enumValues: ["RSA", "ECSECPrimeRandom"] }),
    key("Key Usage", "integer"),
    key("Keysize", "integer"),
    key("Retries", "integer"),
    key("RetryDelay", "integer"),
  ]),
  schema("profile", "mdm/profiles/com.apple.security.root.yaml", "com.apple.security.root", "Certificate", "Installs a root certificate payload.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("PayloadContent", "string", { required: true }),
    key("PayloadCertificateFileName", "string"),
  ]),
  schema("profile", "mdm/profiles/com.apple.vpn.managed.yaml", "VPN", "VPN", "Configures managed VPN settings.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("UserDefinedName", "string", { required: true }),
    key("VPNType", "string", { required: true, enumValues: ["VPN", "IPSec", "IKEv2", "AlwaysOn"] }),
    key("VPNSubType", "string"),
    key("VPN", "dictionary"),
    key("IKEv2", "dictionary"),
    key("IPSec", "dictionary"),
    key("OnDemandEnabled", "integer"),
    key("OnDemandRules", "array"),
  ]),
  schema("profile", "mdm/profiles/com.apple.webClip.managed.yaml", "com.apple.webClip.managed", "Web Clip", "Configures a managed web clip.", ["iOS", "iPadOS", "macOS", "visionOS"], [
    key("Label", "string", { required: true }),
    key("URL", "string", { required: true }),
    key("IsRemovable", "boolean"),
    key("FullScreen", "boolean"),
    key("Icon", "string"),
  ]),
  schema("profile", "mdm/profiles/com.apple.webcontent-filter.yaml", "com.apple.webcontent-filter", "Content Filter", "Configures web content filtering.", ["iOS", "iPadOS", "macOS", "visionOS"], [
    key("FilterType", "string", { enumValues: ["BuiltIn", "Plugin"] }),
    key("AutoFilterEnabled", "boolean"),
    key("PermittedURLs", "array"),
    key("BlacklistedURLs", "array"),
    key("WhitelistedBookmarks", "array"),
    key("PluginBundleID", "string"),
    key("ServerAddress", "string"),
  ], { supervised: true }),
  schema("profile", "mdm/profiles/com.apple.security.FDERecoveryKeyEscrow.yaml", "com.apple.security.FDERecoveryKeyEscrow", "FileVault Recovery Key Escrow", "Escrows FileVault personal recovery keys.", ["macOS"], [
    key("Location", "string"),
    key("EncryptCertPayloadUUID", "string", { required: true }),
    key("DeviceKey", "string"),
  ]),
  schema("declaration", "declarative/declarations/configurations/safari.bookmarks.yaml", "com.apple.configuration.safari.bookmarks", "Safari Bookmarks", "Configures managed Safari bookmark groups.", ["iOS", "iPadOS", "macOS", "visionOS"], [
    key("ManagedBookmarks", "array", { required: true, itemKeys: [
      key("GroupIdentifier", "string", { required: true }),
      key("Title", "string", { required: true }),
      key("Bookmarks", "array", { required: true }),
    ] }),
  ], { supervised: true, availability: "iOS 26+, macOS 26+, visionOS 26+" }),
  schema("declaration", "declarative/declarations/configurations/softwareupdate.settings.yaml", "com.apple.configuration.softwareupdate.settings", "Software Update Settings", "Configures declarative software update settings.", ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"], [
    key("AutomaticActions", "dictionary", { childKeys: [
      key("Download", "string", { enumValues: ["AlwaysOn", "AlwaysOff", "Default"] }),
      key("InstallOSUpdates", "string", { enumValues: ["AlwaysOn", "AlwaysOff", "Default"] }),
      key("InstallSecurityResponses", "string", { enumValues: ["AlwaysOn", "AlwaysOff", "Default"] }),
    ] }),
    key("Beta", "dictionary"),
    key("Deferrals", "dictionary"),
    key("RapidSecurityResponse", "dictionary", { childKeys: [key("Enable", "boolean")] }),
  ], { supervised: true, availability: "DDM-capable OS versions" }),
];

function schema(kind, sourcePath, identifier, displayName, description, platforms, keys, extra = {}) {
  return { kind, identifier, displayName, description, platforms, sourcePath, keys, ...extra };
}

function key(name, type, extra = {}) {
  return { name, type, ...extra };
}

function usage() {
  return `Usage: node scripts/sync-apple-device-schemas.mjs [options]

Options:
  --ref <ref>          Apple device-management git ref to fetch (default: ${DEFAULT_REF})
  --out <path>        Output cache path (default: ${DEFAULT_OUT})
  --offline           Do not use the network; write the embedded curated cache
  --source-dir <dir>  Read local Apple-style YAML fixtures/files instead of network
  --no-fallback       Fail instead of adding curated fallback schemas on errors
  --dry-run           Validate and print a summary without writing
  --help              Show this help
`;
}

function parseArgs(argv) {
  const args = { ref: DEFAULT_REF, out: DEFAULT_OUT, offline: false, fallback: true, dryRun: false, sourceDir: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--offline") args.offline = true;
    else if (arg === "--no-fallback") args.fallback = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--ref") args.ref = requireValue(argv, ++i, arg);
    else if (arg === "--out") args.out = requireValue(argv, ++i, arg);
    else if (arg === "--source-dir") args.sourceDir = requireValue(argv, ++i, arg);
    else throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }
  validateRef(args.ref);
  if (args.offline && args.sourceDir) throw new Error("Use either --offline or --source-dir, not both.");
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function validateRef(ref) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(ref) || ref.includes("..") || ref.includes("//") || ref.endsWith("/")) {
    throw new Error("Invalid --ref. Use a branch, tag, or commit-ish containing only letters, digits, '.', '_', '-', and '/'.");
  }
}

function apiTreeUrl(ref) {
  const url = new URL(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${encodeURIComponent(ref).replaceAll("%2F", "/")}`, "https://api.github.com");
  url.searchParams.set("recursive", "1");
  assertAllowedUrl(url, "api");
  return url;
}

function rawUrl(ref, sourcePath) {
  assertAllowedSchemaPath(sourcePath);
  const url = new URL(`/${REPO_OWNER}/${REPO_NAME}/${encodeURIComponent(ref).replaceAll("%2F", "/")}/${sourcePath}`, "https://raw.githubusercontent.com");
  assertAllowedUrl(url, "raw");
  return url;
}

function assertAllowedUrl(url, kind) {
  if (url.protocol !== "https:") throw new Error(`Refusing non-HTTPS URL: ${url.href}`);
  if (kind === "api") {
    if (url.hostname !== "api.github.com") throw new Error(`Refusing API host: ${url.href}`);
    if (!url.pathname.startsWith(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/`)) throw new Error(`Refusing API path: ${url.pathname}`);
    return;
  }
  if (kind === "raw") {
    if (url.hostname !== "raw.githubusercontent.com") throw new Error(`Refusing raw host: ${url.href}`);
    if (!url.pathname.startsWith(`/${REPO_OWNER}/${REPO_NAME}/`)) throw new Error(`Refusing raw path: ${url.pathname}`);
    const schemaPath = SCHEMA_PREFIXES.find((prefix) => url.pathname.includes(`/${prefix}`));
    if (!schemaPath || !url.pathname.endsWith(".yaml")) throw new Error(`Refusing non-schema raw path: ${url.pathname}`);
    return;
  }
  throw new Error(`Unknown URL kind: ${kind}`);
}

function assertAllowedSchemaPath(sourcePath) {
  if (!sourcePath.endsWith(".yaml") || sourcePath.includes("..") || sourcePath.startsWith("/")) {
    throw new Error(`Refusing schema path: ${sourcePath}`);
  }
  if (!SCHEMA_PREFIXES.some((prefix) => sourcePath.startsWith(prefix))) {
    throw new Error(`Refusing non-allowlisted schema path: ${sourcePath}`);
  }
}

async function fetchText(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json, text/plain, application/octet-stream", "user-agent": USER_AGENT },
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error(`Redirect refused for ${url.href}`);
    if (!response.ok) throw new Error(`Fetch failed for ${url.href}: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte cap for ${url.href}`);
    return await readCappedText(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function readCappedText(response, maxBytes) {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded ${maxBytes} byte cap.`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(concatUint8(chunks, total));
}

function concatUint8(chunks, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function listRemoteSchemaPaths(ref) {
  const text = await fetchText(apiTreeUrl(ref), MAX_TREE_BYTES);
  const body = JSON.parse(text);
  if (!Array.isArray(body.tree)) throw new Error("GitHub tree response missing tree array.");
  return body.tree
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path)
    .filter((sourcePath) => sourcePath.endsWith(".yaml") && SCHEMA_PREFIXES.some((prefix) => sourcePath.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));
}

async function listLocalSchemaFiles(sourceDir) {
  const base = path.resolve(repoRoot, sourceDir);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".yaml")) files.push(full);
    }
  }
  await walk(base);
  return files.sort((a, b) => a.localeCompare(b)).map((fullPath) => ({
    sourcePath: path.relative(base, fullPath).replaceAll(path.sep, "/"),
    fullPath,
  }));
}

function kindForPath(sourcePath) {
  if (sourcePath.startsWith("mdm/profiles/") || sourcePath.startsWith("profiles/")) return "profile";
  if (sourcePath.startsWith("declarative/declarations/") || sourcePath.startsWith("declarations/")) return "declaration";
  if (sourcePath.includes("declarations")) return "declaration";
  return "profile";
}

function parseAppleYaml(yaml, sourcePath) {
  const doc = YAML.parse(yaml);
  if (!doc || typeof doc !== "object") throw new Error("YAML root is not an object.");
  const payload = objectValue(doc.payload);
  const kind = kindForPath(sourcePath);
  const identifier = stringValue(payload.declarationtype) || stringValue(payload.payloadtype) || identifierFromPath(sourcePath);
  const supportedOS = objectValue(payload.supportedOS);
  const keys = normalizeKeys(Array.isArray(doc.payloadkeys) ? doc.payloadkeys : []);
  const schema = {
    kind,
    identifier,
    displayName: stringValue(doc.title) || identifier,
    description: stringValue(doc.description) || stringValue(doc.content) || "",
    platforms: platformsFromSupportedOS(supportedOS),
    sourcePath,
    sourceRefMode: "fetched",
    keys,
  };
  const availability = availabilityFromSupportedOS(supportedOS);
  if (availability) schema.availability = availability;
  const supervised = supervisedFromSupportedOS(supportedOS);
  if (typeof supervised === "boolean") schema.supervised = supervised;
  validateSchema(schema, sourcePath);
  return sortSchema(schema);
}

function identifierFromPath(sourcePath) {
  return path.basename(sourcePath, ".yaml");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function platformsFromSupportedOS(supportedOS) {
  const platforms = Object.entries(supportedOS)
    .filter(([, metadata]) => objectValue(metadata).introduced !== "n/a")
    .map(([platform]) => platform);
  return platforms.length ? platforms : ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"];
}

function availabilityFromSupportedOS(supportedOS) {
  return Object.entries(supportedOS)
    .filter(([, metadata]) => objectValue(metadata).introduced && objectValue(metadata).introduced !== "n/a")
    .map(([platform, metadata]) => `${platform} ${objectValue(metadata).introduced}+`)
    .join(", ");
}

function supervisedFromSupportedOS(supportedOS) {
  const values = Object.values(supportedOS).flatMap((metadata) => {
    const data = objectValue(metadata);
    const direct = typeof data.supervised === "boolean" ? [data.supervised] : [];
    const allowed = Array.isArray(data["allowed-enrollments"]) ? [data["allowed-enrollments"].includes("supervised")] : [];
    return [...direct, ...allowed];
  });
  return values.length ? values.some(Boolean) : undefined;
}

function normalizeKeys(rawKeys, seen = new WeakSet(), depth = 0) {
  if (!Array.isArray(rawKeys) || depth > 12) return [];
  if (seen.has(rawKeys)) return [];
  seen.add(rawKeys);
  return rawKeys.map((raw) => normalizeKey(raw, seen, depth)).filter((entry) => entry.name && entry.type);
}

function normalizeKey(raw, seen, depth) {
  const data = objectValue(raw);
  const normalized = {
    name: stringValue(data.key),
    type: normalizeType(data.type),
  };
  const title = stringValue(data.title);
  const description = stringValue(data.content) || stringValue(data.description);
  if (title && title !== normalized.name) normalized.title = title;
  if (data.presence === "required") normalized.required = true;
  if (description) normalized.description = description;
  if (Array.isArray(data.rangelist)) normalized.enumValues = data.rangelist.filter((value) => value !== undefined && value !== null).map(String);
  if (data.default !== undefined) normalized.default = data.default;
  const subkeys = Array.isArray(data.subkeys) ? normalizeKeys(data.subkeys, seen, depth + 1) : [];
  if ((normalized.type === "dictionary" || normalized.type === "object") && subkeys.length) normalized.childKeys = subkeys;
  if (normalized.type === "array" && subkeys.length) normalized.itemKeys = subkeys;
  const supportedOS = objectValue(data.supportedOS);
  const availability = availabilityFromSupportedOS(supportedOS);
  if (availability) normalized.availability = availability;
  return normalized;
}

function normalizeType(value) {
  const text = stringValue(value).replace(/[<>]/g, "").toLowerCase();
  if (text === "bool" || text === "boolean") return "boolean";
  if (text === "int" || text === "integer") return "integer";
  if (text === "float" || text === "double" || text === "real") return "real";
  if (text === "dict" || text === "dictionary") return "dictionary";
  if (text === "array") return "array";
  if (text === "object") return "object";
  if (text === "data") return "data";
  return "string";
}

function fallbackSchemas() {
  return CURATED_FALLBACKS.map((entry) => sortSchema({ ...entry, sourceRefMode: "curated-fallback" }));
}

function mergeFallbacks(schemas) {
  const seen = new Set(schemas.map((entry) => entry.identifier));
  const merged = [...schemas];
  for (const fallback of fallbackSchemas()) {
    if (!seen.has(fallback.identifier)) merged.push({ ...fallback, fallbackReason: "missing from fetched cache" });
  }
  return merged;
}

function validateSchema(schema, label) {
  if (!["profile", "declaration"].includes(schema.kind)) throw new Error(`${label}: invalid kind`);
  if (!schema.identifier || !schema.displayName || !schema.sourcePath) throw new Error(`${label}: missing required metadata`);
  if (!Array.isArray(schema.platforms) || schema.platforms.length === 0) throw new Error(`${label}: missing platforms`);
  if (!Array.isArray(schema.keys)) throw new Error(`${label}: missing keys`);
  for (const keyEntry of schema.keys) {
    if (!keyEntry.name || !keyEntry.type) throw new Error(`${label}: invalid key entry`);
  }
}

function sortSchema(schema) {
  const sorted = {
    kind: schema.kind,
    identifier: schema.identifier,
    displayName: schema.displayName,
    description: schema.description,
    platforms: [...new Set(schema.platforms)].sort((a, b) => a.localeCompare(b)),
  };
  if (schema.availability) sorted.availability = schema.availability;
  if (typeof schema.supervised === "boolean") sorted.supervised = schema.supervised;
  sorted.sourcePath = schema.sourcePath;
  sorted.sourceRefMode = schema.sourceRefMode;
  if (schema.fallbackReason) sorted.fallbackReason = schema.fallbackReason;
  sorted.keys = (schema.keys ?? []).map(sortKey).sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

function sortKey(keyEntry) {
  const sorted = { name: keyEntry.name, type: keyEntry.type };
  if (keyEntry.title) sorted.title = keyEntry.title;
  if (keyEntry.required) sorted.required = true;
  if (keyEntry.description) sorted.description = keyEntry.description;
  if (keyEntry.enumValues) sorted.enumValues = [...keyEntry.enumValues].map(String).sort((a, b) => a.localeCompare(b));
  if (keyEntry.default !== undefined) sorted.default = keyEntry.default;
  if (keyEntry.availability) sorted.availability = keyEntry.availability;
  if (keyEntry.childKeys) sorted.childKeys = keyEntry.childKeys.map(sortKey).sort((a, b) => a.name.localeCompare(b.name));
  if (keyEntry.itemKeys) sorted.itemKeys = keyEntry.itemKeys.map(sortKey).sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

function stableStringify(value) {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((acc, objectKey) => {
    acc[objectKey] = sortObject(value[objectKey]);
    return acc;
  }, {});
}

async function buildCache(args) {
  const warnings = [];
  let schemas = [];
  let fetchedBytes = 0;

  if (args.offline) {
    schemas = fallbackSchemas();
  } else if (args.sourceDir) {
    for (const { sourcePath, fullPath } of await listLocalSchemaFiles(args.sourceDir)) {
      try {
        const text = await readFile(fullPath, "utf8");
        schemas.push(parseAppleYaml(text, sourcePath));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!args.fallback) throw error;
        warnings.push(`${sourcePath}: ${reason}`);
      }
    }
    if (args.fallback) schemas = mergeFallbacks(schemas);
  } else {
    const sourcePaths = await listRemoteSchemaPaths(args.ref);
    for (const sourcePath of sourcePaths) {
      try {
        const text = await fetchText(rawUrl(args.ref, sourcePath), MAX_RAW_BYTES);
        fetchedBytes += Buffer.byteLength(text, "utf8");
        if (fetchedBytes > MAX_TOTAL_BYTES) throw new Error(`Total fetched content exceeded ${MAX_TOTAL_BYTES} byte cap.`);
        schemas.push(parseAppleYaml(text, sourcePath));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!args.fallback) throw error;
        warnings.push(`${sourcePath}: ${reason}`);
      }
    }
    if (args.fallback) schemas = mergeFallbacks(schemas);
  }

  const deduped = [...new Map(schemas.map((entry) => [entry.identifier, entry])).values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.displayName.localeCompare(b.displayName) || a.identifier.localeCompare(b.identifier));
  return {
    schemaVersion: 2,
    source: {
      name: `${REPO_OWNER}/${REPO_NAME}`,
      url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
      ref: args.offline || args.sourceDir ? "local" : args.ref,
      mode: args.offline ? "curated-fallback" : args.sourceDir ? "local-fixtures" : "github-tree",
      generatedAt: new Date(0).toISOString(),
    },
    stats: {
      declarations: deduped.filter((entry) => entry.kind === "declaration").length,
      profiles: deduped.filter((entry) => entry.kind === "profile").length,
      warnings: warnings.length,
    },
    warnings,
    schemas: deduped,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cache = await buildCache(args);
  const json = stableStringify(cache);
  if (args.dryRun) {
    console.log(`Validated ${cache.schemas.length} Apple schemas; profiles=${cache.stats.profiles}; declarations=${cache.stats.declarations}; output bytes=${Buffer.byteLength(json, "utf8")}; warnings=${cache.warnings.length}`);
    for (const warning of cache.warnings.slice(0, 10)) console.warn(`warning: ${warning}`);
    return;
  }
  const out = path.resolve(repoRoot, args.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, json, "utf8");
  console.log(`Wrote ${cache.schemas.length} Apple schemas to ${path.relative(repoRoot, out)}`);
  if (cache.warnings.length) console.warn(`Completed with ${cache.warnings.length} warnings.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
