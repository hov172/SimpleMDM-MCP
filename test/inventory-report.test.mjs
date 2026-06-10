import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAssignmentGroupsRaw, fetchAppCatalog } from "../scripts/lib/simplemdm.mjs";

test("new fetchers reject a missing apiKey before any network call", async () => {
  await assert.rejects(() => fetchAssignmentGroupsRaw(null), /Missing SIMPLEMDM_API_KEY/);
  await assert.rejects(() => fetchAppCatalog(null), /Missing SIMPLEMDM_API_KEY/);
});
