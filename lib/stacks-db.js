// The Stacks from the database: books their author or publisher put forward, approved by the editor
// (public.stacks_books), and the Book of the Week (public.stacks_featured). See
// supabase/migrations/20261117120000_stacks_submissions.sql and docs/community.md.
//
//   loadStacksExtras({ url, key, fetchImpl, timeoutMs }) -> { books, featured, ok }
//       books: the visible approved books in the shape of data/books.json's books (with origin), oldest approval first
//       featured: { bookId, reason, since } for this week's pick (the latest one starting on or before today, UTC), or null
//       ok: false when either read failed. Never throws: any failure gives { books: [], featured: null, ok: false }
//   mergeBooks(staticData, extras) -> the data/books.json object with the approved books after the static ones and featured
//   booksFor({ ... }) -> what GET /api/books answers (api/books.js, server.js), cached in memory for 4 minutes
//
// Read with the publishable key, which row-level security limits to visible books and the public columns. No
// dependencies. The build (scripts/build-stacks-pages.cjs) uses loadStacksExtras and mergeBooks too, so approved
// books get /stacks/<id>/ pages at the next deploy.

const TIMEOUT_MS = 5000;
const LIMIT = 500;
const TTL_MS = 4 * 60e3;         // a good answer is kept 4 minutes in this process
const FAIL_TTL_MS = 30e3;        // after a failed read, try the database again soon
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ORIGINS = ['author', 'publisher'];
const BOOK_COLUMNS = 'id,shelf,title,authors,year,description,content_note,caveat,tags,isbn13,cover_id,origin,approved_at';

const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';
const FAIL_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

