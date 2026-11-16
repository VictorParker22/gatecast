// Book covers for The Stacks (library.html). Shared by server.js (local) and api/book-covers.js (Vercel).
// For each book in data/books.json we ask Open Library's search API once, one request at a time and at most one
// a second, and accept a result only when its title and an author's surname match ours. We keep only the cover
// ID, the work key and the first-publication year, in memory for 7 days. Browsers then load the cover image
// straight from covers.openlibrary.org by ID (not rate-limited). No dependencies.
const BOOKS = require('../data/books.json').books;

const UA = 'Gatecast/1.0 (+https://gatecast.vercel.app)'; // no email address, by decision
const SEARCH = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,author_name,cover_i,first_publish_year,edition_count';
const MIN_GAP_MS = 1000;                 // Open Library asks for at most 1 request/second without an email
const TTL_MS = 7 * 24 * 3600e3;          // a match (or a confirmed no-match) is kept for 7 days
const BUDGET_MS = Number(process.env.BOOK_COVERS_BUDGET_MS) || 8000; // per call, under a 10 s function limit
const TIMEOUT_MS = 5000;
const CACHE_CONTROL = 'public, s-maxage=604800, stale-while-revalidate=86400';
const PARTIAL_CACHE_CONTROL = 'public, s-maxage=60'; // some books still to look up: let the next visitor carry on

// Lower case, accents and punctuation gone, leading article dropped, subtitle (after ':' or ' - ') dropped.
function normTitle(s) {
  let t = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.split(/\s*[:;]\s+|\s+[-–—]\s+|\s*\(/)[0];
  t = t.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return t.replace(/^(the|a|an) /, '');
}
function normName(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
const surnameOf = (name) => {
  const parts = normName(name).split(' ').filter((p) => p && !/^(jr|sr|ii|iii)$/.test(p));
  return parts[parts.length - 1] || '';
};

// The first search result whose normalised title equals ours and that shares an author surname.
function pickMatch(book, docs) {
  const want = normTitle(book.title);
  const names = new Set(book.authors.map(surnameOf).filter(Boolean));
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || normTitle(d.title) !== want) continue;
    if (!(d.author_name || []).some((a) => names.has(surnameOf(a)))) continue;
    const key = typeof d.key === 'string' && /^\/works\/OL\d+W$/.test(d.key) ? d.key : null;
    return {
      coverId: Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : null,
      olKey: key,
      year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
    };
  }
  return null;
}

function searchUrl(book) {
  const u = new URL(SEARCH);
  u.searchParams.set('title', book.title);
  u.searchParams.set('author', book.authors[0]);
  u.searchParams.set('limit', '3');
  u.searchParams.set('fields', FIELDS);
  return u.href;
}

// Per-book results: id -> { at, value }. Shared by every call in this process.
const cache = new Map();
let lastRequestAt = -Infinity;
let queue = Promise.resolve(); // one lookup run at a time, so concurrent calls never break the rate limit

async function lookup(book, { fetchImpl, now, sleep }) {
  const wait = lastRequestAt + MIN_GAP_MS - now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = now();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(searchUrl(book), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl?.signal });
    if (!res.ok) return { error: res.status };
    const body = await res.json();
    return { value: pickMatch(book, body && body.docs) };
  } catch (err) {
    return { error: 'network' };
  } finally { if (timer) clearTimeout(timer); }
}

// Looks up books not yet cached (or expired) until the time budget runs out, then answers from the cache.
// Errors are not cached, and any error (a 403/429/5xx or no connection) ends this run so we back off. `pending` lists books still to look up.
async function coversFor(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const books = opts.books || BOOKS;
  const budget = opts.budgetMs ?? BUDGET_MS;
  const run = queue.then(async () => {
    const started = now();
    for (const book of books) {
      const hit = cache.get(book.id);
      if (hit && now() - hit.at < TTL_MS) continue;
      if (now() - started + MIN_GAP_MS > budget) break;
      const got = await lookup(book, { fetchImpl, now, sleep });
      if (!('value' in got)) break; // refused, rate-limited, down or unreachable: back off until the next call
      cache.set(book.id, { at: now(), value: got.value });
    }
  });
  queue = run.catch(() => {});
  await run;
  const covers = {}, pending = [];
  for (const book of books) {
    const hit = cache.get(book.id);
    if (hit && now() - hit.at < TTL_MS) covers[book.id] = hit.value;
    else { covers[book.id] = null; pending.push(book.id); }
  }
  return { covers, checkedAt: new Date(now()).toISOString(), pending: pending.length };
}

const cacheControlFor = (out) => (out && out.pending === 0 ? CACHE_CONTROL : PARTIAL_CACHE_CONTROL);

function resetForTests() { cache.clear(); lastRequestAt = -Infinity; queue = Promise.resolve(); }

module.exports = { coversFor, cacheControlFor, pickMatch, normTitle, surnameOf, searchUrl, resetForTests, UA, CACHE_CONTROL, PARTIAL_CACHE_CONTROL, MIN_GAP_MS, TTL_MS };
