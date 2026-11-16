import {
  planTrip, assessTrip, scoreHour, estimateFlightMin, fmtTime, fmtDay, fmtDuration, utcToLocalInput, HOUR,
} from './core.js';
import { loadAirports, airport, searchAirports, loadForecasts, loadAlerts, loadLive } from './data.js';
import { $, store, prefs, initSettings } from './shell.js';
import { esc, riskIcon, units } from './view.js';
import { journeyModel } from './journey.js';
import { verdictHTML, stripHTML, stopCardHTML, adviceHTML, mapHTML } from './tripview.js';
import { tripSnapshot, diffTrips, noteForecast, dismiss, changeLine, changeLead } from './changes.js';
import { faaPlanLine } from './riskwords.js';
import { seenGet, seenSet } from './seen.js';

/* ---------- State ---------- */

let uid = 0;
const blank = () => ({ id: ++uid, code: '', layover: 90 });
let stops = [blank(), blank(), blank()]; // from, one optional connection, to
let durations = {}; // leg index -> minutes entered by the user
let last = null; // last rendered { plan, result, forecasts, at }

const LAYOVERS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 360];
const EXAMPLES = [
  { label: 'New York → Chicago → Denver', r: ['JFK', 'ORD', 'DEN'], l: [75] },
  { label: 'London → Frankfurt → Singapore', r: ['LHR', 'FRA', 'SIN'], l: [90] },
  { label: 'Toronto → Reykjavik → Paris', r: ['YYZ', 'KEF', 'CDG'], l: [60] },
  { label: 'San Francisco → Tokyo', r: ['SFO', 'NRT'], l: [] },
];

/* ---------- Trip form ---------- */

const stopsEl = $('#stops');
const depEl = $('#dep');
const errEl = $('#form-error');

function roleLabel(i) {
  return i === 0 ? 'From' : i === stops.length - 1 ? 'To' : 'Connecting in';
}
const display = (a) => `${a.city || a.name} (${a.code})`;

