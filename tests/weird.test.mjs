import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const weird = require('../lib/weird.js');
const sourceFile = require('../data/weird-sources.json');
const pickFile = require('../data/weird-picks.json');
const { parseWeirdFeed, headline, parseQuery, loadRound, respond, weirdFor, pickItems, normaliseSource, CATEGORIES } = weird;

const now = Date.UTC(2026, 10, 16, 12);
const DAY = 24 * 3600e3;
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/weird/${name}`, import.meta.url), 'utf8');
const FEEDS = {
  'https://rss.upi.com/news/odd_news.rss': fixture('upi-odd-news.rss'),
  'https://www.smithsonianmag.com/rss/smart-news/': fixture('smithsonian-smart-news.rss'),
  'https://www.atlasobscura.com/feeds/articles': fixture('atlas-obscura-articles.rss'),
  'https://www.livescience.com/feeds.xml': fixture('live-science.xml'),
  'https://www.odditycentral.com/feed': fixture('oddity-central.rss'),
  'https://www.sciencedaily.com/rss/strange_offbeat.xml': '<?xml version="1.0"?><rss version="2.0"><channel><title>ScienceDaily</title></channel></rss>',
};
const BEAR_URL = 'https://www.upi.com/Odd_News/2026/11/15/fixture-bear-kitchen-cabinets/1001/';
const headers = (type) => ({ get: (k) => (k.toLowerCase() === 'content-type' ? type : null) });
const pagesRead = [];
async function fetchImpl(url) {
  if (FEEDS[url]) return { ok: true, status: 200, headers: headers('application/rss+xml'), text: async () => FEEDS[url] };
  if (url === 'https://feeds.skynews.com/feeds/rss/strange.xml') return { ok: false, status: 503, headers: headers('text/html'), text: async () => '' };
  if (url === 'https://soranews24.com/feed/') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
  if (url === 'https://www.mentalfloss.com/feed') return { ok: true, status: 200, headers: headers('text/html'), text: async () => '<!doctype html><html><head><title>Hi</title></head></html>' };
  pagesRead.push(url);
  if (url === BEAR_URL) return { ok: true, status: 200, headers: headers('text/html'), text: async () => '<html><head><meta property="og:image" content="https://cdnph.upi.com/fixture/bear.jpg"></head><body>NEVER-SHOW</body></html>' };
  return { ok: false, status: 404, headers: headers('text/html'), text: async () => '' };
}
const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];
const OPTS = { fetchImpl, lookupImpl, now, pageCache: false, dbPicks: [] };
const get = (params) => new URLSearchParams(params);
const by0 = (out, start) => out.items.find((x) => x.title.startsWith(start));

test('parseWeirdFeed keeps parseFeed\'s fields plus the feed\'s own category labels, never the outlet\'s text', () => {
  const items = parseWeirdFeed(fixture('smithsonian-smart-news.rss'));
  assert.equal(items.length, 3);
  assert.deepEqual(Object.keys(items[0]).sort(), ['categories', 'image', 'published', 'title', 'url']);
  assert.deepEqual(items[0].categories, ['Smart News', 'History & Archaeology']);
  assert.deepEqual(items[1].categories, ['Smart News', 'Science & Nature', 'Animals']);
  assert.equal(items[0].image.url, 'https://th-thumbnailer.cdn-si-edu.com/fixture/croc.jpg');
  assert.ok(!JSON.stringify(items).includes('NEVER-SHOW'));
  // Atom category terms and an image enclosure.
  const atom = parseWeirdFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link href="https://x.example.org/a"/><updated>2026-11-15T00:00:00Z</updated><category term="Weird &amp; Wonderful"/><summary>&lt;category&gt;Hidden&lt;/category&gt;</summary></entry></feed>');
  assert.deepEqual(atom[0].categories, ['Weird & Wonderful']);
  assert.equal(parseWeirdFeed('not xml').length, 0);
});

test('headline: "Watch:" marks a video and is removed, "Look:" is removed, anything else is verbatim', () => {
  assert.deepEqual(headline('Watch: Bear raids kitchen'), { title: 'Bear raids kitchen', video: true });
  assert.deepEqual(headline('LOOK:  Giant pumpkin'), { title: 'Giant pumpkin', video: false });
  assert.deepEqual(headline("'Just a phase': Wild turkey"), { title: "'Just a phase': Wild turkey", video: false });
  assert.deepEqual(headline('Watch:'), { title: 'Watch:', video: false });
  assert.deepEqual(headline('Watchmaker builds tiny clock'), { title: 'Watchmaker builds tiny clock', video: false });
});

test('parseQuery: limit 1-60 (default 30), known categories only, debug flag', () => {
  assert.deepEqual(parseQuery(get({})), { limit: 30, category: null, debug: false });
  assert.deepEqual(parseQuery(get({ limit: '500', category: 'Animals', debug: '1' })), { limit: 60, category: 'animals', debug: true });
  assert.deepEqual(parseQuery(get({ limit: '0', category: 'gossip' })), { limit: 1, category: null, debug: false });
  assert.deepEqual(parseQuery(get({ limit: 'abc' })), { limit: 30, category: null, debug: false });
});

test('/api/weird answer: contract shape, picks first, then newest; held items never appear', async () => {
  pagesRead.length = 0;
  const out = await weirdFor(get({ limit: '60' }), OPTS);
  assert.deepEqual(Object.keys(out).sort(), ['categories', 'checkedAt', 'items', 'sources']);
  assert.equal(out.checkedAt, new Date(now).toISOString());
  for (const x of out.items) {
    assert.deepEqual(Object.keys(x).sort(), ['category', 'id', 'image', 'imageCredit', 'note', 'outlet', 'outletUrl', 'pick', 'published', 'rating', 'title', 'url', 'video']);
    assert.match(x.url, /^https:\/\//);
    assert.match(x.id, /^[0-9a-f]{12}$/);
    assert.ok(CATEGORIES.includes(x.category));
    assert.ok(x.image === null || /^https:\/\//.test(x.image));
    assert.equal(x.imageCredit, x.image ? `Image: ${x.outlet}` : null);
    assert.ok(Number.isFinite(Date.parse(x.published)));
  }
  assert.equal(new Set(out.items.map((x) => x.id)).size, out.items.length);
  const titles = out.items.map((x) => x.title);

  // Picks first (seeded ones that pass every rule), newest first.
  const picks = out.items.filter((x) => x.pick);
  assert.equal(picks.length, 11);
  assert.deepEqual(out.items.slice(0, 11).map((x) => x.pick), Array(11).fill(true));
  assert.equal(titles[0], 'Calif. coast battered by monster waves as El Nino strengthens grip');
  assert.equal(titles[10], 'Fox interrupts professional soccer game in Turkey');
  for (let i = 1; i < 11; i++) assert.ok(Date.parse(out.items[i - 1].published) >= Date.parse(out.items[i].published));
  assert.ok(picks.every((x) => x.rating === null && x.note === null && x.outlet === 'UPI' && x.outletUrl === 'https://www.upi.com/Odd_News/'));
  // Seeded picks that trip a hold rule are not shown: the 13-year-old (children) and "rescued from" (animal welfare).
  assert.ok(!titles.some((t) => /13-year-old cowgirl|parakeet rescued/.test(t)));

  // The moose pick is also in the UPI feed: it takes the feed's picture, and the feed copy is not repeated.
  const moose = out.items.filter((x) => x.title.startsWith('Moose caught on camera'));
  assert.equal(moose.length, 1);
  assert.equal(moose[0].pick, true);
  assert.equal(moose[0].image, 'https://cdnph.upi.com/fixture/moose.jpg');
  assert.equal(moose[0].imageCredit, 'Image: UPI');
  assert.equal(moose[0].video, true);
  // Other picks have no picture: no article page is read for a pick.
  assert.equal(out.items.find((x) => x.title.startsWith('Hundreds gather')).image, null);
  assert.ok(!pagesRead.some((u) => u.includes('move-the-bean')));

  // Then the regular outlets, newest day first, then the review outlet, without pictures. Outside UPI a story needs a
  // weirdness signal: the cicada, the fog festival, the umbrellas and two Oddity Central stories have none.
  const rest = out.items.slice(11);
  assert.deepEqual(rest.map((x) => x.title), [
    'Strange lights over the desert baffle airline pilots',
    'Bear raids kitchen cabinets in Tennessee cabin',
    "Octopus seen 'punching' fish that crowd its hunting spot",
    'Giant pumpkin weighing 2,000 pounds sets state record',
    'A Mysterious Stone Circle Puzzles Archaeologists in Scotland',
    'Lottery player wins $100,000 with fortune cookie numbers', // the newer copy of a repeated address
    'Town council bans garden gnomes from front lawns',
    'Collector owns 4,000 rubber ducks', // same day as the loaf, but stranger, so first
    'Restaurant serves soup in a hollowed-out loaf the size of a car tyre',
  ]);
  assert.ok(rest.slice(-2).every((x) => x.outlet === 'Oddity Central' && x.image === null));
  // Tracking parameters are removed from the address.
  assert.equal(by0(out, 'Lottery').url, 'https://www.upi.com/Odd_News/2026/11/12/fixture-fortune-cookie-lottery/1004/');
  assert.ok(out.items.every((x) => !/utm_/.test(x.url)));
  assert.ok(!pagesRead.some((u) => u.includes('odditycentral')));

  // Held or dropped: arrests, a child with a crime, a mummy, a tapeworm, a named private person gone viral. Filtered:
  // Live Science's space story. Too old: the October story. Repeated: the same address with tracking parameters.
  for (const gone of ['arrested', 'Teen charged', 'Mummified', 'tapeworm', 'goes viral', 'exoplanet', 'Old story', 'numbers from fortune cookie', 'Cicada', 'Fog', 'Umbrellas', 'radio', 'teapot']) {
    assert.ok(!titles.some((t) => t.includes(gone)), gone);
  }
  assert.ok(!JSON.stringify(out).includes('NEVER-SHOW'));

  // Watch: -> video; Look: -> removed, not a video; categories from the feed's labels or the headline's words.
  const by = (start) => out.items.find((x) => x.title.startsWith(start));
  assert.equal(by('Bear raids').video, true);
  assert.equal(by('Bear raids').image, 'https://cdnph.upi.com/fixture/bear.jpg'); // og:image from the article's own page
  assert.equal(by('Bear raids').category, 'animals');
  assert.equal(by('Giant pumpkin').video, false);
  assert.equal(by('Giant pumpkin').category, 'records');
  assert.equal(by('Giant pumpkin').image, 'https://cdnph.upi.com/fixture/pumpkin.jpg');
  assert.equal(by('A Mysterious Stone').category, 'unexplained');
  assert.equal(by('Strange lights').category, 'unexplained');
  assert.equal(by('Town council bans').category, 'laws');
  assert.equal(by('Lottery player').category, 'other');
  assert.equal(by('Collector owns').category, 'animals');
  assert.equal(by('Calif. coast').category, 'weather');

  // Category counts are for the returned set.
  assert.deepEqual(Object.keys(out.categories), ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other']);
  assert.equal(Object.values(out.categories).reduce((a, b) => a + b, 0), out.items.length);
  assert.equal(out.categories.animals, out.items.filter((x) => x.category === 'animals').length);

  // Every source is listed with ok and how many of its items are in the answer.
  const src = Object.fromEntries(out.sources.map((s) => [s.name, s]));
  assert.equal(out.sources.length, sourceFile.sources.filter((s) => s.enabled !== false).length);
  assert.deepEqual(src.UPI, { name: 'UPI', ok: true, count: 11 + 4 });
  assert.equal(src['Sky News'].ok, false);
  assert.equal(src.SoraNews24.ok, false);
  assert.equal(src['Mental Floss'].ok, false);
  assert.deepEqual(src.ScienceDaily, { name: 'ScienceDaily', ok: true, count: 0 });
});

test('?debug=1 adds counts per rule and per source, and nothing else about what was held', async () => {
  const out = await weirdFor(get({ limit: '60', debug: '1' }), OPTS);
  assert.deepEqual(out.held, { H1: 1, H2: 1, H3: 1, H5: 2, H7: 1, H8: 1 });
  const rows = Object.fromEntries(out.debug.sources.map((s) => [s.name, s]));
  assert.deepEqual(rows.UPI, {
    name: 'UPI', enabled: true, stale: null, ok: true, status: 200, error: null, items: 9, kept: 6, shown: 4, old: 1, filtered: 0, listicle: 0, held: 2, dull: 0,
    labels: { 'Odd News': 2 },
  });
  assert.deepEqual(rows['Live Science'], {
    name: 'Live Science', enabled: true, stale: null, ok: true, status: 200, error: null, items: 4, kept: 2, shown: 2, old: 0, filtered: 1, listicle: 0, held: 1, dull: 0,
    labels: { 'Strange news': 2, Space: 1, Animals: 1 },
  });
  assert.equal(rows['Smithsonian Magazine'].dull, 1);
  assert.equal(rows['Atlas Obscura'].dull, 2);
  assert.equal(rows['Oddity Central'].stale, '2026-11-16');
  assert.equal(rows.NDTV.enabled, false);
  // Each item carries its weirdness score, in debug only.
  assert.ok(out.items.every((x) => Number.isInteger(x.weirdness)));
  assert.equal(rows['Sky News'].status, 503);
  assert.equal(rows['Sky News'].error, 'http');
  assert.equal(rows.SoraNews24.error, 'timeout');
  assert.equal(rows['Mental Floss'].error, 'not a feed');
  assert.equal(rows.NDTV.error, 'http');
  assert.deepEqual(out.debug.picks, { listed: 13, fromDb: 0, shown: 11, expired: 0, held: 2, invalid: 0 });
  // No held headline or address leaks into the debug answer.
  const json = JSON.stringify(out);
  for (const gone of ['arrested', 'Teen charged', 'Mummified', 'tapeworm', 'goes viral', 'cowgirl', 'parakeet']) assert.ok(!json.includes(gone), gone);
  // Without debug, none of it.
  const plain = await weirdFor(get({}), OPTS);
  assert.equal(plain.held, undefined);
  assert.equal(plain.debug, undefined);
  assert.ok(plain.items.every((x) => !('weirdness' in x)));
  // A disabled source is not listed for visitors.
  assert.ok(!plain.sources.some((s) => s.name === 'NDTV'));
});

test('limit and category narrow the answer; counts follow the returned set', async () => {
  const two = await weirdFor(get({ limit: '2' }), OPTS);
  assert.equal(two.items.length, 2);
  assert.ok(two.items.every((x) => x.pick));
  assert.equal(Object.values(two.categories).reduce((a, b) => a + b, 0), 2);
  const laws = await weirdFor(get({ category: 'laws' }), OPTS);
  assert.deepEqual(laws.items.map((x) => x.title), ['Town council bans garden gnomes from front lawns']);
  assert.deepEqual(laws.categories, { people: 0, animals: 0, laws: 1, records: 0, unexplained: 0, weather: 0, other: 0 });
  const records = await weirdFor(get({ category: 'records' }), OPTS);
  assert.equal(records.items[0].pick, true); // picks first within a category too
  assert.ok(records.items.every((x) => x.category === 'records'));
});

test('a feed answering many stories is capped per outlet; picks are exempt', async () => {
  const many = Array.from({ length: 14 }, (_, i) => `<item><title>Fixture oddity number ${i} about item ${'abcdefghijklmn'[i]} unique words ${i * 7}</title><link>https://www.atlasobscura.com/articles/fixture-${i}</link><pubDate>${new Date(now - (i + 1) * 3600e3).toUTCString()}</pubDate></item>`).join('');
  const sources = [normaliseSource({ id: 'a', name: 'Atlas Obscura', home: 'https://www.atlasobscura.com/', feed: 'https://www.atlasobscura.com/feeds/articles', images: false })];
  const feed = async () => ({ ok: true, status: 200, text: async () => `<rss><channel>${many}</channel></rss>` });
  const r = await loadRound({ fetchImpl: feed, now, sources, picks: [], dbPicks: [] });
  assert.equal(r.pool.length, weird.LIMITS.perOutlet);
  const capped = await loadRound({ fetchImpl: feed, now, sources: [{ ...sources[0], cap: 3 }], picks: [], dbPicks: [] });
  assert.equal(capped.pool.length, 3);
  assert.equal(capped.report[0].shown, 3);
  const review = await loadRound({ fetchImpl: feed, now, sources: [{ ...sources[0], review: true }], picks: [], dbPicks: [] });
  assert.equal(review.pool.length, weird.LIMITS.perReviewOutlet);
  const off = await loadRound({ fetchImpl: feed, now, sources: [{ ...sources[0], enabled: false }], picks: [], dbPicks: [] });
  assert.equal(off.pool.length, 0);
  assert.equal(off.report[0].items, 14); // read for debug, never used
  assert.equal(off.anyOk, false);
});

