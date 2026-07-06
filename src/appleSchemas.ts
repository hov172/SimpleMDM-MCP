import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Curated Apple device-management schema seed used by read-only helper tools.
// Source: Apple's public apple/device-management schema repository. Keep this
// compact at runtime; a future sync script can regenerate/expand this list.

export type AppleSchemaKind = "profile" | "declaration";
export type AppleSchemaValueType = "string" | "integer" | "real" | "boolean" | "array" | "dictionary" | "object" | "data";

export interface AppleSchemaKey {
  name: string;
  type: AppleSchemaValueType;
  required?: boolean;
  description?: string;
  enumValues?: string[];
  default?: unknown;
  childKeys?: AppleSchemaKey[];
  itemKeys?: AppleSchemaKey[];
  availability?: string;
}

export interface AppleDeviceSchema {
  kind: AppleSchemaKind;
  identifier: string;
  displayName: string;
  description: string;
  platforms: string[];
  availability?: string;
  supervised?: boolean;
  sourcePath: string;
  sourceRefMode?: string;
  keys: AppleSchemaKey[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export const APPLE_SCHEMA_SOURCE = {
  name: "apple/device-management",
  url: "https://github.com/apple/device-management",
  mode: "local-cache",
  note: "Runtime reads data/apple-device-management/schema-cache.json and falls back to a curated seed; it does not fetch user-controlled URLs.",
};

const CURATED_SCHEMAS: AppleDeviceSchema[] = [
  {
    kind: "profile",
    identifier: "com.apple.wifi.managed",
    displayName: "Wi-Fi",
    description: "Configures managed Wi-Fi network settings.",
    platforms: ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"],
    supervised: false,
    sourcePath: "mdm/profiles/com.apple.wifi.managed.yaml",
    keys: [
      { name: "SSID_STR", type: "string", required: true, description: "SSID of the Wi-Fi network." },
      { name: "AutoJoin", type: "boolean", description: "Automatically join this network." },
      { name: "HiddenNetwork", type: "boolean", description: "Whether the SSID is hidden." },
      { name: "EncryptionType", type: "string", required: true, enumValues: ["WEP", "WPA", "WPA2", "WPA3", "Any", "None"], description: "Wireless encryption type." },
      { name: "Password", type: "string", description: "Pre-shared key for personal networks." },
      { name: "EAPClientConfiguration", type: "dictionary", description: "Enterprise EAP configuration.", childKeys: [
        { name: "AcceptEAPTypes", type: "array", description: "Accepted EAP type numbers." },
        { name: "UserName", type: "string", description: "Enterprise Wi-Fi username." },
        { name: "UserPassword", type: "string", description: "Enterprise Wi-Fi password." },
        { name: "TLSAllowTrustExceptions", type: "boolean", description: "Allow TLS trust exceptions." },
        { name: "TLSTrustedServerNames", type: "array", description: "Trusted RADIUS server names." },
      ] },
      { name: "ProxyType", type: "string", enumValues: ["None", "Manual", "Auto"], description: "Proxy configuration mode." },
    ],
  },
  {
    kind: "profile",
    identifier: "com.apple.mobiledevice.passwordpolicy",
    displayName: "Passcode",
    description: "Configures device passcode and password policy requirements.",
    platforms: ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"],
    supervised: false,
    sourcePath: "mdm/profiles/com.apple.mobiledevice.passwordpolicy.yaml",
    keys: [
      { name: "allowSimple", type: "boolean", description: "Allow simple passcodes." },
      { name: "forcePIN", type: "boolean", description: "Require a passcode." },
      { name: "minLength", type: "integer", description: "Minimum passcode length." },
      { name: "minComplexChars", type: "integer", description: "Minimum number of complex characters." },
      { name: "maxFailedAttempts", type: "integer", description: "Maximum failed attempts before action." },
      { name: "maxInactivity", type: "integer", description: "Maximum inactivity before lock." },
    ],
  },
  {
    kind: "profile",
    identifier: "com.apple.applicationaccess",
    displayName: "Restrictions",
    description: "Configures device restrictions and feature access.",
    platforms: ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"],
    supervised: true,
    sourcePath: "mdm/profiles/com.apple.applicationaccess.yaml",
    keys: [
      { name: "allowAppInstallation", type: "boolean", description: "Allow app installation." },
      { name: "allowCamera", type: "boolean", description: "Allow use of the camera." },
      { name: "allowCloudBackup", type: "boolean", description: "Allow iCloud Backup." },
      { name: "allowDiagnosticSubmission", type: "boolean", description: "Allow diagnostic submission." },
      { name: "allowSafari", type: "boolean", description: "Allow Safari." },
    ],
  },
  {
    kind: "profile",
    identifier: "com.apple.security.firewall",
    displayName: "Firewall",
    description: "Configures the macOS application firewall.",
    platforms: ["macOS"],
    supervised: false,
    sourcePath: "mdm/profiles/com.apple.security.firewall.yaml",
    keys: [
      { name: "EnableFirewall", type: "boolean", required: true, description: "Enable the application firewall." },
      { name: "BlockAllIncoming", type: "boolean", description: "Block all incoming connections." },
      { name: "EnableStealthMode", type: "boolean", description: "Enable stealth mode." },
      { name: "Applications", type: "array", description: "Application-specific firewall rules.", itemKeys: [
        { name: "BundleID", type: "string", description: "Application bundle identifier." },
        { name: "Allowed", type: "boolean", required: true, description: "Whether incoming connections are allowed." },
      ] },
    ],
  },
  {
    kind: "declaration",
    identifier: "com.apple.configuration.safari.bookmarks",
    displayName: "Safari Bookmarks",
    description: "Configures managed Safari bookmark groups.",
    platforms: ["iOS", "iPadOS", "macOS", "visionOS"],
    availability: "iOS 26+, macOS 26+, visionOS 26+",
    supervised: true,
    sourcePath: "declarative/declarations/configurations/safari.bookmarks.yaml",
    keys: [
      { name: "ManagedBookmarks", type: "array", required: true, description: "Managed bookmark groups.", itemKeys: [
        { name: "GroupIdentifier", type: "string", required: true, description: "Stable bookmark group identifier." },
        { name: "Title", type: "string", required: true, description: "Safari folder title." },
        { name: "Bookmarks", type: "array", required: true, description: "Bookmarks and nested folders." },
      ] },
    ],
  },
  {
    kind: "declaration",
    identifier: "com.apple.configuration.softwareupdate.settings",
    displayName: "Software Update Settings",
    description: "Configures declarative software update settings.",
    platforms: ["iOS", "iPadOS", "macOS", "tvOS", "visionOS"],
    availability: "DDM-capable OS versions",
    supervised: true,
    sourcePath: "declarative/declarations/configurations/softwareupdate.settings.yaml",
    keys: [
      { name: "AutomaticActions", type: "dictionary", description: "Automatic software update behavior.", childKeys: [
        { name: "Download", type: "string", enumValues: ["AlwaysOn", "AlwaysOff", "Default"], description: "Automatic update download behavior." },
        { name: "InstallOSUpdates", type: "string", enumValues: ["AlwaysOn", "AlwaysOff", "Default"], description: "Automatic OS update installation behavior." },
        { name: "InstallSecurityResponses", type: "string", enumValues: ["AlwaysOn", "AlwaysOff", "Default"], description: "Automatic security response installation behavior." },
      ] },
      { name: "Beta", type: "dictionary", description: "Beta enrollment settings.", childKeys: [
        { name: "Program", type: "string", description: "Beta program identifier." },
      ] },
      { name: "Deferrals", type: "dictionary", description: "Software update deferral settings.", childKeys: [
        { name: "CombinedPeriodInDays", type: "integer", description: "Combined update deferral period." },
        { name: "MajorPeriodInDays", type: "integer", description: "Major update deferral period." },
        { name: "MinorPeriodInDays", type: "integer", description: "Minor update deferral period." },
        { name: "SystemPeriodInDays", type: "integer", description: "System update deferral period." },
      ] },
      { name: "RapidSecurityResponse", type: "dictionary", description: "Rapid Security Response settings.", childKeys: [
        { name: "Enable", type: "boolean", description: "Enable Rapid Security Response updates." },
      ] },
    ],
  },
];

function isSchemaKind(value: unknown): value is AppleSchemaKind {
  return value === "profile" || value === "declaration";
}

function isValueType(value: unknown): value is AppleSchemaValueType {
  return ["string", "integer", "real", "boolean", "array", "dictionary", "object", "data"].includes(String(value));
}

function normalizeSchemaKey(raw: unknown): AppleSchemaKey | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== "string" || !isValueType(entry.type)) return null;
  const normalized: AppleSchemaKey = { name: entry.name, type: entry.type };
  if (entry.required === true) normalized.required = true;
  if (typeof entry.description === "string") normalized.description = entry.description;
  if (Array.isArray(entry.enumValues)) normalized.enumValues = entry.enumValues.map(String);
  if (entry.default !== undefined) normalized.default = entry.default;
  if (typeof entry.availability === "string") normalized.availability = entry.availability;
  if (Array.isArray(entry.childKeys)) normalized.childKeys = entry.childKeys.map(normalizeSchemaKey).filter((key): key is AppleSchemaKey => key !== null);
  if (Array.isArray(entry.itemKeys)) normalized.itemKeys = entry.itemKeys.map(normalizeSchemaKey).filter((key): key is AppleSchemaKey => key !== null);
  return normalized;
}

