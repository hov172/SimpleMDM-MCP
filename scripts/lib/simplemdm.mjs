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

function flatten(d) {
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

export async function fetchAllDevices(apiKey) {
  if (!apiKey) throw new Error("Missing SIMPLEMDM_API_KEY");
  const all = [];
  let after;
  for (;;) {
    const page = await getPage(apiKey, after);
    const data = page.data ?? [];
    all.push(...data.map(flatten));
    if (!page.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return all;
}
