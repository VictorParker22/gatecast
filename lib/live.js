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
  '/api/flight': async (q) => {
    const parsed = parseFlight(q.get('q'));
    if (!parsed) return { error: 'format' };
    return cached('flight:' + parsed.prefix + parsed.number, 15e3, () => lookupFlight(parsed));
  },
  '/api/near': async (q) => {
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return cached(`near:${lat.toFixed(2)},${lon.toFixed(2)}`, 20e3, async () => {
      const json = await (await upstream(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/40`)).json();
      return (json.ac || [])
        .filter((a) => a.flight && a.flight.trim() && /^[A-Z]{3}\d/.test(a.flight.trim()))
        .sort((a, b) => (a.alt_baro === 'ground') - (b.alt_baro === 'ground') || (a.dst ?? 99) - (b.dst ?? 99))
        .slice(0, 24)
        .map((a) => ({ callsign: a.flight.trim(), altFt: a.alt_baro === 'ground' ? 0 : a.alt_baro ?? null, onGround: a.alt_baro === 'ground', gsKt: a.gs ?? null, nm: a.dst ?? null, type: a.t || '' }));
    });
  },
};

// "UA 1", "ua1", "UAL1", "BA117" -> { prefix, number }. Two-character prefixes are airline (IATA) codes.
function parseFlight(raw) {
  const m = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/);
  return m ? { prefix: m[1], number: m[2].replace(/^0+(?=\d)/, '') } : null;
}

const pickAirport = (a) => (a ? { iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lon: a.longitude } : null);

// Route (adsbdb) and live position (adsb.lol) for one flight. Either half may be missing.
async function lookupFlight({ prefix, number }) {
  let airline = null;
  let icao = prefix;
  if (prefix.length === 2) {
    const res = await fetch(`https://api.adsbdb.com/v0/airline/${prefix}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    const list = res && res.ok ? (await res.json()).response : null;
    if (!Array.isArray(list) || !list.length) return { error: 'airline', prefix };
    airline = list[0];
    icao = airline.icao;
  }
  const callsign = icao + number;
  const [route, live] = await Promise.allSettled([
    fetch(`https://api.adsbdb.com/v0/callsign/${callsign}`, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)),
    upstream(`https://api.adsb.lol/v2/callsign/${callsign}`).then((r) => r.json()),
  ]);
  const fr = route.status === 'fulfilled' && route.value && route.value.response && route.value.response.flightroute;
  const ac = live.status === 'fulfilled' ? (live.value.ac || []).find((a) => a.lat != null) : null;
  if (fr && fr.airline) airline = fr.airline;
  return {
    callsign,
    flight: (airline && airline.iata ? airline.iata : icao) + ' ' + number,
    airline: airline ? { name: airline.name, iata: airline.iata, icao: airline.icao } : null,
    origin: fr ? pickAirport(fr.origin) : null,
    destination: fr ? pickAirport(fr.destination) : null,
    live: ac ? {
      lat: ac.lat, lon: ac.lon, onGround: ac.alt_baro === 'ground',
      altFt: ac.alt_baro === 'ground' ? 0 : ac.alt_baro ?? null, gsKt: ac.gs ?? null, track: ac.track ?? ac.true_heading ?? null,
      vRateFpm: ac.baro_rate ?? ac.geom_rate ?? null, registration: ac.r || '', type: ac.t || '', seenS: ac.seen_pos ?? ac.seen ?? null,
    } : null,
    liveError: live.status === 'rejected',
    at: Date.now(),
  };
}


module.exports = { api, parseFaa, parseFlight };