function renderStops() {
  stopsEl.innerHTML = stops.map((s, i) => {
    const a = airport(s.code);
    const via = i > 0 && i < stops.length - 1;
    return `<li class="stop-field${via ? ' stop-field--via' : ''}" data-id="${s.id}">
      <div class="field combo">
        <label for="ap-${s.id}">${roleLabel(i)}${via ? ' <span class="field__hint">optional</span>' : ''}</label>
        <input id="ap-${s.id}" type="text" role="combobox" autocomplete="off" autocapitalize="off" spellcheck="false"
          aria-expanded="false" aria-controls="lb-${s.id}" aria-autocomplete="list"
          placeholder="${via ? 'City or airport code' : 'City or airport, e.g. ' + (i ? 'Denver' : 'JFK')}" value="${a ? esc(display(a)) : ''}">
        <ul id="lb-${s.id}" class="combo__list" role="listbox" aria-label="Airports" hidden></ul>
      </div>
      ${via ? `<div class="field field--layover">
        <label for="lay-${s.id}">Layover</label>
        <select id="lay-${s.id}">${LAYOVERS.map((m) => `<option value="${m}"${m === s.layover ? ' selected' : ''}>${fmtDuration(m)}</option>`).join('')}</select>
      </div>
      <button type="button" class="btn btn--icon" data-remove aria-label="Remove this connection">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}
    </li>`;
  }).join('');
  $('#add-stop').hidden = stops.length >= 5;
  renderDurations();
}

function chosen() { return stops.map((s) => airport(s.code)).filter(Boolean); }

function renderDurations() {
  const aps = chosen();
  const wrap = $('#fine-tune');
  wrap.hidden = aps.length < 2;
  if (aps.length < 2) return;
  $('#durations').innerHTML = aps.slice(0, -1).map((a, i) => {
    const est = estimateFlightMin(a, aps[i + 1]);
    return `<div class="field"><label for="dur-${i}">${a.code} → ${aps[i + 1].code} <span class="field__hint">estimate ${fmtDuration(est)}</span></label>
      <input id="dur-${i}" data-leg="${i}" type="number" inputmode="numeric" min="20" max="1200" step="5" placeholder="${est}" value="${durations[i] ?? ''}"></div>`;
  }).join('');
}

// Combobox behaviour, delegated from the list of stops.
function closeList(input) {
  const list = $('#' + input.getAttribute('aria-controls'));
  list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
}
function openList(input) {
  const list = $('#' + input.getAttribute('aria-controls'));
  const results = searchAirports(input.value);
  if (!results.length) {
    list.innerHTML = input.value.trim().length > 1 ? '<li class="combo__empty" role="presentation">No airport found. Try the city or the 3-letter code.</li>' : '';
    list.hidden = !list.innerHTML; input.setAttribute('aria-expanded', String(!list.hidden));
    return;
  }
  list.innerHTML = results.map((a, i) => `<li role="option" id="${list.id}-o${i}" data-code="${a.code}" aria-selected="${i === 0}">
    <span class="code">${a.code}</span><span class="combo__name">${esc(a.city || a.name)}<small>${esc(a.name)} · ${esc(a.country)}</small></span></li>`).join('');
  list.hidden = false; input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', `${list.id}-o0`);
}
function pick(input, code) {
  const s = stops.find((x) => x.id === +input.closest('[data-id]').dataset.id);
  const a = airport(code);
  s.code = a ? a.code : '';
  if (a) input.value = display(a);
  input.removeAttribute('aria-invalid');
  closeList(input);
  renderDurations();
}
stopsEl.addEventListener('input', (e) => {
  if (e.target.matches('[role=combobox]')) {
    stops.find((x) => x.id === +e.target.closest('[data-id]').dataset.id).code = '';
    openList(e.target);
  }
});
stopsEl.addEventListener('change', (e) => {
  if (e.target.matches('select')) stops.find((x) => x.id === +e.target.closest('[data-id]').dataset.id).layover = +e.target.value;
});
stopsEl.addEventListener('keydown', (e) => {
  const input = e.target;
  if (!input.matches('[role=combobox]')) return;
  const list = $('#' + input.getAttribute('aria-controls'));
  const opts = [...list.querySelectorAll('[role=option]')];
  const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (list.hidden) { openList(input); return; }
    if (!opts.length) return;
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    input.setAttribute('aria-activedescendant', opts[next].id);
    opts[next].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && !list.hidden && cur >= 0) {
    e.preventDefault(); pick(input, opts[cur].dataset.code);
  } else if (e.key === 'Escape' && !list.hidden) {
    e.preventDefault(); closeList(input);
  }
});
// pointerdown (not click) so the choice lands before the input's blur handler runs.
stopsEl.addEventListener('pointerdown', (e) => {
  const opt = e.target.closest('[role=option]');
  if (opt) { e.preventDefault(); pick(opt.closest('.combo').querySelector('input'), opt.dataset.code); }
});
stopsEl.addEventListener('focusout', (e) => {
  const input = e.target;
  if (!input.matches('[role=combobox]')) return;
  const s = stops.find((x) => x.id === +input.closest('[data-id]').dataset.id);
  if (!s.code && input.value.trim()) { // accept the best match for whatever was typed
    const best = searchAirports(input.value, 1)[0];
    if (best) return pick(input, best.code);
  }
  closeList(input);
});
stopsEl.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (!rm) return;
  stops = stops.filter((x) => x.id !== +rm.closest('[data-id]').dataset.id);
  durations = {};
  renderStops();
  $('#add-stop').focus();
});
$('#add-stop').addEventListener('click', () => {
  const s = blank();
  stops.splice(stops.length - 1, 0, s);
  durations = {};
  renderStops();
  $(`#ap-${s.id}`).focus();
});
$('#durations').addEventListener('input', (e) => {
  const i = e.target.dataset.leg;
  if (i != null) e.target.value ? (durations[i] = +e.target.value) : delete durations[i];
});

function setError(msg, el) {
  errEl.hidden = !msg; errEl.textContent = msg || '';
  document.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
}

