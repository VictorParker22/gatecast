import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingTrip, mightBeSoon, tripQuery, commute, carry, airSun, flightsNear, nextHours, joinList, TRIP_WINDOW } from '../js/today.js';
import { assessWindow, HOUR } from '../js/core.js';

const AIRPORTS = {
  LHR: { code: 'LHR', city: 'London', lat: 51.47, lon: -0.454, tz: 'Europe/London' },
  FRA: { code: 'FRA', city: 'Frankfurt', lat: 50.033, lon: 8.571, tz: 'Europe/Berlin' },
  SIN: { code: 'SIN', city: 'Singapore', lat: 1.359, lon: 103.989, tz: 'Asia/Singapore' },
  JFK: { code: 'JFK', city: 'New York', lat: 40.64, lon: -73.779, tz: 'America/New_York' },
};
const find = (c) => AIRPORTS[c] || null;
const now = Date.UTC(2026, 10, 16, 12); // 12:00 in London

test('upcomingTrip picks the soonest trip under way or within 72 hours', () => {
  const recents = [
    { r: ['JFK', 'LHR'], t: '2026-11-25T18:00', l: [], d: [0], key: 'JFK-LHR' },                 // 9 days out
    { r: ['LHR', 'FRA', 'SIN'], t: '2026-11-18T10:00', l: [90], d: [0, 0], key: 'LHR-FRA-SIN' }, // 46 hours out
    { r: ['LHR', 'JFK'], t: '2026-11-15T09:00', l: [], d: [0], key: 'LHR-JFK' },                 // already landed
  ];
  const got = upcomingTrip(recents, find, now);
  assert.equal(got.trip.r.join('-'), 'LHR-FRA-SIN');
  assert.equal(got.plan.stops.length, 3);
  assert.equal(got.plan.start, Date.UTC(2026, 10, 18, 10));
  assert.equal(upcomingTrip(recents.slice(0, 1), find, now), null);
  // A trip in the air right now still counts.
  const flying = upcomingTrip([{ r: ['LHR', 'JFK'], t: '2026-11-16T10:30', l: [], d: [] }], find, now);
  assert.ok(flying && flying.plan.start < now);
  // Exactly at the edge of the window.
  const edge = upcomingTrip([{ r: ['LHR', 'JFK'], t: '2026-11-19T12:00' }], find, now);
  assert.ok(edge && edge.plan.start - now === TRIP_WINDOW);
});

test('upcomingTrip ignores broken, unknown and example entries', () => {
  const bad = [null, 'x', { r: ['LHR'] }, { r: ['LHR', 'XXX'], t: '2026-11-17T10:00' }, { r: ['LHR', 'FRA'], t: 'tomorrow' },
    { r: ['LHR', 'FRA'], t: '2026-11-17T10:00', ex: true }, { r: ['lhr', 'fra'], t: '2026-11-17T10:00', l: 'junk', d: ['a'] }];
  const got = upcomingTrip(bad, find, now);
  assert.equal(got.trip.r.join('-'), 'LHR-FRA');
  assert.deepEqual(got.trip.d, [0]);
  assert.equal(upcomingTrip(undefined, find, now), null);
  assert.equal(upcomingTrip({}, find, now), null);
});

test('mightBeSoon is a cheap pre-check and tripQuery matches trip.html', () => {
  assert.equal(mightBeSoon([{ t: '2026-11-18T10:00' }], now), true);
  assert.equal(mightBeSoon([{ t: '2026-12-18T10:00' }], now), false);
  assert.equal(mightBeSoon('nope', now), false);
  assert.equal(tripQuery({ r: ['LHR', 'FRA', 'SIN'], t: '2026-11-18T10:00', l: [90], d: [0, 0] }), '?r=LHR-FRA-SIN&t=2026-11-18T10%3A00&l=90');
  assert.equal(tripQuery({ r: ['SFO', 'NRT'], t: '2026-11-18T10:00', l: [], d: [650] }), '?r=SFO-NRT&t=2026-11-18T10%3A00&d=650');
  assert.equal(joinList(['A', 'B', 'C']), 'A, B and C');
});

const tz = 'Europe/London';
const f = {
  time: (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms),
  temp: (c) => `${Math.round(c)}°`, speed: (k) => `${Math.round(k)} km/h`,
};
function wx(over = () => ({}), extra = {}) {
  const hours = Array.from({ length: 48 }, (_, i) => ({ t: now + i * HOUR, temp: 14, code: 1, pop: 0, precip: 0, snow: 0, gust: 15, vis: 24000, day: i < 4 ? 1 : 0, ...over(i) }));
  const days = [0, 1].map((i) => ({ t: Date.UTC(2026, 10, 16 + i), sunrise: Date.UTC(2026, 10, 16 + i, 7, 20), sunset: Date.UTC(2026, 10, 16 + i, 16, 5), uv: 1, max: 15, min: 8 }));
  return { tz, now: { ...hours[0], feels: hours[0].temp }, hours, days, air: null, ...extra };
}

