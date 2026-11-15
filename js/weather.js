// Weather home page: location (device or search), current conditions, 24 hours, 10 days, radar, nearby airports.
import { describeCode, assessWindow, fmtTime, fmtDay, fmtZone, HOUR, LEVEL_LABEL } from './core.js';
import { loadAirports, searchPlaces, nearestAirports, loadWeather, loadForecasts, loadAlerts } from './data.js';
import { $, store, prefs, initSettings } from './shell.js';
import { esc, weatherIcon, riskIcon, chip, units, compass } from './view.js';

const POPULAR = [
  { name: 'New York', region: 'United States', lat: 40.713, lon: -74.006, country: 'US' },
  { name: 'London', region: 'United Kingdom', lat: 51.507, lon: -0.128, country: 'GB' },
  { name: 'Tokyo', region: 'Japan', lat: 35.69, lon: 139.692, country: 'JP' },
  { name: 'Sydney', region: 'Australia', lat: -33.868, lon: 151.207, country: 'AU' },
  { name: 'Dubai', region: 'United Arab Emirates', lat: 25.077, lon: 55.309, country: 'AE' },
  { name: 'São Paulo', region: 'Brazil', lat: -23.548, lon: -46.636, country: 'BR' },
];

const view = $('#weather');
const welcome = $('#welcome');
let place = store.get('gatecast:place', null);
let current = null; // { place, wx, alerts, airports }
let radar = null;

/* ---------- Location ---------- */

function setPlace(p) {
  locateErrorClear();
  place = p;
  store.set('gatecast:place', p);
  const saved = [p, ...store.get('gatecast:places', []).filter((x) => x.name !== p.name || x.region !== p.region)].slice(0, 4);
  store.set('gatecast:places', saved);
  renderSaved();
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
  if (!place) welcome.hidden = false;
}

function locateErrorClear() { const el = $('#locate-error'); el.hidden = true; el.textContent = ''; }