$('#trip-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const first = stops[0], lastStop = stops[stops.length - 1];
  if (!first.code) return setError('Choose the airport you are leaving from.', $(`#ap-${first.id}`));
  if (!lastStop.code) return setError('Choose the airport you are flying to.', $(`#ap-${lastStop.id}`));
  for (const s of stops.slice(1, -1)) {
    const input = $(`#ap-${s.id}`);
    if (!s.code && input.value.trim()) return setError('We could not find that connecting airport. Pick one from the list or clear the field.', input);
  }
  const used = stops.filter((s) => s.code);
  for (let i = 1; i < used.length; i++) {
    if (used[i].code === used[i - 1].code) return setError('Two stops in a row are the same airport.', $(`#ap-${used[i].id}`));
  }
  if (!depEl.value) return setError('Enter the date and time your first flight departs.', depEl);
  setError('');
  const trip = {
    r: used.map((s) => s.code), t: depEl.value,
    l: used.slice(1, -1).map((s) => s.layover),
    d: used.slice(0, -1).map((_, i) => durations[i] || 0),
  };
  history.pushState(null, '', toQuery(trip));
  run(trip);
});

/* ---------- URL state ---------- */

function toQuery(trip) {
  const p = new URLSearchParams({ r: trip.r.join('-'), t: trip.t });
  if (trip.l.length) p.set('l', trip.l.join(','));
  if (trip.d.some(Boolean)) p.set('d', trip.d.join(','));
  return '?' + p;
}
function fromQuery() {
  const p = new URLSearchParams(location.search);
  const r = (p.get('r') || '').toUpperCase().split('-').filter(Boolean);
  if (r.length < 2 || !p.get('t') || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p.get('t'))) return null;
  const nums = (k) => (p.get(k) || '').split(',').filter(Boolean).map(Number);
  return { r: r.slice(0, 5), t: p.get('t'), l: nums('l'), d: nums('d') };
}
function fillForm(trip) {
  stops = trip.r.map((code, i) => ({ id: ++uid, code: airport(code)?.code || '', layover: trip.l[i - 1] || 90 }));
  durations = {};
  trip.d.forEach((m, i) => { if (m) durations[i] = m; });
  depEl.value = trip.t;
  renderStops();
}

/* ---------- Collapsed form: a summary row once a trip is shown ---------- */

const heroEl = $('#trip-hero');
const editEl = $('#trip-edit');
const changeBtn = $('#change-trip');

// The departure as typed (wall-clock at the first airport), e.g. "Tue 17 Nov 09:15".
function whenText(t) {
  const [d, hm] = t.split('T');
  const ms = Date.UTC(...d.split('-').map((x, i) => +x - (i === 1 ? 1 : 0)), ...hm.split(':').map(Number));
  return `${fmtDay(ms, 'UTC')} ${fmtTime(ms, 'UTC')}`;
}
function showSummary(trip) {
  $('#summary-route').textContent = trip.r.join(' · ');
  $('#summary-when').textContent = whenText(trip.t);
  $('#trip-summary').hidden = false;
  heroEl.classList.add('has-trip');
}
function hideSummary() {
  $('#trip-summary').hidden = true;
  heroEl.classList.remove('has-trip');
  setCollapsed(false);
}
function setCollapsed(on) {
  editEl.hidden = on;
  heroEl.classList.toggle('is-collapsed', on);
  changeBtn.setAttribute('aria-expanded', String(!on));
}
changeBtn.addEventListener('click', () => {
  if (editEl.hidden) {
    setCollapsed(false);
    $('[role=combobox]', stopsEl)?.focus();
  } else {
    if (last) fillForm(last.trip); // closing without checking puts the form back to the trip on screen
    setError('');
    setCollapsed(true);
  }
});

/* ---------- Results ---------- */

const resultsEl = $('#results');

function loading(trip) {
  resultsEl.hidden = false;
  resultsEl.setAttribute('aria-busy', 'true');
  resultsEl.innerHTML = `<div class="tverdict tverdict--calm tverdict--loading"><div class="tverdict__text">
    <h2 id="verdict-title" tabindex="-1">Checking the forecast for ${trip.r.map(esc).join(' → ')}…</h2>
    <p class="tverdict__meta">Lining up each airport with the time you are there.</p></div></div>
    <div class="skeleton" aria-hidden="true"><span></span><span></span></div>`;
}

