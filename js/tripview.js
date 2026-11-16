// HTML for the trip page results: verdict, journey strip, stop cards, advice and route map.
// Returns strings only (no DOM), so it can be tested in Node. Styles live in styles/trip.css.
import { scoreHour, describeCode, factorPhrase, fmtTime, fmtDay, fmtZone, fmtDuration, LEVEL_LABEL } from './core.js';
import { esc, weatherIcon, riskIcon, chip, compass, routeMap, hourlyStrip } from './view.js';
import { hourLabel, markText, drivers, hourSentence, legSentence } from './journey.js';
import { stopOdds } from './riskwords.js';

const riskWord = (level) => (level === 'unknown' ? 'No forecast' : `${LEVEL_LABEL[level]} risk`);
const COPY_BTN = (cls) => `<button class="btn btn--ghost ${cls}" type="button" data-share>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>
  <span>Copy link</span></button>`;

export const distanceText = (km, prefs) => (prefs.wind === 'mph' ? `${Math.round(km / 1.609).toLocaleString('en-GB')} mi` : `${Math.round(km).toLocaleString('en-GB')} km`);
export const isRisky = (level) => level === 'elevated' || level === 'high';

/* ---------- Verdict ---------- */

// Risk expands: the dark ink panel. Calm collapses: one quiet line on the page's light surface.
// u (units, optional) prints gusts in the visitor's unit in the how-likely, how-bad phrase (js/riskwords.js).
export function verdictHTML(result, trip, startDay, loadedAt, u = null) {
  const hl = result.headline;
  const conns = trip.r.length - 2;
  const o = result.worst ? stopOdds(result.worst, u?.speed, { named: true }) : null;
  const minor = o && result.level === 'low' && o.cause ? ` Low · ${esc(o.text)}.` : '';
  const meta = `${esc(result.confidence.text)}${minor} Forecast loaded ${fmtTime(loadedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)} your time.`;
  if (!isRisky(result.level)) {
    const level = result.level === 'unknown' ? 'unknown' : 'low';
    return `<section class="tverdict tverdict--calm" aria-labelledby="verdict-title">
      ${riskIcon(level)}
      <div class="tverdict__text">
        <p class="tverdict__eyebrow">${trip.r.map(esc).join(' · ')} · ${esc(startDay)}</p>
        <h2 id="verdict-title" tabindex="-1"><span class="tverdict__word">${riskWord(level)}.</span> ${esc(hl.title)}</h2>
        <p class="tverdict__meta">${esc(hl.body)} ${meta}</p>
      </div>
      ${COPY_BTN('tverdict__share')}
    </section>`;
  }
  return `<section class="tverdict tverdict--ink ink tverdict--${result.level}" aria-labelledby="verdict-title">
    <div class="ink__in">
      <p class="tverdict__eyebrow"><span>${trip.r.map(esc).join(' · ')}</span><span>${esc(startDay)}</span>${conns > 0 ? `<span>${conns} connection${conns > 1 ? 's' : ''}</span>` : ''}</p>
      <div class="tverdict__main">
        ${riskIcon(result.level)}
        <div class="tverdict__text">
          <p class="tverdict__word">${riskWord(result.level)}</p>
          ${o ? `<p class="tverdict__odds">${esc(o.text.charAt(0).toUpperCase() + o.text.slice(1))}</p>` : ''}
          <h2 id="verdict-title" tabindex="-1">${esc(hl.title)}</h2>
          <p class="tverdict__reason">${esc(hl.body)}</p>
          <p class="tverdict__meta">${meta}</p>
        </div>
      </div>
      ${COPY_BTN('tverdict__share')}
    </div>
  </section>`;
}

/* ---------- Journey strip ---------- */

function stopWhen(s, startDay) {
  const tz = s.airport.tz;
  const t = (ms) => `${fmtTime(ms, tz)}`;
  const zone = esc(fmtZone(s.dep ?? s.arr, tz));
  const day = fmtDay(s.dep ?? s.arr, tz);
  const dayNote = day !== startDay ? ` · ${esc(day)}` : '';
  if (s.role === 'origin') return `Take off <b>${t(s.dep)}</b> ${zone}${dayNote}`;
  if (s.role === 'destination') return `Land <b>${t(s.arr)}</b> ${zone}${dayNote}`;
  return `<b>${t(s.arr)}–${t(s.dep)}</b> ${zone}${dayNote} · ${fmtDuration(s.layover)} layover`;
}

