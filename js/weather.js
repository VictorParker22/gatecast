// The weather half of the front page (index.html): the "Weather box" (an old program window with the live sky inside:
// the weather here now, the next 8 hours, the nearby airports and alerts), "Since you last looked", the brief (state
// headlines, NWS alerts, statehouse votes), the "Flying?" box (a saved trip within 72 hours, or a From/To form) and the
// weather desk (what today means, 10 days, the rain radar). The weird news half is js/front.js.
// Pure wording and rules live in js/today.js and js/boardcontent.js.
import { planTrip, assessTrip, assessWindow, scoreHour, describeCode, distanceKm, fmtTime, fmtDay, fmtZone, HOUR, LEVEL_LABEL } from './core.js';
import { headlineParts, dayKey, skyOf } from './boardcontent.js';
import { upcomingTrip, mightBeSoon, tripQuery, commute, carry, airSun, flightsNear, nextHours, stateOf, isUS, relTime, cleanHeadlines, arrangeHeadlines, alertItems, airportSignal, alertReason, newsReason, civicReason, US_STATES } from './today.js';
import { placeSnapshot, diffPlaces, noteForecast, dismiss, changeLine, changeLead, dayName, alertKey, startLook, noteKind, briefNews, dismissLook, lookEntry, sinceLabel } from './changes.js';
import { odds, stopOdds, faaPlanLine } from './riskwords.js';
import { seenGet, seenSet } from './seen.js';
import { loadAirports, airport, searchPlaces, nearestAirports, loadWeather, loadForecasts, loadAlerts } from './data.js';
import { $, store, prefs, initSettings } from './shell.js';
import { initSky, setSky } from './sky.js';
import { esc, weatherIcon, riskIcon, chip, units } from './ui.js';
import { enter } from './motion.js';

const POPULAR = [
  { name: 'New York', region: 'United States', lat: 40.713, lon: -74.006, country: 'US', state: 'NY' },
  { name: 'London', region: 'United Kingdom', lat: 51.507, lon: -0.128, country: 'GB' },
  { name: 'Tokyo', region: 'Japan', lat: 35.69, lon: 139.692, country: 'JP' },
  { name: 'Sydney', region: 'Australia', lat: -33.868, lon: 151.207, country: 'AU' },
  { name: 'Dubai', region: 'United Arab Emirates', lat: 25.077, lon: 55.309, country: 'AE' },
  { name: 'São Paulo', region: 'Brazil', lat: -23.548, lon: -46.636, country: 'BR' },
];

// The board this page used to have kept these on the device. Nothing reads them any more.
for (const k of ['gatecast:board', 'gatecast:stats', 'gatecast:quiz', 'gatecast:checks']) { try { localStorage.removeItem(k); } catch {} }

const sky = $('#sky');
const heroEl = $('#hero');
const todayEl = $('#today');
const findEl = $('#wx-find');
const changeBtn = $('#wx-change');
const FIRST_HTML = heroEl.innerHTML; // the first-visit prompt as index.html wrote it
// The weather box folds to its title bar (with the temperature once known) on every screen, so the news leads the
// first screen; the button opens it, and choosing a place keeps it open.
const boxEl = $('#wxbox');
const foldBtn = $('#wx-fold');
const miniEl = $('#wx-mini');
function setFold(open) {
  boxEl.classList.toggle('wxbox--open', open);
  foldBtn.setAttribute('aria-expanded', String(open));
  foldBtn.textContent = open ? 'Close' : state.place ? 'Forecast' : 'Set my weather';
}
foldBtn.addEventListener('click', () => {
  const open = !boxEl.classList.contains('wxbox--open');
  setFold(open);
  if (open && !state.place) input.focus({ preventScroll: true });
});

// Everything the page shows comes from this; render() decides what goes where.
const state = {
  place: store.get('gatecast:place', null),
  wx: null, wxError: null,       // local forecast, or 'rate' / 'forecast'
  alerts: [], airports: null,     // NWS alerts; nearest airports with their next-3-hour risk (null while loading)
  trip: { status: 'none' },       // 'none' | 'checking' | 'ready' | 'failed', with { trip, plan, result, route }
  brief: null,                    // { place, us, code (US state or null), news: null while loading | { state, items }, look }
  since: null,                    // what changed in the place's forecast since the last look: { key, changes, since } or null
  faa: [],                        // FAA planned items for the nearby US airports (data.js loadFaaPlans, when present)
};
if (state.place && !(Number.isFinite(state.place.lat) && Number.isFinite(state.place.lon))) state.place = null;
let radar = null;
let jumpTo = null; // a section to scroll to once the forecast is on screen (old #tile- links)

/* ---------- What changed since the last look (kept on this device only; js/changes.js decides) ---------- */

const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const placeKey = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
// The place's forecast against the last look at this place.
function notePlace(p, wx) {
  const now = Date.now(), key = placeKey(p);
  const r = noteForecast(seenGet('places', key), placeSnapshot(wx, scoreHour, now), diffPlaces, now);
  if (r.entry) seenSet('places', key, r.entry);
  return r.changes ? { key, changes: r.changes, since: r.since } : null;
}

/* ---------- Formatting for the current place and units ---------- */

function fmt(tz = state.wx?.tz) {
  const u = units(prefs);
  return {
    u, tz,
    // Prose says "noon" and "midnight"; narrow column labels use the plain clock.
    time: (ms) => { const t = fmtTime(ms, tz); return t === '12 pm' ? 'noon' : t === '12 am' ? 'midnight' : t; },
    clock: (ms) => fmtTime(ms, tz),
    temp: u.temp, speed: u.speed,
  };
}
const placeName = (p) => (p.name === 'Your location' ? 'where you are' : p.name);

/* ---------- Location ---------- */

function setPlace(p) {
  locateError('');
  state.place = p;
  store.set('gatecast:place', p);
  const saved = [p, ...store.get('gatecast:places', []).filter((x) => x.name !== p.name || x.region !== p.region)].slice(0, 4);
  store.set('gatecast:places', saved);
  openFinder(false);
  setFold(true); // the answer for the new place shows straight away, also on a phone
  $('#wxbox').scrollIntoView({ block: 'nearest' }); // the answer for the new place is in the weather box
  loadPlace();
}
function locateError(msg) {
  const el = $('#locate-error');
  el.hidden = !msg; el.textContent = msg || '';
}