function normalizeSchema(raw: unknown): AppleDeviceSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (!isSchemaKind(entry.kind) || typeof entry.identifier !== "string" || typeof entry.displayName !== "string") return null;
  const keys = Array.isArray(entry.keys) ? entry.keys.map(normalizeSchemaKey).filter((key): key is AppleSchemaKey => key !== null) : [];
  return {
    kind: entry.kind,
    identifier: entry.identifier,
    displayName: entry.displayName,
    description: typeof entry.description === "string" ? entry.description : "",
    platforms: Array.isArray(entry.platforms) ? entry.platforms.map(String) : [],
    availability: typeof entry.availability === "string" ? entry.availability : undefined,
    supervised: typeof entry.supervised === "boolean" ? entry.supervised : undefined,
    sourcePath: typeof entry.sourcePath === "string" ? entry.sourcePath : "",
    sourceRefMode: typeof entry.sourceRefMode === "string" ? entry.sourceRefMode : undefined,
    keys,
  };
}

function loadSchemaCache(): { schemas: AppleDeviceSchema[]; mode: string; count: number } {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(resolve(here, "..", "data", "apple-device-management", "schema-cache.json"), "utf8");
    const parsed = JSON.parse(raw) as { schemas?: unknown[]; source?: { mode?: string } };
    const schemas = Array.isArray(parsed.schemas)
      ? parsed.schemas.map(normalizeSchema).filter((schema): schema is AppleDeviceSchema => schema !== null)
      : [];
    if (schemas.length) return { schemas: mergeCuratedSchemas(schemas), mode: parsed.source?.mode ?? "local-cache", count: schemas.length };
  } catch {
    // Fall back below.
  }
  return { schemas: CURATED_SCHEMAS, mode: "curated-fallback", count: CURATED_SCHEMAS.length };
}

