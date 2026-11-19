// Weird-news community function: the pure part. No Deno, no npm, no network.
// index.ts (the Supabase Edge Function) imports this; tests/community.test.mjs tests it from Node.
//
// What lives here: the story-URL normaliser and story id (the browser has the same code in js/community.js,
// and the tests check they agree), hashing a visitor's address, request validation for votes, ratings, tips,
// clicks and books put forward for The Stacks (ISBN checks), the public-host check for tipped links, the 50-vote
// rule, routing, CORS origins and error replies.

export const VOTE_THRESHOLD = 50; // the readers' average shows once this many people have voted
export const MAX_IDS = 60;
export const URL_MAX = 2048;
export const NOTE_MAX = 280;
export const BODY_MAX = 8 * 1024;
export const SALT_MIN = 16;

// ───────────────────────────── story ids ─────────────────────────────

// Query parameters that only say where a click came from. Dropped so the same story gets one id.
const TRACKING = /^(utm_.*|fbclid|gclid)$/i;

// The one form of a story's address that its id is made from: https, lowercase host, no fragment, no
// tracking parameters, no trailing slash. http is folded into https (the same story behind either scheme).
// Returns null for anything that is not an http(s) address with a host.
export function normaliseStoryUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > URL_MAX) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname || u.username || u.password) return null;
  const keep = [...u.searchParams].filter(([k]) => !TRACKING.test(k));
  const q = new URLSearchParams(keep).toString();
  const port = u.port && !(u.protocol === 'https:' && u.port === '443') && !(u.protocol === 'http:' && u.port === '80') ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `https://${u.hostname.toLowerCase()}${port}${path}${q ? `?${q}` : ''}`;
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// First 16 hex characters of SHA-256 of the normalised address, or null when the address is not usable.
export async function storyId(url) {
  const n = normaliseStoryUrl(url);
  return n ? (await sha256Hex(n)).slice(0, 16) : null;
}

export const isStoryId = (s) => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);

// ───────────────────────────── addresses ─────────────────────────────

function v4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