test('commute: calm, rain with a hedged allowance, snow as a risk', () => {
  const calm = commute(wx(), f);
  assert.equal(calm.level, 'calm');
  assert.equal(calm.big, 'Dry roads');
  const rain = commute(wx((i) => (i >= 3 && i < 6 ? { code: 63, pop: 80, precip: 1.5 } : {})), f);
  assert.equal(rain.big, 'Allow +5 min');
  assert.equal(rain.line, 'Rain from about 15:00 to 18:00. Wet roads and platforms usually slow things a little.');
  assert.equal(rain.level, 'none');
  const maybe = commute(wx((i) => (i === 2 ? { code: 61, pop: 45, precip: 0.3 } : {})), f);
  assert.match(maybe.line, /^Rain possible around 14:00\./);
  const snow = commute(wx((i) => (i < 5 ? { code: 73, pop: 90, snow: 0.8, temp: -1 } : {})), f);
  assert.equal(snow.big, 'Allow +20 min');
  assert.equal(snow.level, 'elevated');
  assert.match(snow.line, /^Snow now, until about 17:00\./);
  const fog = commute(wx((i) => (i < 3 ? { code: 45, vis: 300 } : {})), f);
  assert.equal(fog.line, 'Fog until about 15:00. Traffic slows down in fog.');
  assert.equal(fog.level, 'high');
});

test('carry: umbrella, rain jacket in wind, layers, sun, and nothing extra', () => {
  assert.equal(carry(wx(), f).big, 'Nothing extra');
  const rain = carry(wx((i) => (i >= 3 && i < 6 ? { code: 63, pop: 80, precip: 1.5 } : {})), f);
  assert.equal(rain.big, 'Umbrella');
  const windy = carry(wx((i) => (i >= 3 && i < 6 ? { code: 63, pop: 80, precip: 1.5, gust: 60 } : {})), f);
  assert.equal(windy.big, 'Rain jacket');
  assert.match(windy.line, /too windy for an umbrella\.$/);
  const cool = carry(wx((i) => ({ temp: i === 8 ? 3 : 9 })), f);
  assert.equal(cool.big, 'Warm coat');
  assert.equal(cool.line, 'It drops to 3° around 20:00.');
  const both = carry(wx((i) => ({ temp: i === 8 ? 6 : 9, ...(i === 2 ? { code: 61, pop: 90, precip: 1 } : {}) })), f);
  assert.equal(both.line, 'Rain around 14:00. And a warm layer: it drops to 6° around 20:00.');
  const sunny = carry(wx(() => ({}), {}), f);
  assert.equal(sunny.big, 'Nothing extra');
  const bright = wx(); bright.days[0].uv = 7;
  assert.equal(carry(bright, f).big, 'Sunscreen');
});

test('airSun leaves out what the forecast does not have', () => {
  const plain = airSun(wx(), f);
  assert.equal(plain.big, 'Sunset 16:05');
  assert.equal(plain.line, 'UV 1, low.');
  const withAir = airSun(wx(() => ({}), { air: { aqi: 34 } }), f);
  assert.equal(withAir.big, 'Good air');
  assert.equal(withAir.line, 'Air quality 34, good. UV 1, low. Sunset at 16:05.');
  const evening = airSun(wx(), f, Date.UTC(2026, 10, 16, 18));
  assert.equal(evening.big, 'Sunrise 07:20');
  assert.equal(airSun({ now: { t: now }, days: [] }, f), null);
});

test('flightsNear: calm collapses to one line, risk names the airport and the reason', () => {
  const calmHours = Array.from({ length: 4 }, (_, i) => ({ t: now + i * HOUR, code: 1, gust: 10 }));
  const gusty = calmHours.map((h) => ({ ...h, gust: 75 }));
  const r = (hours) => assessWindow(hours, now, now + 3 * HOUR);
  assert.equal(flightsNear(null).level, 'loading');
  assert.equal(flightsNear([]).big, 'No airports');
  const calm = flightsNear([{ code: 'LHR', risk: r(calmHours) }, { code: 'LGW', risk: r(calmHours) }, { code: 'LTN', risk: r(calmHours) }]);
  assert.equal(calm.big, 'Calm');
  assert.equal(calm.line, 'LHR, LGW and LTN look calm for the next 3 hours.');
  const risky = flightsNear([{ code: 'LHR', risk: r(calmHours) }, { code: 'LGW', risk: r(gusty) }]);
  assert.equal(risky.level, 'high');
  assert.equal(risky.line, 'Very strong gusts at LGW in the next 3 hours. LHR looks calm.');
  assert.equal(flightsNear([{ code: 'LHR', risk: r([]) }]).level, 'unknown');
});

test('nextHours starts at the current hour', () => {
  const w = wx();
  w.now.t = now + 20 * 60e3;
  w.hours.unshift({ t: now - HOUR, temp: 1, code: 1 });
  assert.equal(nextHours(w, 8)[0].t, now);
  assert.equal(nextHours(w, 8).length, 8);
});
