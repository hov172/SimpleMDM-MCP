const BASE = "https://a.simplemdm.com/api/v1";

function authHeader(apiKey) {
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function getPage(apiKey, startingAfter) {
  const url = new URL(`${BASE}/devices`);
  url.searchParams.set("limit", "100");
  if (startingAfter) url.searchParams.set("starting_after", String(startingAfter));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: authHeader(apiKey) } });
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(2 ** attempt * 1000, 16000);
      console.warn(`429 rate-limited, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401) throw new Error("SimpleMDM auth failed (401) — check SIMPLEMDM_API_KEY");
    if (!res.ok) throw new Error(`SimpleMDM /devices failed ${res.status}`);
    return res.json();
  }
}

export function flatten(d) {
  const a = d.attributes ?? {};
  const cav = {};
  for (const c of d.relationships?.custom_attribute_values?.data ?? []) {
    cav[c.id] = c.attributes?.value ?? null;
  }
  return {
    id: d.id,
    name: a.name,
    device_name: a.device_name,
    serial: a.serial_number,
    model: a.product_name || a.model,
    osVersion: a.os_version,
    filevault_enabled: a.filevault_enabled,
    firewall_enabled: a.firewall?.enabled ?? null,
    sip_enabled: a.system_integrity_protection_enabled ?? null,
    last_seen_at: a.last_seen_at,
    xprotect_version: cav.xprotect_version ?? null,
    device_group_id: d.relationships?.device_group?.data?.id ?? null,
  };
}

// id -> name map of all device groups.
export async function fetchDeviceGroups(apiKey) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  const map = new Map();
  let after;
  for (;;) {
    const url = new URL(`${BASE}/device_groups`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("starting_after", String(after));
    const res = await fetch(url, { headers: { Authorization: authHeader(apiKey) } });
    if (!res.ok) throw new Error(`SimpleMDM /device_groups failed ${res.status}`);
    const page = await res.json();
    const data = page.data ?? [];
    for (const g of data) map.set(g.id, g.attributes?.name ?? String(g.id));
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return map;
}

export async function fetchAllDevicesRaw(apiKey) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  const all = [];
  let after;
  for (;;) {
    const page = await getPage(apiKey, after);
    const data = page.data ?? [];
    all.push(...data);
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}

export async function fetchAllDevices(apiKey) {
  return (await fetchAllDevicesRaw(apiKey)).map(flatten);
}

async function getJson(apiKey, path) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader(apiKey) } });
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(2 ** attempt * 1000, 16000);
      console.warn(`429 on ${path}, retrying in ${wait}ms (attempt ${attempt + 1}/5)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401) throw new Error("SimpleMDM auth failed (401) — check SIMPLEMDM_API_KEY");
    if (!res.ok) throw new Error(`SimpleMDM ${path} failed ${res.status}`);
    return res.json();
  }
}

// Fully paginated collection GET for an arbitrary endpoint, cursor on last id.
async function getAll(apiKey, base) {
  const all = [];
  let after;
  for (;;) {
    const sep = base.includes("?") ? "&" : "?";
    const page = await getJson(apiKey, `${base}${sep}limit=100${after ? `&starting_after=${after}` : ""}`);
    const data = page.data ?? [];
    all.push(...data);
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}

export async function fetchDeviceLogs(apiKey, serial) {
  return getAll(apiKey, `/logs?serial_number=${encodeURIComponent(serial)}`);
}
export async function fetchDeviceApps(apiKey, id) { return getAll(apiKey, `/devices/${id}/installed_apps`); }
export async function fetchDeviceProfiles(apiKey, id) { return getAll(apiKey, `/devices/${id}/profiles`); }
export async function fetchDeviceUsers(apiKey, id) { return getAll(apiKey, `/devices/${id}/users`); }

// id -> name map of all assignment groups (for resolving relationships.groups).
export async function fetchAssignmentGroups(apiKey) {
  const map = new Map();
  for (const g of await getAll(apiKey, `/assignment_groups`)) map.set(g.id, g.attributes?.name ?? String(g.id));
  return map;
}

// Raw assignment-group records (with relationships.apps) — fetchAssignmentGroups only maps names.
export async function fetchAssignmentGroupsRaw(apiKey) {
  return getAll(apiKey, `/assignment_groups`);
}

// id -> name map of the account app catalog (assignment-group app ids point here).
export async function fetchAppCatalog(apiKey) {
  const map = new Map();
  for (const a of await getAll(apiKey, `/apps`)) map.set(a.id, a.attributes?.name ?? String(a.id));
  return map;
}

// Raw account profile records (with relationships.device_groups / groups /
// devices — profiles are assigned via device groups, assignment groups, or
// directly to devices).
export async function fetchProfilesRaw(apiKey) {
  return getAll(apiKey, `/profiles`);
}

// Account name + license counts: { name, total, available }.
export async function fetchAccount(apiKey) {
  const j = await getJson(apiKey, `/account`);
  const a = j.data?.attributes ?? {};
  return { name: a.name ?? "", total: a.subscription?.licenses?.total ?? null, available: a.subscription?.licenses?.available ?? null };
}
