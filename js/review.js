// The reviewer console (review.html): sign in with an emailed link, then work the "Both sides" queue like a
// small help desk. Views on the left, the queue in the middle, one topic on the right with its statements,
// activity, internal notes and an assistant panel. The Weird news views hold the guestbook tips visitors send
// and the editor's picks (public.weird_tips, public.weird_picks; docs/community.md): each pick's hook line, with a
// live checklist and "Draft with Claude" (the assist function's draft_hook), each published pick's anonymous click
// total for the last 7 days (weird_click_totals), and the front page's favourites row as visitors see it now. The
// Books view (The Stacks) holds books their author or publisher put forward (public.stacks_submissions): the editor
// approves one with their own description, notes and tags (stacks_approve_submission), or rejects it; approved books
// can be hidden; and the Book of the Week is picked there (stacks_set_featured).
//
// It talks to Supabase directly over REST, with no client library:
//   sign-in   GoTrue: POST /auth/v1/otp (magic link), /auth/v1/token?grant_type=refresh_token, /auth/v1/logout
//   data      PostgREST /rest/v1/* with the reviewer's access token; row rules and triggers decide what works
//   assistant the assist Edge Function, POST /functions/v1/assist
//   front     /api/weird (this site) and the community function's /favourites, for the favourites preview;
//             /api/books (or data/books.json) for the shelves and the books on them
//   covers    https://openlibrary.org/isbn/<isbn>.json, only when the reviewer clicks "Look up cover"
// The access and refresh tokens live in sessionStorage only (gone when the tab closes).
// Pure rules (views, sorting, coverage, forms, replies) are in js/reviewmodel.js and tested there.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { esc } from './ui.js';
import { STATE_NAMES, SIDE_LABEL, VOTE_FIELDS, safeUrl, hostOf, fmtDate, voteModel } from './civicmodel.js';
import {
  VIEWS, STATUS_LABEL, LIMITS, counts, bySide, coverage, publishBlock, missingSide, topicsForView, matchesVote,
  placeLabel, relTime, moveIndex, counter, topicErrors, statementErrors, cleanTopic, cleanStatement, timeline,
  parseAuthHash, expiry, needsRefresh, refreshIn, reviewerSql, errorText, isMissingFeature, assistOutcome,
  issueTarget, draftNotes, assistTopic, NOT_CONFIGURED, remainingText, elapsed, verifyResult,
  CATEGORY_LABEL, PICK_STATUS_LABEL, TIP_STATUS_LABEL, PICK_LIMITS, WEIRD_OFF, pickErrors,
  cleanPick, pickBlock, picksForView, tipsForView, tipHost, pickFromTip, pickSaveError, pickTimeline,
  HOOK_LABEL, HOOK_GUIDANCE, hookChecks, hookDraftRequest, hookSuggestions, hookDraftNotes, clicksLabel,
  pickMediaView, pickVideoLink, mediaColumnsMissing, MEDIA_OFF,
  BOOKS_OFF, STACKS_LIMITS, RELATION_LABEL, SUB_STATUS_LABEL, COPY_RUN, approvalFromSubmission, approveErrors, cleanApproval,
  descriptionChecks, stacksReplyError, pendingCount, booksRows, currentFeatured, featuredErrors, weekLabel, thisMonday,
  openLibraryIsbnUrl, coverImageUrl, coverFromEdition,
} from './reviewmodel.js';
import { normaliseStoryUrl, storyId, loadFavourites } from './community.js';
import { cleanWeird, favourites, favCaption, favVotes } from './frontmodel.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'gatecast:review-session';
// Below this width the list and the ticket take turns on screen, and the assistant starts collapsed.
const PHONE = matchMedia('(max-width: 63.99rem)');

/* ---------- State ---------- */

const S = {
  session: null, user: null,
  view: 'needs', q: '',
  topics: [], votes: [], votesError: null, collector: null,
  features: { notes: false, activity: true },
  selected: null, // topic id, vote id or state code, depending on the view
  creating: false, // the New topic form is open
  active: -1, // highlighted row in the list
  notes: {}, activity: {},
  editTopic: false, editStatement: null,
  prefill: null, // values for the Add statement form (from the assistant)
  topicDraft: null, // unsaved values for the topic form (from the assistant)
  // off: the function is not reachable (hide the assistant). claudeOff: no Anthropic key (hide the Claude actions,
  // keep Verify quote). status: the last { configured, limit, remaining }.
  assist: { off: null, claudeOff: null, status: null, busy: false, check: {}, verify: {}, draft: {} },
  editValues: null, noteDraft: '', draftUrl: null, // half-typed form values, kept across re-renders
  assistOpen: null, // null: open on wide screens, closed on narrow ones
  // Weird news. weirdOff: a sentence when the migration is not applied. pickDraft: half-typed pick form values.
  tips: [], picks: [], weirdOff: null, weirdError: null, pickDraft: null, editPick: false, pickActivity: {}, pickActivityOn: true,
  // The weird-news outlets (data/weird-sources.json), for the pick picture rule; [] until loaded or if it fails.
  weirdSources: [], weirdSourcesOff: false,
  // hook: the pick form's "Draft with Claude" (suggestions are only ever inserted by a click, never saved by it).
  hook: { busy: false, started: 0, reply: null, error: '', readPage: false },
  // clicks: pick id -> clicks in the last 7 days (published picks), clicksOn: false until the migration is applied.
  clicks: {}, clicksOn: true,
  // favRow: the front page's favourites row as visitors see it now (null while loading), favsOpen: the panel.
  favRow: null, favsOpen: !PHONE.matches,
  // The Stacks. off: a sentence when the migration is not applied. subs: submissions waiting; books: approved author
  // books (hidden ones too); featured: Book of the Week rows, newest week first; site: /api/books (shelves and every
  // book on them). draft / featDraft: half-typed form values; cover: the "Look up cover" result for the open submission.
  stacks: { off: null, error: null, subs: [], books: [], featured: [], site: null, draft: null, featDraft: null, cover: null },
};
const freshHook = () => ({ busy: false, started: 0, reply: null, error: '', readPage: false });

/* ---------- Session ---------- */

function saveSession(s) {
  S.session = s;
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch {}
  clearTimeout(saveSession.timer);
  if (s?.refresh_token) saveSession.timer = setTimeout(() => refresh().catch(() => {}), refreshIn(s));
}
function loadSession() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); return s && s.access_token ? s : null; } catch { return null; }
}

async function auth(path, { method = 'POST', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { return { ok: false, status: 0, data: null }; }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

let refreshing = null;
function refresh() {
  if (!S.session?.refresh_token) return Promise.resolve(false);
  refreshing ??= auth('token?grant_type=refresh_token', { body: { refresh_token: S.session.refresh_token } }).then((r) => {
    refreshing = null;
    if (!r.ok || !r.data?.access_token) return false;
    saveSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token || S.session.refresh_token, expires_at: expiry(r.data.expires_at, r.data.expires_in) });
    return true;
  });
  return refreshing;
}

async function fresh() {
  if (needsRefresh(S.session) && !(await refresh())) { endSession('Your session ended. Sign in again.'); throw new Error('signed out'); }
}

function endSession(message) {
  saveSession(null);
  S.user = null;
  showGate('signin', { error: message });
}

/* ---------- Database ---------- */

// One PostgREST call as the signed-in reviewer: { ok, status, data, error }. Never throws on a refused request.
async function db(path, { method = 'GET', body, prefer, retried } = {}) {
  await fresh();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${S.session.access_token}`, Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { return { ok: false, status: 0, data: null, error: errorText(null, 0) }; }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && /jwt/i.test(errorText(data)) && !retried) {
    if (await refresh()) return db(path, { method, body, prefer, retried: true });
    endSession('Your session ended. Sign in again.');
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : errorText(data, res.status) };
}

// A change that must touch exactly the rows asked for. Row rules can silently match nothing, so an empty reply
// is a refusal too.
async function change(path, method, body) {
  const r = await db(path, { method, body, prefer: 'return=representation' });
  if (r.ok && Array.isArray(r.data) && !r.data.length) return { ...r, ok: false, error: 'The database made no change. Check that you are still a reviewer.' };
  return r;
}

async function loadTopics() {
  const r = await db('topics?select=*,statements(*)&order=created_at.asc&limit=1000');
  if (r.ok && Array.isArray(r.data)) S.topics = r.data;
  return r;
}

async function loadVotes() {
  const r = await db(`state_votes?select=id,hidden,collected_at,${VOTE_FIELDS.join(',')}&order=voted_at.desc&limit=80`);
  S.votes = r.ok && Array.isArray(r.data) ? r.data : [];
  S.votesError = r.ok ? null : r.error;
}

async function loadCollector() {
  const [st, runs] = await Promise.all([
    db('collector_states?select=*&order=last_run_at.desc.nullslast'),
    db('collector_runs?select=*&order=started_at.desc&limit=12'),
  ]);
  S.collector = st.ok && runs.ok && Array.isArray(st.data) ? { states: st.data, runs: runs.data || [] } : null;
}

// Tips waiting for a decision (never their address hash: reviewers are not granted that column) and every pick.
const TIP_COLS = 'id,url,note,created_at,status';
async function loadWeird() {
  const [t, p] = await Promise.all([
    db(`weird_tips?select=${TIP_COLS}&status=eq.new&order=created_at.asc&limit=300`),
    db('weird_picks?select=*&order=updated_at.desc&limit=1000'),
  ]);
  if ((!t.ok && isMissingFeature(t.status, t.data)) || (!p.ok && isMissingFeature(p.status, p.data))) {
    S.weirdOff = WEIRD_OFF; S.tips = []; S.picks = []; S.weirdError = null;
    return;
  }
  S.weirdOff = null;
  if (t.ok && Array.isArray(t.data)) S.tips = t.data;
  if (p.ok && Array.isArray(p.data)) S.picks = p.data;
  S.weirdError = !t.ok ? t.error : !p.ok ? p.error : null;
  await Promise.all([loadClicks(), loadWeirdSources()]);
}

// The outlets and their image hosts, for the pick form's picture rule (js/storymedia.js pickImageProblem). Read once.
// Without them a picture must be on the story's own site.
async function loadWeirdSources() {
  if (S.weirdSources.length || S.weirdSourcesOff) return;
  try {
    const j = await fetch('data/weird-sources.json', { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));
    S.weirdSources = Array.isArray(j?.sources) ? j.sources : [];
  } catch { S.weirdSources = []; }
  S.weirdSourcesOff = !S.weirdSources.length;
}
const mediaOpts = () => ({ sources: S.weirdSources });

// Anonymous clicks per published pick over the last 7 days (public.weird_click_totals; reviewers only). Picks are
// matched to the click totals by story id, the same id the front page counts clicks by.
async function loadClicks() {
  if (!S.clicksOn) return;
  const pub = S.picks.filter((p) => p.status === 'published');
  if (!pub.length) { S.clicks = {}; return; }
  const pairs = await Promise.all(pub.map(async (p) => [p.id, await storyId(p.url)]));
  const ids = [...new Set(pairs.map(([, id]) => id).filter(Boolean))];
  const r = await db('rpc/weird_click_totals', { method: 'POST', body: { ids, days: 7 } });
  if (!r.ok) { if (isMissingFeature(r.status, r.data)) S.clicksOn = false; return; }
  const byStory = Object.fromEntries((Array.isArray(r.data) ? r.data : []).map((x) => [x.story_id, x.clicks]));
  S.clicks = Object.fromEntries(pairs.map(([pid, sid]) => [pid, sid ? (byStory[sid] ?? 0) : null]));
}

// The favourites row exactly as the front page builds it: the same stories (/api/weird), the same reader favourites
// (the community function) and the same rule (js/frontmodel.js favourites). Read-only; it never changes the order.
async function loadFavRow() {
  try {
    const res = await fetch('api/weird?limit=30', { headers: { Accept: 'application/json' } });
    const items = cleanWeird(res.ok ? await res.json() : null).items;
    const [favs, ids] = await Promise.all([
      loadFavourites(),
      Promise.all(items.map(async (x) => [x.url, await storyId(x.url)])).then(Object.fromEntries),
    ]);
    S.favRow = { ok: true, ...favourites(items, favs, ids) };
  } catch { S.favRow = { ok: false }; }
}

// The Stacks: submissions waiting (never their address hash: reviewers are not granted that column), every approved
// author book, and the Book of the Week history.
const SUB_COLS = 'id,created_at,title,authors,isbn13,year,publisher,shelf,pitch,relation,contact_email,status,reviewed_at,review_note,book_id';
async function loadStacks() {
  const [sub, bk, ft] = await Promise.all([
    db(`stacks_submissions?select=${SUB_COLS}&status=eq.pending&order=created_at.desc&limit=300`),
    db('stacks_books?select=*&order=approved_at.desc&limit=1000'),
    db('stacks_featured?select=*&order=starts_on.desc&limit=52'),
  ]);
  if ([sub, bk, ft].some((r) => !r.ok && isMissingFeature(r.status, r.data))) {
    Object.assign(S.stacks, { off: BOOKS_OFF, error: null, subs: [], books: [], featured: [] });
    return;
  }
  S.stacks.off = null;
  if (sub.ok && Array.isArray(sub.data)) S.stacks.subs = sub.data;
  if (bk.ok && Array.isArray(bk.data)) S.stacks.books = bk.data;
  if (ft.ok && Array.isArray(ft.data)) S.stacks.featured = ft.data;
  S.stacks.error = [sub, bk, ft].find((r) => !r.ok)?.error ?? null;
}

// The shelves and every book on them, as the site serves them (static and approved). Falls back to the static file.
async function loadSiteBooks() {
  for (const path of ['api/books', 'data/books.json']) {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
      const d = res.ok ? await res.json() : null;
      if (Array.isArray(d?.shelves) && Array.isArray(d?.books)) { S.stacks.site = d; return; }
    } catch {}
  }
  S.stacks.site = { shelves: [], books: [], failed: true };
}

async function loadPickActivity(id) {
  if (!S.pickActivityOn) return;
  const r = await db('rpc/weird_pick_activity', { method: 'POST', body: { pick: id } });
  if (r.ok) S.pickActivity[id] = Array.isArray(r.data) ? r.data : [];
  else if (isMissingFeature(r.status, r.data)) S.pickActivityOn = false;
}

// The reviewer-console migration brings notes, activity, vote hiding and collector health. Ask once.
async function detectFeatures() {
  const r = await db('topic_notes?select=id&limit=1');
  S.features.notes = r.ok;
}

async function loadNotes(id) {
  if (!S.features.notes) return;
  const r = await db(`topic_notes?select=*&topic_id=eq.${id}&order=created_at.asc`);
  if (r.ok) S.notes[id] = r.data || [];
  else if (isMissingFeature(r.status, r.data)) S.features.notes = false;
}

async function loadActivity(id) {
  if (!S.features.activity) return;
  const r = await db('rpc/review_activity', { method: 'POST', body: { topic: id } });
  if (r.ok) S.activity[id] = Array.isArray(r.data) ? r.data : [];
  else if (isMissingFeature(r.status, r.data)) S.features.activity = false;
}

/* ---------- Assistant ---------- */

async function assist(body) {
  await fresh();
  let status = 0, data = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/assist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${S.session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch {}
  const out = assistOutcome(status, data);
  if (out.kind === 'not_deployed') S.assist.off = out.message;
  if (out.kind === 'not_configured') S.assist.claudeOff = out.message;
  if (out.kind === 'signed_out') endSession(out.message);
  return { out, data };
}

// Free: whether Claude is configured and how many requests are left this hour.
async function loadAssistStatus() {
  if (S.assist.off) return;
  const { out, data } = await assist({ action: 'status' });
  if (out.kind !== 'ok') return;
  S.assist.status = data;
  S.assist.claudeOff = data?.configured === false ? NOT_CONFIGURED : null;
}

// Elapsed seconds on every "Asking Claude" line while a request runs (the model can take a minute).
let ticker = null;
function tick(on) {
  clearInterval(ticker);
  ticker = on ? setInterval(() => {
    for (const el of document.querySelectorAll('[data-started]')) el.textContent = elapsed(Number(el.dataset.started));
  }, 1000) : null;
}
const retick = () => tick(S.assist.busy || Object.values(S.assist.verify).some((v) => v.busy));
const waiting = (started, text = 'Asking Claude. Long pages can take a minute.') =>
  `<p class="rv-loading"><span class="rv-spin" aria-hidden="true"></span><span>${esc(text)}</span> <span class="rv-elapsed num" aria-hidden="true" data-started="${started}">${elapsed(started)}</span></p>`;

/* ---------- Toasts and dialogs ---------- */

function toast(text, { error = false } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `rv-toast${error ? ' rv-toast--error' : ''}`;
  el.innerHTML = `<span>${esc(text)}</span><button type="button" class="rv-toast__close" aria-label="Dismiss">×</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  box.append(el);
  setTimeout(() => el.remove(), error ? 12000 : 5000);
}

