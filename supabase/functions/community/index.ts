// Community features for anonymous visitors: the Weird-o-meter, reader favourites, the guestbook, anonymous click
// totals, and books put forward for The Stacks by their author or publisher. See docs/community.md.
//
// Deployed with verify_jwt off (`supabase functions deploy community --no-verify-jwt`): visitors are not signed
// in. Who a visitor is, for one-vote-per-story and the limits, is a salted SHA-256 of their network address;
// the address itself is never stored or logged.
//
//   POST /functions/v1/community/vote     { storyUrl, rating }        -> { count, average | null, yours }
//   GET  /functions/v1/community/ratings?ids=a,b,c (at most 60)        -> { ratings: { id: { count, average | null } } }
//   GET  /functions/v1/community/favourites                             -> { favourites: [{ storyId, count, average | null }] }
//        (needs supabase/migrations/20261117090000_reader_favourites.sql; until that is applied it answers 502)
//   POST /functions/v1/community/tip      { url, note, website }      -> { ok: true }
//   POST /functions/v1/community/click    { storyUrl }                -> 204, no body
//        (one click on a weird story's link: added to that story's total for the UTC day; nothing about the visitor
//        is stored with it. Needs the same migration; until then it answers 502)
//   POST /functions/v1/community/book     { title, authors, isbn, year, publisher?, shelf, pitch, relation, email?, confirm: true, website }
//                                                                       -> { ok: true } | 409 { error: 'duplicate', message }
//        (a book put forward for The Stacks; it waits for the editor in the reviewer console. Needs
//        supabase/migrations/20261117120000_stacks_submissions.sql; until then it answers 502)
//
// The database does the counting and enforces the limits (votes 60 per visitor per hour; tips 5 per visitor per
// UTC day and 200 per UTC day in all; clicks 120 per visitor per hour) through definer functions only the service
// role may call; books 3 per visitor per UTC day and 50 per UTC day in all. Tipped links are checked by shape and
// never fetched. A book's shelf is checked against the site's own data/books.json, read at most every 10 minutes. The pure logic is in logic.mjs
// (tests/community.test.mjs).

import {
  BODY_MAX, bookHash, clickHash, clientAddress, clientKey, corsHeaders, dayBucket, limitReply, parseIds, route, ROUTE_METHOD, saltReady, shapeRatings,
  storyId, tipHash, validateClick, validateTip, validateVote, voterHash, writeAllowed, publicRating, shapeFavourites,
  validateBook, shelfInfo, BOOK_DUPLICATE,
} from './logic.mjs';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SALT = Deno.env.get('COMMUNITY_SALT') ?? '';
const EXTRA_ORIGINS = (Deno.env.get('COMMUNITY_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Where the site's data/books.json lives (the shelves a book may be put forward for). Optional; the default is the
// site's own address (lib/site.js SITE_ORIGIN).
const SITE = (Deno.env.get('COMMUNITY_SITE_ORIGIN') ?? 'https://www.thegatecast.com').replace(/\/+$/, '');

type Json = Record<string, unknown>;
type Rpc = { ok: true; data: unknown } | { ok: false; status: number };

// One call to a database function as the service role. Never throws.
async function rpc(fn: string, args: Json): Promise<Rpc> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // The code and message go to the function log; no visitor data is in them.
      console.error(JSON.stringify({ community: fn, status: res.status, code: (data as Json | null)?.code ?? null }));
      return { ok: false, status: res.status };
    }
    return { ok: true, data };
  } catch (err) {
    console.error(JSON.stringify({ community: fn, error: err instanceof DOMException ? err.name : 'network' }));
    return { ok: false, status: 0 };
  }
}

