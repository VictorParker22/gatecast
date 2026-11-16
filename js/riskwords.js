// How likely and how bad: a short fixed-template phrase beside every Low / Elevated / High verdict, so a level
// never has to stand for both at once (the Met Office warning-matrix problem). Pure, no DOM and no network.
// It reads only what scoreHour already knows (which factor drives the risk and how many points it carries) plus
// the forecast's own chance of rain or snow. It does not change the scoring; it only names what is behind it.
//
//   odds({ level, factors, hours, speed })  -> { likely, bad, phrase, cause, text } or null
//   stopOdds(stop, speed, { named })        -> the same for one stop of assessTrip()
//   faaPlanLine(plan, time)                 -> "FAA plan: ground stop or delays expected after 17:00 (FAA NAS Status)"
import { scoreHour, levelOf } from './core.js';

/* ---------- Thresholds ---------- */

// How likely. For rain, snow, ice and storms: the forecast's chance of precipitation at the hours that carry the
// factor (Open-Meteo has no separate thunder probability, so storms use the same number).
export const LIKELY_POP = 70;
export const POSSIBLE_POP = 40;
// For gusts and fog the forecast gives no chance, so persistence stands in: shown for this many hours or more.
export const LIKELY_HOURS = 3;
// How bad, from the driving factor's points in scoreHour: storms, freezing rain, heavy snow, dense fog and very
// strong gusts are serious; steady snow, fog, strong gusts and very heavy rain are disruptive; the rest a nuisance.
export const SERIOUS_POINTS = 65;
export const DISRUPTIVE_POINTS = 40;

const PRECIP = new Set(['storm', 'ice', 'snow', 'rain']);

/* ---------- Templates (the only wording this module produces) ---------- */

export const TEMPLATES = {
  likely: { serious: 'likely and serious', disruptive: 'likely and disruptive', nuisance: 'likely, but mostly a nuisance' },
  possible: { serious: 'possible, and serious if it happens', disruptive: 'possible, and disruptive if it happens', nuisance: 'possible, and mostly a nuisance' },
  unlikely: { serious: 'unlikely, but serious if it happens', disruptive: 'unlikely, but disruptive if it happens', nuisance: 'unlikely, and mostly a nuisance' },
};
export const CALM = { none: 'nothing disruptive expected', minor: 'at most a nuisance' };
export const UPSTREAM = 'depends on your inbound flight';

export function likelihood(key, hoursWith) {
  if (PRECIP.has(key)) {
    const pops = hoursWith.map((h) => h.pop).filter((p) => p != null && Number.isFinite(p));
    if (pops.length) {
      const p = Math.max(...pops);
      return p >= LIKELY_POP ? 'likely' : p >= POSSIBLE_POP ? 'possible' : 'unlikely';
    }
  }
  return hoursWith.length >= LIKELY_HOURS ? 'likely' : 'possible';
}
export const severity = (points) => (points >= SERIOUS_POINTS ? 'serious' : points >= DISRUPTIVE_POINTS ? 'disruptive' : 'nuisance');

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// The parenthesis: what the factor is, with the one number people act on for wind.
function causeOf(top, hoursWith, speed) {
  if (top.key === 'wind') {
    const g = Math.max(0, ...hoursWith.map((h) => h.gust ?? h.wind ?? 0));
    return g && speed ? `gusts ${speed(g)}` : lower(top.label);
  }
  return lower(top.label);
}