function mergeCuratedSchemas(schemas: AppleDeviceSchema[]): AppleDeviceSchema[] {
  const byIdentifier = new Map(schemas.map(schema => [schema.identifier, schema]));
  for (const schema of CURATED_SCHEMAS) {
    const existing = byIdentifier.get(schema.identifier);
    if (!existing || existing.keys.length === 0) {
      byIdentifier.set(schema.identifier, schema);
    }
  }
  return [...byIdentifier.values()];
}

const CACHE = loadSchemaCache();
const SCHEMAS: AppleDeviceSchema[] = CACHE.schemas;
APPLE_SCHEMA_SOURCE.mode = CACHE.mode;
APPLE_SCHEMA_SOURCE.note = `Runtime loaded ${CACHE.count} schemas from local cache mode "${CACHE.mode}" and keeps curated fallbacks for high-value payloads.`;

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function listAppleSchemas(args: {
  kind?: unknown;
  query?: unknown;
  platform?: unknown;
  limit?: unknown;
} = {}): Array<Omit<AppleDeviceSchema, "keys"> & { keyCount: number }> {
  const kind = args.kind === "profile" || args.kind === "declaration" ? args.kind : undefined;
  const query = normalizeQuery(args.query);
  const platform = normalizeQuery(args.platform);
  const limit = Math.max(1, Math.min(100, Number(args.limit ?? 25) || 25));

  return SCHEMAS
    .filter(s => !kind || s.kind === kind)
    .filter(s => {
      if (!query) return true;
      return [s.identifier, s.displayName, s.description].some(v => v.toLowerCase().includes(query));
    })
    .filter(s => {
      if (!platform) return true;
      return s.platforms.some(p => p.toLowerCase() === platform);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit)
    .map(({ keys, ...schema }) => ({ ...schema, keyCount: keys.length }));
}

export function getAppleSchema(identifier: unknown, kind?: unknown): AppleDeviceSchema {
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw new Error("identifier is required.");
  }
  const wantedKind = kind === "profile" || kind === "declaration" ? kind : undefined;
  const schema = SCHEMAS.find(s => s.identifier === identifier && (!wantedKind || s.kind === wantedKind));
  if (!schema) throw new Error(`No Apple schema found for ${identifier}.`);
  return schema;
}

function typeMatches(value: unknown, type: AppleSchemaValueType): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "integer": return Number.isInteger(value);
    case "real": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "dictionary":
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "data": return typeof value === "string";
  }
}

