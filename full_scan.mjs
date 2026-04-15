const KEY = process.env.SIMPLEMDM_API_KEY;
const auth = 'Basic ' + Buffer.from(KEY + ':').toString('base64');
const BASE = 'https://a.simplemdm.com/api/v1';
async function get(p) {
  const r = await fetch(BASE + p, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error(p + ' ' + r.status);
  return r.json();
}
async function all(path) {
  const out = [];
  let cursor;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const q = `${sep}limit=100${cursor ? '&starting_after=' + cursor : ''}`;
    const p = await get(path + q);
    out.push(...(p.data || []));
    if (!p.has_more) return out;
    cursor = (p.data.at(-1) || {}).id;
    if (cursor == null) return out;
  }
}

const [apps, ag, dg, profiles, ccp, cd] = await Promise.all([
  all('/apps'),
  all('/assignment_groups'),
  all('/device_groups'),
  all('/profiles'),
  all('/custom_configuration_profiles'),
  all('/custom_declarations'),
]);

console.log('APPS:', apps.length);
const types = {};
for (const a of apps) { const t = a.attributes?.app_type || 'unknown'; types[t] = (types[t] || 0) + 1; }
console.log('  by type:', types);

console.log('\nASSIGNMENT GROUPS:', ag.length);
let appsAssigned = 0, devicesScoped = 0, profilesAssigned = 0;
for (const g of ag) {
  appsAssigned += g.relationships?.apps?.data?.length || 0;
  devicesScoped += g.relationships?.devices?.data?.length || 0;
  profilesAssigned += g.relationships?.profiles?.data?.length || 0;
}
console.log(`  total app assignments: ${appsAssigned}`);
console.log(`  total device scopings: ${devicesScoped}`);
console.log(`  total profile assignments via groups: ${profilesAssigned}`);

console.log('\nDEVICE GROUPS (legacy):', dg.length);
const dgWith = dg.filter(g => (g.relationships?.devices?.data?.length || 0) > 0).length;
console.log(`  groups with members: ${dgWith} / ${dg.length}`);

console.log('\nLIVE PROFILES:', profiles.length);
console.log('CUSTOM CONFIG PROFILES (.mobileconfig):', ccp.length);
console.log('CUSTOM DECLARATIONS (DDM):', cd.length);

console.log('\n─ Top assignment groups by membership ─');
const topAG = ag.slice().sort((a,b) => (b.relationships?.devices?.data?.length || 0) - (a.relationships?.devices?.data?.length || 0)).slice(0, 10);
for (const g of topAG) {
  console.log(`  ${(g.relationships?.devices?.data?.length || 0).toString().padStart(4)} devices · ${(g.relationships?.apps?.data?.length || 0).toString().padStart(2)} apps  #${g.id} ${g.attributes?.name}`);
}
