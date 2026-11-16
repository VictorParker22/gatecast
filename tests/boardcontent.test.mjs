import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, headlineParts, dayparts, makeQuiz, season, tipFor, pickCities, compareLine, dayKey, CHECKLISTS, skyOf } from '../js/boardcontent.js';

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
  assert.equal(headline(wx(), f), 'Sunny but cool, 11° at best. Bring a jacket.');
  const rainy = wx((i) => (i >= 5 && i < 9 ? { code: 63, pop: 80, precip: 2 } : {}));
  assert.equal(headline(rainy, f), 'Dry until about 15:00, then rain. Take an umbrella.');
  const wetNow = wx((i) => (i < 3 ? { code: 61, pop: 90, precip: 1 } : {}));
  assert.equal(headline(wetNow, f), 'Rain easing off by about 13:00. Take an umbrella.');
  const windy = wx((i) => (i === 4 ? { gust: 70 } : {}));
  assert.equal(headline(windy, f), 'Sunny and windy, gusts to 70 km/h. A windproof layer will help.');
  const frosty = wx((i) => (i >= 12 ? { temp: -2 } : { temp: 5 }));
  assert.equal(headline(frosty, f), 'Sunny today, frost tonight. Cover the windshield this evening.');
});

/* ---------- Headline scenario matrix ---------- */
// make(): 48 hours starting at local hour `at` in Chicago, with a daily temperature curve around `base`.
function make({ at = 10, base = 8, swing = 4, sunrise = 7, sunset = 17, over = () => ({}), now = {}, days = {} } = {}) {
  const t0 = Date.UTC(2026, 10, 15, at + 6);
  const hours = Array.from({ length: 48 }, (_, i) => {
    const lh = (at + i) % 24;
    return { t: t0 + i * HOUR, temp: base + swing * Math.sin(((lh - 9) / 24) * 2 * Math.PI), code: 1, pop: 0, precip: 0, snow: 0, gust: 15, wind: 8, day: lh >= sunrise && lh < sunset ? 1 : 0, ...over(i, lh) };
  });
  const d = Array.from({ length: 10 }, (_, i) => ({ t: Date.UTC(2026, 10, 15 + i, 6), max: base + swing, min: base - swing, pop: 0, uv: 2, code: 1, sunrise: Date.UTC(2026, 10, 15 + i, sunrise + 6), sunset: Date.UTC(2026, 10, 15 + i, sunset + 6), ...days }));
  return { tz, now: { ...hours[0], feels: hours[0].temp, ...now }, hours, days: d };
}
const rain = (pop = 90, code = 63, precip = 1.5) => ({ code, pop, precip });
const MATRIX = [
  ['calm sunny morning', make(), 'Sunny all day. Nothing to plan around today.'],
  ['pleasant day', make({ base: 19 }), 'Sunny all day. A good day to be outside.'],
  ['cloudy afternoon', make({ at: 13, over: () => ({ code: 3 }) }), 'Cloudy but dry this afternoon. No need to change your plans.'],
  ['rain certain later', make({ over: (i) => (i >= 5 && i < 9 ? rain(85) : {}) }), 'Dry until about 15:00, then rain. Take an umbrella.'],
  ['rain likely this evening', make({ over: (i) => (i >= 8 && i < 13 ? rain(60) : {}) }), 'Dry until this evening, then rain likely. Take an umbrella.'],
  ['rain possible', make({ over: (i) => (i >= 4 && i < 8 ? rain(40, 61, 0.3) : {}) }), 'Dry, with a chance of rain after 14:00. Pack an umbrella, just in case.'],
  ['brief shower', make({ over: (i) => (i === 4 ? rain(75, 80, 0.8) : {}) }), 'Dry, apart from a shower around 14:00. Take an umbrella.'],
  ['rain within the hour', make({ over: (i) => (i >= 1 && i < 6 ? rain(90) : {}) }), 'Rain starting within the hour. Take an umbrella.'],
  ['hours of rain tonight', make({ over: (i) => (i >= 7 && i < 16 ? rain(90) : {}) }), 'Dry until this evening, then steady rain. Take an umbrella.'],
  ['heavy rain', make({ over: (i) => (i >= 3 && i < 7 ? rain(95, 65, 6) : {}) }), 'Dry until about 13:00, then heavy rain. Take a proper raincoat.'],
  ['rain now, ending in two hours', make({ over: (i) => (i < 2 ? rain(90) : {}) }), 'Rain easing off by about 12:00. Wait it out if you can.'],
  ['rain now, ending within the hour', make({ over: (i) => (i < 1 ? rain(90, 61, 0.4) : {}) }), 'Rain stopping within the hour. Give it a few minutes.'],
  ['rain now, back tonight', make({ over: (i) => (i < 3 || (i >= 11 && i < 15) ? rain(85) : {}) }), 'Rain until about 13:00, then again tonight. Take an umbrella.'],
  ['rain now, no dry hour in 24h', make({ over: () => rain(90) }), 'Rain all day and into tonight. Take an umbrella.'],
  ['showers on and off', make({ over: (i) => (i % 3 === 0 ? rain(70, 80, 0.6) : { code: 3, pop: 20 }) }), 'Showers on and off all day. Take an umbrella.'],
  ['rain with strong wind', make({ over: (i) => (i >= 3 && i < 8 ? { ...rain(90), gust: 62 } : {}) }), 'Dry until about 13:00, then rain. Wear a hood: too windy for an umbrella.'],
  ['drizzle', make({ over: (i) => (i >= 3 && i < 7 ? rain(80, 53, 0.2) : {}) }), 'Dry until about 13:00, then drizzle. A hood or light jacket will do.'],
  ['thunderstorms likely', make({ base: 26, over: (i) => (i >= 5 && i < 8 ? rain(65, 95, 5) : {}) }), 'Dry until about 15:00, then thunderstorms likely. Plan to be indoors by then.'],
  ['thunderstorm now', make({ base: 24, over: (i) => (i < 2 ? rain(90, 95, 8) : {}) }), 'Thunderstorms easing off by about 12:00. Stay indoors until it passes.'],
  ['snow tonight', make({ base: 0, swing: 2, over: (i) => (i >= 9 && i < 15 ? { code: 73, pop: 85, precip: 1, snow: 1.2 } : {}) }), 'Dry until this evening, then heavy snow. Travel only if you need to.'],
  ['freezing rain', make({ base: 0, swing: 1, over: (i) => (i >= 9 && i < 12 ? { code: 66, pop: 80, precip: 1 } : {}) }), 'Dry until this evening, then freezing rain. Watch for ice on paths and roads.'],
  ['rain then a freeze', make({ at: 14, base: 2, swing: 1, over: (i) => (i < 3 ? rain(90) : i >= 6 ? { temp: -3 } : {}) }), 'Rain easing off by about 17:00, then freezing. Watch for ice on paths and roads.'],
  ['fog clearing', make({ at: 7, over: (i) => (i < 3 ? { code: 45 } : {}) }), 'Fog lifting by about 10:00. If you drive, use low beams.'],
  ['windy and dry', make({ over: (i) => (i >= 2 && i < 8 ? { gust: 72 } : {}) }), 'Sunny and windy, gusts to 72 km/h. A windproof layer will help.'],
  ['damaging gusts', make({ over: (i) => (i >= 2 && i < 8 ? { gust: 95 } : {}) }), 'Sunny and very windy, gusts to 95 km/h. Tie down anything loose outside.'],
  ['hot', make({ base: 28, swing: 5, days: { uv: 9 } }), 'Sunny and hot, up to 33°. Drink water and find shade at midday.'],
  ['extreme heat', make({ base: 31, swing: 6, days: { uv: 10 } }), 'Sunny and very hot, up to 37°. Keep to the shade and drink water often.'],
  ['high UV', make({ base: 21, swing: 3, days: { uv: 7 } }), "Sunny all day. Wear sunscreen if you're out at midday."],
  ['deep cold', make({ base: -18, swing: 2, now: { feels: -29 } }), 'Sunny and bitterly cold, feels like -29°. Cover your face and hands outside.'],
  ['big temperature drop', make({ over: (i) => ({ temp: i < 4 ? 21 : Math.max(9, 21 - (i - 3) * 1.5) }) }), 'Sunny for now, much colder tonight. Bring a warm layer for later.'],
  ['frost by morning, evening visit', make({ at: 19, base: 3, over: (i, lh) => (lh >= 1 && lh <= 8 ? { temp: -1 } : {}) }), 'Clear and cold tonight, frost by about 01:00. Cover the windshield before bed.'],
  ['clear night', make({ at: 22 }), 'Clear and cold tonight, down to 4°. Wear a warm coat if you go out.'],
  ['3 am visit', make({ at: 3 }), 'Clear and cold until dawn, down to 4°. Wear a warm coat if you go out.'],
  ['rain tomorrow, evening visit', make({ at: 20, over: (i) => (i >= 12 && i < 18 ? rain(80) : {}) }), 'Dry until tomorrow morning, then steady rain. Pack an umbrella for tomorrow.'],
  ['rain only in the small hours', make({ at: 14, over: (i, lh) => (lh >= 1 && lh < 4 ? rain(80) : {}) }), "Dry until the early hours, then rain. Take an umbrella if you're out late."],
  ['frosty morning', make({ at: 7, base: -1, swing: 3, now: { temp: -2, feels: -4 } }), 'Sunny and frosty this morning. Leave time to clear the windshield.'],
  ['polar night, no sunrise', make({ at: 12, base: -12, swing: 1, sunrise: 24, sunset: 24, now: { feels: -12 }, days: { sunrise: null, sunset: null, uv: null } }), 'Clear and cold this afternoon. Wear a hat and gloves.'],
  // Temperature bands: a clothing action only when the lead carries the number.
  ['cool day, jacket with its reason', make({ base: 5 }), 'Sunny but cool, 9° at best. Bring a jacket.'],
  ['cool cloudy afternoon', make({ at: 13, base: 6, swing: 2, over: () => ({ code: 3 }) }), 'Cloudy and cool, 8° at best. Bring a jacket.'],
  ['cold grey day', make({ base: 3, swing: 1, over: () => ({ code: 3 }) }), 'Cloudy and cold, 4° at best. Wear a warm coat.'],
  ['unremarkable 14°, no jacket', make({ base: 10, over: () => ({ code: 2 }) }), 'Sun and cloud all day. Nothing to plan around today.'],
  ['cool evening', make({ at: 20, base: 11, swing: 3 }), 'Clear and cool tonight, down to 8°. Take a jacket if you go out.'],
  ['unremarkable breezy evening', make({ at: 19, base: 16, swing: 2, over: () => ({ gust: 45 }) }), 'Clear tonight, sunny tomorrow. An easy evening, nothing to plan around.'],
  ['mild night', make({ at: 1, base: 16, swing: 2, sunset: 20 }), 'Clear until dawn, then sunny. Nothing to plan around tonight.'],
  ['missing pop, gust and uv', make({ over: (i) => (i >= 5 && i < 8 ? { code: 61, pop: null, gust: null, precip: 0.5 } : { pop: null, gust: null }), days: { uv: null } }), 'Dry until about 15:00, then rain likely. Take an umbrella.'],
];