function validateKeys(
  keys: AppleSchemaKey[],
  payload: Record<string, unknown>,
  pathPrefix: string,
  issues: ValidationIssue[],
): void {
  const knownKeys = new Set(keys.map(k => k.name));

  for (const key of keys) {
    const value = payload[key.name];
    const path = pathPrefix ? `${pathPrefix}.${key.name}` : key.name;
    if (key.required && value === undefined) {
      issues.push({ severity: "error", path, message: `${path} is required.` });
      continue;
    }
    if (value === undefined) continue;
    validateValueAgainstKey(key, value, path, issues);
  }

  for (const key of Object.keys(payload)) {
    if (!knownKeys.has(key) && !key.startsWith("Payload")) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      issues.push({ severity: "warning", path, message: `${path} is not in the local Apple schema cache.` });
    }
  }
}

function validateValueAgainstKey(
  key: AppleSchemaKey,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!typeMatches(value, key.type)) {
    issues.push({ severity: "error", path, message: `${path} must be ${key.type}.` });
    return;
  }
  if (key.enumValues && !key.enumValues.includes(String(value))) {
    issues.push({
      severity: "error",
      path,
      message: `${path} must be one of: ${key.enumValues.join(", ")}.`,
    });
  }
    if (key.childKeys && typeof value === "object" && value !== null && !Array.isArray(value)) {
      validateKeys(key.childKeys, value as Record<string, unknown>, path, issues);
    }
    if (key.itemKeys && Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (key.itemKeys?.length === 1) {
          const only = key.itemKeys[0];
          if (only.type === "dictionary" && only.childKeys && typeof item === "object" && item !== null && !Array.isArray(item)) {
            validateKeys(only.childKeys, item as Record<string, unknown>, itemPath, issues);
            return;
          }
          if (only.type !== "dictionary" && only.type !== "object") {
            validateValueAgainstKey(only, item, itemPath, issues);
            return;
          }
        }
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          issues.push({ severity: "error", path: itemPath, message: `${itemPath} must be dictionary.` });
          return;
        }
        validateKeys(key.itemKeys ?? [], item as Record<string, unknown>, itemPath, issues);
      });
    }
}

function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error("payload must be valid JSON when provided as a string.");
    }
  }
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  throw new Error("payload must be an object or a JSON object string.");
}

export function validateApplePayload(args: {
  identifier: unknown;
  kind?: unknown;
  payload: unknown;
}): { valid: boolean; schema: AppleDeviceSchema; issues: ValidationIssue[] } {
  const schema = getAppleSchema(args.identifier, args.kind);
  const payload = parsePayload(args.payload);
  const issues: ValidationIssue[] = [];
  validateKeys(schema.keys, payload, "", issues);
  validateSemanticRules(schema.identifier, payload, issues);

  return { valid: !issues.some(i => i.severity === "error"), schema, issues };
}

function validateSemanticRules(identifier: string, payload: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (identifier === "com.apple.wifi.managed") validateWifiSemantics(payload, issues);
  if (identifier === "com.apple.configuration.safari.bookmarks") validateSafariBookmarkSemantics(payload, issues);
  if (identifier === "com.apple.security.scep") validateScepSemantics(payload, issues);
  if (identifier === "com.apple.security.root") validateCertificateSemantics(payload, issues);
}

function validateWifiSemantics(payload: Record<string, unknown>, issues: ValidationIssue[]): void {
  const encryption = typeof payload.EncryptionType === "string" ? payload.EncryptionType : undefined;
  const hasPassword = typeof payload.Password === "string" && payload.Password.length > 0;
  const hasCert = typeof payload.PayloadCertificateUUID === "string" && payload.PayloadCertificateUUID.length > 0;
  const eap = payload.EAPClientConfiguration;
  const hasEap = typeof eap === "object" && eap !== null && !Array.isArray(eap);
  if (encryption && encryption !== "None" && !hasPassword && !hasCert && !hasEap) {
    issues.push({ severity: "warning", path: "EncryptionType", message: "Encrypted Wi-Fi payload has no Password, PayloadCertificateUUID, or EAPClientConfiguration." });
  }
  if (hasEap) {
    const eapConfig = eap as Record<string, unknown>;
    if (!Array.isArray(eapConfig.AcceptEAPTypes) || eapConfig.AcceptEAPTypes.length === 0) {
      issues.push({ severity: "error", path: "EAPClientConfiguration.AcceptEAPTypes", message: "Enterprise Wi-Fi requires a non-empty AcceptEAPTypes array." });
    }
  }
}

function validateSafariBookmarkSemantics(payload: Record<string, unknown>, issues: ValidationIssue[]): void {
  const groups = payload.ManagedBookmarks;
  if (!Array.isArray(groups)) return;
  groups.forEach((group, groupIndex) => {
    if (typeof group !== "object" || group === null || Array.isArray(group)) return;
    const bookmarks = (group as Record<string, unknown>).Bookmarks;
    if (Array.isArray(bookmarks)) validateBookmarkItems(bookmarks, `ManagedBookmarks[${groupIndex}].Bookmarks`, issues);
  });
}

