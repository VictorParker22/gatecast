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

/* ---------- FAA "planned for today" (NAS Status JSON, undocumented: every field is optional) ---------- */
// Two keyless endpoints behind nasstatus.faa.gov, checked live on 16 Nov 2026:
//   api/operations-plan  { link, terminalPlanned: [{ time, event }], enRoutePlanned: [...] }: the ATCSCC
//     operations plan, lines such as "AFTER 1700\t-SAN GROUND STOP/DELAY PROGRAM EXPECTED".
//   api/airport-events   [{ airportId, groundStop, groundDelay, deicing, airportClosure, freeForm, airportConfig, ... }]
// Plan times are Zulu (UTC), as in all ATCSCC advisories: on 16 Nov 2026 the plan's "AFTER 1700" for SAN matched
// the SAN ground delay program's startTime "2026-11-16T17:00:00Z". Event times are ISO 8601 with a Z.
const FAA_PLANS_CACHE = 'public, s-maxage=300, stale-while-revalidate=600';
const FAA_SOURCE = 'FAA NAS Status';
const PLAN_PREFIX = /^(?:(AFTER|FROM|BEGINNING|STARTING|STARTING AT|BEGINNING AT|UNTIL|THRU|THROUGH|BY|BEFORE|AT|AROUND)\s+)?(\d{4})Z?(?:\s*[-–]\s*(\d{4})Z?)?(?=\s|-|$)/;
const ENDS_ONLY = new Set(['UNTIL', 'THRU', 'THROUGH', 'BY', 'BEFORE']);
const LIKELIHOOD = /\b(EXPECTED|PROBABLE|POSSIBLE|PLANNED|LIKELY)\b/;
const CODES = /^[A-Z][A-Z0-9]{2,3}(?:\/[A-Z][A-Z0-9]{2,3})*$/;

