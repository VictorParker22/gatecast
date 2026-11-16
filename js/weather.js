// Weather home: a sky header with the one-sentence answer, and below it a board of boxes the visitor
// can resize, reorder, hide and keep on a shelf. The arrangement is saved on the device.
import { describeCode, assessWindow, fmtTime, fmtDay, fmtZone, HOUR, LEVEL_LABEL } from './core.js';
import { headlineParts, dayparts, makeQuiz, season, tipFor, CHECKLISTS, CHECKLIST_SOURCE, pickCities, compareLine, dayKey, dayNumber, skyOf } from './boardcontent.js';
import { loadAirports, searchPlaces, nearestAirports, loadWeather, loadForecasts, loadAlerts, loadCities } from './data.js';
import { $, store, prefs, initSettings } from './shell.js';
import { initSky, setSky } from './sky.js';
import { esc, weatherIcon, riskIcon, chip, units, compass } from './ui.js';
import { morph as motionMorph, flip, enter, react, landOnShelf, lift } from './motion.js';

const POPULAR = [
  { name: 'New York', region: 'United States', lat: 40.713, lon: -74.006, country: 'US' },
  { name: 'London', region: 'United Kingdom', lat: 51.507, lon: -0.128, country: 'GB' },
  { name: 'Tokyo', region: 'Japan', lat: 35.69, lon: 139.692, country: 'JP' },
  { name: 'Sydney', region: 'Australia', lat: -33.868, lon: 151.207, country: 'AU' },
  { name: 'Dubai', region: 'United Arab Emirates', lat: 25.077, lon: 55.309, country: 'AE' },
  { name: 'São Paulo', region: 'Brazil', lat: -23.548, lon: -46.636, country: 'BR' },
];

// The boxes on the board, in their default order and size (s, m or l).
const TILES = {
  hours: { title: 'The next 24 hours', size: 'l' },
  days: { title: '10 days', size: 'm' },
  radar: { title: 'Rain radar', size: 'm' },
  now: { title: 'Right now', size: 's' },
  quiz: { title: 'Quick question', size: 's' },
  there: { title: 'Here and there', size: 's' },
  fly: { title: 'Flying today?', size: 'm' },
  ready: { title: 'Get ready', size: 'm' },
};
const IDS = Object.keys(TILES);
const SIZES = ['s', 'm', 'l'];

const sky = $('#sky');
const hero = $('#hero');
const welcome = $('#welcome');
const boardEl = $('#board');
const statusEl = $('#status');
const shelfEl = $('#shelf');
const sheet = $('#sheet');
let place = store.get('gatecast:place', null);
let current = null; // { place, wx, alerts, airports, there }
let radar = null;
let board = loadBoard();

/* ---------- Saved arrangement and visit stats ---------- */

function loadBoard() {
  const b = store.get('gatecast:board', {});
  const order = (b.order || []).filter((id) => TILES[id]);
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  const size = {};
  for (const id of IDS) size[id] = SIZES.includes(b.size?.[id]) ? b.size[id] : TILES[id].size;
  return { order, size, hidden: (b.hidden || []).filter((id) => TILES[id]), shelf: (b.shelf || []).filter((id) => TILES[id]) };
}
const saveBoard = () => store.set('gatecast:board', board);

// Counts consecutive days this device has opened the page.
function touchStats() {
  const today = new Date(), key = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const y = new Date(today.getTime() - 24 * HOUR), yKey = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
  const s = { streak: 0, last: '', answered: 0, ...store.get('gatecast:stats', {}) };
  if (s.last !== key) { s.streak = s.last === yKey ? s.streak + 1 : 1; s.last = key; store.set('gatecast:stats', s); }
  return s;
}
let stats = touchStats();

/* ---------- Location ---------- */

function setPlace(p) {
  locateError('');
  place = p;
  store.set('gatecast:place', p);
  const saved = [p, ...store.get('gatecast:places', []).filter((x) => x.name !== p.name || x.region !== p.region)].slice(0, 4);
  store.set('gatecast:places', saved);
  renderSaved();
  window.scrollTo(0, 0); // the answer for the new place is at the top of the page
  show();
}
function renderSaved() {
  const saved = store.get('gatecast:places', []);
  $('#saved-places').innerHTML = saved.length > 1
    ? saved.map((p, i) => `<button type="button" class="pill${place && p.name === place.name && p.region === place.region ? ' is-current' : ''}" data-saved="${i}">${esc(p.name)}</button>`).join('')
    : '';
}
$('#saved-places').addEventListener('click', (e) => {
  const b = e.target.closest('[data-saved]');
  if (b) setPlace(store.get('gatecast:places', [])[+b.dataset.saved]);
});
function locateError(msg) {
  const el = $('#locate-error');
  el.hidden = !msg; el.textContent = msg || '';
  if (msg && !place) welcome.hidden = false;
}