test('picks stop showing after 21 days; with every feed down and no picks the endpoint fails (502)', async () => {
  const later = Date.UTC(2026, 11, 10, 12); // 10 Dec 2026: every seeded pick is more than 21 days old
  const { items, stats } = pickItems(pickFile.picks, weird.SOURCES, later, {});
  assert.equal(items.length, 0);
  assert.equal(stats.expired, 13);
  const down = async () => { throw new Error('refused'); };
  await assert.rejects(weirdFor(get({}), { fetchImpl: down, lookupImpl, now: later, dbPicks: [] }), /all feeds failed/);
  // Feeds down but picks still fresh: the picks are served.
  const out = await weirdFor(get({}), { fetchImpl: down, lookupImpl, now, dbPicks: [] });
  assert.equal(out.items.length, 11);
  assert.ok(out.sources.every((s) => !s.ok));
});

test('a pick the owner has reviewed (seeded: false) skips hold rules but never the drop rules', () => {
  const base = { outlet: 'UPI', published: '2026-11-13', category: 'animals', rating: 4, note: 'A good one.' };
  const held = {};
  const { items } = pickItems([
    { ...base, url: 'https://www.upi.com/Odd_News/2026/11/13/a/1/', title: 'Sheep on the lam for 45 days roped by 13-year-old cowgirl', seeded: false },
    { ...base, url: 'https://www.upi.com/Odd_News/2026/11/13/b/2/', title: 'Sheep on the lam for 45 days roped by 13-year-old cowgirl again', seeded: true },
    { ...base, url: 'https://www.upi.com/Odd_News/2026/11/13/c/3/', title: 'Nude beach hosts sheep show', seeded: false },
    { ...base, url: 'http://www.upi.com/insecure', title: 'Insecure link', seeded: false },
    { ...base, url: 'https://www.upi.com/Odd_News/2026/11/13/d/4/', title: 'Rated too high', seeded: false, rating: 9, note: '   ' },
  ], weird.SOURCES, now, held);
  assert.deepEqual(items.map((x) => x.title), ['Sheep on the lam for 45 days roped by 13-year-old cowgirl', 'Rated too high']);
  assert.equal(items[0].rating, 4);
  assert.equal(items[0].note, 'A good one.');
  assert.equal(items[1].rating, null);
  assert.equal(items[1].note, null);
  assert.equal(items[0].published, Date.UTC(2026, 10, 13, 12));
  assert.deepEqual(held, { H5: 1, H9: 1 });
});