// Results that mean the trip itself needs changing open the form again.
const fixTrip = (html) => { resultsEl.innerHTML = html; setCollapsed(false); };

async function run(trip) {
  const aps = trip.r.map(airport);
  showSummary(trip);
  if (aps.some((a) => !a)) {
    resultsEl.hidden = false;
    fixTrip(message('We do not recognise one of those airports', 'Check the airport codes in the link, or pick the airports again above.'));
    return;
  }
  const hadFocus = editEl.contains(document.activeElement);
  setCollapsed(true);
  loading(trip);
  if (hadFocus) $('#verdict-title').focus(); // the form just closed under the keyboard: land on the result
  const plan = planTrip(aps, trip.t, trip.l, trip.d);
  const now = Date.now();
  if (plan.end < now - HOUR) {
    fixTrip(message('That trip is in the past', 'Gatecast looks ahead. Pick a departure time from now up to 16 days out.'));
    return done();
  }
  if (plan.start > now + 15.5 * 24 * HOUR) {
    fixTrip(message('That is too far ahead to forecast', `Forecasts reach about 16 days. Come back from ${fmtDay(plan.start - 15 * 24 * HOUR, aps[0].tz)} and this link will work.`));
    return done();
  }
  try {
    const { forecasts, at } = await loadForecasts(aps);
    const result = assessTrip(plan, forecasts, now);
    last = { trip, plan, result, forecasts, at, since: noteTrip(trip, result, now) };
    render();
    remember(trip);
    done(true);
    enrich(result);
  } catch (err) {
    const rate = err.message === 'rate';
    resultsEl.innerHTML = message(
      rate ? 'The forecast service is busy' : 'We could not load the forecast',
      rate ? 'The free forecast service has hit its request limit for this network. Try again in a little while.'
        : 'Check your connection and try again. Your trip details are still in the form under Change trip.',
      true,
    );
    done();
    $('[data-retry]', resultsEl)?.addEventListener('click', () => run(trip));
  }
}
function done(focus) {
  resultsEl.setAttribute('aria-busy', 'false');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = resultsEl.getBoundingClientRect().top;
  if (top < 0 || top > innerHeight * 0.6) $('#trip-hero').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (focus) $('#verdict-title')?.focus({ preventScroll: true });
}
const message = (title, body, retry) => `<div class="verdict verdict--unknown">${riskIcon('unknown')}<div><h2 id="verdict-title" tabindex="-1">${esc(title)}</h2><p>${esc(body)}</p>
  ${retry ? '<button class="btn btn--primary" type="button" data-retry>Try again</button>' : ''}</div></div>`;

/* ---------- What changed since the last look at this trip (js/changes.js; kept on this device only) ---------- */

