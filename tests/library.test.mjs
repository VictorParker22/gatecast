import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  BOOKSHOP_AFFILIATE, fold, surname, authorLine, matches, filterView, statusText, pickRandom, hashId, spineStyle, SPINE_PALETTE,
  shelfRows, balancedRows, bookBox, flightStart, BOOK_ASPECT, parseHash, buildHash, stampCard, stampDate, worldcatUrl, bookshopUrl,
  openLibraryUrl, coverUrl, validate,
} from '../js/librarymodel.js';

const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(new URL('../data/books.json', import.meta.url), 'utf8'));
const books = require('../lib/books.js');
const byId = (id) => data.books.find((b) => b.id === id);

/* ---------- The data ---------- */

test('books.json is valid: ids, shelves, years, one-or-two-sentence descriptions, tags', () => {
  assert.deepEqual(validate(data), []);
  assert.deepEqual(data.shelves.map((s) => s.id), ['crime', 'serial', 'unsolved', 'history', 'science', 'cults']);
  for (const s of data.shelves) {
    const n = data.books.filter((b) => b.shelf === s.id).length;
    assert.ok(n >= 6 && n <= 10, `${s.id} has ${n} books`);
  }
});

test('every book on the approved board is on its board shelf', () => {
  const board = {
    crime: ['in-cold-blood', 'the-executioners-song', 'midnight-in-the-garden-of-good-and-evil', 'the-devil-in-the-white-city', 'killers-of-the-flower-moon', 'the-suspicions-of-mr-whicher'],
    serial: ['the-stranger-beside-me', 'whoever-fights-monsters', 'mindhunter', 'the-good-nurse', 'ill-be-gone-in-the-dark'],
    unsolved: ['zodiac', 'the-mothman-prophecies', 'the-monster-of-florence', 'the-lost-city-of-z', 'dead-mountain'],
    history: ['extraordinary-popular-delusions', 'a-night-to-remember', 'the-professor-and-the-madman', 'the-ghost-map', 'dead-wake'],
    science: ['the-man-who-mistook-his-wife-for-a-hat', 'stiff', 'spook', 'the-poisoners-handbook', 'the-disappearing-spoon', 'the-immortal-life-of-henrietta-lacks'],
    cults: ['the-big-con', 'helter-skelter', 'under-the-banner-of-heaven', 'going-clear', 'the-confidence-game', 'bad-blood'],
  };
  let n = 0;
  for (const [shelf, ids] of Object.entries(board)) for (const id of ids) { assert.equal(byId(id)?.shelf, shelf, id); n++; }
  assert.equal(n, 33);
});