// Called from a button press, after the page has explained why it wants the location.
function locate(quiet = false) {
  if (!('geolocation' in navigator)) return locateError('This browser cannot share a location. Search for a city instead.');
  const buttons = document.querySelectorAll('[data-locate]');
  buttons.forEach((b) => { b.disabled = true; });
  // The airport list names the spot; fetch it while the browser works out the position.
  const airportsReady = loadAirports().catch(() => {});
  navigator.geolocation.getCurrentPosition(async (pos) => {
    // Two decimals is about a kilometre: enough for a forecast, and no more precise than needed.
    const lat = +pos.coords.latitude.toFixed(2), lon = +pos.coords.longitude.toFixed(2);
    loadWeather(lat, lon).catch(() => {}); // the forecast downloads while the list finishes (loadPlace() reuses it)
    await airportsReady;
    buttons.forEach((b) => { b.disabled = false; });
    const near = nearestAirports(lat, lon, 1)[0];
    setPlace({
      name: near && near.km < 150 ? (near.airport.city || near.airport.name) : 'Your location',
      region: near && near.km < 150 ? 'near you' : `${lat}, ${lon}`,
      lat, lon, country: near ? near.airport.country : '', gps: true,
    });
  }, (err) => {
    buttons.forEach((b) => { b.disabled = false; });
    if (quiet) return;
    locateError(err.code === 1
      ? 'Location is blocked for this site. Search for a city, or allow location in your browser’s site settings and try again.'
      : 'We could not get your location just now. Search for a city, or try again.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60e3 });
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-locate]')) locate();
  const saved = e.target.closest('[data-saved]');
  if (saved) setPlace(store.get('gatecast:places', [])[+saved.dataset.saved]);
  const pop = e.target.closest('[data-popular]');
  if (pop) setPlace(POPULAR[+pop.dataset.popular]);
});

/* ---------- City search (combobox) ---------- */

const input = $('#place');
const listEl = $('#place-list');
let results = [];
let timer;
function closeList() { listEl.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
function choose(i) {
  const p = results[i];
  if (!p) return;
  input.value = '';
  closeList();
  input.blur();
  setPlace(p);
}
input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value;
  if (q.trim().length < 2) return closeList();
  timer = setTimeout(async () => {
    results = await searchPlaces(q);
    if (input.value !== q) return;
    listEl.innerHTML = results.length
      ? results.map((p, i) => `<li role="option" id="place-o${i}" data-i="${i}" aria-selected="${i === 0}"><span class="combo__name">${esc(p.name)}<small>${esc(p.region)}</small></span></li>`).join('')
      : '<li class="combo__empty" role="presentation">No place found. Check the spelling or try a nearby city.</li>';
    listEl.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (results.length) input.setAttribute('aria-activedescendant', 'place-o0');
  }, 250);
});
input.addEventListener('keydown', (e) => {
  const opts = [...listEl.querySelectorAll('[role=option]')];
  const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opts.length && !listEl.hidden) {
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    input.setAttribute('aria-activedescendant', opts[next].id);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (!listEl.hidden && cur >= 0) choose(+opts[cur].dataset.i);
  } else if (e.key === 'Escape') closeList();
});
listEl.addEventListener('pointerdown', (e) => {
  const o = e.target.closest('[role=option]');
  if (o) { e.preventDefault(); choose(+o.dataset.i); }
});
input.addEventListener('blur', () => setTimeout(closeList, 100));
$('#place-form').addEventListener('submit', (e) => e.preventDefault());
$('#popular').innerHTML = POPULAR.map((p, i) => `<button type="button" class="pill" data-popular="${i}">${esc(p.name)}</button>`).join('');

// "Change city" opens the search panel under the title bar; choosing a place (or Escape) closes it again.
// On a first visit it stays open: there is nothing else to show yet.
function openFinder(open, focus = false) {
  const keep = !state.place;
  const show = open || keep;
  findEl.hidden = !show;
  changeBtn.setAttribute('aria-expanded', String(show));
  changeBtn.hidden = keep;
  if (show && focus) input.focus();
}
changeBtn.addEventListener('click', () => openFinder(findEl.hidden, true));
findEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && listEl.hidden && state.place) { openFinder(false); changeBtn.focus(); } });
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-change-place]')) return;
  openFinder(true);
  setFold(true);
  $('#wxbox').scrollIntoView({ block: 'center' });
  input.focus({ preventScroll: true });
});

/* ---------- Loading ---------- */

async function loadPlace() {
  const mine = state.place;
  state.wx = null; state.wxError = null; state.alerts = []; state.airports = null; state.since = null; state.faa = [];
  destroyRadar();
  loadBrief(mine); // headlines do not wait for the forecast
  render();
  try {
    const wx = await loadWeather(mine.lat, mine.lon);
    if (state.place !== mine) return;
    state.wx = wx;
    state.since = notePlace(mine, wx);
    render();
    // First forecast of this visit: a short staggered arrival (once per page load). The temperature
    // counts up only on the first visit of the day; a returning visitor reads it at once.
    enter(document.documentElement, { countUp: firstCountToday });
    if (jumpTo) { $(jumpTo)?.scrollIntoView(); jumpTo = null; }
    enrich(mine);
  } catch (err) {
    if (state.place !== mine) return;
    state.wxError = err.message === 'rate' ? 'rate' : 'forecast';
    render();
  }
}

// Fills in what the forecast does not need to wait for: alerts and the nearest airports' risk. The airport
// list (large) is fetched only here, for "Use my location" and for a saved trip, never before the forecast.
async function enrich(mine) {
  const near = loadAirports().then(() => {
    // Large airports within 150 km first, then the nearest with any airline service.
    const large = nearestAirports(mine.lat, mine.lon, 3, 2).filter((x) => x.km < 150);
    const others = nearestAirports(mine.lat, mine.lon, 3, 1).filter((x) => x.km < 300 && !large.some((l) => l.airport.code === x.airport.code));
    return [...large, ...others].slice(0, 3);
  }, () => []);
  const alerts = (mine.country ? Promise.resolve(mine.country) : near.then((n) => n[0] && n[0].airport.country))
    .then((country) => loadAlerts({ lat: mine.lat, lon: mine.lon, country }))
    .then((list) => {
      if (state.place !== mine) return;
      state.alerts = list;
      noteBrief('alerts', list.map(alertKey));
      renderAlerts(); renderBrief();
    });
  const fly = near.then(async (list) => {
    const fc = list.length ? await loadForecasts(list.map((x) => x.airport)).catch(() => null) : null;
    if (state.place !== mine) return;
    const now = Date.now();
    state.airports = list.map((x) => ({ ...x, code: x.airport.code, risk: assessWindow(fc ? fc.forecasts.get(x.airport.code) || [] : [], now, now + 3 * HOUR) }));
    renderToday();
    renderBrief();
    loadPlans(mine, list.map((x) => x.airport));
  });
  await Promise.all([alerts, fly]);
}