// The same trip means the same airports, departure, layovers and flight times: its shareable address.
const tripKey = (trip) => toQuery(trip).slice(1);
function noteTrip(trip, result, now) {
  const key = tripKey(trip);
  const r = noteForecast(seenGet('trips', key), tripSnapshot(result, scoreHour, now), diffTrips, now);
  if (r.entry) seenSet('trips', key, r.entry);
  return r.changes ? { key, changes: r.changes, since: r.since } : null;
}
// One line per stop that changed, calm, dismissible; nothing when nothing material changed.
function sinceHTML(c) {
  if (!c) return '';
  const now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<div class="since" role="note" aria-label="Forecast changes since your last look">
    <svg class="icon since__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5"/></svg>
    <div class="since__text"><p class="since__lead">${esc(changeLead(c.since, now, tz))}:</p>
      <ul class="since__list">${c.changes.map((x) => `<li>${esc(changeLine(x))} <small>local time</small>.</li>`).join('')}</ul></div>
    <button type="button" class="btn btn--icon since__close" data-dismiss aria-label="Dismiss this note"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
  </div>`;
}

function render() {
  if (!last) return;
  const { plan, result, forecasts, at, trip } = last;
  const u = units(prefs);
  const startDay = fmtDay(plan.start, plan.stops[0].airport.tz);
  const model = journeyModel(result, plan, forecasts);
  const open = [...resultsEl.querySelectorAll('.tcard__hours[open]')].map((d) => d.closest('[data-stop]')?.dataset.stop);
  resultsEl.innerHTML = `
    ${verdictHTML(result, trip, startDay, at, u)}
    ${sinceHTML(last.since)}
    ${stripHTML(model, u, prefs, startDay)}
    <section class="tstops" aria-labelledby="tstops-title">
      <h2 id="tstops-title">Stop by stop</h2>
      <ol class="tstops__list">${result.stops.map((s, i) => stopCardHTML(s, forecasts.get(s.airport.code) || [], u, startDay, i)).join('')}</ol>
    </section>
    ${adviceHTML(result)}
    ${mapHTML(result, model, prefs)}`;
  for (const i of open) resultsEl.querySelector(`[data-stop="${i}"] .tcard__hours`)?.setAttribute('open', '');
  if (last.live) paintLive();
  if (last.plans) paintPlans();
}

resultsEl.addEventListener('click', async (e) => {
  if (e.target.closest('[data-dismiss]') && last?.since) {
    seenSet('trips', last.since.key, dismiss(seenGet('trips', last.since.key)));
    last.since = null;
    resultsEl.querySelector('.since')?.remove();
    $('#verdict-title')?.focus({ preventScroll: true });
    return;
  }
  const btn = e.target.closest('[data-share]');
  if (!btn) return;
  const label = btn.querySelector('span');
  try { await navigator.clipboard.writeText(location.href); label.textContent = 'Link copied'; }
  catch { label.textContent = 'Copy the address bar'; }
  setTimeout(() => { label.textContent = 'Copy link'; }, 2500);
});

/* ---------- Live layer: alerts in the browser, observations and FAA status via server.js ---------- */

async function enrich(result) {
  const mine = last;
  const aps = result.stops.map((s) => s.airport);
  const [alerts, live] = await Promise.all([Promise.all(aps.map(loadAlerts)), loadLive(aps)]);
  if (last !== mine) return;
  last.live = { alerts: new Map(aps.map((a, i) => [a.code, alerts[i]])), ...(live || {}) };
  paintLive();
  loadPlans(mine, aps);
}

// What the FAA plans today at the trip's US airports, as a quiet line on each stop card. data.js may not have
// loadFaaPlans yet; without it, or when the request fails, the cards simply have no plan line.
async function loadPlans(mine, aps) {
  const us = aps.filter((a) => a.country === 'US');
  if (!us.length) return;
  try {
    const m = await import('./data.js');
    if (typeof m.loadFaaPlans !== 'function') return;
    const got = await m.loadFaaPlans(us.map((a) => a.code));
    if (last !== mine || !Array.isArray(got?.plans)) return;
    last.plans = got.plans;
    paintPlans();
  } catch {}
}
function paintPlans() {
  for (const el of resultsEl.querySelectorAll('[data-plan]')) {
    const a = airport(el.dataset.plan);
    const lines = (last.plans || []).filter((p) => p.airport === a.code || p.airport === a.icao).map((p) => faaPlanLine(p, (ms) => `${fmtTime(ms, a.tz)}`)).filter(Boolean);
    el.innerHTML = lines.map((l) => `<p class="live">${esc(l)}</p>`).join('');
  }
}

const CATEGORY = { MVFR: 'some low cloud or haze', IFR: 'low cloud or poor visibility', LIFR: 'very low cloud or fog' };

function paintLive() {
  const u = units(prefs);
  const { alerts, metar, faa } = last.live;
  for (const el of resultsEl.querySelectorAll('[data-live]')) {
    const a = airport(el.dataset.live);
    const parts = [];
    for (const al of alerts.get(a.code) || []) {
      parts.push(`<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b> in effect now${al.ends ? ` until ${fmtTime(Date.parse(al.ends), a.tz)} ${esc(fmtDay(Date.parse(al.ends), a.tz))}` : ''} <small>National Weather Service</small></span></p>`);
    }
    const m = (metar || []).find((x) => x.icaoId === a.icao);
    if (m) {
      const visM = m.visib == null ? null : parseFloat(m.visib) * 1609 * (String(m.visib).includes('+') ? 1.01 : 1);
      const wind = m.wspd ? `wind ${u.speed(m.wspd * 1.852)}${m.wgst ? `, gusting ${u.speed(m.wgst * 1.852)}` : ''}` : 'calm wind';
      parts.push(`<details class="live live--now"><summary><b>Right now:</b> ${u.temp(m.temp)}${u.tempUnit.slice(1)}, ${wind}, visibility ${u.vis(visM)}${CATEGORY[m.fltCat] ? ` — ${CATEGORY[m.fltCat]}` : ''}
        <small>observed ${fmtTime(m.obsTime * 1000, a.tz)}</small></summary><p class="live__raw"><span>Raw airport report (METAR)</span><code>${esc(m.rawOb)}</code></p></details>`);
    }
    if (faa && a.country === 'US') {
      const rows = faa.airports[a.code] || [];
      parts.push(rows.length
        ? rows.map((r) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>FAA: ${esc(r.type)}</b>${r.detail ? ` — ${esc(r.detail)}` : ''} <small>right now</small></span></p>`).join('')
        : '<p class="live"><span>FAA reports no delay programme at this airport right now.</span></p>');
    }
    el.innerHTML = parts.join('');
  }
}

