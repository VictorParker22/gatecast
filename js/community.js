// Reader votes (the Weird-o-meter), reader favourites, guestbook tips and anonymous click counts, from the browser.
// Talks to the `community` Edge Function in Supabase (supabase/functions/community; docs/community.md). Every call
// resolves (or returns at once); none throws.
//
//   storyId(url)            -> Promise<string | null>   first 16 hex of SHA-256 of the normalised story URL
//   loadRatings(urls)       -> Promise<{ [url]: { count, average | null, yours | null } }>   {} on failure
//   rateStory(url, rating)  -> Promise<{ ok: true, count, average | null, yours } | { ok: false, error, retryAfter? }>
//   sendTip({ url, note, website }) -> Promise<{ ok: true } | { ok: false, error }>
//   bookProblems(fields)    -> [{ field, message }]   the book form's checks, the same as the function's (validateBook)
//   submitBook({ title, authors, isbn, year, publisher, shelf, pitch, relation, email, confirm, website })
//                           -> Promise<{ ok: true } | { ok: false, error, field?, duplicate? }>   a book put forward by
//                              its author or publisher, for the editor (POST /book)
//   yourVote(url)           -> Promise<number | null>   this browser's own vote, remembered locally
//   loadFavourites()        -> Promise<[{ storyId, count, average | null }]>   reader favourites, best first: up to 12
//                              stories with at least 10 votes in the last 7 days, ranked by the database (average,
//                              then votes); [] on failure. Match them to items with storyId(item.url)
//   clickAllowed()          -> boolean   false when the browser sends Do Not Track or Global Privacy Control
//   countClick(url)         -> boolean   fire-and-forget: adds one to that story's anonymous click total. Sends the
//                              story's address and nothing else, never waits, never blocks the link; skipped when
//                              clickAllowed() is false or the address is not a story link
//
// `average` stays null until 50 people have voted on a story. The normaliser and hash are the same as the
// function's (supabase/functions/community/logic.mjs); tests/community.test.mjs checks that they agree.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const BASE = `${SUPABASE_URL}/functions/v1/community`;
export const VOTE_THRESHOLD = 50;
export const NOTE_MAX = 280;
const URL_MAX = 2048;
const TIMEOUT_MS = 8000;
const MINE_KEY = 'gatecast:weird-votes';
const MINE_MAX = 500;

/* ---------- Story ids (same as the function) ---------- */

const TRACKING = /^(utm_.*|fbclid|gclid)$/i;

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

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function storyId(url) {
  const n = normaliseStoryUrl(url);
  if (!n) return null;
  try { return (await sha256Hex(n)).slice(0, 16); } catch { return null; }
}

/* ---------- This browser's own votes ---------- */

