// Reader votes (the Weird-o-meter) and guestbook tips, from the browser. Talks to the `community` Edge Function
// in Supabase (supabase/functions/community; docs/community.md). Every call resolves; none throws.
//
//   storyId(url)            -> Promise<string | null>   first 16 hex of SHA-256 of the normalised story URL
//   loadRatings(urls)       -> Promise<{ [url]: { count, average | null, yours | null } }>   {} on failure
//   rateStory(url, rating)  -> Promise<{ ok: true, count, average | null, yours } | { ok: false, error, retryAfter? }>
//   sendTip({ url, note, website }) -> Promise<{ ok: true } | { ok: false, error }>
//   yourVote(url)           -> Promise<number | null>   this browser's own vote, remembered locally
//   loadFavourites()        -> Promise<[{ storyId, count, average | null }]>   PAUSED addition: reader favourites, best
//                              first; [] on failure, and always [] until supabase/paused/weird_favourites.sql is applied
//                              (up to 12 stories with at least 10 votes in the last 7 days; match them to items
//                              with storyId(item.url))
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

// PAUSED addition (see supabase/paused/weird_favourites.sql): not used by any page yet.
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