// The same project and publishable key as lib/weird.js (the key is public by design: see js/config.js). Env wins.
const DEFAULT_URL = 'https://hfdwmzuedjcsaxgzhzmu.supabase.co';
const DEFAULT_KEY = 'sb_publishable_a2KiR862D8VC63YjqFIYSQ_U5YnwpMJ';
const envConfig = (env = process.env) => ({ url: env.SUPABASE_URL || DEFAULT_URL, key: env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_KEY });

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const slug = (v, max) => (typeof v === 'string' && v.length <= max && SLUG.test(v) ? v : null);
const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d\d-\d\d/.test(iso) ? iso.slice(0, 10) : null);
const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function list(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => text(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

// One stacks_books row -> one book in the books.json shape, or null when a required field is missing or malformed.
function toBook(row) {
  if (!row || typeof row !== 'object') return null;
  const id = slug(row.id, 80);
  const shelf = slug(row.shelf, 40);
  const title = text(row.title, 200);
  const authors = list(row.authors, 6, 120);
  const description = text(row.description, 400);
  const tags = list(row.tags, 6, 30);
  const isbn13 = typeof row.isbn13 === 'string' && /^97[89]\d{10}$/.test(row.isbn13) ? row.isbn13 : null;
  const origin = ORIGINS.includes(row.origin) ? row.origin : null;
  if (!id || !shelf || !title || !authors.length || !Number.isInteger(row.year) || !description || !tags.length || !isbn13 || !origin) return null;
  const book = { id, shelf, title, authors, year: row.year, description, tags };
  const contentNote = text(row.content_note, 300);
  const caveat = text(row.caveat, 400);
  if (contentNote) book.contentNote = contentNote;
  if (caveat) book.caveat = caveat;
  Object.assign(book, { isbn13, olWork: null, olEdition: null, olVerified: false });
  const checked = day(row.approved_at);
  if (Number.isInteger(row.cover_id) && row.cover_id > 0 && checked) book.cover = { id: row.cover_id, olKey: null, checked };
  book.origin = origin;
  return book;
}

// One stacks_featured row -> { bookId, reason, since }, or null.
function toFeatured(row) {
  if (!row || typeof row !== 'object') return null;
  const bookId = slug(row.book_id, 80);
  const reason = text(row.reason, 140);
  const since = typeof row.starts_on === 'string' && /^\d{4}-\d\d-\d\d$/.test(row.starts_on) ? row.starts_on : null;
  return bookId && reason && since ? { bookId, reason, since } : null;
}

const root = (base) => String(base).replace(/\/+$/, '');
const booksEndpoint = (base) =>
  `${root(base)}/rest/v1/stacks_books?select=${BOOK_COLUMNS}&hidden=eq.false&order=approved_at.asc,id.asc&limit=${LIMIT}`;
const featuredEndpoint = (base, today) =>
  `${root(base)}/rest/v1/stacks_featured?select=book_id,reason,starts_on&starts_on=lte.${today}&order=starts_on.desc&limit=1`;

async function loadStacksExtras({ url, key, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, now = Date.now() } = {}) {
  const none = { books: [], featured: null, ok: false };
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof key !== 'string' || !key || typeof fetchImpl !== 'function') return none;
  const ctrl = new AbortController();
  let timer;
  // The deadline covers both reads, bodies included, even if fetchImpl ignores the abort signal.
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve(none); }, timeoutMs); });
  const get = async (endpoint) => {
    try {
      const res = await fetchImpl(endpoint, { headers: { apikey: key, Accept: 'application/json' }, signal: ctrl.signal });
      if (!res || !res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  };
  const work = (async () => {
    const [bookRows, featRows] = await Promise.all([get(booksEndpoint(url)), get(featuredEndpoint(url, utcDay(now)))]);
    const seen = new Set();
    const books = (bookRows || []).map(toBook).filter((b) => b && !seen.has(b.id) && seen.add(b.id));
    return { books, featured: featRows && featRows.length ? toFeatured(featRows[0]) : null, ok: Boolean(bookRows && featRows) };
  })();
  try {
    return await Promise.race([work, deadline]);
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

// The static data with the approved books after its own, and featured. An approved book whose id is already on the
// static list, or whose shelf the static data does not have, is left out. featured is null unless its book is in the
// merged list. The static data is not changed.
function mergeBooks(staticData, extras) {
  const data = staticData && typeof staticData === 'object' ? staticData : {};
  const own = Array.isArray(data.books) ? data.books : [];
  const ids = new Set(own.map((b) => b && b.id));
  const shelves = new Set((Array.isArray(data.shelves) ? data.shelves : []).map((s) => s && s.id));
  const added = [];
  for (const b of Array.isArray(extras?.books) ? extras.books : []) {
    if (!b || ids.has(b.id) || !shelves.has(b.shelf)) continue;
    ids.add(b.id);
    added.push(b);
  }
  const f = extras?.featured;
  const featured = f && typeof f === 'object' && ids.has(f.bookId) ? { bookId: f.bookId, reason: f.reason, since: f.since } : null;
  return { ...data, books: [...own, ...added], featured };
}

// GET /api/books: the merged data, from memory when it is younger than 4 minutes (30 seconds after a failed read).
// -> { body, cacheControl }. On any database failure the body is the static data with featured: null.
let cache = null;
async function booksFor({ staticData, fetchImpl = globalThis.fetch, now = Date.now, env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
  const t = now();
  if (cache && t - cache.at < (cache.ok ? TTL_MS : FAIL_TTL_MS)) return cache.value;
  const data = staticData || require('../data/books.json');
  const { url, key } = envConfig(env);
  let extras;
  try { extras = await loadStacksExtras({ url, key, fetchImpl, timeoutMs, now: t }); } catch { extras = { books: [], featured: null, ok: false }; }
  const value = extras.ok
    ? { body: mergeBooks(data, extras), cacheControl: CACHE_CONTROL }
    : { body: mergeBooks(data, { books: [], featured: null }), cacheControl: FAIL_CACHE_CONTROL };
  cache = { at: t, ok: extras.ok, value };
  return value;
}
const resetCache = () => { cache = null; };

module.exports = {
  loadStacksExtras, mergeBooks, booksFor, resetCache, toBook, toFeatured, booksEndpoint, featuredEndpoint, envConfig,
  CACHE_CONTROL, FAIL_CACHE_CONTROL, TTL_MS,
};
