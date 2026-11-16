// Pure logic for the Today page (index.html): which saved trip is soon enough to lead the page, its shareable
// link, and the four "what it means" cards made from the local forecast. No DOM and no network, so it is
// unit-tested with plain Node. Temperatures are °C, speeds km/h; f prints every number and time
// ({ time(ms), temp(c), speed(kmh) }, the same shape boardcontent.js uses).
import { planTrip, assessWindow, factorPhrase, HOUR, LEVEL_LABEL } from './core.js';
import { localHour } from './boardcontent.js';

/* ---------- Saved trips (written by trip.js under gatecast:recent) ---------- */

export const TRIP_WINDOW = 72 * HOUR;
const LOCAL = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const nums = (x) => (Array.isArray(x) ? x.map(Number).map((n) => (Number.isFinite(n) && n > 0 ? n : 0)) : []);

// A cheap first look before the airport list (and so the time zones) has loaded: is any saved trip within
// a few days of now, read in the browser's own zone? Used to decide whether to fetch the airport list early.
export function mightBeSoon(recents, now = Date.now()) {
  if (!Array.isArray(recents)) return false;
  return recents.some((t) => {
    const ms = t && typeof t.t === 'string' && LOCAL.test(t.t) ? Date.parse(t.t) : NaN;
    return ms > now - 2 * 24 * HOUR && ms < now + TRIP_WINDOW + 24 * HOUR;
  });
}

// The saved trip that is under way or departs within 72 hours, soonest first. find(code) returns an airport
// ({ code, lat, lon, tz, ... }) or null. Malformed or unknown entries are skipped, never thrown on.
export function upcomingTrip(recents, find, now = Date.now()) {
  let best = null;
  for (const t of Array.isArray(recents) ? recents : []) {
    // An entry marked as a tried-out example (ex or example) is not the visitor's own trip.
    if (!t || t.ex || t.example || !Array.isArray(t.r) || t.r.length < 2 || t.r.length > 5 || typeof t.t !== 'string' || !LOCAL.test(t.t)) continue;
    const r = t.r.map((c) => String(c).toUpperCase());
    const airports = r.map(find);
    if (airports.some((a) => !a || !a.tz)) continue;
    const trip = { r, t: t.t, l: nums(t.l).slice(0, r.length - 2), d: nums(t.d).slice(0, r.length - 1) };
    let plan;
    try { plan = planTrip(airports, trip.t, trip.l.map((m) => m || 90), trip.d); } catch { continue; }
    if (!Number.isFinite(plan.start) || plan.end < now || plan.start > now + TRIP_WINDOW) continue;
    if (!best || plan.start < best.plan.start) best = { trip, airports, plan };
  }
  return best;
}

// The trip page's shareable address for a trip (same format trip.js writes).
export function tripQuery(trip) {
  const p = new URLSearchParams({ r: trip.r.join('-'), t: trip.t });
  if (trip.l?.length) p.set('l', trip.l.join(','));
  if (trip.d?.some(Boolean)) p.set('d', trip.d.join(','));
  return '?' + p;
}

/* ---------- What today means: commute, take with you, air and sun, flights near you ---------- */