// "2001:db8::1", "::ffff:1.2.3.4" -> eight 16-bit numbers, or null.
export function parseIPv6(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const n = v4ToInt(tail[1]);
    if (n === null) return null;
    s = s.slice(0, -tail[1].length) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) || []).length > 1) return null;
  let groups;
  if (s.includes('::')) {
    const [a, b] = s.split('::');
    const left = a ? a.split(':') : [];
    const right = b ? b.split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    groups = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// Which address a request came from, as the platform reports it. On Supabase every request arrives through
// Cloudflare, which sets cf-connecting-ip itself and rejects a request that tries to supply one (tested on the live
// gateway, 19 Nov 2026), so a visitor cannot choose it. x-forwarded-for is only the fallback for a local run, where
// no such header exists: there its first hop is whatever the caller sent. `get` reads a request header by name.
export function clientAddress(get) {
  const cf = String(get('cf-connecting-ip') ?? '').trim();
  return cf || String(get('x-forwarded-for') ?? '');
}

// The visitor's address (clientAddress above; for a forwarded list, its first hop), as the identity votes and tips
// are counted by: an IPv4 address as written, an IPv6 address cut to its /64 (one home or phone usually holds a
// whole /64 and can change the rest at will). null when there is no usable address.
export function clientKey(xff) {
  let first = String(xff ?? '').split(',')[0].trim();
  if (!first || first.length > 64) return null;
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(first);
  if (v4port) first = v4port[1];
  const v6port = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/.exec(first);
  if (v6port) first = v6port[1];
  const n4 = v4ToInt(first);
  if (n4 !== null) return [n4 >>> 24, (n4 >>> 16) & 255, (n4 >>> 8) & 255, n4 & 255].join('.');
  const g = parseIPv6(first);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) { // ::ffff:a.b.c.d is an IPv4 visitor
    return [g[6] >>> 8, g[6] & 255, g[7] >>> 8, g[7] & 255].join('.');
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

// The UTC day, "2026-11-16". Tips are counted per UTC day, and their hash changes every day.
export const dayBucket = (now = new Date()) => new Date(now).toISOString().slice(0, 10);

// SHA-256 of the secret salt, what the hash is for and the address (and, for tips, the UTC day). The address
// itself is never stored; without the salt the hash cannot be matched back to it.
const SEP = String.fromCharCode(0); // a separator no address or salt can contain
export const voterHash = (salt, key) => sha256Hex(`${salt}${SEP}vote${SEP}${key}`);
export const tipHash = (salt, key, day) => sha256Hex(`${salt}${SEP}tip${SEP}${key}${SEP}${day}`);
// Clicks: only for the 120-an-hour limit (a key in private.weird_rate, purged after 2 days), never stored with the
// click. It changes every UTC day, like the tip hash, so the counter cannot link a visitor across days.
export const clickHash = (salt, key, day) => sha256Hex(`${salt}${SEP}click${SEP}${key}${SEP}${day}`);
// Books put forward for The Stacks: the 3-a-day limit, and stored with the submission for 7 days. Changes every UTC
// day, like the tip hash.
export const bookHash = (salt, key, day) => sha256Hex(`${salt}${SEP}book${SEP}${key}${SEP}${day}`);

export const saltReady = (salt) => typeof salt === 'string' && salt.trim().length >= SALT_MIN;

// ───────────────────────────── public hosts ─────────────────────────────

// A host name that can only be on the public internet by its shape: a dotted name with a letter TLD, not an
// address, not a local or reserved name. Tipped links are never fetched; this keeps the queue to real sites
// and stops anyone using the tip box to plant links to private or local addresses in the reviewers' console.
export function publicHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  // The URL parser has already turned international names into xn-- form and numeric hosts into dotted IPv4.
  if (!h || h.length > 253 || !/^[a-z0-9.-]+$/.test(h)) return false;
  const labels = h.split('.');
  if (labels.length < 2 || labels.some((l) => !l || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) return false;
  // A letter TLD: this also rules out every IPv4 address.
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|invalid|test|example|onion|corp|private)$/.test(h);
}

// A tipped link: https, at most 2048 characters, no user name or password, the default port, a public host.
// Returns { ok, url } with the link normalised (tracking parameters and fragment dropped), or { ok:false, reason }.
export function checkTipUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'missing' };
  const s = raw.trim();
  if (s.length > URL_MAX) return { ok: false, reason: 'too_long' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: 'bad_url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (u.username || u.password || (u.port && u.port !== '443')) return { ok: false, reason: 'bad_url' };
  if (!publicHost(u.hostname)) return { ok: false, reason: 'private_host' };
  const url = normaliseStoryUrl(s);
  if (!url || url.length > URL_MAX) return { ok: false, reason: 'bad_url' };
  return { ok: true, url };
}

// ───────────────────────────── requests ─────────────────────────────

const chars = (s) => [...String(s)].length; // as the database counts them (code points)

// { storyUrl, rating } -> { ok, url (normalised), rating } or { ok:false, message }.
export function validateVote(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send a JSON object.' };
  const url = normaliseStoryUrl(body.storyUrl);
  if (!url) return { ok: false, message: 'storyUrl must be the story’s http(s) address.' };
  if (!publicHost(new URL(url).hostname)) return { ok: false, message: 'storyUrl must be on a public website.' };
  const rating = body.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, message: 'rating must be a whole number from 1 to 5.' };
  return { ok: true, url, rating };
}

// { storyUrl } -> { ok, url (normalised) } or { ok:false, message }. Nothing else in the body is read or kept.
export function validateClick(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send a JSON object.' };
  const url = normaliseStoryUrl(body.storyUrl);
  if (!url) return { ok: false, message: 'storyUrl must be the story’s http(s) address.' };
  if (!publicHost(new URL(url).hostname)) return { ok: false, message: 'storyUrl must be on a public website.' };
  return { ok: true, url };
}