function stripStop({ stop: s, hours }, u, startDay) {
  const a = s.airport;
  const cells = hours.map((c) => {
    const sr = hourSentence(c, s, u);
    const marks = markText(c.marks);
    return `<li class="jhour jhour--${c.level}${c.here ? ' is-here' : ''}${marks.length ? ' is-key' : ''}" title="${esc(sr)}">
      <span class="jhour__mark" aria-hidden="true">${c.marks.map((m, k) => `<span class="m-${m}">${marks[k]}</span>`).join('')}</span>
      <span class="jhour__bar" aria-hidden="true"></span>
      <span class="jhour__time" aria-hidden="true">${esc(hourLabel(c.t, a.tz))}</span>
      <span class="sr-only">${esc(sr)}</span></li>`;
  }).join('');
  return `<li class="jstop jstop--${s.level}">
    <div class="jstop__cap">
      <p class="jstop__code"><span class="code">${esc(a.code)}</span> <span class="sr-only">${esc(a.city || a.name)}, ${riskWord(s.level)}.</span></p>
      <p class="jstop__when">${stopWhen(s, startDay)}</p>
    </div>
    ${cells ? `<ol class="jstop__hours" aria-label="${esc(a.code)} hour by hour, local time">${cells}</ol>`
      : '<p class="jstop__hours jstop__none">No forecast for these hours yet.</p>'}
  </li>`;
}

// Longer flights get a longer connector, within limits, so the strip still fits on a desktop screen.
const legGrow = (leg) => Math.min(3, Math.max(1, leg.dur / 150)).toFixed(2);

function stripLeg(leg, prefs) {
  return `<li class="jleg">
    <span class="jleg__label" aria-hidden="true">${fmtDuration(leg.dur)}${leg.estimated ? ' <small>est.</small>' : ''}</span>
    <span class="jleg__line" aria-hidden="true"></span>
    <span class="sr-only">${esc(legSentence(leg, distanceText(leg.km, prefs)))}</span>
  </li>`;
}

export function stripHTML(model, u, prefs, startDay) {
  const items = [], cols = [];
  model.stops.forEach((st, i) => {
    items.push(stripStop(st, u, startDay)); cols.push('max-content');
    const leg = model.legs[i];
    if (leg) { items.push(stripLeg(leg, prefs)); cols.push(`minmax(5rem, ${legGrow(leg)}fr)`); }
  });
  const est = model.legs.some((l) => l.estimated);
  return `<section class="jstrip" aria-labelledby="jstrip-title">
    <div class="jstrip__head">
      <h2 id="jstrip-title">The journey, hour by hour</h2>
      <p>Local time at each airport. Taller bars mean higher risk.</p>
    </div>
    <div class="jstrip__scroll" tabindex="0" role="region" aria-label="Journey strip: every airport in order, scrolls sideways">
      <ol class="jstrip__list" style="--cols: ${cols.join(' ')}" aria-label="Airports and flights in travel order">${items.join('')}</ol>
    </div>
    <ul class="jstrip__legend" aria-label="Key">
      <li><i class="jkey jkey--low"></i>Low</li>
      <li><i class="jkey jkey--elevated"></i>Elevated</li>
      <li><i class="jkey jkey--high"></i>High</li>
      <li><i class="jkey jkey--ring"></i>Your land or take-off hour</li>
      <li><i class="jkey jkey--faded"></i>Just before or after your time there</li>
      ${est ? '<li>Flight times marked est. are estimated from distance</li>' : ''}
    </ul>
  </section>`;
}

/* ---------- Stop cards ---------- */

function stopReason(s) {
  const w = s.weather;
  let why;
  if (s.level === 'unknown') why = 'No forecast available for this time yet.';
  else if (w.factors.length) why = `Forecast shows ${factorPhrase(w.factors)} while you are here.`;
  else why = 'Nothing in the forecast that usually slows this airport down.';
  if (s.role === 'connection') {
    why += s.buffer === 'tight' ? ` A ${fmtDuration(s.layover)} layover leaves very little buffer.`
      : s.buffer === 'generous' ? ` Your ${fmtDuration(s.layover)} layover gives you room to absorb a delay.` : '';
    if (s.level !== 'low' && w.level === 'low') why += ' The risk here comes from weather where your inbound flight departs.';
  }
  return why;
}

// The hour a card summarises: take-off or landing when calm, the worst hour of the stay when not.
export function cardHour(s) {
  const w = s.weather;
  const useWorst = w.score >= 30 && w.worst;
  const h = useWorst ? w.worst : (s.atDep && s.role === 'origin' ? s.atDep : s.atArr || s.atDep);
  const label = !h ? '' : useWorst ? `Worst hour while you are here, ${fmtTime(h.t, s.airport.tz)}` : s.role === 'origin' ? 'At take-off' : 'At landing';
  return { h, label };
}