for (const [name, w, expected] of MATRIX) {
  test(`headline: ${name}`, () => assert.equal(headline(w, f), expected));
}

test('headline reads correctly when the clock says "noon" or "midnight"', () => {
  // The page's 12-hour formatter returns "3 pm", and "noon" / "midnight" for 12:00. Never parsed, only inserted.
  const f12 = { ...f, time: (ms) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: true }).format(ms).replace(' AM', ' am').replace(' PM', ' pm'); return p === '12 pm' ? 'noon' : p === '12 am' ? 'midnight' : p; } };
  assert.equal(headline(make({ at: 9, over: (i) => (i < 3 ? rain(90) : {}) }), f12), 'Rain easing off by about noon. Take an umbrella.');
  assert.equal(headline(make({ at: 19, over: (i) => (i >= 5 && i < 9 ? rain(40, 61, 0.3) : {}) }), f12), 'Dry, with a chance of rain after midnight. Pack an umbrella, just in case.');
  assert.equal(headline(make({ at: 8, over: (i) => (i === 4 ? rain(75, 80, 0.8) : {}) }), f12), 'Dry, apart from a shower around noon. Take an umbrella.');
  assert.equal(headline(make({ at: 19, base: 3, over: (i, lh) => (lh === 0 || (lh >= 1 && lh <= 8) ? { temp: -1 } : {}) }), f12), 'Clear and cold tonight, frost by about midnight. Cover the windshield before bed.');
});

