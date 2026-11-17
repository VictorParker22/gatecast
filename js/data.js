// Data access: airport list, Open-Meteo forecasts, NWS alerts, FAA plans, and the optional live proxy.
import { HOUR } from './core.js';

/* ---------- Airports ---------- */

let airportsPromise;
let byCode = new Map();
let list = [];

export function loadAirports() {
  airportsPromise ??= fetch('data/airports.json')
    .then((r) => { if (!r.ok) throw new Error('airports'); return r.json(); })
    .then((rows) => {
      list = rows.map(([code, icao, name, city, country, lat, lon, tz, rank = 0]) => ({
        code, icao, name, city, country, lat, lon, tz, rank,
        hay: `${city} ${name}`.toLowerCase(),
      }));
      byCode = new Map(list.map((a) => [a.code, a]));
      return list;
    })
    .catch((err) => { airportsPromise = null; throw err; }); // a later call may try again
  return airportsPromise;
}
export const airport = (code) => byCode.get(String(code || '').toUpperCase()) || null;

export function searchAirports(q, limit = 7) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const a of list) {
    let s = 0;
    const city = a.city.toLowerCase();
    if (a.code.toLowerCase() === q) s = 100;
    else if (city === q) s = 80;
    else if (city.startsWith(q)) s = 60;
    else if (q.length === 4 && a.icao.toLowerCase() === q) s = 55;
    else if (a.hay.includes(' ' + q) || a.hay.startsWith(q)) s = 40;
    else if (q.length >= 4 && a.hay.includes(q)) s = 20;
    else if (q.length < 3 && a.code.toLowerCase().startsWith(q)) s = 30;
    if (!s) continue;
    s += a.rank * 6;
    scored.push([s, a]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].name.length - y[1].name.length);
  return scored.slice(0, limit).map((x) => x[1]);
}

/* ---------- Forecast (Open-Meteo, called directly from the browser) ---------- */

const HOURLY = 'temperature_2m,precipitation_probability,precipitation,snowfall,weather_code,visibility,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day';
const CACHE_MS = 30 * 60e3;

function cacheGet(key) {
  try {
    const v = JSON.parse(sessionStorage.getItem(key));
    if (v && Date.now() - v.at < CACHE_MS) return v.data;
  } catch {}
  return null;
}
function cacheSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch {}
}

function toHours(loc) {
  const h = loc.hourly;
  return h.time.map((t, i) => ({
    t: t * 1000,
    temp: h.temperature_2m[i], pop: h.precipitation_probability[i], precip: h.precipitation[i],
    snow: h.snowfall[i], code: h.weather_code[i], vis: h.visibility[i],
    wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], dir: h.wind_direction_10m[i], day: h.is_day[i],
  })).filter((x) => x.code != null);
}

// Returns Map(code -> hours[]) plus the fetch time. One request covers every airport.
export async function loadForecasts(airports) {
  const uniq = [...new Map(airports.map((a) => [a.code, a])).values()];
  const key = 'fc:' + uniq.map((a) => a.code).join(',');
  let data = cacheGet(key);
  let at = Date.now();
  if (!data) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: uniq.map((a) => a.lat).join(','), longitude: uniq.map((a) => a.lon).join(','),
      hourly: HOURLY, forecast_days: '16', timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh',
    });
    let res = await fetch(url);
    if (res.status === 429) { // free tier is shared per network address: one quiet retry
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url);
    }
    if (!res.ok) {
      const err = new Error(res.status === 429 ? 'rate' : 'forecast');
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    data = (Array.isArray(json) ? json : [json]).map(toHours);
    cacheSet(key, data);
  }
  return { at, forecasts: new Map(uniq.map((a, i) => [a.code, data[i] || []])) };
}

/* ---------- US weather alerts (api.weather.gov allows browser calls) ---------- */

export async function loadAlerts(a) {
  if (a.country !== 'US') return [];
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${a.lat},${a.lon}`, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.features || []).map((f) => f.properties).map((p) => ({
      event: p.event, severity: p.severity, headline: p.headline, ends: p.ends || p.expires,
      area: p.areaDesc, onset: p.onset || p.effective,
    }));
  } catch { return []; }
}

/* ---------- Live layer (only when served by server.js, which proxies sources without CORS) ---------- */

let livePromise;
export function liveAvailable() {
  livePromise ??= fetch('api/health').then((r) => r.ok && r.headers.get('content-type')?.includes('json')).catch(() => false);
  return livePromise;
}
export async function loadLive(airports) {
  if (!(await liveAvailable())) return null;
  const ids = airports.map((a) => a.icao).filter(Boolean).join(',');
  const [metar, faa] = await Promise.all([
    fetch(`api/metar?ids=${ids}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    airports.some((a) => a.country === 'US') ? fetch('api/faa').then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
  ]);
  return { metar, faa };
}

