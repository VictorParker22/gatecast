// Presentation helpers: icons, units, the route map and the hourly strip. Returns HTML strings.
import { LAND_PATH } from './world.js';
import { greatCircle, describeCode, scoreHour, levelOf, fmtTime, HOUR, LEVEL_LABEL } from './core.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Icons ---------- */

const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.6 4.2 4.2 0 0 0 7 18z"/>';
const SMALL_CLOUD = '<path d="M7 15h10a3.5 3.5 0 0 0 .5-6.97A5 5 0 0 0 8 7.3 3.9 3.9 0 0 0 7 15z"/>';
const WEATHER = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  night: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  partly: '<circle cx="8" cy="8" r="3"/><path d="M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7"/><path d="M9 19h8a3.5 3.5 0 0 0 .4-6.98A4.8 4.8 0 0 0 8.6 13 3.2 3.2 0 0 0 9 19z"/>',
  cloud: CLOUD,
  fog: SMALL_CLOUD + '<path d="M5 18h14M7 21h10"/>',
  drizzle: SMALL_CLOUD + '<path d="M9 18v1M12 19v1M15 18v1"/>',
  rain: SMALL_CLOUD + '<path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/>',
  snow: SMALL_CLOUD + '<path d="M8.5 19h.01M12 18h.01M15.5 19h.01M10.2 21.5h.01M13.8 21.5h.01" stroke-width="2.4"/>',
  sleet: SMALL_CLOUD + '<path d="M9 17.5l-1 3M16 17.5l-1 3"/><path d="M12.5 19.5h.01" stroke-width="2.4"/>',
  storm: SMALL_CLOUD + '<path d="M12.5 16l-2 3.2h3l-2 3.3"/>',
};
export function weatherIcon(code, isDay = 1, cls = '') {
  let name = describeCode(code).icon;
  if (name === 'clear' && !isDay) name = 'night';
  return `<svg class="wx ${cls}" viewBox="0 0 24 24" aria-hidden="true">${WEATHER[name]}</svg>`;
}

// Risk marks differ by shape as well as colour: circle-tick, triangle, octagon.
const RISK = {
  low: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.5"/>',
  elevated: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.3h.01"/>',
  high: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M12 7.5v5.5M12 16.3h.01"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.8h.01"/>',
};
export const riskIcon = (level) => `<svg class="risk-icon" viewBox="0 0 24 24" aria-hidden="true">${RISK[level] || RISK.unknown}</svg>`;
export const chip = (level, text) =>
  `<span class="chip chip--${level}">${riskIcon(level)}<span>${esc(text ?? LEVEL_LABEL[level] ?? 'No forecast')}</span></span>`;

/* ---------- Units ---------- */

export function units(prefs) {
  const temp = (c) => (c == null ? '–' : `${Math.round(prefs.temp === 'f' ? c * 9 / 5 + 32 : c)}°`);
  const speedVal = (k) => Math.round(prefs.wind === 'mph' ? k / 1.609 : prefs.wind === 'kt' ? k / 1.852 : k);
  const speedUnit = { kmh: 'km/h', mph: 'mph', kt: 'kt' }[prefs.wind];
  const speed = (k) => (k == null ? '–' : `${speedVal(k)} ${speedUnit}`);
  const vis = (m) => {
    if (m == null) return '–';
    if (prefs.wind === 'mph') { const mi = m / 1609; return mi >= 6 ? '6+ mi' : `${mi < 1 ? mi.toFixed(1) : Math.round(mi)} mi`; }
    const km = m / 1000; return km >= 10 ? '10+ km' : `${km < 1 ? km.toFixed(1) : Math.round(km)} km`;
  };
  return { temp, speed, speedVal, speedUnit, vis, tempUnit: prefs.temp === 'f' ? '°F' : '°C' };
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 45) % 8]);

/* ---------- Route map ---------- */