// What the FAA plans today at the nearby US airports. data.js may not have loadFaaPlans yet (it arrives with the
// FAA work); without it, or when the request fails, the card simply has no plan lines.
async function loadPlans(mine, airports) {
  const us = airports.filter((a) => a.country === 'US');
  if (!us.length) return;
  try {
    const m = await import('./data.js');
    if (typeof m.loadFaaPlans !== 'function') return;
    const got = await m.loadFaaPlans(us.map((a) => a.code));
    if (state.place !== mine || !Array.isArray(got?.plans)) return;
    state.faa = got.plans;
    renderToday();
  } catch {}
}

// The saved trip that departs within 72 hours (or is under way) leads the page.
async function checkTrip() {
  const recents = store.get('gatecast:recent', []);
  if (!mightBeSoon(recents)) return;
  state.trip = { status: 'pending' }; // the hero holds "Checking your trip" until the airport list says otherwise
  const done = () => { state.trip = { status: 'none' }; render(); };
  try { await loadAirports(); } catch { return done(); }
  const soon = upcomingTrip(recents, airport);
  if (!soon) return done();
  const route = soon.trip.r;
  state.trip = { status: 'checking', ...soon, route };
  render();
  try {
    const { forecasts } = await loadForecasts(soon.airports);
    const now = Date.now();
    // Plan again at the moment of assessing so "under way" and confidence use the current time.
    const plan = planTrip(soon.airports, soon.trip.t, soon.trip.l.map((m) => m || 90), soon.trip.d);
    state.trip = { status: 'ready', ...soon, plan, route, result: assessTrip(plan, forecasts, now) };
  } catch {
    state.trip = { status: 'failed', ...soon, route };
  }
  render();
}

// The temperature counts up on the first forecast of the day on this device, then never again that day.
// Without storage there is no way to know, so the number is simply shown.
function firstCountToday() {
  const d = new Date(), key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (store.get('gatecast:counted', '') === key) return false;
  store.set('gatecast:counted', key);
  return store.get('gatecast:counted', '') === key;
}

/* ---------- Render ---------- */

function render() {
  const { place, wx, wxError } = state;
  const mode = place && wxError ? 'error' : place && wx ? 'weather' : place ? 'loading' : 'first';
  document.documentElement.dataset.start = mode;
  if (!place) openFinder(true); else if (changeBtn.hidden) openFinder(false);
  $('#wx-place').textContent = place ? ` · ${(place.name === 'Your location' ? 'Your area' : place.name).toUpperCase()}` : '';
  miniEl.textContent = mode === 'weather' ? `${fmt().temp(wx.now.temp)} · ${describeCode(wx.now.code).text}` : '';
  if (!boxEl.classList.contains('wxbox--open')) setFold(false); // relabel the button for the new state
  renderSky();
  heroEl.innerHTML = HERO[mode]();
  heroEl.dataset.mode = mode;
  renderSince();
  renderFly();
  renderToday();
  renderBrief();
  // The edition strip (js/front.js) names the place.
  document.dispatchEvent(new CustomEvent('gatecast:place', { detail: place ? { name: place.name === 'Your location' ? '' : place.name } : null }));
}

function renderSky() {
  const wx = state.wx;
  if (!wx) return;
  const now = wx.now, today = wx.days[0];
  const kind = skyOf(now.code, now.day);
  sky.className = `sky sky--${kind} wxbox__screen`;
  // The animated sky follows the same conditions as the flat colour behind it.
  const hrs = wx.hours.slice(0, 3);
  setSky({
    kind, day: !!now.day, code: now.code,
    wind: now.wind, gust: now.gust, precip: Math.max(now.precip ?? 0, ...hrs.map((h) => h.precip ?? 0)),
    temp: now.temp, now: Date.now(), sunrise: today.sunrise, sunset: today.sunset,
  });
}

const ARROW = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LINK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const tripUrl = (t) => `trip${tripQuery(t)}`;

// When the trip leaves, in the first airport's own time: "Today 09:15 GMT", "Tomorrow 07:40 CET", "Thu 19 Nov 06:00 EST".
function tripWhen(plan) {
  const tz = plan.stops[0].airport.tz, now = Date.now(), start = plan.start;
  const t = `${fmtTime(start, tz)} ${fmtZone(start, tz)}`;
  if (start < now) return `Under way, left ${t}`;
  const days = Math.round((Date.parse(dayKey(start, tz)) - Date.parse(dayKey(now, tz))) / (24 * HOUR));
  return `${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDay(start, tz)} ${t}`;
}

// "Since yesterday 18:40, the forecast changed: Tomorrow went Low → Elevated, strong gusts now 14:00–17:00."
// One line per day, calm and dismissible. Nothing at all when nothing material changed.
function sinceHTML(cls = '') {
  const c = state.since, wx = state.wx;
  if (!c || !wx) return '';
  const now = Date.now();
  const lines = c.changes.map((x) => changeLine(x, (id) => dayName(id, now, wx.tz)));
  return `<div class="since ${cls}" role="note" aria-label="Forecast changes since your last look">
    <svg class="icon since__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5"/></svg>
    <div class="since__text"><p class="since__lead">${esc(changeLead(c.since, now, viewerTz))} for ${esc(placeName(state.place))}:</p>
      <ul class="since__list">${lines.map((l) => `<li>${esc(l)}.</li>`).join('')}</ul></div>
    <button type="button" class="btn btn--icon since__close" data-dismiss="place" aria-label="Dismiss this note"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
  </div>`;
}

// Since the last look: one calm, dismissible note under the weather box's screen.
function renderSince() {
  const el = $('#wx-since');
  el.innerHTML = state.wx ? sinceHTML() : '';
  el.hidden = !el.innerHTML;
}

const TICK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5 5-5.5"/></svg>';

