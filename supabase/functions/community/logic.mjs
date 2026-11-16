// Weird-news community function: the pure part. No Deno, no npm, no network.
// index.ts (the Supabase Edge Function) imports this; tests/community.test.mjs tests it from Node.
//
// What lives here: the story-URL normaliser and story id (the browser has the same code in js/community.js,
// and the tests check they agree), hashing a visitor's address, request validation for votes, ratings and
// tips, the public-host check for tipped links, the 50-vote rule, routing, CORS origins and error replies.

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

// The visitor's address from the first hop of x-forwarded-for, as the identity votes and tips are counted by:
// an IPv4 address as written, an IPv6 address cut to its /64 (one home or phone usually holds a whole /64 and
// can change the rest at will). null when the header has no usable address.
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

// PAUSED addition (reader favourites, supabase/paused/weird_favourites.sql).
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
export const ROUTE_METHOD = { vote: 'POST', ratings: 'GET', favourites: 'GET', tip: 'POST' };

// A database reply from weird_cast_vote / weird_submit_tip that was not { ok: true } -> the HTTP reply:
// 429 with retryAfter (seconds) for a limit, 502 for anything else.
export function limitReply(result, kind = 'vote') {
  if (result?.error !== 'rate_limited' && result?.error !== 'tips_full') {
    return { status: 502, body: { error: 'unavailable', message: 'That could not be saved. Try again in a minute.' }, headers: {} };
  }
  const retryAfter = Math.max(1, Math.trunc(Number(result?.retry_after) || 60));
  const error = result?.error === 'tips_full' ? 'tips_full' : 'rate_limited';
  const message = error === 'tips_full'
    ? 'The tip box is full for today. Try again tomorrow.'
    : kind === 'tip' ? 'You’ve sent the most tips we take in a day. Try again tomorrow.' : 'That’s a lot of votes. Wait a while, then try again.';
  return { status: 429, body: { error, message, retryAfter }, headers: { 'Retry-After': String(retryAfter) } };
}

// ───────────────────────────── CORS ─────────────────────────────

// Gatecast's own pages: production, the gatecast project's Vercel previews (gatecast-<hash>- and
// gatecast-git-<branch>- under the owner's scope), local servers, and any extra origins listed in the
// optional COMMUNITY_ALLOWED_ORIGINS secret (a custom domain).
const PROD = 'https://gatecast.vercel.app';
const PREVIEW = /^https:\/\/gatecast-[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?-victorparkerr-4350s-projects\.vercel\.app$/;
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export function originAllowed(origin, extra = []) {
  if (typeof origin !== 'string' || !origin || origin.length > 200) return false;
  if (extra.includes(origin)) return true;
  return origin === PROD || PREVIEW.test(origin) || LOCAL.test(origin);
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
