import test from 'node:test';
import assert from 'node:assert/strict';
import {
  riskSpan, tripSnapshot, placeSnapshot, diffTrips, diffPlaces, diffUnits, noteForecast, dismiss, prune, fmtRange,
  sinceLabel, dayName, changeLine, changeLead, alertKey, startLook, noteKind, briefNews, dismissLook, lookEntry, KEEP_MS, SHOW_MS,
} from '../js/changes.js';
import { planTrip, assessTrip, scoreHour, setClock, HOUR } from '../js/core.js';

const now = Date.UTC(2026, 10, 17, 9); // Tue 17 Nov, 09:00 in London
const A = { code: 'LHR', lat: 51.47, lon: -0.454, tz: 'Europe/London' };
const B = { code: 'ORD', lat: 41.98, lon: -87.9, tz: 'America/Chicago' };
const calm = () => ({ code: 2, gust: 20, vis: 20000, pop: 10 });
const series = (start, n, f) => Array.from({ length: n }, (_, k) => ({ t: start + k * HOUR, ...calm(), ...f(start + k * HOUR) }));

test('riskSpan: from the first to the last risky hour', () => {
  const h = (lv) => lv.split('').map((c, i) => ({ t: i * HOUR, level: ['low', 'elevated', 'high'][+c] }));
  assert.equal(riskSpan(h('0000')), null);
  assert.deepEqual(riskSpan(h('0112100')), [1 * HOUR, 5 * HOUR]);
  assert.deepEqual(riskSpan(h('1000200')), [0, 5 * HOUR]);
});

function trip(fcFor) {
  const plan = planTrip([A, B], '2026-11-18T09:00', [], [540]);
  const fc = new Map([['LHR', series(Date.UTC(2026, 10, 17), 96, () => ({}))], ['ORD', series(Date.UTC(2026, 10, 17), 96, fcFor)]]);
  return assessTrip(plan, fc, now);
}
// ORD lands ~18 Nov 18:00 UTC (12:00 Chicago); its window runs 17:00-19:00 UTC.
const storms = (from, to) => (t) => (t >= from && t < to ? { code: 95, pop: 80 } : {});

test('trip snapshots: level up with the storm window, improvement, no change, moved window', () => {
  setClock('24');
  const before = tripSnapshot(trip(() => ({})), scoreHour, now - 20 * HOUR);
  const after = tripSnapshot(trip(storms(Date.UTC(2026, 10, 18, 17), Date.UTC(2026, 10, 18, 19))), scoreHour, now);
  const c = diffTrips(before, after);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'worse');
  assert.equal(changeLine(c[0]), 'ORD went Low → High, thunderstorms now 11:00–13:00');
  assert.equal(changeLine(diffTrips(after, before)[0]), 'ORD improved: High → Low');
  assert.deepEqual(diffTrips(before, before), []);
  // The same storm 45 minutes later is not news; one that starts two hours earlier is.
  const shifted = tripSnapshot(trip(storms(Date.UTC(2026, 10, 18, 16), Date.UTC(2026, 10, 18, 19))), scoreHour, now);
  assert.deepEqual(diffTrips(after, shifted), []);
});

test('diffUnits: cause and window changes at the same level', () => {
  const u = (o) => ({ id: 'FRA', tz: 'Europe/Berlin', level: 'elevated', win: [now, now + 3 * HOUR], top: 'strong gusts', ...o });
  assert.deepEqual(diffUnits([u()], [u({ win: [now + 30 * 60e3, now + 3.5 * HOUR] })]), []);
  const moved = diffUnits([u()], [u({ win: [now + 4 * HOUR, now + 7 * HOUR] })]);
  assert.equal(changeLine(moved[0]), 'FRA still Elevated, strong gusts now 14:00–17:00 (was 10:00–13:00)');
  const cause = diffUnits([u()], [u({ top: 'steady snow' })]);
  assert.equal(changeLine(cause[0]), 'FRA still Elevated, now for steady snow rather than strong gusts, 10:00–13:00');
  assert.deepEqual(diffUnits([u({ level: 'unknown' })], [u()]), []);
  assert.equal(changeLine(diffUnits([u({ level: 'high' })], [u()])[0]), 'FRA improved: High → Elevated, strong gusts now 10:00–13:00');
});

test('place snapshots compare only the hours both looks cover, by local day', () => {
  setClock('24');
  const wxA = { tz: 'Europe/London', hours: series(now - 10 * HOUR, 48, () => ({})) };
  const wxB = { tz: 'Europe/London', hours: series(now, 48, (t) => (t >= Date.UTC(2026, 10, 18, 14) && t < Date.UTC(2026, 10, 18, 17) ? { gust: 60 } : {})) };
  const a = placeSnapshot(wxA, scoreHour, now - 10 * HOUR);
  const b = placeSnapshot(wxB, scoreHour, now);
  assert.equal(a.lv.length, 48);
  const c = diffPlaces(a, b, now);
  assert.equal(c.length, 1);
  assert.equal(c[0].id, '2026-11-18');
  assert.equal(changeLine(c[0], (id) => dayName(id, now, 'Europe/London')), 'Tomorrow went Low → Elevated, strong gusts now 14:00–17:00');
  // A storm that already passed (before the later look) is not compared.
  const gone = { tz: 'Europe/London', hours: series(now - 20 * HOUR, 48, (t) => (t < now ? { code: 95, pop: 90 } : {})) };
  assert.deepEqual(diffPlaces(placeSnapshot(gone, scoreHour, now - 20 * HOUR), b, now).filter((x) => x.id === '2026-11-17'), []);
  assert.deepEqual(diffPlaces(a, { ...b, tz: 'Europe/Paris' }, now), []);
});

