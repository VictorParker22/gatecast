// Books put forward for The Stacks and the Book of the Week: the community function's POST /book checks
// (supabase/functions/community/logic.mjs), lib/stacks-db.js and GET /api/books, the reviewer console's Books helpers
// (js/reviewmodel.js), and data/books.json's validate() with an author book. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  toIsbn13, isbn10Ok, isbn13Check, validateBook, shelfInfo, limitReply, route, ROUTE_METHOD, BOOK_LIMITS, BOOK_DUPLICATE, bookHash, tipHash,
} from '../supabase/functions/community/logic.mjs';
import {
  VIEWS, slugify, uniqueSlug, sentences, copiedRun, descriptionChecks, approvalFromSubmission, approveErrors, cleanApproval,
  stacksReplyError, booksRows, pendingCount, mondayOf, thisMonday, currentFeatured, featuredErrors, weekLabel, coverFromEdition,
  openLibraryIsbnUrl, coverImageUrl, COPY_RUN, STACKS_LIMITS,
} from '../js/reviewmodel.js';
import { validate } from '../js/librarymodel.js';

const require = createRequire(import.meta.url);
const stacksDb = require('../lib/stacks-db.js');
const booksApi = require('../api/books.js');
const STATIC = require('../data/books.json');
const { loadStacksExtras, mergeBooks, booksFor, resetCache, toBook, toFeatured, booksEndpoint, featuredEndpoint } = stacksDb;

const NOW = new Date('2026-11-17T12:00:00Z');
const GOOD = {
  title: 'In Cold Blood', authors: 'Truman Capote', isbn: '978-0-679-74558-7', year: 1966, publisher: 'Random House', shelf: 'crime',
  pitch: 'A careful account of a 1959 murder case in Kansas, told through the town and the detectives.', relation: 'author',
  email: 'author@example.org', confirm: true, website: '',
};
const INFO = { shelves: new Set(['crime', 'serial', 'history']), isbns: new Set(['9780140449136']) };

/* ---------- ISBNs ---------- */

test('ISBN-13 and ISBN-10 check digits; ISBN-10 becomes ISBN-13', () => {
  assert.equal(isbn13Check('978067974558'), '7');
  assert.equal(toIsbn13('9780679745587'), '9780679745587');
  assert.equal(toIsbn13('978-0-679-74558-7'), '9780679745587', 'hyphens');
  assert.equal(toIsbn13(' 978 0 679 74558 7 '), '9780679745587', 'spaces');
  assert.equal(toIsbn13('ISBN-13: 978-0-679-74558-7'), '9780679745587', 'a label in front');
  assert.equal(toIsbn13('0679745580'), '9780679745587', 'ISBN-10 converted');
  assert.equal(toIsbn13('0-8044-2957-X'), '9780804429573', 'X check digit');
  assert.equal(toIsbn13('080442957x'), '9780804429573', 'lower-case x');
  assert.equal(toIsbn13('979-10-90636-07-1'), '9791090636071', '979 prefix');
  assert.equal(isbn10Ok('0679745580'), true);
  assert.equal(isbn10Ok('0679745581'), false);
  for (const bad of ['9780679745588', '0679745581', '1234567890123', '97806797455', '978067974558X', 'X679745580', '', 'abc', null, undefined, {}, 9780679745587.5]) {
    assert.equal(toIsbn13(bad), null, String(bad));
  }
  assert.equal(toIsbn13(9780679745587), '9780679745587', 'a number is read as digits');
});

/* ---------- POST /book ---------- */

