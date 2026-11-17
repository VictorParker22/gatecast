// The weird-news mix (owner request, 17 Nov 2026: "not only UPI"): freshness bands, outlets in turn, outlet shares
// of the first 12 and first 30 feed stories, per-source windows (maxAgeDays), and new feed shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const weird = require('../lib/weird.js');
const { loadRound, respond, parseQuery, normaliseSource, mixOutlets, bandOf, LIMITS } = weird;

const now = Date.UTC(2026, 10, 17, 15);
const DAY = 24 * 3600e3;
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/weird/${name}`, import.meta.url), 'utf8');
const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];

// Odd-sounding headlines that pass moderation, each different enough not to count as the same story.
const WORDS = ['goat', 'llama', 'parrot', 'tortoise', 'emu', 'ferret', 'alpaca', 'peacock', 'raccoon', 'otter', 'beaver', 'moose', 'heron', 'badger', 'lobster', 'pelican', 'yak', 'gecko', 'walrus', 'hedgehog'];
const PLACES = ['bus', 'airport', 'grocery store', 'library', 'museum', 'stadium', 'hotel', 'church', 'bank', 'post office'];
// The outlet's word twice over (as "x" and "xville") keeps two outlets' headlines apart for news.sameStory.
const headlineFor = (host, i) => {
  const w = host.split('.')[1] || host;
  return `${WORDS[i % WORDS.length]} wanders into ${PLACES[(i * 3) % PLACES.length]} near ${w} ${w}ville town ${i + 1}`;
};
const item = (host, i, ageMs, title = headlineFor(host, i)) => `<item><title>${title}</title><link>https://${host}/story-${i}</link><pubDate>${new Date(now - ageMs).toUTCString()}</pubDate></item>`;
const rss = (items) => `<rss version="2.0"><channel>${items.join('')}</channel></rss>`;
const src = (id, host, extra = {}) => normaliseSource({ id, name: id.toUpperCase(), home: `https://${host}/`, feed: `https://${host}/feed`, images: false, minWeirdness: 0, ...extra });
const serve = (feeds) => async (url) => (feeds[url] ? { ok: true, status: 200, text: async () => feeds[url] } : { ok: false, status: 404, text: async () => '' });
const share = (list, first) => {
  const n = {};
  for (const x of list.slice(0, first)) n[x.outlet] = (n[x.outlet] || 0) + 1;
  return n;
};
const maxFor = (first) => Math.floor(first * LIMITS.mix.find((m) => m.first === first).share);

test('LIMITS: no outlet over ~30% of the first 12 feed stories or ~35% of the first 30; bands at 2, 7 and 14 days', () => {
  assert.deepEqual(LIMITS.mix, [{ first: 12, share: 0.3 }, { first: 30, share: 0.35 }]);
  assert.equal(maxFor(12), 3);
  assert.equal(maxFor(30), 10);
  assert.deepEqual(LIMITS.bandsMs, [2 * DAY, 7 * DAY, 14 * DAY]);
  assert.equal(LIMITS.feedMaxAgeMs, 14 * DAY);
  assert.deepEqual([0, 1.9, 2, 6.9, 7, 13.9, 14, 40].map((d) => bandOf(now - d * DAY, now)), [0, 0, 1, 1, 2, 2, 3, 3]);
});

// The production shape of 17 Nov 2026: UPI posts every day and is ungated; the others post less, some only older stories.
function productionLike({ upiCap } = {}) {
  const feeds = {}, sources = [];
  const add = (id, host, ages, extra) => {
    sources.push(src(id, host, extra));
    feeds[`https://${host}/feed`] = rss(ages.map((a, i) => item(host, i, a * DAY)));
  };
  add('upi', 'www.upi.example', Array.from({ length: 19 }, (_, i) => 0.1 + i * 0.7), upiCap ? { cap: upiCap } : {}); // 19 kept, every day
  add('smith', 'www.smithsonian.example', [0.5, 3, 9, 20, 30, 40], { cap: 5, maxAgeDays: 45 });
  add('sd', 'www.sciencedaily.example', [1, 2.5, 4, 8, 12, 16], { cap: 6, maxAgeDays: 30 });
  add('mf', 'www.mentalfloss.example', [0.3, 5], { cap: 3 });
  add('ls', 'www.livescience.example', [1.5, 6, 25], { cap: 4, maxAgeDays: 45 });
  add('ao', 'www.atlasobscura.example', [5, 33, 52], { cap: 3, maxAgeDays: 60 });
  add('tc', 'www.conversation.example', [2.2, 9, 18], { cap: 2, maxAgeDays: 30 });
  return { feeds, sources };
}

