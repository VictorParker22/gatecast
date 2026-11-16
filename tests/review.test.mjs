import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  counts, bySide, coverage, publishBlock, missingSide, matchesTopic, matchesVote, topicsForView, relTime, moveIndex,
  counter, topicErrors, statementErrors, cleanStatement, timeline, parseAuthHash, expiry, needsRefresh, refreshIn,
  reviewerSql, errorText, isMissingFeature, assistOutcome, issueTarget, draftNotes, assistTopic, placeLabel,
  NOT_CONFIGURED, remainingText, elapsed, verifyResult,
} from '../js/reviewmodel.js';

const st = (side, speaker, created_at = '2026-11-16T10:00:00Z') => ({ side, speaker, quote: 'Q', source_url: 'https://a.gov/q', created_at });
const T = [
  { id: 'a', title: 'Rail funding', place: 'OH', status: 'draft', created_at: '2026-11-16T09:00:00Z', statements: [st('D', 'Ann Smith'), st('R', 'Bob Jones')] },
  { id: 'b', title: 'Gas prices', place: 'US', status: 'draft', created_at: '2026-11-15T09:00:00Z', statements: [st('D', 'Cy Doe')] },
  { id: 'c', title: 'School meals', place: 'NE', status: 'published', created_at: '2026-11-10T09:00:00Z', published_at: '2026-11-12T09:00:00Z', statements: [st('R', 'Di'), st('D', 'Ed')] },
  { id: 'd', title: 'Ferry fares', place: 'WA', status: 'published', created_at: '2026-11-11T09:00:00Z', published_at: '2026-11-14T09:00:00Z', statements: [] },
  { id: 'e', title: 'Old idea', place: 'US', status: 'rejected', created_at: '2026-11-01T09:00:00Z', statements: [] },
];

test('counts per view', () => {
  assert.deepEqual(counts(T), { needs: 2, published: 2, rejected: 1, all: 5 });
  assert.deepEqual(counts(null), { needs: 0, published: 0, rejected: 0, all: 0 });
});

test('side coverage and the publish rule', () => {
  assert.deepEqual(coverage(T[0]), { D: true, R: true, other: 0, count: 2 });
  assert.deepEqual(coverage({ statements: [st('other', 'X')] }), { D: false, R: false, other: 1, count: 1 });
  assert.equal(publishBlock(T[0]), null);
  assert.equal(publishBlock(T[1]), 'Add a Republican statement before publishing.');
  assert.equal(publishBlock({ status: 'draft', statements: [st('R', 'x')] }), 'Add a Democrat statement before publishing.');
  assert.equal(publishBlock({ status: 'draft', statements: [st('other', 'x')] }), 'Add a Democrat and a Republican statement before publishing.');
  assert.equal(publishBlock(T[2]), 'Already published.');
  assert.equal(missingSide(T[1]), 'R');
  assert.equal(missingSide(T[0]), 'other');
  const g = bySide([st('D', 'late', '2026-11-16T12:00:00Z'), st('D', 'early', '2026-11-16T08:00:00Z'), st('X', 'odd'), null]);
  assert.deepEqual(g.D.map((s) => s.speaker), ['early', 'late']);
  assert.equal(g.other.length, 0);
});

test('views: needs review is first in, first out', () => {
  assert.deepEqual(topicsForView(T, 'needs').map((t) => t.id), ['b', 'a']);
  assert.deepEqual(topicsForView(T, 'published').map((t) => t.id), ['d', 'c']);
  assert.deepEqual(topicsForView(T, 'all').map((t) => t.id), ['a', 'b', 'd', 'c', 'e']);
  assert.deepEqual(topicsForView(T, 'votes'), []);
  assert.deepEqual(topicsForView(T, 'nope'), []);
});

test('search by title, place code or name, and speaker', () => {
  assert.deepEqual(topicsForView(T, 'all', 'rail').map((t) => t.id), ['a']);
  assert.deepEqual(topicsForView(T, 'all', 'nebraska').map((t) => t.id), ['c']);
  assert.deepEqual(topicsForView(T, 'all', 'oh').map((t) => t.id), ['a']);
  assert.deepEqual(topicsForView(T, 'needs', 'jones').map((t) => t.id), ['a']);
  assert.equal(matchesTopic(T[0], '  '), true);
  assert.equal(matchesTopic({ title: 'Café funding' }, 'cafe'), true);
  assert.equal(matchesVote({ bill_identifier: 'HB 397', bill_title: 'Jail commissary funds', state: 'OH' }, 'ohio hb'), true);
  assert.equal(matchesVote({ bill_identifier: 'HB 397', state: 'OH' }, 'senate'), false);
  assert.equal(placeLabel('US'), 'National');
  assert.equal(placeLabel('OH'), 'Ohio');
});