// A modal question. Resolves to the reason text (possibly empty) when confirmed, or null when cancelled.
function ask({ title, body, confirm, danger = false, reason = null }) {
  const dlg = $('#dialog');
  dlg.innerHTML = `<form method="dialog" class="rv-dialog__form">
    <h2 class="rv-dialog__title" id="dialog-title">${esc(title)}</h2>
    <div class="rv-dialog__body">${body}</div>
    ${reason ? `<div class="rv-field"><label for="dialog-reason">${esc(reason.label)} <span class="rv-hint">optional</span></label>
      <textarea id="dialog-reason" rows="3" maxlength="${reason.max ?? LIMITS.note}"></textarea>
      <p class="rv-hint">${esc(reason.hint)}</p></div>` : ''}
    <div class="rv-dialog__actions">
      <button type="submit" value="cancel" class="btn btn--ghost">Cancel</button>
      <button type="submit" value="ok" class="btn ${danger ? 'btn--primary rv-btn--danger' : 'btn--primary'}">${esc(confirm)}</button>
    </div>
  </form>`;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? ($('#dialog-reason', dlg)?.value.trim() ?? '') : null), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    ($('#dialog-reason', dlg) || $('button[value="cancel"]', dlg)).focus();
  });
}

/* ---------- Formatting ---------- */

const ABS = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const abs = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? ABS.format(t) : ''; };
const when = (iso) => (iso ? `<time datetime="${esc(iso)}" title="${esc(abs(iso))}">${esc(relTime(iso))}</time>` : '');
const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}<span class="sr-only"> (opens in a new tab)</span></a>`;
const statusPill = (s) => `<span class="rv-pill rv-pill--${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const placeChip = (p) => `<span class="rv-chip code" title="${esc(placeLabel(p))}">${esc(p)}</span>`;
const ICON_YES = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_NO = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const sideMark = (letter, on, word) => `<span class="rv-side-mark${on ? ' is-on' : ''}"><span aria-hidden="true">${letter}</span>${on ? ICON_YES : ICON_NO}<span class="sr-only">${word} statement ${on ? 'attached' : 'missing'}</span></span>`;
const counterHTML = (id, text, max) => { const c = counter(text, max); return `<span class="rv-counter${c.over ? ' is-over' : ''}" id="${id}" aria-live="polite">${c.text}</span>`; };
const topic = (id) => S.topics.find((t) => t.id === id) || null;

/* ---------- Gate: sign in, link sent, not a reviewer, errors ---------- */

function showGate(state, opts = {}) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  const body = $('#gate-body');
  if (state === 'loading') {
    body.innerHTML = '<p class="rv-gate__lede" role="status">Signing you in…</p>';
    return;
  }
  if (state === 'sent') {
    body.innerHTML = `<div class="rv-gate__sent" role="status">
        <h2 class="rv-gate__h2">Check your inbox</h2>
        <p>We sent a sign-in link to <strong>${esc(opts.email)}</strong>. Open it on this device; it signs you in to this tab.</p>
        <p class="rv-hint">It can take a minute. Nothing there? Check spam, or send another link.</p>
      </div>
      <button type="button" class="btn btn--ghost" id="gate-again">Use a different email</button>`;
    $('#gate-again').addEventListener('click', () => showGate('signin', { email: opts.email }));
    $('#gate-again').focus();
    return;
  }
  if (state === 'not-reviewer') {
    const sql = reviewerSql(opts.email);
    body.innerHTML = `<div class="rv-gate__sent">
        <h2 class="rv-gate__h2">This account isn’t a reviewer</h2>
        <p>You are signed in as <strong>${esc(opts.email)}</strong>, but it isn’t on the reviewer list, so the database shows you nothing. The project owner adds reviewers in the Supabase SQL editor:</p>
        <pre class="rv-sql"><code>${esc(sql)}</code></pre>
        <button type="button" class="btn btn--ghost" id="gate-copy">Copy SQL</button>
        <p class="rv-hint">Once that has run, reload this page.</p>
      </div>
      <button type="button" class="btn btn--text" id="gate-out">Sign out</button>`;
    $('#gate-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(sql); toast('SQL copied'); } catch { toast('Couldn’t copy. Select the SQL and copy it.', { error: true }); }
    });
    $('#gate-out').addEventListener('click', signOut);
    return;
  }
  body.innerHTML = `<p class="rv-gate__lede">For the people who check and publish “Both sides” topics. Visitors never see this page.</p>
    <form class="rv-gate__form" id="signin-form" novalidate>
      <div class="rv-field">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" inputmode="email" required value="${esc(opts.email || '')}" ${opts.error ? 'aria-describedby="signin-error" aria-invalid="true"' : ''}>
      </div>
      <button type="submit" class="btn btn--primary">Email me a sign-in link</button>
      <p class="rv-alert" id="signin-error" role="alert"${opts.error ? '' : ' hidden'}>${esc(opts.error || '')}</p>
    </form>
    <p class="rv-hint">Only accounts the project owner has created can sign in. No password; the link works once.</p>`;
  $('#signin-form').addEventListener('submit', sendLink);
  if (opts.error || opts.focus) $('#email').focus();
}

async function sendLink(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const input = $('#email', form);
  const err = $('#signin-error', form);
  const email = input.value.trim();
  const fail = (msg) => { err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'signin-error'); input.focus(); };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter your email address, like name@example.org.');
  const btn = $('button[type="submit"]', form);
  btn.disabled = true; btn.textContent = 'Sending…';
  const back = location.origin + location.pathname;
  const r = await auth(`otp?redirect_to=${encodeURIComponent(back)}`, { body: { email, create_user: false } });
  btn.disabled = false; btn.textContent = 'Email me a sign-in link';
  if (r.ok) return showGate('sent', { email });
  const msg = errorText(r.data, r.status);
  if (/signups? not allowed|user not found/i.test(msg)) return fail('No reviewer account uses that email. Ask the project owner to invite you.');
  if (r.status === 429 || /security purposes|rate limit/i.test(msg)) return fail('Too many sign-in emails just now. Wait a minute, then try again.');
  fail(`Couldn’t send the link: ${msg}`);
}

async function signOut() {
  const token = S.session?.access_token;
  saveSession(null);
  S.user = null;
  if (token) await auth('logout', { token });
  showGate('signin', {});
  toast('Signed out');
}

/* ---------- Shell: nav, list, detail ---------- */

function renderNav() {
  const c = counts(S.topics);
  const item = (view, n) => `<li><button type="button" class="rv-nav__item" data-view="${view}"${S.view === view ? ' aria-current="page"' : ''}>
      <span>${esc(VIEWS[view].title)}</span>${n == null ? '' : `<span class="rv-nav__count num">${n}</span>`}</button></li>`;
  $('#nav').innerHTML = `<p class="rv-nav__group" id="nav-topics">Both sides</p>
    <ul class="rv-nav" aria-labelledby="nav-topics">${item('needs', c.needs)}${item('published', c.published)}${item('rejected', c.rejected)}${item('all', c.all)}</ul>
    <p class="rv-nav__group" id="nav-weird">Weird news</p>
    <ul class="rv-nav" aria-labelledby="nav-weird">${item('tips', S.weirdOff ? null : tipsForView(S.tips).length)}${item('picks', S.weirdOff ? null : S.picks.length)}</ul>
    <p class="rv-nav__group" id="nav-stacks">The Stacks</p>
    <ul class="rv-nav" aria-labelledby="nav-stacks">${item('books', S.stacks.off ? null : pendingCount(S.stacks.subs))}</ul>
    <p class="rv-nav__group" id="nav-state">Statehouse</p>
    <ul class="rv-nav" aria-labelledby="nav-state">${item('votes', S.votesError ? null : S.votes.length)}${S.collector ? item('collector', null) : ''}</ul>`;
}

function rows() {
  if (S.view === 'votes') return S.votes.filter((v) => matchesVote(v, S.q));
  if (S.view === 'tips') return tipsForView(S.tips, S.q);
  if (S.view === 'picks') return picksForView(S.picks, S.q);
  if (S.view === 'books') return S.stacks.off ? [] : booksRows(S.stacks.subs, S.stacks.books, S.q);
  if (S.view === 'collector') {
    const q = S.q.trim().toLowerCase();
    return (S.collector?.states || []).filter((s) => !q || s.state.toLowerCase().includes(q) || (STATE_NAMES[s.state] || '').toLowerCase().includes(q));
  }
  return topicsForView(S.topics, S.view, S.q);
}
const rowId = (r) => (S.view === 'collector' ? r.state : r.id);

function topicRow(t) {
  const cov = coverage(t);
  return `<span class="rv-row__title">${esc(t.title)}</span>
    <span class="rv-row__meta">${placeChip(t.place)}${statusPill(t.status)}
      <span class="rv-cov">${sideMark('D', cov.D, 'Democrat')}${sideMark('R', cov.R, 'Republican')}</span>
      <span>${cov.count} ${cov.count === 1 ? 'statement' : 'statements'}</span>
      <span>created ${esc(relTime(t.created_at))}</span></span>`;
}
function voteRow(v) {
  return `<span class="rv-row__title"><span class="code">${esc(v.bill_identifier)}</span> ${esc(v.bill_title)}</span>
    <span class="rv-row__meta">${placeChip(v.state)}<span>${esc(v.chamber_name)}</span><span>${esc(fmtDate(v.voted_on))}</span>
      <span class="rv-pill">${v.passed ? 'Passed' : 'Failed'}</span>${v.hidden ? '<span class="rv-pill rv-pill--hidden">Hidden</span>' : ''}</span>`;
}
function tipRow(t) {
  let path = '';
  try { const u = new URL(t.url); path = u.pathname.length > 1 ? u.pathname : ''; } catch {}
  return `<span class="rv-row__title rv-row__title--url">${esc(tipHost(t.url))}<span class="rv-muted">${esc(path.slice(0, 80))}${path.length > 80 ? '…' : ''}</span></span>
    <span class="rv-row__meta"><span>sent ${esc(relTime(t.created_at))}</span>${t.note ? `<span class="rv-row__note">“${esc(t.note.slice(0, 90))}${t.note.length > 90 ? '…' : ''}”</span>` : '<span>no note</span>'}</span>`;
}
// A published pick's clicks in the last 7 days, as a small badge; '' when unknown or not published.
const clicksBadge = (p) => {
  const label = p.status === 'published' && S.clicksOn ? clicksLabel(S.clicks[p.id]) : '';
  return label ? `<span class="rv-clicks num">${esc(label)}</span>` : '';
};
function pickRow(p) {
  return `<span class="rv-row__title">${esc(p.title)}</span>
    <span class="rv-row__meta">${pickPill(p.status)}<span>${esc(p.outlet)}</span><span>${esc(CATEGORY_LABEL[p.category] || p.category)}</span>
      ${p.published ? `<span>${esc(fmtDate(p.published))}</span>` : ''}${p.rating ? `<span>weird ${esc(p.rating)}/5</span>` : ''}${clicksBadge(p)}</span>`;
}

// The Books view's rows: the Book of the Week, a submission waiting, or an approved author book.
function booksRow(r) {
  if (r.kind === 'featured') {
    const cur = currentFeatured(S.stacks.featured);
    const b = cur ? bookById(cur.book_id) : null;
    return `<span class="rv-row__title">Book of the week</span>
      <span class="rv-row__meta">${cur ? `<span>${esc(b?.title || cur.book_id)}</span><span>${esc(weekLabel(cur.starts_on))}</span>` : '<span>No pick yet</span>'}</span>`;
  }
  if (r.kind === 'sub') {
    const s = r.item;
    return `<span class="rv-row__title">${esc(s.title)}</span>
      <span class="rv-row__meta"><span class="rv-pill">${esc(SUB_STATUS_LABEL[s.status] || s.status)}</span><span>${esc(s.authors)}</span>
        <span>${esc(shelfName(s.shelf))}</span><span>from ${esc((RELATION_LABEL[s.relation] || '').toLowerCase())}</span><span>sent ${esc(relTime(s.created_at))}</span></span>`;
  }
  const b = r.item;
  return `<span class="rv-row__title">${esc(b.title)}</span>
    <span class="rv-row__meta">${b.hidden ? '<span class="rv-pill rv-pill--hidden">Hidden</span>' : '<span class="rv-pill rv-pill--published">On the shelves</span>'}
      <span>${esc((b.authors || []).join(', '))}</span><span>${esc(shelfName(b.shelf))}</span><span>approved ${esc(relTime(b.approved_at))}</span></span>`;
}

// The front page's favourites row, as visitors see it now: a small panel above the picks.
function favPanelHTML() {
  const f = S.favRow;
  let body;
  if (!f) body = '<p class="rv-quiet">Loading the front page’s row…</p>';
  else if (!f.ok) body = '<p class="rv-quiet">Couldn’t load the front page’s stories just now.</p>';
  else if (f.mode === 'none') body = '<p class="rv-quiet">The row is hidden: no published pick follows the lead, and no story has 10 reader votes this week.</p>';
  else {
    const cap = favCaption(f);
    body = `<p class="rv-favs__cap"><strong>${esc(cap.title)}</strong>${cap.how ? ` — ${esc(cap.how)}` : ''}</p>
      <ol class="rv-favs__list">${f.list.map((x) => `<li><span class="rv-favs__h">${esc(x.title)}</span>
        <span class="rv-muted">${esc(x.outlet)} · ${x.by === 'readers' ? esc(favVotes(x).toLowerCase()) : 'your order'}</span>${x.note ? `<span class="rv-favs__hook">${esc(x.note)}</span>` : ''}</li>`).join('')}</ol>`;
  }
  return `<details class="rv-favs" id="favs-panel"${S.favsOpen ? ' open' : ''}>
    <summary><span class="rv-favs__title">Reader favourites</span><span class="rv-muted">on the front page now</span></summary>
    ${body}
    <p class="rv-quiet">Your published picks in the site’s order (highest weird rating first; the lead is not repeated), until a story gets 10 Weird-o-meter votes in a week: then readers’ votes put it first. Clicks never change the order.</p>
  </details>`;
}
const pickPill = (s) => `<span class="rv-pill rv-pill--${esc(s)}">${esc(PICK_STATUS_LABEL[s] || s)}</span>`;

function stateRow(s) {
  const r = s.last_result || {};
  const res = r.error ? `Error: ${r.error}` : r.started ? 'Started, not finished' : Number.isFinite(r.kept) ? `${r.kept} kept of ${r.votes_seen ?? 0} seen` : 'Not run yet';
  return `<span class="rv-row__title"><span class="code">${esc(s.state)}</span> ${esc(STATE_NAMES[s.state] || '')}</span>
    <span class="rv-row__meta"><span>${s.last_run_at ? `ran ${esc(relTime(s.last_run_at))}` : 'never run'}</span><span>${esc(res)}</span></span>`;
}

