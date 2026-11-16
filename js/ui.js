// Presentation helpers every page needs: escaping, weather and risk icons, chips and units. Returns HTML strings.
// Kept apart from view.js so the weather page does not load the world map outline (js/world.js), which only
// the flight and connection maps use.
import { describeCode, LEVEL_LABEL } from './core.js';

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