test('a UPI-heavy round: no outlet takes more than 3 of the first 12 or 10 of the first 30', async () => {
  const { feeds, sources } = productionLike();
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  const feed = r.pool.filter((x) => !x.pick);
  assert.equal(feed.length, 29);
  for (const first of [12, 30]) {
    for (const [outlet, n] of Object.entries(share(feed, first))) assert.ok(n <= maxFor(first), `${outlet}: ${n} of the first ${first}`);
  }
  assert.equal(share(feed, 12).UPI, 3);
  // Per-outlet caps still hold: UPI 8, the others their own.
  const all = share(feed, feed.length);
  assert.deepEqual(all, { UPI: 8, SMITH: 5, SD: 6, MF: 2, LS: 3, AO: 3, TC: 2 });
  // Neighbours differ while more than one outlet has stories left in the first 12.
  for (let i = 1; i < 12; i++) assert.notEqual(feed[i].outlet, feed[i - 1].outlet, `places ${i - 1} and ${i}`);
});

test('the first-30 share binds an outlet whose cap is above it', async () => {
  const { feeds, sources } = productionLike({ upiCap: 15 });
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  const feed = r.pool.filter((x) => !x.pick);
  assert.equal(feed.length, 36);
  assert.equal(share(feed, 12).UPI, maxFor(12));
  assert.equal(share(feed, 30).UPI, maxFor(30));
  assert.equal(share(feed, feed.length).UPI, 15, 'the rest of UPI follows, none dropped');
});

test('without the mix the same round would stack UPI at the top (the before picture)', async () => {
  const { feeds, sources } = productionLike();
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  // The old order: newest day first, the strangest first within a day.
  const old = [...r.pool].sort((a, b) => (weird.dayOf(b.published) < weird.dayOf(a.published) ? -1 : weird.dayOf(b.published) > weird.dayOf(a.published) ? 1 : 0)
    || b.weirdness - a.weirdness || b.published - a.published);
  assert.ok(share(old, 12).UPI > maxFor(12), `old order: UPI ${share(old, 12).UPI} of 12`);
});

test('interleaving: within a band the outlets take turns, strongest outlet first; each outlet strangest first', () => {
  const mk = (outlet, ageDays, w, tag) => ({ outlet, published: now - ageDays * DAY, weirdness: w, tag });
  const items = [
    mk('A', 0.2, 1, 'a1'), mk('A', 0.5, 4, 'a2'), mk('A', 1, 2, 'a3'), mk('A', 1.5, 0, 'a4'),
    mk('B', 0.4, 3, 'b1'), mk('B', 1.2, 1, 'b2'),
    mk('C', 0.3, 2, 'c1'),
    mk('A', 3, 5, 'a5'), mk('C', 4, 1, 'c2'), mk('B', 5, 2, 'b3'), // 2-7 days
    mk('D', 20, 9, 'd1'), // evergreen window: after every fresher story, however strange
  ];
  const order = mixOutlets(items, now, { mix: [{ first: 100, share: 1 }] }).map((x) => x.tag);
  // Turns: a2 b1 c1 a3 b2 a1 a4 | a5 b3 c2 | d1. A would then run twice (a1, a4) and again (a4, a5), so the next band's
  // b3 and c2 step in; the evergreen d1 never does.
  assert.deepEqual(order, ['a2', 'b1', 'c1', 'a3', 'b2', 'a1', 'b3', 'a4', 'c2', 'a5', 'd1']);
  // Alone in its band and the next, an outlet runs on: an old story is never pulled up to break the run.
  const run = mixOutlets([mk('A', 0.1, 1, 'x1'), mk('A', 0.2, 1, 'x2'), mk('B', 20, 9, 'y1')], now).map((x) => x.tag);
  assert.deepEqual(run, ['x1', 'x2', 'y1']);
});

