// The editor's summary ("In our words"): the shared rules (js/summaryrules.js, deployed with the assistant as
// supabase/functions/assist/summaryrules.mjs), the assistant's draft_summary (request, content, schema, re-checks,
// bot walls; no network), the console's checklist and request, the picks' summary column on the server, and the
// migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as rules from '../js/summaryrules.js';
import * as assistRules from '../supabase/functions/assist/summaryrules.mjs';
import {
  validateRequest, ACTIONS, CLAUDE_ACTIONS, SUMMARY_SCHEMA, summaryContent, shapeSummaryResult, pageGrams, isBotWall,
  FETCH_MESSAGES, SYSTEM_PROMPT, claudeRequest, SUMMARY_COUNT, SUMMARY_PAGE_MAX_CHARS,
} from '../supabase/functions/assist/logic.mjs';
import {
  pickErrors, cleanPick, summaryDraftRequest, summarySuggestions, summaryDraftNotes, pickVideoLink, PICK_LIMITS, summaryColumnsMissing,
  mediaColumnsMissing, SUMMARY_COLUMNS, pickBlock,
} from '../js/reviewmodel.js';

const require = createRequire(import.meta.url);
const picksDb = require('../lib/picks-db.js');
const weird = require('../lib/weird.js');
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const TITLE = 'Moose boards city bus in Anchorage, rides three stops before stepping off';
const PAGE = 'ANCHORAGE, Alaska, Nov. 16 (UPI) -- A young moose climbed onto a People Mover bus at the downtown transit centre on Monday morning and rode for three stops before stepping off near a park, transit officials said. The driver kept the doors open and passengers moved to the back of the bus. Nobody was hurt.';
const GOOD = 'A young moose climbed aboard a city bus in Anchorage on Monday and stayed on for three stops. The driver left the doors open while the other riders moved to the back. Transit officials say nobody was hurt and the moose left on its own beside a park.';

/* ---------- One rulebook in two places ---------- */