// What the FAA plans today for US airports (ground stops, delay programs, de-icing), through /api/faa-plans.
// codes: IATA or ICAO codes; the server keeps US ones only. Resolves to { plans, checkedAt } and never throws:
// on a static host, a failed request or an odd answer it is { plans: [], checkedAt: null }.
// Each plan: { airport, kind: 'ground_stop' | 'delay_program' | 'deicing' | 'other', text (the FAA's wording),
// summary (plain reading of it), start, end (ISO UTC or null), status: 'planned' | 'active', link,
// from: 'operations-plan' (a forecast line) | 'airport-events' (a program the FAA has issued), source }.
const PLAN_KINDS = new Set(['ground_stop', 'delay_program', 'deicing', 'other']);
const isoOr = (s) => (typeof s === 'string' && Number.isFinite(Date.parse(s)) ? s : null);
export async function loadFaaPlans(codes) {
  const none = { plans: [], checkedAt: null };
  const list = [...new Set((codes || []).map((c) => String(c || '').toUpperCase()).filter((c) => /^[A-Z0-9]{3,4}$/.test(c)))].slice(0, 10);
  if (!list.length) return none;
  try {
    const res = await fetch(`api/faa-plans?airports=${list.join(',')}`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return none;
    const json = await res.json();
    const plans = (Array.isArray(json?.plans) ? json.plans : [])
      .filter((p) => p && typeof p.airport === 'string' && PLAN_KINDS.has(p.kind) && typeof p.text === 'string' && p.text.trim())
      .map((p) => ({
        airport: p.airport, kind: p.kind, text: p.text, summary: typeof p.summary === 'string' && p.summary ? p.summary : p.text,
        start: isoOr(p.start), end: isoOr(p.end), status: p.status === 'active' ? 'active' : 'planned',
        link: typeof p.link === 'string' && /^https:\/\//.test(p.link) ? p.link : null,
        from: p.from === 'airport-events' ? 'airport-events' : 'operations-plan', source: 'FAA NAS Status',
      }));
    return { plans, checkedAt: isoOr(json?.checkedAt) };
  } catch { return none; }
}

/* ---------- Places and local weather (weather home page) ---------- */

export async function searchPlaces(q) {
  q = q.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
    if (!res.ok) return [];
    return ((await res.json()).results || []).map((r) => ({
      name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3), country: r.country_code,
    }));
  } catch { return []; }
}

const kmBetween = (aLat, aLon, bLat, bLon) => {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Nearest airports from the bundled list, so naming a spot needs no third-party lookup.
// minRank 1 keeps airports with airline service; 2 keeps only large ones. Call loadAirports() first:
// until the list has loaded this returns nothing.
export function nearestAirports(lat, lon, n = 3, minRank = 0) {
  return list
    .filter((a) => a.rank >= minRank)
    .map((a) => ({ airport: a, km: kmBetween(lat, lon, a.lat, a.lon) }))
    .sort((x, y) => x.km - y.km)
    .slice(0, n);
}

const CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,precipitation,surface_pressure,visibility';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_gusts_10m_max';

// Current conditions, 48 hours and 10 days for one spot, plus air quality when available.
// A request already on its way for the same spot is shared, so index.html can start the saved place's
// forecast while the rest of the page's scripts are still loading.
const inflight = new Map();
export function loadWeather(lat, lon) {
  const key = `wx:${lat},${lon}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  if (!inflight.has(key)) inflight.set(key, fetchWeather(lat, lon, key).finally(() => inflight.delete(key)));
  return inflight.get(key);
}
async function fetchWeather(lat, lon, key) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat, longitude: lon, current: CURRENT, hourly: HOURLY, daily: DAILY,
    forecast_hours: '48', forecast_days: '10', timeformat: 'unixtime', timezone: 'auto', wind_speed_unit: 'kmh',
  });
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&timezone=auto`;
  let res = await fetch(url);
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); res = await fetch(url); }
  if (!res.ok) { const err = new Error(res.status === 429 ? 'rate' : 'forecast'); throw err; }
  const [json, air] = await Promise.all([res.json(), fetch(airUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  const c = json.current, d = json.daily;
  const data = {
    at: Date.now(), tz: json.timezone,
    now: {
      t: c.time * 1000, temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, code: c.weather_code,
      wind: c.wind_speed_10m, gust: c.wind_gusts_10m, dir: c.wind_direction_10m, day: c.is_day, precip: c.precipitation,
      pressure: c.surface_pressure, vis: c.visibility,
    },
    hours: toHours(json),
    days: d.time.map((t, i) => ({
      t: t * 1000, code: d.weather_code[i], max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], pop: d.precipitation_probability_max[i],
      precip: d.precipitation_sum[i], sunrise: d.sunrise[i] * 1000, sunset: d.sunset[i] * 1000, uv: d.uv_index_max[i], gust: d.wind_gusts_10m_max[i],
    })).filter((x) => x.max != null),
    air: air && air.current && air.current.us_aqi != null ? { aqi: air.current.us_aqi, pm25: air.current.pm2_5 } : null,
  };
  cacheSet(key, data);
  return data;
}

// Current conditions for several far-away cities in one request (the "Here and there" box).
export async function loadCities(cities) {
  const key = 'cities:' + cities.map((c) => c.name).join(',');
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: cities.map((c) => c.lat).join(','), longitude: cities.map((c) => c.lon).join(','),
      current: 'temperature_2m,weather_code,is_day', timeformat: 'unixtime', timezone: 'auto',
    });
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const data = (Array.isArray(json) ? json : [json]).map((j, i) => ({
      name: cities[i].name, tz: j.timezone, temp: j.current.temperature_2m, code: j.current.weather_code, day: j.current.is_day,
    }));
    cacheSet(key, data);
    return data;
  } catch { return null; }
}

