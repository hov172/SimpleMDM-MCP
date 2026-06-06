import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSafariBookmarksPayload,
  SAFARI_BOOKMARKS_DECLARATION_TYPE,
} from "../dist/safariBookmarks.js";

test("declaration type matches Apple's identifier", () => {
  assert.equal(SAFARI_BOOKMARKS_DECLARATION_TYPE, "com.apple.configuration.safari.bookmarks");
});

test("flat bookmarks produce ManagedBookmarks group with URL items", () => {
  const payload = buildSafariBookmarksPayload({
    group_title: "Company Links",
    bookmarks: [
      { title: "Intranet", url: "https://intra.example.com" },
      { title: "Helpdesk", url: "https://help.example.com" },
    ],
  });
  assert.deepEqual(payload, {
    ManagedBookmarks: [
      {
        GroupIdentifier: "simplemdm-mcp.company-links",
        Title: "Company Links",
        Bookmarks: [
          { Title: "Intranet", URL: "https://intra.example.com" },
          { Title: "Helpdesk", URL: "https://help.example.com" },
        ],
      },
    ],
  });
});

test("nested folder serializes recursively with Folder arrays", () => {
  const payload = buildSafariBookmarksPayload({
    group_title: "Work",
    bookmarks: [
      { title: "Tools", folder: [
        { title: "CI", url: "https://ci.example.com" },
        { title: "Deeper", folder: [{ title: "Wiki", url: "https://wiki.example.com" }] },
      ]},
    ],
  });
  const group = payload.ManagedBookmarks[0];
  assert.equal(group.Bookmarks[0].Title, "Tools");
  assert.equal(group.Bookmarks[0].Folder[0].URL, "https://ci.example.com");
  assert.equal(group.Bookmarks[0].Folder[1].Folder[0].URL, "https://wiki.example.com");
  // A folder item must not carry a URL key.
  assert.equal("URL" in group.Bookmarks[0], false);
});

test("explicit group_identifier is honored", () => {
  const payload = buildSafariBookmarksPayload({
    group_title: "Links",
    group_identifier: "com.acme.shared",
    bookmarks: [{ title: "A", url: "https://a.example.com" }],
  });
  assert.equal(payload.ManagedBookmarks[0].GroupIdentifier, "com.acme.shared");
});

test("missing group_title throws", () => {
  assert.throws(
    () => buildSafariBookmarksPayload({ group_title: "  ", bookmarks: [{ title: "A", url: "https://a" }] }),
    /group_title/,
  );
});

test("empty bookmarks array throws", () => {
  assert.throws(
    () => buildSafariBookmarksPayload({ group_title: "G", bookmarks: [] }),
    /non-empty array/,
  );
});

test("bookmark with neither url nor folder throws", () => {
  assert.throws(
    () => buildSafariBookmarksPayload({ group_title: "G", bookmarks: [{ title: "X" }] }),
    /exactly one of "url" or "folder"/,
  );
});

test("bookmark with BOTH url and folder throws", () => {
  assert.throws(
    () => buildSafariBookmarksPayload({
      group_title: "G",
      bookmarks: [{ title: "X", url: "https://x", folder: [{ title: "Y", url: "https://y" }] }],
    }),
    /exactly one of "url" or "folder"/,
  );
});

test("bookmark missing title throws with path", () => {
  assert.throws(
    () => buildSafariBookmarksPayload({ group_title: "G", bookmarks: [{ url: "https://x" }] }),
    /bookmarks\[0\]: each bookmark requires a non-empty "title"/,
  );
});