// The shelves and the ISBNs already on them, from the site's data/books.json: kept 10 minutes, or 1 minute after a
// failed read. null when unreadable (any shelf id of the right shape is then accepted; the editor checks it).
type ShelfInfo = { shelves: Set<string>; isbns: Set<string> } | null;
let shelfCache: { at: number; ttl: number; info: ShelfInfo } | null = null;
async function siteShelves(): Promise<ShelfInfo> {
  if (shelfCache && Date.now() - shelfCache.at < shelfCache.ttl) return shelfCache.info;
  let info: ShelfInfo = null;
  try {
    const res = await fetch(`${SITE}/data/books.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (res.ok) info = shelfInfo(await res.json());
  } catch {
    info = null;
  }
  if (!info) console.error(JSON.stringify({ community: 'shelves_unreadable' }));
  shelfCache = { at: Date.now(), ttl: info ? 10 * 60e3 : 60e3, info };
  return info;
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const raw = await req.text();
  if (raw.length > BODY_MAX) return { ok: false, status: 413, message: 'The request is too large.' };
  try { return { ok: true, body: JSON.parse(raw) }; } catch { return { ok: false, status: 400, message: 'Send a JSON body.' }; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = corsHeaders(origin, EXTRA_ORIGINS);
  const reply = (body: Json, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
    });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // Refuse to run half-configured: without the salt, hashes could be reversed by trying every address.
  if (!SB_URL || !SB_KEY || !saltReady(SALT)) {
    console.error(JSON.stringify({ community: 'not_configured', salt: saltReady(SALT), service: Boolean(SB_URL && SB_KEY) }));
    return reply({ error: 'not_configured', message: 'Votes and tips are switched off for now.' }, 503);
  }

  const url = new URL(req.url);
  const r = route(url.pathname);
  if (!r) return reply({ error: 'not_found' }, 404);
  if (req.method !== ROUTE_METHOD[r]) return reply({ error: 'method_not_allowed' }, 405, { Allow: `${ROUTE_METHOD[r]}, OPTIONS` });

  // ── GET /ratings ──
  if (r === 'ratings') {
    const ids = parseIds(url.searchParams.get('ids'));
    if (!ids.ok) return reply({ error: 'bad_request', message: ids.message }, 400);
    const res = await rpc('weird_ratings', { ids: ids.ids });
    if (!res.ok) return reply({ error: 'unavailable' }, 502);
    return reply({ ratings: shapeRatings(res.data, ids.ids) }, 200, { 'Cache-Control': 'public, max-age=30' });
  }

  // ── GET /favourites ── The database's defaults: 7 days, at least 10 votes, 12 stories, best average then most
  // votes; the average itself only from 50 votes.
  if (r === 'favourites') {
    const res = await rpc('weird_favourites', {});
    if (!res.ok) return reply({ error: 'unavailable' }, 502);
    return reply({ favourites: shapeFavourites(res.data) }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // ── writes ──
  const gate = writeAllowed(origin, req.headers.get('content-type'), EXTRA_ORIGINS);
  if (!gate.ok) return reply({ error: gate.error }, gate.status);

  const who = clientKey(clientAddress((name: string) => req.headers.get(name)));
  if (!who) return reply({ error: 'no_client_address', message: 'Your connection could not be identified, so this was not saved.' }, 400);

  const parsed = await readJson(req);
  if (!parsed.ok) return reply({ error: 'bad_request', message: parsed.message }, parsed.status);

  // ── POST /vote ──
  if (r === 'vote') {
    const v = validateVote(parsed.body);
    if (!v.ok) return reply({ error: 'bad_request', message: v.message }, 400);
    const res = await rpc('weird_cast_vote', {
      p_story_id: await storyId(v.url),
      p_voter_hash: await voterHash(SALT, who),
      p_rating: v.rating,
    });
    if (!res.ok) return reply({ error: 'unavailable', message: 'Your vote could not be saved. Try again in a minute.' }, 502);
    const out = res.data as Json | null;
    if (out?.ok !== true) {
      const limit = limitReply(out, 'vote');
      return reply(limit.body, limit.status, limit.headers);
    }
    return reply({ ...publicRating(out.votes as number, out.average as number | null), yours: v.rating });
  }

  // ── POST /click ── Only the story's address is read from the body. The visitor's hash goes to the rate limit only;
  // weird_count_click stores no hash with the click. Answers 204: a beacon reads no reply.
  if (r === 'click') {
    const c = validateClick(parsed.body);
    if (!c.ok) return reply({ error: 'bad_request', message: c.message }, 400);
    const res = await rpc('weird_count_click', { p_story_id: await storyId(c.url), p_ip_hash: await clickHash(SALT, who, dayBucket()) });
    if (!res.ok) return reply({ error: 'unavailable' }, 502);
    const out = res.data as Json | null;
    if (out?.ok !== true) {
      const limit = limitReply(out, 'click');
      return reply(limit.body, limit.status, limit.headers);
    }
    return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  }

  // ── POST /book ── A book put forward for The Stacks. The honeypot answers as usual and stores nothing. A book already
  // on the static shelves is a duplicate here; one already waiting or approved is caught by the database.
  if (r === 'book') {
    const info = await siteShelves();
    const b = validateBook(parsed.body, { info });
    if (!b.ok) return reply({ error: 'bad_request', message: b.message }, 400);
    if (b.spam) return reply({ ok: true });
    if (info?.isbns.has(b.book.isbn13)) return reply({ error: 'duplicate', message: BOOK_DUPLICATE }, 409);
    const res = await rpc('stacks_submit_book', { p: b.book, p_ip_hash: await bookHash(SALT, who, dayBucket()) });
    if (!res.ok) return reply({ error: 'unavailable', message: 'Your book could not be sent. Try again in a minute.' }, 502);
    const out = res.data as Json | null;
    if (out?.ok !== true) {
      const limit = limitReply(out, 'book');
      return reply(limit.body, limit.status, limit.headers);
    }
    return reply({ ok: true });
  }

  // ── POST /tip ──
  const t = validateTip(parsed.body);
  if (!t.ok) return reply({ error: 'bad_request', message: t.message }, 400);
  if (t.spam) return reply({ ok: true }); // the honeypot was filled: answer as usual, store nothing
  const res = await rpc('weird_submit_tip', { p_url: t.url, p_note: t.note, p_ip_hash: await tipHash(SALT, who, dayBucket()) });
  if (!res.ok) return reply({ error: 'unavailable', message: 'Your tip could not be sent. Try again in a minute.' }, 502);
  const out = res.data as Json | null;
  if (out?.ok !== true) {
    const limit = limitReply(out, 'tip');
    return reply(limit.body, limit.status, limit.headers);
  }
  return reply({ ok: true });
});