function renderList() {
  const def = VIEWS[S.view];
  const list = rows();
  const total = S.view === 'votes' ? S.votes.length : S.view === 'collector' ? S.collector?.states.length ?? 0
    : S.view === 'tips' ? tipsForView(S.tips).length : S.view === 'picks' ? S.picks.length
      : S.view === 'books' ? (S.stacks.off ? 0 : booksRows(S.stacks.subs, S.stacks.books).length) : topicsForView(S.topics, S.view).length;
  const isTopics = 'status' in def;
  const weird = S.view === 'tips' || S.view === 'picks';
  if (S.active >= list.length) S.active = list.length - 1;
  const empty = S.q.trim() && total ? 'Nothing in this view matches your search.' : S.view === 'votes' && S.votesError ? `Couldn’t load votes: ${S.votesError}`
    : weird && S.weirdOff ? S.weirdOff : weird && S.weirdError ? `Couldn’t load ${def.title.toLowerCase()}: ${S.weirdError}`
      : S.view === 'books' && S.stacks.off ? S.stacks.off : def.empty;
  $('#list-pane').innerHTML = `<div class="rv-list__head">
      <h2 class="rv-list__title signage" id="list-title">${esc(def.title)} <span class="num rv-list__n">${list.length === total ? total : `${list.length} of ${total}`}</span></h2>
      ${isTopics ? '<button type="button" class="btn btn--primary rv-new" id="new-topic">New topic</button>' : ''}
      ${S.view === 'picks' && !S.weirdOff ? '<button type="button" class="btn btn--primary rv-new" id="new-pick">New pick</button>' : ''}
    </div>
    ${S.view === 'picks' && !S.weirdOff ? favPanelHTML() : ''}
    ${S.view === 'books' && S.stacks.error ? `<p class="rv-quiet">Couldn’t load everything: ${esc(S.stacks.error)}</p>` : ''}
    ${S.view === 'votes' && !S.features.notes ? '<p class="rv-quiet">Until the reviewer-console migration is applied, this shows only what visitors see: nothing while the switch is off.</p>' : ''}
    ${list.length ? `<p class="rv-keys" id="list-keys"><kbd>j</kbd> <kbd>k</kbd> or <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open</p>
    <ul class="rv-rows" id="rows" role="listbox" tabindex="0" aria-labelledby="list-title" aria-describedby="list-keys"${S.active >= 0 ? ` aria-activedescendant="row-${S.active}"` : ''}>
      ${list.map((r, i) => `<li role="option" id="row-${i}" class="rv-row${i === S.active ? ' is-active' : ''}" data-i="${i}" data-id="${esc(rowId(r))}" aria-selected="${rowId(r) === S.selected ? 'true' : 'false'}">
        ${S.view === 'votes' ? voteRow(r) : S.view === 'collector' ? stateRow(r) : S.view === 'tips' ? tipRow(r) : S.view === 'picks' ? pickRow(r) : S.view === 'books' ? booksRow(r) : topicRow(r)}</li>`).join('')}
    </ul>` : `<p class="rv-empty">${esc(empty)}</p>`}`;
}

function setActive(i, { open = false } = {}) {
  const list = rows();
  if (!list.length) return;
  S.active = Math.max(0, Math.min(list.length - 1, i));
  const el = $('#rows');
  el.setAttribute('aria-activedescendant', `row-${S.active}`);
  for (const li of el.children) li.classList.toggle('is-active', Number(li.dataset.i) === S.active);
  $(`#row-${S.active}`)?.scrollIntoView({ block: 'nearest' });
  if (open) select(rowId(list[S.active]));
}

async function select(id, { focus = true } = {}) {
  S.selected = id;
  S.creating = false;
  S.editTopic = false; S.editStatement = null; S.topicDraft = null; S.prefill = null; S.editValues = null; S.noteDraft = ''; S.draftUrl = null;
  S.editPick = false; S.pickDraft = null; S.hook = freshHook();
  S.stacks.draft = null; S.stacks.cover = null; S.stacks.featDraft = null;
  setPane('detail');
  renderList();
  renderDetail();
  if (focus) $('#detail-title')?.focus();
  if ('status' in VIEWS[S.view] && topic(id)) {
    await Promise.all([loadNotes(id), loadActivity(id), loadAssistStatus()]);
    if (S.selected === id && !S.creating) renderDetail({ keepFocus: true });
  }
  if (S.view === 'picks' && pickById(id)) {
    await loadPickActivity(id);
    if (S.selected === id && !S.creating) renderDetail({ keepFocus: true });
  }
}

function setPane(p) { $('#panes').dataset.pane = p; }

function renderAll() {
  renderNav();
  renderList();
  renderDetail({ keepFocus: true });
}

/* ---------- Detail: topic ---------- */

function field(id, label, control, { hint = '', error = '', counterId = '' } = {}) {
  return `<div class="rv-field">
    <label for="${id}">${label}${hint ? ` <span class="rv-hint">${hint}</span>` : ''}</label>
    ${control}
    ${counterId ? counterId : ''}
    <p class="rv-err" id="${id}-err"${error ? '' : ' hidden'}>${esc(error)}</p>
  </div>`;
}

