import { readFileSync } from 'node:fs';
const lines = readFileSync('mcp.log', 'utf8').trim().split('\n');
const byId = {};
for (const l of lines) {
  try { const m = JSON.parse(l); if (m.id) byId[m.id] = m; } catch {}
}
function payload(id) {
  const m = byId[id];
  if (!m) return null;
  const t = m.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}
const apps = payload(2);
const ag = payload(3);
const dg = payload(4);
console.log('APPS total entries:', apps?.data?.length, 'has_more:', apps?.has_more);
if (apps?.data) {
  const tally = {};
  for (const a of apps.data) {
    const k = a.attributes?.app_type || 'unknown';
    tally[k] = (tally[k] || 0) + 1;
  }
  console.log(' by type:', tally);
  console.log(' first 10:');
  for (const a of apps.data.slice(0, 10)) console.log('  ', a.id, a.attributes?.name, '['+(a.attributes?.bundle_identifier||a.attributes?.app_type)+']');
}

console.log('\nASSIGNMENT GROUPS total:', ag?.data?.length);
if (ag?.data) {
  console.log(' groups:');
  for (const g of ag.data) {
    const r = g.relationships || {};
    console.log(`  #${g.id}  ${g.attributes?.name}  (apps=${r.apps?.data?.length ?? 0}, profiles=${r.profiles?.data?.length ?? 0}, devices=${r.devices?.data?.length ?? 0}, type=${g.attributes?.group_type||'static'}, auto_deploy=${g.attributes?.auto_deploy})`);
  }
}

console.log('\nDEVICE GROUPS total:', dg?.data?.length);
if (dg?.data) {
  for (const g of dg.data) console.log('  #'+g.id, g.attributes?.name, '(devices='+(g.relationships?.devices?.data?.length ?? '?')+')');
}