test('respond reads og:image only on the outlet\'s own site and only when its switch is on', async () => {
  const sources = [
    normaliseSource({ id: 'on', name: 'On', home: 'https://on.example.com/', feed: 'https://on.example.com/feed', images: true }),
    normaliseSource({ id: 'off', name: 'Off', home: 'https://off.example.com/', feed: 'https://off.example.com/feed', images: false }),
  ];
  const titles = { 'on.example.com': ['Parade of tiny hats for ducks', 'Giant teapot festival returns'], 'off.example.com': ['Snail race draws record crowd', 'Museum of broken toasters opens'] };
  const feed = (host) => `<rss><channel><item><title>${titles[host][0]}</title><link>https://${host}/story</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate><media:thumbnail url="https://${host}/thumb.jpg"/></item>
    <item><title>${titles[host][1]}</title><link>https://elsewhere.example.net/${host}</link><pubDate>${new Date(now - 7200e3).toUTCString()}</pubDate></item></channel></rss>`;
  const read = [];
  const fi = async (url) => {
    if (url.endsWith('/feed')) return { ok: true, status: 200, text: async () => feed(new URL(url).hostname) };
    read.push(url);
    return { ok: true, status: 200, headers: headers('text/html'), text: async () => '<head><meta property="og:image" content="https://cdn.example.com/og.jpg"></head>' };
  };
  const r = await loadRound({ fetchImpl: fi, now, sources, picks: [], dbPicks: [] });
  const out = await respond(r, parseQuery(get({})), { fetchImpl: fi, lookupImpl, pageCache: false });
  const img = Object.fromEntries(out.items.map((x) => [x.url, x.image]));
  assert.equal(img['https://on.example.com/story'], 'https://on.example.com/thumb.jpg');
  assert.equal(img['https://off.example.com/story'], null);
  assert.equal(img['https://elsewhere.example.net/on.example.com'], null); // another site: never read
  assert.equal(img['https://elsewhere.example.net/off.example.com'], null);
  assert.deepEqual(read, []);
});