test('flagged books carry their caveat; nothing claims verified IDs, page counts or affiliate links', () => {
  for (const id of ['in-cold-blood', 'midnight-in-the-garden-of-good-and-evil', 'catch-me-if-you-can', 'the-man-who-mistook-his-wife-for-a-hat',
    'zodiac', 'say-nothing', 'the-monster-of-florence', 'the-devil-in-the-white-city']) assert.ok(byId(id).caveat, id);
  assert.match(byId('catch-me-if-you-can').caveat, /Logan.*2020/);
  assert.match(byId('the-man-who-mistook-his-wife-for-a-hat').caveat, /December 2025 New Yorker/);
  assert.match(byId('the-devil-in-the-white-city').caveat, /victim/);
  for (const b of data.books) {
    assert.equal(b.olVerified, false, b.id);
    assert.ok(!('pages' in b) && !('numberOfPages' in b), b.id);
    if (b.olWork) assert.match(b.olWork, /^OL\d+W$/);
    if (b.olEdition) assert.match(b.olEdition, /^OL\d+M$/);
    assert.ok(!/bookshop\.org\/a\//.test(JSON.stringify(b)));
  }
  assert.equal(BOOKSHOP_AFFILIATE, null);
});

test('true-crime shelves frame victims and investigations: violent books have a content note', () => {
  for (const b of data.books.filter((x) => x.shelf === 'crime' || x.shelf === 'serial')) assert.ok(b.contentNote, b.id);
});

/* ---------- Search ---------- */

test('search matches title, author, topic and year, ignoring case, accents and apostrophes', () => {
  const hits = (q) => data.books.filter((b) => matches(b, q)).map((b) => b.id);
  assert.ok(hits('Kansas').includes('in-cold-blood'));
  assert.ok(hits('fbi').includes('mindhunter'));
  assert.ok(hits('cholera').includes('the-ghost-map'));
  assert.deepEqual(hits('1959 kansas'), ['in-cold-blood']);
  assert.deepEqual(hits('fordlandia'), ['fordlandia']);
  assert.ok(hits('ill be gone').includes('ill-be-gone-in-the-dark'));
  assert.ok(hits('roach').includes('stiff') && hits('roach').includes('gulp'));
  assert.equal(hits('').length, data.books.length);
  assert.deepEqual(hits('zzzz'), []);
  assert.equal(fold('Fordlândia — I’ll'), 'fordlandia ill');
});

test('filterView: shelf choice hides bays, query dims non-matches, status words', () => {
  const all = filterView(data, {});
  assert.equal(all.bays.length, 6);
  assert.equal(all.shown, data.books.length);
  assert.equal(statusText(all), `${data.books.length} books on 6 shelves`);
  const one = filterView(data, { shelf: 'unsolved', query: 'ciphers' });
  assert.equal(one.bays.length, 1);
  assert.equal(one.matched, 1);
  assert.equal(statusText(one), '1 book matches “ciphers”. The rest are dimmed.');
  const none = filterView(data, { query: 'qwerty' });
  assert.equal(statusText(none, { motion: false }), 'Nothing matches “qwerty”. Try an author, a place or a year. · Motion is off, so books open as a flat card.');
});

test('pickRandom and author helpers', () => {
  assert.equal(pickRandom([], () => 0.5), null);
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0.999999), 'c');
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(surname('John E. Douglas'), 'Douglas');
  assert.equal(authorLine(['A']), 'A');
  assert.equal(authorLine(['A', 'B']), 'A and B');
  assert.equal(authorLine(['A', 'B', 'C']), 'A, B and C');
});

/* ---------- Spines ---------- */

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
};

test('spine palette: every pair passes 4.5:1, and no red, orange or teal (risk hues)', () => {
  for (const [bg, fg] of SPINE_PALETTE) {
    assert.ok(contrast(bg, fg) >= 4.5, `${bg}/${fg} ${contrast(bg, fg).toFixed(2)}`);
    const { h, s } = hsl(bg);
    assert.ok(!(s > 0.5 && (h < 40 || h >= 340)), `${bg} reads as red/orange`);
    assert.ok(!(s > 0.3 && h >= 160 && h <= 200), `${bg} reads as teal`);
  }
});

test('spine look is derived from the book id: stable, independent of order, whole pixels, board ranges', () => {
  const a = spineStyle(byId('zodiac'));
  assert.deepEqual(spineStyle({ ...byId('zodiac') }), a);
  assert.equal(hashId('zodiac'), hashId('zodiac'));
  assert.notEqual(hashId('zodiac'), hashId('zodiac2'));
  const looks = new Set();
  for (const b of data.books) {
    const s = spineStyle(b);
    assert.ok(Number.isInteger(s.width) && Number.isInteger(s.height));
    assert.ok(s.height >= 206 && s.height <= 257, b.id);
    assert.ok(s.width >= 30 && s.width <= 52, b.id);
    if (b.title.length > 24) assert.equal(s.kind, 'cond');
    assert.ok(spineStyle(b, { minWidth: 44 }).width >= 44);
    looks.add(s.bg + s.height);
  }
  assert.ok(looks.size > data.books.length * 0.8, 'spines vary');
});