// "a,b,c" -> { ok, ids } (deduplicated, order kept) or { ok:false, message }.
export function parseIds(raw) {
  const ids = [...new Set(String(raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) return { ok: false, message: 'ids is required: comma-separated story ids.' };
  if (ids.length > MAX_IDS) return { ok: false, message: `At most ${MAX_IDS} ids per request.` };
  if (!ids.every(isStoryId)) return { ok: false, message: 'Each id must be 16 hex characters.' };
  return { ok: true, ids };
}

// Control characters, zero-width marks, line/paragraph separators and the BOM. Built from code points so the
// source holds no escaped line terminators (some deploy tools turn unicode escapes into real characters).
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]]
  .map(([a, b]) => (a === b ? String.fromCharCode(a) : `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)).join('')}]`, 'g');

export const TIP_MESSAGES = {
  missing: 'Paste the link to the story.',
  too_long: 'That link is too long.',
  bad_url: 'That doesn’t look like a web address.',
  not_https: 'Use the story’s https:// link.',
  private_host: 'That link isn’t to a public website.',
};

// { url, note, website } -> { ok, url, note, spam } or { ok:false, message }. website is a honeypot field the
// form hides from people; anything in it means a bot filled the form, and the tip is dropped quietly.
export function validateTip(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send a JSON object.' };
  const spam = typeof body.website === 'string' ? body.website.trim() !== '' : body.website != null;
  const link = checkTipUrl(body.url);
  if (!link.ok) return { ok: false, message: TIP_MESSAGES[link.reason] };
  if (body.note != null && typeof body.note !== 'string') return { ok: false, message: 'note must be text.' };
  const note = String(body.note ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (chars(note) > NOTE_MAX) return { ok: false, message: `Keep the note to ${NOTE_MAX} characters.` };
  return { ok: true, url: link.url, note: note || null, spam };
}

// ───────────────────────────── books for The Stacks ─────────────────────────────

// POST /book (supabase/migrations/20261117120000_stacks_submissions.sql). The sender's words go to the editor only;
// the editor writes everything that goes on the shelf.
export const BOOK_LIMITS = { title: 200, authors: 200, publisher: 120, pitch: 600, email: 254, shelf: 40 };
export const BOOK_DUPLICATE = 'That book is already with our editor or on the shelves.';
const SHELF_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ISBN-10 or ISBN-13 as typed (hyphens and spaces allowed) -> the ISBN-13 digits, or null when the shape or the
// check digit is wrong. An ISBN-10 becomes 978 + its first nine digits + a new check digit.
export function isbn13Check(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
export function isbn10Ok(d) {
  if (!/^[0-9]{9}[0-9X]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
  return sum % 11 === 0;
}
export function toIsbn13(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = String(raw).toUpperCase().replace(/^ISBN(?:-1[03])?:?/, '').replace(/[\s-]+/g, '');
  if (/^97[89][0-9]{10}$/.test(d)) return isbn13Check(d) === d[12] ? d : null;
  if (/^[0-9]{9}[0-9X]$/.test(d)) {
    if (!isbn10Ok(d)) return null;
    const twelve = `978${d.slice(0, 9)}`;
    return twelve + isbn13Check(twelve);
  }
  return null;
}

// The shelves and the ISBNs already on them, from the site's data/books.json. null when the file could not be read:
// then any shelf id of the right shape is taken (the editor checks it), and only the database's duplicates are caught.
export function shelfInfo(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.shelves)) return null;
  const shelves = new Set(data.shelves.map((s) => s?.id).filter((id) => typeof id === 'string' && SHELF_ID.test(id)));
  if (!shelves.size) return null;
  const isbns = new Set((Array.isArray(data.books) ? data.books : []).map((b) => toIsbn13(b?.isbn13)).filter(Boolean));
  return { shelves, isbns };
}

const oneLine = (v) => String(v ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { title, authors, isbn, year, publisher?, shelf, pitch, relation, email?, confirm, website } -> { ok, book, spam }
// or { ok: false, message }. book is what public.stacks_submit_book takes: { title, authors, isbn13, year, publisher,
// shelf, pitch, relation, contact_email }. website is the honeypot, as for tips. info: shelfInfo(...) or null;
// now: for the latest year allowed (next year).
export function validateBook(body, { info = null, now = new Date() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send a JSON object.' };
  const spam = typeof body.website === 'string' ? body.website.trim() !== '' : body.website != null;
  const text = (k) => (body[k] == null || typeof body[k] === 'string' ? oneLine(body[k]) : null);

  const title = text('title');
  if (title === null || !title) return { ok: false, message: 'Give the book’s title.' };
  if (chars(title) > BOOK_LIMITS.title) return { ok: false, message: `Keep the title to ${BOOK_LIMITS.title} characters.` };
  const authors = text('authors');
  if (authors === null || !authors) return { ok: false, message: 'Name the author, or the authors separated by commas.' };
  if (chars(authors) > BOOK_LIMITS.authors) return { ok: false, message: `Keep the authors to ${BOOK_LIMITS.authors} characters.` };

  if (body.isbn == null || String(body.isbn).trim() === '') return { ok: false, message: 'Give the book’s ISBN (10 or 13 digits).' };
  const isbn13 = toIsbn13(body.isbn);
  if (!isbn13) return { ok: false, message: 'That ISBN doesn’t check out. Copy it from the back cover or the copyright page.' };

  const maxYear = new Date(now).getUTCFullYear() + 1;
  const year = typeof body.year === 'string' && /^\s*\d{4}\s*$/.test(body.year) ? Number(body.year) : body.year;
  if (!Number.isInteger(year) || year < 1800 || year > maxYear) return { ok: false, message: `Give the year it was published (1800 to ${maxYear}).` };

  const publisher = text('publisher');
  if (publisher === null) return { ok: false, message: 'publisher must be text.' };
  if (chars(publisher) > BOOK_LIMITS.publisher) return { ok: false, message: `Keep the publisher to ${BOOK_LIMITS.publisher} characters.` };

  const shelf = typeof body.shelf === 'string' ? body.shelf.trim() : '';
  if (!shelf || !SHELF_ID.test(shelf) || shelf.length > BOOK_LIMITS.shelf) return { ok: false, message: 'Choose the shelf it fits.' };
  if (info && !info.shelves.has(shelf)) return { ok: false, message: 'Choose one of the shelves in The Stacks.' };

  const pitch = text('pitch');
  if (pitch === null || !pitch) return { ok: false, message: 'Tell our editor about the book in a few sentences.' };
  if (chars(pitch) > BOOK_LIMITS.pitch) return { ok: false, message: `Keep it to ${BOOK_LIMITS.pitch} characters.` };

  if (body.relation !== 'author' && body.relation !== 'publisher') return { ok: false, message: 'Say whether you are the author or the publisher.' };

  const email = text('email');
  if (email === null) return { ok: false, message: 'email must be text.' };
  if (email && (chars(email) > BOOK_LIMITS.email || !EMAIL.test(email))) return { ok: false, message: 'That email address doesn’t look right. Leave it empty if you prefer.' };

  if (body.confirm !== true) return { ok: false, message: 'Tick the box to confirm the book is published and the details are right.' };

  return {
    ok: true,
    spam,
    book: { title, authors, isbn13, year, publisher: publisher || null, shelf, pitch, relation: body.relation, contact_email: email || null },
  };
}

// ───────────────────────────── ratings ─────────────────────────────

// What the public sees for one story: the count always, the average only from the 50th vote.
export function publicRating(votes, average) {
  const count = Number.isInteger(votes) && votes > 0 ? votes : Math.max(0, Math.trunc(Number(votes) || 0));
  const avg = Number(average);
  return { count, average: count >= VOTE_THRESHOLD && average != null && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null };
}

// Rows from public.weird_ratings -> { id: { count, average } } for every id asked for.
export function shapeRatings(rows, ids) {
  const out = {};
  for (const id of ids) out[id] = { count: 0, average: null };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && Object.hasOwn(out, r.story_id)) out[r.story_id] = publicRating(r.votes, r.average);
  }
  return out;
}

// Reader favourites (supabase/migrations/20261117090000_reader_favourites.sql).
// Rows from public.weird_favourites -> [{ storyId, count, average }], best first as the database ordered them.
export function shapeFavourites(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && isStoryId(r.story_id))
    .slice(0, 12)
    .map((r) => ({ storyId: r.story_id, ...publicRating(r.votes, r.average) }));
}

// ───────────────────────────── routing and replies ─────────────────────────────

// The route is the last path segment: Supabase passes "/community/vote" (or with /functions/v1 in front).
export function route(pathname) {
  const last = String(pathname ?? '').replace(/\/+$/, '').split('/').pop();
  return Object.hasOwn(ROUTE_METHOD, last) ? last : null;
}
export const ROUTE_METHOD = { vote: 'POST', ratings: 'GET', favourites: 'GET', tip: 'POST', click: 'POST', book: 'POST' };

// A database reply from weird_cast_vote / weird_submit_tip / weird_count_click / stacks_submit_book that was not
// { ok: true } -> the HTTP reply: 429 with retryAfter (seconds) for a limit, 409 for a book already put forward,
// 502 for anything else.
export function limitReply(result, kind = 'vote') {
  if (result?.error === 'duplicate') return { status: 409, body: { error: 'duplicate', message: BOOK_DUPLICATE }, headers: {} };
  if (result?.error !== 'rate_limited' && result?.error !== 'tips_full' && result?.error !== 'books_full') {
    return { status: 502, body: { error: 'unavailable', message: 'That could not be saved. Try again in a minute.' }, headers: {} };
  }
  const retryAfter = Math.max(1, Math.trunc(Number(result?.retry_after) || 60));
  const error = result?.error === 'tips_full' || result?.error === 'books_full' ? result.error : 'rate_limited';
  const message = error === 'tips_full'
    ? 'The tip box is full for today. Try again tomorrow.'
    : error === 'books_full' ? 'Our editor has all the books they can read today. Try again tomorrow.'
    : kind === 'tip' ? 'You’ve sent the most tips we take in a day. Try again tomorrow.'
      : kind === 'book' ? 'You’ve put forward the most books we take in a day. Try again tomorrow.'
      : kind === 'click' ? 'That’s a lot of clicks. They are not being counted for a while.' : 'That’s a lot of votes. Wait a while, then try again.';
  return { status: 429, body: { error, message, retryAfter }, headers: { 'Retry-After': String(retryAfter) } };
}

// ───────────────────────────── CORS ─────────────────────────────

// Gatecast's own pages: production (thegatecast.com, with and without www, and the address the site had
// until 18 Nov 2026, which still answers), the gatecast project's Vercel previews (gatecast-<hash>- and
// gatecast-git-<branch>- under the owner's scope), local servers, and any extra origins listed in the
// optional COMMUNITY_ALLOWED_ORIGINS secret.
const PROD = ['https://thegatecast.com', 'https://www.thegatecast.com', 'https://gatecast.vercel.app'];
const PREVIEW = /^https:\/\/gatecast-[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?-victorparkerr-4350s-projects\.vercel\.app$/;
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export function originAllowed(origin, extra = []) {
  if (typeof origin !== 'string' || !origin || origin.length > 200) return false;
  if (extra.includes(origin)) return true;
  return PROD.includes(origin) || PREVIEW.test(origin) || LOCAL.test(origin);
}

export function corsHeaders(origin, extra = []) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (originAllowed(origin, extra)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

// A browser on another site may still send a "simple" POST without asking first. Writes are refused when the
// request names an origin that is not ours, and must be JSON (which makes a browser ask first).
export function writeAllowed(origin, contentType, extra = []) {
  if (!/^application\/json\b/i.test(String(contentType ?? '').trim())) return { ok: false, status: 415, error: 'json_required' };
  if (origin && !originAllowed(origin, extra)) return { ok: false, status: 403, error: 'origin_not_allowed' };
  return { ok: true };
}