test('data/weird-sources.json: https feeds, unique ids, checked notes, no non-commercial feeds, review outlets without pictures', () => {
  const ids = new Set();
  assert.equal(sourceFile.checked, '2026-11-16');
  for (const s of sourceFile.sources) {
    assert.ok(s.id && !ids.has(s.id), s.id);
    ids.add(s.id);
    assert.ok(s.name && /^https:\/\//.test(s.home) && /^https:\/\//.test(s.feed), s.id);
    assert.equal(typeof s.images, 'boolean', s.id);
    assert.equal(typeof s.licence, 'string', s.id);
    assert.equal(typeof s.checked, 'string', s.id);
    assert.ok(Number.isFinite(s.minWeirdness) && s.minWeirdness >= 0, s.id);
    if (s.id !== 'upi-odd') assert.ok(s.minWeirdness >= 1, s.id); // only the odd-news desk runs ungated
    if (s.cap !== undefined) assert.ok(Number.isInteger(s.cap) && s.cap > 0, s.id);
    assert.equal(typeof s.categoryHints, 'object', s.id);
    for (const v of Object.values(s.categoryHints)) assert.ok(CATEGORIES.includes(v), `${s.id} ${v}`);
    if (s.review) assert.equal(s.images, false, s.id);
    assert.ok(!/guardian|npr\.org/i.test(s.feed + s.home), s.id);
  }
  assert.deepEqual(sourceFile.sources.filter((s) => s.review).map((s) => s.id), ['odditycentral', 'ndtv-offbeat']);
  const byId = Object.fromEntries(sourceFile.sources.map((s) => [s.id, s]));
  assert.ok(byId.livescience.filter);
  assert.deepEqual(['mentalfloss', 'smithsonian-smartnews', 'livescience', 'soranews24'].map((id) => byId[id].cap), [3, 3, 3, 2]);
  assert.equal(byId['ndtv-offbeat'].enabled, false);
  assert.equal(byId['sky-offbeat'].stale, '2026-11-16');
  assert.equal(byId.odditycentral.stale, '2026-11-16');
});

test('data/weird-picks.json: real UPI stories, ratings and notes left to the owner, all marked seeded', () => {
  assert.equal(pickFile.maxAgeDays, 21);
  assert.equal(pickFile.picks.length, 13);
  for (const p of pickFile.picks) {
    assert.match(p.url, /^https:\/\/www\.upi\.com\//);
    assert.equal(p.outlet, 'UPI');
    assert.match(p.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(CATEGORIES.includes(p.category), p.title);
    assert.equal(p.rating, null);
    assert.equal(p.note, null);
    assert.equal(p.seeded, true);
    assert.ok(typeof p.title === 'string' && p.title.length > 10);
  }
});

test('api/weird.js answers 200 with the cache header, or 502', async () => {
  const handler = require('../api/weird.js');
  const res = () => {
    const r = { headers: {}, code: 0, body: null };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  const orig = weird.weirdFor;
  try {
    weird.weirdFor = async () => ({ items: [], categories: {}, checkedAt: 'x', sources: [] });
    const ok = res();
    await handler({ url: '/api/weird?limit=5' }, ok);
    assert.equal(ok.code, 200);
    assert.equal(ok.headers['Cache-Control'], 'public, s-maxage=900, stale-while-revalidate=3600');
    weird.weirdFor = async () => { throw new Error('all feeds failed'); };
    const bad = res();
    await handler({ url: '/api/weird' }, bad);
    assert.equal(bad.code, 502);
    assert.deepEqual(bad.body, { error: 'upstream unavailable' });
  } finally { weird.weirdFor = orig; }
});

test('weirdness: a deterministic score from the headline, address and feed labels', () => {
  const { weirdness } = weird;
  const s = (title, extra = {}) => weirdness({ title, ...extra });
  assert.equal(s('Hera spacecraft snaps photos of Mars moon'), 0);
  assert.equal(s('Altdorfer landscape painting returns to museum'), 0);
  assert.equal(s('Scientists discover new protein in plant roots'), 0);
  assert.equal(s('In 2026, the town held its 100th parade'), 0); // a year is not an unusual number
  assert.equal(s('Fox interrupts professional soccer game in Turkey'), 4); // animal loose + animal at a human place
  assert.equal(s('3,000 tarantulas found in suitcase at airport'), 4); // number of animals + animal at a human place
  assert.equal(s('Archaeologists find 8,000 frog bones in ancient pit'), 2);
  assert.equal(s('A Mysterious Stone Circle Puzzles Archaeologists in Scotland'), 2);
  assert.equal(s("Hundreds gather to attempt to 'move The Bean' in Chicago"), 1); // a quoted phrase
  assert.equal(s("British town crier is the world's loudest woman"), 2); // a record
  assert.equal(s('Ramen shop opens'), 0);
  assert.equal(s('Ramen shop opens', { categories: ['Weird'] }), 1); // the outlet's own label
  assert.equal(s('Ramen shop opens', { url: 'https://example.com/strange-news/ramen' }), 1); // the outlet's section in the address
  assert.equal(s('Ramen shop opens', { url: 'https://example.com/strange-news/ramen', categories: ['Weird'] }), 1); // counted once
  // Same input, same score.
  assert.equal(s('Escaped piglets detained for \'fleeing and squealing\' in S.C.'), s('Escaped piglets detained for \'fleeing and squealing\' in S.C.'));
});

test('isListicle: evergreen lists, quizzes and explainers', () => {
  for (const t of ["10 Old-Fashioned Words for Someone Who's Single", "Quiz: Can You Name Ohio's 7 Largest Cities?", '50 Funny Puns About Cheese',
    '4 American Mountain Towns to Visit', 'The Most Popular Fast-Food Chain the Year You Were Born', 'Why Do We Call It a Hat Trick?',
    'Things You Never Knew About Lighthouses']) assert.ok(weird.isListicle(t), t);
  for (const t of ['3,000 tarantulas found in suitcase at airport', 'Fox interrupts professional soccer game in Turkey',
    'Giant pumpkin weighing 2,000 pounds sets state record']) assert.ok(!weird.isListicle(t), t);
});

test('a general outlet: listicles and stories with no weirdness signal do not run; strangest first within a day', async () => {
  const day = (h) => new Date(Date.UTC(2026, 10, 16, h)).toUTCString();
  const items = [
    ['10 Old-Fashioned Words for Someone Who\'s Single', 15], ['Hera spacecraft snaps photos of Mars moon', 14],
    ['Goat wanders into grocery store and eats lettuce', 13], ['Mysterious hum puzzles town', 16], ['Quiz: Name these rivers', 12],
  ].map(([t, h], i) => `<item><title>${t}</title><link>https://www.mentalfloss.com/posts/x${i}</link><pubDate>${day(h)}</pubDate></item>`).join('');
  const sources = [normaliseSource({ id: 'mf', name: 'Mental Floss', home: 'https://www.mentalfloss.com/', feed: 'https://www.mentalfloss.com/feed', images: false, minWeirdness: 2, cap: 3, listicles: false })];
  const r = await loadRound({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => `<rss><channel>${items}</channel></rss>` }), now: Date.UTC(2026, 10, 16, 20), sources, picks: [], dbPicks: [] });
  // The goat (4) beats the hum (2) on the same day although the hum is newer.
  assert.deepEqual(r.pool.map((x) => x.title), ['Goat wanders into grocery store and eats lettuce', 'Mysterious hum puzzles town']);
  assert.deepEqual([r.report[0].listicle, r.report[0].dull, r.report[0].kept], [2, 1, 2]);
});

test('database picks: reviewer-approved, merged with the file, the database wins on the same address; failure is harmless', async () => {
  const filePick = pickFile.picks.find((p) => p.title.startsWith('Sheep on the lam'));
  const merged = weird.mergePicks(pickFile.picks, [
    { url: filePick.url + '?utm_source=x', title: filePick.title, outlet: 'UPI', published: filePick.published, category: 'animals', rating: 5, note: 'Owner approved.' },
  ]);
  assert.equal(merged.length, 13);
  assert.equal(merged[0].seeded, false);
  // The database's copy of the sheep pick was approved by a reviewer: the children hold rule defers to that.
  const { items } = pickItems(merged, weird.SOURCES, now, {});
  const sheep = items.find((x) => x.title.startsWith('Sheep on the lam'));
  assert.equal(sheep.rating, 5);
  assert.equal(sheep.note, 'Owner approved.');
  assert.equal(sheep.url, filePick.url);

  // Wired through loadDbPicks: the Supabase REST endpoint with the publishable key, read through fetchImpl.
  const seen = [];
  const fi = async (url, opts) => {
    if (url.includes('/rest/v1/weird_picks')) {
      seen.push(opts.headers.apikey);
      return { ok: true, status: 200, json: async () => [{ url: 'https://www.upi.com/Odd_News/2026/11/14/db-pick/9/', title: 'Llama elected honorary mayor of mountain town', outlet: 'UPI', published: '2026-11-14', category: 'people', rating: 4, note: 'A reviewer pick.' }] };
    }
    throw new Error('offline');
  };
  const out = await weirdFor(get({ debug: '1' }), { fetchImpl: fi, lookupImpl, now, dbPicks: undefined });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^sb_publishable_/);
  const db = out.items.find((x) => x.title.startsWith('Llama elected'));
  assert.equal(db.pick, true);
  assert.equal(db.rating, 4);
  assert.equal(out.debug.picks.fromDb, 1);
  // The table missing (404) or the database down: the file's picks still show.
  const missing = await weirdFor(get({}), { fetchImpl: async (url) => (url.includes('/rest/v1/') ? { ok: false, status: 404, json: async () => ({}) } : Promise.reject(new Error('offline'))), lookupImpl, now, dbPicks: undefined });
  assert.equal(missing.items.length, 11);
});

test('cleanUrl removes tracking parameters only', () => {
  assert.equal(weird.cleanUrl('https://www.upi.com/a/?utm_source=rss&id=3&fbclid=x&gclid=y&mc_cid=z'), 'https://www.upi.com/a/?id=3');
  assert.equal(weird.cleanUrl('https://www.upi.com/a/'), 'https://www.upi.com/a/');
  assert.equal(weird.cleanUrl('not a url'), 'not a url');
});