test('the console and the assistant use the same summary rules, byte for byte, and no backslash-u escapes', () => {
  assert.equal(read('js/summaryrules.js'), read('supabase/functions/assist/summaryrules.mjs'));
  for (const f of ['supabase/functions/assist/summaryrules.mjs', 'supabase/functions/assist/logic.mjs', 'supabase/functions/assist/index.ts']) {
    assert.ok(!/\\u[0-9a-fA-F]{4}|\\u\{/.test(read(f)), `${f} has no \\u escapes (a deploy tool mangles them)`);
  }
  assert.equal(rules.SUMMARY_MAX, 700);
  assert.equal(assistRules.COPY_RUN, 8);
});

test('sentences and words are counted the way a reader would', () => {
  assert.equal(rules.sentences(GOOD).length, 3);
  assert.equal(rules.sentences('Mr. Smith saw it at 3 p.m. on Monday. The U.S. Coast Guard came too.').length, 2);
  assert.equal(rules.sentences('“It was odd,” she said. Then it left!').length, 2);
  assert.equal(rules.sentences('').length, 0);
  assert.deepEqual(rules.words('Moose’s bus-ride, café!'), ['mooses', 'bus', 'ride', 'cafe']);
});

test('the copy check: a run of 8 words shared with a source is copied, 7 is not; hashed runs work the same', () => {
  const src = 'one two three four five six seven eight nine ten';
  assert.equal(rules.sharedRun('we said one two three four five six seven and stopped', src).words, 0, '7 words in a row is fine');
  assert.deepEqual(rules.sharedRun('we said one two three four five six seven eight and stopped', src), { words: 8, phrase: 'one two three four five six seven eight' });
  assert.equal(rules.sharedRun('One, two; THREE four — five six seven eight nine.', src).words, 9, 'case and punctuation do not hide a copy');
  const grams = rules.gramHashes(src);
  assert.equal(grams.length, 3);
  assert.deepEqual(rules.sharedRun('so one two three four five six seven eight nine', grams), { words: 9, phrase: 'one two three four five six seven eight nine' });
  assert.equal(rules.sharedRun('so one two three four five six seven', new Set(grams)).words, 0);
  assert.equal(rules.hashKey('a b c'), rules.hashKey('a b c'));
});

test('the checklist: 2–4 sentences, at most 700 characters, nothing copied from the headline or the page', () => {
  const ids = (text, ctx) => rules.summaryChecks(text, ctx).filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(ids(GOOD, { title: TITLE, page: PAGE }), []);
  assert.deepEqual(ids('Just one sentence here.', { title: TITLE }), ['sentences']);
  assert.deepEqual(ids('One. Two. Three. Four. Five.', { title: TITLE }), ['sentences']);
  assert.deepEqual(ids(`${'Word '.repeat(150)}end. Second sentence here.`, {}), ['length']);
  assert.deepEqual(ids(`The headline says ${TITLE.toLowerCase()}. That is all.`, { title: TITLE }), ['headline']);
  assert.deepEqual(ids('Officials said a young moose climbed onto a People Mover bus at the downtown transit centre. It left later.', { title: TITLE, page: PAGE }), ['page']);
  assert.deepEqual(ids('Officials said a young moose climbed onto a People Mover bus at the downtown transit centre. It left later.', { title: TITLE, pageGrams: rules.gramHashes(PAGE) }), ['page']);
  assert.deepEqual(ids('It happened on Monday. It was odd!', {}), ['calm']);
  assert.deepEqual(ids('It happened on Monday. It was odd', {}), ['stop']);
  const c = rules.summaryChecks(GOOD, { title: TITLE });
  assert.match(c.find((x) => x.id === 'page').label, /checked when Claude reads it/, 'says when the page has not been read');
  assert.deepEqual(rules.summaryProblems('', {}), ['empty']);
  assert.deepEqual(rules.summaryProblems('Only one.', {}), ['sentences']);
  assert.deepEqual(rules.summaryProblems('First part of it here now. They said one two three four five six seven eight.', { notes: 'one two three four five six seven eight' }), ['copied_notes']);
});

/* ---------- The assistant: draft_summary ---------- */

test('draft_summary requests: a headline is required; outlet, link and notes are optional and capped', () => {
  assert.ok(ACTIONS.includes('draft_summary') && CLAUDE_ACTIONS.includes('draft_summary'));
  assert.match(validateRequest({ action: 'draft_summary' }).message, /title is required/);
  assert.match(validateRequest({ action: 'draft_summary', title: 'T', notes: 4 }).message, /notes must be text/);
  assert.match(validateRequest({ action: 'draft_summary', title: 'T', url: 4 }).message, /url must be text/);
  const v = validateRequest({ action: 'draft_summary', title: '  Moose   on a bus ', outlet: ' UPI ', url: ' https://www.upi.com/x ', notes: `Anchorage,\t Monday\n\n\n\nthree stops ${'x'.repeat(2000)}` });
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.input), ['title', 'outlet', 'url', 'notes']);
  assert.equal(v.input.title, 'Moose on a bus');
  assert.equal(v.input.url, 'https://www.upi.com/x');
  assert.ok(v.input.notes.startsWith('Anchorage, Monday\n\nthree stops'));
  assert.ok(v.input.notes.length <= 1500);
});