function validateBookmarkItems(items: unknown[], path: string, issues: ValidationIssue[]): void {
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({ severity: "error", path: itemPath, message: `${itemPath} must be dictionary.` });
      return;
    }
    const record = item as Record<string, unknown>;
    const hasUrl = typeof record.URL === "string" && record.URL.trim() !== "";
    const hasFolder = Array.isArray(record.Folder);
    if (hasUrl === hasFolder) {
      issues.push({ severity: "error", path: itemPath, message: "Bookmark item must include exactly one of URL or Folder." });
    }
    if (hasFolder) validateBookmarkItems(record.Folder as unknown[], `${itemPath}.Folder`, issues);
  });
}

function validateScepSemantics(payload: Record<string, unknown>, issues: ValidationIssue[]): void {
  const content = typeof payload.PayloadContent === "object" && payload.PayloadContent !== null && !Array.isArray(payload.PayloadContent)
    ? payload.PayloadContent as Record<string, unknown>
    : payload;
  const url = content.URL;
  if (typeof url === "string" && !/^https:\/\//i.test(url)) {
    const path = content === payload ? "URL" : "PayloadContent.URL";
    issues.push({ severity: "error", path, message: "SCEP URL must use HTTPS." });
  }
}

function validateCertificateSemantics(payload: Record<string, unknown>, issues: ValidationIssue[]): void {
  const content = payload.PayloadContent;
  if (typeof content === "string" && content.trim().length < 32) {
    issues.push({ severity: "warning", path: "PayloadContent", message: "Certificate payload content looks unusually short." });
  }
}

function xmlEscape(value: unknown): string {
  return String(value)
    // Characters illegal in XML 1.0 (C0 controls except tab/LF/CR) cannot be
    // escaped — a plist containing them is unparseable. Strip them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

// Marker for schema-declared `data` values (base64 strings) so plistValue can
// emit <data> where Apple requires it — a cert body in <string> fails to install.
class PlistData {
  constructor(readonly base64: string) {}
}

// Walk a payload against its schema keys, wrapping data-typed string values
// (including inside childKeys dicts and itemKeys array elements) in PlistData.
function wrapDataValues(payload: Record<string, unknown>, keys: AppleSchemaKey[]): Record<string, unknown> {
  const byName = new Map(keys.map(k => [k.name, k]));
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(payload)) {
    const key = byName.get(name);
    if (!key || value == null) { out[name] = value; continue; }
    if (key.type === "data" && typeof value === "string") { out[name] = new PlistData(value); continue; }
    if (key.childKeys && typeof value === "object" && !Array.isArray(value)) {
      out[name] = wrapDataValues(value as Record<string, unknown>, key.childKeys);
      continue;
    }
    if (key.itemKeys && Array.isArray(value)) {
      out[name] = value.map(v =>
        typeof v === "object" && v !== null && !Array.isArray(v)
          ? wrapDataValues(v as Record<string, unknown>, key.itemKeys!)
          : v);
      continue;
    }
    out[name] = value;
  }
  return out;
}