test('a clothing action always comes with the number that explains it', () => {
  for (const [name, w] of MATRIX) {
    const { lead, action } = headlineParts(w, f);
    if (/jacket\.|jacket if|warm coat/.test(action)) assert.match(lead, /\d°/, `${name}: ${lead} ${action}`);
  }
});

test('headline follows the voice rules in every scenario', () => {
  const banned = /!|precipitation|convective|expect|showers? of rain/i;
  for (const [name, w] of MATRIX) {
    const out = headline(w, f);
    assert.equal(headline(w, f), out, `${name} must be deterministic`);
    assert.ok(!banned.test(out), `${name}: ${out}`);
    assert.ok(out.split(/\s+/).length <= 18, `${name} is too long: ${out}`);
    const { lead, action } = headlineParts(w, f);
    assert.equal(`${lead} ${action}`, out);
    assert.match(lead, /^[A-Z].*\.$/);
    assert.match(action, /^[A-Z].*\.$/);
    if (!w.now.day) assert.ok(!/sunny/i.test(lead.split(',')[0]), `${name}: no "sunny" for the night sky`);
  }
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
  // Tips use the headline's honest-doubt words.
  assert.match(tipFor(wx((i) => (i === 6 ? { code: 73, pop: 45 } : {})), f).text, /^Snow is possible around 16:00\./);
  assert.match(tipFor(wx((i) => (i === 6 ? { code: 73, pop: 80 } : {})), f).text, /^Snow is very likely around 16:00\./);
});

test('the rain question explains itself in plain, correct English', () => {
  // dayNumber % 4 === 2 picks the rain question; find such a day by shifting the clock.
  for (let d = 0; d < 4; d++) {
    const w = wx((i) => (i === 6 ? { code: 95, pop: 60 } : {}));
    w.now.t += d * 24 * HOUR;
    const q = makeQuiz(w, 'Chicago', f);
    if (q.kind !== 'rain') continue;
    assert.equal(q.explain, 'Thunderstorms are likely around 16:00 (60% chance that hour).');
    const dry = wx(); dry.now.t = w.now.t;
    assert.equal(makeQuiz(dry, 'Chicago', f).explain, 'Every hour in the next 24 has less than an even chance of rain or snow.');
    return;
  }
  assert.fail('no rain question in four days');
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