export function stopCardHTML(s, hours, u, startDay, index = 0) {
  const a = s.airport, tz = a.tz;
  const role = s.role === 'origin' ? 'Departure' : s.role === 'destination' ? 'Arrival' : `Connection · ${fmtDuration(s.layover)} layover`;
  const { h, label } = cardHour(s);
  const dr = h && isRisky(s.level) ? drivers(scoreHour(h).factors) : {};
  const fact = (key, dt, dd) => `<div${dr[key] ? ' class="is-driver"' : ''}><dt>${dt}</dt><dd>${dr[key] ? riskIcon(s.level) : ''}${dd}</dd></div>`;
  const times = [s.arr != null ? `Land <b class="num">${fmtTime(s.arr, tz)}</b>` : '', s.dep != null ? `Take off <b class="num">${fmtTime(s.dep, tz)}</b>` : '']
    .filter(Boolean).join(' · ');
  const day = fmtDay(s.dep ?? s.arr, tz);
  const d = h ? describeCode(h.code) : null;
  // How likely and how bad, beside the chip. A calm stop with nothing behind it stays quiet.
  const o = stopOdds(s, u.speed);
  const said = o && (s.level !== 'low' || o.cause) ? o.text.charAt(0).toUpperCase() + o.text.slice(1) : '';
  return `<li class="stop stop--${s.level} tcard" data-stop="${index}">
    <div class="tcard__top"><p class="stop__role">${esc(role)}</p>${chip(s.level, riskWord(s.level))}</div>
    ${said ? `<p class="tcard__odds"><span class="sr-only">${esc(riskWord(s.level))}: </span>${esc(said)}</p>` : ''}
    <div>
      <h3 class="tcard__title"><span class="code">${esc(a.code)}</span> ${esc(a.city || a.name)}</h3>
      <p class="tcard__sub">${esc(a.name)}</p>
      <p class="tcard__times">${times} ${esc(fmtZone(s.dep ?? s.arr, tz))}${day !== startDay ? ` <span class="when__day">${esc(day)}</span>` : ''}</p>
    </div>
    ${h ? `<div class="tcard__wx">
      ${weatherIcon(h.code, h.day, 'wx--lg')}
      <p class="tcard__temp num">${u.temp(h.temp)}<small>${u.tempUnit.slice(1)}</small></p>
      <p class="tcard__cond${dr.sky ? ' is-driver' : ''}">${esc(d.text)}<small>${esc(label)}</small></p>
    </div>
    <dl class="facts tcard__facts">
      ${fact('gust', 'Gusts', `${u.speed(h.gust)} <small>${compass(h.dir)}</small>`)}
      ${fact('precip', 'Rain or snow', `${h.pop ?? 0}% <small>chance</small>`)}
      ${fact('vis', 'Visibility', u.vis(h.vis))}
    </dl>` : ''}
    <p class="stop__why">${esc(stopReason(s))}</p>
    ${hours.length ? `<details class="tcard__hours"><summary>Hour by hour <small>${esc(a.code)} local time</small></summary>${hourlyStrip(s, hours, u)}</details>` : ''}
    <div class="stop__live" data-live="${esc(a.code)}"></div>
    ${a.country === 'US' ? `<div class="stop__plan" data-plan="${esc(a.code)}"></div>` : ''}
  </li>`;
}

/* ---------- What you can do ---------- */

export function tips(result) {
  const out = [];
  const conn = result.stops.filter((s) => s.role === 'connection');
  const risky = conn.find((s) => s.level !== 'low' && s.level !== 'unknown');
  if (risky) {
    out.push(`Ask your airline about a later onward flight from ${risky.airport.code}, or an earlier inbound one, while seats are still available.`);
    if (result.level === 'high') out.push('Airlines often publish a weather waiver before a big storm that lets you rebook for free. Check their travel alerts page.');
  }
  if (isRisky(result.level)) out.push('Turn on notifications in your airline app so you hear about changes before you reach the airport.');
  if (result.confidence.key !== 'good') out.push('Open this link again a day or two before you fly: the forecast will be sharper.');
  if (!out.length) out.push('No action needed for weather. Check in as normal and keep an eye on your airline app.');
  return out;
}

export function adviceHTML(result) {
  const list = tips(result);
  if (!isRisky(result.level)) {
    return `<section class="tdo-line" aria-labelledby="tdo-title"><h2 id="tdo-title">What you can do</h2><p>${list.map(esc).join(' ')}</p></section>`;
  }
  return `<section class="tdo ink" aria-labelledby="tdo-title"><div class="ink__in">
    <h2 id="tdo-title">What you can do</h2>
    <ol class="tdo__list">${list.map((t, i) => `<li><span class="tdo__n num" aria-hidden="true">${i + 1}</span><p>${esc(t)}</p></li>`).join('')}</ol>
  </div></section>`;
}

/* ---------- Route map (demoted: small, after the stops) ---------- */

export function mapHTML(result, model, prefs) {
  const total = model.legs.reduce((n, l) => n + l.km, 0);
  const rows = model.legs.map((l) => `<li><span class="code">${esc(l.from.code)} → ${esc(l.to.code)}</span> ${distanceText(l.km, prefs)}</li>`).join('');
  return `<figure class="tmap">
    ${routeMap(result.stops)}
    <figcaption><p class="tmap__title">Route</p><ul>${rows}</ul>${model.legs.length > 1 ? `<p class="tmap__total">${distanceText(total, prefs)} in all, great-circle distance.</p>` : '<p class="tmap__total">Great-circle distance.</p>'}</figcaption>
  </figure>`;
}
