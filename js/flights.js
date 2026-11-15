// Flights page: live flight tracking with weather at both ends, and an airport weather view.
import { assessWindow, describeCode, distanceKm, factorPhrase, fmtTime, fmtDay, fmtZone, fmtDuration, HOUR, LEVEL_LABEL } from './core.js';
import { loadAirports, airport, searchAirports, loadForecasts, loadAlerts, loadLive, loadFlight, loadNearby } from './data.js';
import { $, prefs, initSettings } from './shell.js';
import { esc, weatherIcon, riskIcon, chip, units, compass, routeMap, hourlyStrip } from './view.js';

const resultsEl = $('#results');
const errEl = $('#form-error');
const flightInput = $('#flight');
const airportInput = $('#airport');
const listEl = $('#airport-list');
let state = null; // { kind: 'flight' | 'airport', ... }
let refresh;

const EXAMPLES = [
  { label: 'UA 1', flight: 'UA1' }, { label: 'BA 117', flight: 'BA117' }, { label: 'EK 201', flight: 'EK201' },
  { label: 'Chicago O’Hare', airport: 'ORD' }, { label: 'London Heathrow', airport: 'LHR' },
];

/* ---------- Form ---------- */

function mode() { return $('input[name="mode"]:checked').value; }
function setMode(m) {
  $(`input[name="mode"][value="${m}"]`).checked = true;
  $('#flight-field').hidden = m !== 'flight';
  $('#airport-field').hidden = m !== 'airport';
}
$('.lookup__mode').addEventListener('change', () => { setMode(mode()); setError(''); (mode() === 'flight' ? flightInput : airportInput).focus(); });

function setError(msg, el) {
  errEl.hidden = !msg; errEl.textContent = msg || '';
  [flightInput, airportInput].forEach((x) => x.removeAttribute('aria-invalid'));
  if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
}

let picked = '';
function closeList() { listEl.hidden = true; airportInput.setAttribute('aria-expanded', 'false'); airportInput.removeAttribute('aria-activedescendant'); }
function pick(code) {
  const a = airport(code);
  if (!a) return;
  picked = a.code; airportInput.value = `${a.city || a.name} (${a.code})`; closeList();
}
airportInput.addEventListener('input', () => {
  picked = '';
  const res = searchAirports(airportInput.value);
  if (!res.length) return closeList();
  listEl.innerHTML = res.map((a, i) => `<li role="option" id="airport-o${i}" data-code="${a.code}" aria-selected="${i === 0}">
    <span class="code">${a.code}</span><span class="combo__name">${esc(a.city || a.name)}<small>${esc(a.name)} · ${esc(a.country)}</small></span></li>`).join('');
  listEl.hidden = false; airportInput.setAttribute('aria-expanded', 'true'); airportInput.setAttribute('aria-activedescendant', 'airport-o0');
});
airportInput.addEventListener('keydown', (e) => {
  const opts = [...listEl.querySelectorAll('[role=option]')];
  const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opts.length && !listEl.hidden) {
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    airportInput.setAttribute('aria-activedescendant', opts[next].id);
  } else if (e.key === 'Enter' && !listEl.hidden && cur >= 0) { pick(opts[cur].dataset.code); }
  else if (e.key === 'Escape') closeList();
});
listEl.addEventListener('pointerdown', (e) => { const o = e.target.closest('[role=option]'); if (o) { e.preventDefault(); pick(o.dataset.code); } });
airportInput.addEventListener('blur', () => setTimeout(() => {
  if (!picked && airportInput.value.trim()) { const best = searchAirports(airportInput.value, 1)[0]; if (best) pick(best.code); }
  closeList();
}, 100));

$('#flight-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (mode() === 'flight') {
    const q = flightInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/.test(q)) return setError('Enter a flight number such as UA 1 or BA117: the airline code followed by the number.', flightInput);
    setError(''); go({ flight: q });
  } else {
    if (!picked && airportInput.value.trim()) { const best = searchAirports(airportInput.value, 1)[0]; if (best) pick(best.code); }
    if (!picked) return setError('Choose an airport from the list.', airportInput);
    setError(''); go({ airport: picked });
  }
});

function go(q, push = true) {
  if (push) history.pushState(null, '', '?' + new URLSearchParams(q));
  clearInterval(refresh);
  if (q.flight) { setMode('flight'); flightInput.value = q.flight; showFlight(q.flight); }
  else { setMode('airport'); pick(q.airport); showAirport(q.airport); }
}