test('relative time', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(relTime('2026-11-16T11:59:30Z', now), 'just now');
  assert.equal(relTime('2026-11-16T11:55:00Z', now), '5 min ago');
  assert.equal(relTime('2026-11-16T10:00:00Z', now), '2 h ago');
  assert.equal(relTime('2026-11-13T12:00:00Z', now), '3 d ago');
  assert.equal(relTime('2026-09-01T12:00:00Z', now), 'on 1 Sep 2026');
  assert.equal(relTime(null, now), '');
});

test('list keys', () => {
  assert.equal(moveIndex(-1, 'j', 3), 0);
  assert.equal(moveIndex(0, 'ArrowDown', 3), 1);
  assert.equal(moveIndex(2, 'j', 3), 2);
  assert.equal(moveIndex(1, 'k', 3), 0);
  assert.equal(moveIndex(0, 'ArrowUp', 3), 0);
  assert.equal(moveIndex(-1, 'k', 3), 0);
  assert.equal(moveIndex(1, 'End', 3), 2);
  assert.equal(moveIndex(1, 'Home', 3), 0);
  assert.equal(moveIndex(1, 'x', 3), null);
  assert.equal(moveIndex(0, 'j', 0), null);
});

test('forms', () => {
  assert.deepEqual(counter('  abc ', 1200), { n: 3, over: false, text: '3 / 1,200' });
  assert.equal(counter('x'.repeat(1201), 1200).over, true);
  assert.deepEqual(topicErrors({ title: 'T', place: 'US', neutral_fact: 'F', neutral_fact_source: 'https://a.gov/x' }), {});
  const e = topicErrors({ title: '', place: 'ZZ', neutral_fact: 'x'.repeat(601), neutral_fact_source: 'http://a.gov' });
  assert.deepEqual(Object.keys(e).sort(), ['neutral_fact', 'neutral_fact_source', 'place', 'title']);
  assert.deepEqual(statementErrors({ side: 'D', speaker: 'A', quote: 'Q', said_on: '2026-11-10', source_url: 'https://a.gov/q' }), {});
  const s = statementErrors({ side: 'X', speaker: '', role: 'r'.repeat(161), quote: 'q'.repeat(1201), said_on: '10/11/2026', source_url: 'https://' });
  assert.deepEqual(Object.keys(s).sort(), ['quote', 'role', 'said_on', 'side', 'source_url', 'speaker']);
  assert.deepEqual(cleanStatement({ side: 'R', speaker: ' B ', role: ' ', quote: ' Q ', said_on: '', source_url: ' https://a.gov ' }),
    { side: 'R', speaker: 'B', role: null, quote: 'Q', said_on: null, source_url: 'https://a.gov' });
});

test('activity timeline', () => {
  const t = { created_at: '2026-11-10T09:00:00Z', published_at: '2026-11-12T09:00:00Z', status: 'published' };
  assert.deepEqual(timeline(t).map((x) => x.text), ['Created as a draft', 'Published']);
  const log = [
    { action: 'withdrawn', actor_email: 'ann@example.org', at: '2026-11-11T09:00:00Z' },
    { action: 'published', actor_email: 'ann@example.org', at: '2026-11-10T10:00:00Z' },
    { action: 'published', actor_email: null, at: '2026-11-12T09:00:00Z' },
  ];
  assert.deepEqual(timeline(t, log).map((x) => x.text),
    ['Created as a draft', 'Published by ann@example.org', 'Withdrawn to draft by ann@example.org', 'Published']);
  assert.deepEqual(timeline({ ...t, status: 'rejected', published_at: null }).map((x) => x.text), ['Created as a draft', 'Marked rejected']);
  assert.deepEqual(timeline(null), []);
});

test('sign-in return and session refresh', () => {
  const ok = parseAuthHash('#access_token=abc&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink', 1000);
  assert.deepEqual(ok, { access_token: 'abc', refresh_token: 'r1', expires_at: 1000 + 3600e3 });
  assert.equal(parseAuthHash('#access_token=a&expires_at=2000000000').expires_at, 2e12);
  assert.deepEqual(parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    { error: 'Email link is invalid or has expired' });
  assert.equal(parseAuthHash(''), null);
  assert.equal(expiry(undefined, 60, 0), 60e3);
  assert.equal(needsRefresh({ expires_at: 100e3 }, 50e3), true);
  assert.equal(needsRefresh({ expires_at: 1000e3 }, 0), false);
  assert.equal(needsRefresh(null), false);
  assert.equal(refreshIn({ expires_at: 3600e3 }, 0), 3540e3);
  assert.equal(refreshIn({ expires_at: 10e3 }, 0), 1000);
});

test('the owner\'s SQL, with quotes escaped', () => {
  assert.equal(reviewerSql('ann@example.org'), "insert into public.reviewers (user_id) select id from auth.users where email = 'ann@example.org';");
  assert.equal(reviewerSql("o'neil@example.org"), "insert into public.reviewers (user_id) select id from auth.users where email = 'o''neil@example.org';");
});