function plistValue(value: unknown, level = 0): string {
  if (value instanceof PlistData) return `${indent(level)}<data>${value.base64.replace(/\s+/g, "")}</data>`;
  if (typeof value === "string") return `${indent(level)}<string>${xmlEscape(value)}</string>`;
  if (typeof value === "boolean") return `${indent(level)}${value ? "<true/>" : "<false/>"}`;
  // Integers beyond safe range stringify in exponent notation, which is invalid
  // inside <integer>; emit them as <real> instead.
  if (typeof value === "number") return `${indent(level)}${Number.isSafeInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent(level)}<array/>`;
    return `${indent(level)}<array>\n${value.map(v => plistValue(v, level + 1)).join("\n")}\n${indent(level)}</array>`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${indent(level + 1)}<key>${xmlEscape(k)}</key>\n${plistValue(v, level + 1)}`);
    if (entries.length === 0) return `${indent(level)}<dict/>`;
    return `${indent(level)}<dict>\n${entries.join("\n")}\n${indent(level)}</dict>`;
  }
  return `${indent(level)}<string></string>`;
}

export function buildMobileconfig(args: {
  display_name: unknown;
  identifier: unknown;
  organization?: unknown;
  description?: unknown;
  payloads: unknown;
  scope?: unknown;
}): { mobileconfig: string; validation: Array<{ payload_index: number; identifier: string; issues: ValidationIssue[] }> } {
  if (typeof args.display_name !== "string" || args.display_name.trim() === "") throw new Error("display_name is required.");
  if (typeof args.identifier !== "string" || args.identifier.trim() === "") throw new Error("identifier is required.");
  if (!Array.isArray(args.payloads) || args.payloads.length === 0) throw new Error("payloads must be a non-empty array.");

  const validation = args.payloads.map((raw, index) => {
    const payload = parsePayload(raw);
    const payloadType = payload.PayloadType;
    if (typeof payloadType !== "string" || payloadType.trim() === "") {
      return {
        payload_index: index,
        identifier: "",
        issues: [{ severity: "error" as const, path: "PayloadType", message: "PayloadType is required." }],
      };
    }
    const result = validateApplePayload({ identifier: payloadType, kind: "profile", payload });
    return { payload_index: index, identifier: payloadType, issues: result.issues };
  });
  const errors = validation.flatMap(v => v.issues.filter(i => i.severity === "error"));
  if (errors.length) throw new Error(`mobileconfig payload validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join("; ")}`);

  const profile = {
    PayloadDisplayName: args.display_name,
    PayloadIdentifier: args.identifier,
    PayloadOrganization: typeof args.organization === "string" ? args.organization : undefined,
    PayloadDescription: typeof args.description === "string" ? args.description : undefined,
    PayloadType: "Configuration",
    PayloadUUID: randomUUID(),
    PayloadVersion: 1,
    PayloadScope: args.scope === "User" ? "User" : "System",
    PayloadContent: args.payloads.map(raw => {
      const payload = parsePayload(raw);
      // Wrap schema-declared data values so they render as <data>; validation
      // above guarantees the PayloadType has a schema, but stay defensive.
      const schema = SCHEMAS.find(s => s.kind === "profile" && s.identifier === payload.PayloadType);
      const wrapped = schema ? wrapDataValues(payload, schema.keys) : payload;
      return {
        PayloadIdentifier: `${args.identifier}.${String(payload.PayloadType).replace(/^com\.apple\./, "")}`,
        PayloadUUID: randomUUID(),
        PayloadVersion: 1,
        PayloadDisplayName: String(payload.PayloadType),
        ...wrapped,
      };
    }),
  };

  return {
    validation,
    mobileconfig:
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0">\n${plistValue(profile, 1)}\n</plist>\n`,
  };
}

export function buildCustomDeclarationPayload(args: {
  declaration_type: unknown;
  identifier: unknown;
  server_token?: unknown;
  payload: unknown;
}): {
  declaration_type: string;
  simplemdm_payload: string;
  declaration: string;
  validation: ReturnType<typeof validateApplePayload>;
} {
  if (typeof args.declaration_type !== "string" || args.declaration_type.trim() === "") throw new Error("declaration_type is required.");
  if (typeof args.identifier !== "string" || args.identifier.trim() === "") throw new Error("identifier is required.");
  const payload = parsePayload(args.payload);
  const validation = validateApplePayload({ identifier: args.declaration_type, kind: "declaration", payload });
  if (!validation.valid) {
    throw new Error(`declaration payload validation failed: ${validation.issues.filter(i => i.severity === "error").map(i => `${i.path}: ${i.message}`).join("; ")}`);
  }
  const declaration: Record<string, unknown> = {
    Type: args.declaration_type,
    Identifier: args.identifier,
    Payload: payload,
  };
  if (typeof args.server_token === "string" && args.server_token.trim() !== "") {
    declaration.ServerToken = args.server_token;
  }
  return {
    declaration_type: args.declaration_type,
    simplemdm_payload: JSON.stringify(payload, null, 2),
    declaration: JSON.stringify(declaration, null, 2),
    validation,
  };
}

export function buildWifiProfilePayload(args: {
  ssid: unknown;
  encryption_type?: unknown;
  password?: unknown;
  auto_join?: unknown;
  hidden_network?: unknown;
  eap_client_configuration?: unknown;
  proxy_type?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.ssid !== "string" || args.ssid.trim() === "") throw new Error("ssid is required.");
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.wifi.managed",
    SSID_STR: args.ssid,
    EncryptionType: typeof args.encryption_type === "string" ? args.encryption_type : "WPA2",
    AutoJoin: typeof args.auto_join === "boolean" ? args.auto_join : true,
    HiddenNetwork: typeof args.hidden_network === "boolean" ? args.hidden_network : undefined,
    Password: typeof args.password === "string" ? args.password : undefined,
    EAPClientConfiguration: typeof args.eap_client_configuration === "object" && args.eap_client_configuration !== null
      ? args.eap_client_configuration
      : undefined,
    ProxyType: typeof args.proxy_type === "string" ? args.proxy_type : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.wifi.managed", kind: "profile", payload });
  return { payload, validation };
}

