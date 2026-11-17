// HTML for the trip page results: verdict, journey strip, stop cards, advice and route map.
// Returns strings only (no DOM), so it can be tested in Node. Styled with Tailwind utilities and the components in
// styles/components/weather.css (.ink, .stop, .tcard, .jstop, .jhour, .jkey); the bare marker classes (tverdict--ink,
// tdo__list, jleg ...) carry no style and are kept for the tests and for scripts.
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
    return `<section class="tverdict tverdict--calm grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-lg border border-line bg-np-card px-6 py-4 nav:grid-cols-[auto_minmax(0,1fr)_auto] nav:items-center [&>.risk-icon]:mt-6 [&>.risk-icon]:size-6 [&>.risk-icon]:self-start [&>.risk-icon]:stroke-2 [&>.risk-icon]:text-np-muted" aria-labelledby="verdict-title">
      ${riskIcon(level)}
      <div>
        <p class="mb-1 font-sign text-sm/tight font-semibold tracking-caps text-np-muted uppercase">${trip.r.map(esc).join(' · ')} · ${esc(startDay)}</p>
        <h2 id="verdict-title" class="text-xl/snug font-semibold outline-none" tabindex="-1"><span class="mr-[0.15em] font-sign font-bold tracking-caps text-np-muted uppercase">${riskWord(level)}.</span> ${esc(hl.title)}</h2>
        <p class="mt-1 max-w-measure text-sm text-np-muted">${esc(hl.body)} ${meta}</p>
      </div>
      ${COPY_BTN('col-start-2 justify-self-start nav:col-auto')}
    </section>`;
  }
  return `<section class="tverdict tverdict--ink ink tverdict--${result.level}" aria-labelledby="verdict-title">
    <div class="ink__in grid gap-4 p-6 sm:gap-6 sm:px-panel sm:py-8">
      <p class="flex flex-wrap gap-x-3 font-sign text-sm/tight font-semibold tracking-eyebrow text-np-muted uppercase sm:gap-x-6 sm:gap-y-1 sm:text-lg/tight"><span>${trip.r.map(esc).join(' · ')}</span><span>${esc(startDay)}</span>${conns > 0 ? `<span>${conns} connection${conns > 1 ? 's' : ''}</span>` : ''}</p>
      <div class="grid items-start gap-6 sm:grid-cols-[auto_minmax(0,1fr)] [&>.risk-icon]:size-16 [&>.risk-icon]:stroke-thin [&>.risk-icon]:text-(--risk) max-sm:[&>.risk-icon]:hidden">
        ${riskIcon(result.level)}
        <div>
          <p class="tverdict__word--shape flex items-center gap-2 font-sign text-lg font-bold tracking-eyebrow text-(--risk) uppercase">${riskWord(result.level)}</p>
          ${o ? `<p class="mt-1 max-w-3xl text-sign/snug font-semibold text-np-ink">${esc(o.text.charAt(0).toUpperCase() + o.text.slice(1))}</p>` : ''}
          <h2 id="verdict-title" class="mt-2 font-sign text-verdict-phone font-bold tracking-display text-np-on-night uppercase outline-none sm:text-verdict-hero" tabindex="-1">${esc(hl.title)}</h2>
          <p class="mt-3 max-w-3xl text-base text-np-ink sm:mt-4 sm:text-lg/7">${esc(hl.body)}</p>
          <p class="mt-3 max-w-measure text-sm text-np-muted">${meta}</p>
        </div>
      </div>
      ${COPY_BTN('justify-self-start')}
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
      <span class="jhour__time font-sign text-sm/none font-semibold whitespace-nowrap text-np-muted" aria-hidden="true">${esc(hourLabel(c.t, a.tz))}</span>
      <span class="sr-only">${esc(sr)}</span></li>`;
  }).join('');
  return `<li class="jstop jstop--${s.level}">
    <div class="row-start-2 w-0 min-w-full">
      <p><span class="code text-code">${esc(a.code)}</span> <span class="sr-only">${esc(a.city || a.name)}, ${riskWord(s.level)}.</span></p>
      <p class="text-sm/snug text-np-muted [&_b]:font-sign [&_b]:text-sign [&_b]:font-semibold [&_b]:text-np-ink">${stopWhen(s, startDay)}</p>
    </div>
    ${cells ? `<ol class="jstop__hours row-start-1 flex items-end gap-1 rounded-md px-2 pt-10 pb-2" aria-label="${esc(a.code)} hour by hour, local time">${cells}</ol>`
      : '<p class="jstop__hours row-start-1 flex w-36 items-center rounded-md p-2 text-sm text-np-muted">No forecast for these hours yet.</p>'}
  </li>`;
}

// Longer flights get a longer connector, within limits, so the strip still fits on a desktop screen.
const legGrow = (leg) => Math.min(3, Math.max(1, leg.dur / 150)).toFixed(2);