/* ---------- Examples and recent trips ---------- */

function defaultDeparture() {
  const d = new Date(Date.now() + 24 * HOUR);
  d.setHours(8, 30, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
}
function remember(trip) {
  const key = trip.r.join('-');
  const recents = [{ ...trip, key }, ...store.get('gatecast:recent', []).filter((x) => x.key !== key)].slice(0, 3);
  store.set('gatecast:recent', recents);
  renderExamples();
}
function renderExamples() {
  const now = Date.now();
  const recents = store.get('gatecast:recent', []).filter((x) => x.r?.every(airport));
  const btn = (t, label, cls = '') => `<button type="button" class="pill ${cls}" data-trip='${esc(JSON.stringify(t))}'>${esc(label)}</button>`;
  $('#example-list').innerHTML =
    recents.map((t) => btn({ ...t, t: Date.parse(t.t) > now - 12 * HOUR ? t.t : defaultDeparture() }, t.r.join(' → '), 'pill--recent')).join('') +
    // ex marks a tried-out example, so the Today page never presents it as the visitor's own trip.
    EXAMPLES.map((x) => btn({ r: x.r, l: x.l, d: [], t: defaultDeparture(), ex: true }, x.label)).join('');
  $('.examples__label').textContent = recents.length ? 'Recent and examples' : 'Try an example';
}
$('#example-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-trip]');
  if (!b) return;
  const trip = JSON.parse(b.dataset.trip);
  fillForm(trip);
  history.pushState(null, '', toQuery(trip));
  run(trip);
});

/* ---------- Start ---------- */

function decorateLegend() {
  for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', riskIcon(el.dataset.icon));
}

async function start() {
  initSettings(() => { render(); if (last) showSummary(last.trip); });
  decorateLegend();
  depEl.value = defaultDeparture();
  depEl.max = utcToLocalInput(Date.now() + 15 * 24 * HOUR, Intl.DateTimeFormat().resolvedOptions().timeZone);
  renderStops();
  const shared = fromQuery();
  if (shared) { showSummary(shared); setCollapsed(true); } // no flash of the full form while airports load
  try {
    await loadAirports();
  } catch {
    setCollapsed(false);
    setError('The airport list did not load. Check your connection and reload the page.');
    return;
  }
  renderExamples();
  const apply = () => {
    const trip = fromQuery();
    if (trip) { fillForm(trip); run(trip); } else { resultsEl.hidden = true; last = null; hideSummary(); }
  };
  window.addEventListener('popstate', apply);
  apply();
}
start();