test('validateBook: a good submission is cleaned into the database shape', () => {
  const v = validateBook(GOOD, { info: INFO, now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.spam, false);
  assert.deepEqual(v.book, {
    title: 'In Cold Blood', authors: 'Truman Capote', isbn13: '9780679745587', year: 1966, publisher: 'Random House', shelf: 'crime',
    pitch: GOOD.pitch, relation: 'author', contact_email: 'author@example.org',
  });
  const min = validateBook({ ...GOOD, publisher: undefined, email: '', isbn: '0679745580', year: '1966', title: '  In   Cold\nBlood ' }, { now: NOW });
  assert.equal(min.ok, true, 'no shelf list: any shelf id of the right shape');
  assert.equal(min.book.publisher, null);
  assert.equal(min.book.contact_email, null);
  assert.equal(min.book.isbn13, '9780679745587');
  assert.equal(min.book.year, 1966, 'a year typed as text');
  assert.equal(min.book.title, 'In Cold Blood', 'spaces collapsed');
});

test('validateBook: lengths, shelf, relation, email, year and the ISBN', () => {
  const msg = (patch, opts = { info: INFO, now: NOW }) => {
    const v = validateBook({ ...GOOD, ...patch }, opts);
    assert.equal(v.ok, false, JSON.stringify(patch).slice(0, 80));
    return v.message;
  };
  assert.match(msg({ title: '' }), /title/);
  assert.match(msg({ title: 'x'.repeat(BOOK_LIMITS.title + 1) }), /200/);
  assert.equal(validateBook({ ...GOOD, title: 'é'.repeat(200) }, { now: NOW }).ok, true, 'counted in characters');
  assert.match(msg({ authors: ' ' }), /author/i);
  assert.match(msg({ authors: 'a'.repeat(201) }), /200/);
  assert.match(msg({ isbn: '' }), /ISBN/);
  assert.match(msg({ isbn: '978-0-679-74558-8' }), /check out/);
  assert.match(msg({ isbn: '0679745581' }), /check out/);
  assert.match(msg({ year: 1799 }), /1800 to 2027/);
  assert.match(msg({ year: 2028 }), /1800 to 2027/);
  assert.equal(validateBook({ ...GOOD, year: 2027 }, { now: NOW }).ok, true, 'next year is allowed');
  assert.match(msg({ year: 1966.5 }), /year/);
  assert.match(msg({ publisher: 'p'.repeat(121) }), /120/);
  assert.match(msg({ publisher: 7 }), /text/);
  assert.match(msg({ shelf: 'Crime' }), /shelf/);
  assert.match(msg({ shelf: 'a'.repeat(41) }), /shelf/);
  assert.match(msg({ shelf: 'cults' }), /shelves in The Stacks/, 'checked against the site’s shelves when known');
  assert.equal(validateBook({ ...GOOD, shelf: 'cults' }, { now: NOW }).ok, true, 'shape only when the shelves are unknown');
  assert.match(msg({ pitch: '' }), /editor/);
  assert.match(msg({ pitch: 'p'.repeat(601) }), /600/);
  assert.match(msg({ relation: 'agent' }), /author or the publisher/);
  assert.match(msg({ email: 'not an email' }), /email/);
  assert.match(msg({ email: `${'a'.repeat(250)}@b.co` }), /email/);
  assert.match(msg({ email: 5 }), /text/);
  assert.equal(validateBook([], { now: NOW }).ok, false);
  assert.equal(validateBook(null, { now: NOW }).ok, false);
});

test('validateBook: confirm must be exactly true; the honeypot marks spam', () => {
  for (const confirm of [undefined, false, 'true', 1, 'on']) {
    const v = validateBook({ ...GOOD, confirm }, { info: INFO, now: NOW });
    assert.equal(v.ok, false, String(confirm));
    assert.match(v.message, /confirm/);
  }
  assert.equal(validateBook({ ...GOOD, website: 'http://spam.example' }, { info: INFO, now: NOW }).spam, true);
  assert.equal(validateBook({ ...GOOD, website: 0 }, { info: INFO, now: NOW }).spam, true, 'anything there at all');
  assert.equal(validateBook({ ...GOOD, website: '   ' }, { info: INFO, now: NOW }).spam, false);
  assert.equal(validateBook({ ...GOOD, website: undefined }, { info: INFO, now: NOW }).spam, false);
});

test('shelfInfo reads the shelves and the ISBNs already on them from books.json', () => {
  const info = shelfInfo(STATIC);
  assert.ok(info.shelves.has('crime'));
  for (const s of STATIC.shelves) assert.ok(info.shelves.has(s.id), s.id);
  for (const b of STATIC.books.filter((x) => x.isbn13)) assert.ok(info.isbns.has(toIsbn13(b.isbn13)), b.id);
  assert.equal(shelfInfo(null), null);
  assert.equal(shelfInfo({ shelves: [] }), null);
  assert.equal(shelfInfo({ shelves: [{ id: 'Bad Id' }] }), null);
});

test('the book route, its hash and its replies', () => {
  assert.equal(route('/functions/v1/community/book'), 'book');
  assert.equal(ROUTE_METHOD.book, 'POST');
  const dup = limitReply({ ok: false, error: 'duplicate' }, 'book');
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.body, { error: 'duplicate', message: 'That book is already with our editor or on the shelves.' });
  assert.equal(BOOK_DUPLICATE, dup.body.message);
  const full = limitReply({ ok: false, error: 'books_full', retry_after: 300 }, 'book');
  assert.equal(full.status, 429);
  assert.equal(full.body.error, 'books_full');
  assert.equal(full.headers['Retry-After'], '300');
  const mine = limitReply({ ok: false, error: 'rate_limited', retry_after: 30 }, 'book');
  assert.equal(mine.status, 429);
  assert.match(mine.body.message, /books we take in a day/);
  assert.equal(limitReply({ ok: false, error: 'weird' }, 'book').status, 502);
});