test('noteForecast keeps the baseline, shows a change for a day, and forgets after a week', () => {
  const s = (level, at) => ({ at, units: [{ id: 'ORD', tz: 'America/Chicago', level, win: null, top: null }] });
  const d = (x, y) => diffTrips(x, y);
  let r = noteForecast(null, s('low', now - 20 * HOUR), d, now - 20 * HOUR);
  assert.equal(r.changes, null);
  r = noteForecast(r.entry, s('elevated', now), d, now);
  assert.equal(r.changes.length, 1);
  assert.equal(r.since, now - 20 * HOUR);
  // Looking again an hour later still shows it (from the Today page to the Trips page, say)...
  const again = noteForecast(r.entry, s('elevated', now + HOUR), d, now + HOUR);
  assert.equal(again.changes.length, 1);
  assert.equal(again.since, now - 20 * HOUR);
  // ...unless it was dismissed, or a day has passed.
  assert.equal(noteForecast(dismiss(r.entry), s('elevated', now + HOUR), d, now + HOUR).changes, null);
  assert.equal(noteForecast(r.entry, s('elevated', now + SHOW_MS + HOUR), d, now + SHOW_MS + HOUR).changes, null);
  // A baseline older than a week is replaced, not compared.
  const old = noteForecast({ base: s('low', now - KEEP_MS - HOUR), seen: now - KEEP_MS - HOUR }, s('high', now), d, now);
  assert.equal(old.changes, null);
  assert.equal(old.entry.base.at, now);
  assert.equal(noteForecast(null, null, d, now).changes, null);
});

test('prune keeps the week\'s entries, newest first', () => {
  const got = prune({ a: { seen: now }, b: { seen: now - KEEP_MS - 1 }, c: { seen: now - HOUR }, d: null }, now, 1);
  assert.deepEqual(Object.keys(got), ['a']);
  assert.deepEqual(prune(undefined, now), {});
});

test('times: ranges, since labels, day names', () => {
  setClock('12');
  assert.equal(fmtRange([Date.UTC(2026, 10, 17, 16), Date.UTC(2026, 10, 17, 19)], 'UTC'), '4–7 pm');
  assert.equal(fmtRange([Date.UTC(2026, 10, 17, 11), Date.UTC(2026, 10, 17, 13)], 'UTC'), '11 am–1 pm');
  setClock('24');
  assert.equal(fmtRange([Date.UTC(2026, 10, 17, 16), Date.UTC(2026, 10, 17, 19)], 'UTC'), '16:00–19:00');
  assert.equal(sinceLabel(Date.UTC(2026, 10, 16, 18, 40), now, 'Europe/London'), 'yesterday 18:40');
  assert.equal(sinceLabel(Date.UTC(2026, 10, 17, 7, 15), now, 'Europe/London'), '07:15 today');
  assert.equal(sinceLabel(Date.UTC(2026, 10, 14, 8, 0), now, 'Europe/London'), 'Sat 08:00');
  assert.equal(changeLead(Date.UTC(2026, 10, 16, 18, 40), now, 'Europe/London'), 'Since yesterday 18:40, the forecast changed');
  assert.equal(dayName('2026-11-17', now, 'Europe/London'), 'Later today');
  assert.equal(dayName('2026-11-19', now, 'Europe/London'), 'Thursday');
});

test('brief: new alerts, headlines and votes since the last look; re-issued alerts are not new', () => {
  assert.equal(alertKey({ event: 'Winter Storm Warning', onset: '2026-11-17T06:00:00-07:00', id: 'a' }),
    alertKey({ event: 'Winter Storm Warning', onset: '2026-11-17T06:00:00-07:00', id: 'b' }));
  // First look: everything is the baseline.
  let look = startLook(null, now - 20 * HOUR);
  noteKind(look, 'alerts', ['w|1'], now - 20 * HOUR);
  noteKind(look, 'headlines', ['u1', 'u2'], now - 20 * HOUR);
  assert.equal(briefNews(look, now - 20 * HOUR), null);
  // Next day.
  look = startLook(lookEntry(look), now);
  noteKind(look, 'alerts', ['w|1', 'x|2', 'y|3'], now);
  noteKind(look, 'headlines', ['u3', 'u1', 'u4', 'u5', 'u6', 'u7'], now);
  noteKind(look, 'votes', ['HB1'], now); // first time votes appear: not "new"
  const news = briefNews(look, now);
  assert.equal(news.line, 'New since you last looked: 2 alerts, 5 headlines');
  assert.equal(news.since, now - 20 * HOUR);
  // Reloading a little later keeps saying so; a new vote joins in.
  look = startLook(lookEntry(look), now + HOUR);
  noteKind(look, 'alerts', ['w|1', 'x|2', 'y|3'], now + HOUR);
  noteKind(look, 'headlines', ['u3', 'u1', 'u4', 'u5', 'u6', 'u7'], now + HOUR);
  noteKind(look, 'votes', ['HB2', 'HB1'], now + HOUR);
  assert.equal(briefNews(look, now + HOUR).line, 'New since you last looked: 2 alerts, 5 headlines, 1 statehouse vote');
  // Dismissed: quiet until something newer.
  look = dismissLook(look, now + HOUR);
  assert.equal(briefNews(look, now + HOUR), null);
  noteKind(look, 'topics', ['t1'], now + 2 * HOUR);
  noteKind(look, 'topics', ['t1', 't2'], now + 2 * HOUR);
  assert.equal(briefNews(look, now + 2 * HOUR).line, 'New since you last looked: 1 Both sides topic');
  // A week away: start over.
  assert.equal(startLook(lookEntry(look), now + KEEP_MS + 3 * HOUR).prevSeen, null);
});
