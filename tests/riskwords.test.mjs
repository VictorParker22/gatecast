import test from 'node:test';
import assert from 'node:assert/strict';
import { odds, stopOdds, likelihood, severity, faaPlanLine, TEMPLATES, CALM, UPSTREAM } from '../js/riskwords.js';
import { assessWindow, planTrip, assessTrip, HOUR } from '../js/core.js';

const t0 = Date.UTC(2026, 10, 17, 12);
const hrs = (n, f) => Array.from({ length: n }, (_, k) => ({ t: t0 + k * HOUR, code: 2, gust: 20, vis: 20000, pop: 10, ...f(k) }));
const mph = (k) => `${Math.round(k / 1.609)} mph`;
const win = (hours) => assessWindow(hours, hours[0].t, hours[hours.length - 1].t);

test('likelihood: chance of rain or snow for precipitation, persistence for wind and fog', () => {
  assert.equal(likelihood('storm', [{ pop: 80 }]), 'likely');
  assert.equal(likelihood('storm', [{ pop: 30 }, { pop: 45 }]), 'possible');
  assert.equal(likelihood('snow', [{ pop: 20 }]), 'unlikely');
  assert.equal(likelihood('wind', [{}, {}, {}]), 'likely');
  assert.equal(likelihood('vis', [{}]), 'possible');
  assert.equal(likelihood('rain', [{ pop: null }, {}, {}]), 'likely'); // no chance given: persistence
});

test('severity follows the driving factor\'s points', () => {
  assert.equal(severity(85), 'serious');
  assert.equal(severity(65), 'serious');
  assert.equal(severity(50), 'disruptive');
  assert.equal(severity(30), 'nuisance');
});

test('odds: unlikely but serious storms, likely nuisance snow, likely disruptive gusts', () => {
  const storm = hrs(4, (k) => (k === 2 ? { code: 95, pop: 30 } : {}));
  const s = odds({ level: 'high', ...win(storm), hours: win(storm).hours, where: ' near the hub' });
  assert.equal(s.phrase, TEMPLATES.unlikely.serious);
  assert.equal(s.text, 'unlikely, but serious if it happens (thunderstorms near the hub)');

  const snow = hrs(4, () => ({ code: 71, pop: 85 }));
  const n = odds({ level: 'elevated', factors: win(snow).factors, hours: snow });
  assert.equal(n.text, 'likely, but mostly a nuisance (light snow)');

  const gust = hrs(4, () => ({ gust: 72 }));
  const g = odds({ level: 'high', factors: win(gust).factors, hours: gust, speed: mph, where: ' at take-off' });
  assert.equal(g.text, 'likely and serious (gusts 45 mph at take-off)');
  assert.equal(g.likely, 'likely');
  assert.equal(g.bad, 'serious');

  const gust1 = hrs(4, (k) => (k === 1 ? { gust: 58 } : {}));
  assert.equal(odds({ level: 'elevated', factors: win(gust1).factors, hours: gust1, speed: mph }).text, 'possible, and disruptive if it happens (gusts 36 mph)');
});

test('odds: calm and unknown', () => {
  assert.equal(odds({ level: 'low', factors: [] }).text, CALM.none);
  const minor = hrs(3, () => ({ gust: 45 }));
  assert.equal(odds({ level: 'low', factors: win(minor).factors, hours: minor, speed: mph }).text, 'at most a nuisance (gusts 28 mph)');
  assert.equal(odds({ level: 'unknown', factors: [] }), null);
  assert.equal(odds({ level: 'elevated', factors: [] }), null);
});

test('stopOdds names the moment and handles a connection made risky upstream', () => {
  const A = { code: 'LHR', lat: 51.47, lon: -0.454, tz: 'Europe/London' };
  const B = { code: 'FRA', lat: 50.03, lon: 8.57, tz: 'Europe/Berlin' };
  const C = { code: 'SIN', lat: 1.36, lon: 103.99, tz: 'Asia/Singapore' };
  const plan = planTrip([A, B, C], '2026-11-17T09:00', [90]);
  const all = (f) => Array.from({ length: 72 }, (_, k) => ({ t: Date.UTC(2026, 10, 16, 12) + k * HOUR, code: 2, gust: 20, vis: 20000, pop: 10, ...f }));
  const fc = new Map([['LHR', all({ gust: 75 })], ['FRA', all({})], ['SIN', all({})]]);
  const r = assessTrip(plan, fc, Date.UTC(2026, 10, 16, 12));
  const o = stopOdds(r.stops[0], mph, { named: true });
  assert.equal(o.text, 'likely and serious (gusts 47 mph at take-off from LHR)');
  const conn = stopOdds(r.stops[1], mph);
  assert.equal(r.stops[1].level, 'elevated');
  assert.equal(conn.phrase, UPSTREAM);
  assert.equal(stopOdds(r.stops[2], mph).text, CALM.none);
});

test('faaPlanLine: fixed words per kind, times in the airport\'s zone', () => {
  const time = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  assert.equal(faaPlanLine({ airport: 'ORD', kind: 'ground_stop', start: '2026-11-17T23:00:00Z', source: 'FAA NAS Status' }, time),
    'FAA plan: ground stop or delays expected after 17:00 (FAA NAS Status)');
  assert.equal(faaPlanLine({ airport: 'ORD', kind: 'deicing', text: 'x' }, time), 'FAA plan: de-icing expected, which can slow departures (FAA NAS Status)');
  assert.equal(faaPlanLine({ airport: 'ORD', kind: 'other', text: '  Possible   SWAP routes  ' }, time), 'FAA plan: Possible SWAP routes (FAA NAS Status)');
  assert.equal(faaPlanLine(null, time), null);
  assert.equal(faaPlanLine({ kind: 'ground_stop' }, time), null);
});