const isSnow = (c) => c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86;
const falls = (h) => h.code >= 51;
// Rain or snow worth planning around: the model shows it, with at least a 40% chance (or no chance given).
const wet = (h) => (falls(h) || (h.precip ?? 0) >= 0.5) && (h.pop == null || h.pop >= 40);
const heavy = (h) => h.code === 65 || h.code === 82 || h.code === 75 || h.code === 86 || (h.precip ?? 0) >= 4 || (h.snow ?? 0) >= 2;
const sure = (pop) => (pop == null || pop >= 70 ? '' : pop >= 50 ? ' likely' : ' possible');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function joinList(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The next n hours from the current one.
export function nextHours(wx, n) {
  const from = (wx.now?.t ?? 0) - HOUR + 1;
  return (wx.hours || []).filter((h) => h.t >= from).slice(0, n);
}

// The run of wet hours that starts first in H: its kind, start, end and best chance.
function firstSpell(H) {
  const s = H.findIndex(wet);
  if (s < 0) return null;
  let e = s;
  while (e + 1 < H.length && (wet(H[e + 1]) || (e + 2 < H.length && wet(H[e + 2])))) e++;
  const run = H.slice(s, e + 1).filter(wet);
  const pops = run.map((h) => h.pop).filter((p) => p != null);
  const kind = run.some((h) => h.code >= 95) ? 'storm' : run.some((h) => isSnow(h.code) || (h.snow ?? 0) > 0) ? 'snow' : 'rain';
  return { s, e, kind, run, pop: pops.length ? Math.max(...pops) : null, heavy: run.some(heavy) || run.reduce((a, h) => a + (h.snow ?? 0), 0) >= 5, now: s === 0, gust: Math.max(0, ...run.map((h) => h.gust ?? 0)) };
}
const NOUN = { rain: 'rain', snow: 'snow', storm: 'thunderstorms' };

// Words for when a spell happens: "from about 15:00 to 18:00", "now, until about 13:00".
function spellWhen(sp, H, f) {
  const end = H[sp.e].t + HOUR;
  const until = sp.e + 1 >= H.length ? 'for the next 12 hours' : `until about ${f.time(end)}`;
  if (sp.now) return { lead: `${cap(NOUN[sp.kind])} now, ${until}.`, at: 'now' };
  const start = f.time(H[sp.s].t);
  const single = sp.e === sp.s;
  const verb = sp.kind === 'storm' ? (sp.pop != null && sp.pop < 70 ? ' possible' : '') : sure(sp.pop);
  return {
    lead: single ? `${cap(NOUN[sp.kind])}${verb} around ${start}.` : `${cap(NOUN[sp.kind])}${verb} from about ${start}${sp.e + 1 >= H.length ? '' : ` to ${f.time(end)}`}.`,
    at: `from about ${start}`,
  };
}

// Your commute: rain, snow, storms, fog or strong gusts in the next 12 hours, as a hedged allowance of extra time.
// level: 'calm' (nothing to report), 'none' (worth a word, not a risk) or the risk level of the worst hour.
export function commute(wx, f) {
  const H = nextHours(wx, 12);
  if (!H.length) return null;
  const risk = assessWindow(H, H[0].t, H[H.length - 1].t);
  const sp = firstSpell(H);
  const top = risk.factors[0];
  const level = risk.level === 'elevated' || risk.level === 'high' ? risk.level : null;
  if (sp) {
    const when = spellWhen(sp, H, f);
    const min = sp.kind === 'snow' ? (sp.heavy ? 30 : 20) : sp.kind === 'storm' ? 15 : sp.heavy || sp.run.length >= 4 ? 10 : 5;
    const why = sp.kind === 'snow' ? 'Untreated roads and paths are slower.'
      : sp.kind === 'storm' ? 'Roads and trains can slow while storms pass.'
        : 'Wet roads and platforms usually slow things a little.';
    return { label: 'Your commute', big: `Allow +${min} min`, line: `${when.lead} ${why}`, level: level || 'none', minutes: min };
  }
  if (top && top.key === 'vis') {
    const k = H.findIndex((h) => !(h.code === 45 || h.code === 48 || (h.vis != null && h.vis < 1000)));
    const lead = k < 0 ? 'Fog for the next 12 hours.' : k === 0 ? 'Patches of fog about.' : `Fog until about ${f.time(H[k].t)}.`;
    return { label: 'Your commute', big: 'Allow +10 min', line: `${lead} Traffic slows down in fog.`, level: level || 'none', minutes: 10 };
  }
  if (top && top.key === 'wind' && top.points >= 40) {
    const g = Math.max(...H.map((h) => h.gust ?? 0));
    return { label: 'Your commute', big: 'Allow +5 min', line: `Gusts to ${f.speed(g)}. Bikes and high-sided vehicles go slower.`, level: level || 'none', minutes: 5 };
  }
  return { label: 'Your commute', big: 'Dry roads', line: 'No rain or snow in the next 12 hours.', level: 'calm', minutes: 0 };
}

// Take with you: umbrella or rain jacket, boots, a warm coat or layer, sunglasses or sunscreen, water.
// The first item is the big word; the line gives the reason for it and for the next one.
export function carry(wx, f) {
  const H = nextHours(wx, 12);
  if (!H.length) return null;
  const tz = wx.tz;
  const items = [];
  const sp = firstSpell(H);
  if (sp) {
    const when = spellWhen(sp, H, f);
    if (sp.kind === 'snow') items.push(['Boots', when.lead]);
    else if (sp.gust >= 50) items.push(['Rain jacket', `${when.lead.replace(/\.$/, '')}, too windy for an umbrella.`]);
    else items.push(['Umbrella', when.lead]);
  }
  const temps = H.map((h) => h.temp).filter((t) => t != null);
  const low = temps.length ? Math.min(...temps) : null;
  const lowAt = H.find((h) => h.temp === low);
  const feels = wx.now?.feels ?? wx.now?.temp;
  const cold = Math.min(low ?? Infinity, feels ?? Infinity);
  const lowWords = lowAt && lowAt !== H[0] ? `It drops to ${f.temp(low)} around ${f.time(lowAt.t)}.` : `It feels like ${f.temp(feels)} now.`;
  if (cold <= 4) items.push(['Warm coat', lowWords]);
  else if (cold <= 12) items.push(['Warm layer', lowWords]);
  const high = temps.length ? Math.max(...temps) : null;
  if (high != null && high >= 28) items.push(['Water', `Up to ${f.temp(high)} today.`]);
  const uv = wx.days?.[0]?.uv;
  const sunset = wx.days?.[0]?.sunset ?? Infinity;
  const brightAhead = H.some((h) => h.day && h.code <= 2 && h.t < sunset && localHour(h.t, tz) < 16);
  if (uv != null && uv >= 6 && brightAhead) items.push(['Sunscreen', `UV ${Math.round(uv)} around midday, which is high.`]);
  else if (uv != null && uv >= 3 && brightAhead) items.push(['Sunglasses', `Bright sun, UV ${Math.round(uv)}.`]);
  if (!items.length) return { label: 'Take with you', big: 'Nothing extra', line: 'No rain, cold or strong sun in the next 12 hours.', level: 'calm', items: [] };
  const [first, second] = items;
  const line = second ? `${first[1]} And ${WITH[second[0]]}: ${second[1].charAt(0).toLowerCase()}${second[1].slice(1)}` : first[1];
  return { label: 'Take with you', big: first[0], line, level: 'none', items: items.map((x) => x[0]) };
}
const WITH = { Umbrella: 'an umbrella', 'Rain jacket': 'a rain jacket', Boots: 'boots', 'Warm coat': 'a warm coat', 'Warm layer': 'a warm layer', Water: 'water', Sunscreen: 'sunscreen', Sunglasses: 'sunglasses' };

const AQI = (v) => (v <= 50 ? 'good' : v <= 100 ? 'moderate' : v <= 150 ? 'poor for sensitive groups' : v <= 200 ? 'unhealthy' : 'very unhealthy');
const AQI_BIG = (v) => (v <= 50 ? 'Good air' : v <= 100 ? 'Fair air' : v <= 150 ? 'Poor air' : 'Unhealthy air');
const UV = (v) => (v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'very high' : 'extreme');

// Air and sun: air quality, the UV index while the sun is still up, and the next sunset or sunrise.
// Anything the forecast did not include is left out; null when there is nothing at all.
export function airSun(wx, f, now = wx.now?.t ?? Date.now()) {
  const today = wx.days?.[0], tomorrow = wx.days?.[1];
  const parts = [];
  let big = null;
  if (wx.air && wx.air.aqi != null) {
    big = AQI_BIG(wx.air.aqi);
    parts.push(`Air quality ${Math.round(wx.air.aqi)}, ${AQI(wx.air.aqi)}.`);
  }
  const sunUp = today?.sunset != null && now < today.sunset;
  if (sunUp && today.uv != null) {
    const uv = Math.round(today.uv);
    if (!big && uv >= 3) big = `UV ${uv}`;
    parts.push(`UV ${uv}, ${UV(today.uv)}.`);
  }
  const sun = sunUp ? ['Sunset', today.sunset] : tomorrow?.sunrise != null ? ['Sunrise', tomorrow.sunrise] : today?.sunrise > now ? ['Sunrise', today.sunrise] : null;
  if (sun) {
    if (!big) big = `${sun[0]} ${f.time(sun[1])}`;
    else parts.push(`${sun[0]} at ${f.time(sun[1])}.`);
  }
  if (!big) return null;
  return { label: 'Air and sun', big, line: parts.join(' ') || (sun ? `${sun[0] === 'Sunset' ? 'The sun sets' : 'The sun rises'} at ${f.time(sun[1])}.` : ''), level: 'none' };
}

// Flights near you: the weather risk at the nearest airports over the next 3 hours.
// list: [{ code, risk: assessWindow(...) }] or null while loading.
export function flightsNear(list) {
  if (list == null) return { label: 'Flights near you', big: 'Checking…', line: 'Looking up the airports near you.', level: 'loading' };
  if (!list.length) return { label: 'Flights near you', big: 'No airports', line: 'No airport with airline flights within 300 km.', level: 'none' };
  const known = list.filter((x) => x.risk && x.risk.level !== 'unknown');
  if (!known.length) return { label: 'Flights near you', big: 'No forecast', line: 'The airport forecasts are not available right now.', level: 'unknown' };
  const worst = known.reduce((a, b) => (b.risk.score > a.risk.score ? b : a));
  const codes = known.map((x) => x.code);
  if (worst.risk.level === 'low') {
    return { label: 'Flights near you', big: 'Calm', line: `${joinList(codes)} ${codes.length > 1 ? 'look' : 'looks'} calm for the next 3 hours.`, level: 'calm' };
  }
  const risky = known.filter((x) => x.risk.level !== 'low').map((x) => x.code);
  const why = cap(factorPhrase(worst.risk.factors) || 'Weather');
  const others = codes.filter((c) => !risky.includes(c));
  return {
    label: 'Flights near you', big: LEVEL_LABEL[worst.risk.level], level: worst.risk.level,
    line: `${why} at ${worst.code} in the next 3 hours${risky.length > 1 ? `, and some risk at ${joinList(risky.filter((c) => c !== worst.code))}` : ''}.${others.length ? ` ${joinList(others)} ${others.length > 1 ? 'look' : 'looks'} calm.` : ''}`,
  };
}

/* ---------- The brief: weather news, state headlines (see lib/news.js for the server half) ---------- */

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
STATE_BY_NAME.set('washington, d.c.', 'DC');

// Is the place in the United States? Search results carry "US"; older saved places may carry the name.
export function isUS(place) {
  const c = String(place?.country || '').trim().toLowerCase();
  return c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america';
}

// The two-letter state for a saved place, from what the page already stores: an explicit code (state), or
// the first part of the search result's region ("New York, United States" -> NY). null when unknown.
export function stateOf(place) {
  if (!place || !isUS(place)) return null;
  const direct = String(place.state || '').trim().toUpperCase();
  if (US_STATES[direct]) return direct;
  // Longest name that the region starts with, so "Washington, D.C., United States" is DC, not WA.
  const region = String(place.region || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let best = null;
  for (const [name, code] of STATE_BY_NAME) {
    if ((region === name || region.startsWith(name + ',')) && (!best || name.length > best[0].length)) best = [name, code];
  }
  return best ? best[1] : null;
}

// "Just now", "25 min ago", "3 hr ago", "Yesterday", "4 days ago". Future times (clock skew) read as just now.
export function relTime(when, now = Date.now()) {
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor((now - ms) / 60000);
  if (min < 5) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

// Headlines from /api/news, re-checked on this side: an https link, a title and a date, or the item is left out.
// Each keeps its preview image only if that passes cleanImage too; otherwise image is null.
export function cleanHeadlines(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  return items.filter((x) => x && typeof x.title === 'string' && x.title.trim() && typeof x.outlet === 'string'
    && /^https:\/\//.test(x.url || '') && Number.isFinite(Date.parse(x.published))).slice(0, 8)
    .map((x) => ({ ...x, image: cleanImage(x.image) }));
}

// A publisher's preview image as the page will hotlink it: { url, width?, height? } or null. https only (never
// data: or javascript:), no SVG, no address literal; a declared size is kept only when both sides are sensible.
export function cleanImage(img) {
  const url = typeof img?.url === 'string' ? img.url.trim() : '';
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^[\d.]+$|^\[/.test(u.hostname)) return null;
  if (/\.svgz?$/i.test(u.pathname) || url.length > 2048) return null;
  const w = Math.round(Number(img.width)), h = Math.round(Number(img.height));
  if (w > 0 && h > 0 && (w < 80 || h < 80)) return null; // a pixel or an icon, not a photo
  return w >= 80 && h >= 80 && w <= 20000 && h <= 20000 ? { url: u.href, width: w, height: h } : { url: u.href };
}

// The outlet's name as a monogram for the tile shown when a story has no image: "New York Focus" -> "NYF",
// "NPR Illinois" -> "NPR", "City & State New York" -> "CSNY". At most four characters.
const SMALL_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'for', 'on', 'in', 'at']);
export function monogram(name) {
  const words = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const kept = words.filter((w) => !(SMALL_WORDS.has(w.toLowerCase()) && words.length > 1));
  const list = kept.length ? kept : words;
  if (!list.length) return '';
  // A leading call sign or acronym (KQED, WAMC, NPR) is the outlet's own monogram.
  if (/^[A-Z0-9]{3,5}$/.test(list[0])) return list[0].slice(0, 4);
  // One word: its capitals when it has several ("CalMatters" -> "CM"), else its first letter.
  if (list.length === 1) { const caps = list[0].replace(/[^A-Z0-9]/g, ''); return (caps.length > 1 ? caps : list[0][0].toUpperCase()).slice(0, 4); }
  const acr = (w) => (/^[A-Z0-9]{2,4}$/.test(w) ? w : w[0].toUpperCase());
  return list.map(acr).join('').slice(0, 4);
}

// Whether an outlet's fallback tile is ink or concrete: fixed per outlet, so its tiles always match.
export function tileTone(name) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 2 ? 'concrete' : 'ink';
}

// How the brief lays out its headlines (newest first in, order kept): the lead is the newest story with an
// image (or the newest story when none has one); up to three more sit beside it as compact rows, and the rest
// become cards under both. Four or fewer after the lead all go beside it, so a card row is never a lone card.
export function arrangeHeadlines(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return { lead: null, rows: [], cards: [] };
  const lead = list.find((x) => x.image) || list[0];
  const rest = list.filter((x) => x !== lead);
  const nRows = rest.length <= 4 ? rest.length : 3;
  return { lead, rows: rest.slice(0, nRows), cards: rest.slice(nRows) };
}

const SEVERITY = { Extreme: 3, Severe: 2, Moderate: 1, Minor: 0, Unknown: 0 };
// NWS alerts (from data.js loadAlerts) as brief items, most severe first: Extreme and Severe read as high risk,
// the rest as elevated. Alerts that have already ended are dropped.
export function alertItems(alerts, now = Date.now()) {
  return (Array.isArray(alerts) ? alerts : [])
    .filter((a) => a && a.event && !(Date.parse(a.ends) < now))
    .map((a) => ({
      event: a.event,
      level: (SEVERITY[a.severity] ?? 0) >= 2 ? 'high' : 'elevated',
      headline: a.headline || '',
      area: a.area || '',
      from: Number.isFinite(Date.parse(a.onset)) ? Date.parse(a.onset) : null,
      until: Number.isFinite(Date.parse(a.ends)) ? Date.parse(a.ends) : null,
      rank: SEVERITY[a.severity] ?? 0,
    }))
    .sort((a, b) => b.rank - a.rank);
}

// The one forecast signal worth a news item: the riskiest nearby airport over the next 3 hours, when it is
// elevated or high (same list flightsNear reads). Calm or unknown -> null: no filler.
export function airportSignal(list) {
  const risky = (Array.isArray(list) ? list : []).filter((x) => x.risk && (x.risk.level === 'elevated' || x.risk.level === 'high'));
  if (!risky.length) return null;
  const worst = risky.reduce((a, b) => (b.risk.score > a.risk.score ? b : a));
  const why = cap(factorPhrase(worst.risk.factors) || 'Rough weather');
  const others = risky.filter((x) => x !== worst).map((x) => x.code);
  return {
    code: worst.code, level: worst.risk.level,
    title: `${why} near ${worst.code} in the next 3 hours`,
    line: `${LEVEL_LABEL[worst.risk.level]} weather risk for flights there${others.length ? `, and at ${joinList(others)}` : ''}. Check with your airline before you leave.`,
  };
}