// level: 'low' | 'elevated' | 'high' (anything else -> null). factors: assessWindow().factors (worst first).
// hours: the forecast hours the verdict covers. where: appended to the cause (" at take-off from FRA").
// speed: units().speed, so gusts print in the visitor's unit. upstream: the risk comes from another airport.
export function odds({ level, factors = [], hours = [], speed = null, where = '', upstream = false, extra = '' }) {
  if (level !== 'low' && level !== 'elevated' && level !== 'high') return null;
  const top = factors[0];
  if (upstream && level !== 'low') {
    const phrase = UPSTREAM, cause = `weather where it departs${extra}`;
    return { likely: null, bad: null, phrase, cause, text: `${phrase} (${cause})` };
  }
  if (!top) {
    if (level !== 'low') return null;
    return { likely: null, bad: null, phrase: CALM.none, cause: '', text: CALM.none };
  }
  const hoursWith = hours.filter((h) => scoreHour(h).factors.some((f) => f.key === top.key));
  const cause = `${causeOf(top, hoursWith, speed)}${where}${extra}`;
  if (level === 'low') return { likely: null, bad: 'nuisance', phrase: CALM.minor, cause, text: `${CALM.minor} (${cause})` };
  const likely = likelihood(top.key, hoursWith);
  const bad = severity(top.points);
  const phrase = TEMPLATES[likely][bad];
  return { likely, bad, phrase, cause, text: `${phrase} (${cause})` };
}

const RANK = { low: 0, elevated: 1, high: 2 };
const within = (h, ms) => ms != null && h && h.t <= ms && ms < h.t + 3600e3;

// Where the worst hour falls for one stop: at take-off, at landing, or during the layover.
// The take-off or landing hour counts as the moment when it is as bad as the worst hour of the stay.
export function stopWhere(s, named = false) {
  const w = s.weather?.worst;
  const code = s.airport?.code || '';
  const asBad = (h) => h && scoreHour(h).score >= (s.weather?.score ?? 0);
  if (s.role !== 'destination' && (within(w, s.dep) || asBad(s.atDep))) return named ? ` at take-off from ${code}` : ' at take-off';
  if (within(w, s.arr) || asBad(s.atArr)) return named ? ` at landing in ${code}` : ' at landing';
  if (s.role === 'connection') return named ? ` during your layover in ${code}` : ' during your layover';
  if (s.role === 'origin') return named ? ` around take-off from ${code}` : ' around take-off';
  return named ? ` around landing in ${code}` : ' around landing';
}

// One stop of assessTrip(). A connection whose own weather is calm takes its level from the inbound airport;
// a short layover that lifts the level is said in the cause.
export function stopOdds(s, speed, { named = false } = {}) {
  if (!s || !s.weather) return null;
  const w = s.weather;
  const own = w.level === 'unknown' ? 'unknown' : levelOf(w.score);
  const upstream = s.role === 'connection' && own === 'low' && (s.level === 'elevated' || s.level === 'high');
  const extra = s.role === 'connection' && s.buffer === 'tight' && RANK[s.level] > (RANK[own] ?? 0) ? ', with a short layover' : '';
  return odds({ level: s.level, factors: w.factors, hours: w.hours, speed, where: w.factors.length ? stopWhere(s, named) : '', upstream, extra });
}

/* ---------- FAA planned items (from data.js loadFaaPlans, when it exists) ---------- */

const PLAN_WORDS = {
  ground_stop: 'ground stop or delays expected',
  delay_program: 'delays expected',
  deicing: 'de-icing expected, which can slow departures',
};
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v));

// time(ms) prints a clock time in the airport's zone. Returns null for anything without a usable airport.
export function faaPlanLine(plan, time) {
  if (!plan || typeof plan !== 'object' || !plan.airport) return null;
  let what = PLAN_WORDS[plan.kind];
  if (!what) {
    const t = String(plan.summary || plan.text || '').replace(/\s+/g, ' ').trim();
    what = t ? (t.length > 120 ? `${t.slice(0, 117)}…` : t) : 'an operations plan is in place';
  }
  const start = toMs(plan.start), end = toMs(plan.end);
  const when = [Number.isFinite(start) ? ` after ${time(start)}` : '', Number.isFinite(end) ? ` until ${time(end)}` : ''].join('');
  return `FAA plan: ${what}${when} (${plan.source || 'FAA NAS Status'})`;
}
