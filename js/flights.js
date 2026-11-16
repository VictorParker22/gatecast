// Flights page: live flight tracking with weather at both ends, and an airport weather view.
import { assessWindow, describeCode, distanceKm, factorPhrase, fmtTime, fmtDay, fmtZone, fmtDuration, HOUR, LEVEL_LABEL } from './core.js';
import { loadAirports, airport, searchAirports, loadForecasts, loadAlerts, loadLive, loadFlight, loadNearby, loadFaaPlans } from './data.js';
import { $, prefs, initSettings } from './shell.js';
import { esc, weatherIcon, riskIcon, chip, units, compass, routeMap, hourlyStrip } from './view.js';
import { flightNames, freshness, endsVerdict } from './flightstatus.js';

const resultsEl = $('#results');
const errEl = $('#form-error');
const flightInput = $('#flight');
const airportInput = $('#airport');
const listEl = $('#airport-list');
let state = null; // { kind: 'flight' | 'airport', ... }
let refresh, ticker;

const FLIGHT_RE = /^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/;
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
    if (!FLIGHT_RE.test(q)) return setError('Enter a flight number such as UA 1 or BA117: the airline code followed by the number.', flightInput);
    setError(''); go({ flight: q });
  } else {
    if (!picked && airportInput.value.trim()) { const best = searchAirports(airportInput.value, 1)[0]; if (best) pick(best.code); }
    if (!picked) return setError('Choose an airport from the list.', airportInput);
    setError(''); go({ airport: picked });
  }
});