/* ---------- Shared pieces ---------- */

function busy(text) {
  resultsEl.hidden = false; resultsEl.setAttribute('aria-live', 'polite'); resultsEl.setAttribute('aria-busy', 'true');
  resultsEl.innerHTML = `<div class="verdict verdict--loading"><div><h2>${esc(text)}</h2></div></div><div class="skeleton" aria-hidden="true"><span></span><span></span></div>`;
}
function settle() {
  resultsEl.setAttribute('aria-busy', 'false');
  resultsEl.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  $('h2', resultsEl)?.focus({ preventScroll: true });
}
const message = (title, body) => `<div class="verdict verdict--unknown">${riskIcon('unknown')}<div><h2 tabindex="-1">${esc(title)}</h2><p>${esc(body)}</p></div></div>`;
const far = (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`);
const hourAt = (hours, ms) => hours.find((h) => h.t <= ms && ms < h.t + HOUR) || null;

// Weather summary card for an airport around a given time.
function airportCard(a, hours, u, { title, at, link = true }) {
  const risk = assessWindow(hours, at - HOUR, at + 2 * HOUR);
  const h = (risk.score >= 30 && risk.worst) || hourAt(hours, at);
  const d = h ? describeCode(h.code) : null;
  const why = risk.level === 'unknown' ? 'No forecast for this time.' : risk.factors.length ? `Forecast shows ${factorPhrase(risk.factors)}.` : 'Nothing in the forecast that usually slows this airport down.';
  return `<article class="stop stop--${risk.level}">
    <header class="stop__head">
      <div><p class="stop__role">${esc(title)}</p>
        <h3><span class="code">${a.code}</span> ${esc(a.city || a.name)}</h3>
        <p class="stop__name">${esc(a.name)} · ${fmtTime(Date.now(), a.tz)} ${esc(fmtZone(Date.now(), a.tz))} now</p></div>
      ${chip(risk.level, risk.level === 'unknown' ? 'No forecast' : `${LEVEL_LABEL[risk.level]} risk`)}
    </header>
    ${h ? `<div class="stop__wx">
      <div class="stop__now">${weatherIcon(h.code, h.day, 'wx--lg')}<div><p class="stop__temp">${u.temp(h.temp)}<small>${u.tempUnit.slice(1)}</small></p><p>${esc(d.text)}</p></div></div>
      <dl class="facts">
        <div><dt>Gusts</dt><dd>${u.speed(h.gust)} <small>${compass(h.dir)}</small></dd></div>
        <div><dt>Rain or snow</dt><dd>${h.pop ?? 0}% <small>chance</small></dd></div>
        <div><dt>Visibility</dt><dd>${u.vis(h.vis)}</dd></div>
      </dl>
      <p class="stop__when">Forecast for ${fmtTime(h.t, a.tz)} ${esc(fmtZone(h.t, a.tz))}, ${esc(fmtDay(h.t, a.tz))}</p>
    </div>` : ''}
    <p class="stop__why">${esc(why)}</p>
    <div class="stop__live" data-live="${a.code}"></div>
    ${link ? `<p class="muted"><a href="?airport=${a.code}" data-airport="${a.code}">More on ${a.code}</a></p>` : ''}
  </article>`;
}

const CATEGORY = { MVFR: 'some low cloud or haze', IFR: 'low cloud or poor visibility', LIFR: 'very low cloud or fog' };
function paintLive(live, alerts) {
  const u = units(prefs);
  for (const el of resultsEl.querySelectorAll('[data-live]')) {
    const a = airport(el.dataset.live);
    if (!a) continue;
    const parts = [];
    for (const al of (alerts && alerts.get(a.code)) || []) {
      parts.push(`<p class="live live--alert">${riskIcon('elevated')}<span><b>${esc(al.event)}</b> in effect now <small>National Weather Service</small></span></p>`);
    }
    const m = live && (live.metar || []).find((x) => x.icaoId === a.icao);
    if (m) {
      const visM = m.visib == null ? null : parseFloat(m.visib) * 1609 * (String(m.visib).includes('+') ? 1.01 : 1);
      const wind = m.wspd ? `wind ${u.speed(m.wspd * 1.852)}${m.wgst ? `, gusting ${u.speed(m.wgst * 1.852)}` : ''}` : 'calm wind';
      parts.push(`<details class="live live--now"><summary><b>Right now:</b> ${u.temp(m.temp)}${u.tempUnit.slice(1)}, ${wind}, visibility ${u.vis(visM)}${CATEGORY[m.fltCat] ? ` — ${CATEGORY[m.fltCat]}` : ''}
        <small>observed ${fmtTime(m.obsTime * 1000, a.tz)}</small></summary><p class="live__raw"><span>Raw airport report (METAR)</span><code>${esc(m.rawOb)}</code></p></details>`);
    }
    if (live && live.faa && a.country === 'US') {
      const rows = live.faa.airports[a.code] || [];
      parts.push(rows.length
        ? rows.map((r) => `<p class="live live--alert">${riskIcon('elevated')}<span><b>FAA: ${esc(r.type)}</b>${r.detail ? ` — ${esc(r.detail)}` : ''} <small>right now</small></span></p>`).join('')
        : '<p class="live"><span>FAA reports no delay programme at this airport right now.</span></p>');
    }
    el.innerHTML = parts.join('');
  }
}

/* ---------- Flight ---------- */

// The route service knows airports the bundled list may not; fall back to its fields.
function resolveAirport(r) {
  if (!r) return null;
  return airport(r.iata) || { code: r.iata || r.icao, icao: r.icao, name: r.name, city: r.city, country: r.country, lat: r.lat, lon: r.lon, tz: 'UTC' };
}

async function showFlight(q, quiet = false) {
  if (!quiet) busy(`Looking up ${q}…`);
  let f;
  try { f = await loadFlight(q); } catch {
    if (quiet) return;
    resultsEl.innerHTML = message('Flight tracking is not available here', 'This copy of the site is running without its live-data service. Airport weather and the connection checker still work.');
    return settle();
  }
  if (f.error) {
    if (quiet) return;
    resultsEl.innerHTML = message(f.error === 'airline' ? `We do not know an airline with the code ${f.prefix}` : 'That does not look like a flight number', 'Use the airline code followed by the number, for example UA 1 or BA117.');
    return settle();
  }
  const from = resolveAirport(f.origin), to = resolveAirport(f.destination);
  if (!from && !to && !f.live) {
    if (quiet) return;
    resultsEl.innerHTML = message(`No information for ${f.flight} right now`, 'We could not find a route for this flight number and it is not being tracked in the air. Check the number, or try again closer to departure.');
    return settle();
  }
  const aps = [from, to].filter(Boolean);
  const fc = aps.length ? await loadForecasts(aps).catch(() => null) : null;
  state = { kind: 'flight', q, f, from, to, fc, live: state && state.kind === 'flight' && state.q === q ? state.live : null, alerts: null };
  renderFlight();
  if (!quiet) {
    settle();
    Promise.all([loadLive(aps), Promise.all(aps.map(loadAlerts))]).then(([live, alerts]) => {
      if (!state || state.q !== q) return;
      state.live = live; state.alerts = new Map(aps.map((a, i) => [a.code, alerts[i]]));
      paintLive(state.live, state.alerts);
    });
    // Refresh the position every 30 seconds while the flight is airborne and the tab is visible.
    clearInterval(refresh);
    refresh = setInterval(() => {
      if (document.visibilityState !== 'visible' || !state || state.kind !== 'flight') return;
      resultsEl.setAttribute('aria-live', 'off');
      showFlight(q, true);
    }, 30e3);
  }
}

function renderFlight() {
  const { f, from, to, fc } = state;
  const u = units(prefs), live = f.live, now = Date.now();
  const airborne = live && !live.onGround && (live.altFt ?? 0) > 0;
  let progress = '', eta = null, statusText, statusLevel;
  if (airborne) { statusText = 'In the air'; statusLevel = 'low'; }
  else if (live) { statusText = 'On the ground'; statusLevel = 'unknown'; }
  else { statusText = 'Not tracked right now'; statusLevel = 'unknown'; }

  if (from && to) {
    const total = distanceKm(from, to);
    let pct = 0, line = `${far(total)} route`;
    if (live) {
      const left = distanceKm(live, to);
      pct = Math.max(0, Math.min(1, 1 - left / total));
      if (airborne && live.gsKt > 100) {
        // While climbing the current speed understates the cruise, so far from landing assume at least a typical cruise.
        const kmh = Math.max(live.gsKt * 1.852, left > 300 ? 780 : 0);
        const min = left / kmh * 60 + 12;
        eta = now + min * 60e3;
        line = `${far(left)} to go · about ${fmtDuration(Math.round(min / 5) * 5)} · lands around ${fmtTime(eta, to.tz)} ${fmtZone(eta, to.tz)}`;
      } else if (live.onGround) {
        line = distanceKm(live, from) < distanceKm(live, to) ? `On the ground at or near ${from.code}` : `On the ground at or near ${to.code}`;
      }
    }
    progress = `<div class="progress" role="img" aria-label="${Math.round(pct * 100)} percent of the route flown">
        <span class="code">${from.code}</span>
        <span class="progress__track"><i style="--pct:${(pct * 100).toFixed(1)}%"></i><svg class="progress__plane" style="--pct:${(pct * 100).toFixed(1)}%" viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true"><path transform="rotate(90)" d="M0 -1.1 0.22 -0.25 1.05 0.3 1.05 0.5 0.22 0.25 0.16 0.8 0.42 1 0.42 1.12 0 1 -0.42 1.12 -0.42 1 -0.16 0.8 -0.22 0.25 -1.05 0.5 -1.05 0.3 -0.22 -0.25z"/></svg></span>
        <span class="code">${to.code}</span>
      </div><p class="progress__text">${esc(line)}</p>`;
  }
  const vr = live && live.vRateFpm;
  const trend = vr == null ? '' : vr > 400 ? 'Climbing' : vr < -400 ? 'Descending' : 'Level';
  const stats = live ? `<dl class="facts facts--wide">
      <div><dt>Altitude</dt><dd>${live.onGround ? 'Ground' : `${Math.round(live.altFt).toLocaleString()} ft`} <small>${airborne ? trend : ''}</small></dd></div>
      <div><dt>Ground speed</dt><dd>${live.gsKt == null ? '–' : u.speed(live.gsKt * 1.852)}</dd></div>
      <div><dt>Aircraft</dt><dd>${esc(live.type || '–')} <small>${esc(live.registration)}</small></dd></div>
      <div><dt>Position</dt><dd>${live.seenS == null ? '–' : live.seenS < 60 ? `${Math.round(live.seenS)} s ago` : `${Math.round(live.seenS / 60)} min ago`}</dd></div>
    </dl>` : `<p class="muted">${f.liveError ? 'Live tracking is not responding right now.' : 'No aircraft is broadcasting this flight number at the moment. It may not have departed yet, may have landed, or may be out of receiver range.'}</p>`;

  const hoursOf = (a) => (fc ? fc.forecasts.get(a.code) || [] : []);
  const route = from && to ? `${esc(from.city || from.code)} → ${esc(to.city || to.code)}` : from ? `from ${esc(from.city || from.code)}` : to ? `to ${esc(to.city || to.code)}` : 'route unknown';
  const stops = [from, to].filter(Boolean).map((a, i) => ({ airport: a, level: assessWindow(hoursOf(a), (i === 1 && eta ? eta : now) - HOUR, (i === 1 && eta ? eta : now) + 2 * HOUR).level }));

  resultsEl.innerHTML = `
    <div class="flight">
      <div class="flight__head">
        <div><p class="verdict__eyebrow">${esc(f.airline ? f.airline.name : 'Flight')} · ${esc(f.callsign)}</p>
          <h2 tabindex="-1">${esc(f.flight)} <span class="flight__route">${route}</span></h2></div>
        <span class="status status--${airborne ? 'air' : 'idle'}">${airborne ? '<i aria-hidden="true"></i>' : ''}${statusText}</span>
      </div>
      ${progress}
      ${stats}
      <p class="flight__note">Live position from community aircraft receivers, refreshed every 30 seconds. Scheduled times, gates and cancellations need an airline data feed and are not shown; check your airline for those.</p>
    </div>
    <div class="results__grid">
      <div class="journey"><div class="journey__list journey__list--gap">
        ${from ? airportCard(from, hoursOf(from), u, { title: 'Departure airport · weather now', at: now }) : ''}
        ${to ? airportCard(to, hoursOf(to), u, { title: eta ? 'Arrival airport · weather at landing' : 'Arrival airport · weather now', at: eta || now }) : ''}
      </div></div>
      <aside class="side" aria-label="Route map">
        ${stops.length === 2 ? `<figure class="map-card">${routeMap(stops, live && !live.onGround ? live : null)}
          <figcaption>${stops.map((s) => `<span>${chip(s.level, s.airport.code)}</span>`).join('<i aria-hidden="true">→</i>')}</figcaption></figure>` : ''}
        ${from && to ? `<div class="tips"><h3>Connecting onward?</h3><ul><li><a href="trip.html">Check a connection</a> through ${esc(to.city || to.code)} against the forecast.</li></ul></div>` : ''}
      </aside>
    </div>`;
  if (state.live || state.alerts) paintLive(state.live, state.alerts);
}

/* ---------- Airport ---------- */

async function showAirport(code) {
  const a = airport(code);
  if (!a) { resultsEl.hidden = false; resultsEl.innerHTML = message('We do not recognise that airport', 'Pick an airport from the search above.'); return; }
  busy(`Checking ${a.code}…`);
  let fc;
  try { fc = await loadForecasts([a]); } catch (err) {
    resultsEl.innerHTML = message(err.message === 'rate' ? 'The forecast service is busy' : 'We could not load the forecast', 'Try again in a little while.');
    return settle();
  }
  state = { kind: 'airport', a, fc, live: null, alerts: null, nearby: undefined };
  renderAirport();
  settle();
  const [live, alerts, nearby] = await Promise.all([loadLive([a]), loadAlerts(a), loadNearby(a)]);
  if (!state || state.a !== a) return;
  state.live = live; state.alerts = new Map([[a.code, alerts]]); state.nearby = nearby;
  renderAirport();
}

function renderAirport() {
  const { a, fc, nearby } = state;
  const u = units(prefs), now = Date.now(), hours = fc.forecasts.get(a.code) || [];
  const stop = { airport: a, from: now, to: now + 3 * HOUR, arr: null, dep: null };
  const list = nearby === undefined ? '<p class="muted">Looking for aircraft nearby…</p>'
    : nearby === null ? '<p class="muted">Live aircraft are not available on this copy of the site.</p>'
      : nearby.length ? `<ul class="nearby">${nearby.map((n) => `<li><button type="button" class="pill pill--recent" data-flight="${esc(n.callsign)}">${esc(n.callsign)}</button>
          <span>${n.onGround ? 'On the ground' : `${Math.round(n.altFt / 100) * 100} ft`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${n.type ? ` · ${esc(n.type)}` : ''}</span><small>${n.nm == null ? '' : far(n.nm * 1.852)}</small></li>`).join('')}</ul>`
        : '<p class="muted">No airline flights within 75 km right now.</p>';
  resultsEl.innerHTML = `
    <div class="results__grid results__grid--airport">
      <div class="journey"><div class="journey__list journey__list--gap">
        ${airportCard(a, hours, u, { title: 'Airport weather · next 3 hours', at: now + HOUR, link: false }).replace('<h3>', '<h2 tabindex="-1" class="stop__title">').replace('</h3>', '</h2>')}
        <section class="panel"><h2>Next 12 hours at ${a.code}</h2>
          ${hourlyStrip(stop, hours, u, { range: [now, now + 11 * HOUR], legend: 'Shaded = next 3 hours' }) || '<p class="muted">No forecast available.</p>'}
        </section>
      </div></div>
      <aside class="side">
        <section class="panel"><h2>In the air nearby</h2>${list}
          <p class="muted">Select a flight to track it.</p></section>
        <div class="tips"><h3>Flying through ${a.code}?</h3><ul><li><a href="trip.html">Check a connection</a> against the forecast for your times.</li></ul></div>
      </aside>
    </div>`;
  if (state.live || state.alerts) paintLive(state.live, state.alerts);
}

resultsEl.addEventListener('click', (e) => {
  const f = e.target.closest('[data-flight]');
  if (f) return go({ flight: f.dataset.flight });
  const a = e.target.closest('[data-airport]');
  if (a) { e.preventDefault(); go({ airport: a.dataset.airport }); }
});

/* ---------- Start ---------- */

function rerender() { if (!state) return; state.kind === 'flight' ? renderFlight() : renderAirport(); }

async function start() {
  initSettings(rerender);
  $('#example-list').innerHTML = EXAMPLES.map((x, i) => `<button type="button" class="pill" data-ex="${i}">${esc(x.label)}</button>`).join('');
  $('#example-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    const x = EXAMPLES[+b.dataset.ex];
    go(x.flight ? { flight: x.flight } : { airport: x.airport });
  });
  try { await loadAirports(); } catch { return setError('The airport list did not load. Check your connection and reload the page.'); }
  const apply = () => {
    const p = new URLSearchParams(location.search);
    if (p.get('flight')) go({ flight: p.get('flight').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) }, false);
    else if (p.get('airport')) go({ airport: p.get('airport').toUpperCase().slice(0, 3) }, false);
    else { resultsEl.hidden = true; state = null; clearInterval(refresh); }
  };
  window.addEventListener('popstate', apply);
  apply();
}
start();