test('shelfRows keeps order, fills greedily and never leaves an empty row', () => {
  assert.deepEqual(shelfRows([40, 40, 40], 200, 3), [[0, 1, 2]]);
  assert.deepEqual(shelfRows([40, 40, 40], 83, 3), [[0, 1], [2]]);
  assert.deepEqual(shelfRows([40, 40, 40], 82, 3), [[0], [1], [2]]);
  assert.deepEqual(shelfRows([300, 20], 100, 3), [[0], [1]]);
  assert.deepEqual(shelfRows([], 100), []);
  assert.deepEqual(balancedRows([40, 40, 40, 40, 40, 40, 40, 40, 40, 40], 300, 3), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  assert.deepEqual(balancedRows([40, 40, 40], 200, 3), [[0, 1, 2]]);
  // An even split that would overflow keeps the greedy rows.
  assert.deepEqual(balancedRows([10, 10, 10, 90], 95, 0), [[0, 1, 2], [3]]);
});

/* ---------- The book in the middle of the screen ---------- */

test('bookBox fits every viewport, keeps the aspect ratio and lands on whole pixels', () => {
  const sizes = [[320, 568], [360, 740], [375, 667], [390, 844], [414, 896], [430, 932], [768, 1024], [834, 1194], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [640, 360]];
  for (const [vw, vh] of sizes) {
    const b = bookBox(vw, vh);
    for (const k of ['W', 'H', 'left', 'top']) assert.ok(Number.isInteger(b[k]), `${vw}x${vh} ${k}`);
    assert.equal(b.W % 2, 0);
    assert.ok(b.W <= 380 && b.W <= vw - 32, `${vw}x${vh} width`);
    assert.ok(b.top >= 24 && b.top + b.H <= vh - 88, `${vw}x${vh} height ${b.top}+${b.H}`);
    assert.ok(Math.abs(b.H / b.W - BOOK_ASPECT) < 0.01);
    assert.ok(Math.abs(b.left * 2 + b.W - vw) <= 1, `${vw} centred`);
  }
  assert.deepEqual(bookBox(1440, 900), { W: 380, H: 559, left: 530, top: 139, cx: 720, cy: 418.5 });
});

test('flightStart scales the box down to the spine on the shelf', () => {
  const box = bookBox(1440, 900);
  const f = flightStart({ left: 100, top: 600, width: 40, height: 230 }, box);
  assert.ok(Math.abs(f.s - 230 / 559) < 1e-9);
  assert.equal(f.depth, Math.round(40 / (230 / 559)));
  assert.equal(f.dx, 120 - 720);
  assert.equal(f.dy, 715 - 418.5);
});

/* ---------- Hash, card, links ---------- */

test('hash state: shareable shelf and book, unknown values ignored', () => {
  assert.deepEqual(parseHash('#shelf=unsolved&book=zodiac', data), { shelf: 'unsolved', book: 'zodiac' });
  assert.deepEqual(parseHash('#book=zodiac', data), { shelf: 'all', book: 'zodiac' });
  assert.deepEqual(parseHash('#shelf=nope&book=<script>', data), { shelf: 'all', book: null });
  assert.equal(buildHash({ shelf: 'unsolved' }), '#shelf=unsolved');
  assert.equal(buildHash({ shelf: 'all', book: 'zodiac' }), '#book=zodiac');
  assert.equal(buildHash({}), '');
});

test('library card stamps newest first, without duplicates, at most five', () => {
  let card = [];
  for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) card = stampCard(card, id, 1);
  assert.deepEqual(card.map((c) => c.id), ['f', 'e', 'd', 'a', 'c']);
  assert.deepEqual(stampCard('junk', 'x', 5), [{ id: 'x', at: 5 }]);
  assert.equal(stampDate(Date.UTC(2026, 10, 16, 12), 'UTC'), '16 NOV');
});

test('links: WorldCat and Bookshop searches, no affiliate until one is set, Open Library only when confirmed', () => {
  const b = byId('in-cold-blood');
  assert.equal(worldcatUrl(b), 'https://search.worldcat.org/search?q=In%20Cold%20Blood%20Truman%20Capote');
  assert.equal(bookshopUrl(b), 'https://bookshop.org/search?keywords=In%20Cold%20Blood%20Truman%20Capote');
  assert.equal(bookshopUrl(b, 'shop1'), 'https://bookshop.org/search?keywords=In%20Cold%20Blood%20Truman%20Capote&a_aid=shop1');
  assert.equal(bookshopUrl(byId('the-devil-in-the-white-city'), 'shop1'), 'https://bookshop.org/a/shop1/9780375725609');
  assert.equal(openLibraryUrl(b, null), 'https://openlibrary.org/search?q=In%20Cold%20Blood&author=Truman%20Capote');
  assert.equal(openLibraryUrl(b, { coverId: 1, olKey: '/works/OL1992198W' }), 'https://openlibrary.org/works/OL1992198W');
  assert.equal(openLibraryUrl(b, { olKey: 'javascript:alert(1)' }), 'https://openlibrary.org/search?q=In%20Cold%20Blood&author=Truman%20Capote');
  assert.equal(coverUrl({ coverId: 12345 }), 'https://covers.openlibrary.org/b/id/12345-M.jpg');
  assert.equal(coverUrl({ coverId: '12' }), null);
  assert.equal(coverUrl(null), null);
});