function go(q, push = true) {
  if (push) history.pushState(null, '', '?' + new URLSearchParams(q));
  clearInterval(refresh); clearInterval(ticker);
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
// Replace the results without losing the visitor's place: keeps focus (by id) and any disclosure they opened.
function paint(html) {
  const el = resultsEl.contains(document.activeElement) ? document.activeElement : null;
  // A selector that finds the same control in the new markup.
  const key = !el ? '' : el.id ? `#${el.id}` : el.matches('summary') && el.parentElement.dataset.key ? `details[data-key="${el.parentElement.dataset.key}"] > summary`
    : el.dataset.flight ? `[data-flight="${el.dataset.flight}"]` : el.dataset.airport ? `[data-airport="${el.dataset.airport}"]` : el.matches('.fl-board') ? '.fl-board' : '';
  const open = new Set([...resultsEl.querySelectorAll('details[data-key]')].filter((d) => d.open).map((d) => d.dataset.key));
  resultsEl.innerHTML = html;
  for (const d of resultsEl.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
  if (key) resultsEl.querySelector(key)?.focus({ preventScroll: true });
}
const message = (title, body) => `<div class="verdict verdict--unknown">${riskIcon('unknown')}<div><h2 tabindex="-1">${esc(title)}</h2><p>${esc(body)}</p></div></div>`;
const far = (km) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609).toLocaleString('en-US')} mi` : `${Math.round(km).toLocaleString('en-US')} km`);
const farVal = (km) => Math.round(prefs.wind === 'mph' ? km / 1.609 : km).toLocaleString('en-US');
const hourAt = (hours, ms) => hours.find((h) => h.t <= ms && ms < h.t + HOUR) || null;
const timeZ = (ms, tz) => `${fmtTime(ms, tz)} ${fmtZone(ms, tz)}`;

// Weather at one airport around a time: the risk, and the hour to show (the worst one when it matters).
function weatherAt(a, hours, at, role, when) {
  const risk = assessWindow(hours, at - HOUR, at + 2 * HOUR);
  const h = (risk.score >= 30 && risk.worst) || hourAt(hours, at);
  return { a, hours, at, role, when, risk, h, level: risk.level, code: a.code };
}
const levelText = (level) => (level === 'unknown' ? 'No forecast' : `${LEVEL_LABEL[level]} risk`);
const why = (risk) => (risk.level === 'unknown' ? 'No forecast for this time.'
  : risk.factors.length ? `Forecast shows ${factorPhrase(risk.factors)}.` : 'Nothing in the forecast that usually slows this airport down.');
// "LHR 4° clear now" for the one-line summary.
function brief(w, u) {
  if (!w.h) return `${w.code} no forecast`;
  const at = w.when === 'landing' ? 'at landing' : w.when === 'next3h' && w.risk.score >= 30 ? `at ${fmtTime(w.h.t, w.a.tz)}` : 'now';
  return `<span class="code">${w.code}</span> <span class="num">${u.temp(w.h.temp)}</span> ${esc(describeCode(w.h.code).text.toLowerCase())} ${at}`;
}

// Full weather card for an airport. Low risk is drawn quietly (grey rule and tick), risk keeps its colour.
function airportCard(w, u, { title, link = true }) {
  const { a, h, risk } = w;
  const level = risk.level;
  const quiet = level === 'low';
  return `<article class="stop stop--${level}${quiet ? ' stop--calm' : ''}">
    <header class="stop__head">
      <div><p class="stop__role">${esc(title)}</p>
        <h3><span class="code">${a.code}</span> ${esc(a.city || a.name)}</h3>
        <p class="stop__name">${esc(a.name)} · ${timeZ(Date.now(), a.tz)} now</p></div>
      ${chip(level, levelText(level)).replace('class="chip', quiet ? 'class="chip chip--calm' : 'class="chip')}
    </header>
    ${h ? `<div class="stop__wx">
      <div class="stop__now">${weatherIcon(h.code, h.day, 'wx--lg')}<div><p class="stop__temp">${u.temp(h.temp)}<small>${u.tempUnit.slice(1)}</small></p><p>${esc(describeCode(h.code).text)}</p></div></div>
      <dl class="facts">
        <div><dt>Gusts</dt><dd>${u.speed(h.gust)} <small>${compass(h.dir)}</small></dd></div>
        <div><dt>Rain or snow</dt><dd>${h.pop ?? 0}% <small>chance</small></dd></div>
        <div><dt>Visibility</dt><dd>${u.vis(h.vis)}</dd></div>
      </dl>
      <p class="stop__when">Forecast for ${timeZ(h.t, a.tz)}, ${esc(fmtDay(h.t, a.tz))}</p>
    </div>` : ''}
    <p class="stop__why">${esc(why(risk))}</p>
    ${observation(a, u)}
    ${link ? `<p class="muted"><a href="?airport=${a.code}" data-airport="${a.code}">More on ${a.code}</a></p>` : ''}
  </article>`;
}

/* ---------- Live rows (NOAA observation, NWS alerts, FAA programmes) ---------- */

const CATEGORY = { MVFR: 'some low cloud or haze', IFR: 'low cloud or poor visibility', LIFR: 'very low cloud or fog' };
// The latest airport observation, raw report one tap deeper. Lives inside the airport card.
function observation(a, u) {
  const live = state && state.live;
  const m = live && (live.metar || []).find((x) => x.icaoId === a.icao);
  const rows = [];
  if (m) {
    const visM = m.visib == null ? null : parseFloat(m.visib) * 1609 * (String(m.visib).includes('+') ? 1.01 : 1);
    const wind = m.wspd ? `wind ${u.speed(m.wspd * 1.852)}${m.wgst ? `, gusting ${u.speed(m.wgst * 1.852)}` : ''}` : 'calm wind';
    rows.push(`<details class="live live--now" data-key="raw-${a.code}"><summary><b>Right now:</b> ${u.temp(m.temp)}${u.tempUnit.slice(1)}, ${wind}, visibility ${u.vis(visM)}${CATEGORY[m.fltCat] ? ` — ${CATEGORY[m.fltCat]}` : ''}
      <small>observed ${fmtTime(m.obsTime * 1000, a.tz)}</small></summary><p class="live__raw"><span>Raw airport report (METAR)</span><code>${esc(m.rawOb)}</code></p></details>`);
  }
  if (live && live.faa && a.country === 'US' && !(live.faa.airports[a.code] || []).length) {
    rows.push('<p class="live"><span>FAA reports no delay programme at this airport right now.</span></p>');
  }
  return rows.length ? `<div class="stop__live">${rows.join('')}</div>` : '';
}
// Alerts and delay programmes are news, so they never hide inside a collapsed card.
function alertRows(airports, many) {
  const live = state && state.live, alerts = state && state.alerts;
  const rows = [];
  for (const a of airports) {
    const at = many ? `${a.code} · ` : '';
    for (const al of (alerts && alerts.get(a.code)) || []) {
      rows.push(`<p class="live live--alert">${riskIcon('elevated')}<span><b>${at}${esc(al.event)}</b> in effect now <small>National Weather Service</small></span></p>`);
    }
    if (live && live.faa && a.country === 'US') {
      for (const r of live.faa.airports[a.code] || []) {
        rows.push(`<p class="live live--alert">${riskIcon('elevated')}<span><b>${at}FAA: ${esc(r.type)}</b>${r.detail ? ` — ${esc(r.detail)}` : ''} <small>right now</small></span></p>`);
      }
    }
  }
  return rows;
}

// What the FAA plans today (operations plan, NAS Status airport events): one quiet line each, never a verdict.
// Programs already in force, or already listed by the FAA status rows above, are left to those rows; de-icing
// shows while it is reported.
function planRows(airports, many) {
  const fp = state && state.plans;
  if (!fp || !fp.plans.length) return [];
  const rows = [];
  for (const a of airports) {
    if (a.country !== 'US') continue;
    const tz = a.tz, today = fmtDay(Date.now(), tz);
    const t = (iso) => { const ms = Date.parse(iso); return `${fmtTime(ms, tz)}${fmtDay(ms, tz) !== today ? ` ${fmtDay(ms, tz)}` : ''}`; };
    for (const p of fp.plans.filter((x) => x.airport === a.code)) {
      if (p.status === 'active' && p.kind !== 'deicing') continue;
      const listed = (state.live && state.live.faa && state.live.faa.airports[a.code]) || [];
      if (p.from === 'airport-events' && listed.some((r) => (p.kind === 'ground_stop' ? /ground stop/i : /delay program/i).test(r.type))) continue;
      const what = p.kind === 'other' ? `“${p.text}”` : p.summary;
      const when = p.kind === 'deicing' ? (p.start ? `since ${t(p.start)}` : '')
        : p.start && p.end ? `${t(p.start)}–${t(p.end)}` : p.start ? `after ${t(p.start)}` : p.end ? `until ${t(p.end)}` : '';
      const zone = when ? ` ${fmtZone(Date.parse(p.start || p.end), tz)}` : '';
      const label = p.status === 'planned' ? 'FAA plan' : 'FAA';
      rows.push(`<p class="live live--plan"><span><b>${many ? `${a.code} · ` : ''}${label}:</b> ${esc(what)}${when ? `${p.kind === 'deicing' ? ' ' : ', '}${esc(when + zone)}` : ''}<small>, ${p.link ? `<a href="${esc(p.link)}" rel="noopener">FAA NAS Status</a>` : 'FAA NAS Status'}</small></span></p>`);
    }
  }
  return rows;
}

// The weather block shared by both modes: one verdict line, alerts, then cards.
// Calm collapses (one grey line, cards behind "Details"); risk expands (that airport's card first, open).
function weatherBlock(ends, u, { id, link, cardTitle, many }) {
  const v = endsVerdict(ends);
  const alerts = alertRows(ends.map((e) => e.a), many);
  const plans = planRows(ends.map((e) => e.a), many);
  let title = v.title;
  if (v.kind === 'calm' && alerts.length) title = many ? 'The forecast looks calm at both ends' : `The forecast looks calm at ${ends[0].code}`;
  const level = v.kind === 'risk' ? v.order[0].level : v.kind === 'calm' ? 'low' : 'unknown';
  const card = (w) => airportCard(w, u, { title: cardTitle(w), link });
  const risky = v.order.filter((w) => w.level === 'elevated' || w.level === 'high');
  const rest = v.order.filter((w) => !risky.includes(w));
  let cards;
  if (v.kind === 'unknown') cards = rest.map(card).join(''); // only observations to show: keep them open
  else {
    const label = risky.length ? `Details for ${rest.map((w) => w.code).join(' and ')}` : 'Details';
    cards = risky.map(card).join('') + (rest.length ? `<details class="fl-wxmore" data-key="${id}-more"><summary><span>${esc(label)}</span></summary><div class="fl-wxmore__cards">${rest.map(card).join('')}</div></details>` : '');
  }
  return `<section class="fl-wx fl-wx--${v.kind} fl-wx--${level}" aria-labelledby="${id}">
    <div class="fl-wxline">${riskIcon(level)}<div>
      <h2 id="${id}" tabindex="-1">${esc(title)}</h2>
      <p class="fl-wxline__now">${v.kind === 'unknown' ? 'The forecast did not load. Try again in a little while.'
        : ends.map((w) => brief(w, u)).join('<span aria-hidden="true"> · </span><span class="sr-only">, </span>')}</p>
    </div></div>
    ${alerts.length ? `<div class="fl-wx__alerts">${alerts.join('')}</div>` : ''}
    ${plans.length ? `<div class="fl-wx__plans">${plans.join('')}</div>` : ''}
    <div class="fl-wx__cards">${cards}</div>
  </section>`;
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
    resultsEl.innerHTML = message(`No information for ${q} right now`, 'We could not find a route for this flight number and it is not being tracked in the air. Check the number, or try again closer to departure.');
    return settle();
  }
  const aps = [from, to].filter(Boolean);
  const fc = aps.length ? await loadForecasts(aps).catch(() => null) : null;
  const same = state && state.kind === 'flight' && state.q === q;
  state = { kind: 'flight', q, f, from, to, fc, live: same ? state.live : null, alerts: same ? state.alerts : null, plans: same ? state.plans : null };
  if (quiet) { resultsEl.setAttribute('aria-live', 'off'); paint(renderFlight()); return; }
  resultsEl.innerHTML = renderFlight();
  settle();
  const us = aps.filter((a) => a.country === 'US').map((a) => a.code);
  Promise.all([loadLive(aps), Promise.all(aps.map(loadAlerts)), us.length ? loadFaaPlans(us) : null]).then(([live, alerts, plans]) => {
    if (!state || state.q !== q) return;
    state.live = live; state.alerts = new Map(aps.map((a, i) => [a.code, alerts[i]])); state.plans = plans;
    resultsEl.setAttribute('aria-live', 'off');
    paint(renderFlight());
  });
  // Refresh the position every 30 seconds while the tab is visible; between refreshes, keep the age honest.
  clearInterval(refresh); clearInterval(ticker);
  refresh = setInterval(() => {
    if (document.visibilityState !== 'visible' || !state || state.kind !== 'flight') return;
    showFlight(q, true);
  }, 30e3);
  ticker = setInterval(updateFreshness, 10e3);
}

const positionAge = (f, now = Date.now()) => (f.live ? (f.live.seenS ?? 0) + Math.max(0, now - (f.at || now)) / 1000 : null);
function updateFreshness() {
  if (!state || state.kind !== 'flight' || !state.f.live) return;
  const el = $('[data-fresh]', resultsEl);
  if (!el) return;
  const fr = freshness(positionAge(state.f));
  if (String(fr.live) !== el.dataset.fresh) { paint(renderFlight()); return; } // no longer live: redraw the status
  el.querySelector('.fl-status__age').textContent = fr.text;
  el.classList.toggle('is-stale', fr.stale);
}

const PLANE = '<path transform="rotate(90)" d="M0 -1.1 0.22 -0.25 1.05 0.3 1.05 0.5 0.22 0.25 0.16 0.8 0.42 1 0.42 1.12 0 1 -0.42 1.12 -0.42 1 -0.16 0.8 -0.22 0.25 -1.05 0.5 -1.05 0.3 -0.22 -0.25z"/>';

function renderFlight() {
  const { q, f, from, to, fc } = state;
  const u = units(prefs), live = f.live, now = Date.now();
  const airborne = live && !live.onGround && (live.altFt ?? 0) > 0;
  const names = flightNames(q, f);
  const fr = freshness(positionAge(f, now));

  let status;
  if (airborne) {
    status = `<p class="fl-status${fr.live ? ' fl-status--live' : ''}${fr.stale ? ' is-stale' : ''}" data-fresh="${fr.live}">
      ${fr.live ? '<i aria-hidden="true"></i><span class="fl-status__word">Live</span>' : '<span class="fl-status__word">Not live</span>'}
      <span class="fl-status__age">${esc(fr.text)}</span></p>`;
  } else status = `<p class="fl-status"><span class="fl-status__word">${live ? 'On the ground' : 'Not in the air now'}</span></p>`;

  // Progress: one line with the plane on it, codes either side, distance and landing estimate under it.
  let eta = null, progress = '';
  if (from && to) {
    const total = distanceKm(from, to);
    let pct = null, facts = `<span><b class="num">${far(total)}</b> route</span>`, said = `${far(total)} route from ${from.code} to ${to.code}.`;
    if (live) {
      const left = distanceKm(live, to);
      pct = Math.max(0, Math.min(1, 1 - left / total));
      if (airborne && live.gsKt > 100) {
        // While climbing the current speed understates the cruise, so far from landing assume at least a typical cruise.
        const kmh = Math.max(live.gsKt * 1.852, left > 300 ? 780 : 0);
        const min = left / kmh * 60 + 12;
        eta = now + min * 60e3;
        const day = fmtDay(eta, to.tz) !== fmtDay(now, to.tz) ? `, ${fmtDay(eta, to.tz)}` : '';
        facts = `<span><b class="num">${far(left)}</b> to go</span>
          <span>about <b class="num">${fmtDuration(Math.max(5, Math.round(min / 5) * 5))}</b></span>
          <span>lands around <b class="num">${fmtTime(eta, to.tz)}</b> ${esc(fmtZone(eta, to.tz))}${esc(day)} <em class="fl-tag">estimate</em></span>`;
        said = `${Math.round(pct * 100)} percent of the way from ${from.code} to ${to.code}. ${far(left)} to go, about ${fmtDuration(Math.max(5, Math.round(min / 5) * 5))}; estimated landing around ${timeZ(eta, to.tz)}${day}.`;
      } else if (live.onGround) {
        const at = distanceKm(live, from) < distanceKm(live, to) ? from : to;
        pct = at === from ? 0 : 1;
        facts = `<span>On the ground at or near <b class="code">${at.code}</b></span>`;
        said = `On the ground at or near ${at.code}.`;
      }
    }
    const p = pct == null ? '' : ` style="--pct:${(pct * 100).toFixed(1)}%"`;
    progress = `<div class="fl-progress">
      <div class="fl-progress__line" aria-hidden="true">
        <span class="fl-progress__end"><b class="code">${from.code}</b><small>${esc(from.city || from.name)}</small></span>
        <span class="fl-progress__track${pct == null ? ' is-idle' : ''}"${p}><i></i>${pct == null ? '' : `<svg class="fl-progress__plane" viewBox="-1.2 -1.2 2.4 2.4">${PLANE}</svg>`}</span>
        <span class="fl-progress__end fl-progress__end--to"><b class="code">${to.code}</b><small>${esc(to.city || to.name)}</small></span>
      </div>
      <p class="fl-progress__facts" aria-hidden="true">${facts}</p>
      <p class="sr-only">${esc(said)}</p>
    </div>`;
  }

  const vr = live && live.vRateFpm;
  const trend = vr == null ? '' : vr > 400 ? 'climbing' : vr < -400 ? 'descending' : 'level';
  const stats = live ? `<dl class="fl-stats">
      <div><dt>Altitude</dt><dd><b class="num">${live.onGround ? 'Ground' : live.altFt == null ? '–' : `${Math.round(live.altFt).toLocaleString('en-US')} ft`}</b> <small>${airborne ? trend : ''}</small></dd></div>
      <div><dt>Ground speed</dt><dd><b class="num">${live.gsKt == null ? '–' : u.speed(live.gsKt * 1.852)}</b></dd></div>
      <div><dt>Aircraft</dt><dd><b class="num">${esc(live.type || '–')}</b> <small>${esc(live.registration)}</small></dd></div>
    </dl>` : `<p class="fl-quiet">${f.liveError ? 'Live tracking is not responding right now.' : `No aircraft is broadcasting ${esc(names.primary)} right now. It may not have left yet, may have landed, or may be out of receiver range.`}</p>`;

  const hoursOf = (a) => (fc ? fc.forecasts.get(a.code) || [] : []);
  const ends = [];
  if (from) ends.push(weatherAt(from, hoursOf(from), now, 'Departure', 'now'));
  if (to) ends.push(weatherAt(to, hoursOf(to), eta || now, 'Arrival', eta ? 'landing' : 'now'));
  const cardTitle = (w) => (w.role === 'Departure' ? 'Departure · weather now' : w.when === 'landing' ? 'Arrival · weather at landing' : 'Arrival · weather now');

  // The map earns its place by showing where the aircraft really is; without a position it is just the route, so it stays small.
  const map = from && to ? `<figure class="fl-map${airborne ? '' : ' fl-map--route'}">${routeMap(ends.map((w) => ({ airport: w.a, level: w.level })), airborne ? live : null)}</figure>` : '';

  return `
    <article class="fl-card" aria-labelledby="fl-title">
      <header class="fl-card__head">
        <div>
          ${f.airline ? `<p class="fl-card__airline">${esc(f.airline.name)}</p>` : ''}
          <h2 id="fl-title" class="fl-card__number" tabindex="-1"><span class="sr-only">Flight </span>${esc(names.primary)}</h2>
          ${names.alias ? `<p class="fl-card__alias">${esc(names.alias)}</p>` : ''}
        </div>
        ${status}
      </header>
      ${progress}
      ${stats}
      ${map}
      <p class="fl-card__note">Position from community aircraft receivers, refreshed every 30 seconds; the landing time is our estimate from distance and speed. Scheduled times, gates and cancellations need an airline feed, so they are not shown here. Check with your airline for those.</p>
    </article>
    ${ends.length ? weatherBlock(ends, u, { id: 'wx-title', link: true, cardTitle, many: ends.length > 1 }) : ''}
    ${to ? `<p class="fl-next">Connecting onward in ${esc(to.city || to.code)}? <a href="trip.html">Check a connection</a> against the forecast.</p>` : ''}`;
}

/* ---------- Airport ---------- */

async function showAirport(code) {
  const a = airport(code);
  if (!a) { resultsEl.hidden = false; resultsEl.innerHTML = message('We do not recognise that airport', 'Pick an airport from the search above.'); return; }
  busy(`Checking ${a.code}…`);
  // Without a forecast the observation, alerts and nearby aircraft are still worth showing.
  let fc = null, fcError = null;
  try { fc = await loadForecasts([a]); } catch (err) { fcError = err.message; }
  state = { kind: 'airport', a, fc, fcError, live: null, alerts: null, nearby: undefined, plans: null };
  resultsEl.innerHTML = renderAirport();
  settle();
  const [live, alerts, nearby, plans] = await Promise.all([loadLive([a]), loadAlerts(a), loadNearby(a), a.country === 'US' ? loadFaaPlans([a.code]) : null]);
  if (!state || state.a !== a) return;
  state.live = live; state.alerts = new Map([[a.code, alerts]]); state.nearby = nearby; state.plans = plans;
  resultsEl.setAttribute('aria-live', 'off');
  paint(renderAirport());
}

// Aircraft near the airport as a departure board: codes in signage, numbers lined up, scrolls sideways on phones.
function nearbyBoard(a, nearby, u) {
  if (nearby === undefined) return '<p class="muted">Looking for aircraft nearby…</p>';
  if (nearby === null) return '<p class="muted">Live aircraft are not available right now.</p>';
  if (!nearby.length) return `<p class="muted">No airline flights within 75 km of ${a.code} right now.</p>`;
  const rows = nearby.map((n) => {
    const cs = esc(n.callsign);
    const flight = FLIGHT_RE.test(n.callsign) ? `<a href="?flight=${cs}" data-flight="${cs}" aria-label="Track ${cs}">${cs}</a>` : `<span>${cs}</span>`;
    const alt = n.onGround ? 'Ground' : n.altFt == null ? '–' : (Math.round(n.altFt / 100) * 100).toLocaleString('en-US');
    return `<tr><th scope="row">${flight}</th><td>${esc(n.type || '–')}</td><td>${alt}</td><td>${n.gsKt == null ? '–' : u.speedVal(n.gsKt * 1.852)}</td><td>${n.nm == null ? '–' : farVal(n.nm * 1.852)}</td></tr>`;
  }).join('');
  return `<div class="fl-board" tabindex="0" role="region" aria-labelledby="near-title">
    <table><caption class="sr-only">Airline aircraft within 75 km of ${a.code}: callsign, aircraft type, altitude, ground speed and distance</caption>
      <thead><tr><th scope="col">Flight</th><th scope="col">Type</th><th scope="col">Altitude <small>ft</small></th><th scope="col">Speed <small>${u.speedUnit}</small></th><th scope="col">Away <small>${prefs.wind === 'mph' ? 'mi' : 'km'}</small></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted">Select a flight number to track it. Callsigns that are not flight numbers cannot be looked up.</p>`;
}