export function buildFirewallProfilePayload(args: {
  enable_firewall?: unknown;
  block_all_incoming?: unknown;
  enable_stealth_mode?: unknown;
  applications?: unknown;
} = {}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.security.firewall",
    EnableFirewall: typeof args.enable_firewall === "boolean" ? args.enable_firewall : true,
    BlockAllIncoming: typeof args.block_all_incoming === "boolean" ? args.block_all_incoming : undefined,
    EnableStealthMode: typeof args.enable_stealth_mode === "boolean" ? args.enable_stealth_mode : true,
    Applications: Array.isArray(args.applications) ? args.applications : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.security.firewall", kind: "profile", payload });
  return { payload, validation };
}

export function buildPasscodeProfilePayload(args: {
  force_pin?: unknown;
  min_length?: unknown;
  min_complex_chars?: unknown;
  max_failed_attempts?: unknown;
  max_inactivity?: unknown;
  allow_simple?: unknown;
} = {}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.mobiledevice.passwordpolicy",
    forcePIN: typeof args.force_pin === "boolean" ? args.force_pin : true,
    minLength: typeof args.min_length === "number" ? args.min_length : undefined,
    minComplexChars: typeof args.min_complex_chars === "number" ? args.min_complex_chars : undefined,
    maxFailedAttempts: typeof args.max_failed_attempts === "number" ? args.max_failed_attempts : undefined,
    maxInactivity: typeof args.max_inactivity === "number" ? args.max_inactivity : undefined,
    allowSimple: typeof args.allow_simple === "boolean" ? args.allow_simple : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.mobiledevice.passwordpolicy", kind: "profile", payload });
  return { payload, validation };
}

export function buildSoftwareUpdateSettingsDeclaration(args: {
  identifier: unknown;
  automatic_actions?: unknown;
  deferrals?: unknown;
  rapid_security_response?: unknown;
  beta?: unknown;
  server_token?: unknown;
}): ReturnType<typeof buildCustomDeclarationPayload> {
  const payload: Record<string, unknown> = {
    AutomaticActions: typeof args.automatic_actions === "object" && args.automatic_actions !== null ? args.automatic_actions : undefined,
    Deferrals: typeof args.deferrals === "object" && args.deferrals !== null ? args.deferrals : undefined,
    RapidSecurityResponse: typeof args.rapid_security_response === "object" && args.rapid_security_response !== null ? args.rapid_security_response : undefined,
    Beta: typeof args.beta === "object" && args.beta !== null ? args.beta : undefined,
  };
  return buildCustomDeclarationPayload({
    declaration_type: "com.apple.configuration.softwareupdate.settings",
    identifier: args.identifier,
    server_token: args.server_token,
    payload,
  });
}

export function buildRestrictionsProfilePayload(args: {
  allow_app_installation?: unknown;
  allow_camera?: unknown;
  allow_cloud_backup?: unknown;
  allow_diagnostic_submission?: unknown;
  allow_safari?: unknown;
} = {}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.applicationaccess",
    allowAppInstallation: typeof args.allow_app_installation === "boolean" ? args.allow_app_installation : undefined,
    allowCamera: typeof args.allow_camera === "boolean" ? args.allow_camera : undefined,
    allowCloudBackup: typeof args.allow_cloud_backup === "boolean" ? args.allow_cloud_backup : undefined,
    allowDiagnosticSubmission: typeof args.allow_diagnostic_submission === "boolean" ? args.allow_diagnostic_submission : undefined,
    allowSafari: typeof args.allow_safari === "boolean" ? args.allow_safari : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.applicationaccess", kind: "profile", payload });
  return { payload, validation };
}

export function buildScepProfilePayload(args: {
  url: unknown;
  name: unknown;
  challenge?: unknown;
  key_type?: unknown;
  key_size?: unknown;
  key_usage?: unknown;
  retries?: unknown;
  retry_delay?: unknown;
  subject?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.url !== "string" || args.url.trim() === "") throw new Error("url is required.");
  if (typeof args.name !== "string" || args.name.trim() === "") throw new Error("name is required.");
  const payloadContent: Record<string, unknown> = {
    URL: args.url,
    Name: args.name,
    Challenge: typeof args.challenge === "string" ? args.challenge : undefined,
    "Key Type": typeof args.key_type === "string" ? args.key_type : "RSA",
    Keysize: typeof args.key_size === "number" ? args.key_size : undefined,
    "Key Usage": typeof args.key_usage === "number" ? args.key_usage : undefined,
    Retries: typeof args.retries === "number" ? args.retries : undefined,
    RetryDelay: typeof args.retry_delay === "number" ? args.retry_delay : undefined,
    Subject: Array.isArray(args.subject) ? args.subject : undefined,
  };
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.security.scep",
    PayloadContent: payloadContent,
  };
  const validation = validateApplePayload({ identifier: "com.apple.security.scep", kind: "profile", payload });
  return { payload, validation };
}