// What goes on the weather box's screen.
const HERO = {
  weather() {
    const { wx } = state, f = fmt(), now = wx.now;
    const said = headlineParts(wx, f);
    const hours = nextHours(wx, 8).map((h, i) => {
      const pop = h.pop ?? 0;
      const sr = `${i === 0 ? 'Now' : f.time(h.t)}: ${describeCode(h.code).text}, ${f.temp(h.temp)}, ${pop}% chance of rain or snow`;
      // Column labels are the hour alone, as on a departure board: "20", or "8PM" on a 12-hour clock.
      const c = f.clock(h.t), label = i === 0 ? 'NOW' : /^\d\d:00$/.test(c) ? c.slice(0, 2) : c.replace(/:00/, '').replace(/\s?([ap]m)$/i, (m, x) => x.toUpperCase());
      return `<li><span class="sr-only">${esc(sr)}</span><span class="wxnow__h" aria-hidden="true">${esc(label)}</span><b aria-hidden="true">${f.temp(h.temp)}</b><span class="wxnow__pop" aria-hidden="true">${pop}%</span></li>`;
    }).join('');
    return `<div class="wxnow__main"><p class="wxnow__temp now__temp">${f.temp(now.temp)}</p>
        <p class="wxnow__cond"><b>${esc(describeCode(now.code).text)}</b><span>${esc(said.lead)}${said.action ? ` ${esc(said.action)}` : ''}</span></p></div>
      <ol class="wxnow__hours" aria-label="Next 8 hours">${hours}</ol>
      <div class="wxnow__foot">${airportsLine()}${sunLine(wx, f)}</div>`;
  },
  loading() {
    return `<p class="wxnow__wait">Getting the forecast for ${esc(placeName(state.place))}…</p>`;
  },
  error() {
    const rate = state.wxError === 'rate';
    return `<div class="wxfirst"><p class="wxfirst__title">${rate ? 'The forecast service is busy' : 'We could not load the forecast'}</p>
      <p class="wxfirst__line">${rate ? 'The free forecast service has hit its request limit for this network. Try again in a little while.' : 'Check your connection and try again.'}</p>
      <button class="bev bev--sun" type="button" data-retry>Try again</button></div>`;
  },
  first() { return FIRST_HTML; },
};

// The airports near the place over the next 3 hours: calm reads as a quiet line with a tick; any risk is a chip
// (word, shape and colour). The full list with distances and FAA plans is on the weather desk below.
function airportsLine() {
  const list = state.airports;
  if (list == null) return '<p class="wxnow__air">Checking the airports near you…</p>';
  const known = list.filter((x) => x.risk.level !== 'unknown');
  if (!known.length) return '';
  const risky = known.filter((x) => x.risk.level === 'elevated' || x.risk.level === 'high');
  if (!risky.length) return `<p class="wxnow__air">${TICK}<span>${esc(known.map((x) => x.code).join(', '))} calm for 3 hours</span></p>`;
  const worst = risky.reduce((a, b) => (b.risk.score > a.risk.score ? b : a));
  return `<p class="wxnow__air wxnow__air--risk">${chip(worst.risk.level, LEVEL_LABEL[worst.risk.level])}<span>at ${esc(risky.map((x) => x.code).join(', '))} in the next 3 hours</span></p>`;
}
// "Air 34 · UV 2 · Sunset 16:35": only what the forecast included.
function sunLine(wx, f) {
  const today = wx.days?.[0], tomorrow = wx.days?.[1], now = Date.now(), parts = [];
  if (wx.air && wx.air.aqi != null) parts.push(`Air ${Math.round(wx.air.aqi)}`);
  const up = today?.sunset != null && now < today.sunset;
  if (up && today.uv != null) parts.push(`UV ${Math.round(today.uv)}`);
  if (up) parts.push(`Sunset ${f.clock(today.sunset)}`);
  else if (tomorrow?.sunrise != null) parts.push(`Sunrise ${f.clock(tomorrow.sunrise)}`);
  return parts.length ? `<p class="wxnow__sun">${esc(parts.join(' · '))}</p>` : '';
}

/* ---------- Flying? Check your trip ---------- */

// A saved trip within 72 hours (or under way) shows its verdict here; otherwise a From / To / Leaving form that
// opens the trip page with the check filled in.
function renderFly() {
  const t = state.trip, body = $('#fly-body'), form = $('#fly-form');
  let html = '';
  if (t.status === 'pending' || t.status === 'checking') {
    html = `<p class="flytrip__when">YOUR TRIP${t.route ? ` · ${t.route.map(esc).join(' · ')}` : ''}</p><p class="flytrip__body">Checking the forecast at each airport for the hours you are there…</p>`;
  } else if (t.status === 'failed') {
    html = `<a class="flytrip" href="${esc(tripUrl(t.trip))}"><span class="flytrip__route">${t.route.map(esc).join(' · ')}</span><span class="flytrip__go">Open ${ARROW}</span></a>
      <p class="flytrip__body">The forecast for this trip did not load just now.</p>`;
  } else if (t.status === 'ready') {
    const r = t.result, hl = r.headline, level = r.level;
    const word = level === 'unknown' ? 'No forecast' : level === 'low' ? 'Low' : LEVEL_LABEL[level];
    const estimated = t.plan.legs.some((l) => l.estimated);
    const o = r.worst ? stopOdds(r.worst, fmt().speed, { named: true }) : null;
    const said = o && (level !== 'low' || o.cause) ? `${LEVEL_LABEL[level]} · ${o.text}. ` : '';
    html = `<p class="flytrip__when">YOUR TRIP · ${esc(tripWhen(t.plan).toUpperCase())}</p>
      <a class="flytrip" href="${esc(tripUrl(t.trip))}"><span class="flytrip__route">${t.route.map(esc).join(' · ')}</span>${chip(level, word)}</a>
      <p class="flytrip__title">${esc(hl.title)}.</p>
      <p class="flytrip__body">${esc(hl.body)}</p>
      ${tripStrip(t)}
      <div class="flytrip__actions"><a class="bev bev--ink" href="${esc(tripUrl(t.trip))}">See the journey ${ARROW}</a>
        <button class="bev" type="button" data-copy="${esc(tripUrl(t.trip))}">${LINK}<span>Copy link</span></button></div>
      <p class="flytrip__note">${esc(said)}${esc(r.confidence.text)}${estimated ? ' Flight times are estimated from distance.' : ''}</p>`;
  }
  body.innerHTML = html;
  body.hidden = !html;
  form.hidden = Boolean(html);
}

