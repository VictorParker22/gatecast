// The reviewer console's Weird news logic (js/reviewmodel.js): tips, picks, the hook line (checklist, Claude's drafts)
// and the click badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWS, CATEGORY_LABEL, PICK_LIMITS, pickErrors, cleanPick, pickBlock, picksForView, tipsForView, tipHost, pickFromTip,
  pickSaveError, pickTimeline, pickUrlProblem, matchesPick, matchesTip, hookChecks, HOOK_MAX, CLICKBAIT, topicsForView,
  HOOK_LABEL, hookDraftRequest, hookSuggestions, hookDraftNotes, clicksLabel,
} from '../js/reviewmodel.js';

const GOOD = { url: 'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131/?utm_source=rss', title: 'Sheep on the run for 45 days lassoed by teen', outlet: 'UPI', published: '2026-11-13', category: 'animals', rating: '4', note: 'Caught on horseback, with a lasso.' };

test('the Tips and Picks views exist and are not topic views', () => {
  assert.equal(VIEWS.tips.title, 'Tips');
  assert.equal(VIEWS.picks.title, 'Picks');
  assert.equal('status' in VIEWS.tips, false);
  assert.deepEqual(topicsForView([{ id: 'a', status: 'draft' }], 'tips'), []);
  assert.deepEqual(Object.keys(CATEGORY_LABEL), ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other']);
});

test('pick form checks mirror the database', () => {
  assert.deepEqual(pickErrors(GOOD), {});
  assert.deepEqual(pickErrors({ ...GOOD, rating: '' }), {}, 'unrated is fine');
  const e = pickErrors({ url: 'http://a.com/x', title: '', outlet: ' ', published: '13/11/2026', category: 'aliens', rating: '7', note: 'x'.repeat(PICK_LIMITS.note + 1) });
  assert.deepEqual(Object.keys(e).sort(), ['category', 'note', 'outlet', 'published', 'rating', 'title', 'url']);
  assert.equal(pickErrors({ ...GOOD, title: 'x'.repeat(301) }).title, 'Keep the headline to 300 characters.');
  assert.equal(pickErrors({ ...GOOD, note: 'é'.repeat(PICK_LIMITS.note) }).note, undefined);
  assert.equal(PICK_LIMITS.note, 140, 'the hook: the database allows 140 characters');
  assert.equal(PICK_LIMITS.note, HOOK_MAX);
  assert.match(pickErrors({ ...GOOD, note: 'x'.repeat(141) }).note, /hook to 140/);
  assert.equal(pickErrors({ ...GOOD, note: `${'x'.repeat(70)}   ${'x'.repeat(69)}` }).note, undefined, 'counted as saved, spaces collapsed');
});

test('pick links: https to a public site', () => {
  assert.equal(pickUrlProblem(GOOD.url), null);
  assert.match(pickUrlProblem(''), /Paste/);
  assert.match(pickUrlProblem('www.upi.com/x'), /full link/);
  assert.match(pickUrlProblem('http://www.upi.com/x'), /https/);
  assert.match(pickUrlProblem('https://u:p@upi.com/x'), /plain/);
  assert.match(pickUrlProblem('https://upi.com:8443/x'), /plain/);
  for (const bad of ['https://localhost/x', 'https://127.0.0.1/x', 'https://router.lan/x', 'https://[::1]/x', 'https://intranet/x']) assert.match(pickUrlProblem(bad), /public/, bad);
});

test('picks are saved trimmed, with the link normalised like story ids', () => {
  assert.deepEqual(cleanPick({ ...GOOD, title: '  Sheep  on the run ', note: '  ' }), {
    url: 'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131', title: 'Sheep on the run', outlet: 'UPI',
    published: '2026-11-13', category: 'animals', rating: 4, note: null,
  });
  assert.equal(cleanPick({ ...GOOD, rating: '' }).rating, null);
  assert.equal(cleanPick({ ...GOOD, published: '' }).published, null);
});

test('a pick can be published once its fields are complete', () => {
  const p = { ...cleanPick(GOOD), status: 'draft' };
  assert.equal(pickBlock(p), null);
  assert.equal(pickBlock({ ...p, status: 'withdrawn' }), null);
  assert.equal(pickBlock({ ...p, status: 'published' }), 'Already published.');
  assert.match(pickBlock({ ...p, published: null }), /published it/);
  assert.match(pickBlock({ ...p, outlet: '' }), /outlet/);
  assert.equal(pickBlock(null), 'Choose a pick.');
});

test('picks list: drafts, then published by story date, then withdrawn; search', () => {
  const P = [
    { id: 'w', status: 'withdrawn', title: 'Old goat', outlet: 'AP', updated_at: '2026-11-16T09:00:00Z' },
    { id: 'p1', status: 'published', title: 'Frog choir', outlet: 'UPI', published: '2026-11-10', updated_at: '2026-11-16T10:00:00Z' },
    { id: 'p2', status: 'published', title: 'Hail like eggs', outlet: 'Sky', category: 'weather', published: '2026-11-14', updated_at: '2026-11-11T10:00:00Z' },
    { id: 'd1', status: 'draft', title: 'Law against kites', outlet: 'BBC', updated_at: '2026-11-15T10:00:00Z' },
    { id: 'd2', status: 'draft', title: 'Record yo-yo', outlet: 'UPI', updated_at: '2026-11-16T11:00:00Z' },
  ];
  assert.deepEqual(picksForView(P).map((p) => p.id), ['d2', 'd1', 'p2', 'p1', 'w']);
  assert.deepEqual(picksForView(P, 'upi').map((p) => p.id), ['d2', 'p1']);
  assert.deepEqual(picksForView(P, 'weird weather').map((p) => p.id), ['p2'], 'category names are searchable');
  assert.equal(matchesPick(P[0], ''), true);
  assert.deepEqual(picksForView(null), []);
});

test('tips: new ones only, oldest first; host; what Accept fills in', () => {
  const T = [
    { id: 'b', status: 'new', url: 'https://www.odditycentral.com/news/x.html', note: 'A goat mayor', created_at: '2026-11-16T10:00:00Z' },
    { id: 'a', status: 'new', url: 'https://www.upi.com/Odd_News/y/', note: null, created_at: '2026-11-15T10:00:00Z' },
    { id: 'c', status: 'rejected', url: 'https://spam.example.com', created_at: '2026-11-14T10:00:00Z' },
  ];
  assert.deepEqual(tipsForView(T).map((t) => t.id), ['a', 'b']);
  assert.deepEqual(tipsForView(T, 'goat').map((t) => t.id), ['b']);
  assert.equal(matchesTip(T[1], 'upi'), true);
  assert.equal(tipHost(T[0].url), 'odditycentral.com');
  assert.equal(tipHost('nope'), '');
  const draft = pickFromTip({ url: 'https://www.upi.com/Odd_News/y/?utm_source=x', note: 'so weird!!' });
  assert.equal(draft.url, 'https://www.upi.com/Odd_News/y');
  assert.equal(draft.note, '', 'the visitor’s note is never copied into the pick');
  assert.equal(draft.title, '');
});

test('pick save errors and history', () => {
  assert.match(pickSaveError(409, { code: '23505', message: 'duplicate key value violates unique constraint' }), /already a pick/);
  assert.match(pickSaveError(400, { code: '23514' }), /refused/);
  assert.equal(pickSaveError(403, { message: 'Only a reviewer can publish' }), 'Only a reviewer can publish');
  const p = { created_at: '2026-11-15T10:00:00Z', published_at: '2026-11-16T10:00:00Z' };
  assert.deepEqual(pickTimeline(p, undefined).map((x) => x.text), ['Created as a draft', 'Published']);
  assert.deepEqual(pickTimeline(p, [
    { action: 'withdrawn', at: '2026-11-16T12:00:00Z', actor_email: 'ed@example.org' },
    { action: 'published', at: '2026-11-16T10:00:00Z' },
    { action: 'mystery', at: '2026-11-16T11:00:00Z' },
  ]).map((x) => x.text), ['Created as a draft', 'Published', 'Withdrawn by ed@example.org']);
  assert.deepEqual(pickTimeline(null), []);
});

test('hook checklist: length is a hard rule, the rest are warnings', () => {
  const ok = hookChecks('Forty-five days on the run. Then a teenager with a lasso.');
  assert.ok(ok.every((c) => c.ok));
  assert.deepEqual(ok.map((c) => [c.id, c.hard]), [['length', true], ['clickbait', false], ['caps', false], ['marks', false]]);
  assert.equal(HOOK_MAX, 140);
  assert.equal(hookChecks('x'.repeat(141))[0].ok, false);
  assert.equal(hookChecks('x'.repeat(140))[0].ok, true);
  assert.equal(hookChecks('x'.repeat(150), 200)[0].ok, true);
  const bad = hookChecks('SHOCKING: you won\'t believe WHAT HAPPENED NEXT?!');
  assert.deepEqual(bad.filter((c) => !c.ok).map((c) => c.id), ['clickbait', 'caps', 'marks']);
  assert.match(bad[1].detail, /you won’t believe/);
  assert.match(bad[1].detail, /what happened next/);
  for (const phrase of CLICKBAIT) assert.equal(hookChecks(`Ok ${phrase.toUpperCase()}`)[1].ok, false, phrase);
  assert.equal(hookChecks('NASA and the BBC say so')[2].ok, false, 'four-letter capitals count');
  assert.equal(hookChecks('The BBC and UPI say so')[2].ok, true, 'three letters or fewer do not');
  assert.equal(hookChecks('Why? Nobody knows.')[3].ok, true);
  assert.equal(hookChecks('Why? Nobody knows!')[3].ok, false);
  assert.equal(hookChecks('')[0].ok, true);
});

test('the hook field: label, and what "Draft with Claude" sends', () => {
  assert.equal(HOOK_LABEL, 'Hook (your words, shown under the headline)');
  assert.deepEqual(hookDraftRequest({ title: '  Sheep  on the run ', outlet: ' UPI ', url: 'https://www.upi.com/x' }), {
    ok: true, body: { action: 'draft_hook', title: 'Sheep on the run', outlet: 'UPI' },
  }, 'the headline only: the link is not sent unless the reviewer asks for the page to be read');
  assert.deepEqual(hookDraftRequest({ title: 'Sheep', outlet: 'UPI', url: ' https://www.upi.com/x ' }, { readPage: true }).body.url, 'https://www.upi.com/x');
  assert.equal(hookDraftRequest({ title: '' }).ok, false);
  assert.match(hookDraftRequest({ title: ' ' }).message, /headline first/);
  assert.match(hookDraftRequest({ title: 'Sheep', url: 'http://a.com/x' }, { readPage: true }).message, /https link/);
  assert.equal(hookDraftRequest({ title: 'h'.repeat(400) }).body.title.length, PICK_LIMITS.title);
});

test('Claude’s hook suggestions: at most three, each with its own checklist; notes say what was read', () => {
  const r = { hooks: [{ text: ' Forty-five days on the run. ', basis: 'for 45 days' }, { text: 'Why? Who knows!', basis: '' }, { text: '' }, { text: 'c' }, { text: 'd' }, { nope: 1 }], dropped: 2, source: 'headline', fallback: true };
  const list = hookSuggestions(r);
  assert.equal(list.length, 3);
  assert.equal(list[0].text, 'Forty-five days on the run.');
  assert.equal(list[0].basis, 'for 45 days');
  assert.ok(list[0].checks.every((c) => c.ok));
  assert.equal(list[1].checks.find((c) => c.id === 'marks').ok, false, 'the reviewer sees what a suggestion fails');
  assert.deepEqual(hookSuggestions(null), []);
  const notes = hookDraftNotes(r);
  assert.match(notes[0], /headline only/);
  assert.ok(notes.some((n) => /2 suggestions .* left out/.test(n)));
  assert.ok(notes.some((n) => /fallback/.test(n)));
  const page = hookDraftNotes({ hooks: [], source: 'page', truncated: true, dropped: 0 });
  assert.match(page[0], /story page \(its first part\)/);
  assert.ok(page.some((n) => /no hook it could stand behind/.test(n)));
  assert.ok(hookDraftNotes({ hooks: [{ text: 'x' }], source: 'headline', page_problem: { message: 'The page took too long.' } }).some((n) => /not read: The page took too long/.test(n)));
});

test('clicks badge: anonymous totals for the last 7 days', () => {
  assert.equal(clicksLabel(0), 'No clicks in 7 days');
  assert.equal(clicksLabel(1), '1 click in 7 days');
  assert.equal(clicksLabel(1234), '1,234 clicks in 7 days');
  assert.equal(clicksLabel(5, 30), '5 clicks in 30 days');
  for (const unknown of [null, undefined, '', 'x', -1]) assert.equal(clicksLabel(unknown), '', String(unknown));
});
