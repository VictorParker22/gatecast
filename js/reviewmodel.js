// Pure logic for the reviewer console (review.html): views and counts, side coverage and whether a topic can
// be published, sorting and search, relative times, form checks, the sign-in return and session refresh, and
// how to read replies from the database and the assistant. No DOM and no network, so it is unit-tested with
// plain Node. The database (row rules and triggers) stays the authority; these checks only explain early.
import { STATE_NAMES, stateCode, safeUrl, fmtDate, SIDE_LABEL } from './civicmodel.js';
import { normaliseStoryUrl } from './community.js';

/* ---------- Views, statuses and counts ---------- */

export const STATUS_LABEL = { draft: 'Draft', published: 'Published', rejected: 'Rejected' };

export const VIEWS = {
  needs: { title: 'Needs review', status: 'draft', empty: 'Nothing waiting. New drafts appear here.' },
  published: { title: 'Published', status: 'published', empty: 'Nothing published yet. A draft with both sides can be published from its page.' },
  rejected: { title: 'Rejected', status: 'rejected', empty: 'Nothing rejected.' },
  all: { title: 'All topics', status: null, empty: 'No topics yet. Start one with New topic.' },
  votes: { title: 'Statehouse votes', empty: 'No votes to show. Votes appear here once the collector has run and the reviewer-console migration is applied, or while the switch is on.' },
  collector: { title: 'Collector', empty: 'No collector runs recorded.' },
  tips: { title: 'Tips', empty: 'No new tips. Links visitors send from the guestbook appear here.' },
  picks: { title: 'Picks', empty: 'No picks yet. Start one with New pick, or accept a tip.' },
};

export function counts(topics) {
  const c = { needs: 0, published: 0, rejected: 0, all: 0 };
  for (const t of Array.isArray(topics) ? topics : []) {
    if (!t) continue;
    c.all++;
    if (t.status === 'draft') c.needs++;
    else if (t.status === 'published') c.published++;
    else if (t.status === 'rejected') c.rejected++;
  }
  return c;
}

/* ---------- Sides ---------- */

export function bySide(statements) {
  const out = { D: [], R: [], other: [] };
  for (const s of Array.isArray(statements) ? statements : []) if (s && out[s.side]) out[s.side].push(s);
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return out;
}

export function coverage(topic) {
  const g = bySide(topic?.statements);
  return { D: g.D.length > 0, R: g.R.length > 0, other: g.other.length, count: g.D.length + g.R.length + g.other.length };
}

// Why a topic cannot be published yet, mirroring the database trigger, or null when it can be.
export function publishBlock(topic) {
  if (!topic) return 'Choose a topic.';
  if (topic.status === 'published') return 'Already published.';
  const c = coverage(topic);
  if (!c.D && !c.R) return 'Add a Democrat and a Republican statement before publishing.';
  if (!c.D) return 'Add a Democrat statement before publishing.';
  if (!c.R) return 'Add a Republican statement before publishing.';
  return null;
}

// Which side a new statement most likely needs: the first missing one.
export function missingSide(topic) {
  const c = coverage(topic);
  return !c.D ? 'D' : !c.R ? 'R' : 'other';
}

/* ---------- Sorting and search ---------- */

const ms = (s) => { const t = Date.parse(s ?? ''); return Number.isFinite(t) ? t : 0; };
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function placeLabel(place) {
  return place === 'US' ? 'National' : STATE_NAMES[place] || String(place ?? '');
}