// Called from a button press, after the page has explained why it wants the location.
function locate(quiet = false) {
  if (!('geolocation' in navigator)) return locateError('This browser cannot share a location. Search for a city instead.');
  const buttons = [$('#locate'), $('#locate-big')];
  buttons.forEach((b) => { b.disabled = true; });
  // The airport list names the spot; fetch it while the browser works out the position.
  const airportsReady = loadAirports().catch(() => {});
  navigator.geolocation.getCurrentPosition(async (pos) => {
    // Two decimals is about a kilometre: enough for a forecast, and no more precise than needed.
    const lat = +pos.coords.latitude.toFixed(2), lon = +pos.coords.longitude.toFixed(2);
    loadWeather(lat, lon).catch(() => {}); // the forecast downloads while the list finishes (show() reuses it)
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
    if (quiet) { welcome.hidden = false; return; }
    locateError(err.code === 1
      ? 'Location is blocked for this site. Search for a city, or allow location in your browser’s site settings and try again.'
      : 'We could not get your location just now. Search for a city, or try again.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60e3 });
}
$('#locate').addEventListener('click', () => locate());
$('#locate-big').addEventListener('click', () => locate());

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
$('#popular').addEventListener('click', (e) => {
  const b = e.target.closest('[data-popular]');
  if (b) setPlace(POPULAR[+b.dataset.popular]);
});

/* ---------- Loading ---------- */

async function show() {
  const mine = place;
  welcome.hidden = true;
  if (!current) statusEl.innerHTML = '<div class="skeleton" aria-hidden="true"><span></span><span></span></div><p class="sr-only">Loading the forecast…</p>';
  try {
    const wx = await loadWeather(mine.lat, mine.lon);
    if (place !== mine) return;
    statusEl.innerHTML = '';
    destroyRadar();
    current = { place: mine, wx, alerts: [], airports: null, there: null };
    renderHero();
    buildBoard();
    // First forecast of this visit: a short staggered arrival (once per page load). The temperature
    // counts up only on the first visit of the day; a returning visitor reads it at once.
    enter(document.documentElement, { countUp: firstCountToday });
    enrich(current);
  } catch (err) {
    if (place !== mine) return;
    current = null;
    hero.hidden = true; boardEl.hidden = true; shelfEl.hidden = true; $('#pedestal').hidden = true;
    statusEl.innerHTML = `<div class="verdict verdict--unknown">${riskIcon('unknown')}<div><h2>${err.message === 'rate' ? 'The forecast service is busy' : 'We could not load the forecast'}</h2>
      <p>${err.message === 'rate' ? 'The free forecast service has hit its request limit for this network. Try again in a little while.' : 'Check your connection and try again.'}</p>
      <button class="btn btn--primary" type="button" data-retry>Try again</button></div></div>`;
    $('[data-retry]', statusEl).addEventListener('click', show);
  }
}

// Fills in what the forecast does not need to wait for. Each part paints as soon as it arrives; the airport
// list (large) is fetched only here and for "Use my location", never before the forecast is on screen.
async function enrich(mine) {
  const p = mine.place;
  const cities = pickCities(p, dayNumber(dayKey(Date.now(), mine.wx.tz)));
  const near = loadAirports().then(() => {
    // Large airports within 150 km first, then the nearest with any airline service.
    const large = nearestAirports(p.lat, p.lon, 3, 2).filter((x) => x.km < 150);
    const others = nearestAirports(p.lat, p.lon, 3, 1).filter((x) => x.km < 300 && !large.some((l) => l.airport.code === x.airport.code));
    return [...large, ...others].slice(0, 3);
  }, () => []);
  const alerts = (p.country ? Promise.resolve(p.country) : near.then((n) => n[0] && n[0].airport.country))
    .then((country) => loadAlerts({ lat: p.lat, lon: p.lon, country }))
    .then((list) => { if (current === mine) { mine.alerts = list; renderAlerts(); } });
  const there = loadCities(cities).then((list) => { if (current === mine) { mine.there = list || []; paint('there'); } });
  const fly = near.then(async (list) => {
    const fc = list.length ? await loadForecasts(list.map((x) => x.airport)).catch(() => null) : null;
    if (current !== mine) return;
    const now = Date.now();
    mine.airports = list.map((x) => ({ ...x, risk: assessWindow(fc ? fc.forecasts.get(x.airport.code) || [] : [], now, now + 3 * HOUR) }));
    paint('fly');
  });
  await Promise.all([alerts, there, fly]);
}

function renderAlerts() {
  const { alerts, wx } = current;
  $('#alerts').innerHTML = alerts.map((al) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b>${al.ends ? ` until ${fmtTime(Date.parse(al.ends), wx.tz)} ${esc(fmtDay(Date.parse(al.ends), wx.tz))}` : ''}. ${esc(al.headline || '')} <small>National Weather Service</small></span></p>`).join('');
}

// The hero temperature counts up on the first forecast of the day on this device, then never again that day.
// Without storage there is no way to know, so the number is simply shown.
function firstCountToday() {
  const d = new Date(), key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (store.get('gatecast:counted', '') === key) return false;
  store.set('gatecast:counted', key);
  return store.get('gatecast:counted', '') === key;
}

/* ---------- Formatting for the current place and units ---------- */

function fmt() {
  const u = units(prefs), tz = current.wx.tz;
  return {
    u, tz,
    // Prose says "noon" and "midnight"; narrow column labels use the plain clock.
    time: (ms) => { const t = fmtTime(ms, tz); return t === '12 pm' ? 'noon' : t === '12 am' ? 'midnight' : t; },
    clock: (ms) => fmtTime(ms, tz),
    temp: u.temp,
    tempNumber: (c) => Math.round(prefs.temp === 'f' ? c * 9 / 5 + 32 : c),
    speed: u.speed,
    weekday: (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(ms + 12 * HOUR),
  };
}

/* ---------- Sky header ---------- */

function renderHero() {
  const { place: p, wx } = current;
  const f = fmt(), now = wx.now, today = wx.days[0];
  sky.className = `sky sky--${skyOf(now.code, now.day)}`;
  // The animated sky follows the same conditions as the flat colour behind it.
  const hrs = wx.hours.slice(0, 3);
  setSky({
    kind: skyOf(now.code, now.day), day: !!now.day, code: now.code,
    wind: now.wind, gust: now.gust, precip: Math.max(now.precip ?? 0, ...hrs.map((h) => h.precip ?? 0)),
    temp: now.temp, now: Date.now(), sunrise: today.sunrise, sunset: today.sunset,
  });
  const said = headlineParts(wx, f);
  hero.hidden = false;
  hero.innerHTML = `
    <div class="hero-wx__main">
      <p class="hero-wx__place"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        <span id="now-title">${esc(p.name)}</span> <small>${p.region ? `${esc(p.region)} · ` : ''}${esc(fmtDay(Date.now(), f.tz))}, ${f.time(Date.now())} ${esc(fmtZone(Date.now(), f.tz))}</small></p>
      <div class="hero-wx__now">
        <p class="hero-wx__temp">${f.temp(now.temp)}</p>
        <div class="hero-wx__cond">${weatherIcon(now.code, now.day, 'wx--hero')}<p>${esc(describeCode(now.code).text)}</p></div>
      </div>
      <h1>${esc(said.lead)} <span class="hero-wx__action">${esc(said.action)}</span></h1>
      <p class="hero-wx__meta"><span class="nw">Feels like ${f.temp(now.feels)}</span> · <span class="nw">High ${f.temp(today.max)}</span> · <span class="nw">Low ${f.temp(today.min)}</span> · <span class="nw">Wind ${f.speed(now.wind)} ${compass(now.dir)}</span></p>
    </div>
    <ul class="hero-wx__parts" aria-label="The day ahead">
      ${dayparts(wx).map((part) => `<li><span>${part.name}</span>${weatherIcon(part.code, part.day)}<b>${f.temp(part.temp)}</b><span>${esc(part.text)}</span></li>`).join('')}
    </ul>`;
}

/* ---------- Board: build, layout, paint ---------- */

const GRIP = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const tileEl = (id) => $(`#tile-${id}`);

function buildBoard() {
  boardEl.innerHTML = board.order.map((id) => {
    const t = TILES[id].title;
    return `<article class="tile tile--${id}" id="tile-${id}" data-tile="${id}" data-size="${board.size[id]}" tabindex="-1" style="view-transition-name: tile-${id}"${board.hidden.includes(id) ? ' hidden' : ''}>
      <header class="tile__head">
        <button type="button" class="tile__grip" data-handle aria-label="Move ${esc(t)}. Drag to rearrange, or press for move options.">${GRIP}</button>
        <h2 class="tile__title">${esc(t)}</h2>
        <button type="button" class="tile__btn" data-resize aria-label="Change the size of ${esc(t)}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10V4h6M20 14v6h-6M4 4l7 7M20 20l-7-7"/></svg></button>
        <button type="button" class="tile__btn" data-more aria-label="Options for ${esc(t)}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>
      </header>
      <div class="tile__body" data-body></div>
    </article>`;
  }).join('');
  boardEl.hidden = false; shelfEl.hidden = false; $('#pedestal').hidden = false;
  IDS.forEach(paint);
  renderShelf(); renderPedestal();
  watchRadar();
  if (location.hash.startsWith('#tile-')) jumpTo(location.hash.slice(6));
}

function paint(id) {
  const el = tileEl(id);
  if (!el || !current) return;
  const body = $('[data-body]', el);
  if (id === 'radar') { if (!body.firstChild) body.innerHTML = BODY.radar(); return; }
  body.innerHTML = BODY[id](board.size[id]);
}

// Runs a layout change as a view transition so boxes glide to their new place and size
// (in-page FLIP while the options sheet is over the board; instant under reduced motion).
function morph(change) {
  motionMorph(change, () => boardEl.querySelectorAll('[data-tile]'));
}
function announce(text) {
  const el = $('#announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}
const visibleOrder = () => board.order.filter((id) => !board.hidden.includes(id));

function setSize(id, size) {
  if (board.size[id] === size) return;
  board.size[id] = size; saveBoard();
  morph(() => { tileEl(id).dataset.size = size; paint(id); });
  if (id === 'radar' && radar) setTimeout(() => radar.map.invalidateSize(), 400);
  announce(`${TILES[id].title} is now ${{ s: 'small', m: 'medium', l: 'large' }[size]}.`);
}
function applyOrder() { for (const id of board.order) boardEl.append(tileEl(id)); }
function move(id, delta) {
  const vis = visibleOrder(), i = vis.indexOf(id), j = i + delta;
  if (j < 0 || j >= vis.length) return;
  const a = board.order.indexOf(id), b = board.order.indexOf(vis[j]);
  board.order.splice(a, 1); board.order.splice(b, 0, id);
  saveBoard();
  morph(applyOrder);
  tileEl(id).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  announce(`${TILES[id].title} moved to position ${j + 1} of ${vis.length}.`);
}
function hide(id) {
  board.hidden.push(id); board.shelf = board.shelf.filter((x) => x !== id); saveBoard();
  morph(() => { tileEl(id).hidden = true; renderShelf(); renderPedestal(); });
  announce(`${TILES[id].title} hidden. Use "Show hidden boxes" to bring it back.`);
}
function toggleShelf(id, on = !board.shelf.includes(id)) {
  board.shelf = board.shelf.filter((x) => x !== id);
  if (on) board.shelf.push(id);
  saveBoard(); renderShelf(); renderPedestal();
  if (on) landOnShelf(shelfEl, id);
  announce(on ? `${TILES[id].title} is on your shelf.` : `${TILES[id].title} taken off your shelf.`);
}
function jumpTo(id) {
  const el = tileEl(id);
  if (!el) return;
  if (el.hidden) { board.hidden = board.hidden.filter((x) => x !== id); saveBoard(); el.hidden = false; renderPedestal(); }
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1200);
}

function renderShelf() {
  $('#shelf-items').innerHTML = board.shelf.length
    ? board.shelf.map((id) => `<button type="button" class="shelf__chip" data-jump="${id}">${esc(TILES[id].title)}</button>`).join('')
    : '<p class="shelf__hint">Drag a box here, or use its options, to keep a shortcut to it.</p>';
}
function renderPedestal() {
  $('#stats').innerHTML = `
    <li><b>Day ${stats.streak}</b><span>in a row</span></li>
    <li><b>${board.shelf.length}</b><span>on your shelf</span></li>
    <li><b>${stats.answered}</b><span>${stats.answered === 1 ? 'question answered' : 'questions answered'}</span></li>`;
  const n = board.hidden.length, btn = $('#show-hidden');
  btn.hidden = n === 0;
  btn.textContent = n === 1 ? 'Show 1 hidden box' : `Show ${n} hidden boxes`;
}
$('#show-hidden').addEventListener('click', () => {
  board.hidden = []; saveBoard();
  morph(() => { IDS.forEach((id) => { tileEl(id).hidden = false; }); renderPedestal(); });
  if (radar) setTimeout(() => radar.map.invalidateSize(), 400);
});
$('#reset-board').addEventListener('click', () => {
  store.set('gatecast:board', {});
  board = loadBoard();
  morph(() => { applyOrder(); IDS.forEach((id) => { const el = tileEl(id); el.dataset.size = board.size[id]; el.hidden = false; paint(id); }); renderShelf(); renderPedestal(); });
  if (radar) setTimeout(() => radar.map.invalidateSize(), 400);
  announce('Your board is back to how it started.');
});
shelfEl.addEventListener('click', (e) => { const b = e.target.closest('[data-jump]'); if (b) jumpTo(b.dataset.jump); });

/* ---------- Box contents ---------- */

const BODY = {
  hours(size) {
    const { wx } = current, f = fmt();
    const n = size === 'l' ? 24 : size === 'm' ? 12 : 6;
    const hours = wx.hours.slice(0, n);
    const cols = hours.map((h, i) => {
      const sr = `${f.time(h.t)}: ${describeCode(h.code).text}, ${f.temp(h.temp)}, ${h.pop ?? 0}% chance of rain or snow`;
      return `<li${i === 0 ? ' class="is-now"' : ''} title="${esc(sr)}"><span class="hcol__time">${i === 0 ? 'Now' : f.clock(h.t)}</span><b>${f.temp(h.temp)}</b>${weatherIcon(h.code, h.day)}<span class="hcol__pop"><i style="--v:${h.pop ?? 0}"></i>${h.pop ?? 0}%</span><span class="sr-only">${esc(sr)}</span></li>`;
    }).join('');
    let curve = '';
    if (size === 'l') {
      const temps = hours.map((h) => h.temp), min = Math.min(...temps), span = Math.max(1, Math.max(...temps) - min);
      const pts = temps.map((t, i) => [((i + 0.5) / n * 1200).toFixed(1), (92 - (t - min) / span * 64).toFixed(1)]);
      const line = 'M' + pts.map((p) => p.join(' ')).join('L');
      const start = hours[0].t;
      const sun = [['Sunrise', wx.days[0].sunrise], ['Sunset', wx.days[0].sunset], ['Sunrise', wx.days[1]?.sunrise], ['Sunset', wx.days[1]?.sunset]]
        .find(([, t]) => t && t > start + HOUR && t < start + (n - 1) * HOUR);
      const mark = sun ? `<span class="hours2__sun" style="left:${(((sun[1] - start) / HOUR + 0.5) / n * 100).toFixed(1)}%">${sun[0]} ${f.time(sun[1])}</span>` : '';
      curve = `${mark}<svg class="hours2__curve" viewBox="0 0 1200 110" preserveAspectRatio="none" aria-hidden="true"><path class="hours2__area" d="${line}L${pts[n - 1][0]} 110L${pts[0][0]} 110Z"/><path class="hours2__line" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
    }
    return `<div class="hours2" tabindex="0" role="group" aria-label="Hour by hour, local time"><div class="hours2__inner" data-n="${n}">${curve}<ol class="hours2__list" style="--n:${n}">${cols}</ol></div></div>
      <p class="tile__note">Temperature, sky, and the chance of rain or snow in each hour.${size !== 'l' ? ' Make this box bigger for more hours.' : ''}</p>`;
  },

  days(size) {
    const { wx } = current, f = fmt();
    const days = size === 's' ? wx.days.slice(0, 5) : wx.days;
    const lo = Math.min(...wx.days.map((x) => x.min)), span = Math.max(1, Math.max(...wx.days.map((x) => x.max)) - lo);
    return `<ol class="days">${days.map((x, i) => {
      const name = i === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { timeZone: f.tz, weekday: 'short', day: 'numeric' }).format(x.t + 12 * HOUR);
      const wet = (x.pop ?? 0) >= 20;
      return `<li class="day${i === 0 ? ' is-today' : ''}"><span class="day__name">${name}</span>
        <span class="day__sky">${weatherIcon(x.code, 1)}<span class="sr-only">${esc(describeCode(x.code).text)}</span></span>
        <span class="day__pop">${wet ? `${x.pop}%` : ''}<span class="sr-only">${wet ? ' chance of rain or snow' : 'Dry'}</span></span>
        <span class="day__min"><span class="sr-only">Low </span>${f.temp(x.min)}</span>
        <span class="day__bar" aria-hidden="true"><i style="--from:${((x.min - lo) / span * 100).toFixed(1)}%;--to:${((x.max - lo) / span * 100).toFixed(1)}%"></i></span>
        <span class="day__max"><span class="sr-only">High </span>${f.temp(x.max)}</span></li>`;
    }).join('')}</ol>
    ${size === 'l' ? '<p class="tile__note">The bar shows each day’s low to high against the range for all the days shown. The percentage is the chance of rain or snow that day.</p>' : ''}`;
  },

  radar() {
    const p = current.place;
    return `<div class="radar" id="radar" data-lat="${p.lat}" data-lon="${p.lon}"><p class="radar__placeholder">Radar loads when you scroll here.</p></div>
      <div class="radar__controls"><button type="button" class="btn btn--ghost" id="radar-play" disabled>Play last 2 hours</button>
      <input type="range" id="radar-frame" min="0" max="0" value="0" aria-label="Radar time" disabled><span class="radar__time" id="radar-time"></span></div>`;
  },

  now(size) {
    const { wx } = current, f = fmt(), now = wx.now, today = wx.days[0];
    const UV = (v) => (v == null ? '' : v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'very high' : 'extreme');
    const AQI = (v) => (v <= 50 ? 'good' : v <= 100 ? 'moderate' : v <= 150 ? 'poor for sensitive groups' : v <= 200 ? 'unhealthy' : 'very unhealthy');
    // value, then an optional small unit, then an optional small note
    const stat = (k, v, unit = '', note = '') => `<div><dt>${k}</dt><dd>${v}${unit ? ` <span class="stats__unit">${unit}</span>` : ''}${note ? ` <small>${note}</small>` : ''}</dd></div>`;
    const split = (text) => { const i = String(text).indexOf(' '); return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)]; };
    const pressure = prefs.temp === 'f' ? [(now.pressure * 0.02953).toFixed(2), 'inHg'] : [Math.round(now.pressure), 'hPa'];
    const vis = split(f.u.vis(now.vis));
    const items = [
      stat('Wind', f.u.speedVal(now.wind), `${f.u.speedUnit} ${compass(now.dir)}`, `gusts ${f.speed(now.gust)}`),
      stat('Humidity', `${Math.round(now.humidity)}%`),
      stat('UV index', today.uv == null ? '–' : Math.round(today.uv), '', UV(today.uv)),
      wx.air ? stat('Air quality', wx.air.aqi, '', AQI(wx.air.aqi)) : stat('Visibility', vis[0], vis[1]),
      stat('Sunrise', f.time(today.sunrise)), stat('Sunset', f.time(today.sunset)),
      wx.air ? stat('Visibility', vis[0], vis[1]) : '', stat('Pressure', pressure[0], pressure[1]),
    ].filter(Boolean);
    return `<dl class="stats">${items.slice(0, size === 's' ? 4 : 8).join('')}</dl>`;
  },

  quiz(size) {
    const q = makeQuiz(current.wx, current.place.name === 'Your location' ? 'your area' : current.place.name, fmt());
    const saved = store.get('gatecast:quiz', {});
    const picked = saved.key === q.key && saved.place === current.place.name ? saved.picked : null;
    const done = picked != null;
    return `<h3 class="quiz__q">${esc(q.question)}</h3>
      <p class="quiz__from">From the forecast on your board. One tap, no sign-up.</p>
      <div class="quiz__opts">${q.options.map((o, i) => `<button type="button" data-quiz="${i}"${done ? ' disabled' : ''} class="${done && i === q.correct ? 'is-correct' : done && i === picked ? 'is-wrong' : ''}">${esc(o)}${done && i === q.correct ? '<span class="sr-only"> (correct)</span>' : ''}</button>`).join('')}</div>
      <p class="quiz__result" role="status" tabindex="-1">${done ? `${picked === q.correct ? 'Right.' : 'Not quite.'} ${esc(q.explain)}` : ''}</p>
      ${size !== 's' ? '<p class="tile__note">A new question from your forecast every day.</p>' : ''}`;
  },

  there(size) {
    const { wx, place: p, there } = current, f = fmt();
    if (there == null) return '<p class="muted">Checking the weather elsewhere…</p>';
    if (!there.length) return '<p class="muted">The comparison is not available right now.</p>';
    const hereName = p.name === 'Your location' ? 'here' : p.name;
    const dayOf = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(Date.now());
    const cities = there.slice(0, size === 's' ? 1 : size === 'm' ? 2 : 3);
    const first = cities[0];
    const ahead = dayKey(Date.now(), first.tz) > dayKey(Date.now(), wx.tz);
    const line = compareLine(hereName, wx.now.temp, { name: first.name, temp: first.temp, dayLabel: dayOf(first.tz), hereDayLabel: dayOf(wx.tz), ahead }, f);
    const row = (name, temp, code, day, tz) => `<li><span class="there__name">${esc(name)}<small>${fmtTime(Date.now(), tz)} · ${dayOf(tz)}</small></span>${weatherIcon(code, day)}<span class="there__cond">${esc(describeCode(code).text)}</span><b>${f.temp(temp)}</b></li>`;
    return `<p class="there__line">${esc(line)}</p>
      <ul class="there">${row(p.name === 'Your location' ? 'Here' : p.name, wx.now.temp, wx.now.code, wx.now.day, wx.tz)}${cities.map((c) => row(c.name, c.temp, c.code, c.day, c.tz)).join('')}</ul>
      <p class="tile__note">Different cities tomorrow.${size !== 'l' ? ' Make this box bigger to compare more.' : ''}</p>`;
  },

  fly(size) {
    const { airports } = current;
    const far = (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609)} mi` : `${Math.round(km)} km`);
    const list = airports == null ? '<p class="muted">Checking nearby airports…</p>'
      : airports.length ? `<ul class="airports">${airports.slice(0, size === 's' ? 2 : 3).map(({ airport: a, km, risk }) => `<li>
          <a href="flights.html?airport=${a.code}"><span class="code">${a.code}</span><span class="airports__name">${esc(a.name)}<small>${far(km)} away</small></span></a>
          ${chip(risk.level, risk.level === 'unknown' ? 'No forecast' : `${LEVEL_LABEL[risk.level]} risk`)}</li>`).join('')}</ul>`
        : '<p class="muted">No airport with airline flights within 300 km.</p>';
    return `<form class="fly__form" action="flights.html" method="get">
        <label for="fly-flight" class="sr-only">Flight number</label>
        <input id="fly-flight" name="flight" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Flight number, e.g. UA 1" required>
        <button type="submit" class="btn btn--primary">Track flight</button>
      </form>
      ${list}
      <p class="tile__note">Weather risk to flights over the next 3 hours. <a href="trip.html">Check a connection</a>${size === 'l' ? ' to see whether your layover is long enough for the forecast' : ''}.</p>`;
  },

  ready(size) {
    const { wx, place: p } = current, f = fmt();
    const tip = tipFor(wx, f);
    const s = season(p.lat, new Date());
    const useNext = s.next && s.days <= 45;
    const which = useNext ? s.next : s.name;
    const list = CHECKLISTS[which];
    const key = `${which}-${new Date().getFullYear()}`;
    const checks = store.get('gatecast:checks', {})[key] || [];
    const items = list.items.slice(0, size === 's' ? 3 : size === 'm' ? 5 : list.items.length);
    const when = which === 'tropics' ? '' : useNext ? `${which[0].toUpperCase()}${which.slice(1)} starts in ${s.days} days` : `It is ${which}`;
    return `<div class="tip"><h3>${esc(tip.title)}</h3><p>${esc(tip.text)}</p></div>
      <h3 class="ready__title">${esc(list.title)}${when ? ` <small>${when}</small>` : ''}</h3>
      <ul class="checks">${items.map((item, i) => `<li><label><input type="checkbox" data-check="${key}:${i}"${checks[i] ? ' checked' : ''}>${esc(item)}</label></li>`).join('')}</ul>
      <p class="tile__note">Written by Gatecast from public safety guidance: <a href="${tip.source.url}" rel="noopener">${tip.source.label}</a>${tip.source.url === CHECKLIST_SOURCE.url ? '' : ` and <a href="${CHECKLIST_SOURCE.url}" rel="noopener">${CHECKLIST_SOURCE.label}</a>`}.</p>`;
  },
};

/* ---------- Box interactions ---------- */

let suppressClick = false;
boardEl.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const tile = e.target.closest('[data-tile]');
  if (!tile) return;
  const id = tile.dataset.tile;
  if (e.target.closest('[data-resize]')) return setSize(id, SIZES[(SIZES.indexOf(board.size[id]) + 1) % 3]);
  if (e.target.closest('[data-more]') || e.target.closest('[data-handle]')) return openSheet(id, e.target.closest('button'));
  const opt = e.target.closest('[data-quiz]');
  if (opt) {
    const q = makeQuiz(current.wx, current.place.name === 'Your location' ? 'your area' : current.place.name, fmt());
    store.set('gatecast:quiz', { key: q.key, place: current.place.name, picked: +opt.dataset.quiz });
    stats.answered += 1; store.set('gatecast:stats', stats);
    paint('quiz'); renderPedestal();
    react(tileEl('quiz'), 'just-answered');
    const result = $('.quiz__result', tileEl('quiz'));
    result.focus({ preventScroll: true }); // repainting the box dropped focus; put it on the answer
    announce(result.textContent);
  }
});
boardEl.addEventListener('change', (e) => {
  const box = e.target.closest('[data-check]');
  if (!box) return;
  const [key, i] = box.dataset.check.split(':');
  const all = store.get('gatecast:checks', {});
  (all[key] ||= [])[+i] = box.checked;
  store.set('gatecast:checks', all);
});

/* ---------- Options panel (native modal dialog) ---------- */

let sheetId = null;
function refreshSheet() {
  const id = sheetId, vis = visibleOrder(), i = vis.indexOf(id), size = board.size[id];
  $('#sheet-title').textContent = TILES[id].title;
  $('[data-act="shelf"] span', sheet).textContent = board.shelf.includes(id) ? 'Take off my shelf' : 'Keep on my shelf';
  $('[data-act="bigger"]', sheet).disabled = size === 'l';
  $('[data-act="smaller"]', sheet).disabled = size === 's';
  $('[data-act="earlier"]', sheet).disabled = i <= 0;
  $('[data-act="later"]', sheet).disabled = i === vis.length - 1;
  $('[data-act="share"] span', sheet).textContent = 'Copy a link to this box';
}
function openSheet(id) {
  sheetId = id;
  refreshSheet();
  sheet.showModal();
}
sheet.addEventListener('click', async (e) => {
  // Where closedby="any" is not supported yet, a click on the backdrop still closes the panel.
  if (e.target === sheet && !('closedBy' in HTMLDialogElement.prototype)) return sheet.close();
  const btn = e.target.closest('[data-act]');
  if (!btn || !sheetId) return;
  const id = sheetId, act = btn.dataset.act;
  if (act === 'shelf') toggleShelf(id);
  else if (act === 'bigger') setSize(id, SIZES[SIZES.indexOf(board.size[id]) + 1]);
  else if (act === 'smaller') setSize(id, SIZES[SIZES.indexOf(board.size[id]) - 1]);
  else if (act === 'earlier') move(id, -1);
  else if (act === 'later') move(id, 1);
  else if (act === 'hide') { sheet.close(); return hide(id); }
  else if (act === 'share') {
    const url = `${location.origin}${location.pathname}#tile-${id}`;
    const label = $('span', btn);
    try { await navigator.clipboard.writeText(url); label.textContent = 'Link copied'; } catch { label.textContent = 'Copy failed: use the address bar'; }
    return;
  }
  refreshSheet();
});

/* ---------- Dragging a box by its grip (mouse, pen and touch) ---------- */

// The box lifts (a floating copy follows the pointer, see motion.js), its place on the board shows as
// an empty slot, and the other boxes glide out of the way. Layout is read at the start and after each
// reorder, never per pointer move; the follow and hit test run once per animation frame.
let drag = null;
const allTiles = () => boardEl.querySelectorAll('[data-tile]');

// Where each other box sits (board coordinates, transforms ignored), for hit testing without layout reads.
function measureTiles(d) {
  const bx = boardEl.offsetLeft, by = boardEl.offsetTop;
  d.rects = [...allTiles()].filter((t) => !t.hidden && t !== d.el)
    .map((t) => ({ t, x: t.offsetLeft - bx, y: t.offsetTop - by, w: t.offsetWidth, h: t.offsetHeight }));
}

boardEl.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('[data-handle]');
  if (!handle || e.button > 0) return;
  const el = handle.closest('[data-tile]');
  drag = { id: el.dataset.tile, el, handle, pointerId: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, active: false, last: 0, frame: 0, startOrder: board.order.join() };
  e.preventDefault(); // no text selection or native drag while moving a box
});
// Move and release are tracked on the document: reordering re-inserts the box, which drops pointer capture.
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.px = e.clientX; drag.py = e.clientY;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.active = true;
    drag.lift = lift(drag.el, drag.x, drag.y, { shelf: shelfEl });
    const br = boardEl.getBoundingClientRect();
    drag.origin = { x: br.left + scrollX, y: br.top + scrollY };
    measureTiles(drag);
    drag.el.classList.add('is-dragging');
    document.documentElement.classList.add('is-dragging-tile');
  }
  if (!drag.frame) drag.frame = requestAnimationFrame(dragFrame);
});
function dragFrame() {
  const d = drag;
  if (!d) return;
  d.frame = 0;
  d.lift.move(d.px, d.py);
  if (d.lift.autoScroll()) d.frame = requestAnimationFrame(dragFrame); // keep going while resting in an edge zone
  const overShelf = !!document.elementFromPoint(d.px, d.py)?.closest('#shelf');
  shelfEl.classList.toggle('is-target', overShelf);
  d.lift.overShelf(overShelf);
  if (overShelf || performance.now() - d.last < 260) return;
  const x = d.px + scrollX - d.origin.x, y = d.py + scrollY - d.origin.y;
  const hit = d.rects.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  if (!hit) return;
  d.last = performance.now();
  const el = d.el, target = hit.t;
  flip(allTiles(), () => {
    if (el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) target.after(el); else target.before(el);
    board.order = [...allTiles()].map((t) => t.dataset.tile);
  }, { scale: false });
  measureTiles(d);
}
function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag; drag = null;
  if (!d.active) return;
  cancelAnimationFrame(d.frame);
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  document.documentElement.classList.remove('is-dragging-tile');
  const reveal = () => d.el.classList.remove('is-dragging');
  const overShelf = !cancelled && shelfEl.classList.contains('is-target');
  shelfEl.classList.remove('is-target');
  if (cancelled) {
    board.order = d.startOrder.split(',');
    flip(allTiles(), applyOrder, { scale: false });
    d.lift.settle(d.el, reveal);
    return;
  }
  if (overShelf) {
    // Pinning is not moving: put the boxes back where they were before the drag crossed them.
    if (board.order.join() !== d.startOrder) {
      board.order = d.startOrder.split(',');
      flip(allTiles(), applyOrder, { scale: false });
    }
    toggleShelf(d.id, true);
    d.lift.flyTo($(`[data-jump="${d.id}"]`, shelfEl), d.el, reveal);
    return;
  }
  saveBoard();
  d.lift.settle(d.el, reveal);
  if (board.order.join() !== d.startOrder) {
    const vis = visibleOrder();
    announce(`${TILES[d.id].title} moved to position ${vis.indexOf(d.id) + 1} of ${vis.length}.`);
  }
}
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