// Your trip at a glance: each stop with its word and shape; calm stops stay grey.
function tripStrip(t) {
  const stops = t.result.stops;
  const word = (s) => (s.level === 'unknown' ? 'No forecast' : s.level === 'low' ? 'Calm' : LEVEL_LABEL[s.level]);
  return `<ol class="strip__list" aria-label="Your trip, stop by stop">${stops.map((s) => `<li class="strip__stop strip__stop--${s.level === 'low' ? 'calm' : s.level}">
      <span class="code">${s.airport.code}</span><span class="strip__lvl">${riskIcon(s.level === 'low' ? 'low' : s.level)}${word(s)}</span></li>`).join('<li class="strip__leg" aria-hidden="true"></li>')}</ol>`;
}

$('#fly-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = (id) => $(id).value.trim().toUpperCase();
  const from = code('#fly-from'), to = code('#fly-to'), when = $('#fly-when').value;
  const err = $('#fly-error');
  const bad = !/^[A-Z]{3}$/.test(from) ? ['#fly-from', 'Type the three-letter code of the airport you leave from, like JFK.']
    : !/^[A-Z]{3}$/.test(to) ? ['#fly-to', 'Type the three-letter code of the airport you fly to, like LHR.']
      : from === to ? ['#fly-to', 'From and To are the same airport.']
        : !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(when) ? ['#fly-when', 'Pick the date and time you leave.'] : null;
  for (const id of ['#fly-from', '#fly-to', '#fly-when']) $(id).removeAttribute('aria-invalid');
  err.hidden = !bad;
  err.textContent = bad ? bad[1] : '';
  if (bad) { $(bad[0]).setAttribute('aria-invalid', 'true'); $(bad[0]).focus(); return; }
  location.href = `trip${tripQuery({ r: [from, to], t: when, l: [], d: [] })}`;
});

/* ---------- Today in <place> ---------- */

function renderToday() {
  const { place: p, wx } = state;
  todayEl.hidden = !(p && wx);
  if (!p || !wx) return;
  const f = fmt();
  $('#today-title').textContent = p.name === 'Your location' ? 'Today where you are' : `Today in ${p.name}`;
  const saved = store.get('gatecast:places', []);
  $('#saved-places').innerHTML = saved.length > 1
    ? `<span class="sr-only">Your places:</span>${saved.map((x, i) => `<button type="button" class="pill${x.name === p.name && x.region === p.region ? ' is-current' : ''}" data-saved="${i}"${x.name === p.name && x.region === p.region ? ' aria-current="true"' : ''}>${esc(x.name)}</button>`).join('')}`
    : '';
  const cards = [commute(wx, f), carry(wx, f), airSun(wx, f), flightsNear(state.airports)].filter(Boolean);
  $('#means').innerHTML = cards.map((c) => meanCard(c, cardOdds(c, wx, f))).join('');
  if (!$('#days').dataset.for || $('#days').dataset.for !== `${p.lat},${p.lon},${prefs.temp},${prefs.clock}`) {
    $('#days').innerHTML = daysList(wx, f);
    $('#days').dataset.for = `${p.lat},${p.lon},${prefs.temp},${prefs.clock}`;
  }
  if (!radar && !$('#radar').dataset.ready) watchRadar();
}

// How likely and how bad, for the two cards that carry a risk level (js/riskwords.js). Calm with nothing behind
// it says nothing more; calm with a minor factor says "at most a nuisance".
function cardOdds(c, wx, f) {
  if (c.label === 'Your commute' && (c.level === 'elevated' || c.level === 'high')) {
    const H = nextHours(wx, 12);
    const risk = assessWindow(H, H[0].t, H[H.length - 1].t);
    return odds({ level: risk.level, factors: risk.factors, hours: risk.hours, speed: f.speed, where: ' in the next 12 hours' });
  }
  if (c.label === 'Flights near you' && (c.level === 'elevated' || c.level === 'high' || c.level === 'calm')) {
    const known = (state.airports || []).filter((x) => x.risk.level !== 'unknown');
    if (!known.length) return null;
    const worst = known.reduce((a, b) => (b.risk.score > a.risk.score ? b : a));
    const o = odds({ level: worst.risk.level, factors: worst.risk.factors, hours: worst.risk.hours, speed: f.speed, where: ` at ${worst.code} in the next 3 hours` });
    return o && (worst.risk.level !== 'low' || o.cause) ? o : null;
  }
  return null;
}

function meanCard(c, o = null) {
  const lvl = c.level;
  const risky = lvl === 'elevated' || lvl === 'high';
  const icon = lvl === 'calm' ? riskIcon('low') : risky || lvl === 'unknown' ? riskIcon(lvl) : '';
  const extra = c.label === 'Flights near you' ? nearList() : '';
  const word = risky ? LEVEL_LABEL[lvl] : 'Low';
  return `<li class="mean mean--${lvl}">
    <h3 class="mean__label">${esc(c.label)}</h3>
    <p class="mean__big">${icon}<span>${esc(c.big)}</span>${risky && c.label !== 'Flights near you' ? `<span class="sr-only"> (${LEVEL_LABEL[lvl].toLowerCase()} risk)</span>` : ''}${risky && c.label === 'Flights near you' ? '<span class="sr-only"> risk</span>' : ''}</p>
    ${o ? `<p class="mean__odds"><b>${word}</b> · ${esc(o.text)}</p>` : ''}
    <p class="mean__line">${esc(c.line)}</p>${extra}</li>`;
}

// "London Heathrow Airport" -> "Heathrow"; "Leeds Bradford International Airport" -> "Leeds Bradford".
function shortName(a) {
  let n = String(a.name || '').replace(/\s+(International\s+)?Airport$/i, '').trim();
  if (a.city && n.toLowerCase().startsWith(a.city.toLowerCase() + ' ') && n.length > a.city.length + 3) n = n.slice(a.city.length + 1);
  return n || a.city || a.code;
}

