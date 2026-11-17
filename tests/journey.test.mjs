import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, assessTrip, setClock, levelOf, HOUR } from '../js/core.js';
import { journeyModel, hourLabel, drivers, hourSentence, legSentence, markText } from '../js/journey.js';
import { verdictHTML, stripHTML, stopCardHTML, adviceHTML, tips } from '../js/tripview.js';
import { units } from '../js/ui.js';

const LHR = { code: 'LHR', name: 'London Heathrow Airport', city: 'London', lat: 51.47, lon: -0.454, tz: 'Europe/London' };
const FRA = { code: 'FRA', name: 'Frankfurt am Main Airport', city: 'Frankfurt', lat: 50.033, lon: 8.57, tz: 'Europe/Berlin' };
const SIN = { code: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', lat: 1.36, lon: 103.99, tz: 'Asia/Singapore' };
const calm = { code: 1, gust: 15, wind: 10, vis: 24000, precip: 0, snow: 0, pop: 0, temp: 5, day: 1, dir: 200 };
const series = (start, n, f = () => calm) => Array.from({ length: n }, (_, i) => ({ t: start + i * HOUR, ...f(start + i * HOUR) }));
const u = units({ temp: 'c', wind: 'kmh' });
const prefs = { temp: 'c', wind: 'kmh' };

function trip(stormy) {
  const plan = planTrip([LHR, FRA, SIN], '2026-11-17T09:15', [60]);
  const start = Date.UTC(2026, 10, 17, 0);
  const fraBad = (t) => (stormy && t >= plan.stops[1].arr - HOUR && t <= plan.stops[1].dep) ? { ...calm, gust: 75, code: 65, precip: 6, pop: 95 } : calm;
  const forecasts = new Map([['LHR', series(start, 72)], ['FRA', series(start, 72, fraBad)], ['SIN', series(start, 72)]]);
  const now = plan.start - 24 * HOUR;
  return { plan, forecasts, result: assessTrip(plan, forecasts, now) };
}

test('journey model: each stop shows its window plus an hour of context, with land and take-off marked', () => {
  const { plan, forecasts, result } = trip(true);
  const m = journeyModel(result, plan, forecasts);
  assert.equal(m.stops.length, 3);
  assert.equal(m.legs.length, 2);
  for (const { stop, hours } of m.stops) {
    const here = hours.filter((c) => c.here);
    assert.ok(hours.length > here.length, `${stop.airport.code} has context hours`);
    assert.ok(!hours[0].here && !hours.at(-1).here, 'context sits at both ends');
    // The strip reuses core scoring: the worst hour that counts matches the stop's weather level.
    const worst = Math.max(...here.map((c) => c.score));
    assert.equal(levelOf(worst), stop.weather.level);
    if (stop.arr != null) assert.equal(hours.filter((c) => c.marks.includes('land')).length, 1);
    if (stop.dep != null) assert.equal(hours.filter((c) => c.marks.includes('takeoff')).length, 1);
  }
  assert.equal(m.stops[1].stop.level, 'high');
  assert.ok(m.stops[1].hours.some((c) => c.level === 'high'));
  assert.ok(m.legs[1].km > 10000 && m.legs[1].estimated);
});

test('hour labels follow the clock preference', () => {
  const t = Date.UTC(2026, 10, 17, 7);
  setClock('24');
  assert.equal(hourLabel(t, 'Europe/London'), '07');
  assert.equal(hourLabel(t, 'Asia/Kolkata'), '12:30');
  setClock('12');
  assert.equal(hourLabel(t, 'Europe/London'), '7am');
  setClock('24');
  assert.deepEqual(markText(['land', 'takeoff']), ['Land', 'Take off']);
});

test('only the facts that drive the risk are flagged', () => {
  assert.deepEqual(drivers([{ key: 'wind' }]), { gust: true, precip: false, vis: false, sky: false });
  assert.deepEqual(drivers([{ key: 'vis' }, { key: 'rain' }]), { gust: false, precip: true, vis: true, sky: false });
  assert.deepEqual(drivers([{ key: 'storm' }]), { gust: false, precip: false, vis: false, sky: true });
  assert.deepEqual(drivers(), { gust: false, precip: false, vis: false, sky: false });
});

test('every hour bar and flight has a full sentence', () => {
  const { plan, forecasts, result } = trip(true);
  const m = journeyModel(result, plan, forecasts);
  const fra = m.stops[1];
  const land = fra.hours.find((c) => c.marks.includes('land'));
  const s = hourSentence(land, fra.stop, u);
  assert.match(s, /^\d\d:\d\d GMT\+1: /);
  assert.match(s, /This is the hour you land/);
  assert.match(hourSentence(fra.hours[0], fra.stop, u), /Outside the hours that count/);
  assert.equal(legSentence(m.legs[0], '650 km'), 'Flight LHR to FRA, about 1h 20m (estimated from distance), 650 km.');
});

test('risk expands into the ink verdict; calm collapses to one quiet line', () => {
  const risky = trip(true), quiet = trip(false);
  const t = { r: ['LHR', 'FRA', 'SIN'] };
  const hi = verdictHTML(risky.result, t, 'Tue 17 Nov', Date.now());
  assert.match(hi, /tverdict--ink/);
  assert.match(hi, /tverdict--high/);
  assert.match(hi, /id="verdict-title"/);
  assert.match(hi, /1 connection/);
  const lo = verdictHTML(quiet.result, t, 'Tue 17 Nov', Date.now());
  assert.match(lo, /tverdict--calm/);
  assert.doesNotMatch(lo, /tverdict--ink/);
  assert.match(lo, /Low risk\./);
  assert.match(adviceHTML(risky.result), /<ol class="tdo__list[ "]/);
  assert.match(adviceHTML(quiet.result), /class="tdo-line[ "]/);
  assert.ok(tips(risky.result).length >= 2);
});

test('the strip is an ordered list of stops and flights with text for every bar', () => {
  const { plan, forecasts, result } = trip(true);
  const m = journeyModel(result, plan, forecasts);
  const html = stripHTML(m, u, prefs, 'Tue 17 Nov');
  assert.equal((html.match(/class="jstop /g) || []).length, 3);
  assert.equal((html.match(/class="jleg[ "]/g) || []).length, 2);
  const bars = (html.match(/class="jhour /g) || []).length;
  assert.equal(bars, m.stops.reduce((n, s) => n + s.hours.length, 0));
  assert.equal((html.match(/<span class="sr-only">\d/g) || []).length, bars);
  assert.match(html, /--cols: max-content minmax/);
  const card = stopCardHTML(result.stops[1], forecasts.get('FRA'), u, 'Tue 17 Nov', 1);
  assert.match(card, /data-stop="1"/);
  assert.match(card, /is-driver/);
  assert.match(card, /<details class="tcard__hours[ "]/);
  assert.match(card, /data-live="FRA"/);
});