test('shares: an over-share story waits for the next place it fits; with one outlet left the rest follow, none dropped', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => ({ outlet: 'U', published: now - (0.1 + i * 0.1) * DAY, weirdness: 5, tag: `u${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ outlet: `O${i}`, published: now - 20 * DAY, weirdness: 0, tag: `o${i}` })),
  ];
  const out = mixOutlets(items, now);
  assert.equal(out.length, 13);
  // U's first three, then the old stories from the other outlets (U is at its share of 12), then U's rest.
  assert.deepEqual(out.map((x) => x.tag), ['u0', 'u1', 'u2', 'o0', 'o1', 'o2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9']);
});

test('maxAgeDays: per source, default 14, at most 90; an older story sorts after fresh ones from other outlets', async () => {
  assert.equal(normaliseSource({ id: 'x', name: 'X', home: 'https://x.org', feed: 'https://x.org/f' }).maxAgeMs, 14 * DAY);
  assert.equal(normaliseSource({ id: 'x', name: 'X', home: 'https://x.org', feed: 'https://x.org/f', maxAgeDays: 45 }).maxAgeMs, 45 * DAY);
  assert.equal(normaliseSource({ id: 'x', name: 'X', home: 'https://x.org', feed: 'https://x.org/f', maxAgeDays: 400 }).maxAgeMs, 90 * DAY);
  assert.equal(normaliseSource({ id: 'x', name: 'X', home: 'https://x.org', feed: 'https://x.org/f', maxAgeDays: 'many' }).maxAgeMs, 14 * DAY);

  const ever = 'www.evergreen.example', news = 'www.daily.example';
  const feeds = {
    [`https://${ever}/feed`]: rss([item(ever, 0, 30 * DAY, 'Mysterious stone circle puzzles archaeologists, record crowd'), item(ever, 1, 50 * DAY), item(ever, 2, 70 * DAY)]),
    [`https://${news}/feed`]: rss([item(news, 0, 1 * DAY, 'Hat parade'), item(news, 1, 10 * DAY, 'Pie contest')]),
  };
  const sources = [src('ever', ever, { maxAgeDays: 60 }), src('daily', news)];
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  // The fresh stories first, though the old ones are stranger; then the old ones, the strangest first.
  assert.deepEqual(r.pool.map((x) => x.title), ['Hat parade', 'Pie contest', headlineFor(ever, 1), 'Mysterious stone circle puzzles archaeologists, record crowd']);
  assert.ok(r.pool[2].weirdness > r.pool[0].weirdness);
  assert.deepEqual([r.report[0].old, r.report[0].kept], [1, 2]); // the 70-day story is past the 60-day window
  // The same feed with the default window keeps nothing.
  const strict = await loadRound({ fetchImpl: serve(feeds), now, sources: [src('ever', ever), src('daily', news)], picks: [], dbPicks: [] });
  assert.equal(strict.report[0].old, 3);
});

test('picks stay on top, in their own order, and are not counted in the shares', async () => {
  const { feeds, sources } = productionLike();
  const picks = [0, 1, 2, 3].map((i) => ({
    url: `https://www.upi.example/pick-${i}`, title: `Pick ${['alpha', 'bravo', 'charlie', 'delta'][i]}: ${WORDS[i + 10]} rides the ${PLACES[i]}`,
    outlet: 'UPI', published: new Date(now - (i + 1) * DAY).toISOString().slice(0, 10), rating: 4 - i, seeded: false,
  }));
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks, dbPicks: [] });
  assert.deepEqual(r.pool.slice(0, 4).map((x) => x.pick), [true, true, true, true]);
  assert.deepEqual(r.pool.slice(0, 4).map((x) => x.rating), [4, 3, 2, 1]);
  assert.ok(r.pool.slice(4).every((x) => !x.pick));
  assert.equal(share(r.pool.slice(4), 12).UPI, 3, 'four UPI picks do not use up UPI\'s feed share');
});

test('the category filter still works on the mixed pool, in the mixed order', async () => {
  const { feeds, sources } = productionLike();
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  const all = await respond(r, parseQuery(new URLSearchParams({ limit: '60' })), { fetchImpl: serve({}), lookupImpl, pageCache: false });
  const animals = await respond(r, parseQuery(new URLSearchParams({ category: 'animals', limit: '60' })), { fetchImpl: serve({}), lookupImpl, pageCache: false });
  assert.ok(animals.items.length > 0);
  assert.ok(animals.items.every((x) => x.category === 'animals'));
  assert.deepEqual(animals.items.map((x) => x.url), all.items.filter((x) => x.category === 'animals').map((x) => x.url));
  assert.equal(animals.categories.animals, animals.items.length);
  const five = await respond(r, parseQuery(new URLSearchParams({ limit: '5' })), { fetchImpl: serve({}), lookupImpl, pageCache: false });
  assert.deepEqual(five.items.map((x) => x.url), all.items.slice(0, 5).map((x) => x.url));
});