test('draft_summary content: the headline, outlet and notes as data; the page first as an untrusted document', () => {
  const plain = summaryContent({ title: TITLE, outlet: 'UPI', notes: '' });
  assert.equal(plain.length, 1);
  assert.match(plain[0].text, /^Task D: draft a summary/);
  assert.match(plain[0].text, /No story page is given: use the headline only/);
  assert.ok(plain[0].text.includes(`<headline>${JSON.stringify(TITLE)}</headline>`));
  const withNotes = summaryContent({ title: TITLE, outlet: 'UPI', notes: 'Monday morning' });
  assert.match(withNotes[0].text, /headline and the editor's notes only/);
  assert.ok(withNotes[0].text.includes('<notes>"Monday morning"</notes>'));
  const page = summaryContent({ title: TITLE, outlet: 'UPI', notes: '', page: { text: PAGE, url: 'https://www.upi.com/x', truncated: true } });
  assert.equal(page[0].type, 'document');
  assert.equal(page[0].source.data, PAGE);
  assert.match(page[0].context, /Untrusted/);
  assert.match(page[1].text, /only its first part is included/);
  // The schema is closed, and the request is the shared one (model, effort, fallbacks, cached system prompt).
  assert.equal(SUMMARY_SCHEMA.additionalProperties, false);
  assert.equal(SUMMARY_SCHEMA.properties.summaries.items.additionalProperties, false);
  assert.match(SYSTEM_PROMPT, /D\. Draft a summary for a weird-news pick/);
  assert.match(SYSTEM_PROMPT, /never reuse a run of 8 or more words/);
  assert.match(SYSTEM_PROMPT, /Never mock, belittle or make fun/);
  const req = claudeRequest({ content: page, schema: SUMMARY_SCHEMA });
  assert.equal(req.output_config.format.schema, SUMMARY_SCHEMA);
  assert.equal(req.system[0].cache_control.type, 'ephemeral');
  assert.equal(SUMMARY_COUNT, 2);
  assert.equal(SUMMARY_PAGE_MAX_CHARS, 20000);
});

test('every draft is checked again: sentences, length, and no run of 8+ words from the page, headline or notes', () => {
  const raw = { summaries: [
    { text: `  “${GOOD}”  `, basis: 'page' },
    { text: GOOD, basis: 'duplicate' },
    { text: 'A moose rode a bus in Alaska on Monday. Nobody was hurt and it got off near a park.', basis: 'headline, page' },
    { text: 'Only one sentence.', basis: 'headline' },
    { text: 'Officials said a young moose climbed onto a People Mover bus at the downtown transit centre. It left later.', basis: 'copied from the page' },
    { text: `${TITLE}. That is the story.`, basis: 'the headline itself' },
    { text: `${'Long sentence here. '.repeat(40)}`, basis: 'too long' },
    { text: 'A third good one about a moose on Monday. It got off at a park.', basis: 'over the limit' },
  ] };
  const out = shapeSummaryResult(raw, { title: TITLE, pageText: PAGE, notes: '' });
  assert.deepEqual(out.summaries.map((x) => x.text), [GOOD, 'A moose rode a bus in Alaska on Monday. Nobody was hurt and it got off near a park.']);
  assert.equal(out.dropped, 6);
  assert.deepEqual(shapeSummaryResult({}, {}), { summaries: [], dropped: 0 });
  assert.equal(shapeSummaryResult({ summaries: [{ text: 'They counted one two three four five six seven eight. Then they left.' }] }, { notes: 'one two three four five six seven eight' }).dropped, 1, 'notes are facts, not text to copy');
  // The page's 8-word runs go back hashed (never the page's text), so the console can keep checking edits.
  assert.equal(pageGrams(''), null);
  const grams = pageGrams(PAGE);
  assert.ok(Array.isArray(grams) && grams.length > 20);
  assert.ok(!JSON.stringify(grams).includes('moose'));
});

test('a bot wall (UPI\'s Cloudflare check) is reported as "blocked", never worked around', () => {
  assert.equal(isBotWall({ status: 403, server: 'cloudflare' }), true);
  assert.equal(isBotWall({ status: 503, server: 'cloudflare', mitigated: '' }), true);
  assert.equal(isBotWall({ status: 403, mitigated: 'challenge' }), true);
  assert.equal(isBotWall({ status: 200, text: '<!DOCTYPE html><html><head><title>Just a moment...</title>' }), true);
  assert.equal(isBotWall({ status: 200, text: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/x"></script>' }), true);
  assert.equal(isBotWall({ status: 404, server: 'cloudflare' }), false);
  assert.equal(isBotWall({ status: 403, server: 'nginx' }), false);
  assert.equal(isBotWall({ status: 200, text: '<html><head><title>Moose</title>' }), false);
  assert.match(FETCH_MESSAGES.blocked, /bot check/);
  assert.match(FETCH_MESSAGES.blocked, /does not try to get around it/);
  // The function: draft_summary reads the page with the same fences, reports a page it cannot read, sends page_grams.
  const ts = read('supabase/functions/assist/index.ts');
  assert.match(ts, /v\.action === 'draft_summary'/);
  assert.match(ts, /page_grams: pageGrams\(read\?\.text \?\? ''\)/);
  assert.match(ts, /reason: wall \? 'blocked' : 'http_error'/);
  assert.match(ts, /Deploy all three files: index\.ts, logic\.mjs, summaryrules\.mjs/);
  assert.ok(!/User-Agent': '[^']*(Mozilla|Chrome|Safari)/.test(ts), 'no browser spoofing');
});

/* ---------- The console ---------- */

const FORM = { url: 'https://www.upi.com/Odd_News/2026/11/16/moose/1001/', title: TITLE, outlet: 'UPI', published: '2026-11-16', category: 'animals', rating: '', note: '', video: '', image_url: '', summary: '' };

test('the pick form: summary rules on save, the draft request, suggestions with their own checklist', () => {
  assert.deepEqual(pickErrors(FORM), {});
  assert.deepEqual(pickErrors({ ...FORM, summary: GOOD }), {});
  assert.match(pickErrors({ ...FORM, summary: 'One sentence only.' }).summary, /2 to 4 sentences/);
  assert.match(pickErrors({ ...FORM, summary: 'Officials said a young moose climbed onto a People Mover bus at the downtown transit centre. It left later.' }, { pageGrams: rules.gramHashes(PAGE) }).summary, /story page/);
  assert.equal(PICK_LIMITS.summary, 700);

  assert.match(summaryDraftRequest({ ...FORM, title: '' }).message, /headline first/);
  assert.deepEqual(summaryDraftRequest(FORM).body, { action: 'draft_summary', title: TITLE, outlet: 'UPI' });
  assert.deepEqual(summaryDraftRequest(FORM, { notes: '  Monday  ', readPage: true }).body, { action: 'draft_summary', title: TITLE, outlet: 'UPI', notes: 'Monday', url: FORM.url });
  assert.match(summaryDraftRequest({ ...FORM, url: 'nope' }, { readPage: true }).message, /untick/);

  const reply = { summaries: [{ text: GOOD, basis: 'page' }, { text: 'Officials said a young moose climbed onto a People Mover bus at the downtown transit centre. It left later.' }], page_grams: rules.gramHashes(PAGE), source: 'page', notes_used: true, dropped: 1, page_problem: null };
  const list = summarySuggestions(reply, { title: TITLE });
  assert.equal(list.length, 2);
  assert.ok(list[0].checks.every((c) => c.ok));
  assert.equal(list[1].checks.find((c) => c.id === 'page').ok, false);
  const notes = summaryDraftNotes(reply);
  assert.equal(notes[0], 'Drawn from the headline, your notes and the story page.');
  assert.match(notes[1], /1 draft Claude made was left out/);
  assert.match(summaryDraftNotes({ summaries: [], source: 'headline', page_problem: { message: FETCH_MESSAGES.blocked } }).join(' '), /bot check.*no summary it could stand behind/);
});

test('saving: the summary and any provider\'s video, with video_id kept for YouTube; older databases are told apart', () => {
  const vimeo = cleanPick({ ...FORM, summary: `  ${GOOD}  `, video: 'https://vimeo.com/76979871' });
  assert.equal(vimeo.summary, GOOD);
  assert.deepEqual([vimeo.video_provider, vimeo.video_ref, vimeo.video_id], ['vimeo', '76979871', null]);
  const yt = cleanPick({ ...FORM, video: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.deepEqual([yt.video_provider, yt.video_ref, yt.video_id], ['youtube', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ']);
  assert.equal(cleanPick(FORM).summary, null);
  assert.deepEqual(SUMMARY_COLUMNS, ['summary', 'video_provider', 'video_ref']);
  assert.equal(summaryColumnsMissing(400, { code: 'PGRST204', message: 'Could not find the \'summary\' column of \'weird_picks\' in the schema cache' }), true);
  assert.equal(summaryColumnsMissing(400, { code: 'PGRST204', message: 'Could not find the \'image_url\' column' }), false);
  assert.equal(mediaColumnsMissing(400, { code: '42703', message: 'column "video_provider" does not exist' }), true);
  assert.equal(pickVideoLink({ video_provider: 'tiktok', video_ref: 'odditycentral/7301234567890123456' }), 'https://www.tiktok.com/@odditycentral/video/7301234567890123456');
  assert.equal(pickVideoLink({ video_id: 'dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(pickVideoLink('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(pickBlock({ ...cleanPick({ ...FORM, summary: GOOD }), status: 'draft' }), null);
  assert.match(pickBlock({ ...cleanPick(FORM), summary: 'One sentence.', status: 'draft' }), /Edit the pick first/);
});

/* ---------- The server: picks-db and /api/weird ---------- */

test('picks-db reads the summary and any provider\'s video, and falls back to the older columns', () => {
  const row = { url: 'https://www.upi.com/Odd_News/moose', title: 'Moose', outlet: 'UPI', published: '2026-11-15', category: 'animals', rating: null, note: null, video_id: null, image_url: null };
  const p = picksDb.toPick({ ...row, summary: `  ${GOOD}\n `, video_provider: 'vimeo', video_ref: '76979871' });
  assert.equal(p.summary, GOOD);
  assert.deepEqual(p.video, { provider: 'vimeo', ref: '76979871' });
  assert.equal(picksDb.toPick({ ...row, summary: 'x'.repeat(900) }).summary.length, 700);
  assert.equal(picksDb.toPick({ ...row, summary: '   ' }).summary, null);
  assert.deepEqual(picksDb.toPick({ ...row, video_provider: 'dailymotion', video_ref: 'x8', video_id: 'dQw4w9WgXcQ' }).video, { provider: 'youtube', ref: 'dQw4w9WgXcQ' }, 'an unknown provider falls back to video_id');
  assert.equal(picksDb.toPick(row).video, null);
  assert.ok(picksDb.COLUMNS.endsWith(',summary,video_provider,video_ref'));
});

test('/api/weird: picks carry the editor\'s summary and their video from any provider; feed stories never a summary', async () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname;
    if (host === 'vimeo.com') return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ type: 'video', title: 'Lights', author_name: 'Obs', duration: 192 }) };
    return { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '', body: { cancel: async () => {} } };
  };
  const picks = [
    { url: 'https://www.upi.com/Odd_News/2026/11/15/moose-bus/1001/', title: 'Moose boards city bus and rides three stops', outlet: 'UPI', published: '2026-11-15', category: 'animals', rating: 5, note: 'Three stops.', summary: GOOD, video: { provider: 'vimeo', ref: '76979871' }, seeded: false },
    { url: 'https://www.upi.com/Odd_News/2026/11/14/goat/1002/', title: 'Goat elected honorary mayor of mountain town', outlet: 'UPI', published: '2026-11-14', category: 'animals', rating: 3, note: null, seeded: false },
  ];
  const out = await weird.weirdFor(new URLSearchParams({ limit: '10' }), { fetchImpl, lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }], now, pageCache: false, picks, dbPicks: [], sources: [] });
  const moose = out.items.find((x) => x.title.startsWith('Moose'));
  assert.equal(moose.summary, GOOD);
  assert.deepEqual(moose.media.video, { provider: 'vimeo', id: '76979871', title: 'Lights', author: 'Obs', duration: '3:12', from: 'editor' });
  assert.equal(moose.youtube, null, 'the YouTube-only field is for YouTube videos');
  assert.equal(moose.video, true);
  const goat = out.items.find((x) => x.title.startsWith('Goat'));
  assert.equal(goat.summary, null);
  assert.deepEqual(goat.media, { video: null });
});

/* ---------- The migration ---------- */

test('the migration adds the summary and provider columns, is safe to run twice, and logs edits to them', () => {
  const sql = read('supabase/migrations/20261117170000_pick_summary.sql');
  for (const c of ['summary', 'video_provider', 'video_ref']) assert.match(sql, new RegExp(`add column if not exists ${c} text;`));
  assert.match(sql, /drop constraint if exists weird_picks_summary_check;[\s\S]*check \(summary is null or char_length\(summary\) between 1 and 700\)/);
  assert.match(sql, /video_provider in \('youtube', 'vimeo', 'facebook', 'x', 'tiktok', 'instagram'\)/);
  assert.match(sql, /\(video_provider is null and video_ref is null\)/);
  assert.match(sql, /grant select \(summary, video_provider, video_ref\) on public\.weird_picks to anon;/);
  assert.match(sql, /where video_id is not null and video_provider is null and video_ref is null;/, 'the backfill only fills empty rows');
  assert.match(sql, /disable trigger weird_picks_guard;[\s\S]*enable trigger weird_picks_guard;/);
  assert.match(sql, /new\.summary, new\.video_provider, new\.video_ref\)\s*is distinct from \(old\.url,[^)]*old\.summary, old\.video_provider, old\.video_ref\)/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function private\.weird_picks_guard\(\) from public, anon, authenticated, service_role;/);
  // The guard is the pick-media one with only the comparison widened.
  const prev = read('supabase/migrations/20261117150000_pick_media.sql');
  const body = (s) => s.slice(s.indexOf('create or replace function private.weird_picks_guard()'), s.indexOf('$$;')).replace(/,\s*new\.summary, new\.video_provider, new\.video_ref|,\s*old\.summary, old\.video_provider, old\.video_ref/g, '');
  assert.equal(body(sql), body(prev));
  // The database's reference shapes accept what js/mediaproviders.js writes.
  assert.match(sql, /video_provider = 'tiktok'\s+and video_ref ~ '\^\[A-Za-z0-9\._\]\{1,24\}\/\[0-9\]\{15,22\}\$'/);
});