export function routeMap(stops) {
  // Work in a 0..720 wide space so routes across the antimeridian stay continuous.
  const arcs = [];
  const pts = [];
  let shift = 0;
  stops.forEach((s, i) => {
    if (i === 0) { pts.push({ s, x: s.airport.lon + 180, y: 90 - s.airport.lat }); return; }
    const prev = stops[i - 1].airport;
    const gc = greatCircle(prev, s.airport).map(([lon, lat]) => [lon + 180 + shift, 90 - lat]);
    shift = gc[gc.length - 1][0] - (s.airport.lon + 180);
    arcs.push(gc);
    pts.push({ s, x: gc[gc.length - 1][0], y: 90 - s.airport.lat });
  });
  let minX = Math.min(...pts.map((p) => p.x), ...arcs.flat().map((p) => p[0]));
  let maxX = Math.max(...pts.map((p) => p.x), ...arcs.flat().map((p) => p[0]));
  let minY = Math.min(...pts.map((p) => p.y), ...arcs.flat().map((p) => p[1]));
  let maxY = Math.max(...pts.map((p) => p.y), ...arcs.flat().map((p) => p[1]));
  const pad = Math.max(6, (maxX - minX) * 0.14);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  // Fit a 16:10 frame around the route.
  let w = maxX - minX, h = maxY - minY;
  if (w / h < 1.6) { const nw = h * 1.6; minX -= (nw - w) / 2; w = nw; } else { const nh = w / 1.6; minY -= (nh - h) / 2; h = nh; }
  const u = w / 100; // 1% of map width, so marks stay the same visual size at any zoom
  const off = Math.floor(minX / 360) * 360;
  const land = [0, 360, 720].map((dx) => `<path d="${LAND_PATH}" transform="translate(${off + dx} 0)"/>`).join('');
  const lines = arcs.map((gc) => `<path class="map__arc" d="M${gc.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L')}" stroke-width="${0.45 * u}" stroke-dasharray="${1.2 * u} ${1.2 * u}"/>`).join('');
  const marks = pts.map(({ s, x, y }, i) => {
    const r = 1.9 * u;
    const shape = s.level === 'high'
      ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${x} ${y})"/>`
      : s.level === 'elevated'
        ? `<path d="M${x} ${y - r * 1.25}L${x + r * 1.2} ${y + r}H${x - r * 1.2}z"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}"/>`;
    const above = i % 2 === 0;
    return `<g class="map__stop map__stop--${s.level}" stroke-width="${0.5 * u}">${shape}
      <text x="${x}" y="${above ? y - r * 2 : y + r * 3.4}" font-size="${3.6 * u}" text-anchor="middle" stroke-width="${0.9 * u}">${esc(s.airport.code)}</text></g>`;
  }).join('');
  const label = 'Route map: ' + stops.map((s) => `${s.airport.code} (${LEVEL_LABEL[s.level] || 'no forecast'} risk)`).join(' to ');
  return `<svg class="map" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid slice">
    <rect class="map__sea" x="${minX - 10}" y="${minY - 10}" width="${w + 20}" height="${h + 20}"/>
    <g class="map__land">${land}</g>${lines}${marks}</svg>`;
}

/* ---------- Hourly strip ---------- */

// Hours from 3h before to 3h after the time the traveller is at the airport.
export function hourlyStrip(stop, hours, u) {
  const from = stop.from - 2 * HOUR, to = stop.to + 2 * HOUR;
  const tz = stop.airport.tz;
  const slice = hours.filter((h) => h.t + HOUR > from && h.t <= to);
  if (!slice.length) return '';
  const cols = slice.map((h) => {
    const { score, factors } = scoreHour(h);
    const level = levelOf(score);
    const here = h.t + HOUR > stop.from && h.t <= stop.to;
    const marks = [];
    if (stop.arr != null && h.t <= stop.arr && stop.arr < h.t + HOUR) marks.push('Land');
    if (stop.dep != null && h.t <= stop.dep && stop.dep < h.t + HOUR) marks.push('Take off');
    const d = describeCode(h.code);
    const sr = `${fmtTime(h.t, tz)}: ${d.text}, ${u.temp(h.temp)}, ${h.pop ?? 0}% chance of precipitation, gusts ${u.speed(h.gust)}, ${LEVEL_LABEL[level]} risk${factors.length ? ' (' + factors.map((f) => f.label).join(', ') + ')' : ''}`;
    return `<li class="hour hour--${level}${here ? ' is-here' : ''}" title="${esc(sr)}">
      <span class="hour__mark">${marks.join(' · ') || '&nbsp;'}</span>
      <span class="hour__time">${fmtTime(h.t, tz)}</span>
      ${weatherIcon(h.code, h.day)}
      <span class="hour__temp">${u.temp(h.temp)}</span>
      <span class="hour__pop"><i style="--v:${h.pop ?? 0}"></i><b>${h.pop ?? 0}%</b></span>
      <span class="hour__gust">${u.speedVal(h.gust ?? 0)}</span>
      <span class="hour__risk" aria-hidden="true"></span>
      <span class="sr-only">${esc(sr)}</span>
    </li>`;
  }).join('');
  return `<div class="hours" tabindex="0" role="group" aria-label="Hour by hour at ${esc(stop.airport.code)}, local time">
    <ol class="hours__list">${cols}</ol>
    <p class="hours__legend"><span>Rows: time · sky · temperature · chance of rain or snow in that hour · gusts (${u.speedUnit}) · risk bar</span><span class="hours__key">Shaded = while you are there</span></p>
  </div>`;
}
