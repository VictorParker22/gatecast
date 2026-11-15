// Live-data proxies shared by server.js (local) and api/*.js (Vercel functions).
// Tiny in-memory cache so many visitors share one upstream request.
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}
async function upstream(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'gatecast/1.0' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res;
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() || '';

// FAA airport status XML -> { updated, airports: { ORD: [{ type, detail }] } }.
function parseFaa(xml) {
  const airports = {};
  for (const block of xml.split('<Delay_type>').slice(1)) {
    const type = tag(block, 'Name').replace(/s$/, '');
    // Closure rows are raw NOTAMs (night curfews, private-traffic limits) and read as false alarms.
    if (/closure/i.test(type)) continue;
    for (const m of block.matchAll(/<(Airport|Ground_Delay|Program|Delay|Ground_Stop)>([\s\S]*?)<\/\1>/g)) {
      const item = m[2];
      const code = tag(item, 'ARPT');
      if (!code) continue;
      const reason = tag(item, 'Reason');
      const bits = [];
      const avg = tag(item, 'Avg') || [tag(item, 'Min'), tag(item, 'Max')].filter(Boolean).join(' to ');
      if (avg) bits.push(`delays ${avg}`);
      if (reason && !reason.startsWith('!')) bits.push(reason);
      const end = tag(item, 'Reopen') || tag(item, 'End_Time');
      if (end) bits.push(`until ${end.replace(/\.$/, '')}`);
      (airports[code] ||= []).push({ type, detail: bits.join(', ') });
    }
  }
  return { updated: tag(xml, 'Update_Time'), airports };
}

const api = {
  '/api/health': async () => ({ ok: true }),
  '/api/metar': async (q) => {
    const ids = (q.get('ids') || '').toUpperCase().split(',').filter((x) => /^[A-Z0-9]{4}$/.test(x)).slice(0, 6);
    if (!ids.length) return [];
    return cached('metar:' + ids.join(), 5 * 60e3, async () =>
      (await upstream(`https://aviationweather.gov/api/data/metar?ids=${ids.join(',')}&format=json`)).json());
  },
  '/api/faa': async () => cached('faa', 2 * 60e3, async () =>
    parseFaa(await (await upstream('https://nasstatus.faa.gov/api/airport-status-information')).text())),
};


module.exports = { api, parseFaa };
