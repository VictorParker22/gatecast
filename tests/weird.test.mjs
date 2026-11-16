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
const OPTS = { fetchImpl, lookupImpl, now, pageCache: false };
const get = (params) => new URLSearchParams(params);

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

  // Then the regular outlets, newest first, then the review outlet, at most 3, without pictures.
  const rest = out.items.slice(11);
  assert.deepEqual(rest.map((x) => x.title), [
    'Strange lights over the desert baffle airline pilots',
    'Bear raids kitchen cabinets in Tennessee cabin',
    "Octopus seen 'punching' fish that crowd its hunting spot",
    'This Tiny Cicada Is the Noisiest Insect Ever Measured',
    'The Seaside Town That Throws a Festival for Its Fog',
    'Giant pumpkin weighing 2,000 pounds sets state record',
    'A Mysterious Stone Circle Puzzles Archaeologists in Scotland',
    'Inside a Library of Lost Umbrellas',
    'Lottery player wins $100,000 with fortune cookie numbers', // the newer copy of a repeated address
    'Town council bans garden gnomes from front lawns',
    'Village builds a museum for one very old radio',
    'Restaurant serves soup in a hollowed-out loaf the size of a car tyre',
    'Farmer grows pumpkin shaped like a teapot',
  ]);
  assert.ok(rest.slice(-3).every((x) => x.outlet === 'Oddity Central' && x.image === null));
  assert.ok(!pagesRead.some((u) => u.includes('odditycentral')));

  // Held or dropped: arrests, a child with a crime, a mummy, a tapeworm, a named private person gone viral. Filtered:
  // Live Science's space story. Too old: the October story. Repeated: the same address with tracking parameters.
  for (const gone of ['arrested', 'Teen charged', 'Mummified', 'tapeworm', 'goes viral', 'exoplanet', 'Old story', 'numbers from fortune cookie']) {
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
  assert.equal(by('This Tiny Cicada').category, 'animals');
  assert.equal(by('A Mysterious Stone').category, 'unexplained');
  assert.equal(by('Strange lights').category, 'unexplained');
  assert.equal(by('The Seaside Town').category, 'weather');
  assert.equal(by('Town council bans').category, 'laws');
  assert.equal(by('Inside a Library').category, 'other');
  assert.equal(by('The Seaside Town').image, 'https://img.atlasobscura.com/fixture/fog.jpg');
  assert.equal(by('Calif. coast').category, 'weather');

  // Category counts are for the returned set.
  assert.deepEqual(Object.keys(out.categories), ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other']);
  assert.equal(Object.values(out.categories).reduce((a, b) => a + b, 0), out.items.length);
  assert.equal(out.categories.animals, out.items.filter((x) => x.category === 'animals').length);

  // Every source is listed with ok and how many of its items are in the answer.
  const src = Object.fromEntries(out.sources.map((s) => [s.name, s]));
  assert.equal(out.sources.length, sourceFile.sources.length);
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
  assert.deepEqual(rows.UPI, { name: 'UPI', ok: true, status: 200, error: null, items: 9, kept: 6, filtered: 0, old: 1, held: 2 });
  assert.deepEqual(rows['Live Science'], { name: 'Live Science', ok: true, status: 200, error: null, items: 4, kept: 2, filtered: 1, old: 0, held: 1 });
  assert.equal(rows['Sky News'].status, 503);
  assert.equal(rows['Sky News'].error, 'http');
  assert.equal(rows.SoraNews24.error, 'timeout');
  assert.equal(rows['Mental Floss'].error, 'not a feed');
  assert.equal(rows.NDTV.error, 'http');
  assert.deepEqual(out.debug.picks, { listed: 13, shown: 11, expired: 0, held: 2, invalid: 0 });
  // No held headline or address leaks into the debug answer.
  const json = JSON.stringify(out);
  for (const gone of ['arrested', 'Teen charged', 'Mummified', 'tapeworm', 'goes viral', 'cowgirl', 'parakeet']) assert.ok(!json.includes(gone), gone);
  // Without debug, none of it.
  const plain = await weirdFor(get({}), OPTS);
  assert.equal(plain.held, undefined);
  assert.equal(plain.debug, undefined);
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
  const r = await loadRound({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => `<rss><channel>${many}</channel></rss>` }), now, sources, picks: [] });
  assert.equal(r.pool.length, weird.LIMITS.perOutlet);
});

test('picks stop showing after 21 days; with every feed down and no picks the endpoint fails (502)', async () => {
  const later = Date.UTC(2026, 11, 10, 12); // 10 Dec 2026: every seeded pick is more than 21 days old
  const { items, stats } = pickItems(pickFile.picks, weird.SOURCES, later, {});
  assert.equal(items.length, 0);
  assert.equal(stats.expired, 13);
  const down = async () => { throw new Error('refused'); };
  await assert.rejects(weirdFor(get({}), { fetchImpl: down, lookupImpl, now: later }), /all feeds failed/);
  // Feeds down but picks still fresh: the picks are served.
  const out = await weirdFor(get({}), { fetchImpl: down, lookupImpl, now });
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
  const r = await loadRound({ fetchImpl: fi, now, sources, picks: [] });
  const out = await respond(r, parseQuery(get({})), { fetchImpl: fi, lookupImpl, pageCache: false });
  const img = Object.fromEntries(out.items.map((x) => [x.url, x.image]));
  assert.equal(img['https://on.example.com/story'], 'https://on.example.com/thumb.jpg');
  assert.equal(img['https://off.example.com/story'], null);
  assert.equal(img['https://elsewhere.example.net/on.example.com'], null); // another site: never read
  assert.equal(img['https://elsewhere.example.net/off.example.com'], null);
  assert.deepEqual(read, []);
});

test('data/weird-sources.json: https feeds, unique ids, unverified, no non-commercial feeds, review outlets without pictures', () => {
  const ids = new Set();
  assert.equal(sourceFile.checked, null);
  for (const s of sourceFile.sources) {
    assert.ok(s.id && !ids.has(s.id), s.id);
    ids.add(s.id);
    assert.ok(s.name && /^https:\/\//.test(s.home) && /^https:\/\//.test(s.feed), s.id);
    assert.equal(typeof s.images, 'boolean', s.id);
    assert.equal(typeof s.licence, 'string', s.id);
    assert.equal(s.checked, null, s.id);
    assert.equal(typeof s.categoryHints, 'object', s.id);
    for (const v of Object.values(s.categoryHints)) assert.ok(CATEGORIES.includes(v), `${s.id} ${v}`);
    if (s.review) assert.equal(s.images, false, s.id);
    assert.ok(!/guardian|npr\.org/i.test(s.feed + s.home), s.id);
  }
  assert.deepEqual(sourceFile.sources.filter((s) => s.review).map((s) => s.id), ['odditycentral', 'ndtv-offbeat']);
  for (const id of ['livescience', 'soranews24']) assert.ok(sourceFile.sources.find((s) => s.id === id).filter, id);
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