test('feeds of one outlet share its cap and appear once per story; debug rows carry each feed\'s id', async () => {
  const host = 'www.livescience.example';
  const main = [0, 1, 2].map((i) => item(host, i, (i + 1) * 3600e3));
  const tag = [1, 2, 3, 4, 5].map((i) => item(host, i, (i + 1) * 3600e3)); // stories 1 and 2 are in both feeds
  const feeds = { [`https://${host}/feed`]: rss(main), [`https://${host}/tag`]: rss(tag) };
  const sources = [
    normaliseSource({ id: 'ls', name: 'Live Science', home: `https://${host}/`, feed: `https://${host}/feed`, images: false, minWeirdness: 0, cap: 4 }),
    normaliseSource({ id: 'ls-tag', name: 'Live Science', home: `https://${host}/`, feed: `https://${host}/tag`, images: false, minWeirdness: 0, cap: 4, maxAgeDays: 45 }),
  ];
  const r = await loadRound({ fetchImpl: serve(feeds), now, sources, picks: [], dbPicks: [] });
  assert.equal(r.pool.length, 4);
  assert.equal(new Set(r.pool.map((x) => x.url)).size, 4);
  assert.deepEqual(r.report.map((x) => [x.id, x.kept, x.shown]), [['ls', 3, 4], ['ls-tag', 5, 4]]);
});

test('Live Science\'s filter: space and archaeology pass, health stays out', () => {
  const ls = normaliseSource(require('../data/weird-sources.json').sources.find((s) => s.id === 'livescience'));
  const it = (path, cat) => ({ url: `https://www.livescience.com${path}`, rawTitle: 'x', categories: [cat] });
  assert.equal(weird.sourceAllows(it('/space/astronomy/tiny-moon', 'Astronomy'), ls), true);
  assert.equal(weird.sourceAllows(it('/space/meteoroids/x', 'Space'), ls), true);
  assert.equal(weird.sourceAllows(it('/archaeology/x', 'Archaeology'), ls), true);
  assert.equal(weird.sourceAllows(it('/animals/snakes/x', 'Snakes'), ls), true);
  assert.equal(weird.sourceAllows(it('/health/diagnostic-dilemma-x', 'Health'), ls), false);
  assert.equal(weird.sourceAllows(it('/technology/computing/x', 'Computing'), ls), false);
});

test('The Conversation\'s Atom shape: headline, link and time only; nothing from the article, its figure or its labels', async () => {
  const items = weird.parseWeirdFeed(fixture('conversation-science.atom'));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    title: 'A mysterious hum baffles seismologists listening to the deep ocean floor',
    url: 'https://theconversation.com/fixture-mysterious-hum-baffles-seismologists-900001',
    published: Date.UTC(2026, 10, 16, 10), image: null, categories: [],
  });
  assert.ok(!JSON.stringify(items).includes('NEVER-SHOW'));
  assert.ok(!JSON.stringify(items).includes('images.theconversation.com'));
  // Through the real entry: pictures off, explainers dropped, ordinary stories too dull.
  const entry = require('../data/weird-sources.json').sources.find((s) => s.id === 'theconversation-science');
  const source = normaliseSource(entry);
  const r = await loadRound({ fetchImpl: serve({ [entry.feed]: fixture('conversation-science.atom') }), now, sources: [source], picks: [], dbPicks: [] });
  assert.deepEqual(r.pool.map((x) => [x.title, x.outlet, x.image]), [['A mysterious hum baffles seismologists listening to the deep ocean floor', 'The Conversation', null]]);
  assert.deepEqual([r.report[0].listicle, r.report[0].dull, r.report[0].kept], [1, 1, 1]);
  const out = await respond(r, parseQuery(new URLSearchParams()), { fetchImpl: async () => { throw new Error('no page may be read'); }, lookupImpl, pageCache: false });
  assert.equal(out.items[0].image, null);
});
