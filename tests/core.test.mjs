import test from 'node:test';
import assert from 'node:assert/strict';
import { localToUtc, fmtTime, setClock, estimateFlightMin, scoreHour, levelOf, planTrip, assessTrip, greatCircle, HOUR } from '../js/core.js';

const JFK = { code: 'JFK', city: 'New York', lat: 40.64, lon: -73.779, tz: 'America/New_York' };
const ORD = { code: 'ORD', city: 'Chicago', lat: 41.979, lon: -87.905, tz: 'America/Chicago' };
const DEN = { code: 'DEN', city: 'Denver', lat: 39.862, lon: -104.673, tz: 'America/Denver' };
const SFO = { code: 'SFO', city: 'San Francisco', lat: 37.619, lon: -122.375, tz: 'America/Los_Angeles' };
const NRT = { code: 'NRT', city: 'Tokyo', lat: 35.765, lon: 140.386, tz: 'Asia/Tokyo' };
const calm = { code: 1, gust: 15, wind: 10, vis: 24000, precip: 0, snow: 0, pop: 0, temp: 5, day: 1 };
const hoursFrom = (start, n, f = () => calm) => Array.from({ length: n }, (_, i) => ({ t: start + i * HOUR, ...f(start + i * HOUR) }));

test('local wall-clock time converts to UTC, including DST', () => {
  assert.equal(new Date(localToUtc('2026-11-16T08:30', 'America/New_York')).toISOString(), '2026-11-16T13:30:00.000Z');
  assert.equal(new Date(localToUtc('2026-07-01T08:30', 'America/New_York')).toISOString(), '2026-07-01T12:30:00.000Z');
  assert.equal(new Date(localToUtc('2026-11-16T09:00', 'Asia/Tokyo')).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(fmtTime(Date.UTC(2026, 10, 16, 13, 30), 'America/Chicago'), '07:30');
});

test('flight time estimates are plausible', () => {
  const jfkOrd = estimateFlightMin(JFK, ORD), sfoNrt = estimateFlightMin(SFO, NRT);
  assert.ok(jfkOrd >= 110 && jfkOrd <= 150, `JFK-ORD ${jfkOrd}`);
  assert.ok(sfoNrt >= 600 && sfoNrt <= 680, `SFO-NRT ${sfoNrt}`);
});

test('great circle across the Pacific stays continuous', () => {
  const pts = greatCircle(SFO, NRT);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) < 20);
});

test('hour scoring', () => {
  assert.equal(scoreHour(calm).score, 0);
  assert.equal(levelOf(scoreHour({ ...calm, code: 95 }).score), 'high');
  assert.equal(levelOf(scoreHour({ ...calm, code: 73, snow: 0.8 }).score), 'elevated');
  assert.equal(levelOf(scoreHour({ ...calm, code: 73, snow: 0.8, gust: 60 }).score), 'high');
  assert.equal(levelOf(scoreHour({ ...calm, gust: 45 }).score), 'low');
  assert.equal(levelOf(scoreHour({ ...calm, vis: 300, code: 45 }).score), 'high');
  assert.equal(scoreHour({ ...calm, vis: null, gust: null, snow: null, precip: null }).score, 0);
});

test('trip plan times and connection verdicts', () => {
  const plan = planTrip([JFK, ORD, DEN], '2026-11-16T08:30', [45]);
  assert.equal(plan.stops[1].layover, 45);
  assert.equal(plan.legs[1].dep - plan.legs[0].arr, 45 * 60e3);
  const start = plan.start - 6 * HOUR;
  const now = plan.start - 24 * HOUR;
  const clear = new Map([JFK, ORD, DEN].map((a) => [a.code, hoursFrom(start, 24)]));
  const r1 = assessTrip(plan, clear, now);
  assert.equal(r1.stops[0].level, 'low');
  assert.equal(r1.stops[1].level, 'low', 'a short layover alone is not weather risk');
  assert.match(r1.headline.title, /layover is short/);
  assert.match(r1.headline.body, /45m/);

  const roomy = assessTrip(planTrip([JFK, ORD, DEN], '2026-11-16T08:30', [180]), clear, now);
  assert.equal(roomy.level, 'low');
  assert.match(roomy.headline.title, /clear/);

  const snowy = new Map(clear);
  snowy.set('ORD', hoursFrom(start, 24, () => ({ ...calm, code: 75, snow: 2.5, gust: 50 })));
  const r2 = assessTrip(planTrip([JFK, ORD, DEN], '2026-11-16T08:30', [90]), snowy, now);
  assert.equal(r2.level, 'high');
  assert.equal(r2.worst.airport.code, 'ORD');
  assert.match(r2.headline.title, /Chicago/);

  const none = assessTrip(plan, new Map(), now);
  assert.equal(none.level, 'unknown');
});

test('times use 24-hour form by default and after switching back', () => {
  const at = (h, m) => Date.UTC(2026, 10, 16, h, m);
  assert.equal(fmtTime(at(0, 0), 'UTC'), '00:00');
  assert.equal(fmtTime(at(12, 0), 'UTC'), '12:00');
  assert.equal(fmtTime(at(15, 5), 'UTC'), '15:05');
  assert.equal(fmtTime(at(10, 0), 'Asia/Kolkata'), '15:30');
  setClock('12');
  setClock('24');
  assert.equal(fmtTime(at(21, 0), 'America/Chicago'), '15:00');
  setClock('nonsense');
  assert.equal(fmtTime(at(21, 0), 'America/Chicago'), '15:00');
});

test('12-hour times read the way people write them', () => {
  const at = (h, m) => Date.UTC(2026, 10, 16, h, m);
  setClock('12');
  try {
    assert.equal(fmtTime(at(0, 0), 'UTC'), '12 am'); // midnight
    assert.equal(fmtTime(at(0, 30), 'UTC'), '12:30 am');
    assert.equal(fmtTime(at(12, 0), 'UTC'), '12 pm'); // noon
    assert.equal(fmtTime(at(12, 45), 'UTC'), '12:45 pm');
    assert.equal(fmtTime(at(15, 0), 'UTC'), '3 pm');
    assert.equal(fmtTime(at(15, 30), 'UTC'), '3:30 pm');
    assert.equal(fmtTime(at(9, 5), 'UTC'), '9:05 am');
    assert.equal(fmtTime(at(23, 59), 'UTC'), '11:59 pm');
    assert.equal(fmtTime(at(13, 30), 'America/Chicago'), '7:30 am');
    // Half- and quarter-hour zones: the hour strip lands on :30 / :45, and midnight/noon still read right.
    assert.equal(fmtTime(at(10, 0), 'Asia/Kolkata'), '3:30 pm');
    assert.equal(fmtTime(at(18, 30), 'Asia/Kolkata'), '12 am');
    assert.equal(fmtTime(at(6, 30), 'Asia/Kolkata'), '12 pm');
    assert.equal(fmtTime(at(10, 0), 'Asia/Kathmandu'), '3:45 pm');
    assert.equal(fmtTime(at(13, 30), 'America/St_Johns'), '10 am');
    assert.match(fmtTime(at(15, 30), 'UTC'), /^\d{1,2}(:\d\d)? (am|pm)$/); // a normal space, never a narrow no-break one
  } finally { setClock('24'); }
});