// Title, place (code or name) and any speaker.
export function matchesTopic(topic, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([topic?.title, topic?.place, placeLabel(topic?.place), ...(topic?.statements || []).map((s) => s?.speaker)].join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}

export function matchesVote(v, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([v?.bill_identifier, v?.bill_title, v?.state, STATE_NAMES[v?.state], v?.chamber_name].join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}

// Needs review is a queue: oldest draft first. Published: most recently published first. Others: newest first.
export function topicsForView(topics, view, q = '') {
  const def = VIEWS[view];
  if (!def || !('status' in def)) return [];
  const list = (Array.isArray(topics) ? topics : []).filter((t) => t && (!def.status || t.status === def.status) && matchesTopic(t, q));
  if (view === 'needs') return list.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  if (view === 'published') return list.sort((a, b) => ms(b.published_at) - ms(a.published_at));
  return list.sort((a, b) => ms(b.created_at) - ms(a.created_at));
}

/* ---------- Time ---------- */

// "just now", "4 min ago", "2 h ago", "3 d ago", then a date.
export function relTime(iso, now = Date.now()) {
  const t = ms(iso);
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return `on ${fmtDate(iso)}`;
}

/* ---------- Keyboard ---------- */

// New active row for a key in the list, or null when the key is not ours.
export function moveIndex(i, key, n) {
  if (!n) return null;
  const cur = Number.isInteger(i) && i >= 0 ? i : -1;
  if (key === 'j' || key === 'ArrowDown') return Math.min(n - 1, cur + 1);
  if (key === 'k' || key === 'ArrowUp') return cur < 0 ? 0 : Math.max(0, cur - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

/* ---------- Forms ---------- */

export const LIMITS = { title: 200, neutral_fact: 600, speaker: 120, role: 160, quote: 1200, note: 2000 };

export function counter(text, max) {
  const n = String(text ?? '').trim().length;
  return { n, over: n > max, text: `${n.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}` };
}

const httpsOk = (u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u.trim()) && safeUrl(u.trim()) !== null;
const len = (s) => String(s ?? '').trim().length;

// Field -> message, mirroring the database checks so a reviewer sees them before sending.
export function topicErrors(f) {
  const e = {};
  if (!len(f.title)) e.title = 'Give the topic a title.';
  else if (len(f.title) > LIMITS.title) e.title = 'Keep the title to 200 characters.';
  if (f.place !== 'US' && !stateCode(f.place)) e.place = 'Choose national or a state.';
  if (!len(f.neutral_fact)) e.neutral_fact = 'Add the neutral fact.';
  else if (len(f.neutral_fact) > LIMITS.neutral_fact) e.neutral_fact = 'Keep the fact to 600 characters.';
  if (!httpsOk(f.neutral_fact_source)) e.neutral_fact_source = 'Link the source with an address starting https://';
  return e;
}

export function statementErrors(f) {
  const e = {};
  if (!Object.hasOwn(SIDE_LABEL, f.side)) e.side = 'Choose a side.';
  if (!len(f.speaker)) e.speaker = 'Name who said it.';
  else if (len(f.speaker) > LIMITS.speaker) e.speaker = 'Keep the name to 120 characters.';
  if (len(f.role) > LIMITS.role) e.role = 'Keep the role to 160 characters.';
  if (!len(f.quote)) e.quote = 'Paste the quote in full.';
  else if (len(f.quote) > LIMITS.quote) e.quote = 'The quote is over 1,200 characters; the database will not take it.';
  if (f.said_on && !/^\d{4}-\d\d-\d\d$/.test(f.said_on)) e.said_on = 'Use a full date.';
  if (!httpsOk(f.source_url)) e.source_url = 'Link the source with an address starting https://';
  return e;
}

// Trimmed values ready to send; empty optional fields become null.
export function cleanTopic(f) {
  return { title: String(f.title ?? '').trim(), place: f.place === 'US' ? 'US' : stateCode(f.place), neutral_fact: String(f.neutral_fact ?? '').trim(), neutral_fact_source: String(f.neutral_fact_source ?? '').trim() };
}
export function cleanStatement(f) {
  return {
    side: f.side, speaker: String(f.speaker ?? '').trim(), role: String(f.role ?? '').trim() || null,
    quote: String(f.quote ?? '').trim(), said_on: f.said_on || null, source_url: String(f.source_url ?? '').trim(),
  };
}

/* ---------- Activity ---------- */

const ACTION_WORD = { published: 'Published', withdrawn: 'Withdrawn to draft', deleted: 'Deleted' };

// The topic's history, oldest first: its creation, then the review log when the API can read it, otherwise
// the publish time the topic itself carries.
export function timeline(topic, activity) {
  if (!topic) return [];
  const out = [];
  if (topic.created_at) out.push({ at: topic.created_at, text: 'Created as a draft' });
  if (Array.isArray(activity)) {
    for (const a of activity) {
      if (!a?.at || !ACTION_WORD[a.action]) continue;
      out.push({ at: a.at, text: ACTION_WORD[a.action] + (a.actor_email ? ` by ${a.actor_email}` : '') });
    }
  } else if (topic.published_at) {
    out.push({ at: topic.published_at, text: 'Published' });
  }
  if (topic.status === 'rejected') out.push({ at: null, text: 'Marked rejected' });
  return out.sort((a, b) => (a.at && b.at ? ms(a.at) - ms(b.at) : a.at ? -1 : 1));
}

/* ---------- Sign-in and session ---------- */

// The tokens Supabase Auth puts after # when a magic link brings someone back, or its error.
export function parseAuthHash(hash, now = Date.now()) {
  const p = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  if (p.get('error') || p.get('error_description')) {
    return { error: (p.get('error_description') || p.get('error')).replace(/\+/g, ' ') };
  }
  const access = p.get('access_token');
  if (!access) return null;
  return { access_token: access, refresh_token: p.get('refresh_token') || null, expires_at: expiry(p.get('expires_at'), p.get('expires_in'), now) };
}

// From a token reply ({ expires_at } in seconds, or { expires_in }) to milliseconds.
export function expiry(atSec, inSec, now = Date.now()) {
  const at = Number(atSec), dur = Number(inSec);
  if (Number.isFinite(at) && at > 0) return at * 1000;
  return now + (Number.isFinite(dur) && dur > 0 ? dur : 3600) * 1000;
}

export const REFRESH_MARGIN = 60e3;
export const needsRefresh = (session, now = Date.now()) => !!session && session.expires_at - now < REFRESH_MARGIN;
// How long to wait before refreshing, never less than a second.
export const refreshIn = (session, now = Date.now()) => Math.max(1000, (session?.expires_at ?? now) - now - REFRESH_MARGIN);

// The one line the project owner runs to make an account a reviewer.
export function reviewerSql(email) {
  const e = String(email ?? '').trim().replace(/'/g, "''") || 'name@example.com';
  return `insert into public.reviewers (user_id) select id from auth.users where email = '${e}';`;
}

/* ---------- Replies ---------- */

// A database or auth error as one plain sentence.
export function errorText(body, status) {
  const m = body && (body.message || body.msg || body.error_description || (typeof body.error === 'string' ? body.error : null));
  if (m) return String(m);
  return status ? `The request failed (${status}).` : 'The request failed. Check your connection and try again.';
}

// True when a reply means the table, function or permission is not there yet (the console migration is not
// applied), as opposed to an ordinary failure.
export function isMissingFeature(status, body) {
  if (status === 404) return true;
  const code = String(body?.code ?? '');
  return ['42P01', '42883', '42501', 'PGRST202', 'PGRST205', 'PGRST106'].includes(code) || ((status === 401 || status === 403) && /permission denied/i.test(String(body?.message ?? '')));
}

// Plain sentences for the assist function's 502 codes (docs/assist.md).
const ASSIST_502 = {
  incomplete: 'Claude’s answer was cut off. Try again.',
  bad_output: 'Claude’s answer could not be read. Try again.',
  unexpected_stop: 'Claude stopped before finishing. Try again.',
  assistant_key_rejected: 'The Anthropic key was rejected. The project owner needs to check the key in the Supabase secrets.',
  claude_bad_request: 'Claude could not take this request. Try a shorter topic or page.',
  claude_overloaded: 'Claude is overloaded right now. Try again in a few minutes.',
  claude_unavailable: 'Claude is unavailable right now. Try again in a few minutes.',
  claude_timeout: 'Claude took too long to answer. Try again, or use a shorter page.',
  claude_unreachable: 'The assistant could not reach Claude. Try again in a few minutes.',
  claude_error: 'Claude returned an error. Try again.',
  auth_unavailable: 'The sign-in service could not be reached to check your access. Try again.',
};

// How the console reacts to a reply from the assist Edge Function (POST /functions/v1/assist).
// kind: ok | signed_out | not_reviewer | not_deployed (hide the whole assistant) | not_configured (hide the Claude
// actions, keep Verify quote) | rate_limited | declined | unreadable | error.
export function assistOutcome(status, body) {
  const code = body?.error;
  if (status >= 200 && status < 300) return { kind: 'ok' };
  // status 0: the request never got an answer (network or CORS), which is what a function not yet deployed looks like.
  if (status === 0 || status === 404) return { kind: 'not_deployed', message: 'The assistant turns on once the assist function is deployed in Supabase.' };
  if (status === 401) return { kind: 'signed_out', message: 'Your session ended. Sign in again.' };
  if (status === 403) return { kind: 'not_reviewer', message: 'The assistant is for reviewers only.' };
  if (status === 503 && code === 'assistant_not_configured') return { kind: 'not_configured', message: NOT_CONFIGURED };
  if (status === 429) {
    if (code === 'rate_limited') {
      const min = Math.max(1, Math.ceil((Number(body?.retry_after) || 60) / 60));
      return { kind: 'rate_limited', message: `You have used this hour’s assistant requests. Try again in ${min} ${min === 1 ? 'minute' : 'minutes'}.` };
    }
    return { kind: 'rate_limited', message: 'Claude is busy. Try again in a few minutes.' };
  }
  if (code === 'declined') return { kind: 'declined', message: 'Claude declined this request. Nothing was changed; review it by hand.' };
  if (code === 'source_unreadable') return { kind: 'unreadable', message: body?.message ? String(body.message) : 'That page could not be read.' };
  if (status === 502 && ASSIST_502[code]) return { kind: 'error', message: ASSIST_502[code] };
  if (status === 504 || status === 546) return { kind: 'error', message: 'That took too long. Try a shorter page or a narrower hint.' };
  if (code === 'bad_request' && body?.message) return { kind: 'error', message: String(body.message) };
  return { kind: 'error', message: `The assistant could not answer: ${errorText(typeof code === 'string' && !body?.message ? { message: code.replace(/_/g, ' ') } : body, status)}` };
}
export const NOT_CONFIGURED = 'Claude’s suggestions turn on when the Anthropic key is set in the Supabase project’s secrets. Verify quote works without it.';

// "27 checks left this hour" from the status action, or '' when unknown.
export function remainingText(st) {
  const n = Number(st?.remaining);
  if (!st || !Number.isFinite(n)) return '';
  return `${n} ${n === 1 ? 'check' : 'checks'} left this hour`;
}

// "Asking Claude… 12 s" style elapsed time, in whole seconds.
export const elapsed = (startMs, now = Date.now()) => `${Math.max(0, Math.floor((now - startMs) / 1000))} s`;

// An assistant issue's field, as something the form can focus: a topic field, or a statement's field by index.
export function issueTarget(field) {
  const f = String(field ?? '').trim();
  const st = f.match(/^statements?\[?\.?(\d+)\]?\.?(\w+)?$/);
  if (st) return { target: 'statement', index: +st[1], field: st[2] || 'quote' };
  if (['title', 'place', 'neutral_fact', 'neutral_fact_source'].includes(f)) return { target: 'topic', field: f };
  if (f === 'fact' || f === 'source') return { target: 'topic', field: f === 'fact' ? 'neutral_fact' : 'neutral_fact_source' };
  return { target: 'none', field: f };
}

export const VERIFY_LABEL = { found: 'Found in source', not_found: 'Not found in source', unreachable: 'Source unreachable' };

// A verify_quote reply as a badge: its label, and the function's own sentence when the page could not be read.
export function verifyResult(r) {
  const status = Object.hasOwn(VERIFY_LABEL, r?.status) ? r.status : null;
  if (!status) return { status: 'unreachable', label: VERIFY_LABEL.unreachable, detail: 'The reply could not be read.' };
  return { status, label: VERIFY_LABEL[status], detail: status === 'unreachable' ? String(r.message || '') : '', context: status === 'found' ? String(r.context || '') : '' };
}

// What a draft_from_source reply leaves out, in words.
export function draftNotes(r) {
  const out = [];
  const d = Number(r?.dropped) || 0;
  if (d) out.push(`${d} ${d === 1 ? 'quote' : 'quotes'} Claude proposed ${d === 1 ? 'was' : 'were'} left out: not on the page word for word.`);
  if (r?.truncated) {
    const read = Number(r.chars_read), total = Number(r.total_chars);
    out.push(Number.isFinite(read) && Number.isFinite(total) && total > 0
      ? `The page was long, so only the first ${read.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} characters were read.`
      : 'The page was long, so only its first part was read.');
  }
  if (r?.fallback) out.push('Answered by Anthropic’s fallback model after the first model declined.');
  return out;
}

// The topic as the assistant's check_topic action expects it.
export function assistTopic(t) {
  return {
    title: t?.title ?? '', place: t?.place ?? 'US', neutral_fact: t?.neutral_fact ?? '', neutral_fact_source: t?.neutral_fact_source ?? '',
    statements: (t?.statements || []).map((s) => ({ side: s.side, speaker: s.speaker, role: s.role ?? null, quote: s.quote, said_on: s.said_on ?? null, source_url: s.source_url })),
  };
}

/* ---------- Weird news: tips and picks ---------- */

export const CATEGORY_LABEL = {
  people: 'Weird People', animals: 'Strange Animals', laws: 'Odd Laws', records: 'World Records',
  unexplained: 'Unexplained', weather: 'Weird Weather', other: 'Other',
};
export const PICK_STATUS_LABEL = { draft: 'Draft', published: 'Published', withdrawn: 'Withdrawn' };
export const TIP_STATUS_LABEL = { new: 'New', accepted: 'Accepted', rejected: 'Rejected' };
export const PICK_LIMITS = { url: 2048, title: 300, outlet: 120, note: 200 };

export const WEIRD_OFF = 'Tips and picks arrive when the weird-community migration is applied.';

// PAUSED addition (owner, 16 Nov 2026): the hook-line checklist. Pure and tested, but no page uses it yet; the
// pick form keeps the plain 200-character note until the owner has planned the hook (140 characters, see
// supabase/paused/weird_favourites.sql).
export const HOOK_MAX = 140;
// The hook: the editor's own words under the headline. Phrases that promise more than a story can deliver.
export const CLICKBAIT = ['you won’t believe', 'shocking', 'what happened next', 'will blow your mind', 'doctors hate'];
const plainQuotes = (s) => String(s ?? '').replace(/[‘’ʼ′]/g, "'").toLowerCase();

// The live checklist beside the hook field. Each check is { id, ok, label, detail, hard }. Only the length is
// a hard rule (the database enforces it); the rest are warnings the reviewer sees and may overrule.
export function hookChecks(text, max = HOOK_MAX) {
  const s = String(text ?? '').trim();
  const n = [...s].length;
  const low = plainQuotes(s);
  const bait = CLICKBAIT.filter((p) => low.includes(plainQuotes(p)));
  const caps = (s.match(/[\p{L}]+/gu) || []).filter((w) => [...w].length > 3 && w === w.toUpperCase() && w !== w.toLowerCase());
  const marks = (s.match(/[?!？！]/g) || []).length;
  return [
    { id: 'length', hard: true, ok: n <= max, label: `At most ${max} characters`, detail: `${n} / ${max}` },
    { id: 'clickbait', hard: false, ok: !bait.length, label: 'No clickbait phrases', detail: bait.length ? `Found: ${bait.map((b) => `“${b}”`).join(', ')}` : '' },
    { id: 'caps', hard: false, ok: !caps.length, label: 'No shouting (all-caps words over 3 letters)', detail: caps.length ? `Found: ${[...new Set(caps)].join(', ')}` : '' },
    { id: 'marks', hard: false, ok: marks <= 1, label: 'At most one ? or !', detail: marks > 1 ? `${marks} found` : '' },
  ];
}
export const HOOK_GUIDANCE = 'Make them wonder, but tell the truth: the answer must be in the story.';

// A story link as the pick form accepts it: https, a dotted host name (not an address or a local name).
export function pickUrlProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Paste the story’s link.';
  if (s.length > PICK_LIMITS.url) return 'That link is too long.';
  let u;
  try { u = new URL(s); } catch { return 'Use the full link, starting https://'; }
  if (u.protocol !== 'https:') return 'Use the story’s https:// link.';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'Use the story’s plain https:// link.';
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.([a-z]{2,63}|xn--[a-z0-9-]+)$/.test(h) || /(^|\.)(localhost|local|internal|lan|test|example|invalid)$/.test(h)) return 'Link to a public website.';
  return null;
}

// Field -> message, mirroring the database checks.
export function pickErrors(f) {
  const e = {};
  const urlProblem = pickUrlProblem(f.url);
  if (urlProblem) e.url = urlProblem;
  if (!len(f.title)) e.title = 'Add the outlet’s headline.';
  else if (len(f.title) > PICK_LIMITS.title) e.title = 'Keep the headline to 300 characters.';
  if (!len(f.outlet)) e.outlet = 'Name the outlet.';
  else if (len(f.outlet) > PICK_LIMITS.outlet) e.outlet = 'Keep the outlet to 120 characters.';
  if (!/^\d{4}-\d\d-\d\d$/.test(String(f.published ?? ''))) e.published = 'Add the day the outlet published it.';
  if (!Object.hasOwn(CATEGORY_LABEL, f.category)) e.category = 'Choose a category.';
  if (f.rating !== '' && f.rating != null && !/^[1-5]$/.test(String(f.rating))) e.rating = 'Rate it 1 to 5, or leave it unrated.';
  if ([...String(f.note ?? '').trim()].length > PICK_LIMITS.note) e.note = `Keep the note to ${PICK_LIMITS.note} characters.`;
  return e;
}

// Trimmed values ready to send. The link is stored normalised (no tracking parameters, fragment or trailing
// slash), the same form story ids are made from, so one story is one pick.
export function cleanPick(f) {
  const url = String(f.url ?? '').trim();
  return {
    url: normaliseStoryUrl(url) || url,
    title: String(f.title ?? '').replace(/\s+/g, ' ').trim(),
    outlet: String(f.outlet ?? '').replace(/\s+/g, ' ').trim(),
    published: f.published || null,
    category: f.category,
    rating: /^[1-5]$/.test(String(f.rating ?? '')) ? Number(f.rating) : null,
    note: String(f.note ?? '').replace(/\s+/g, ' ').trim() || null,
  };
}

// Why a pick cannot be published yet, or null.
export function pickBlock(p) {
  if (!p) return 'Choose a pick.';
  if (p.status === 'published') return 'Already published.';
  const e = pickErrors({ ...p, rating: p.rating ?? '' });
  const first = Object.values(e)[0];
  return first ? `Edit the pick first: ${first}` : null;
}

export function matchesPick(p, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([p?.title, p?.outlet, p?.url, p?.note, CATEGORY_LABEL[p?.category]].join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}
export function matchesTip(t, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([t?.url, t?.note].join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}

// Drafts first (most recently changed first), then published (newest story first), then withdrawn.
const PICK_ORDER = { draft: 0, published: 1, withdrawn: 2 };
export function picksForView(picks, q = '') {
  return (Array.isArray(picks) ? picks : []).filter((p) => p && matchesPick(p, q)).sort((a, b) =>
    (PICK_ORDER[a.status] ?? 3) - (PICK_ORDER[b.status] ?? 3)
    || (a.status === 'published' ? String(b.published ?? '').localeCompare(String(a.published ?? '')) : 0)
    || ms(b.updated_at) - ms(a.updated_at));
}

// New tips only, oldest first: a queue.
export function tipsForView(tips, q = '') {
  return (Array.isArray(tips) ? tips : []).filter((t) => t && t.status === 'new' && matchesTip(t, q))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
}

// "upi.com" for a tip's link, or '' when it is not a link.
export function tipHost(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// What "Accept" puts in a new pick draft: the link only. The headline, outlet and date come from the story
// itself, and the note is the editor's own words, never the visitor's.
export function pickFromTip(tip) {
  return { url: normaliseStoryUrl(tip?.url) || String(tip?.url ?? ''), title: '', outlet: '', published: '', category: 'other', rating: '', note: '' };
}

// A refused pick save as one sentence.
export function pickSaveError(status, body) {
  if (body?.code === '23505' || status === 409) return 'That story is already a pick. Search the Picks list for it.';
  if (body?.code === '23514') return 'The database refused one of the values. Check the link, the note length and the rating.';
  return errorText(body, status);
}

const PICK_ACTION = { published: 'Published', withdrawn: 'Withdrawn', edited: 'Edited while published', deleted: 'Deleted' };
export function pickTimeline(pick, activity) {
  if (!pick) return [];
  const out = [];
  if (pick.created_at) out.push({ at: pick.created_at, text: 'Created as a draft' });
  if (Array.isArray(activity)) {
    for (const a of activity) if (a?.at && PICK_ACTION[a.action]) out.push({ at: a.at, text: PICK_ACTION[a.action] + (a.actor_email ? ` by ${a.actor_email}` : '') });
  } else if (pick.published_at) out.push({ at: pick.published_at, text: 'Published' });
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}