const PLACE_OPTIONS = (cur) => `<option value="US"${cur === 'US' ? ' selected' : ''}>National (US)</option>` +
  Object.entries(STATE_NAMES).map(([c, n]) => `<option value="${c}"${cur === c ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('');

function topicForm(t, { create = false } = {}) {
  const v = { ...(t || { title: '', place: 'US', neutral_fact: '', neutral_fact_source: '' }), ...(S.topicDraft || {}) };
  const p = create ? 'nt' : 'et';
  return `<form class="rv-form" id="topic-form" data-create="${create ? 1 : 0}" novalidate>
    ${field(`${p}-title`, 'Title', `<input id="${p}-title" name="title" type="text" maxlength="${LIMITS.title + 50}" value="${esc(v.title)}" required aria-describedby="${p}-title-err ${p}-title-n">`, { counterId: counterHTML(`${p}-title-n`, v.title, LIMITS.title) })}
    ${field(`${p}-place`, 'Place', `<select id="${p}-place" name="place">${PLACE_OPTIONS(v.place)}</select>`)}
    ${field(`${p}-fact`, 'Neutral fact', `<textarea id="${p}-fact" name="neutral_fact" rows="4" aria-describedby="${p}-fact-err ${p}-fact-n">${esc(v.neutral_fact)}</textarea>`, { hint: 'one sourced figure or event, no adjectives', counterId: counterHTML(`${p}-fact-n`, v.neutral_fact, LIMITS.neutral_fact) })}
    ${field(`${p}-source`, 'Source of the fact', `<input id="${p}-source" name="neutral_fact_source" type="url" inputmode="url" placeholder="https://" value="${esc(v.neutral_fact_source)}" aria-describedby="${p}-source-err">`, { hint: 'https link' })}
    <div class="rv-form__actions">
      <button type="submit" class="btn btn--primary">${create ? 'Create draft' : 'Save details'}</button>
      <button type="button" class="btn btn--ghost" data-act="cancel-topic">Cancel</button>
    </div>
  </form>`;
}

function statementForm(t, s = null) {
  const id = s ? `se` : 'st';
  const v = s ? { ...s, ...(S.editValues || {}) } : { side: missingSide(t), speaker: '', role: '', quote: '', said_on: '', source_url: '', ...(S.prefill || {}) };
  return `<form class="rv-form rv-form--statement" id="${id}-form" data-statement="${esc(s?.id || '')}" novalidate>
    <fieldset class="rv-sides"><legend>Side</legend>
      ${Object.entries(SIDE_LABEL).map(([k, label]) => `<label><input type="radio" name="side" value="${k}"${v.side === k ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}
    </fieldset>
    <div class="rv-form__row">
      ${field(`${id}-speaker`, 'Speaker', `<input id="${id}-speaker" name="speaker" type="text" value="${esc(v.speaker)}" aria-describedby="${id}-speaker-err">`, { hint: 'full name' })}
      ${field(`${id}-role`, 'Role', `<input id="${id}-role" name="role" type="text" value="${esc(v.role || '')}" aria-describedby="${id}-role-err">`, { hint: 'optional, e.g. U.S. Senator, Ohio' })}
    </div>
    ${field(`${id}-quote`, 'Quote', `<textarea id="${id}-quote" name="quote" rows="5" aria-describedby="${id}-quote-err ${id}-quote-n">${esc(v.quote)}</textarea>`, { hint: 'in full, word for word', counterId: counterHTML(`${id}-quote-n`, v.quote, LIMITS.quote) })}
    <div class="rv-form__row">
      ${field(`${id}-date`, 'Date said', `<input id="${id}-date" name="said_on" type="date" value="${esc(v.said_on || '')}" aria-describedby="${id}-date-err">`)}
      ${field(`${id}-source`, 'Source', `<input id="${id}-source" name="source_url" type="url" inputmode="url" placeholder="https://" value="${esc(v.source_url)}" aria-describedby="${id}-source-err">`, { hint: 'https link to the record' })}
    </div>
    <div class="rv-form__actions">
      <button type="submit" class="btn btn--primary">${s ? 'Save statement' : 'Add statement'}</button>
      ${s ? '<button type="button" class="btn btn--ghost" data-act="cancel-statement">Cancel</button>' : ''}
    </div>
  </form>`;
}

function verifyHTML(s) {
  const r = S.assist.verify[s.id];
  if (S.assist.off) return '';
  const badge = r?.busy ? waiting(r.started, 'Checking the source…')
    : r?.error ? `<span class="rv-badge">${esc(r.error)}</span>`
      : r ? `<span class="rv-badge rv-badge--${esc(r.status)}">${r.status === 'found' ? ICON_YES : r.status === 'not_found' ? ICON_NO : ''}${esc(r.label)}</span>
        ${r.detail ? `<span class="rv-muted">${esc(r.detail)}</span>` : ''}
        ${r.context ? `<details class="rv-context"><summary>Context on the page</summary><p>${esc(r.context)}</p></details>` : ''}` : '';
  return `<div class="rv-verify"><button type="button" class="btn btn--ghost rv-btn--sm" data-act="verify" data-id="${esc(s.id)}"${r?.busy || S.assist.busy ? ' disabled' : ''}>Verify quote</button>
    <div class="rv-verify__out" aria-live="polite">${badge}</div></div>`;
}

function statementCard(t, s) {
  if (S.editStatement === s.id) return `<li class="rv-card rv-card--edit">${statementForm(t, s)}</li>`;
  const href = safeUrl(s.source_url);
  return `<li class="rv-card" id="card-${esc(s.id)}" tabindex="-1">
    <p class="rv-card__who"><strong>${esc(s.speaker)}</strong>${s.role ? ` <span class="rv-muted">${esc(s.role)}</span>` : ''}</p>
    <blockquote class="rv-card__quote"><p>${esc(s.quote)}</p></blockquote>
    <p class="rv-muted rv-card__src">${s.said_on ? `${esc(fmtDate(s.said_on))} · ` : 'No date · '}${href ? ext(href, `Source: ${hostOf(href)}`) : 'No valid source link'}</p>
    <div class="rv-card__tools">
      ${verifyHTML(s)}
      ${t.status === 'draft' ? `<span class="rv-card__edit"><button type="button" class="btn btn--text rv-btn--sm" data-act="edit-statement" data-id="${esc(s.id)}">Edit</button>
        <button type="button" class="btn btn--text rv-btn--sm" data-act="delete-statement" data-id="${esc(s.id)}">Delete</button></span>` : ''}
    </div>
  </li>`;
}

function notesHTML(t) {
  if (!S.features.notes) return '<p class="rv-quiet">Notes and vote hiding arrive when the reviewer-console migration is applied.</p>';
  const notes = S.notes[t.id];
  const me = S.user?.id;
  return `${notes == null ? '<p class="rv-quiet">Loading notes…</p>' : notes.length ? `<ol class="rv-notes">${notes.map((n) => `<li class="rv-note">
      <p>${esc(n.body)}</p>
      <p class="rv-muted">${n.author === me ? 'You' : 'Another reviewer'} · ${when(n.created_at)}${n.author === me ? ` · <button type="button" class="btn btn--text rv-btn--sm" data-act="delete-note" data-id="${esc(n.id)}">Delete</button>` : ''}</p>
    </li>`).join('')}</ol>` : '<p class="rv-quiet">No notes yet. Notes are for reviewers only and never shown to visitors.</p>'}
    <form class="rv-form rv-form--note" id="note-form" novalidate>
      ${field('note-body', 'Add a note', `<textarea id="note-body" name="body" rows="2" aria-describedby="note-body-err note-body-n">${esc(S.noteDraft || '')}</textarea>`, { counterId: counterHTML('note-body-n', S.noteDraft || '', LIMITS.note) })}
      <div class="rv-form__actions"><button type="submit" class="btn btn--ghost">Add note</button></div>
    </form>`;
}

function assistHTML(t) {
  if (S.assist.off) return `<aside class="rv-assist rv-assist--off" aria-label="Assistant"><p class="rv-quiet">${esc(S.assist.off)}</p></aside>`;
  const busy = S.assist.busy ? ' disabled' : '';
  const check = S.assist.check[t.id];
  const draft = S.assist.draft[t.id];
  const editable = t.status === 'draft';
  const checkOut = !check ? '' : check.busy ? waiting(check.started) : check.error ? `<p class="rv-alert">${esc(check.error)}</p>` : `
    <p class="rv-verdict"><span class="rv-pill">${check.verdict === 'ready' ? 'Looks ready' : 'Needs changes'}</span></p>
    ${check.issues?.length ? `<ul class="rv-issues">${check.issues.map((x, i) => `<li><button type="button" class="rv-issue" data-act="issue" data-i="${i}">
        <span class="rv-issue__field">${esc(issueLabel(x.field))}</span><span>${esc(x.problem)}</span></button>
        ${x.suggestion ? `<p class="rv-muted">Suggestion: ${esc(x.suggestion)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="rv-muted">No issues found.</p>'}
    ${check.suggested_title && check.suggested_title !== t.title ? suggestion('Title', check.suggested_title, 'use-title', editable) : ''}
    ${check.suggested_fact && check.suggested_fact !== t.neutral_fact ? suggestion('Neutral fact', check.suggested_fact, 'use-fact', editable) : ''}
    ${check.balance_note ? `<p class="rv-note-box"><strong>Balance:</strong> ${esc(check.balance_note)}</p>` : ''}
    ${check.fallback ? '<p class="rv-muted">Answered by Anthropic’s fallback model after the first model declined.</p>' : ''}`;

  const draftOut = !draft ? '' : draft.busy ? waiting(draft.started) : draft.error ? `<p class="rv-alert">${esc(draft.error)}</p>` : `
    ${draft.statements?.length ? `<ul class="rv-cands">${draft.statements.map((c, i) => `<li class="rv-card rv-cand">
        <p class="rv-card__who"><strong>${esc(c.speaker)}</strong>${c.role ? ` <span class="rv-muted">${esc(c.role)}</span>` : ''}</p>
        <blockquote class="rv-card__quote"><p>${esc(c.quote)}</p></blockquote>
        <p class="rv-muted">${c.said_on ? `${esc(fmtDate(c.said_on))} · ` : ''}Why it may fit: ${esc(c.why_relevant || '')}</p>
        ${c.context ? `<details class="rv-context"><summary>Context on the page</summary><p>${esc(c.context)}</p></details>` : ''}
        ${editable ? `<div class="rv-cand__add" role="group" aria-label="Add this quote as">${Object.entries(SIDE_LABEL).map(([k, l]) => `<button type="button" class="btn btn--ghost rv-btn--sm" data-act="use-cand" data-i="${i}" data-side="${k}">Add as ${esc(k === 'other' ? 'Other' : l)}</button>`).join('')}</div>` : ''}
      </li>`).join('')}</ul>` : '<p class="rv-muted">No quotes found on that page.</p>'}
    ${draft.neutral_fact_ideas?.length ? `<p class="rv-assist__sub">Neutral fact ideas</p><ul class="rv-ideas">${draft.neutral_fact_ideas.map((f, i) => `<li><span>${esc(f)}</span>${editable ? `<button type="button" class="btn btn--text rv-btn--sm" data-act="use-idea" data-i="${i}">Use</button>` : ''}</li>`).join('')}</ul>` : ''}
    ${draftNotes(draft).map((n) => `<p class="rv-muted">${esc(n)}</p>`).join('')}
    ${!editable && draft.statements?.length ? '<p class="rv-muted">Withdraw to draft to add statements.</p>' : ''}`;

  const open = S.assistOpen ?? !PHONE.matches;
  return `<details class="rv-assist" id="assist"${open ? ' open' : ''}>
    <summary><h3 class="rv-assist__title">Assistant</h3></summary>
    <p class="rv-assist__lede">Suggestions from Claude. You decide; nothing is saved until you do.</p>
    ${remainingText(S.assist.status) && !S.assist.claudeOff ? `<p class="rv-muted rv-assist__left">${esc(remainingText(S.assist.status))}</p>` : ''}
    ${S.assist.claudeOff ? `<p class="rv-quiet">${esc(S.assist.claudeOff)}</p>` : `<section class="rv-assist__part" aria-labelledby="as-check-title">
      <h4 id="as-check-title">Topic check</h4>
      <p class="rv-muted">Reads the title, fact and quotes, and lists anything that needs a second look.</p>
      <button type="button" class="btn btn--ghost" data-act="check"${busy}>Check this topic</button>
      <div aria-live="polite" class="rv-assist__out">${checkOut}</div>
    </section>
    <section class="rv-assist__part" aria-labelledby="as-draft-title">
      <h4 id="as-draft-title">Draft from a source</h4>
      <form id="draft-form" class="rv-form" novalidate>
        ${field('draft-url', 'Page with the statements', `<input id="draft-url" name="source_url" type="url" inputmode="url" placeholder="https://" value="${esc(S.draftUrl ?? draft?.url ?? '')}" aria-describedby="draft-url-err">`)}
        <button type="submit" class="btn btn--ghost"${busy}>Find quotes</button>
      </form>
      <div aria-live="polite" class="rv-assist__out">${draftOut}</div>
    </section>`}
  </details>`;
}
const suggestion = (label, text, act, editable) => `<div class="rv-suggest"><p class="rv-assist__sub">Suggested ${esc(label.toLowerCase())}</p><p>${esc(text)}</p>
  ${editable ? `<button type="button" class="btn btn--ghost rv-btn--sm" data-act="${act}">Use suggestion</button>` : '<p class="rv-muted">Withdraw to draft to edit.</p>'}</div>`;
const ISSUE_LABEL = { title: 'Title', place: 'Place', neutral_fact: 'Neutral fact', neutral_fact_source: 'Fact source' };
function issueLabel(f) {
  const t = issueTarget(f);
  if (t.target === 'topic') return ISSUE_LABEL[t.field];
  if (t.target === 'statement') return `Statement ${t.index + 1}`;
  return 'Topic';
}

function actionsHTML(t) {
  const why = publishBlock(t);
  if (t.status === 'published') {
    return `<button type="button" class="btn btn--primary" data-act="withdraw">Withdraw to draft</button>
      <p class="rv-actions__why">Visitors can see this topic. Withdraw it to change anything.</p>`;
  }
  if (t.status === 'rejected') {
    return `<button type="button" class="btn btn--primary" data-act="reopen">Reopen as draft</button>
      <p class="rv-actions__why">Rejected topics are hidden from visitors.</p>`;
  }
  return `<button type="button" class="btn btn--primary" data-act="publish"${why ? ' disabled aria-describedby="publish-why"' : ''}>Publish</button>
    <button type="button" class="btn btn--ghost" data-act="reject">Reject</button>
    <button type="button" class="btn btn--text" data-act="delete">Delete</button>
    <p class="rv-actions__why" id="publish-why">${why ? esc(why) : 'Both sides are attached. Publishing shows it to visitors.'}</p>`;
}

function topicDetail(t) {
  const g = bySide(t.statements);
  const cov = coverage(t);
  const href = safeUrl(t.neutral_fact_source);
  const draft = t.status === 'draft';
  const tl = timeline(t, S.features.activity ? S.activity[t.id] : undefined);
  const group = (k) => `<div class="rv-group">
      <h4 class="rv-group__title">${esc(SIDE_LABEL[k])} <span class="num">${g[k].length}</span></h4>
      ${g[k].length ? `<ul class="rv-cards">${g[k].map((s) => statementCard(t, s)).join('')}</ul>` : `<p class="rv-quiet">No ${esc(SIDE_LABEL[k])} statement yet.</p>`}
    </div>`;
  return `<div class="rv-ticket rv-ticket--assist">
    <div class="rv-ticket__main">
      <button type="button" class="btn btn--text rv-back" data-act="back">← Back to ${esc(VIEWS[S.view].title)}</button>
      <header class="rv-ticket__head">
        <p class="rv-ticket__tags">${placeChip(t.place)}<span>${esc(placeLabel(t.place))}</span>${statusPill(t.status)}</p>
        <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">${esc(t.title)}</h2>
        <p class="rv-muted">Created ${esc(abs(t.created_at))} (${when(t.created_at)})${t.published_at ? ` · Published ${esc(abs(t.published_at))}` : ''}</p>
      </header>

      <section class="rv-block" aria-labelledby="fact-title">
        <div class="rv-block__head"><h3 id="fact-title">Neutral fact</h3>
          ${draft && !S.editTopic ? '<button type="button" class="btn btn--text rv-btn--sm" data-act="edit-topic">Edit title and fact</button>' : ''}</div>
        ${S.editTopic && draft ? topicForm(t) : `<p class="rv-fact">${esc(t.neutral_fact)}</p>
          <p class="rv-muted">${href ? ext(href, `Source: ${hostOf(href)}`) : 'No valid source link'}</p>`}
      </section>

      <section class="rv-block" aria-labelledby="st-title">
        <div class="rv-block__head"><h3 id="st-title">Statements</h3>
          <p class="rv-cov rv-cov--lg">${sideMark('D', cov.D, 'Democrat')}${sideMark('R', cov.R, 'Republican')}</p></div>
        ${group('D')}${group('R')}${g.other.length ? group('other') : ''}
      </section>

      <section class="rv-block" aria-labelledby="add-title">
        <h3 id="add-title">Add statement</h3>
        ${draft ? statementForm(t) : `<p class="rv-quiet">${t.status === 'published' ? 'Statements are frozen while a topic is published. Withdraw it to draft to add or change one.' : 'Reopen this topic as a draft to add statements.'}</p>`}
      </section>

      <section class="rv-block" aria-labelledby="act-title">
        <h3 id="act-title">Activity</h3>
        <ol class="rv-timeline">${tl.map((x) => `<li><span>${esc(x.text)}</span>${x.at ? ` <span class="rv-muted">${esc(abs(x.at))}</span>` : ''}</li>`).join('')}</ol>
        ${S.features.activity ? '' : '<p class="rv-quiet">Who published or withdrew it shows once the reviewer-console migration is applied.</p>'}
      </section>

      <section class="rv-block" aria-labelledby="notes-title">
        <h3 id="notes-title">Internal notes</h3>
        ${notesHTML(t)}
      </section>
    </div>
    ${assistHTML(t)}
    <div class="rv-actions" role="group" aria-label="Topic actions">${actionsHTML(t)}</div>
  </div>`;
}

function newTopicDetail() {
  return `<div class="rv-ticket rv-ticket--new"><div class="rv-ticket__main">
    <button type="button" class="btn btn--text rv-back" data-act="back">← Back to ${esc(VIEWS[S.view].title)}</button>
    <header class="rv-ticket__head"><p class="rv-ticket__tags">${statusPill('draft')}</p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">New topic</h2>
      <p class="rv-muted">A topic is one neutral, sourced fact. Statements from each side are added next. Nothing is public until it is published.</p></header>
    <section class="rv-block">${topicForm(null, { create: true })}</section>
  </div></div>`;
}

/* ---------- Detail: votes and collector ---------- */

function voteDetail(row) {
  const v = voteModel(row);
  if (!v) return '<p class="rv-empty">This vote is missing its title or links.</p>';
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    <button type="button" class="btn btn--text rv-back" data-act="back">← Back to ${esc(VIEWS[S.view].title)}</button>
    <header class="rv-ticket__head">
      <p class="rv-ticket__tags">${placeChip(row.state)}<span>${esc(v.chamber)}</span><span class="rv-pill">${v.outcome}</span>${row.hidden ? '<span class="rv-pill rv-pill--hidden">Hidden from visitors</span>' : ''}</p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1"><span class="code">${esc(v.bill)}</span> ${esc(v.title)}</h2>
      <p class="rv-muted">Voted ${esc(v.date)}${v.motion ? ` · Motion as recorded: ${esc(v.motion)}` : ''} · Collected ${esc(abs(row.collected_at))}</p>
    </header>
    <section class="rv-block" aria-labelledby="tally-title">
      <h3 id="tally-title">Result <span class="num">${esc(v.tally)}</span><span class="sr-only">: ${esc(v.tallyWords)}</span></h3>
      <ul class="rv-split">${v.parties.map((p) => `<li>${esc(p.text)}</li>`).join('')}${v.others ? `<li>${esc(v.others)}</li>` : ''}${v.unknown ? `<li>${esc(v.unknown)}</li>` : ''}</ul>
      <p class="rv-muted">${v.links.map((l) => ext(l.href, l.label)).join(' · ')}</p>
    </section>
    <section class="rv-block" aria-labelledby="vis-title">
      <h3 id="vis-title">On the Today page</h3>
      ${S.features.notes ? `<p>${row.hidden ? 'Hidden: visitors in this state do not see this vote.' : 'Shown to visitors in this state while the switch is on.'}</p>
        <div class="rv-form__actions"><button type="button" class="btn btn--ghost" data-act="toggle-hidden">${row.hidden ? 'Unhide vote' : 'Hide vote'}</button></div>`
        : '<p class="rv-quiet">Notes and vote hiding arrive when the reviewer-console migration is applied.</p>'}
    </section>
  </div></div>`;
}

function collectorDetail(code) {
  const s = (S.collector?.states || []).find((x) => x.state === code);
  const r = s?.last_result || {};
  const dropped = Object.entries(r.dropped || {}).sort((a, b) => b[1] - a[1]);
  const runs = S.collector?.runs || [];
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    <button type="button" class="btn btn--text rv-back" data-act="back">← Back to Collector</button>
    <header class="rv-ticket__head"><h2 class="rv-ticket__title" id="detail-title" tabindex="-1">${s ? `<span class="code">${esc(s.state)}</span> ${esc(STATE_NAMES[s.state] || '')}` : 'Collector'}</h2>
      <p class="rv-muted">Collects floor votes from Open States every hour, four states at a time.</p></header>
    ${s ? `<section class="rv-block" aria-labelledby="last-title"><h3 id="last-title">Last run</h3>
      <dl class="rv-dl">
        <dt>When</dt><dd>${s.last_run_at ? `${esc(abs(s.last_run_at))} (${when(s.last_run_at)})` : 'Never'}</dd>
        <dt>Kept</dt><dd>${r.error ? `Error: ${esc(r.error)}` : `${esc(r.kept ?? 0)} of ${esc(r.votes_seen ?? 0)} votes seen`}</dd>
        <dt>Seats</dt><dd>${s.upper_seats ? `Upper ${esc(s.upper_seats)}` : ''}${s.lower_seats ? ` · Lower ${esc(s.lower_seats)}` : ''}</dd>
        ${dropped.length ? `<dt>Left out</dt><dd>${dropped.map(([k, n]) => `${esc(k.replace(/_/g, ' '))} ${esc(n)}`).join(' · ')}</dd>` : ''}
      </dl></section>` : ''}
    <section class="rv-block" aria-labelledby="runs-title"><h3 id="runs-title">Recent runs</h3>
      ${runs.length ? `<ol class="rv-timeline">${runs.map((x) => `<li><span>${esc(abs(x.started_at))}</span> <span class="rv-muted">${esc(x.requests)} requests${x.detail?.stopped ? ` · stopped: ${esc(x.detail.stopped)}` : ''}${x.detail?.states ? ` · ${esc(Object.keys(x.detail.states).join(', '))}` : ''}</span></li>`).join('')}</ol>` : '<p class="rv-quiet">No runs recorded.</p>'}
    </section>
  </div></div>`;
}

function renderDetail({ keepFocus = false } = {}) {
  const el = $('#detail');
  const focusId = keepFocus ? document.activeElement?.id : null;
  if (S.creating) el.innerHTML = S.view === 'picks' ? newPickDetail() : newTopicDetail();
  else if (S.view === 'tips' || S.view === 'picks') el.innerHTML = weirdDetail();
  else if (S.view === 'books') el.innerHTML = booksDetail();
  else if (S.view === 'votes') { const v = S.votes.find((x) => x.id === S.selected); el.innerHTML = v ? voteDetail(v) : emptyDetail('Choose a vote to see its record.'); }
  else if (S.view === 'collector') el.innerHTML = S.selected ? collectorDetail(S.selected) : emptyDetail('Choose a state to see how its last collection went.');
  else { const t = topic(S.selected); el.innerHTML = t ? topicDetail(t) : emptyDetail(S.topics.length ? 'Choose a topic from the list.' : 'No topics yet. Start one with New topic.'); }
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
}
const emptyDetail = (text) => `<div class="rv-detail__empty"><h2 class="sr-only" id="detail-title" tabindex="-1">Details</h2><p>${esc(text)}</p></div>`;

/* ---------- Forms ---------- */

function showErrors(form, prefix, errors, map = {}) {
  let first = null;
  for (const el of form.querySelectorAll('.rv-err')) el.hidden = true;
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const [k, msg] of Object.entries(errors)) {
    const id = `${prefix}-${map[k] || k}`;
    const input = document.getElementById(id) || form.querySelector(`[name="${k}"]`);
    const err = document.getElementById(`${id}-err`);
    if (err) { err.textContent = msg; err.hidden = false; }
    if (input) { input.setAttribute('aria-invalid', 'true'); first ??= input; }
  }
  first?.focus();
  return !first;
}

const TOPIC_MAP = { title: 'title', place: 'place', neutral_fact: 'fact', neutral_fact_source: 'source' };
const ST_MAP = { side: 'speaker', speaker: 'speaker', role: 'role', quote: 'quote', said_on: 'date', source_url: 'source' };

async function submitTopic(form) {
  const create = form.dataset.create === '1';
  const p = create ? 'nt' : 'et';
  const f = Object.fromEntries(new FormData(form));
  const errors = topicErrors(f);
  if (!showErrors(form, p, errors, TOPIC_MAP)) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  if (create) {
    const r = await change('topics', 'POST', cleanTopic(f));
    btn.disabled = false;
    if (!r.ok) return toast(`Couldn’t create the topic: ${r.error}`, { error: true });
    toast('Draft created. Add a statement from each side next.');
    await loadTopics();
    S.view = 'needs'; S.q = ''; $('#search').value = '';
    renderNav();
    await select(r.data[0].id);
    return;
  }
  const r = await change(`topics?id=eq.${S.selected}`, 'PATCH', cleanTopic(f));
  btn.disabled = false;
  if (!r.ok) return toast(`Couldn’t save: ${r.error}`, { error: true });
  S.editTopic = false; S.topicDraft = null;
  toast('Saved');
  await refreshTopics();
  $('#fact-title')?.focus();
}

async function submitStatement(form) {
  const t = topic(S.selected);
  const editing = form.dataset.statement;
  const prefix = editing ? 'se' : 'st';
  const f = Object.fromEntries(new FormData(form));
  if (!showErrors(form, prefix, statementErrors(f), ST_MAP)) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const body = cleanStatement(f);
  const r = editing ? await change(`statements?id=eq.${editing}`, 'PATCH', body) : await change('statements', 'POST', { ...body, topic_id: t.id });
  btn.disabled = false;
  if (!r.ok) return toast(`Couldn’t ${editing ? 'save' : 'add'} the statement: ${r.error}`, { error: true });
  S.editStatement = null; S.prefill = null; S.editValues = null;
  toast(editing ? 'Statement saved' : `${SIDE_LABEL[body.side]} statement added`);
  await refreshTopics();
  $('#st-title')?.focus();
}

async function submitNote(form) {
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body || body.length > LIMITS.note) return showErrors(form, 'note', { body: body ? 'Keep notes to 2,000 characters.' : 'Write the note first.' });
  const r = await change('topic_notes', 'POST', { topic_id: S.selected, body });
  if (!r.ok) return toast(`Couldn’t add the note: ${r.error}`, { error: true });
  S.noteDraft = '';
  toast('Note added');
  await loadNotes(S.selected);
  renderDetail();
  $('#note-body')?.focus();
}

async function submitDraft(form) {
  const url = String(new FormData(form).get('source_url') || '').trim();
  if (!/^https:\/\/\S+$/.test(url) || !safeUrl(url)) return showErrors(form, 'draft', { url: 'Paste a page address starting https://' });
  const t = topic(S.selected);
  S.assist.draft[t.id] = { busy: true, url, started: Date.now() };
  S.assist.busy = true;
  renderDetail({ keepFocus: true });
  tick(true);
  const { out, data } = await assist({ action: 'draft_from_source', source_url: url, topic_hint: t.title.slice(0, 300) });
  S.assist.busy = false;
  retick();
  S.assist.draft[t.id] = out.kind === 'ok' ? { url, ...data } : { url, error: out.message };
  await loadAssistStatus();
  if (S.selected === t.id) renderDetail({ keepFocus: true });
}

/* ---------- Actions ---------- */

async function refreshTopics() {
  await loadTopics();
  // Keep the highlight on the open topic; it may have left this view (published, rejected).
  S.active = rows().findIndex((r) => rowId(r) === S.selected);
  renderNav();
  renderList();
  renderDetail({ keepFocus: true });
}

async function setStatus(status, { ok, verb }) {
  const t = topic(S.selected);
  const btns = [...document.querySelectorAll('.rv-actions button')];
  btns.forEach((b) => { b.disabled = true; });
  const r = await change(`topics?id=eq.${t.id}`, 'PATCH', { status });
  if (!r.ok) {
    btns.forEach((b) => { b.disabled = false; });
    toast(`Couldn’t ${verb}: ${r.error}`, { error: true });
    renderDetail();
    return false;
  }
  toast(ok);
  await refreshTopics();
  if (S.features.activity) { await loadActivity(t.id); renderDetail(); }
  $('#detail-title')?.focus();
  return true;
}

async function act(name, btn) {
  if (/^(tip|pick|hook)-|^(edit|cancel)-pick$/.test(name)) return weirdAct(name, btn);
  if (/^(sub|book|feat)-/.test(name)) return booksAct(name, btn);
  const t = topic(S.selected);
  switch (name) {
    case 'back': setPane('list'); S.creating = false; renderDetail(); $('#rows')?.focus(); return;
    case 'publish': return setStatus('published', { ok: 'Published', verb: 'publish' });
    case 'withdraw': return setStatus('draft', { ok: 'Withdrawn to draft', verb: 'withdraw' });
    case 'reopen': return setStatus('draft', { ok: 'Back in the queue as a draft', verb: 'reopen' });
    case 'reject': {
      const reason = await ask({
        title: `Reject “${t.title}”?`,
        body: '<p>It leaves the queue and stays hidden from visitors. You can reopen it later.</p>',
        confirm: 'Reject topic',
        reason: { label: 'Short reason', hint: S.features.notes ? 'Saved as an internal note on the topic.' : 'Not stored yet: notes arrive when the reviewer-console migration is applied.' },
      });
      if (reason == null) return;
      if (await setStatus('rejected', { ok: 'Rejected', verb: 'reject' }) && reason && S.features.notes) {
        const n = await change('topic_notes', 'POST', { topic_id: t.id, body: `Rejected: ${reason}`.slice(0, LIMITS.note) });
        if (!n.ok) toast(`Rejected, but the reason wasn’t saved: ${n.error}`, { error: true });
        await loadNotes(t.id); renderDetail();
      }
      return;
    }
    case 'delete': {
      const yes = await ask({ title: `Delete “${t.title}”?`, body: '<p>The draft and its statements are deleted for good.</p>', confirm: 'Delete draft', danger: true });
      if (yes == null) return;
      const r = await change(`topics?id=eq.${t.id}`, 'DELETE');
      if (!r.ok) return toast(`Couldn’t delete: ${r.error}`, { error: true });
      toast('Deleted');
      S.selected = null; setPane('list');
      await refreshTopics();
      $('#rows')?.focus();
      return;
    }
    case 'edit-topic': S.editTopic = true; renderDetail(); $('#et-title')?.focus(); return;
    case 'cancel-topic':
      if (S.creating) { S.creating = false; setPane('list'); renderDetail(); $('#new-topic')?.focus(); return; }
      S.editTopic = false; S.topicDraft = null; renderDetail(); $('#fact-title')?.focus(); return;
    case 'edit-statement': S.editStatement = btn.dataset.id; S.editValues = null; renderDetail(); $('#se-speaker')?.focus(); return;
    case 'cancel-statement': { const id = S.editStatement; S.editStatement = null; S.editValues = null; renderDetail(); document.getElementById(`card-${id}`)?.focus(); return; }
    case 'delete-statement': {
      const s = t.statements.find((x) => x.id === btn.dataset.id);
      const yes = await ask({ title: 'Delete this statement?', body: `<p>${esc(s.speaker)}: “${esc(s.quote.slice(0, 140))}${s.quote.length > 140 ? '…' : ''}”</p>`, confirm: 'Delete statement', danger: true });
      if (yes == null) return;
      const r = await change(`statements?id=eq.${s.id}`, 'DELETE');
      if (!r.ok) return toast(`Couldn’t delete the statement: ${r.error}`, { error: true });
      toast('Statement deleted');
      await refreshTopics();
      $('#st-title')?.focus();
      return;
    }
    case 'delete-note': {
      const r = await change(`topic_notes?id=eq.${btn.dataset.id}`, 'DELETE');
      if (!r.ok) return toast(`Couldn’t delete the note: ${r.error}`, { error: true });
      toast('Note deleted');
      await loadNotes(t.id); renderDetail(); $('#notes-title')?.focus();
      return;
    }
    case 'toggle-hidden': {
      const v = S.votes.find((x) => x.id === S.selected);
      const was = v.hidden;
      v.hidden = !was; // optimistic; rolled back below if the database refuses
      renderList(); renderDetail();
      const r = await change(`state_votes?id=eq.${v.id}`, 'PATCH', { hidden: !was });
      if (!r.ok) { v.hidden = was; renderList(); renderDetail(); toast(`Couldn’t ${was ? 'unhide' : 'hide'} the vote: ${r.error}`, { error: true }); return; }
      toast(was ? 'Vote shown to visitors again' : 'Vote hidden from visitors');
      $('[data-act="toggle-hidden"]')?.focus();
      return;
    }
    case 'check': {
      S.assist.check[t.id] = { busy: true, started: Date.now() };
      S.assist.busy = true;
      renderDetail({ keepFocus: true });
      tick(true);
      const { out, data } = await assist({ action: 'check_topic', topic: assistTopic(t) });
      S.assist.busy = false;
      retick();
      S.assist.check[t.id] = out.kind === 'ok' ? { ...data } : { error: out.message };
      await loadAssistStatus();
      if (S.selected === t.id) renderDetail({ keepFocus: true });
      return;
    }
    case 'verify': {
      const s = t.statements.find((x) => x.id === btn.dataset.id);
      S.assist.verify[s.id] = { busy: true, started: Date.now() };
      renderDetail({ keepFocus: true });
      tick(true);
      const { out, data } = await assist({ action: 'verify_quote', quote: s.quote, source_url: s.source_url });
      S.assist.verify[s.id] = out.kind === 'ok' ? verifyResult(data) : { error: out.message };
      retick();
      renderDetail();
      $(`[data-act="verify"][data-id="${CSS.escape(s.id)}"]`)?.focus();
      return;
    }
    case 'issue': return focusIssue(t, S.assist.check[t.id]?.issues?.[Number(btn.dataset.i)]);
    case 'use-title': S.topicDraft = { ...(S.topicDraft || {}), title: S.assist.check[t.id].suggested_title }; S.editTopic = true; renderDetail(); $('#et-title')?.focus(); toast('Suggestion placed in the form. Save to keep it.'); return;
    case 'use-fact': S.topicDraft = { ...(S.topicDraft || {}), neutral_fact: S.assist.check[t.id].suggested_fact }; S.editTopic = true; renderDetail(); $('#et-fact')?.focus(); toast('Suggestion placed in the form. Save to keep it.'); return;
    case 'use-idea': S.topicDraft = { ...(S.topicDraft || {}), neutral_fact: S.assist.draft[t.id].neutral_fact_ideas[Number(btn.dataset.i)] }; S.editTopic = true; renderDetail(); $('#et-fact')?.focus(); toast('Fact idea placed in the form. Check its source, then save.'); return;
    case 'use-cand': {
      const d = S.assist.draft[t.id];
      const c = d.statements[Number(btn.dataset.i)];
      S.prefill = { side: btn.dataset.side, speaker: c.speaker || '', role: c.role || '', quote: c.quote || '', said_on: c.said_on || '', source_url: c.source_url || d.url };
      S.editStatement = null;
      renderDetail();
      $('#st-speaker')?.focus();
      $('#st-form')?.scrollIntoView({ block: 'start' });
      toast('Filled the Add statement form. Review it, then Add statement.');
      return;
    }
    default:
  }
}

// Take the reviewer to the field an assistant issue is about.
function focusIssue(t, issue) {
  if (!issue) return;
  const target = issueTarget(issue.field);
  if (target.target === 'topic') {
    if (t.status === 'draft') { S.editTopic = true; renderDetail(); }
    const id = t.status === 'draft' ? `et-${TOPIC_MAP[target.field]}` : 'fact-title';
    (document.getElementById(id) || $('#fact-title'))?.focus();
    return;
  }
  if (target.target === 'statement') {
    const s = t.statements[target.index];
    if (!s) return;
    if (t.status === 'draft') {
      if (S.editStatement !== s.id) { S.editStatement = s.id; S.editValues = null; }
      renderDetail();
      ($(`#se-${ST_MAP[target.field] || 'quote'}`) || $('#se-quote'))?.focus();
    } else document.getElementById(`card-${s.id}`)?.focus();
    return;
  }
  $('#detail-title')?.focus();
}

/* ---------- Detail: tips and picks ---------- */

const pickById = (id) => S.picks.find((p) => p.id === id) || null;
const RATING_WORD = ['', 'Mildly odd', 'Pretty strange', 'Properly weird', 'Very weird', 'Totally bonkers'];
const backTo = () => `<button type="button" class="btn btn--text rv-back" data-act="back">← Back to ${esc(VIEWS[S.view].title)}</button>`;

function weirdDetail() {
  if (S.weirdOff) return emptyDetail(S.weirdOff);
  if (S.view === 'tips') {
    const t = S.tips.find((x) => x.id === S.selected);
    return t ? tipDetail(t) : emptyDetail(S.tips.length ? 'Choose a tip from the list.' : 'No tips waiting.');
  }
  const p = pickById(S.selected);
  return p ? pickDetail(p) : emptyDetail(S.picks.length ? 'Choose a pick from the list.' : 'No picks yet. Start one with New pick.');
}

function tipDetail(t) {
  const href = safeUrl(t.url);
  const already = S.picks.find((p) => p.url === normaliseStoryUrl(t.url));
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head">
      <p class="rv-ticket__tags"><span class="rv-pill">${esc(TIP_STATUS_LABEL[t.status] || t.status)}</span><span class="rv-chip">${esc(tipHost(t.url))}</span></p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">Tip from the guestbook</h2>
      <p class="rv-muted">Sent ${esc(abs(t.created_at))} (${when(t.created_at)})</p>
    </header>
    <section class="rv-block" aria-labelledby="tip-link-title">
      <h3 id="tip-link-title">Link</h3>
      <p class="rv-tip__url">${href ? ext(href, t.url) : esc(t.url)}</p>
      <p class="rv-muted">Opens the outlet’s page in a new tab. Gatecast never opens it for you. Check it is a real outlet, the story is current, and the strangeness is in the situation, not in someone’s misfortune.</p>
      ${already ? `<p class="rv-alert">This story is already a pick (${esc(PICK_STATUS_LABEL[already.status] || already.status)}).</p>` : ''}
    </section>
    <section class="rv-block" aria-labelledby="tip-note-title">
      <h3 id="tip-note-title">Note from the visitor</h3>
      ${t.note ? `<p class="rv-tip__note">${esc(t.note)}</p>` : '<p class="rv-quiet">No note.</p>'}
      <p class="rv-muted">Visitors’ words are never published. A pick’s hook is always written or approved by a reviewer.</p>
    </section>
  </div>
  <div class="rv-actions" role="group" aria-label="Tip actions">
    <button type="button" class="btn btn--primary" data-act="tip-accept">${already ? 'Accept and open the pick' : 'Accept and start a pick'}</button>
    <button type="button" class="btn btn--ghost" data-act="tip-reject">Reject</button>
    <p class="rv-actions__why">Accepting starts a pick draft with this link. Either way the tip leaves this list.</p>
  </div></div>`;
}

// The pick form's live previews. The video: Gatecast's own still (api/yt-thumb, so the console contacts YouTube no
// more than the front page does) and a link to the video on YouTube. The picture: loaded from the publisher in the
// reviewer's browser, with its size once it arrives (pickMediaLoaded), so the editor sees it before saving.
// A link that breaks the rules has no preview: its problem is shown on the field's own error line (mediaErrors).
function videoPreviewHTML(m) {
  if (!m || m.problem) return '';
  return `<figure class="rv-media__fig rv-media__fig--video">
      <span class="rv-media__frame"><img src="${esc(m.thumb)}" alt="" width="480" height="360" data-media-preview="video"><span class="rv-media__knob" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg></span></span>
      <figcaption><span>YouTube video <code>${esc(m.id)}</code></span> ${ext(m.watch, 'Watch it on YouTube')}
        <span class="rv-media__msg" data-media-status="video">The still comes from Gatecast. Readers see it with a play button.</span></figcaption>
    </figure>`;
}
function imagePreviewHTML(m) {
  if (!m || m.problem) return '';
  return `<figure class="rv-media__fig">
      <span class="rv-media__frame"><img src="${esc(m.url)}" alt="" referrerpolicy="no-referrer" data-media-preview="image"></span>
      <figcaption><span>From ${esc(m.host)}${m.outlet ? ` (${esc(m.outlet)})` : ''}</span>
        <span class="rv-media__msg" data-media-status="image">Loading the picture from the publisher…</span></figcaption>
    </figure>`;
}
// Only redraw a preview when what it shows changes, so the picture is not fetched again on every key. The two
// fields are checked as they are typed: a problem goes on the field's own error line (the same line Save uses).
const previewKey = {};
function syncMediaPreview(form) {
  const f = Object.fromEntries(new FormData(form));
  const m = pickMediaView(f, mediaOpts());
  for (const [kind, html] of [['video', videoPreviewHTML(m.video)], ['image', imagePreviewHTML(m.image)]]) {
    const problem = m[kind]?.problem || '';
    const input = document.getElementById(`pk-${kind}`), err = document.getElementById(`pk-${kind}-err`);
    if (err) { err.textContent = problem; err.hidden = !problem; }
    if (input) { if (problem) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    const key = JSON.stringify(m[kind]);
    const el = document.getElementById(`pk-${kind}-preview`);
    if (!el || previewKey[kind] === key) continue;
    previewKey[kind] = key;
    el.innerHTML = html;
  }
}
// The preview's picture arrived or failed. Not blocking: a picture that fails here may still fail for readers, and
// the front page then shows the story without it.
function pickMediaLoaded(img, ok) {
  const kind = img.dataset.mediaPreview;
  const msg = img.closest('figure')?.querySelector(`[data-media-status="${kind}"]`);
  if (!msg) return;
  const w = img.naturalWidth, h = img.naturalHeight;
  if (kind === 'video') {
    if (!ok) { msg.textContent = 'YouTube has no still for this video. Check the link: the video may be private or removed.'; msg.classList.add('is-bad'); }
    return;
  }
  if (!ok) { msg.textContent = 'This picture did not load here. Check the link; the site may also refuse to show it on other sites.'; msg.classList.add('is-bad'); img.closest('.rv-media__frame')?.classList.add('is-empty'); return; }
  const small = w < 400 || h < 225;
  msg.textContent = `${w} × ${h} pixels.${small ? ' That is small: the lead is shown up to about 900 pixels wide, so look for a bigger version.' : ' Readers see it credited to the outlet.'}`;
  msg.classList.toggle('is-warn', small);
}

function pickForm(p, { create = false } = {}) {
  const base = p ? { ...p, rating: p.rating ?? '', note: p.note ?? '', published: p.published ?? '', video: pickVideoLink(p.video_id), image_url: p.image_url ?? '' }
    : { url: '', title: '', outlet: '', published: '', category: 'other', rating: '', note: '', video: '', image_url: '' };
  for (const k of Object.keys(previewKey)) delete previewKey[k];
  const v = { ...base, ...(S.pickDraft || {}) };
  const mv = pickMediaView(v, mediaOpts());
  const opt = (val, label, cur) => `<option value="${esc(val)}"${String(cur) === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<form class="rv-form" id="pick-form" data-create="${create ? 1 : 0}" novalidate>
    ${field('pk-url', 'Story link', `<input id="pk-url" name="url" type="url" inputmode="url" placeholder="https://" value="${esc(v.url)}" aria-describedby="pk-url-err">`, { hint: 'the outlet’s own https page' })}
    ${field('pk-title', 'Headline', `<input id="pk-title" name="title" type="text" value="${esc(v.title)}" aria-describedby="pk-title-err pk-title-n">`, { hint: 'the outlet’s own words, unchanged', counterId: counterHTML('pk-title-n', v.title, PICK_LIMITS.title) })}
    <div class="rv-form__row">
      ${field('pk-outlet', 'Outlet', `<input id="pk-outlet" name="outlet" type="text" value="${esc(v.outlet)}" aria-describedby="pk-outlet-err">`, { hint: 'e.g. UPI' })}
      ${field('pk-published', 'Published', `<input id="pk-published" name="published" type="date" value="${esc(v.published)}" aria-describedby="pk-published-err">`, { hint: 'by the outlet' })}
    </div>
    <div class="rv-form__row">
      ${field('pk-category', 'Category', `<select id="pk-category" name="category" aria-describedby="pk-category-err">${Object.entries(CATEGORY_LABEL).map(([k, l]) => opt(k, l, v.category)).join('')}</select>`)}
      ${field('pk-rating', 'Your weird rating', `<select id="pk-rating" name="rating" aria-describedby="pk-rating-err">${opt('', 'Unrated', v.rating)}${[1, 2, 3, 4, 5].map((n) => opt(n, `${n} of 5: ${RATING_WORD[n]}`, v.rating)).join('')}</select>`)}
    </div>
    <fieldset class="rv-media">
      <legend>Picture or video <span class="rv-hint">optional; without either the front page shows the story text-led</span></legend>
      ${field('pk-video', 'Video (YouTube link)', `<input id="pk-video" name="video" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(v.video)}" aria-describedby="pk-video-err pk-video-preview">`, { hint: 'a click-to-play still; YouTube loads only when a reader presses Play', error: mv.video?.problem || '' })}
      <div class="rv-media__preview" id="pk-video-preview" aria-live="polite">${videoPreviewHTML(mv.video)}</div>
      ${field('pk-image', 'Picture (link to the image)', `<input id="pk-image" name="image_url" type="url" inputmode="url" placeholder="https://" value="${esc(v.image_url)}" aria-describedby="pk-image-err pk-image-preview">`, { hint: 'on the story’s own site or its image server', error: mv.image?.problem || '' })}
      <div class="rv-media__preview" id="pk-image-preview" aria-live="polite">${imagePreviewHTML(mv.image)}</div>
      <p class="rv-muted">With both, the front page shows the picture with a small “Has video” button. A video is checked with YouTube before it is shown; one that is gone or may not be embedded is left out.</p>
    </fieldset>
    <div class="rv-hook">
      ${field('pk-note', esc(HOOK_LABEL), `<textarea id="pk-note" name="note" rows="2" aria-describedby="pk-note-err pk-note-n pk-hook-checks">${esc(v.note)}</textarea>`, { hint: 'optional, one line; never the article’s text', counterId: counterHTML('pk-note-n', v.note, PICK_LIMITS.note) })}
      <p class="rv-muted">${esc(HOOK_GUIDANCE)}</p>
      ${hookChecksHTML(v.note)}
      <div class="rv-hook__draft">
        <button type="button" class="btn btn--ghost rv-btn--sm" data-act="hook-draft"${S.hook.busy ? ' disabled' : ''}>Draft with Claude</button>
        <label class="rv-check"><input type="checkbox" id="pk-hook-read"${S.hook.readPage ? ' checked' : ''}> Let Claude read the story page</label>
      </div>
      <div class="rv-hook__out" id="pk-hook-out" aria-live="polite">${hookOutHTML()}</div>
    </div>
    <div class="rv-form__actions">
      <button type="submit" class="btn btn--primary">${create ? 'Save draft' : 'Save pick'}</button>
      <button type="button" class="btn btn--ghost" data-act="cancel-pick">Cancel</button>
    </div>
  </form>`;
}

// The hook's live checklist (js/reviewmodel.js hookChecks): the length is a hard rule (the database enforces it);
// clickbait, capitals and marks are warnings the reviewer may overrule.
const MARK_WARN = '<span class="rv-check-mark" aria-hidden="true">!</span>';
function hookChecksHTML(text) {
  return `<ul class="rv-checks" id="pk-hook-checks" aria-label="Hook checklist">${hookChecks(text).map((c) => `<li class="rv-check-item${c.ok ? ' is-ok' : c.hard ? ' is-bad' : ' is-warn'}">
      ${c.ok ? ICON_YES : c.hard ? ICON_NO : MARK_WARN}<span>${esc(c.label)}${c.detail ? ` <span class="rv-muted">${esc(c.detail)}</span>` : ''}</span>
      <span class="sr-only">${c.ok ? 'passes' : c.hard ? 'must be fixed before saving' : 'warning'}</span></li>`).join('')}</ul>`;
}

// "Draft with Claude": waiting, an error, or up to three suggestions to click into the field. Nothing is saved
// until the reviewer presses Save.
function hookOutHTML() {
  const h = S.hook;
  if (h.busy) return waiting(h.started, 'Asking Claude for hook lines.');
  if (h.error) return `<p class="rv-err">${esc(h.error)}</p>`;
  if (!h.reply) return '';
  const list = hookSuggestions(h.reply);
  const notes = hookDraftNotes(h.reply);
  return `${list.length ? `<p class="rv-assist__sub">Claude suggests. Click one to put it in the field, edit it, then save the pick.</p>
    <ul class="rv-hooks">${list.map((x, i) => `<li><button type="button" class="rv-hook__pick" data-act="hook-use" data-i="${i}">
        <span class="rv-hook__text">${esc(x.text)}</span>
        <span class="rv-muted">${x.basis ? `From: “${esc(x.basis)}”` : ''}${x.checks.every((c) => c.ok) ? '' : ` · ${esc(x.checks.filter((c) => !c.ok).map((c) => c.label).join('; '))}`}</span>
        <span class="sr-only">Use this hook</span></button></li>`).join('')}</ul>` : ''}
    ${notes.length ? `<ul class="rv-hook__notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
}
const renderHookOut = () => { const el = $('#pk-hook-out'); if (el) el.innerHTML = hookOutHTML(); const b = $('[data-act="hook-draft"]'); if (b) b.disabled = S.hook.busy; };

function newPickDetail() {
  return `<div class="rv-ticket rv-ticket--new"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head"><p class="rv-ticket__tags">${pickPill('draft')}</p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">New pick</h2>
      <p class="rv-muted">A pick is a real story from a real outlet, with its own headline. Nothing is public until it is published.</p></header>
    <section class="rv-block">${pickForm(null, { create: true })}</section>
  </div></div>`;
}

function pickDetail(p) {
  const href = safeUrl(p.url);
  const why = pickBlock(p, mediaOpts());
  const tl = pickTimeline(p, S.pickActivityOn ? S.pickActivity[p.id] : undefined);
  const actions = p.status === 'published'
    ? `<button type="button" class="btn btn--primary" data-act="pick-withdraw">Withdraw</button>
       <p class="rv-actions__why">Visitors see this pick. Withdraw it to take it off the front page.</p>`
    : `<button type="button" class="btn btn--primary" data-act="pick-publish"${why ? ' disabled aria-describedby="pick-why"' : ''}>${p.status === 'withdrawn' ? 'Publish again' : 'Publish'}</button>
       <button type="button" class="btn btn--text" data-act="pick-delete">Delete</button>
       <p class="rv-actions__why" id="pick-why">${why ? esc(why) : 'Publishing puts it on the front page as an editor’s pick.'}</p>`;
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head">
      <p class="rv-ticket__tags">${pickPill(p.status)}<span class="rv-chip">${esc(CATEGORY_LABEL[p.category] || p.category)}</span></p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">${esc(p.title)}</h2>
      <p class="rv-muted">${esc(p.outlet)}${p.published ? ` · ${esc(fmtDate(p.published))}` : ''} · Changed ${when(p.updated_at)}${p.published_at ? ` · Published ${esc(abs(p.published_at))}` : ''}</p>
    </header>
    <section class="rv-block" aria-labelledby="pick-story-title">
      <div class="rv-block__head"><h3 id="pick-story-title">Story</h3>
        ${S.editPick ? '' : '<button type="button" class="btn btn--text rv-btn--sm" data-act="edit-pick">Edit pick</button>'}</div>
      ${S.editPick ? pickForm(p) : `
        <p>${href ? ext(href, `Read it at ${p.outlet}`) : 'No valid link'}</p>
        <dl class="rv-dl">
          <dt>Hook</dt><dd>${p.note ? esc(p.note) : '<span class="rv-quiet">No hook.</span>'}</dd>
          ${p.status === 'published' && S.clicksOn && clicksLabel(S.clicks[p.id]) ? `<dt>Clicks</dt><dd>${esc(clicksLabel(S.clicks[p.id]))} <span class="rv-muted">(anonymous totals, from the front page)</span></dd>` : ''}
          <dt>Your rating</dt><dd>${p.rating ? `${esc(p.rating)} of 5: ${esc(RATING_WORD[p.rating])}` : 'Unrated'}</dd>
          <dt>Video</dt><dd>${p.video_id ? ext(pickVideoLink(p.video_id), `YouTube ${p.video_id}`) : '<span class="rv-quiet">None</span>'}</dd>
          <dt>Picture</dt><dd>${p.image_url && safeUrl(p.image_url) ? ext(safeUrl(p.image_url), hostOf(p.image_url) || 'Picture') : '<span class="rv-quiet">None</span>'}</dd>
          ${!p.video_id && !p.image_url ? '<dd class="rv-dl__note rv-muted">Without a picture or a video the front page shows this story text-led, unless the outlet’s feed has a picture for it.</dd>' : ''}
          <dt>Link</dt><dd class="rv-tip__url">${esc(p.url)}</dd>
        </dl>`}
    </section>
    <section class="rv-block" aria-labelledby="pick-act-title">
      <h3 id="pick-act-title">Activity</h3>
      <ol class="rv-timeline">${tl.map((x) => `<li><span>${esc(x.text)}</span>${x.at ? ` <span class="rv-muted">${esc(abs(x.at))}</span>` : ''}</li>`).join('')}</ol>
    </section>
  </div>
  <div class="rv-actions" role="group" aria-label="Pick actions">${actions}</div></div>`;
}

async function submitPick(form) {
  const create = form.dataset.create === '1';
  const f = Object.fromEntries(new FormData(form));
  if (!showErrors(form, 'pk', pickErrors(f, mediaOpts()), { image_url: 'image' })) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const body = cleanPick(f);
  const save = (b) => (create ? change('weird_picks', 'POST', b) : change(`weird_picks?id=eq.${S.selected}`, 'PATCH', b));
  let r = await save(body);
  // Before the pick-media migration the two columns do not exist: a pick without media still saves.
  if (!r.ok && mediaColumnsMissing(r.status, r.data)) {
    if (body.video_id || body.image_url) { btn.disabled = false; return toast(MEDIA_OFF, { error: true }); }
    const { video_id: _v, image_url: _i, ...rest } = body;
    r = await save(rest);
  }
  btn.disabled = false;
  if (!r.ok) return toast(`Couldn’t save the pick: ${pickSaveError(r.status, r.data)}`, { error: true });
  S.pickDraft = null; S.editPick = false; S.hook = freshHook();
  toast(create ? 'Pick saved as a draft. Publish it when it is ready.' : 'Pick saved');
  await loadWeird();
  if (create) {
    S.view = 'picks'; S.q = ''; $('#search').value = '';
    S.active = rows().findIndex((x) => x.id === r.data[0].id);
    renderNav();
    await select(r.data[0].id);
    return;
  }
  await loadPickActivity(S.selected);
  renderAll();
  $('#pick-story-title')?.focus();
}

// Accept or reject a tip. Reviewers cannot read a tip's address hash, so the change asks for no row back and the
// tip list is read again to confirm it left the queue.
async function setTipStatus(tip, status) {
  const btns = [...document.querySelectorAll('.rv-actions button')];
  btns.forEach((b) => { b.disabled = true; });
  const r = await db(`weird_tips?id=eq.${tip.id}`, { method: 'PATCH', body: { status }, prefer: 'return=minimal' });
  await loadWeird();
  const stillNew = S.tips.some((x) => x.id === tip.id);
  if (!r.ok || stillNew) {
    btns.forEach((b) => { b.disabled = false; });
    toast(`Couldn’t ${status === 'accepted' ? 'accept' : 'reject'} the tip: ${r.ok ? 'The database made no change. Check that you are still a reviewer.' : r.error}`, { error: true });
    return false;
  }
  return true;
}

async function weirdAct(name, btn) {
  const tip = S.view === 'tips' ? S.tips.find((x) => x.id === S.selected) : null;
  const pick = S.view === 'picks' ? pickById(S.selected) : null;
  switch (name) {
    case 'tip-accept': {
      if (!tip || !(await setTipStatus(tip, 'accepted'))) return;
      const existing = S.picks.find((p) => p.url === normaliseStoryUrl(tip.url));
      S.view = 'picks'; S.q = ''; $('#search').value = '';
      if (existing) {
        toast('Tip accepted. This story was already a pick.');
        renderNav();
        S.active = rows().findIndex((x) => x.id === existing.id);
        await select(existing.id);
        return;
      }
      S.creating = true; S.selected = null; S.active = -1; S.editPick = false; S.pickDraft = pickFromTip(tip); S.hook = freshHook();
      setPane('detail');
      renderAll();
      $('#pk-title')?.focus();
      toast('Tip accepted. Add the headline, outlet and date from the story, then save the draft.');
      return;
    }
    case 'tip-reject': {
      if (!tip) return;
      const at = rows().findIndex((x) => x.id === tip.id);
      if (!(await setTipStatus(tip, 'rejected'))) return;
      toast('Tip rejected');
      const next = rows()[Math.min(at, rows().length - 1)];
      S.selected = next?.id ?? null;
      S.active = next ? rows().indexOf(next) : -1;
      renderAll();
      if (!next) setPane('list');
      ($('#detail-title') || $('#rows'))?.focus();
      return;
    }
    case 'edit-pick': S.editPick = true; S.pickDraft = null; S.hook = freshHook(); renderDetail(); $('#pk-url')?.focus(); return;
    case 'hook-draft': return draftHook();
    case 'hook-use': {
      const x = hookSuggestions(S.hook.reply)[Number(btn?.dataset.i)];
      const ta = $('#pk-note');
      if (!x || !ta) return;
      ta.value = x.text;
      S.pickDraft = { ...(S.pickDraft || {}), note: x.text };
      syncHookField(ta);
      ta.focus();
      toast('Hook inserted. Edit it if you like, then save the pick. Nothing is saved until you do.');
      return;
    }
    case 'cancel-pick':
      S.pickDraft = null; S.hook = freshHook();
      if (S.creating) { S.creating = false; setPane('list'); renderDetail(); $('#new-pick')?.focus(); return; }
      S.editPick = false; renderDetail(); $('#pick-story-title')?.focus(); return;
    case 'pick-publish':
    case 'pick-withdraw': {
      if (!pick) return;
      const status = name === 'pick-publish' ? 'published' : 'withdrawn';
      document.querySelectorAll('.rv-actions button').forEach((b) => { b.disabled = true; });
      const r = await change(`weird_picks?id=eq.${pick.id}`, 'PATCH', { status });
      if (!r.ok) { toast(`Couldn’t ${status === 'published' ? 'publish' : 'withdraw'} the pick: ${pickSaveError(r.status, r.data)}`, { error: true }); renderDetail(); return; }
      toast(status === 'published' ? 'Published: it shows on the front page within about 5 minutes' : 'Withdrawn: it leaves the front page within about 5 minutes');
      await loadWeird();
      await loadPickActivity(pick.id);
      S.active = rows().findIndex((x) => x.id === pick.id);
      renderAll();
      $('#detail-title')?.focus();
      return;
    }
    case 'pick-delete': {
      if (!pick) return;
      const yes = await ask({ title: `Delete “${pick.title}”?`, body: '<p>The pick is deleted for good. Its history stays in the log.</p>', confirm: 'Delete pick', danger: true });
      if (yes == null) return;
      const r = await change(`weird_picks?id=eq.${pick.id}`, 'DELETE');
      if (!r.ok) return toast(`Couldn’t delete the pick: ${pickSaveError(r.status, r.data)}`, { error: true });
      toast('Pick deleted');
      S.selected = null; S.active = -1; setPane('list');
      await loadWeird();
      renderAll();
      $('#rows')?.focus();
      return;
    }
    default:
  }
}

// The counter and the checklist under the hook field, after typing or inserting a suggestion.
function syncHookField(ta) {
  const out = document.getElementById('pk-note-n');
  if (out) { const c = counter(ta.value, PICK_LIMITS.note); out.textContent = c.text; out.classList.toggle('is-over', c.over); }
  const list = document.getElementById('pk-hook-checks');
  if (list) list.outerHTML = hookChecksHTML(ta.value);
}

// Ask the assistant for up to three hook lines from the headline (and the story page, if the reviewer ticked it).
async function draftHook() {
  const form = $('#pick-form');
  if (!form || S.hook.busy) return;
  const req = hookDraftRequest(Object.fromEntries(new FormData(form)), { readPage: S.hook.readPage });
  if (!req.ok) { S.hook = { ...S.hook, reply: null, error: req.message }; renderHookOut(); (S.hook.readPage ? $('#pk-url') : $('#pk-title'))?.focus(); return; }
  if (S.assist.off || S.assist.claudeOff) { S.hook = { ...S.hook, reply: null, error: S.assist.off || S.assist.claudeOff }; renderHookOut(); return; }
  S.hook = { ...S.hook, busy: true, started: Date.now(), reply: null, error: '' };
  renderHookOut(); tick(true);
  const { out, data } = await assist(req.body);
  S.hook = { ...S.hook, busy: false, reply: out.kind === 'ok' ? data : null, error: out.kind === 'ok' ? '' : out.message };
  retick();
  renderHookOut();
  if (out.kind === 'ok') $('.rv-hook__pick')?.focus();
}

/* ---------- The Stacks: books put forward and the Book of the Week ---------- */

const siteShelves = () => (Array.isArray(S.stacks.site?.shelves) ? S.stacks.site.shelves : []);
const shelfName = (id) => siteShelves().find((x) => x?.id === id)?.name || id || '';
// Every book on the shelves: the site's list (static and approved, as visitors see it), plus approved books the
// site's 5-minute cache may not show yet, plus hidden ones (for the history only).
function allBooks({ visibleOnly = false } = {}) {
  const out = [...(Array.isArray(S.stacks.site?.books) ? S.stacks.site.books : [])];
  const ids = new Set(out.map((b) => b?.id));
  for (const b of S.stacks.books) if (!ids.has(b.id) && (!visibleOnly || !b.hidden)) { ids.add(b.id); out.push(b); }
  return out;
}
const bookById = (id) => allBooks().find((b) => b?.id === id) || null;
const takenIds = () => new Set(allBooks().map((b) => b?.id));
const subById = (id) => S.stacks.subs.find((x) => x.id === id) || null;
const stacksBookById = (id) => S.stacks.books.find((x) => x.id === id) || null;
const selectedRow = () => {
  const id = String(S.selected ?? '');
  if (id === 'featured') return { kind: 'featured' };
  if (id.startsWith('sub:')) return { kind: 'sub', item: subById(id.slice(4)) };
  if (id.startsWith('book:')) return { kind: 'book', item: stacksBookById(id.slice(5)) };
  return null;
};

function booksDetail() {
  if (S.stacks.off) return emptyDetail(S.stacks.off);
  const r = selectedRow();
  if (r?.kind === 'featured') return featuredDetail();
  if (r?.kind === 'sub' && r.item) return submissionDetail(r.item);
  if (r?.kind === 'book' && r.item) return stacksBookDetail(r.item);
  return emptyDetail(S.stacks.subs.length ? 'Choose a book from the list.' : 'No books waiting. Open Book of the week to choose this week’s book.');
}

const shelfOptions = (cur) => siteShelves().map((x) => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(x.name || x.id)}</option>`).join('');

// The description's live checklist (js/reviewmodel.js descriptionChecks), like the hook's.
function descChecksHTML(values, pitch) {
  return `<ul class="rv-checks" id="ap-desc-checks" aria-label="Description checklist">${descriptionChecks(values, pitch).map((c) => `<li class="rv-check-item${c.ok ? ' is-ok' : c.hard ? ' is-bad' : ' is-warn'}">
      ${c.ok ? ICON_YES : c.hard ? ICON_NO : MARK_WARN}<span>${esc(c.label)}${c.detail ? ` <span class="rv-muted">${esc(c.detail)}</span>` : ''}</span>
      <span class="sr-only">${c.ok ? 'passes' : c.hard ? 'must be fixed before approving' : 'warning'}</span></li>`).join('')}</ul>`;
}

function coverOutHTML(v) {
  const c = S.stacks.cover;
  const id = c?.id ?? (v.cover_id ? Number(v.cover_id) : null);
  if (c?.busy) return '<p class="rv-loading"><span class="rv-spin" aria-hidden="true"></span><span>Asking Open Library…</span></p>';
  if (c?.error) return `<p class="rv-err">${esc(c.error)}</p>`;
  if (!id) return '<p class="rv-muted">No cover chosen: the shelf shows the plain stand-in.</p>';
  return `<figure class="rv-cover"><img src="${esc(coverImageUrl(id, 'M'))}" alt="The cover Open Library has for this ISBN" width="120" height="180" referrerpolicy="no-referrer">
    <figcaption class="rv-muted">Open Library cover ${esc(id)}. Check it is this book’s cover.</figcaption></figure>`;
}
const renderCoverOut = () => { const el = $('#ap-cover-out'); if (el) el.innerHTML = coverOutHTML(approveValues(subById(String(S.selected).slice(4)))); };

function approveValues(sub) {
  const base = approvalFromSubmission(sub, { taken: takenIds() });
  return { ...base, ...(S.stacks.draft || {}) };
}

function approveForm(sub) {
  const v = approveValues(sub);
  const ta = (id, name, label, rows, hint, max) => field(id, label, `<textarea id="${id}" name="${name}" rows="${rows}" aria-describedby="${id}-err ${id}-n${name === 'description' ? ' ap-desc-checks' : ''}">${esc(v[name])}</textarea>`,
    { hint, counterId: counterHTML(`${id}-n`, v[name], max) });
  return `<form class="rv-form" id="approve-form" novalidate>
    <div class="rv-form__row">
      ${field('ap-id', 'Id', `<input id="ap-id" name="id" type="text" value="${esc(v.id)}" spellcheck="false" autocomplete="off" aria-describedby="ap-id-err">`, { hint: esc('the end of its address: /stacks/<id>/') })}
      ${field('ap-shelf', 'Shelf', `<select id="ap-shelf" name="shelf" aria-describedby="ap-shelf-err">${siteShelves().some((x) => x.id === v.shelf) ? '' : '<option value="">Choose a shelf</option>'}${shelfOptions(v.shelf)}</select>`, { hint: `they asked for ${esc(shelfName(sub.shelf))}` })}
    </div>
    ${field('ap-title', 'Title', `<input id="ap-title" name="title" type="text" value="${esc(v.title)}" aria-describedby="ap-title-err">`, { hint: 'as on the cover' })}
    <div class="rv-form__row">
      ${field('ap-authors', 'Authors', `<textarea id="ap-authors" name="authors" rows="2" aria-describedby="ap-authors-err">${esc(v.authors)}</textarea>`, { hint: 'one per line' })}
      ${field('ap-year', 'Year', `<input id="ap-year" name="year" type="text" inputmode="numeric" maxlength="4" value="${esc(v.year)}" aria-describedby="ap-year-err">`, { hint: 'first published' })}
    </div>
    ${ta('ap-description', 'description', 'Description', 4, 'your words: one or two sentences, what happened and who told it', STACKS_LIMITS.description)}
    ${descChecksHTML(v, sub.pitch)}
    ${ta('ap-content_note', 'content_note', 'Content note', 2, 'optional: what a reader should know first', STACKS_LIMITS.content_note)}
    ${ta('ap-caveat', 'caveat', 'Caveat', 2, 'optional: disputes about its accuracy, or what it leaves out', STACKS_LIMITS.caveat)}
    ${field('ap-tags', 'Tags', `<input id="ap-tags" name="tags" type="text" value="${esc(v.tags)}" aria-describedby="ap-tags-err">`, { hint: 'up to 6, separated by commas, e.g. Kansas, 1959, Investigation' })}
    <div class="rv-form__row">
      ${field('ap-isbn', 'ISBN', `<input id="ap-isbn" type="text" value="${esc(sub.isbn13)}" readonly>`, { hint: 'as sent, checked' })}
      <div class="rv-field">
        <span class="rv-field__label">Cover</span>
        <div class="rv-form__actions">
          <button type="button" class="btn btn--ghost rv-btn--sm" id="ap-cover" data-act="book-cover" aria-describedby="ap-cover-err"${S.stacks.cover?.busy ? ' disabled' : ''}>Look up cover</button>
          <label class="rv-check"><input type="checkbox" id="ap-show_cover" name="show_cover"${v.show_cover ? ' checked' : ''}> Show cover</label>
        </div>
        <p class="rv-err" id="ap-cover-err" hidden></p>
      </div>
    </div>
    <input type="hidden" name="cover_id" id="ap-cover_id" value="${esc(v.cover_id)}">
    <div id="ap-cover-out" aria-live="polite">${coverOutHTML(v)}</div>
    <p class="rv-muted">“Look up cover” asks Open Library for this ISBN from your browser. ${COVER_OFF_SHELF_HINT}</p>
    <div class="rv-form__actions"><button type="submit" class="btn btn--primary">Approve and shelve</button></div>
  </form>`;
}
const COVER_OFF_SHELF_HINT = 'On the true crime and case-file shelves the cover is off by default; tick Show cover only for a sober jacket.';

function submissionDetail(sub) {
  const mail = sub.contact_email ? `<a href="mailto:${esc(sub.contact_email)}">${esc(sub.contact_email)}</a>` : '<span class="rv-quiet">No address left: there is no one to tell.</span>';
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head">
      <p class="rv-ticket__tags"><span class="rv-pill">${esc(SUB_STATUS_LABEL[sub.status] || sub.status)}</span><span class="rv-chip">${esc(shelfName(sub.shelf))}</span><span>${esc(RELATION_LABEL[sub.relation] || '')} put it forward</span></p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">${esc(sub.title)}</h2>
      <p class="rv-muted">${esc(sub.authors)} · ${esc(sub.year)}${sub.publisher ? ` · ${esc(sub.publisher)}` : ''} · Sent ${esc(abs(sub.created_at))} (${when(sub.created_at)})</p>
    </header>
    <section class="rv-block" aria-labelledby="sub-what-title">
      <h3 id="sub-what-title">What they sent</h3>
      <dl class="rv-dl">
        <dt>Title</dt><dd>${esc(sub.title)}</dd>
        <dt>Authors</dt><dd>${esc(sub.authors)}</dd>
        <dt>ISBN</dt><dd><span class="code">${esc(sub.isbn13)}</span> · ${ext(`https://openlibrary.org/isbn/${encodeURIComponent(sub.isbn13)}`, 'Open Library')}</dd>
        <dt>Year</dt><dd>${esc(sub.year)}</dd>
        <dt>Publisher</dt><dd>${sub.publisher ? esc(sub.publisher) : '<span class="rv-quiet">Not given</span>'}</dd>
        <dt>Shelf</dt><dd>${esc(shelfName(sub.shelf))}${siteShelves().length && !siteShelves().some((x) => x.id === sub.shelf) ? ' <span class="rv-muted">(not a shelf on the site now)</span>' : ''}</dd>
        <dt>From</dt><dd>${esc(RELATION_LABEL[sub.relation] || sub.relation)}</dd>
        <dt>Email</dt><dd>${mail}</dd>
      </dl>
    </section>
    <section class="rv-block" aria-labelledby="sub-pitch-title">
      <h3 id="sub-pitch-title">Their pitch</h3>
      <blockquote class="rv-card__quote rv-pitch"><p>${esc(sub.pitch)}</p></blockquote>
      <p class="rv-muted">The sender’s words, to help you judge the book. Never published: write the shelf text yourself. The checklist flags ${COPY_RUN} words or more in a row taken from it.</p>
    </section>
    <section class="rv-block" aria-labelledby="sub-approve-title">
      <h3 id="sub-approve-title">Approve</h3>
      <p class="rv-muted">Only real, published books that fit a shelf. Everything below goes on the shelf as your words, with “Suggested by ${esc(sub.relation === 'publisher' ? 'the publisher' : 'the author')}” beside it.</p>
      ${approveForm(sub)}
    </section>
  </div>
  <div class="rv-actions" role="group" aria-label="Submission actions">
    <button type="button" class="btn btn--ghost" data-act="sub-reject">Reject</button>
    <p class="rv-actions__why">Rejecting takes it out of the queue. Nothing is sent: if they left an address, write to them yourself.</p>
  </div></div>`;
}

function stacksBookDetail(b) {
  const on = !b.hidden;
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head">
      <p class="rv-ticket__tags">${on ? '<span class="rv-pill rv-pill--published">On the shelves</span>' : '<span class="rv-pill rv-pill--hidden">Hidden</span>'}<span class="rv-chip">${esc(shelfName(b.shelf))}</span><span>Suggested by ${esc(b.origin === 'publisher' ? 'the publisher' : 'the author')}</span></p>
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">${esc(b.title)}</h2>
      <p class="rv-muted">${esc((b.authors || []).join(', '))} · ${esc(b.year)} · Approved ${esc(abs(b.approved_at))} (${when(b.approved_at)})</p>
    </header>
    <section class="rv-block" aria-labelledby="bk-shelf-title">
      <h3 id="bk-shelf-title">On the shelf</h3>
      <dl class="rv-dl">
        <dt>Description</dt><dd>${esc(b.description)}</dd>
        <dt>Content note</dt><dd>${b.content_note ? esc(b.content_note) : '<span class="rv-quiet">None</span>'}</dd>
        <dt>Caveat</dt><dd>${b.caveat ? esc(b.caveat) : '<span class="rv-quiet">None</span>'}</dd>
        <dt>Tags</dt><dd>${esc((b.tags || []).join(', '))}</dd>
        <dt>ISBN</dt><dd class="code">${esc(b.isbn13)}</dd>
        <dt>Id</dt><dd class="code">${esc(b.id)}</dd>
        <dt>Cover</dt><dd>${b.cover_id ? `<img class="rv-cover__img" src="${esc(coverImageUrl(b.cover_id, 'S'))}" alt="Its cover" width="40" height="60" referrerpolicy="no-referrer"> Open Library ${esc(b.cover_id)}` : 'Stand-in'}</dd>
      </dl>
      <p class="rv-muted">To change the text, hide it and ask the project owner to edit the row; its /stacks/ page follows at the next deploy.</p>
    </section>
  </div>
  <div class="rv-actions" role="group" aria-label="Book actions">
    <button type="button" class="btn btn--primary" data-act="book-hide">${on ? 'Hide from shelves' : 'Show on shelves again'}</button>
    ${on ? '<button type="button" class="btn btn--ghost" data-act="feat-choose" data-id="' + esc(b.id) + '">Make it book of the week</button>' : ''}
    <p class="rv-actions__why">${on ? 'Hiding takes it off The Stacks within about 5 minutes. Nothing is deleted.' : 'Hidden: visitors do not see it.'}</p>
  </div></div>`;
}

function featuredDetail() {
  const cur = currentFeatured(S.stacks.featured);
  const curBook = cur ? bookById(cur.book_id) : null;
  const onShelf = cur && allBooks({ visibleOnly: true }).some((b) => b.id === cur.book_id && !b.hidden);
  const v = { book_id: '', reason: '', starts_on: thisMonday(), ...(S.stacks.featDraft || {}) };
  const books = allBooks({ visibleOnly: true }).filter((b) => !b.hidden);
  const groups = siteShelves().map((sh) => {
    const list = books.filter((b) => b.shelf === sh.id).sort((a, b) => a.title.localeCompare(b.title));
    return list.length ? `<optgroup label="${esc(sh.name || sh.id)}">${list.map((b) => `<option value="${esc(b.id)}"${b.id === v.book_id ? ' selected' : ''}>${esc(b.title)}${b.origin ? ' (suggested by the ' + esc(b.origin) + ')' : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const history = S.stacks.featured.slice().sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  return `<div class="rv-ticket"><div class="rv-ticket__main">
    ${backTo()}
    <header class="rv-ticket__head">
      <h2 class="rv-ticket__title" id="detail-title" tabindex="-1">Book of the week</h2>
      <p class="rv-muted">It stands on top of the shelves in The Stacks, leads the shelves and the cards, and opens the book on click. It stays up until you pick another, so a skipped week keeps the last one.</p>
    </header>
    <section class="rv-block" aria-labelledby="ft-now-title">
      <h3 id="ft-now-title">Showing now</h3>
      ${cur ? `<p class="rv-fact">${esc(curBook?.title || cur.book_id)}</p>
        <p>${esc(cur.reason)}</p>
        <p class="rv-muted">${esc(weekLabel(cur.starts_on))}${curBook?.authors ? ` · ${esc(curBook.authors.join(', '))}` : ''}</p>
        ${onShelf ? '' : '<p class="rv-alert">That book is not on the shelves now, so no book of the week shows. Pick another.</p>'}`
        : '<p class="rv-quiet">No pick yet. The Stacks shows no book of the week until you choose one.</p>'}
    </section>
    <section class="rv-block" aria-labelledby="ft-pick-title">
      <h3 id="ft-pick-title">Pick a book</h3>
      ${books.length ? `<form class="rv-form" id="feat-form" novalidate>
        ${field('ft-book_id', 'Book', `<select id="ft-book_id" name="book_id" aria-describedby="ft-book_id-err"><option value="">Choose a book</option>${groups}</select>`, { hint: 'any book on the shelves' })}
        ${field('ft-reason', 'Why this book, this week', `<textarea id="ft-reason" name="reason" rows="2" aria-describedby="ft-reason-err ft-reason-n">${esc(v.reason)}</textarea>`, { hint: 'one line, your words', counterId: counterHTML('ft-reason-n', v.reason, STACKS_LIMITS.reason) })}
        ${field('ft-starts_on', 'Week starting', `<input id="ft-starts_on" name="starts_on" type="date" value="${esc(v.starts_on)}" aria-describedby="ft-starts_on-err">`, { hint: 'a Monday; another day counts as its week' })}
        <p class="rv-muted">Picking again for the same week replaces that week’s pick.</p>
        <div class="rv-form__actions"><button type="submit" class="btn btn--primary">Set book of the week</button></div>
      </form>` : `<p class="rv-quiet">${S.stacks.site?.failed ? 'Couldn’t load the shelves. Reload the console.' : 'Loading the shelves…'}</p>`}
    </section>
    <section class="rv-block" aria-labelledby="ft-hist-title">
      <h3 id="ft-hist-title">Earlier picks</h3>
      ${history.length ? `<ol class="rv-timeline">${history.map((x) => `<li><span>${esc(weekLabel(x.starts_on))}: <strong>${esc(bookById(x.book_id)?.title || x.book_id)}</strong></span> <span class="rv-muted">${esc(x.reason)}</span></li>`).join('')}</ol>`
        : '<p class="rv-quiet">None yet.</p>'}
    </section>
  </div></div>`;
}

// Counters, the description checklist and the half-typed values, for the approve and Book of the Week forms.
function booksInput(el) {
  const form = el.form;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  if (form.id === 'feat-form') {
    S.stacks.featDraft = { ...(S.stacks.featDraft || {}), [el.name]: val };
    if (el.name === 'reason') { const c = counter(el.value, STACKS_LIMITS.reason); const out = $('#ft-reason-n'); if (out) { out.textContent = c.text; out.classList.toggle('is-over', c.over); } }
    return;
  }
  if (!el.name) return;
  S.stacks.draft = { ...(S.stacks.draft || {}), [el.name]: val };
  const max = { description: STACKS_LIMITS.description, content_note: STACKS_LIMITS.content_note, caveat: STACKS_LIMITS.caveat }[el.name];
  const out = document.getElementById(`${el.id}-n`);
  if (max && out) { const c = counter(el.value, max); out.textContent = c.text; out.classList.toggle('is-over', c.over); }
  if (['description', 'content_note', 'caveat'].includes(el.name)) {
    const sub = subById(String(S.selected).slice(4));
    const list = $('#ap-desc-checks');
    if (sub && list) list.outerHTML = descChecksHTML(approveValues(sub), sub.pitch);
  }
}

const AP_MAP = { cover_id: 'cover' };

async function submitApprove(form) {
  const sub = subById(String(S.selected).slice(4));
  if (!sub) return;
  const f = { ...Object.fromEntries(new FormData(form)), show_cover: form.elements.show_cover?.checked === true };
  const errors = approveErrors(f, { shelves: siteShelves().map((x) => x.id), taken: takenIds(), pitch: sub.pitch });
  if (!showErrors(form, 'ap', errors, AP_MAP)) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const book = cleanApproval(f);
  const r = await db('rpc/stacks_approve_submission', { method: 'POST', body: { p_submission: sub.id, p_book: book } });
  btn.disabled = false;
  if (!r.ok) return toast(`Couldn’t approve: ${r.error}`, { error: true });
  if (r.data?.ok !== true) {
    if (r.data?.error === 'bad_field' && r.data.field) showErrors(form, 'ap', { [r.data.field]: stacksReplyError(r.data) }, AP_MAP);
    if (r.data?.error === 'id_taken') showErrors(form, 'ap', { id: stacksReplyError(r.data) });
    return toast(`Couldn’t approve: ${stacksReplyError(r.data)}`, { error: true });
  }
  toast('Approved: it joins The Stacks within about 5 minutes; its own /stacks/ page comes with the next deploy.');
  await loadStacks();
  S.active = rows().findIndex((x) => x.id === `book:${book.id}`);
  renderNav();
  await select(`book:${book.id}`);
}

async function submitFeatured(form) {
  const f = Object.fromEntries(new FormData(form));
  const ids = new Set(allBooks({ visibleOnly: true }).filter((b) => !b.hidden).map((b) => b.id));
  if (!showErrors(form, 'ft', featuredErrors(f, { bookIds: ids }))) return;
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const r = await db('rpc/stacks_set_featured', { method: 'POST', body: { p_book_id: f.book_id, p_reason: String(f.reason).replace(/\s+/g, ' ').trim(), p_starts_on: f.starts_on } });
  btn.disabled = false;
  if (!r.ok) return toast(`Couldn’t set the book of the week: ${r.error}`, { error: true });
  if (r.data?.ok !== true) return toast(`Couldn’t set the book of the week: ${stacksReplyError(r.data)}`, { error: true });
  const week = String(r.data.starts_on ?? '');
  toast(week && week > new Date().toISOString().slice(0, 10)
    ? `Book of the week set for the ${weekLabel(week).toLowerCase()}; it shows from that Monday.`
    : 'Book of the week set; it shows in The Stacks within about 5 minutes');
  S.stacks.featDraft = null;
  await loadStacks();
  renderAll();
  $('#ft-now-title')?.focus();
}

// "Look up cover": one request to Open Library from the reviewer's browser, only on this click.
async function lookupCover() {
  const sub = subById(String(S.selected).slice(4));
  if (!sub || S.stacks.cover?.busy) return;
  S.stacks.cover = { busy: true };
  renderCoverOut();
  const btn = $('#ap-cover'); if (btn) btn.disabled = true;
  let next;
  try {
    const res = await fetch(openLibraryIsbnUrl(sub.isbn13), { headers: { Accept: 'application/json' }, referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (res.status === 404) next = { error: 'Open Library has no edition with this ISBN. Leave the stand-in cover.' };
    else if (!res.ok) next = { error: `Open Library answered ${res.status}. Try again later, or leave the stand-in cover.` };
    else {
      const id = coverFromEdition(await res.json());
      next = id ? { id } : { error: 'This edition has no cover on Open Library. Leave the stand-in cover.' };
    }
  } catch {
    next = { error: 'Couldn’t reach Open Library. Try again, or leave the stand-in cover.' };
  }
  if (String(S.selected) !== `sub:${sub.id}`) return;
  S.stacks.cover = next;
  const hidden = $('#ap-cover_id');
  if (next.id && hidden) { hidden.value = String(next.id); S.stacks.draft = { ...(S.stacks.draft || {}), cover_id: String(next.id) }; }
  renderCoverOut();
  if (btn) { btn.disabled = false; btn.focus(); }
}

async function booksAct(name, btn) {
  const r = selectedRow();
  switch (name) {
    case 'book-cover': return lookupCover();
    case 'sub-reject': {
      const sub = r?.kind === 'sub' ? r.item : null;
      if (!sub) return;
      const note = await ask({
        title: `Reject “${sub.title}”?`,
        body: '<p>It leaves the queue and never reaches the shelves. Nothing is sent to the sender.</p>',
        confirm: 'Reject book',
        reason: { label: 'Short note', hint: 'For reviewers only, at most 300 characters.', max: STACKS_LIMITS.note },
      });
      if (note == null) return;
      const at = rows().findIndex((x) => x.id === `sub:${sub.id}`);
      const res = await db('rpc/stacks_reject_submission', { method: 'POST', body: { p_submission: sub.id, p_note: note.slice(0, STACKS_LIMITS.note) } });
      if (!res.ok) return toast(`Couldn’t reject: ${res.error}`, { error: true });
      if (res.data?.ok !== true) return toast(`Couldn’t reject: ${stacksReplyError(res.data)}`, { error: true });
      toast('Rejected');
      await loadStacks();
      const list = rows();
      const next = list[Math.min(Math.max(at, 0), list.length - 1)];
      S.selected = next?.id ?? null;
      S.active = next ? list.indexOf(next) : -1;
      renderAll();
      if (!next) setPane('list');
      ($('#detail-title') || $('#rows'))?.focus();
      return;
    }
    case 'book-hide': {
      const b = r?.kind === 'book' ? r.item : null;
      if (!b) return;
      if (!b.hidden) {
        const yes = await ask({ title: `Hide “${b.title}”?`, body: '<p>It leaves The Stacks within about 5 minutes. Nothing is deleted; you can show it again.</p>', confirm: 'Hide from shelves' });
        if (yes == null) return;
      }
      const res = await db('rpc/stacks_set_hidden', { method: 'POST', body: { p_book: b.id, p_hidden: !b.hidden } });
      if (!res.ok) return toast(`Couldn’t change it: ${res.error}`, { error: true });
      if (res.data?.ok !== true) return toast(`Couldn’t change it: ${stacksReplyError(res.data)}`, { error: true });
      toast(b.hidden ? 'Back on the shelves within about 5 minutes' : 'Hidden: it leaves The Stacks within about 5 minutes');
      await loadStacks();
      renderAll();
      $('[data-act="book-hide"]')?.focus();
      return;
    }
    case 'feat-choose': {
      const id = btn?.dataset.id;
      S.q = ''; $('#search').value = '';
      S.active = rows().findIndex((x) => x.id === 'featured');
      await select('featured', { focus: false });
      S.stacks.featDraft = { book_id: id };
      renderDetail();
      $('#ft-reason')?.focus();
      return;
    }
    default:
  }
}

/* ---------- Events ---------- */

function wire() {
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    S.view = b.dataset.view; S.selected = null; S.creating = false; S.active = -1;
    setPane('list');
    renderAll();
    openFirst();
    $('#rows')?.focus();
  });

  $('#search').addEventListener('input', (e) => { S.q = e.target.value; S.active = -1; renderList(); });

  const listPane = $('#list-pane');
  listPane.addEventListener('click', (e) => {
    if (e.target.closest('#new-pick')) {
      S.creating = true; S.selected = null; S.pickDraft = null; S.editPick = false; S.hook = freshHook();
      setPane('detail'); renderList(); renderDetail(); $('#pk-url')?.focus();
      return;
    }
    if (e.target.closest('#new-topic')) {
      S.creating = true; S.selected = null; S.topicDraft = null;
      setPane('detail'); renderList(); renderDetail(); $('#nt-title')?.focus();
      return;
    }
    const li = e.target.closest('[role="option"]');
    if (li) { S.active = Number(li.dataset.i); select(li.dataset.id); }
  });
  // Keys belong to the list only: no page-wide shortcuts.
  listPane.addEventListener('keydown', (e) => {
    if (e.target.id !== 'rows' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (S.active < 0) S.active = 0;
      setActive(S.active, { open: true });
      return;
    }
    const n = moveIndex(S.active, e.key, rows().length);
    if (n == null) return;
    e.preventDefault();
    setActive(n);
  });
  listPane.addEventListener('toggle', (e) => { if (e.target.id === 'favs-panel') S.favsOpen = e.target.open; }, true);
  listPane.addEventListener('focusin', (e) => { if (e.target.id === 'rows' && S.active < 0 && rows().length) setActive(0); });

  const detail = $('#detail');
  detail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(b.dataset.act, b);
  });
  detail.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'topic-form') submitTopic(f);
    else if (f.id === 'st-form' || f.id === 'se-form') submitStatement(f);
    else if (f.id === 'note-form') submitNote(f);
    else if (f.id === 'draft-form') submitDraft(f);
    else if (f.id === 'pick-form') submitPick(f);
    else if (f.id === 'approve-form') submitApprove(f);
    else if (f.id === 'feat-form') submitFeatured(f);
  });
  // The pick form's preview pictures: load and error do not bubble either.
  detail.addEventListener('load', (e) => { if (e.target instanceof HTMLImageElement && e.target.dataset.mediaPreview) pickMediaLoaded(e.target, true); }, true);
  detail.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.dataset.mediaPreview) pickMediaLoaded(e.target, false); }, true);
  // toggle does not bubble, so listen while it travels down. Remembers whether the assistant is open.
  detail.addEventListener('toggle', (e) => { if (e.target.id === 'assist') S.assistOpen = e.target.open; }, true);
  detail.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'pk-hook-read') { S.hook.readPage = el.checked; return; }
    if (el.id === 'pk-note') syncHookField(el);
    if (['pk-video', 'pk-image', 'pk-url', 'pk-outlet'].includes(el.id) && el.form) syncMediaPreview(el.form);
    if (el.form?.id === 'approve-form' || el.form?.id === 'feat-form') return booksInput(el);
    const pickForm = el.form?.id === 'pick-form';
    const max = pickForm ? { title: PICK_LIMITS.title, note: PICK_LIMITS.note }[el.name]
      : { title: LIMITS.title, neutral_fact: LIMITS.neutral_fact, quote: LIMITS.quote, body: LIMITS.note }[el.name];
    const out = document.getElementById(`${el.id}-n`);
    if (max && out) { const c = counter(el.value, max); out.textContent = c.text; out.classList.toggle('is-over', c.over); }
    // Keep what has been typed, so a re-render (a toast, a verify result) never wipes a half-filled form.
    const id = el.form?.id;
    if (!el.name) return;
    if (id === 'topic-form' && el.form.dataset.create !== '1') S.topicDraft = { ...(S.topicDraft || {}), [el.name]: el.value };
    else if (id === 'st-form') S.prefill = { ...(S.prefill || {}), [el.name]: el.value };
    else if (id === 'se-form') S.editValues = { ...(S.editValues || {}), [el.name]: el.value };
    else if (id === 'note-form') S.noteDraft = el.value;
    else if (id === 'draft-form') S.draftUrl = el.value;
    else if (id === 'pick-form') S.pickDraft = { ...(S.pickDraft || {}), [el.name]: el.value };
  });

  $('#signout').addEventListener('click', signOut);
  PHONE.addEventListener('change', () => renderDetail({ keepFocus: true }));
}