/* ---------- Radar (map library and tiles load only when the box is near the screen) ---------- */

let radarObserver;
function destroyRadar() {
  if (radar) { clearInterval(radar.timer); radar.map.remove(); radar = null; }
  if (radarObserver) radarObserver.disconnect();
}
function watchRadar() {
  const el = $('#radar');
  if (!el) return;
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
  const mine = current;
  const [L, meta] = await Promise.all([loadLeaflet(), fetch('https://api.rainviewer.com/public/weather-maps.json').then((r) => r.json())]);
  if (current !== mine || !el.isConnected) return;
  el.innerHTML = '';
  const map = L.map(el, { center: [+el.dataset.lat, +el.dataset.lon], zoom: 6, minZoom: 3, maxZoom: 9, scrollWheelZoom: false, attributionControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors · Radar: RainViewer', maxZoom: 9 }).addTo(map);
  const css = getComputedStyle(document.documentElement);
  L.circleMarker([+el.dataset.lat, +el.dataset.lon], { radius: 6, weight: 2, color: css.getPropertyValue('--paper-50').trim(), fillColor: css.getPropertyValue('--cobalt-600').trim(), fillOpacity: 1 }).addTo(map);
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
    label.textContent = fmtTime(frames[i].time * 1000, mine.wx.tz);
  };
  slider.max = frames.length - 1; slider.disabled = false; play.disabled = false;
  showFrame(frames.length - 1);
  radar = { map, timer: null, relabel: () => { if (shown >= 0) label.textContent = fmtTime(frames[shown].time * 1000, mine.wx.tz); } };
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
  if (!current) return;
  renderHero();
  IDS.forEach(paint);
  renderAlerts(); // alert end times follow the clock setting
  radar?.relabel(); // so does the radar frame time
}

async function start() {
  initSettings(rerender);
  initSky($('#sky-canvas'));
  renderSaved();
  if (place) return show();
  // If location was already allowed on an earlier visit, use it without asking again.
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted') return locate(true);
  } catch {}
  welcome.hidden = false;
}
start();
