// The journey strip model: every airport's hours on the ground, in order, with the flights between them.
// Pure (no DOM, no network) so it can be tested with plain Node. Risk per hour comes from core.js
// (scoreHour, levelOf), the same scoring assessTrip uses, so the strip and the verdict always agree.
import { scoreHour, levelOf, fmtTime, fmtZone, getClock, describeCode, distanceKm, fmtDuration, HOUR, LEVEL_LABEL } from './core.js';

// Hours of context shown either side of the hours that count towards a stop's risk.
export const CONTEXT_HOURS = 1;

const inHour = (h, ms) => ms != null && h.t <= ms && ms < h.t + HOUR;

// result: assessTrip(); plan: planTrip(); forecasts: Map(code -> hours[]).
// Returns { stops: [{ stop, hours: [cell] }], legs: [leg] } where a cell is
// { t, hour, score, level, factors, here, marks: ['land' | 'takeoff'] }.
// `here` uses the same window as assessWindow, so the worst `here` cell matches the stop's weather level.
export function journeyModel(result, plan, forecasts, context = CONTEXT_HOURS) {
  const stops = result.stops.map((s) => {
    const all = forecasts.get(s.airport.code) || [];
    const from = s.from - context * HOUR, to = s.to + context * HOUR;
    const hours = all.filter((h) => h.t + HOUR > from && h.t <= to).map((h) => {
      const { score, factors } = scoreHour(h);
      const marks = [];
      if (inHour(h, s.arr)) marks.push('land');
      if (inHour(h, s.dep)) marks.push('takeoff');
      return { t: h.t, hour: h, score, level: levelOf(score), factors, here: h.t + HOUR > s.from && h.t <= s.to, marks };
    });
    return { stop: s, hours };
  });
  const legs = plan.legs.map((l) => ({
    from: l.from, to: l.to, dep: l.dep, arr: l.arr, dur: l.dur, estimated: l.estimated, km: distanceKm(l.from, l.to),
  }));
  return { stops, legs };
}

// Compact hour label for under a bar: "07" (24-hour) or "7am" (12-hour); half-hour zones keep their minutes.
export function hourLabel(t, tz) {
  const full = fmtTime(t, tz);
  if (getClock() === '24') return full.endsWith(':00') ? full.slice(0, 2) : full;
  return full.replace(' ', '');
}

const MARK_TEXT = { land: 'Land', takeoff: 'Take off' };
export const markText = (marks) => marks.map((m) => MARK_TEXT[m]);

// Which of the card's facts drive the risk at that hour: colour them, leave the rest grey.
export function drivers(factors = []) {
  const keys = new Set(factors.map((f) => f.key));
  return {
    gust: keys.has('wind'),
    precip: keys.has('rain') || keys.has('snow') || keys.has('ice'),
    vis: keys.has('vis'),
    sky: keys.has('storm') || keys.has('ice') || keys.has('snow'),
  };
}

// One full sentence per hour bar, for screen readers and as the hover title.
// u: units() from ui.js.
export function hourSentence(cell, stop, u) {
  const tz = stop.airport.tz, h = cell.hour;
  const when = `${fmtTime(cell.t, tz)} ${fmtZone(cell.t, tz)}`;
  const parts = [`${when}: ${describeCode(h.code).text}, ${u.temp(h.temp)}, gusts ${u.speed(h.gust)}, ${h.pop ?? 0}% chance of rain or snow.`];
  parts.push(`${LEVEL_LABEL[cell.level]} risk${cell.factors.length ? ` (${cell.factors.map((f) => f.label.toLowerCase()).join(', ')})` : ''}.`);
  const m = cell.marks.map((k) => (k === 'land' ? 'you land' : 'you take off'));
  if (m.length) parts.push(`This is the hour ${m.join(' and ')}.`);
  if (!cell.here) parts.push('Outside the hours that count for this airport.');
  return parts.join(' ');
}

// "Flight LHR to FRA, about 1h 20m (estimated from distance), 650 km."
export function legSentence(leg, distance) {
  return `Flight ${leg.from.code} to ${leg.to.code}, ${leg.estimated ? 'about ' : ''}${fmtDuration(leg.dur)}${leg.estimated ? ' (estimated from distance)' : ''}, ${distance}.`;
}