/* ---------- Start ---------- */

async function start() {
  const back = parseAuthHash(location.hash);
  if (back) history.replaceState(null, '', location.pathname + location.search);
  if (back?.error) return showGate('signin', { error: `That sign-in link didn’t work: ${back.error}. Send a new one.` });
  if (back) saveSession(back);
  else saveSession(loadSession());
  if (!S.session) return showGate('signin', {});

  showGate('loading');
  if (needsRefresh(S.session) && !(await refresh())) return endSession('Your session ended. Sign in again.');
  const u = await auth('user', { method: 'GET', token: S.session.access_token });
  if (!u.ok) return endSession(u.status === 0 ? 'Couldn’t reach the sign-in service. Check your connection.' : 'Your session ended. Sign in again.');
  S.user = u.data;

  const me = await db('reviewers?select=user_id');
  if (!me.ok) return showGate('signin', { error: `Couldn’t check your reviewer access: ${me.error}` });
  if (!me.data?.length) return showGate('not-reviewer', { email: S.user.email });

  await Promise.all([loadTopics(), loadVotes(), loadCollector(), detectFeatures(), loadWeird(), loadStacks(), loadSiteBooks()]);
  // The favourites preview comes from the public site and the community function; the console does not wait for it.
  loadFavRow().then(() => { const el = $('#favs-panel'); if (el) el.outerHTML = favPanelHTML(); });
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = S.user.email || '';
  wire();
  renderAll();
  openFirst();
  $('#rows')?.focus();
}

// On a wide screen the detail pane is always visible, so open the first row like a help desk does.
function openFirst() {
  if (PHONE.matches) return;
  const list = rows();
  if (!list.length) return;
  S.active = 0;
  select(rowId(list[0]), { focus: false }).then(() => setPane('list'));
  setPane('list');
}

start();