/* ---------- Flights (through server.js or the Vercel functions) ---------- */

export async function loadFlight(q) {
  const res = await fetch(`api/flight?q=${encodeURIComponent(q)}`);
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('unavailable');
  return res.json();
}
export async function loadNearby(a) {
  try {
    const res = await fetch(`api/near?lat=${a.lat}&lon=${a.lon}`);
    return res.ok && res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  } catch { return null; }
}

/* ---------- Weird news (through server.js or the Vercel function /api/weird) ---------- */

// Resolves to { items, categories, checkedAt, sources } and never throws: on a static host, a failed request or an
// odd answer, items is empty. Each item is re-checked here: https link, headline, outlet, date; the image only if
// https; a YouTube video only with a well-formed id; rating only 1-5 from a pick. limit 1-60 (default 30); category one of WEIRD_CATEGORIES or none.
export const WEIRD_CATEGORIES = ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other'];
export async function loadWeird({ limit = 30, category = null } = {}) {
  const counts = () => Object.fromEntries(WEIRD_CATEGORIES.map((c) => [c, 0]));
  const none = { items: [], categories: counts(), checkedAt: null, sources: [] };
  const n = Math.min(60, Math.max(1, Math.round(Number(limit)) || 30));
  const params = new URLSearchParams({ limit: String(n) });
  if (WEIRD_CATEGORIES.includes(category)) params.set('category', category);
  try {
    const res = await fetch(`api/weird?${params}`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return none;
    const json = await res.json();
    const https = (s) => typeof s === 'string' && /^https:\/\/[^\s/]+\.[^\s]+$/.test(s);
    const text = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
    const items = (Array.isArray(json?.items) ? json.items : [])
      .filter((x) => x && text(x.title) && text(x.outlet) && https(x.url) && Number.isFinite(Date.parse(x.published)))
      .slice(0, n)
      .map((x) => {
        const image = https(x.image) && !/\.svgz?(?:$|\?)/i.test(x.image) ? x.image : null;
        const pick = x.pick === true;
        return {
          id: text(String(x.id ?? '')) || x.url, title: x.title.trim(), url: x.url, outlet: x.outlet.trim(),
          outletUrl: https(x.outletUrl) ? x.outletUrl : null, published: x.published,
          category: WEIRD_CATEGORIES.includes(x.category) ? x.category : 'other',
          image, imageCredit: image ? (text(x.imageCredit) || `Image: ${x.outlet.trim()}`) : null,
          video: x.video === true, pick,
          // A checked YouTube video: only the id and the words for its label; js/frontmodel.js cleanYoutube checks it again.
          youtube: x.youtube && typeof x.youtube === 'object' && /^[A-Za-z0-9_-]{11}$/.test(String(x.youtube.id))
            ? { id: x.youtube.id, title: text(x.youtube.title) || '', channel: text(x.youtube.channel) || '', duration: text(x.youtube.duration) } : null,
          rating: pick && Number.isInteger(x.rating) && x.rating >= 1 && x.rating <= 5 ? x.rating : null,
          note: pick ? text(x.note) : null,
        };
      });
    const categories = counts();
    for (const x of items) categories[x.category]++;
    const sources = (Array.isArray(json?.sources) ? json.sources : [])
      .filter((s) => s && text(s.name)).map((s) => ({ name: s.name.trim(), ok: s.ok === true, count: Number.isInteger(s.count) ? s.count : 0 }));
    return { items, categories, checkedAt: typeof json?.checkedAt === 'string' && Number.isFinite(Date.parse(json.checkedAt)) ? json.checkedAt : null, sources };
  } catch { return none; }
}

export { HOUR };