function stripLeg(leg, prefs) {
  return `<li class="jleg row-start-1 grid min-w-20 justify-items-center gap-1.5 self-center pt-6">
    <span class="font-sign text-sign font-semibold whitespace-nowrap [&>small]:font-body" aria-hidden="true">${fmtDuration(leg.dur)}${leg.estimated ? ' <small>est.</small>' : ''}</span>
    <span class="jleg__line relative w-full border-t-2 border-dashed border-np-muted" aria-hidden="true"></span>
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
  return `<section class="rounded-md border border-line bg-np-card pt-6 pb-4 sm:rounded-lg" aria-labelledby="jstrip-title">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 sm:px-6">
      <h2 id="jstrip-title" class="font-sign text-title font-bold tracking-wide uppercase">The journey, hour by hour</h2>
      <p class="text-sm text-np-muted">Local time at each airport. Taller bars mean higher risk.</p>
    </div>
    <div class="relative overflow-x-auto px-4 pt-4 pb-3 [scrollbar-width:thin] focus-visible:-outline-offset-3 sm:px-6" tabindex="0" role="region" aria-label="Journey strip: every airport in order, scrolls sideways">
      <ol class="grid w-max min-w-full grid-flow-col grid-cols-(--cols) grid-rows-[auto_auto] gap-3" style="--cols: ${cols.join(' ')}" aria-label="Airports and flights in travel order">${items.join('')}</ol>
    </div>
    <ul class="mx-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-xs text-np-muted sm:mx-6 [&>li]:inline-flex [&>li]:items-center [&>li]:gap-2" aria-label="Key">
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
    <div class="flex flex-wrap items-center justify-between gap-2"><p class="stop__role">${esc(role)}</p>${chip(s.level, riskWord(s.level)).replace('class="chip ', 'class="chip chip--sm ')}</div>
    ${said ? `<p class="-mt-2 text-sm/snug font-semibold"><span class="sr-only">${esc(riskWord(s.level))}: </span>${esc(said)}</p>` : ''}
    <div>
      <h3 class="stop__title mt-0 font-sign text-4xl/none font-bold tracking-display sm:text-code"><span class="code">${esc(a.code)}</span> ${esc(a.city || a.name)}</h3>
      <p class="mt-1 text-sm text-np-muted">${esc(a.name)}</p>
      <p class="mt-2 text-sm text-np-muted [&>b]:mr-[0.15em] [&>b]:text-sub/normal [&>b]:text-np-ink">${times} ${esc(fmtZone(s.dep ?? s.arr, tz))}${day !== startDay ? ` <span class="rounded-full bg-np-sunken px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-np-ink">${esc(day)}</span>` : ''}</p>
    </div>
    ${h ? `<div class="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3">
      ${weatherIcon(h.code, h.day, 'wx--lg')}
      <p class="num text-5xl/[0.9] sm:text-temp [&>small]:ml-0.5 [&>small]:align-top [&>small]:font-body [&>small]:text-base">${u.temp(h.temp)}<small>${u.tempUnit.slice(1)}</small></p>
      <p class="grid text-sign/snug ${dr.sky ? 'font-bold text-(--risk) [&>small]:text-inherit' : 'font-medium'}">${esc(d.text)}<small>${esc(label)}</small></p>
    </div>
    <dl class="facts">
      ${fact('gust', 'Gusts', `${u.speed(h.gust)} <small>${compass(h.dir)}</small>`)}
      ${fact('precip', 'Rain or snow', `${h.pop ?? 0}% <small>chance</small>`)}
      ${fact('vis', 'Visibility', u.vis(h.vis))}
    </dl>` : ''}
    <p class="stop__why">${esc(stopReason(s))}</p>
    ${hours.length ? `<details class="tcard__hours group/hours mt-auto border-t border-line pt-1"><summary class="flex min-h-tap cursor-pointer items-center gap-2 font-semibold group-open/hours:mb-2">Hour by hour <small>${esc(a.code)} local time</small></summary>${hourlyStrip(s, hours, u)}</details>` : ''}
    <div class="stop__live" data-live="${esc(a.code)}"></div>
    ${a.country === 'US' ? `<div class="empty:hidden" data-plan="${esc(a.code)}"></div>` : ''}
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
    return `<section class="tdo-line flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 text-sm text-np-muted" aria-labelledby="tdo-title"><h2 id="tdo-title" class="text-sm/tight text-np-ink after:content-[':']">What you can do</h2><p>${list.map(esc).join(' ')}</p></section>`;
  }
  return `<section class="ink" aria-labelledby="tdo-title"><div class="ink__in grid gap-4 px-6 py-8 lg:px-8">
    <h2 id="tdo-title" class="font-sign text-title font-bold tracking-wide text-np-on-night uppercase">What you can do</h2>
    <ol class="tdo__list grid grid-cols-[repeat(auto-fit,minmax(min(100%,--spacing(64)),1fr))] gap-3">${list.map((t, i) => `<li class="grid content-start gap-2 rounded-md bg-np-sunken px-6 py-4 text-np-on-night"><span class="num text-3xl/none text-np-muted" aria-hidden="true">${i + 1}</span><p>${esc(t)}</p></li>`).join('')}</ol>
  </div></section>`;
}

/* ---------- Route map (demoted: small, after the stops) ---------- */

export function mapHTML(result, model, prefs) {
  const total = model.legs.reduce((n, l) => n + l.km, 0);
  const rows = model.legs.map((l) => `<li><span class="code">${esc(l.from.code)} → ${esc(l.to.code)}</span> ${distanceText(l.km, prefs)}</li>`).join('');
  return `<figure class="grid min-w-0 items-center gap-x-6 gap-y-3 overflow-hidden nav:grid-cols-[minmax(0,--spacing(104))_minmax(0,1fr)] [&>.map]:max-w-104 [&>.map]:overflow-hidden [&>.map]:rounded-md [&>.map]:border [&>.map]:border-line">
    ${routeMap(result.stops)}
    <figcaption class="grid gap-1 text-sm text-np-muted [&_.code]:mr-1 [&_.code]:text-np-ink"><p class="font-semibold text-np-ink">Route</p><ul>${rows}</ul>${model.legs.length > 1 ? `<p>${distanceText(total, prefs)} in all, great-circle distance.</p>` : '<p>Great-circle distance.</p>'}</figcaption>
  </figure>`;
}