test('database replies', () => {
  assert.equal(errorText({ message: 'A topic needs a statement from each side before it can be published', code: '23514' }),
    'A topic needs a statement from each side before it can be published');
  assert.equal(errorText({ msg: 'Signups not allowed for otp' }), 'Signups not allowed for otp');
  assert.equal(errorText(null, 500), 'The request failed (500).');
  assert.equal(errorText(null), 'The request failed. Check your connection and try again.');
  assert.equal(isMissingFeature(404, { code: 'PGRST205' }), true);
  assert.equal(isMissingFeature(401, { code: '42501', message: 'permission denied for table collector_runs' }), true);
  assert.equal(isMissingFeature(400, { code: '23514' }), false);
  assert.equal(isMissingFeature(500, null), false);
});

test('assistant replies', () => {
  assert.equal(assistOutcome(200, {}).kind, 'ok');
  assert.equal(assistOutcome(401, { error: 'unauthorized' }).kind, 'signed_out');
  assert.equal(assistOutcome(403, { error: 'not_a_reviewer' }).kind, 'not_reviewer');
  assert.deepEqual(assistOutcome(404), { kind: 'not_deployed', message: 'The assistant turns on once the assist function is deployed in Supabase.' });
  assert.equal(assistOutcome(0).kind, 'not_deployed');
  assert.deepEqual(assistOutcome(503, { error: 'assistant_not_configured' }), { kind: 'not_configured', message: NOT_CONFIGURED });
  assert.equal(assistOutcome(503, { error: 'other' }).kind, 'error');
  assert.equal(assistOutcome(429, { error: 'rate_limited', retry_after: 600 }).message, 'You have used this hour’s assistant requests. Try again in 10 minutes.');
  assert.equal(assistOutcome(429, { error: 'rate_limited', retry_after: 30 }).message, 'You have used this hour’s assistant requests. Try again in 1 minute.');
  assert.equal(assistOutcome(429, { error: 'claude_busy' }).message, 'Claude is busy. Try again in a few minutes.');
  assert.equal(assistOutcome(422, { error: 'declined', category: 'x' }).kind, 'declined');
  assert.deepEqual(assistOutcome(422, { error: 'source_unreadable', reason: 'pdf', message: 'This link is a PDF. Check it by hand.', http_status: 200 }),
    { kind: 'unreadable', message: 'This link is a PDF. Check it by hand.' });
  assert.equal(assistOutcome(502, { error: 'claude_overloaded' }).message, 'Claude is overloaded right now. Try again in a few minutes.');
  assert.equal(assistOutcome(502, { error: 'assistant_key_rejected' }).kind, 'error');
  assert.equal(assistOutcome(502, { error: 'something_new' }).message, 'The assistant could not answer: something new');
  assert.equal(assistOutcome(400, { error: 'bad_request', message: 'quote is empty' }).message, 'quote is empty');
  assert.equal(assistOutcome(546).message, 'That took too long. Try a shorter page or a narrower hint.');
  assert.equal(remainingText({ configured: true, limit: 30, remaining: 27 }), '27 checks left this hour');
  assert.equal(remainingText({ remaining: 1 }), '1 check left this hour');
  assert.equal(remainingText(null), '');
  assert.equal(elapsed(0, 12_900), '12 s');
  assert.deepEqual(verifyResult({ status: 'found', context: 'abc' }), { status: 'found', label: 'Found in source', detail: '', context: 'abc' });
  assert.equal(verifyResult({ status: 'unreachable', reason: 'timeout', message: 'The page took too long to answer.' }).detail, 'The page took too long to answer.');
  assert.equal(verifyResult({ status: 'weird' }).status, 'unreachable');
  assert.deepEqual(issueTarget('title'), { target: 'topic', field: 'title' });
  assert.deepEqual(issueTarget('statements[1].quote'), { target: 'statement', index: 1, field: 'quote' });
  assert.deepEqual(issueTarget('statements.0.source_url'), { target: 'statement', index: 0, field: 'source_url' });
  assert.deepEqual(issueTarget('fact'), { target: 'topic', field: 'neutral_fact' });
  assert.equal(issueTarget('statements').target, 'none');
  assert.equal(issueTarget('balance').target, 'none');
  assert.deepEqual(draftNotes({ dropped: 2, truncated: true, chars_read: 80000, total_chars: 212345, fallback: true }), [
    '2 quotes Claude proposed were left out: not on the page word for word.',
    'The page was long, so only the first 80,000 of 212,345 characters were read.',
    'Answered by Anthropic’s fallback model after the first model declined.',
  ]);
  assert.deepEqual(draftNotes({ dropped: 0 }), []);
  const a = assistTopic({ ...T[0], id: 'x', status: 'draft' });
  assert.deepEqual(Object.keys(a), ['title', 'place', 'neutral_fact', 'neutral_fact_source', 'statements']);
  assert.deepEqual(Object.keys(a.statements[0]), ['side', 'speaker', 'role', 'quote', 'said_on', 'source_url']);
});