// The plan's date from its advisory link (adv_date=MMDDYYYY or titleDate=MM/DD/YYYY): { y, m, d } or null.
function planDate(link) {
  const s = String(link || '');
  const m = s.match(/adv_date=(\d{2})(\d{2})(\d{4})/) || s.match(/titleDate=(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { y: +m[3], m: +m[1], d: +m[2] } : null;
}
// "1700" on the plan's day -> ISO. The plan runs from the morning to the early hours of the next UTC day
// (US evenings are 00-08Z), so a time before 08Z is read as the next day. null if the time is not a time.
function zuluIso(hhmm, day) {
  const hh = +hhmm.slice(0, 2), mm = +hhmm.slice(2);
  if (!day || hh > 24 || mm > 59) return null;
  return new Date(Date.UTC(day.y, day.m - 1, day.d + (hh < 8 ? 1 : 0), hh, mm)).toISOString();
}
const kindOf = (t) => (/GROUND STOP/.test(t) ? 'ground_stop' : /DELAY PROGRAM|GROUND DELAY|\bGDP\b|\bAFP\b/.test(t) ? 'delay_program' : /DE-?ICING/.test(t) ? 'deicing' : 'other');

// One plan line -> { codes, kind, likelihood, text, summary, start, end } or null for an empty line.
// text is the FAA's own wording (whitespace tidied); summary is a plain reading of it, never more than it says.
function parsePlanLine(entry, day) {
  const raw = [entry && entry.time, entry && entry.event].filter((x) => typeof x === 'string').join(' ');
  const text = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!text) return null;
  let start = null, end = null, body = text;
  const t = text.match(PLAN_PREFIX);
  if (t) {
    body = text.slice(t[0].length);
    if (t[3]) { start = zuluIso(t[2], day); end = zuluIso(t[3], day); }
    else if (ENDS_ONLY.has(t[1])) end = zuluIso(t[2], day);
    else start = zuluIso(t[2], day);
    if (start && end && end < start) end = new Date(Date.parse(end) + 864e5).toISOString();
  }
  body = body.replace(/^[\s-–]+/, '').trim();
  // Airports lead the line ("SAN", "EWR/LGA/JFK") or follow FOR/AT/INTO ("... POSSIBLE FOR TEB/MMU").
  const codes = new Set();
  const first = body.split(' ')[0];
  if (CODES.test(first)) first.split('/').forEach((c) => codes.add(c));
  for (const m of body.matchAll(/\b(?:FOR|AT|INTO)\s+([A-Z][A-Z0-9/]{2,})/g)) if (CODES.test(m[1])) m[1].split('/').forEach((c) => codes.add(c));
  const kind = kindOf(body);
  const likely = (body.match(LIKELIHOOD) || [])[1];
  const what = kind === 'ground_stop' && /GROUND STOP\s*\/\s*(?:GROUND )?DELAY PROGRAM/.test(body) ? 'Ground stop or delay program'
    : kind === 'ground_stop' ? 'Ground stop' : kind === 'delay_program' ? 'Delay program' : kind === 'deicing' ? 'De-icing' : null;
  const summary = what ? (likely ? `${what} ${likely.toLowerCase()}` : what) : body;
  return { codes: [...codes], kind, likelihood: likely ? likely.toLowerCase() : null, text, summary, start, end };
}

// operations-plan JSON -> { link, items }. Only the terminal (airport) part: en-route lines are about routes.
function parseOpsPlan(json) {
  const link = json && typeof json.link === 'string' && /^https:\/\//.test(json.link) ? json.link.replace(/ /g, '%20') : null;
  const day = planDate(json && json.link);
  const lines = Array.isArray(json && json.terminalPlanned) ? json.terminalPlanned : [];
  return { link, items: lines.map((l) => parsePlanLine(l, day)).filter((x) => x && x.codes.length) };
}

const isoOrNull = (s) => (typeof s === 'string' && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null);
const httpsOrNull = (s) => (typeof s === 'string' && /^https:\/\//.test(s) ? s.replace(/ /g, '%20') : null);
// airport-events JSON -> items for ground stops, delay programs and de-icing. Closures and free-form entries are
// raw NOTAMs (curfews, private-traffic limits) that read as false alarms, and runway configuration is not news.
function parseAirportEvents(json) {
  const out = [];
  for (const a of Array.isArray(json) ? json : []) {
    const code = String((a && a.airportId) || '').toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(code)) continue;
    const gs = a.groundStop, gd = a.groundDelay, de = a.deicing;
    const why = (x) => (typeof x.impactingCondition === 'string' && x.impactingCondition.trim() ? ` (${x.impactingCondition.trim().toLowerCase()})` : '');
    if (gs && typeof gs === 'object') {
      out.push({ codes: [code], kind: 'ground_stop', text: `Ground stop${why(gs)}`, summary: `Ground stop${why(gs)}`,
        start: isoOrNull(gs.startTime), end: isoOrNull(gs.endTime), link: httpsOrNull(gs.advisoryUrl), event: true });
    }
    if (gd && typeof gd === 'object') {
      const avg = Number(gd.avgDelay), max = Number(gd.maxDelay);
      const mins = [avg > 0 ? `average delay ${Math.round(avg)} min` : '', max > 0 ? `up to ${Math.round(max)} min` : ''].filter(Boolean).join(', ');
      const text = `Ground delay program${why(gd)}${mins ? `, ${mins}` : ''}`;
      out.push({ codes: [code], kind: 'delay_program', text, summary: text, start: isoOrNull(gd.startTime), end: isoOrNull(gd.endTime), link: httpsOrNull(gd.advisoryUrl), event: true });
    }
    if (de && typeof de === 'object') {
      out.push({ codes: [code], kind: 'deicing', text: 'Deicing', summary: 'De-icing reported', start: isoOrNull(de.eventTime), end: isoOrNull(de.expTime), link: null, event: true });
    }
  }
  return out;
}

// The planned items for the airports asked about. wanted: [{ code (IATA or FAA), icao }]. A plan line about a
// ground stop or delay program is dropped for an airport whose program the FAA has since issued (events).
function faaPlansFor(wanted, { plan, events }, now = Date.now()) {
  const items = [...(events || []), ...((plan && plan.items) || []).map((x) => ({ ...x, link: plan.link }))];
  const issued = new Set((events || []).filter((x) => x.kind !== 'deicing').map((x) => x.codes[0]));
  const plans = [];
  for (const w of wanted) {
    const names = new Set([w.code, w.icao, w.icao && /^K[A-Z0-9]{3}$/.test(w.icao) ? w.icao.slice(1) : null].filter(Boolean));
    for (const x of items) {
      if (!x.codes.some((c) => names.has(c))) continue;
      if (!x.event && x.kind !== 'other' && x.kind !== 'deicing' && x.codes.some((c) => names.has(c) && issued.has(c))) continue;
      if (x.end && Date.parse(x.end) < now) continue; // over already
      plans.push({
        airport: w.code, kind: x.kind, text: x.text, summary: x.summary, start: x.start, end: x.end,
        status: x.start && Date.parse(x.start) <= now ? 'active' : 'planned', link: x.link || null,
        from: x.event ? 'airport-events' : 'operations-plan', source: FAA_SOURCE,
      });
    }
  }
  return plans;
}

// US airports from the bundled list, loaded on first use only (it is large): IATA and ICAO -> { code, icao }.
const US_COUNTRIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP']);
let usAirports = null;
function usAirport(code) {
  if (!usAirports) {
    usAirports = new Map();
    for (const [iata, icao, , , country] of require('../data/airports.json')) {
      if (!US_COUNTRIES.has(country)) continue;
      const rec = { code: iata, icao: icao || null };
      usAirports.set(iata, rec);
      if (icao) usAirports.set(icao, rec);
    }
  }
  return usAirports.get(code) || null;
}
// "JFK,lga,KORD" -> up to 10 distinct US airports; anything else is dropped.
function faaPlanAirports(raw) {
  const seen = new Map();
  for (const c of String(raw || '').toUpperCase().split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9]{3,4}$/.test(x)).slice(0, 20)) {
    const a = usAirport(c);
    if (a && !seen.has(a.code)) seen.set(a.code, a);
  }
  return [...seen.values()].slice(0, 10);
}

