// Data access: airport list, Open-Meteo forecasts, NWS alerts, and the optional live proxy.
import { HOUR } from './core.js';

/* ---------- Airports ---------- */

let airportsPromise;
let byCode = new Map();
let list = [];

export function loadAirports() {
  airportsPromise ??= fetch('data/airports.json')
    .then((r) => { if (!r.ok) throw new Error('airports'); return r.json(); })
    .then((rows) => {
      list = rows.map(([code, icao, name, city, country, lat, lon, tz]) => ({
        code, icao, name, city, country, lat, lon, tz,
        hay: `${city} ${name}`.toLowerCase(),
        major: /international|intl/i.test(name),
      }));
      byCode = new Map(list.map((a) => [a.code, a]));
      return list;
    });
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
    if (a.major) s += 8;
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

export { HOUR };