/* ---------- /api/book-covers (lib/books.js), with fixture responses in Open Library's search.json shape ---------- */

// Hand-made in the shape search.json returns for `fields=key,title,author_name,cover_i,first_publish_year,edition_count`
// (openlibrary.org is unreachable from the build sandbox, so these are not live recordings).
const FIXTURES = {
  'In Cold Blood': { numFound: 2, start: 0, docs: [
    { key: '/works/OL99999W', title: 'In Cold Blood (Study Guide)', author_name: ['SparkNotes'], cover_i: 1, first_publish_year: 2003, edition_count: 1 },
    { key: '/works/OL1992198W', title: 'In Cold Blood', author_name: ['Truman Capote'], cover_i: 8231432, first_publish_year: 1965, edition_count: 212 },
  ] },
  'Homicide: A Year on the Killing Streets': { numFound: 1, start: 0, docs: [
    { key: '/works/OL2157541W', title: 'Homicide', author_name: ['David Simon'], cover_i: 6543210, first_publish_year: 1991, edition_count: 21 },
  ] },
  Zodiac: { numFound: 3, start: 0, docs: [
    { key: '/works/OL1W', title: 'Zodiac', author_name: ['Neal Stephenson'], cover_i: 42, first_publish_year: 1988, edition_count: 30 },
    { key: '/works/OL2W', title: 'Zodiac Unmasked', author_name: ['Robert Graysmith'], cover_i: 43, first_publish_year: 2002, edition_count: 5 },
  ] },
  'Fordlândia': { numFound: 1, start: 0, docs: [
    { key: '/works/OL5W', title: 'Fordlandia: The Rise and Fall of Henry Ford’s Forgotten Jungle City', author_name: ['Greg Grandin'], first_publish_year: 2009, edition_count: 9 },
  ] },
};
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fakeClock() {
  let t = Date.UTC(2026, 10, 16, 12);
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

test('pickMatch accepts only a matching title and author surname', () => {
  const book = byId('in-cold-blood');
  assert.deepEqual(books.pickMatch(book, FIXTURES['In Cold Blood'].docs), { coverId: 8231432, olKey: '/works/OL1992198W', year: 1965 });
  assert.equal(books.pickMatch(byId('zodiac'), FIXTURES.Zodiac.docs), null, 'Stephenson is the wrong author; Zodiac Unmasked the wrong title');
  assert.deepEqual(books.pickMatch(byId('homicide'), FIXTURES['Homicide: A Year on the Killing Streets'].docs), { coverId: 6543210, olKey: '/works/OL2157541W', year: 1991 });
  assert.deepEqual(books.pickMatch(byId('fordlandia'), FIXTURES['Fordlândia'].docs), { coverId: null, olKey: '/works/OL5W', year: 2009 });
  assert.equal(books.pickMatch(book, [{ key: 'x', title: 'In Cold Blood', author_name: ['Truman Capote'], cover_i: -3 }]).coverId, null);
  assert.equal(books.normTitle('The Bermuda Triangle Mystery—Solved'), books.normTitle('The Bermuda Triangle mystery--solved'));
  assert.equal(books.normTitle('I’ll Be Gone in the Dark'), 'ill be gone in the dark');
});

test('coversFor: one request a second, sequential, identified without an email, then served from cache', async () => {
  books.resetForTests();
  const clock = fakeClock();
  const list = ['in-cold-blood', 'homicide', 'zodiac', 'fordlandia'].map(byId);
  const calls = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async (url, opts) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push({ url: new URL(url), at: clock.now(), ua: opts.headers['User-Agent'] });
    clock.advance(120);
    inFlight--;
    return json(FIXTURES[new URL(url).searchParams.get('title')]);
  };
  const out = await books.coversFor({ fetchImpl, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(calls.length, 4);
  assert.equal(maxInFlight, 1);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 1000, 'at most one request per second');
  for (const c of calls) {
    assert.equal(c.ua, 'Gatecast/1.0 (+https://gatecast.vercel.app)');
    assert.ok(!c.ua.includes('@'));
    assert.equal(c.url.origin + c.url.pathname, 'https://openlibrary.org/search.json');
    assert.equal(c.url.searchParams.get('limit'), '3');
    assert.equal(c.url.searchParams.get('fields'), 'key,title,author_name,cover_i,first_publish_year,edition_count');
  }
  assert.equal(calls[0].url.searchParams.get('author'), 'Truman Capote');
  assert.deepEqual(out.covers, {
    'in-cold-blood': { coverId: 8231432, olKey: '/works/OL1992198W', year: 1965 },
    homicide: { coverId: 6543210, olKey: '/works/OL2157541W', year: 1991 },
    zodiac: null,
    fordlandia: { coverId: null, olKey: '/works/OL5W', year: 2009 },
  });
  assert.equal(out.pending, 0);
  assert.equal(books.cacheControlFor(out), 'public, s-maxage=604800, stale-while-revalidate=86400');
  assert.match(out.checkedAt, /^2026-11-16T12:00:0\d\.\d{3}Z$/);

  const again = await books.coversFor({ fetchImpl, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(calls.length, 4, 'cached: no new requests');
  assert.deepEqual(again.covers, out.covers);

  clock.advance(books.TTL_MS);
  await books.coversFor({ fetchImpl, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(calls.length, 8, 'refreshed after 7 days');
});

test('coversFor: concurrent calls share the queue and never overlap requests', async () => {
  books.resetForTests();
  const clock = fakeClock();
  const list = ['in-cold-blood', 'homicide'].map(byId);
  let inFlight = 0, max = 0, n = 0;
  const fetchImpl = async (url) => { inFlight++; max = Math.max(max, inFlight); n++; await Promise.resolve(); inFlight--; return json(FIXTURES[new URL(url).searchParams.get('title')]); };
  const [a, b] = await Promise.all([1, 2].map(() => books.coversFor({ fetchImpl, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 })));
  assert.equal(max, 1);
  assert.equal(n, 2, 'the second call found both in the cache');
  assert.deepEqual(a.covers, b.covers);
});

test('coversFor: rate-limited or failing upstream stops the run, caches nothing, and is not cached for long', async () => {
  books.resetForTests();
  const clock = fakeClock();
  const list = ['in-cold-blood', 'homicide', 'zodiac'].map(byId);
  let n = 0;
  const out = await books.coversFor({ fetchImpl: async () => { n++; return json({}, 429); }, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(n, 1, 'stops after a 429');
  assert.deepEqual(out.covers, { 'in-cold-blood': null, homicide: null, zodiac: null });
  assert.equal(out.pending, 3);
  assert.equal(books.cacheControlFor(out), 'public, s-maxage=60');
  // A network error also ends the run; the next call carries on from where it stopped.
  let k = 0;
  const flaky = async (url) => { k++; if (k === 1) throw new Error('reset'); return json(FIXTURES[new URL(url).searchParams.get('title')] || { docs: [] }); };
  const out2 = await books.coversFor({ fetchImpl: flaky, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(k, 1);
  assert.equal(out2.pending, 3);
  const out3 = await books.coversFor({ fetchImpl: flaky, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 60000 });
  assert.equal(out3.covers.homicide.coverId, 6543210);
  assert.equal(out3.pending, 0);
});

test('coversFor: the time budget limits how many books one call looks up', async () => {
  books.resetForTests();
  const clock = fakeClock();
  const list = data.books.slice(0, 20);
  let n = 0;
  const out = await books.coversFor({ fetchImpl: async () => { n++; return json({ docs: [] }); }, now: clock.now, sleep: clock.sleep, books: list, budgetMs: 8000 });
  assert.ok(n >= 7 && n <= 9, `looked up ${n}`);
  assert.equal(out.pending, 20 - n);
  books.resetForTests();
});