function nearList() {
  const list = state.airports;
  if (!list || !list.length) return '';
  const far = (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609)} mi` : `${Math.round(km)} km`);
  return `<ul class="near">${list.map(({ airport: a, km, risk }) => {
    const lvl = risk.level === 'low' ? 'calm' : risk.level;
    const word = risk.level === 'unknown' ? 'No forecast' : risk.level === 'low' ? 'Calm' : LEVEL_LABEL[risk.level];
    const plans = state.faa.filter((x) => x.airport === a.code || x.airport === a.icao).map((x) => faaPlanLine(x, (ms) => fmt().clock(ms))).filter(Boolean);
    return `<li><a href="flights?airport=${a.code}"><span class="code">${a.code}</span><span class="near__name">${esc(shortName(a))}<small>${far(km)}</small></span></a>
      <span class="near__lvl near__lvl--${lvl}">${riskIcon(risk.level === 'low' ? 'low' : risk.level)}${word}</span>
      ${plans.map((l) => `<p class="near__plan">${esc(l)}</p>`).join('')}</li>`;
  }).join('')}</ul>`;
}

function daysList(wx, f) {
  const lo = Math.min(...wx.days.map((x) => x.min)), span = Math.max(1, Math.max(...wx.days.map((x) => x.max)) - lo);
  return wx.days.map((x, i) => {
    const name = i === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { timeZone: f.tz, weekday: 'short', day: 'numeric' }).format(x.t + 12 * HOUR);
    const wet = (x.pop ?? 0) >= 20;
    return `<li class="day${i === 0 ? ' is-today' : ''}"><span class="day__name">${name}</span>
      <span class="day__sky">${weatherIcon(x.code, 1)}<span class="sr-only">${esc(describeCode(x.code).text)}</span></span>
      <span class="day__pop">${wet ? `${x.pop}%` : ''}<span class="sr-only">${wet ? ' chance of rain or snow' : 'Dry'}</span></span>
      <span class="day__min num"><span class="sr-only">Low </span>${f.temp(x.min)}</span>
      <span class="day__bar" aria-hidden="true"><i style="--from:${((x.min - lo) / span * 100).toFixed(1)}%;--to:${((x.max - lo) / span * 100).toFixed(1)}%"></i></span>
      <span class="day__max num"><span class="sr-only">High </span>${f.temp(x.max)}</span></li>`;
  }).join('');
}

function renderAlerts() {
  const { alerts, wx } = state;
  // One line per alert up here; the full alert (area, times, link to weather.gov) is in The brief below.
  $('#alerts').innerHTML = (alerts || []).map((al) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b>${al.ends ? ` until ${fmtTime(Date.parse(al.ends), wx?.tz)} ${esc(fmtDay(Date.parse(al.ends), wx?.tz))}` : ''}. <a href="#brief-weather">Details in the brief</a> <small>National Weather Service</small></span></p>`).join('');
}

/* ---------- The brief: weather news, headlines from the state's newsrooms, statehouse votes and Both sides ---------- */

const nwsStates = new Map();
// A US place saved without a region (a "Use my location" spot, an older saved city): ask weather.gov, which
// already receives this point for the alerts, which state it is in. null if it cannot say.
function nwsState(p) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  if (!nwsStates.has(key)) {
    nwsStates.set(key, fetch(`https://api.weather.gov/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const c = String(j?.properties?.relativeLocation?.properties?.state || '').toUpperCase(); return US_STATES[c] ? c : null; })
      .catch(() => null));
  }
  return nwsStates.get(key);
}

async function loadBrief(mine) {
  const b = { place: mine, us: isUS(mine), code: stateOf(mine), news: null, look: startLook(seenGet('brief', placeKey(mine)), Date.now()) };
  state.brief = b;
  if (!b.code && b.us) b.code = await nwsState(mine);
  if (state.brief !== b) return;
  renderBrief();
  // Served by server.js or the Vercel function; on a static host this fails and the headlines stay hidden.
  const json = await fetch(`api/news${b.code ? `?state=${b.code}` : ''}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (state.brief !== b) return;
  b.news = { state: US_STATES[json?.state] ? json.state : null, items: cleanHeadlines(json) };
  if (json) noteBrief('headlines', b.news.items.map((x) => x.url)); // a failed request is not "no headlines"
  renderBrief();
}

// Records what this look at the brief shows, one kind at a time as each arrives (js/changes.js).
function noteBrief(kind, ids) {
  const b = state.brief;
  if (!b || b.place !== state.place) return;
  noteKind(b.look, kind, ids, Date.now());
  seenSet('brief', placeKey(b.place), lookEntry(b.look));
  renderBriefNew();
}
function renderBriefNew() {
  const el = $('#brief-new'), b = state.brief;
  const said = b && b.place === state.place ? briefNews(b.look, Date.now()) : null;
  el.hidden = !said;
  el.innerHTML = said ? `<p><b>${esc(said.line)}</b><span class="brief__new-since"> · last look ${esc(sinceLabel(said.since, Date.now(), viewerTz))}</span></p>
    <button type="button" class="btn btn--icon" data-dismiss="brief" aria-label="Dismiss this note"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : '';
}
// Statehouse votes and Both sides topics as js/civic.js drew them: each item's own key when it carries one
// (data-key), else its bill and chamber line, or its title and date.
function civicIds(root) {
  const key = (el, ...sel) => el.dataset.key || sel.map((q) => el.querySelector(q)?.textContent.trim() || '').join('|');
  return {
    votes: [...root.querySelectorAll('.vote')].map((el) => key(el, '.vote__bill', '.civic-meta')),
    topics: [...root.querySelectorAll('.topic')].map((el) => key(el, '.topic__title', '.civic__eyebrow')),
  };
}

const NWS_PAGE = (p) => `https://forecast.weather.gov/MapClick.php?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
const at = (ms, tz) => `${fmtTime(ms, tz)} ${fmtDay(ms, tz)}`;

// The time an alert starts or ends, with the weekday when it is not today: "18:00", "06:00 Tue".
function alertWhen(ms, tz) {
  const t = fmtTime(ms, tz);
  return dayKey(ms, tz) === dayKey(Date.now(), tz) ? t : `${t} ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(ms)}`;
}
// A saved trip leaving from an airport within 100 km of the place, for "during your 16:10 departure".
function nearDeparture(p) {
  const t = state.trip;
  if (t.status !== 'ready') return null;
  const a = t.plan.stops[0].airport;
  return distanceKm(a, p) < 100 ? { t: t.plan.start, code: a.code } : null;
}

function alertItem(a, p, tz) {
  const soon = a.from && a.from > Date.now();
  const when = soon ? `From ${at(a.from, tz)}${a.until ? ` until ${at(a.until, tz)}` : ''}` : a.until ? `Until ${at(a.until, tz)}` : 'In effect now';
  return `<li class="wxnews wxnews--${a.level}">
    <p class="wxnews__head">${riskIcon(a.level)}<span>${esc(a.event)}</span><span class="sr-only"> (${LEVEL_LABEL[a.level].toLowerCase()} risk)</span></p>
    <p class="wxnews__when">${esc(when)}</p>
    ${a.area ? `<p class="wxnews__area">${esc(a.area)}</p>` : ''}
    ${a.headline ? `<p class="wxnews__line">${esc(a.headline)}</p>` : ''}
    <p class="because">${esc(alertReason(a, p, (ms) => alertWhen(ms, tz), nearDeparture(p)))}</p>
    <p class="wxnews__foot"><span>National Weather Service</span><a href="${NWS_PAGE(p)}" rel="noopener">Read it on weather.gov</a></p>
  </li>`;
}
function signalItem(s) {
  return `<li class="wxnews wxnews--${s.level}">
    <p class="wxnews__head">${riskIcon(s.level)}<span>${esc(s.title)}</span><span class="sr-only"> (${LEVEL_LABEL[s.level].toLowerCase()} risk)</span></p>
    <p class="wxnews__line">${esc(s.line)}</p>
    ${s.because ? `<p class="because">${esc(s.because)}</p>` : ''}
    <p class="wxnews__foot"><span>Gatecast forecast check</span><a href="flights?airport=${s.code}">Flights at ${s.code}</a></p>
  </li>`;
}
// Headlines as a news module: a lead story, compact rows beside it, cards under both (arrangeHeadlines).
// Pictures are the publisher's own link-preview image, hotlinked from their site and credited. The headline is
// the one link a keyboard or screen reader meets; the picture repeats that link for the mouse and touch only
// (out of the tab order, hidden from assistive tech), so its alt is empty instead of reading the headline twice.
// A headline without a picture has no picture slot at all (head--noimg): the text takes the space, never a stand-in.
function storyMedia(x, kind) {
  const [rw, rh] = kind === 'row' ? [4, 3] : [16, 9];
  const im = x.image;
  if (!im) return '';
  return `<a class="head__media" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${esc(im.url)}" alt="" width="${im.width || rw * 100}" height="${im.height || rh * 100}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="head__credit">Image: ${esc(x.outlet)}</span></a>`;
}
function headlineItem(x, now, kind, extra = '') {
  const ms = Date.parse(x.published);
  const full = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: state.wx?.tz }).format(ms);
  return `<li class="head head--${kind}${x.image ? '' : ' head--noimg'}"${extra}>
    ${storyMedia(x, kind)}
    <div class="head__body">
      <a class="head__link" href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>
      <p class="head__meta"><span class="head__outlet">${esc(x.outlet)}</span><time datetime="${esc(x.published)}" title="${esc(full)}">${esc(relTime(ms, now))}</time></p>
    </div>
  </li>`;
}
function headlinesHtml(items, now) {
  const { lead, rows, cards } = arrangeHeadlines(items);
  if (!lead) return '';
  // The lead spans as many grid rows as there are compact rows beside it; cards share their row evenly.
  const span = cards.length ? Math.max(3, Math.round(12 / cards.length)) : 3;
  return headlineItem(lead, now, rows.length ? 'lead' : 'solo', ` style="--rows: ${Math.max(1, rows.length)}"`)
    + rows.map((x) => headlineItem(x, now, 'row')).join('')
    + cards.map((x) => headlineItem(x, now, 'card', ` style="--span: ${span}"`)).join('');
}
// A picture that fails to load (blocked, gone, hotlinking refused) or turns out to be a pixel is removed, and the
// headline takes its space: never a broken-image icon, never a stand-in. error and load do not bubble, so they are
// caught on the way down.
function noPicture(img) {
  const box = img.closest('.head__media');
  if (!box) return;
  box.closest('.head')?.classList.add('head--noimg');
  box.remove();
}
const newsList = $('#brief-news-list');
if (newsList) {
  newsList.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) noPicture(e.target); }, true);
  newsList.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.naturalWidth < 80 && img.naturalHeight < 80) noPicture(img);
  }, true);
}

