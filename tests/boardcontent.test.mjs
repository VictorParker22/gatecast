import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, dayparts, makeQuiz, season, tipFor, pickCities, compareLine, dayKey, CHECKLISTS, skyOf } from '../js/boardcontent.js';

const HOUR = 3600e3;
const tz = 'America/Chicago';
const start = Date.UTC(2026, 10, 15, 16); // 10:00 in Chicago
const f = {
  time: (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms),
  temp: (c) => `${Math.round(c)}°`, tempNumber: (c) => Math.round(c), speed: (k) => `${Math.round(k)} km/h`,
  weekday: (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(ms + 12 * HOUR),
};
function wx(over = () => ({})) {
  const hours = Array.from({ length: 48 }, (_, i) => ({ t: start + i * HOUR, temp: 8 + 4 * Math.sin((i - 2) / 24 * 2 * Math.PI), code: 1, pop: 0, precip: 0, gust: 15, day: i < 7 ? 1 : 0, ...over(i) }));
  const days = Array.from({ length: 10 }, (_, i) => ({ t: Date.UTC(2026, 10, 15 + i, 6), max: 10 + (i === 2 ? 6 : i), min: 2, sunset: Date.UTC(2026, 10, 15, 22, 29), uv: 2, code: 1 }));
  return { tz, now: { ...hours[0] }, hours, days };
}

test('headline describes a dry day and a change to rain', () => {
  assert.match(headline(wx(), f), /^Bright and dry all day\./);
  const rainy = wx((i) => (i >= 5 && i < 9 ? { code: 63, pop: 80, precip: 2 } : {}));
  assert.match(headline(rainy, f), /^Dry until about 15:00, then rain\./);
  const wetNow = wx((i) => (i < 3 ? { code: 61, pop: 90, precip: 1 } : {}));
  assert.match(headline(wetNow, f), /^Rain until about 13:00\./);
  const windy = wx((i) => (i === 4 ? { gust: 70 } : {}));
  assert.match(headline(windy, f), /Gusts up to 70 km\/h\.$/);
  const frosty = wx((i) => (i >= 12 ? { temp: -2 } : { temp: 5 }));
  assert.match(headline(frosty, f), /Frost by 22:00\.$/);
});

test('dayparts start with the current part and cover four parts', () => {
  const parts = dayparts(wx());
  assert.deepEqual(parts.map((p) => p.name), ['Morning', 'Afternoon', 'Evening', 'Overnight']);
  assert.ok(parts.every((p) => Number.isFinite(p.temp)));
});

test('the daily question always has exactly one correct option', () => {
  for (let d = 0; d < 8; d++) {
    const w = wx();
    w.now.t += d * 24 * HOUR;
    const q = makeQuiz(w, 'Chicago', f);
    assert.ok(q.options.length >= 2 && q.options.length <= 3, q.kind);
    assert.ok(q.correct >= 0 && q.correct < q.options.length, q.kind);
    assert.equal(new Set(q.options).size, q.options.length, `${q.kind} options must differ`);
    assert.ok(q.question.includes('Chicago'));
    assert.equal(q.key, dayKey(w.now.t, tz));
  }
});

test('seasons flip by hemisphere and count down to the next one', () => {
  const nov = new Date(Date.UTC(2026, 10, 15));
  assert.deepEqual(season(41.9, nov), { name: 'autumn', next: 'winter', days: 16 });
  assert.equal(season(-33.9, nov).name, 'spring');
  assert.equal(season(1.3, nov).name, 'tropics');
  assert.equal(season(41.9, new Date(Date.UTC(2026, 11, 20))).next, 'spring');
  for (const k of ['winter', 'spring', 'summer', 'autumn', 'tropics']) assert.ok(CHECKLISTS[k].items.length >= 5);
});

test('tips follow the forecast', () => {
  assert.equal(tipFor(wx(), f).title, 'A quiet day');
  assert.equal(tipFor(wx((i) => (i === 10 ? { temp: -1 } : {})), f).title, 'Frost tonight');
  assert.equal(tipFor(wx((i) => (i === 6 ? { code: 73, pop: 70 } : {})), f).title, 'Snow is on the way');
  assert.equal(tipFor(wx((i) => (i === 6 ? { code: 95 } : {})), f).title, 'Thunderstorms later');
  assert.equal(tipFor(wx((i) => (i === 6 ? { temp: 34 } : {})), f).title, 'A hot one');
  assert.match(tipFor(wx((i) => (i === 6 ? { code: 63, pop: 80 } : {})), f).text, /around 16:00/);
});

test('comparison cities are far away, distinct, and the sentence reads correctly', () => {
  const chicago = { lat: 41.88, lon: -87.63 };
  for (let d = 0; d < 12; d++) {
    const c = pickCities(chicago, 20000 + d);
    assert.ok(c.length >= 2 && new Set(c.map((x) => x.name)).size === c.length);
    assert.ok(!c.some((x) => x.name === 'New York'), 'New York is within 1,500 km of Chicago');
  }
  assert.equal(compareLine('Chicago', 8, { name: 'Tokyo', temp: 20, dayLabel: 'Monday', hereDayLabel: 'Sunday', ahead: true }, f), 'Tokyo is 12° warmer than Chicago right now, and it is already Monday there.');
  assert.equal(compareLine('Chicago', 8, { name: 'Reykjavik', temp: 1, dayLabel: 'Sunday', hereDayLabel: 'Sunday' }, f), 'Reykjavik is 7° colder than Chicago right now.');
  assert.equal(skyOf(63, 1), 'rain');
  assert.equal(skyOf(0, 0), 'night');
});