test('the book hash is per day and differs from the tip hash', async () => {
  const salt = 's'.repeat(32);
  const a = await bookHash(salt, '1.2.3.4', '2026-11-17');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await bookHash(salt, '1.2.3.4', '2026-11-18'));
  assert.notEqual(a, await tipHash(salt, '1.2.3.4', '2026-11-17'));
});

test('the community function source holds no unicode escapes (a deploy tool mangles them)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../supabase/functions/community/logic.mjs', '../supabase/functions/community/index.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/\\u[0-9a-fA-F]{4}|\\u\{/.test(src), f);
  }
});

/* ---------- lib/stacks-db.js ---------- */

const ROW = {
  id: 'the-case-of-x', shelf: 'crime', title: 'The Case of X', authors: ['Ann Author', 'Bo Writer'], year: 2025,
  description: 'In 1990 a town lost its mayor. The author followed the trial for ten years.', content_note: 'Describes a killing.',
  caveat: null, tags: ['Trial', '1990'], isbn13: '9780679745587', cover_id: 12345, origin: 'author', approved_at: '2026-11-10T09:30:00+00:00',
};

test('toBook maps a stacks_books row to the books.json shape, with origin and the cover', () => {
  assert.deepEqual(toBook(ROW), {
    id: 'the-case-of-x', shelf: 'crime', title: 'The Case of X', authors: ['Ann Author', 'Bo Writer'], year: 2025,
    description: ROW.description, tags: ['Trial', '1990'], contentNote: 'Describes a killing.',
    isbn13: '9780679745587', olWork: null, olEdition: null, olVerified: false,
    cover: { id: 12345, olKey: null, checked: '2026-11-10' }, origin: 'author',
  });
  const plain = toBook({ ...ROW, cover_id: null, content_note: null, caveat: 'Disputed.', origin: 'publisher' });
  assert.equal('cover' in plain, false, 'no cover id: the stand-in');
  assert.equal('contentNote' in plain, false);
  assert.equal(plain.caveat, 'Disputed.');
  assert.equal(plain.origin, 'publisher');
  for (const bad of [{ id: 'Bad Id' }, { shelf: '' }, { title: '' }, { authors: [] }, { year: '2025' }, { description: '' }, { tags: [] }, { isbn13: '123' }, { origin: 'agent' }]) {
    assert.equal(toBook({ ...ROW, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(toBook(null), null);
});

test('toFeatured keeps a well-formed pick only', () => {
  assert.deepEqual(toFeatured({ book_id: 'in-cold-blood', reason: 'A classic.', starts_on: '2026-11-16' }), { bookId: 'in-cold-blood', reason: 'A classic.', since: '2026-11-16' });
  assert.equal(toFeatured({ book_id: 'in-cold-blood', reason: '', starts_on: '2026-11-16' }), null);
  assert.equal(toFeatured({ book_id: 'In Cold', reason: 'x', starts_on: '2026-11-16' }), null);
});

test('mergeBooks: approved books after the static ones; clashes, unknown shelves and unknown featured ids dropped', () => {
  const data = { comment: 'c', shelves: [{ id: 'crime' }, { id: 'history' }], books: [{ id: 'in-cold-blood', shelf: 'crime' }] };
  const extras = {
    books: [toBook(ROW), toBook({ ...ROW, id: 'in-cold-blood' }), toBook({ ...ROW, id: 'elsewhere', shelf: 'poetry' })],
    featured: { bookId: 'the-case-of-x', reason: 'Why.', since: '2026-11-16' },
  };
  const out = mergeBooks(data, extras);
  assert.deepEqual(out.books.map((b) => b.id), ['in-cold-blood', 'the-case-of-x'], 'the static id wins; the unknown shelf is left out');
  assert.equal(out.books[0].origin, undefined, 'static books never carry origin');
  assert.equal(out.comment, 'c', 'everything else in the static data is kept');
  assert.deepEqual(out.featured, { bookId: 'the-case-of-x', reason: 'Why.', since: '2026-11-16' });
  assert.equal(data.books.length, 1, 'the static data is not changed');
  assert.equal(mergeBooks(data, { ...extras, featured: { bookId: 'not-on-shelves', reason: 'x', since: '2026-11-16' } }).featured, null);
  assert.equal(mergeBooks(data, { books: [], featured: { bookId: 'in-cold-blood', reason: 'x', since: '2026-11-16' } }).featured.bookId, 'in-cold-blood', 'a static book can be featured');
  assert.equal(mergeBooks(data, null).featured, null);
  assert.deepEqual(mergeBooks(data, null).books, data.books);
});

test('validate() accepts the merged data: an author book without olWork, olEdition or cover, and next year', () => {
  const extras = { books: [toBook({ ...ROW, shelf: STATIC.shelves[0].id }), toBook({ ...ROW, id: 'no-cover', isbn13: '9780804429573', cover_id: null, year: NOW.getUTCFullYear() + 1, origin: 'publisher' })], featured: null };
  const merged = mergeBooks(STATIC, extras);
  assert.equal(merged.books.length, STATIC.books.length + 2);
  assert.deepEqual(validate(merged), []);
  const thisYear = new Date().getUTCFullYear();
  const one = (patch) => validate({ shelves: STATIC.shelves, books: [{ ...merged.books.at(-1), ...patch }] });
  assert.deepEqual(one({ year: thisYear + 1 }), []);
  assert.match(one({ year: thisYear + 2 }).join(), /bad year/);
  assert.match(one({ origin: 'agent' }).join(), /origin/);
  assert.match(one({ olWork: 7 }).join(), /olWork/);
  assert.deepEqual(one({ olWork: 'OL1W', olEdition: null }), []);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    for (const [frag, reply] of routes) if (url.includes(frag)) return typeof reply === 'function' ? reply(url) : reply;
    throw new Error('no route');
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('loadStacksExtras reads visible books and this week’s pick with the publishable key', async () => {
  const f = fakeFetch([['stacks_books', json([ROW, ROW, { id: 'bad' }])], ['stacks_featured', json([{ book_id: 'the-case-of-x', reason: 'Why.', starts_on: '2026-11-16' }])]]);
  const out = await loadStacksExtras({ url: 'https://x.supabase.co/', key: 'k', fetchImpl: f, now: NOW.getTime() });
  assert.equal(out.ok, true);
  assert.deepEqual(out.books.map((b) => b.id), ['the-case-of-x'], 'duplicates and bad rows dropped');
  assert.deepEqual(out.featured, { bookId: 'the-case-of-x', reason: 'Why.', since: '2026-11-16' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].opts.headers.apikey, 'k');
  assert.ok(f.calls.some((c) => c.url.includes('hidden=eq.false')), 'only visible books');
  assert.ok(f.calls.some((c) => c.url.includes('starts_on=lte.2026-11-17') && c.url.includes('order=starts_on.desc') && c.url.includes('limit=1')), 'the latest pick on or before today (UTC)');
  assert.equal(booksEndpoint('https://x.supabase.co/').startsWith('https://x.supabase.co/rest/v1/stacks_books?'), true);
  assert.match(featuredEndpoint('https://x.supabase.co', '2026-11-17'), /stacks_featured\?select=book_id,reason,starts_on&starts_on=lte\.2026-11-17/);
});

test('loadStacksExtras never throws: bad config, errors, bad bodies and timeouts give nothing', async () => {
  const none = { books: [], featured: null, ok: false };
  assert.deepEqual(await loadStacksExtras({}), none);
  assert.deepEqual(await loadStacksExtras({ url: 'ftp://x', key: 'k', fetchImpl: async () => json([]) }), none);
  assert.deepEqual(await loadStacksExtras({ url: 'https://x', key: '', fetchImpl: async () => json([]) }), none);
  const failed = await loadStacksExtras({ url: 'https://x', key: 'k', fetchImpl: async () => { throw new Error('down'); } });
  assert.deepEqual(failed, none);
  const notApplied = await loadStacksExtras({ url: 'https://x', key: 'k', fetchImpl: async () => json({ code: 'PGRST205' }, 404) });
  assert.deepEqual(notApplied, none);
  const half = await loadStacksExtras({ url: 'https://x', key: 'k', fetchImpl: fakeFetch([['stacks_books', json([ROW])], ['stacks_featured', json({ nope: 1 })]]) });
  assert.equal(half.ok, false, 'one read failed');
  assert.equal(half.books.length, 1, 'what did arrive is still returned (the build can use it)');
  const slow = await loadStacksExtras({ url: 'https://x', key: 'k', timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  assert.deepEqual(slow, none);
});

test('booksFor caches 4 minutes, and falls back to the static data with featured null', async () => {
  resetCache();
  let t = 1_000_000;
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' };
  const good = fakeFetch([['stacks_books', json([ROW])], ['stacks_featured', json([{ book_id: 'in-cold-blood', reason: 'Why.', starts_on: '2026-11-16' }])]]);
  const a = await booksFor({ fetchImpl: good, now: () => t, env });
  assert.equal(a.cacheControl, 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  assert.equal(a.body.books.length, STATIC.books.length + 1);
  assert.equal(a.body.books.at(-1).origin, 'author');
  assert.deepEqual(a.body.featured, { bookId: 'in-cold-blood', reason: 'Why.', since: '2026-11-16' });
  assert.deepEqual(a.body.shelves, STATIC.shelves);
  t += 3 * 60e3;
  await booksFor({ fetchImpl: good, now: () => t, env });
  assert.equal(good.calls.length, 2, 'served from memory within 4 minutes');
  t += 2 * 60e3;
  const down = async () => { throw new Error('down'); };
  const b = await booksFor({ fetchImpl: down, now: () => t, env });
  assert.equal(b.body.books.length, STATIC.books.length, 'static only');
  assert.equal(b.body.featured, null);
  assert.equal(b.cacheControl, stacksDb.FAIL_CACHE_CONTROL);
  t += 31e3;
  await booksFor({ fetchImpl: good, now: () => t, env });
  assert.equal(good.calls.length, 4, 'a failure is retried after 30 seconds');
  resetCache();
});

test('GET /api/books answers 200 with the static data when the database is unreachable', async () => {
  resetCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const res = { headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await booksApi({ method: 'GET', url: '/api/books' }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.featured, null);
    assert.equal(res.body.books.length, STATIC.books.length);
    assert.deepEqual(res.body.shelves, STATIC.shelves);
    assert.match(res.headers['Cache-Control'], /^public, max-age=0, s-maxage=\d+, stale-while-revalidate=300$/);
    const post = { ...res, headers: {}, code: 0, body: null };
    await booksApi({ method: 'POST', url: '/api/books' }, post);
    assert.equal(post.code, 405);
    assert.equal(post.headers.Allow, 'GET, HEAD');
  } finally {
    globalThis.fetch = realFetch;
    resetCache();
  }
});

/* ---------- reviewer console: Books ---------- */

const SUB = {
  id: 's1', created_at: '2026-11-16T10:00:00Z', title: 'The Executioner’s Song', authors: 'Norman Mailer, Lawrence Schiller', isbn13: '9780679745587',
  year: 1979, publisher: null, shelf: 'crime', relation: 'author', status: 'pending',
  pitch: 'In July 1976 Gary Gilmore killed two young men in Utah and then refused to fight his death sentence, which made him famous.',
};

test('the Books view exists; slugify and uniqueSlug', () => {
  assert.equal(VIEWS.books.title, 'Books');
  assert.equal(slugify('The Executioner’s Song'), 'the-executioners-song');
  assert.equal(slugify('  Fordlândia: The Rise & Fall!  '), 'fordlandia-the-rise-and-fall');
  assert.equal(slugify('---'), '');
  const long = slugify('word '.repeat(40));
  assert.ok(long.length <= 80 && !long.endsWith('-') && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
  assert.equal(uniqueSlug('in-cold-blood', new Set(['in-cold-blood', 'in-cold-blood-2'])), 'in-cold-blood-3');
  assert.equal(uniqueSlug('x', []), 'x');
  assert.equal(uniqueSlug('', []), 'book');
});

test('copiedRun finds the longest run of words shared with the pitch', () => {
  assert.equal(copiedRun('Gilmore killed two young men in Utah, Mailer writes.', SUB.pitch).words, 7);
  const r = copiedRun('In 1976, Gary Gilmore KILLED two young men in Utah and then refused to appeal.', SUB.pitch);
  assert.equal(r.words, 13, 'case and punctuation ignored');
  assert.equal(r.phrase, '1976 gary gilmore killed two young men in utah and then refused to');
  assert.equal(copiedRun('', SUB.pitch).words, 0);
  assert.equal(copiedRun('anything', '').words, 0);
});

test('the description checklist: length, one or two sentences, and the 8-words-from-the-pitch rule', () => {
  const ok = { description: 'Mailer rebuilds the months around a 1976 Utah murder case from interviews and records.', content_note: '', caveat: '' };
  const byId = (f) => Object.fromEntries(descriptionChecks(f, SUB.pitch).map((c) => [c.id, c]));
  assert.ok(descriptionChecks(ok, SUB.pitch).every((c) => c.ok));
  assert.equal(byId({ description: '' }).length.ok, false);
  assert.equal(byId({ description: 'x'.repeat(401) + '.' }).length.ok, false);
  assert.equal(byId({ description: 'One. Two. Three.' }).sentences.ok, false);
  assert.equal(byId({ description: 'One sentence. And a second.' }).sentences.ok, true);
  assert.equal(sentences('A “quoted” line. Then a second one.').length, 2);
  assert.equal(sentences('').length, 0);
  // Seven words in a row from the pitch pass; eight fail.
  const seven = 'Gilmore killed two young men in Utah, Mailer tells it.';
  assert.equal(copiedRun(seven, SUB.pitch).words, 7);
  const eight = 'Gary Gilmore killed two young men in Utah, Mailer tells it.';
  assert.equal(copiedRun(eight, SUB.pitch).words, COPY_RUN, 'exactly eight');
  assert.equal(byId({ description: eight }).copied.ok, false);
  assert.equal(byId({ description: eight }).copied.hard, true);
  assert.equal(byId({ description: seven }).copied.ok, true, 'seven words in a row pass');
  const inCaveat = byId({ ...ok, caveat: 'Some say he refused to fight his death sentence, which made him famous.' });
  assert.equal(inCaveat.copied.ok, false, 'the content note and caveat are checked too');
  assert.match(inCaveat.copied.detail, /^caveat: “/);
  assert.equal(byId({ description: 'A gripping, must-read account.' }).promo.ok, false);
  assert.equal(byId({ description: 'A gripping, must-read account.' }).promo.hard, false, 'selling words only warn');
  assert.equal(byId({ description: 'No full stop' }).stop.ok, false);
});

test('approvalFromSubmission: the editor’s fields start empty; the cover is off on crime and serial shelves', () => {
  const v = approvalFromSubmission(SUB, { taken: new Set(['the-executioners-song']) });
  assert.equal(v.id, 'the-executioners-song-2');
  assert.equal(v.authors, 'Norman Mailer\nLawrence Schiller');
  assert.equal(v.year, '1979');
  assert.equal(v.description, '', 'never filled from the pitch');
  assert.equal(v.show_cover, false);
  assert.equal(approvalFromSubmission({ ...SUB, shelf: 'serial' }).show_cover, false);
  assert.equal(approvalFromSubmission({ ...SUB, shelf: 'history' }).show_cover, true);
});

test('approveErrors and cleanApproval mirror stacks_approve_submission', () => {
  const f = {
    id: 'the-executioners-song', shelf: 'crime', title: ' The Executioner’s Song ', authors: 'Norman Mailer\n\n Lawrence Schiller ', year: '1979',
    description: 'Mailer rebuilds the months around a 1976 Utah murder case from interviews and records.', content_note: 'Describes real killings.',
    caveat: '', tags: 'Utah, Death penalty,, Trial', cover_id: '8231856', show_cover: true,
  };
  const opts = { shelves: ['crime', 'history'], taken: new Set(['in-cold-blood']), pitch: SUB.pitch, now: NOW };
  assert.deepEqual(approveErrors(f, opts), {});
  assert.deepEqual(cleanApproval(f), {
    id: 'the-executioners-song', shelf: 'crime', title: 'The Executioner’s Song', authors: ['Norman Mailer', 'Lawrence Schiller'], year: 1979,
    description: f.description, content_note: 'Describes real killings.', caveat: null, tags: ['Utah', 'Death penalty', 'Trial'], cover_id: 8231856,
  });
  assert.equal(cleanApproval({ ...f, show_cover: false }).cover_id, null, 'Show cover unticked: the stand-in');
  assert.equal(cleanApproval({ ...f, show_cover: 'on' }).cover_id, 8231856, 'a ticked box from FormData');
  const e = approveErrors({ ...f, id: 'in-cold-blood', shelf: 'poetry', title: '', authors: '', year: '2028', tags: '', description: 'One. Two. Three.' }, opts);
  assert.deepEqual(Object.keys(e).sort(), ['authors', 'description', 'id', 'shelf', 'tags', 'title', 'year']);
  assert.match(e.id, /already/);
  assert.match(approveErrors({ ...f, id: 'Bad Id' }, opts).id, /lower-case/);
  assert.match(approveErrors({ ...f, authors: Array(7).fill('A').join('\n') }, opts).authors, /At most 6/);
  assert.match(approveErrors({ ...f, tags: 'a,b,c,d,e,f,g' }, opts).tags, /At most 6/);
  assert.match(approveErrors({ ...f, tags: 'x'.repeat(31) }, opts).tags, /30/);
  assert.match(approveErrors({ ...f, content_note: 'x'.repeat(STACKS_LIMITS.content_note + 1) }, opts).content_note, /300/);
  assert.match(approveErrors({ ...f, caveat: 'x'.repeat(401) }, opts).caveat, /400/);
  assert.match(approveErrors({ ...f, description: 'Gary Gilmore killed two young men in Utah, Mailer tells it.' }, opts).description, /own words/);
  assert.equal(approveErrors({ ...f, year: '2027' }, opts).year, undefined, 'next year is fine');
  assert.match(approveErrors({ ...f, cover_id: 'abc' }, opts).cover_id, /number/);
  assert.equal(approveErrors({ ...f, cover_id: 'abc', show_cover: false }, opts).cover_id, undefined);
});

test('replies from the reviewer functions read as sentences', () => {
  assert.match(stacksReplyError({ ok: false, error: 'not_pending' }), /already decided/);
  assert.match(stacksReplyError({ ok: false, error: 'id_taken' }), /id/);
  assert.match(stacksReplyError({ ok: false, error: 'bad_field', field: 'content_note' }), /content note/);
  assert.match(stacksReplyError({ ok: false, error: 'duplicate' }), /ISBN/);
  assert.match(stacksReplyError(null), /refused/);
});

test('booksRows: the Book of the Week first, then waiting books newest first, then approved books', () => {
  const subs = [{ ...SUB, id: 'a', created_at: '2026-11-10T00:00:00Z' }, { ...SUB, id: 'b', title: 'Other', created_at: '2026-11-12T00:00:00Z' }, { ...SUB, id: 'c', status: 'rejected' }];
  const books = [{ id: 'x', title: 'X', authors: ['A'], approved_at: '2026-11-01T00:00:00Z' }, { id: 'y', title: 'Y', authors: ['B'], approved_at: '2026-11-05T00:00:00Z', hidden: true }];
  assert.deepEqual(booksRows(subs, books).map((r) => r.id), ['featured', 'sub:b', 'sub:a', 'book:y', 'book:x']);
  assert.deepEqual(booksRows(subs, books, 'other').map((r) => r.id), ['sub:b']);
  assert.deepEqual(booksRows(subs, books, 'week').map((r) => r.id), ['featured']);
  assert.equal(pendingCount(subs), 2);
  assert.equal(pendingCount(null), 0);
});

test('Book of the Week: Mondays, the current pick, the form and the cover lookup', () => {
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(mondayOf('2026-11-22'), '2026-11-16', 'Sunday belongs to the week before');
  assert.equal(mondayOf('2026-11-23'), '2026-11-23');
  assert.equal(mondayOf('2026-13-01'), null);
  assert.equal(mondayOf(''), null);
  assert.equal(thisMonday(NOW.getTime()), '2026-11-16');
  assert.match(weekLabel('2026-11-18'), /^Week of 16 Nov(ember)? 2026$/);
  assert.equal(weekLabel('soon'), '');
  const rows = [{ book_id: 'a', starts_on: '2026-11-02' }, { book_id: 'b', starts_on: '2026-11-09' }, { book_id: 'c', starts_on: '2026-11-23' }];
  assert.equal(currentFeatured(rows, NOW.getTime()).book_id, 'b', 'a skipped week keeps the last pick; a future week waits');
  assert.equal(currentFeatured([], NOW.getTime()), null);
  assert.deepEqual(featuredErrors({ book_id: 'a', reason: 'Why now.', starts_on: '2026-11-16' }, { bookIds: ['a'] }), {});
  assert.deepEqual(Object.keys(featuredErrors({ book_id: 'z', reason: '', starts_on: 'soon' }, { bookIds: ['a'] })).sort(), ['book_id', 'reason', 'starts_on']);
  assert.match(featuredErrors({ book_id: 'a', reason: 'r'.repeat(141), starts_on: '2026-11-16' }, { bookIds: new Set(['a']) }).reason, /140/);
  assert.equal(coverFromEdition({ covers: [-1, 8231856, 2] }), 8231856);
  assert.equal(coverFromEdition({}), null);
  assert.equal(coverFromEdition(null), null);
  assert.equal(openLibraryIsbnUrl('9780679745587'), 'https://openlibrary.org/isbn/9780679745587.json');
  assert.equal(coverImageUrl(8231856, 'M'), 'https://covers.openlibrary.org/b/id/8231856-M.jpg');
});