let civicFor = null;
function renderBrief() {
  const el = $('#brief'), b = state.brief, p = state.place;
  if (!p || !b || b.place !== p) { el.hidden = true; syncBrief(); return; }
  const now = Date.now();
  // Weather news: the place's NWS alerts, then one forecast item only when a nearby airport is at risk.
  const wx = [...alertItems(state.alerts, now).map((a) => alertItem(a, p, state.wx?.tz))];
  const sig = airportSignal(state.airports, (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609)} miles` : `${Math.round(km)} km`));
  if (sig) wx.push(signalItem(sig));
  $('#brief-weather-list').innerHTML = wx.join('');
  $('#brief-weather').hidden = !wx.length;
  // Headlines: the state's newsrooms for a US place we can place in a state, otherwise the national list.
  const local = Boolean(b.us && b.code);
  const n = b.news;
  const showNews = Boolean(n && n.items.length && (!n.state || (local && n.state === b.code)));
  $('#brief-news').hidden = !showNews;
  if (showNews) {
    $('#brief-news-title').textContent = n.state ? `Headlines in ${US_STATES[n.state]}` : 'Weather and travel headlines';
    $('#brief-news-why').textContent = newsReason(p, b.us, b.code, n.state);
    $('#brief-news-list').innerHTML = headlinesHtml(n.items, now);
    const pictures = n.items.some((x) => x.image);
    $('#brief-news-source').textContent = `Headlines from ${n.state ? 'local' : 'weather and aviation'} newsrooms. We link to their reporting; we don’t copy it.`
      + (pictures ? ' Pictures are each outlet’s own preview image and load from its site.' : '');
  }
  // Statehouse votes and Both sides: js/civic.js, US places with a known state only. It reveals itself when it
  // has something to show; if the module is missing or fails, the block stays hidden and nothing else breaks.
  // Political items keep the order they are published in: votes newest first as recorded, Both sides topics newest
  // first (js/civicmodel.js votesPath and topicsPath). Nothing here reorders them, and nothing is ranked by clicks.
  const civic = $('#civic');
  if (local && civicFor !== b.code) {
    civicFor = b.code;
    const why = civicReason(p, b.code);
    import('./civic.js')
      .then((m) => m.mountCivic(civic, { state: b.code }))
      .then((shown) => {
        if (civicFor === null) { civic.hidden = true; civic.innerHTML = ''; return; } // left the US meanwhile
        if (!shown || state.brief !== b) return;
        civic.insertAdjacentHTML('afterbegin', `<p class="because brief__why-civic">${esc(why)}</p>`);
        const ids = civicIds(civic);
        noteBrief('votes', ids.votes);
        noteBrief('topics', ids.topics);
      })
      .catch(() => { civic.hidden = true; })
      .finally(syncBrief);
  } else if (!local && civicFor !== null) {
    civicFor = null;
    civic.hidden = true;
    civic.innerHTML = '';
  }
  renderBriefNew();
  syncBrief();
}
// The brief shows only when one of its blocks has something in it.
function syncBrief() {
  const el = $('#brief'), p = state.place;
  el.hidden = !(p && state.brief && state.brief.place === p)
    || ($('#brief-weather').hidden && $('#brief-news').hidden && $('#civic').hidden);
  const empty = $('#near-empty');
  empty.hidden = !el.hidden;
  empty.textContent = !p ? 'Pick a place in the weather box and the brief fills with real headlines, official alerts and statehouse votes from there.'
    : 'Nothing in the brief for this place right now: no official alerts, and no headlines we can place here.';
  $('#near-kicker').textContent = p ? `NEAR YOU · ${(p.name === 'Your location' ? 'WHERE YOU ARE' : p.name).toUpperCase()}` : 'NEAR YOU · REAL HEADLINES, ALERTS AND VOTES';
}

/* ---------- Actions: copy the trip link, try again ---------- */

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const label = copy.querySelector('span');
    const url = new URL(copy.dataset.copy, location.href).href;
    try { await navigator.clipboard.writeText(url); label.textContent = 'Link copied'; } catch { label.textContent = 'Copy failed: open the journey and copy its address'; }
    setTimeout(() => { if (label.isConnected) label.textContent = 'Copy link'; }, 2500);
  }
  if (e.target.closest('[data-retry]')) loadPlace();
  const gone = e.target.closest('[data-dismiss]');
  if (gone && gone.dataset.dismiss === 'place' && state.since) {
    seenSet('places', state.since.key, dismiss(seenGet('places', state.since.key)));
    state.since = null;
    render();
    focusQuietly($('#wx-h'));
  } else if (gone && gone.dataset.dismiss === 'brief' && state.brief) {
    state.brief.look = dismissLook(state.brief.look, Date.now());
    seenSet('brief', placeKey(state.brief.place), lookEntry(state.brief.look));
    renderBriefNew();
    focusQuietly($('#brief-title'));
  }
});
// After a dismissed note disappears, keyboard focus lands on the heading it belonged to, not on the page top.
function focusQuietly(el) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/* ---------- Radar (map library and tiles load only when the panel is near the screen) ---------- */

let radarObserver;
function destroyRadar() {
  if (radar) { clearInterval(radar.timer); radar.map.remove(); radar = null; }
  if (radarObserver) radarObserver.disconnect();
  const el = $('#radar');
  delete el.dataset.ready;
  el.innerHTML = '<p class="radar__placeholder">Radar loads when you scroll here.</p>';
  $('#radar-play').disabled = true; $('#radar-frame').disabled = true; $('#radar-time').textContent = '';
}
function watchRadar() {
  const el = $('#radar');
  el.dataset.ready = 'watching';
  radarObserver = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) { radarObserver.disconnect(); startRadar(el).catch(() => { el.innerHTML = '<p class="radar__placeholder">Radar is unavailable right now.</p>'; }); }
  }, { rootMargin: '400px' });
  radarObserver.observe(el);
}
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.append(css);
    const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L); js.onerror = reject; document.head.append(js);
  });
}
async function startRadar(el) {
  const p = state.place, wx = state.wx;
  const [L, meta] = await Promise.all([loadLeaflet(), fetch('https://api.rainviewer.com/public/weather-maps.json').then((r) => r.json())]);
  if (state.place !== p || !el.isConnected) return;
  el.innerHTML = '';
  const map = L.map(el, { center: [p.lat, p.lon], zoom: 6, minZoom: 3, maxZoom: 9, scrollWheelZoom: false, attributionControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors · Radar: RainViewer', maxZoom: 9 }).addTo(map);
  const css = getComputedStyle(document.documentElement);
  L.circleMarker([p.lat, p.lon], { radius: 6, weight: 2, color: css.getPropertyValue('--paper-50').trim(), fillColor: css.getPropertyValue('--ink-900').trim(), fillOpacity: 1 }).addTo(map);
  const frames = (meta.radar && meta.radar.past) || [];
  if (!frames.length) throw new Error('no frames');
  const layers = frames.map((fr) => L.tileLayer(`${meta.host}${fr.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7, maxZoom: 9, tileSize: 256 }));
  const slider = $('#radar-frame'), play = $('#radar-play'), label = $('#radar-time');
  let shown = -1;
  const showFrame = (i) => {
    if (!map.hasLayer(layers[i])) layers[i].addTo(map);
    if (shown >= 0 && shown !== i) layers[shown].setOpacity(0);
    layers[i].setOpacity(0.7);
    shown = i; slider.value = i;
    label.textContent = fmtTime(frames[i].time * 1000, wx.tz);
  };
  slider.max = frames.length - 1; slider.disabled = false; play.disabled = false;
  showFrame(frames.length - 1);
  radar = { map, timer: null, relabel: () => { if (shown >= 0) label.textContent = fmtTime(frames[shown].time * 1000, wx.tz); } };
  const stop = () => { clearInterval(radar.timer); radar.timer = null; play.textContent = 'Play last 2 hours'; };
  slider.oninput = () => { stop(); showFrame(+slider.value); };
  play.onclick = () => {
    if (radar.timer) return stop();
    play.textContent = 'Pause';
    let i = 0;
    showFrame(0);
    radar.timer = setInterval(() => { i += 1; if (i >= frames.length) { stop(); return; } showFrame(i); }, 600);
  };
}

/* ---------- Start ---------- */

function rerender() {
  delete $('#days').dataset.for;
  render();
  if (state.wx) renderAlerts(); // alert end times follow the clock setting
  radar?.relabel(); // so does the radar frame time
}

async function start() {
  initSettings(rerender);
  initSky($('#sky-canvas'));
  openFinder(!state.place);
  // Links to boxes on the old board (#tile-radar and friends) land on the matching section.
  if (location.hash.startsWith('#tile-')) {
    jumpTo = { '#tile-radar': '#radar-panel', '#tile-days': '#days-panel' }[location.hash] || null;
    history.replaceState(null, '', jumpTo || location.pathname + location.search);
  }
  checkTrip();
  if (state.place) return loadPlace();
  render();
  // If location was already allowed on an earlier visit, use it without asking again.
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted') locate(true);
  } catch {}
}
start();