export function buildCertificateProfilePayload(args: {
  payload_content: unknown;
  certificate_file_name?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.payload_content !== "string" || args.payload_content.trim() === "") throw new Error("payload_content is required.");
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.security.root",
    PayloadContent: args.payload_content,
    PayloadCertificateFileName: typeof args.certificate_file_name === "string" ? args.certificate_file_name : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.security.root", kind: "profile", payload });
  return { payload, validation };
}

export function buildVpnProfilePayload(args: {
  user_defined_name: unknown;
  vpn_type: unknown;
  vpn_sub_type?: unknown;
  vpn?: unknown;
  ikev2?: unknown;
  ipsec?: unknown;
  on_demand_enabled?: unknown;
  on_demand_rules?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.user_defined_name !== "string" || args.user_defined_name.trim() === "") throw new Error("user_defined_name is required.");
  if (typeof args.vpn_type !== "string" || args.vpn_type.trim() === "") throw new Error("vpn_type is required.");
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.vpn.managed",
    UserDefinedName: args.user_defined_name,
    VPNType: args.vpn_type,
    VPNSubType: typeof args.vpn_sub_type === "string" ? args.vpn_sub_type : undefined,
    VPN: typeof args.vpn === "object" && args.vpn !== null ? args.vpn : undefined,
    IKEv2: typeof args.ikev2 === "object" && args.ikev2 !== null ? args.ikev2 : undefined,
    IPSec: typeof args.ipsec === "object" && args.ipsec !== null ? args.ipsec : undefined,
    OnDemandEnabled: typeof args.on_demand_enabled === "boolean" ? (args.on_demand_enabled ? 1 : 0) : undefined,
    OnDemandRules: Array.isArray(args.on_demand_rules) ? args.on_demand_rules : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.vpn.managed", kind: "profile", payload });
  return { payload, validation };
}

export function buildWebClipProfilePayload(args: {
  label: unknown;
  url: unknown;
  is_removable?: unknown;
  full_screen?: unknown;
  icon?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.label !== "string" || args.label.trim() === "") throw new Error("label is required.");
  if (typeof args.url !== "string" || args.url.trim() === "") throw new Error("url is required.");
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.webClip.managed",
    Label: args.label,
    URL: args.url,
    IsRemovable: typeof args.is_removable === "boolean" ? args.is_removable : undefined,
    FullScreen: typeof args.full_screen === "boolean" ? args.full_screen : undefined,
    Icon: typeof args.icon === "string" ? args.icon : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.webClip.managed", kind: "profile", payload });
  return { payload, validation };
}

export function buildContentFilterProfilePayload(args: {
  filter_type?: unknown;
  auto_filter_enabled?: unknown;
  permitted_urls?: unknown;
  blacklisted_urls?: unknown;
  whitelisted_bookmarks?: unknown;
  plugin_bundle_id?: unknown;
  server_address?: unknown;
} = {}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.webcontent-filter",
    FilterType: typeof args.filter_type === "string" ? args.filter_type : "BuiltIn",
    AutoFilterEnabled: typeof args.auto_filter_enabled === "boolean" ? args.auto_filter_enabled : undefined,
    PermittedURLs: Array.isArray(args.permitted_urls) ? args.permitted_urls : undefined,
    BlacklistedURLs: Array.isArray(args.blacklisted_urls) ? args.blacklisted_urls : undefined,
    WhitelistedBookmarks: Array.isArray(args.whitelisted_bookmarks) ? args.whitelisted_bookmarks : undefined,
    PluginBundleID: typeof args.plugin_bundle_id === "string" ? args.plugin_bundle_id : undefined,
    ServerAddress: typeof args.server_address === "string" ? args.server_address : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.webcontent-filter", kind: "profile", payload });
  return { payload, validation };
}

export function buildFileVaultEscrowProfilePayload(args: {
  encrypt_cert_payload_uuid: unknown;
  location?: unknown;
  device_key?: unknown;
}): { payload: Record<string, unknown>; validation: ReturnType<typeof validateApplePayload> } {
  if (typeof args.encrypt_cert_payload_uuid !== "string" || args.encrypt_cert_payload_uuid.trim() === "") throw new Error("encrypt_cert_payload_uuid is required.");
  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.security.FDERecoveryKeyEscrow",
    EncryptCertPayloadUUID: args.encrypt_cert_payload_uuid,
    Location: typeof args.location === "string" ? args.location : undefined,
    DeviceKey: typeof args.device_key === "string" ? args.device_key : undefined,
  };
  const validation = validateApplePayload({ identifier: "com.apple.security.FDERecoveryKeyEscrow", kind: "profile", payload });
  return { payload, validation };
}
