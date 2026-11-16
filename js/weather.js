// Today (index.html): a sky hero that adapts to the visitor (a trip within 72 hours, the weather where they are,
// or a first visit), a glass card with the weather here and the next 8 hours, then what today means, 10 days
// and the rain radar. Pure wording and rules live in js/today.js and js/boardcontent.js.
import { planTrip, assessTrip, assessWindow, describeCode, fmtTime, fmtDay, fmtZone, HOUR, LEVEL_LABEL } from './core.js';
import { headlineParts, dayKey, skyOf } from './boardcontent.js';
import { upcomingTrip, mightBeSoon, tripQuery, commute, carry, airSun, flightsNear, nextHours } from './today.js';
import { loadAirports, airport, searchPlaces, nearestAirports, loadWeather, loadForecasts, loadAlerts } from './data.js';
import { $, store, prefs, initSettings } from './shell.js';
import { initSky, setSky } from './sky.js';
import { esc, weatherIcon, riskIcon, chip, units, compass } from './ui.js';
import { enter } from './motion.js';

const POPULAR = [
  { name: 'New York', region: 'United States', lat: 40.713, lon: -74.006, country: 'US' },
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
const nowEl = $('#now');
const firstEl = $('#first');
const todayEl = $('#today');
const finder = $('#finder');

// Everything the page shows comes from this; render() decides what goes where.
const state = {
  place: store.get('gatecast:place', null),
  wx: null, wxError: null,       // local forecast, or 'rate' / 'forecast'
  alerts: [], airports: null,     // NWS alerts; nearest airports with their next-3-hour risk (null while loading)
  trip: { status: 'none' },       // 'none' | 'checking' | 'ready' | 'failed', with { trip, plan, result, route }
};
if (state.place && !(Number.isFinite(state.place.lat) && Number.isFinite(state.place.lon))) state.place = null;
let radar = null;
let jumpTo = null; // a section to scroll to once the forecast is on screen (old #tile- links)

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
  window.scrollTo(0, 0); // the answer for the new place is at the top of the page
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

/* ---------- Loading ---------- */

async function loadPlace() {
  const mine = state.place;
  state.wx = null; state.wxError = null; state.alerts = []; state.airports = null;
  destroyRadar();
  render();
  try {
    const wx = await loadWeather(mine.lat, mine.lon);
    if (state.place !== mine) return;
    state.wx = wx;
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
    .then((list) => { if (state.place === mine) { state.alerts = list; renderAlerts(); } });
  const fly = near.then(async (list) => {
    const fc = list.length ? await loadForecasts(list.map((x) => x.airport)).catch(() => null) : null;
    if (state.place !== mine) return;
    const now = Date.now();
    state.airports = list.map((x) => ({ ...x, code: x.airport.code, risk: assessWindow(fc ? fc.forecasts.get(x.airport.code) || [] : [], now, now + 3 * HOUR) }));
    renderToday();
  });
  await Promise.all([alerts, fly]);
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
  const { place, wx, wxError, trip } = state;
  const mode = trip.status === 'ready' || trip.status === 'checking' || trip.status === 'pending' ? 'trip'
    : place && wxError ? 'error' : place && wx ? 'weather' : place ? 'loading' : 'first';
  document.documentElement.dataset.start = mode;
  // First visit: the search sits in the hero beside the location button; otherwise it lives in the header.
  const slot = mode === 'first' ? $('#find-first') : $('#find-header');
  if (finder.parentElement !== slot) slot.append(finder);
  firstEl.hidden = mode !== 'first';
  renderSky();
  heroEl.innerHTML = HERO[mode]();
  heroEl.dataset.mode = mode;
  renderNow(mode);
  renderToday();
}

function renderSky() {
  const wx = state.wx;
  if (!wx) return;
  const now = wx.now, today = wx.days[0];
  const kind = skyOf(now.code, now.day);
  sky.className = `sky sky--${kind}`;
  // The animated sky follows the same conditions as the flat colour behind it.
  const hrs = wx.hours.slice(0, 3);
  setSky({
    kind, day: !!now.day, code: now.code,
    wind: now.wind, gust: now.gust, precip: Math.max(now.precip ?? 0, ...hrs.map((h) => h.precip ?? 0)),
    temp: now.temp, now: Date.now(), sunrise: today.sunrise, sunset: today.sunset,
  });
}

// Long sentences get a smaller poster size so the hero never runs past four or five lines.
const sizeOf = (text) => (text.length <= 26 ? 'l' : text.length <= 44 ? 'm' : 's');
const ARROW = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LINK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const tripUrl = (t) => `trip.html${tripQuery(t)}`;

function placeLine(p, tz) {
  const now = Date.now(), f = fmt(tz);
  return `${esc(p.name === 'Your location' ? 'Where you are' : p.name)} · ${esc(fmtDay(now, tz))} · ${f.clock(now)} ${esc(fmtZone(now, tz))}`;
}

// When the trip leaves, in the first airport's own time: "Today 09:15 GMT", "Tomorrow 07:40 CET", "Thu 19 Nov 06:00 EST".
function tripWhen(plan) {
  const tz = plan.stops[0].airport.tz, now = Date.now(), start = plan.start;
  const t = `${fmtTime(start, tz)} ${fmtZone(start, tz)}`;
  if (start < now) return `Under way, left ${t}`;
  const days = Math.round((Date.parse(dayKey(start, tz)) - Date.parse(dayKey(now, tz))) / (24 * HOUR));
  return `${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDay(start, tz)} ${t}`;
}

const HERO = {
  trip() {
    const t = state.trip;
    const eyebrow = t.plan ? `Your trip · ${esc(tripWhen(t.plan))} · ${t.route.map(esc).join(' · ')}` : 'Your trip';
    if (t.status !== 'ready') {
      return `<p class="hero__eyebrow signage">${eyebrow}</p>
        <h1 class="hero__title hero__title--m">Checking your trip…</h1>
        <p class="hero__line">Lining up the forecast at each airport with the hours you are there.</p>`;
    }
    const r = t.result, hl = r.headline;
    const level = r.level;
    const estimated = t.plan.legs.some((l) => l.estimated);
    return `<p class="hero__eyebrow"><span class="hero__chip">${chip(level, level === 'unknown' ? 'No forecast' : level === 'low' ? 'Low risk' : `${LEVEL_LABEL[level]} risk`)}</span><span class="signage">${eyebrow}</span></p>
      <h1 class="hero__title hero__title--${sizeOf(hl.title)}">${esc(hl.title)}.</h1>
      <p class="hero__line">${esc(hl.body)}</p>
      <div class="hero__actions">
        <a class="btn btn--sun" href="${esc(tripUrl(t.trip))}">See the journey ${ARROW}</a>
        <button class="btn btn--glass" type="button" data-copy="${esc(tripUrl(t.trip))}">${LINK}<span>Copy link</span></button>
      </div>
      <p class="hero__note">${esc(r.confidence.text)}${estimated ? ' Flight times are estimated from distance.' : ''}</p>`;
  },
  weather() {
    const { place: p, wx } = state;
    const said = headlineParts(wx, fmt());
    const t = state.trip;
    const tripLink = t.status === 'failed'
      ? `<a class="btn btn--glass" href="${esc(tripUrl(t.trip))}">Your trip: ${t.route.map(esc).join(' · ')} ${ARROW}</a>`
      : `<a class="btn btn--glass" href="trip.html">Flying soon? Check a trip ${ARROW}</a>`;
    return `<p class="hero__eyebrow signage">${placeLine(p, wx.tz)}</p>
      <h1 class="hero__title hero__title--${sizeOf(said.lead)}">${esc(said.lead)} <span class="hero__action">${esc(said.action)}</span></h1>
      <div class="hero__actions">${tripLink}</div>`;
  },
  loading() {
    return `<p class="hero__eyebrow signage">${esc(state.place.name === 'Your location' ? 'Where you are' : state.place.name)}</p>
      <h1 class="hero__title hero__title--m hero__title--quiet">Getting the forecast…</h1>`;
  },
  error() {
    const rate = state.wxError === 'rate';
    return `<p class="hero__eyebrow signage">${esc(state.place.name === 'Your location' ? 'Where you are' : state.place.name)}</p>
      <h1 class="hero__title hero__title--m">${rate ? 'The forecast service is busy' : 'We could not load the forecast'}</h1>
      <p class="hero__line">${rate ? 'The free forecast service has hit its request limit for this network. Try again in a little while.' : 'Check your connection and try again.'}</p>
      <div class="hero__actions"><button class="btn btn--sun" type="button" data-retry>Try again</button>
        <a class="btn btn--glass" href="trip.html">Check a trip instead ${ARROW}</a></div>`;
  },
  first() {
    return `<h1 class="hero__title hero__title--l">Will the weather mess up your trip?</h1>
      <p class="hero__line">Gatecast checks every airport on your journey against the forecast, and tells you what today’s weather means where you are.</p>`;
  },
};

/* ---------- The glass card: weather here now, the next 8 hours, the trip at a glance ---------- */

function renderNow(mode) {
  const { place, wx, wxError, trip } = state;
  const parts = [];
  const WAIT = '<div class="now__wait" aria-hidden="true"><span></span><span></span><span></span></div>';
  if (place && wx) parts.push(nowCard(mode));
  else if (place && wxError) {
    // In the weather modes the hero carries the error; beside a trip, say it here.
    if (mode === 'trip') parts.push(`<p class="now__msg">${wxError === 'rate' ? 'The forecast service is busy, so the weather here is not shown yet.' : 'The weather here did not load.'}</p><button class="btn btn--glass" type="button" data-retry>Try again</button>`);
  } else if (place) parts.push(WAIT);
  else if (mode === 'first') parts.push(FIRST_CARD);
  else if (mode === 'trip') {
    parts.push(`<div class="now__ask"><p class="now__title signage">Weather where you are</p><p>Share your location or search for a city to see today’s weather here.</p>
      <button type="button" class="btn btn--glass" data-locate>${LOCATE_ICON} Use my location</button></div>`);
  }
  if (trip.status === 'ready') parts.push(tripStrip(trip));
  nowEl.hidden = !parts.length;
  nowEl.setAttribute('aria-label', place && wx ? `Weather in ${placeName(place)} now` : mode === 'first' ? 'What Gatecast tells you' : 'Your trip');
  nowEl.innerHTML = parts.join('');
}
// First visit: what the page will show, so the card is useful before Gatecast knows where you are.
const FIRST_CARD = `<p class="now__title signage">What you get</p>
  <ul class="now__why">
    <li><b>Your trip in one sentence</b><span>Every airport and connection checked against the forecast for the hours you are there.</span></li>
    <li><b>Today where you are</b><span>What the weather means for your commute, what to take, and the airports near you.</span></li>
    <li><b>Free, no account</b><span>Your places and trips stay on this device.</span></li>
  </ul>`;
const LOCATE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

function nowCard(mode) {
  const { place: p, wx } = state, f = fmt(), now = wx.now;
  // In the trip hero the local headline has nowhere else to go, so it is the card's sentence.
  const sentence = mode === 'trip' ? headlineParts(wx, f).lead
    : `Feels like ${f.temp(now.feels)}. Wind ${f.speed(now.wind)} ${compass(now.dir)}${(now.gust ?? 0) >= 40 ? `, gusts ${f.speed(now.gust)}` : ''}.`;
  const hours = nextHours(wx, 8).map((h, i) => {
    const pop = h.pop ?? 0;
    const sr = `${i === 0 ? 'Now' : f.time(h.t)}: ${describeCode(h.code).text}, ${f.temp(h.temp)}, ${pop}% chance of rain or snow`;
    return `<li><span class="sr-only">${esc(sr)}</span><span class="now__h" aria-hidden="true">${i === 0 ? 'Now' : f.clock(h.t)}</span>
      <b aria-hidden="true">${f.temp(h.temp)}</b><span class="now__bar" aria-hidden="true"><i style="--v:${pop}"></i></span><span class="now__pop" aria-hidden="true">${pop}%</span></li>`;
  }).join('');
  return `<div class="now__head"><p class="now__title signage">${mode === 'weather' ? 'Here now' : `Here now · ${esc(p.name === 'Your location' ? 'your area' : p.name)}`}</p><p class="now__time num">${f.clock(Date.now())}</p></div>
    <div class="now__main"><p class="now__temp">${f.temp(now.temp)}</p>
      <div class="now__cond">${weatherIcon(now.code, now.day, 'wx--now')}<p><b>${esc(describeCode(now.code).text)}</b><span>${esc(sentence)}</span></p></div></div>
    <div class="now__hours"><p class="now__sub">Next 8 hours <span>· chance of rain or snow</span></p><ol class="now__list">${hours}</ol></div>`;
}

function tripStrip(t) {
  const stops = t.result.stops;
  const word = (s) => (s.level === 'unknown' ? 'No forecast' : s.level === 'low' ? 'Calm' : LEVEL_LABEL[s.level]);
  return `<div class="strip"><p class="now__sub">Your trip, stop by stop</p>
    <ol class="strip__list">${stops.map((s) => `<li class="strip__stop strip__stop--${s.level === 'low' ? 'calm' : s.level}">
      <span class="code">${s.airport.code}</span><span class="strip__lvl">${s.level === 'low' ? riskIcon('low') : riskIcon(s.level)}${word(s)}</span></li>`).join('<li class="strip__leg" aria-hidden="true"></li>')}</ol></div>`;
}

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
  $('#means').innerHTML = cards.map((c) => meanCard(c)).join('');
  if (!$('#days').dataset.for || $('#days').dataset.for !== `${p.lat},${p.lon},${prefs.temp},${prefs.clock}`) {
    $('#days').innerHTML = daysList(wx, f);
    $('#days').dataset.for = `${p.lat},${p.lon},${prefs.temp},${prefs.clock}`;
  }
  if (!radar && !$('#radar').dataset.ready) watchRadar();
}

function meanCard(c) {
  const lvl = c.level;
  const risky = lvl === 'elevated' || lvl === 'high';
  const icon = lvl === 'calm' ? riskIcon('low') : risky || lvl === 'unknown' ? riskIcon(lvl) : '';
  const extra = c.label === 'Flights near you' ? nearList() : '';
  return `<li class="mean mean--${lvl}">
    <h3 class="mean__label">${esc(c.label)}</h3>
    <p class="mean__big">${icon}<span>${esc(c.big)}</span>${risky && c.label !== 'Flights near you' ? `<span class="sr-only"> (${LEVEL_LABEL[lvl].toLowerCase()} risk)</span>` : ''}${risky && c.label === 'Flights near you' ? '<span class="sr-only"> risk</span>' : ''}</p>
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
    return `<li><a href="flights.html?airport=${a.code}"><span class="code">${a.code}</span><span class="near__name">${esc(shortName(a))}<small>${far(km)}</small></span></a>
      <span class="near__lvl near__lvl--${lvl}">${riskIcon(risk.level === 'low' ? 'low' : risk.level)}${word}</span></li>`;
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
  $('#alerts').innerHTML = (alerts || []).map((al) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b>${al.ends ? ` until ${fmtTime(Date.parse(al.ends), wx.tz)} ${esc(fmtDay(Date.parse(al.ends), wx.tz))}` : ''}. ${esc(al.headline || '')} <small>National Weather Service</small></span></p>`).join('');
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
});

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