function renderAirport() {
  const { a, fc, fcError, nearby } = state;
  const u = units(prefs), now = Date.now(), hours = fc ? fc.forecasts.get(a.code) || [] : [];
  // The next three hours: assess from now, show the worst hour when it matters.
  const w = weatherAt(a, hours, now + HOUR, 'Airport', 'next3h');
  const stop = { airport: a, from: now, to: now + 3 * HOUR, arr: null, dep: null };
  const strip = hourlyStrip(stop, hours, u, { range: [now, now + 11 * HOUR], legend: 'Shaded = next 3 hours' });
  const missing = fcError === 'rate' ? 'The forecast service is busy. Try again in a little while.' : 'No forecast available right now.';
  return `
    <div class="ap">
      <div class="ap__main">
        ${weatherBlock([w], u, { id: 'ap-title', link: false, cardTitle: () => 'Airport weather · next 3 hours', many: false })}
        <section class="panel" aria-labelledby="hours-title"><h2 id="hours-title">Next 12 hours at ${a.code}</h2>
          ${strip || `<p class="muted">${missing}</p>`}
        </section>
        <p class="fl-next">Flying through ${a.code}? <a href="trip.html">Check a connection</a> against the forecast for your times.</p>
      </div>
      <section class="panel ap__near" aria-labelledby="near-title"><h2 id="near-title">In the air near ${a.code}</h2>${nearbyBoard(a, nearby, u)}</section>
    </div>`;
}

resultsEl.addEventListener('click', (e) => {
  const f = e.target.closest('[data-flight]');
  if (f) { e.preventDefault(); return go({ flight: f.dataset.flight }); }
  const a = e.target.closest('[data-airport]');
  if (a) { e.preventDefault(); go({ airport: a.dataset.airport }); }
});

/* ---------- Start ---------- */

function rerender() { if (!state) return; paint(state.kind === 'flight' ? renderFlight() : renderAirport()); }

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
    else { resultsEl.hidden = true; state = null; clearInterval(refresh); clearInterval(ticker); }
  };
  window.addEventListener('popstate', apply);
  apply();
}
start();