async function loadFaaRaw() {
  return cached('faa-plans', 5 * 60e3, async () => {
    const [plan, events] = await Promise.allSettled([
      upstream('https://nasstatus.faa.gov/api/operations-plan').then((r) => r.json()).then(parseOpsPlan),
      upstream('https://nasstatus.faa.gov/api/airport-events').then((r) => r.json()).then(parseAirportEvents),
    ]);
    if (plan.status === 'rejected' && events.status === 'rejected') throw new Error('faa plans unavailable');
    return {
      plan: plan.status === 'fulfilled' ? plan.value : null,
      events: events.status === 'fulfilled' ? events.value : null,
      checkedAt: new Date().toISOString(),
    };
  });
}

const api = {
  '/api/health': async () => ({ ok: true }),
  '/api/faa-plans': async (q) => {
    const wanted = faaPlanAirports(q.get('airports'));
    if (!wanted.length) return { airports: [], plans: [], checkedAt: null, zone: 'UTC', source: FAA_SOURCE };
    const raw = await loadFaaRaw();
    return {
      airports: wanted.map((w) => w.code), plans: faaPlansFor(wanted, raw), checkedAt: raw.checkedAt,
      planLink: raw.plan ? raw.plan.link : null, partial: !raw.plan || !raw.events, zone: 'UTC', source: FAA_SOURCE,
    };
  },
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


module.exports = { api, parseFaa, parseFlight, parsePlanLine, parseOpsPlan, parseAirportEvents, faaPlansFor, faaPlanAirports, FAA_PLANS_CACHE };