function readMine() {
  try { const v = JSON.parse(localStorage.getItem(MINE_KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function remember(id, rating) {
  try {
    const mine = readMine();
    delete mine[id];
    mine[id] = rating; // newest last, so the oldest go first when the list is full
    const keys = Object.keys(mine);
    for (const k of keys.slice(0, Math.max(0, keys.length - MINE_MAX))) delete mine[k];
    localStorage.setItem(MINE_KEY, JSON.stringify(mine));
  } catch {}
}
const validRating = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? n : null);

export async function yourVote(url) {
  const id = await storyId(url);
  return id ? validRating(readMine()[id]) : null;
}

/* ---------- Replies ---------- */

// A reply from the function as one plain sentence for the visitor.
export function errorMessage(status, body) {
  if (body && typeof body.message === 'string' && body.message) return body.message;
  if (status === 429) return 'Too many tries just now. Wait a while, then try again.';
  if (status === 503) return 'Votes and tips are switched off for now.';
  if (status === 0) return 'Couldn’t reach Gatecast’s server. Check your connection and try again.';
  return 'Something went wrong. Try again in a minute.';
}

// count/average as the meter shows them; never trusts a stray average below the threshold.
export function shapeRating(r) {
  const count = Number.isInteger(r?.count) && r.count > 0 ? r.count : 0;
  const avg = Number(r?.average);
  return { count, average: count >= VOTE_THRESHOLD && r?.average != null && Number.isFinite(avg) ? avg : null };
}

async function call(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}

/* ---------- Public calls ---------- */

export async function loadRatings(urls) {
  try {
    const list = [...new Set((Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string'))];
    const pairs = (await Promise.all(list.map(async (u) => [u, await storyId(u)]))).filter(([, id]) => id);
    if (!pairs.length) return {};
    const mine = readMine();
    const out = {};
    const ids = [...new Set(pairs.map(([, id]) => id))];
    for (let i = 0; i < ids.length; i += 60) {
      const chunk = ids.slice(i, i + 60);
      const r = await call(`ratings?ids=${chunk.join(',')}`);
      if (!r.ok || !r.data?.ratings) continue;
      for (const [u, id] of pairs) {
        if (r.data.ratings[id]) out[u] = { ...shapeRating(r.data.ratings[id]), yours: validRating(mine[id]) };
      }
    }
    return out;
  } catch { return {}; }
}

// The front page's favourites row (js/front.js) and the console's preview of it.
export async function loadFavourites() {
  try {
    const r = await call('favourites');
    if (!r.ok || !Array.isArray(r.data?.favourites)) return [];
    return r.data.favourites
      .filter((f) => f && typeof f.storyId === 'string' && /^[0-9a-f]{16}$/.test(f.storyId))
      .slice(0, 12)
      .map((f) => ({ storyId: f.storyId, ...shapeRating(f) }));
  } catch { return []; }
}

export async function rateStory(url, rating) {
  const n = validRating(rating);
  if (!n) return { ok: false, error: 'Pick a number from 1 to 5.' };
  const id = await storyId(url);
  if (!id) return { ok: false, error: 'This story’s link can’t be rated.' };
  const r = await call('vote', { method: 'POST', body: { storyUrl: url, rating: n } });
  if (!r.ok) {
    const out = { ok: false, error: errorMessage(r.status, r.data) };
    if (r.status === 429 && Number.isFinite(Number(r.data?.retryAfter))) out.retryAfter = Number(r.data.retryAfter);
    return out;
  }
  remember(id, n);
  return { ok: true, ...shapeRating(r.data), yours: n };
}

// Checks the shape before sending, so the visitor hears about a typo at once. The server checks again.
export function tipProblem({ url, note } = {}) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return 'Paste the link to the story.';
  let u;
  try { u = new URL(s); } catch { return 'That doesn’t look like a web address. Paste the full link, starting https://'; }
  if (u.protocol !== 'https:') return 'Use the story’s https:// link.';
  if (s.length > URL_MAX) return 'That link is too long.';
  if (note != null && [...String(note).trim()].length > NOTE_MAX) return `Keep the note to ${NOTE_MAX} characters.`;
  return null;
}

export async function sendTip({ url, note = '', website = '' } = {}) {
  const problem = tipProblem({ url, note });
  if (problem) return { ok: false, error: problem };
  const r = await call('tip', { method: 'POST', body: { url: String(url).trim(), note: String(note ?? '').trim(), website: String(website ?? '') } });
  if (r.ok && r.data?.ok === true) return { ok: true };
  return { ok: false, error: errorMessage(r.status, r.data) };
}

/* ---------- Books put forward for The Stacks ---------- */

// The same limits, ISBN check and messages as the function (supabase/functions/community/logic.mjs validateBook;
// tests/community.test.mjs checks they agree), so the form can say what is wrong next to the field at once.
export const BOOK_LIMITS = { title: 200, authors: 200, publisher: 120, pitch: 600, email: 254, shelf: 40 };
const SHELF_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOK_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chars = (s) => [...s].length;
const line = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();

function isbn13Digit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
// ISBN-10 or ISBN-13 as typed (hyphens and spaces allowed) -> the 13 digits, or null when the check digit is wrong.
export function isbn13(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = String(raw).toUpperCase().replace(/^ISBN(?:-1[03])?:?/, '').replace(/[\s-]+/g, '');
  if (/^97[89][0-9]{10}$/.test(d)) return isbn13Digit(d) === d[12] ? d : null;
  if (/^[0-9]{9}[0-9X]$/.test(d)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
    if (sum % 11 !== 0) return null;
    const twelve = `978${d.slice(0, 9)}`;
    return twelve + isbn13Digit(twelve);
  }
  return null;
}

// Every problem with the form, in the form's order: [{ field, message }], [] when it can be sent. `shelves`: the
// shelf ids the form offers (null: any id of the right shape). `now`: for the latest year allowed (next year).
export function bookProblems(f = {}, { shelves = null, now = new Date() } = {}) {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  const title = line(f.title), authors = line(f.authors), publisher = line(f.publisher), pitch = line(f.pitch), email = line(f.email);
  if (!title) add('title', 'Give the book’s title.');
  else if (chars(title) > BOOK_LIMITS.title) add('title', `Keep the title to ${BOOK_LIMITS.title} characters.`);
  if (!authors) add('authors', 'Name the author, or the authors separated by commas.');
  else if (chars(authors) > BOOK_LIMITS.authors) add('authors', `Keep the authors to ${BOOK_LIMITS.authors} characters.`);
  if (f.isbn == null || String(f.isbn).trim() === '') add('isbn', 'Give the book’s ISBN (10 or 13 digits).');
  else if (!isbn13(f.isbn)) add('isbn', 'That ISBN doesn’t check out. Copy it from the back cover or the copyright page.');
  const maxYear = new Date(now).getUTCFullYear() + 1;
  const year = typeof f.year === 'string' && /^\s*\d{4}\s*$/.test(f.year) ? Number(f.year) : f.year;
  if (!Number.isInteger(year) || year < 1800 || year > maxYear) add('year', `Give the year it was published (1800 to ${maxYear}).`);
  if (chars(publisher) > BOOK_LIMITS.publisher) add('publisher', `Keep the publisher to ${BOOK_LIMITS.publisher} characters.`);
  const shelf = typeof f.shelf === 'string' ? f.shelf.trim() : '';
  if (!shelf || !SHELF_ID.test(shelf) || shelf.length > BOOK_LIMITS.shelf) add('shelf', 'Choose the shelf it fits.');
  else if (shelves && !shelves.includes(shelf)) add('shelf', 'Choose one of the shelves in The Stacks.');
  if (!pitch) add('pitch', 'Tell our editor about the book in a few sentences.');
  else if (chars(pitch) > BOOK_LIMITS.pitch) add('pitch', `Keep it to ${BOOK_LIMITS.pitch} characters.`);
  if (f.relation !== 'author' && f.relation !== 'publisher') add('relation', 'Say whether you are the author or the publisher.');
  if (email && (chars(email) > BOOK_LIMITS.email || !BOOK_EMAIL.test(email))) add('email', 'That email address doesn’t look right. Leave it empty if you prefer.');
  if (f.confirm !== true) add('confirm', 'Tick the box to confirm the book is published and the details are right.');
  return out;
}

// Sends a book to the editor. Checks it first (bookProblems); the function checks again and answers
// { ok: true }, 400 { message }, 409 duplicate or 429.
export async function submitBook(f = {}, opts = {}) {
  const problems = bookProblems(f, opts);
  if (problems.length) return { ok: false, error: problems[0].message, field: problems[0].field };
  const year = typeof f.year === 'string' ? Number(f.year.trim()) : f.year;
  const body = {
    title: line(f.title), authors: line(f.authors), isbn: String(f.isbn).trim(), year, publisher: line(f.publisher) || undefined,
    shelf: String(f.shelf).trim(), pitch: line(f.pitch), relation: f.relation, email: line(f.email) || undefined, confirm: true,
    website: String(f.website ?? ''),
  };
  const r = await call('book', { method: 'POST', body });
  if (r.ok && r.data?.ok === true) return { ok: true };
  const out = { ok: false, error: errorMessage(r.status, r.data) };
  if (r.status === 409 || r.data?.error === 'duplicate') out.duplicate = true;
  return out;
}

/* ---------- Clicks: anonymous totals per story ---------- */

const DNT_ON = (v) => v === '1' || v === 'yes' || v === 1 || v === true;

// The visitor asked not to be tracked: Global Privacy Control, or Do Not Track in any of its historical spellings.
export function clickAllowed(nav = globalThis.navigator, win = globalThis) {
  try {
    if (nav?.globalPrivacyControl === true) return false;
    return ![nav?.doNotTrack, win?.doNotTrack, nav?.msDoNotTrack].some(DNT_ON);
  } catch { return false; }
}

// One click on a weird story's link. Never awaited and never throws, so the link opens as normal. Uses a keepalive
// fetch (it outlives the page as the reader leaves for the outlet, and can carry the apikey and JSON the function
// requires); sendBeacon is the fallback where keepalive fetch is missing. The body is the story's normalised
// address (tracking parameters dropped) and nothing else; no referrer, no credentials. Returns whether it was sent.
export function countClick(url, env = {}) {
  try {
    const nav = 'navigator' in env ? env.navigator : globalThis.navigator;
    if (!clickAllowed(nav, 'window' in env ? env.window : globalThis)) return false;
    const storyUrl = normaliseStoryUrl(url);
    if (!storyUrl) return false;
    const body = JSON.stringify({ storyUrl });
    const send = 'fetch' in env ? env.fetch : globalThis.fetch;
    if (typeof send === 'function') {
      try {
        const p = send(`${BASE}/click`, {
          method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body,
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return true;
      } catch { /* keepalive refused (body quota, old browser): try the beacon */ }
    }
    if (typeof nav?.sendBeacon === 'function' && typeof Blob === 'function') {
      return nav.sendBeacon(`${BASE}/click`, new Blob([body], { type: 'application/json' })) === true;
    }
  } catch {}
  return false;
}
