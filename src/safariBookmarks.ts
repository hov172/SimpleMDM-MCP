// src/safariBookmarks.ts
// Pure helpers for the create_safari_bookmarks_declaration tool. Kept separate
// from index.ts so tests can import without booting the MCP server (same pattern
// as wipe.ts).
//
// Builds the payload for Apple's Declarative Device Management (DDM) configuration
// `com.apple.configuration.safari.bookmarks`. Schema is taken verbatim from
// Apple's published device-management schema:
//   declarative/declarations/configurations/safari.bookmarks.yaml
// Availability: iOS 26+, macOS 26+, visionOS 26+ (supervised / device enrollment).
//
// Schema shape (array elements ARE the dictionaries; the YAML "BookmarkGroup" /
// "bookmarks-item" names are element type labels, not literal wrapping keys):
//   ManagedBookmarks: [ { GroupIdentifier, Title, Bookmarks: [ item, ... ] } ]
//   item:             { Title, URL }            -- a bookmark, OR
//                     { Title, Folder: [ item ] } -- a nested folder (recursive)
// Each item must have exactly one of URL or Folder.

export const SAFARI_BOOKMARKS_DECLARATION_TYPE = "com.apple.configuration.safari.bookmarks";

export interface BookmarkInput {
  title: string;
  url?: string;
  folder?: BookmarkInput[];
}

// Recursively map the caller's simple bookmark tree into Apple's bookmarks-item
// dictionaries. Throws a clear, path-qualified error on any malformed item.
function buildItems(items: unknown, path: string): Array<Record<string, unknown>> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${path}: must be a non-empty array of bookmarks.`);
  }
  return items.map((raw, i) => {
    const where = `${path}[${i}]`;
    const b = raw as BookmarkInput;
    if (!b || typeof b.title !== "string" || b.title.trim() === "") {
      throw new Error(`${where}: each bookmark requires a non-empty "title".`);
    }
    const hasUrl = typeof b.url === "string" && b.url.trim() !== "";
    const hasFolder = Array.isArray(b.folder);
    if (hasUrl === hasFolder) {
      throw new Error(`${where} ("${b.title}"): provide exactly one of "url" or "folder".`);
    }
    if (hasUrl) {
      return { Title: b.title, URL: b.url };
    }
    return { Title: b.title, Folder: buildItems(b.folder, `${where}.folder`) };
  });
}

// Derive a stable GroupIdentifier from the folder title when the caller does not
// supply one. Safari merges groups that share a GroupIdentifier across active
// configurations, so a deterministic, title-derived id is a sensible default.
function deriveGroupIdentifier(groupTitle: string): string {
  const slug = groupTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `simplemdm-mcp.${slug || "bookmarks"}`;
}

export function buildSafariBookmarksPayload(args: {
  group_title: unknown;
  bookmarks: unknown;
  group_identifier?: unknown;
}): Record<string, unknown> {
  if (typeof args.group_title !== "string" || args.group_title.trim() === "") {
    throw new Error('group_title is required (the bookmarks folder name shown in Safari).');
  }
  const groupId =
    typeof args.group_identifier === "string" && args.group_identifier.trim() !== ""
      ? args.group_identifier
      : deriveGroupIdentifier(args.group_title);

  return {
    ManagedBookmarks: [
      {
        GroupIdentifier: groupId,
        Title: args.group_title,
        Bookmarks: buildItems(args.bookmarks, "bookmarks"),
      },
    ],
  };
}