// Called from a button press, after the page has explained why it wants the location.
function locate(quiet = false) {
  if (!('geolocation' in navigator)) return locateError('This browser cannot share a location. Search for a city instead.');
  const buttons = [$('#locate'), $('#locate-big')];
  buttons.forEach((b) => { b.disabled = true; });
  navigator.geolocation.getCurrentPosition((pos) => {
    buttons.forEach((b) => { b.disabled = false; });
    // Two decimals is about a kilometre: enough for a forecast, and no more precise than needed.
    const lat = +pos.coords.latitude.toFixed(2), lon = +pos.coords.longitude.toFixed(2);
    const near = nearestAirports(lat, lon, 1)[0];
    locateError('');
    setPlace({
      name: near && near.km < 150 ? (near.airport.city || near.airport.name) : 'Your location',
      region: near && near.km < 150 ? 'near you' : `${lat}, ${lon}`,
      lat, lon, country: near ? near.airport.country : '', gps: true,
    });
  }, (err) => {
    buttons.forEach((b) => { b.disabled = false; });
    if (quiet) { welcome.hidden = false; return; }
    locateError(err.code === 1
      ? 'Location is blocked for this site. Search for a city above, or allow location in your browser’s site settings and try again.'
      : 'We could not get your location just now. Search for a city above, or try again.');
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

/* ---------- Loading and rendering ---------- */

async function show() {
  const mine = place;
  welcome.hidden = true;
  view.hidden = false;
  view.setAttribute('aria-busy', 'true');
  if (!current) view.innerHTML = '<div class="skeleton skeleton--now" aria-hidden="true"><span></span><span></span></div><p class="sr-only">Loading the forecast…</p>';
  try {
    const wx = await loadWeather(mine.lat, mine.lon);
    if (place !== mine) return;
    current = { place: mine, wx, alerts: [], airports: [] };
    destroyRadar();
    render();
    view.setAttribute('aria-busy', 'false');
    enrich(current);
  } catch (err) {
    if (place !== mine) return;
    view.setAttribute('aria-busy', 'false');
    current = null;
    view.innerHTML = `<div class="verdict verdict--unknown">${riskIcon('unknown')}<div><h2>${err.message === 'rate' ? 'The forecast service is busy' : 'We could not load the forecast'}</h2>
      <p>${err.message === 'rate' ? 'The free forecast service has hit its request limit for this network. Try again in a little while.' : 'Check your connection and try again.'}</p>
      <button class="btn btn--primary" type="button" data-retry>Try again</button></div></div>`;
    $('[data-retry]', view).addEventListener('click', show);
  }
}

async function enrich(mine) {
  const p = mine.place;
  // Large airports within 150 km first, then the nearest with any airline service.
  const large = nearestAirports(p.lat, p.lon, 3, 2).filter((x) => x.km < 150);
  const others = nearestAirports(p.lat, p.lon, 3, 1).filter((x) => x.km < 300 && !large.some((l) => l.airport.code === x.airport.code));
  const near = [...large, ...others].slice(0, 3);
  const [alerts, fc] = await Promise.all([
    loadAlerts({ lat: p.lat, lon: p.lon, country: p.country || (near[0] && near[0].airport.country) }),
    near.length ? loadForecasts(near.map((x) => x.airport)).catch(() => null) : null,
  ]);
  if (current !== mine) return;
  mine.alerts = alerts;
  const now = Date.now();
  mine.airports = near.map((x) => {
    const hours = fc ? fc.forecasts.get(x.airport.code) || [] : [];
    return { ...x, risk: assessWindow(hours, now, now + 3 * HOUR) };
  });
  paintExtras();
}

const UV = (v) => (v == null ? '–' : v < 3 ? 'Low' : v < 6 ? 'Moderate' : v < 8 ? 'High' : v < 11 ? 'Very high' : 'Extreme');
const AQI = (v) => (v <= 50 ? 'Good' : v <= 100 ? 'Moderate' : v <= 150 ? 'Unhealthy for sensitive groups' : v <= 200 ? 'Unhealthy' : v <= 300 ? 'Very unhealthy' : 'Hazardous');
const isWet = (c) => c >= 51 && c !== 71 && c !== 73 && c !== 75 && c !== 77 && c !== 85 && c !== 86;
const isSnow = (c) => c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86;

function skyClass(code, day) {
  if (code >= 95) return 'storm';
  if (isSnow(code)) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48 || code === 3) return 'cloud';
  return day ? 'day' : 'night';
}

// One sentence about the next 24 hours, with the time something changes.
function summary(wx, u) {
  const tz = wx.tz, hours = wx.hours.slice(0, 24), now = wx.now;
  const wetNow = now.precip > 0 || isWet(now.code) || isSnow(now.code);
  const kind = (h) => (isSnow(h.code) ? 'Snow' : h.code >= 95 ? 'Thunderstorms' : 'Rain');
  let text;
  if (wetNow) {
    const dry = hours.slice(1).find((h) => !isWet(h.code) && !isSnow(h.code) && (h.precip ?? 0) === 0);
    text = dry ? `${kind(now)} easing around ${fmtTime(dry.t, tz)}.` : `${kind(now)} continuing through the next 24 hours.`;
  } else {
    const wet = hours.slice(1).find((h) => (isWet(h.code) || isSnow(h.code)) && (h.pop ?? 0) >= 40);
    text = wet ? `${kind(wet)} likely from around ${fmtTime(wet.t, tz)} (${wet.pop}% chance that hour).` : 'No rain or snow expected in the next 24 hours.';
  }
  const gust = Math.max(...hours.map((h) => h.gust ?? 0));
  if (gust >= 55) text += ` Gusts up to ${u.speed(gust)}.`;
  return text;
}

function tile(label, value, note = '') {
  return `<div class="tile"><dt>${label}</dt><dd>${value}</dd>${note ? `<p>${note}</p>` : ''}</div>`;
}

function render() {
  if (!current) return;
  const { place: p, wx } = current;
  const u = units(prefs), tz = wx.tz, now = wx.now, today = wx.days[0];
  const d = describeCode(now.code);
  const pressure = prefs.temp === 'f' ? `${(now.pressure * 0.02953).toFixed(2)} inHg` : `${Math.round(now.pressure)} hPa`;

  const hourCols = wx.hours.slice(0, 24).map((h, i) => {
    const hd = describeCode(h.code);
    const sr = `${fmtTime(h.t, tz)}: ${hd.text}, ${u.temp(h.temp)}, ${h.pop ?? 0}% chance of rain or snow, gusts ${u.speed(h.gust)}`;
    return `<li class="hour" title="${esc(sr)}">
      <span class="hour__time">${i === 0 ? 'Now' : fmtTime(h.t, tz)}</span>
      ${weatherIcon(h.code, h.day)}
      <span class="hour__temp">${u.temp(h.temp)}</span>
      <span class="hour__pop"><i style="--v:${h.pop ?? 0}"></i><b>${h.pop ?? 0}%</b></span>
      <span class="hour__gust">${u.speedVal(h.gust ?? 0)}</span>
      <span class="sr-only">${esc(sr)}</span></li>`;
  }).join('');

  const lo = Math.min(...wx.days.map((x) => x.min)), hi = Math.max(...wx.days.map((x) => x.max)), span = Math.max(1, hi - lo);
  const dayRows = wx.days.map((x, i) => {
    const dd = describeCode(x.code);
    const name = i === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric' }).format(x.t + 12 * HOUR);
    return `<li class="day">
      <span class="day__name">${name}</span>
      <span class="day__sky">${weatherIcon(x.code, 1)}<span class="sr-only">${esc(dd.text)}</span></span>
      <span class="day__pop">${(x.pop ?? 0) >= 20 ? `${x.pop}%` : ''}<span class="sr-only">${(x.pop ?? 0) >= 20 ? ' chance of rain or snow' : 'Dry'}</span></span>
      <span class="day__min"><span class="sr-only">Low </span>${u.temp(x.min)}</span>
      <span class="day__bar" aria-hidden="true"><i style="--from:${((x.min - lo) / span * 100).toFixed(1)}%;--to:${((x.max - lo) / span * 100).toFixed(1)}%"></i></span>
      <span class="day__max"><span class="sr-only">High </span>${u.temp(x.max)}</span>
    </li>`;
  }).join('');

  view.innerHTML = `
    <div id="alerts"></div>
    <section class="now now--${skyClass(now.code, now.day)}" aria-labelledby="now-title">
      <p class="now__place"><span id="now-title">${esc(p.name)}</span>${p.region ? ` <small>${esc(p.region)}</small>` : ''}</p>
      <p class="now__time">${fmtTime(Date.now(), tz)} ${esc(fmtZone(Date.now(), tz))} · ${esc(fmtDay(Date.now(), tz))}</p>
      <div class="now__main">
        ${weatherIcon(now.code, now.day, 'wx--hero')}
        <p class="now__temp">${u.temp(now.temp)}<small>${u.tempUnit.slice(1)}</small></p>
        <div class="now__text"><p class="now__cond">${esc(d.text)}</p>
          <p>Feels like ${u.temp(now.feels)} · High ${u.temp(today.max)} · Low ${u.temp(today.min)}</p></div>
      </div>
      <p class="now__summary">${esc(summary(wx, u))}</p>
    </section>

    <dl class="tiles">
      ${tile('Wind', `${u.speed(now.wind)} <small>${compass(now.dir)}</small>`, `Gusts ${u.speed(now.gust)}`)}
      ${tile('Humidity', `${Math.round(now.humidity)}%`)}
      ${tile('UV index', today.uv == null ? '–' : Math.round(today.uv), `${UV(today.uv)} at its peak today`)}
      ${tile('Visibility', u.vis(now.vis))}
      ${tile('Pressure', pressure)}
      ${wx.air ? tile('Air quality', wx.air.aqi, `${AQI(wx.air.aqi)} (US index)`) : ''}
      ${tile('Sunrise', fmtTime(today.sunrise, tz))}
      ${tile('Sunset', fmtTime(today.sunset, tz))}
    </dl>

    <div class="wx-grid">
      <div class="wx-grid__main">
        <section class="panel" aria-labelledby="h-hours"><h2 id="h-hours">Next 24 hours</h2>
          <div class="hours hours--plain" tabindex="0" role="group" aria-label="Hour by hour, local time">
            <ol class="hours__list">${hourCols}</ol>
            <p class="hours__legend"><span>Rows: time · sky · temperature · chance of rain or snow in that hour · gusts (${u.speedUnit})</span></p>
          </div>
        </section>
        <section class="panel" aria-labelledby="h-days"><h2 id="h-days">${wx.days.length} days</h2>
          <ol class="days">${dayRows}</ol>
        </section>
      </div>
      <div class="wx-grid__side">
        <section class="panel panel--flush" aria-labelledby="h-radar">
          <div class="panel__head"><h2 id="h-radar">Rain radar</h2><span class="radar__time" id="radar-time"></span></div>
          <div class="radar" id="radar" data-lat="${p.lat}" data-lon="${p.lon}"><p class="radar__placeholder">Radar loads when you scroll here.</p></div>
          <div class="radar__controls">
            <button type="button" class="btn btn--ghost" id="radar-play" disabled>Play last 2 hours</button>
            <input type="range" id="radar-frame" min="0" max="0" value="0" aria-label="Radar time" disabled>
          </div>
        </section>
        <section class="panel" aria-labelledby="h-fly"><h2 id="h-fly">Flying from here?</h2>
          <div id="near-airports"><p class="muted">Checking nearby airports…</p></div>
        </section>
      </div>
    </div>`;
  paintExtras();
  watchRadar();
}

function paintExtras() {
  if (!current) return;
  const { alerts, airports, wx } = current;
  const alertBox = $('#alerts');
  if (alertBox) {
    alertBox.innerHTML = alerts.map((al) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b>${al.ends ? ` until ${fmtTime(Date.parse(al.ends), wx.tz)} ${esc(fmtDay(Date.parse(al.ends), wx.tz))}` : ''}. ${esc(al.headline || '')} <small>National Weather Service</small></span></p>`).join('');
  }
  const box = $('#near-airports');
  if (!box) return;
  const far = (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609)} mi` : `${Math.round(km)} km`);
  box.innerHTML = airports.length
    ? `<ul class="airports">${airports.map(({ airport: a, km, risk }) => `<li>
        <a href="flights.html?airport=${a.code}"><span class="code">${a.code}</span><span class="airports__name">${esc(a.name)}<small>${far(km)} away</small></span></a>
        ${chip(risk.level, risk.level === 'unknown' ? 'No forecast' : `${LEVEL_LABEL[risk.level]} risk`)}
      </li>`).join('')}</ul>
      <p class="muted">Weather risk to flights over the next 3 hours. <a href="trip.html">Check a connection</a></p>`
    : '<p class="muted">No airport with airline flights within 300 km.</p>';
}

/* ---------- Radar (map library and tiles load only when the panel is near the screen) ---------- */

let radarObserver;
function destroyRadar() {
  if (radar) { clearInterval(radar.timer); radar.map.remove(); radar = null; }
  if (radarObserver) radarObserver.disconnect();
}
function watchRadar() {
  const el = $('#radar');
  if (!el) return;
  if (radar) { // units changed: the map element was rebuilt, start again
    destroyRadar();
  }
  radarObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { radarObserver.disconnect(); startRadar(el).catch(() => { el.innerHTML = '<p class="radar__placeholder">Radar is unavailable right now.</p>'; }); }
  }, { rootMargin: '200px' });
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors · Radar: RainViewer', maxZoom: 9, className: 'radar__base' }).addTo(map);
  const css = getComputedStyle(document.documentElement);
  L.circleMarker([+el.dataset.lat, +el.dataset.lon], { radius: 6, weight: 2, color: css.getPropertyValue('--paper-50').trim(), fillColor: css.getPropertyValue('--cobalt-600').trim(), fillOpacity: 1 }).addTo(map);
  const frames = (meta.radar && meta.radar.past) || [];
  if (!frames.length) throw new Error('no frames');
  const layers = frames.map((f) => L.tileLayer(`${meta.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7, maxZoom: 9, tileSize: 256 }));
  const slider = $('#radar-frame'), play = $('#radar-play'), label = $('#radar-time');
  let shown = -1;
  const showFrame = (i) => {
    if (!map.hasLayer(layers[i])) layers[i].addTo(map);
    if (shown >= 0 && shown !== i) layers[shown].setOpacity(0);
    layers[i].setOpacity(0.7);
    shown = i; slider.value = i;
    label.textContent = `${fmtTime(frames[i].time * 1000, mine.wx.tz)} ${fmtZone(frames[i].time * 1000, mine.wx.tz)}`;
  };
  slider.max = frames.length - 1; slider.disabled = false; play.disabled = false;
  showFrame(frames.length - 1);
  radar = { map, timer: null };
  slider.oninput = () => { stop(); showFrame(+slider.value); };
  const stop = () => { clearInterval(radar.timer); radar.timer = null; play.textContent = 'Play last 2 hours'; };
  play.onclick = () => {
    if (radar.timer) return stop();
    play.textContent = 'Pause';
    let i = 0;
    showFrame(0);
    radar.timer = setInterval(() => { i += 1; if (i >= frames.length) { stop(); return; } showFrame(i); }, 600);
  };
}

/* ---------- Start ---------- */

async function start() {
  initSettings(render);
  await loadAirports().catch(() => {});
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
