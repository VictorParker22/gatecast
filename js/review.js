// The reviewer console (review.html): sign in with an emailed link, then work the "Both sides" queue like a
// small help desk. Views on the left, the queue in the middle, one topic on the right with its statements,
// activity, internal notes and an assistant panel.
//
// It talks to Supabase directly over REST, with no client library:
//   sign-in   GoTrue: POST /auth/v1/otp (magic link), /auth/v1/token?grant_type=refresh_token, /auth/v1/logout
//   data      PostgREST /rest/v1/* with the reviewer's access token; row rules and triggers decide what works
//   assistant the assist Edge Function, POST /functions/v1/assist
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
} from './reviewmodel.js';

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
};

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
      <textarea id="dialog-reason" rows="3" maxlength="${LIMITS.note}"></textarea>
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
    <p class="rv-nav__group" id="nav-state">Statehouse</p>
    <ul class="rv-nav" aria-labelledby="nav-state">${item('votes', S.votesError ? null : S.votes.length)}${S.collector ? item('collector', null) : ''}</ul>`;
}

function rows() {
  if (S.view === 'votes') return S.votes.filter((v) => matchesVote(v, S.q));
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
function stateRow(s) {
  const r = s.last_result || {};
  const res = r.error ? `Error: ${r.error}` : r.started ? 'Started, not finished' : Number.isFinite(r.kept) ? `${r.kept} kept of ${r.votes_seen ?? 0} seen` : 'Not run yet';
  return `<span class="rv-row__title"><span class="code">${esc(s.state)}</span> ${esc(STATE_NAMES[s.state] || '')}</span>
    <span class="rv-row__meta"><span>${s.last_run_at ? `ran ${esc(relTime(s.last_run_at))}` : 'never run'}</span><span>${esc(res)}</span></span>`;
}

function renderList() {
  const def = VIEWS[S.view];
  const list = rows();
  const total = S.view === 'votes' ? S.votes.length : S.view === 'collector' ? S.collector?.states.length ?? 0 : topicsForView(S.topics, S.view).length;
  const isTopics = 'status' in def;
  if (S.active >= list.length) S.active = list.length - 1;
  const empty = S.q.trim() && total ? 'Nothing in this view matches your search.' : S.view === 'votes' && S.votesError ? `Couldn’t load votes: ${S.votesError}` : def.empty;
  $('#list-pane').innerHTML = `<div class="rv-list__head">
      <h2 class="rv-list__title signage" id="list-title">${esc(def.title)} <span class="num rv-list__n">${list.length === total ? total : `${list.length} of ${total}`}</span></h2>
      ${isTopics ? '<button type="button" class="btn btn--primary rv-new" id="new-topic">New topic</button>' : ''}
    </div>
    ${S.view === 'votes' && !S.features.notes ? '<p class="rv-quiet">Until the reviewer-console migration is applied, this shows only what visitors see: nothing while the switch is off.</p>' : ''}
    ${list.length ? `<p class="rv-keys" id="list-keys"><kbd>j</kbd> <kbd>k</kbd> or <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open</p>
    <ul class="rv-rows" id="rows" role="listbox" tabindex="0" aria-labelledby="list-title" aria-describedby="list-keys"${S.active >= 0 ? ` aria-activedescendant="row-${S.active}"` : ''}>
      ${list.map((r, i) => `<li role="option" id="row-${i}" class="rv-row${i === S.active ? ' is-active' : ''}" data-i="${i}" data-id="${esc(rowId(r))}" aria-selected="${rowId(r) === S.selected ? 'true' : 'false'}">
        ${S.view === 'votes' ? voteRow(r) : S.view === 'collector' ? stateRow(r) : topicRow(r)}</li>`).join('')}
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
  setPane('detail');
  renderList();
  renderDetail();
  if (focus) $('#detail-title')?.focus();
  if ('status' in VIEWS[S.view] && topic(id)) {
    await Promise.all([loadNotes(id), loadActivity(id), loadAssistStatus()]);
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
  if (S.creating) el.innerHTML = newTopicDetail();
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
  });
  // toggle does not bubble, so listen while it travels down. Remembers whether the assistant is open.
  detail.addEventListener('toggle', (e) => { if (e.target.id === 'assist') S.assistOpen = e.target.open; }, true);
  detail.addEventListener('input', (e) => {
    const el = e.target;
    const max = { title: LIMITS.title, neutral_fact: LIMITS.neutral_fact, quote: LIMITS.quote, body: LIMITS.note }[el.name];
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

  await Promise.all([loadTopics(), loadVotes(), loadCollector(), detectFeatures()]);
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
