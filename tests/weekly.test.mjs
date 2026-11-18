// The weekly archive, the RSS feed, the newsletter signup and the visit counter's DNT/GPC gate (lib/weekly.js,
// js/newsletter.js, js/analytics.js), and how they are wired: the /api/weird function, server.js, vercel.json, the
// sitemap and the public pages. No network: the database is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { signupHTML, buttondownUser, signupAction, mountNewsletter, BUTTONDOWN_EMBED } from '../js/newsletter.js';
import { analyticsAllowed, loadAnalytics, SCRIPT_SRC } from '../js/analytics.js';

const require = createRequire(import.meta.url);
const W = require('../lib/weekly.js');
const weird = require('../lib/weird.js');
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const NOW = Date.parse('2026-11-18T15:00:00Z'); // a Wednesday in ISO week 2026-W47
const pick = (n, over = {}) => ({
  url: `https://www.upi.com/Odd_News/2026/11/1${n % 10}/story-${n}/${1000 + n}/`, title: `Goat number ${n} rides the bus`, outlet: 'UPI',
  published: '2026-11-15', category: 'animals', rating: null, note: null, summary: null, pickedAt: '2026-11-17T12:00:00Z', ...over,
});

/* ---------- ISO weeks ---------- */

test('ISO weeks: Monday to Sunday, week 1 holds the first Thursday, 52 or 53 weeks a year', () => {
  const k = (d) => W.weekKey(W.isoWeek(d));
  assert.equal(k('2026-11-16'), '2026-W47', 'a Monday');
  assert.equal(k('2026-11-22'), '2026-W47', 'the Sunday after it');
  assert.equal(k('2026-11-23'), '2026-W48');
  assert.equal(k('2026-01-01'), '2026-W01', '1 Jan 2026 is a Thursday');
  assert.equal(k('2025-12-29'), '2026-W01', 'a December Monday can open next year\'s week 1');
  assert.equal(k('2027-01-01'), '2026-W53', 'a January Friday can close last year');
  assert.equal(k('2021-01-03'), '2020-W53');
  assert.equal(k('2024-12-30'), '2025-W01');
  assert.equal(W.weeksInYear(2026), 53);
  assert.equal(W.weeksInYear(2025), 52);
  assert.deepEqual(W.weekRange({ year: 2026, week: 47 }), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(W.weekRange({ year: 2026, week: 1 }), { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(W.parseWeek('2026-W53'), { year: 2026, week: 53 });
  for (const bad of ['2025-W53', '2026-W00', '2026-W54', '2026-W7', '2026W47', '1999-W10', '', null, '2026-W47/']) assert.equal(W.parseWeek(bad), null, String(bad));
  assert.equal(W.rangeLabel(W.weekRange({ year: 2026, week: 47 })), '16 to 22 November 2026');
  assert.equal(W.rangeLabel(W.weekRange({ year: 2026, week: 49 })), '30 November to 6 December 2026');
  assert.equal(W.rangeLabel(W.weekRange({ year: 2026, week: 1 })), '29 December 2025 to 4 January 2026');
});

test('grouping: by the week the editor published the pick (US Eastern days), newest week and pick first, each story once', () => {
  const picks = [
    pick(1, { pickedAt: '2026-11-16T14:00:00Z' }),
    pick(2, { pickedAt: '2026-11-23T03:30:00Z' }), // 22:30 on Sunday 22 Nov in New York: still week 47
    pick(3, { pickedAt: '2026-11-23T15:00:00Z' }), // Monday: week 48
    pick(4, { pickedAt: null, published: '2026-11-04' }), // no publish time (the JSON file): the outlet's date
    pick(5, { pickedAt: '2026-11-18T09:00:00Z' }),
    pick(1, { pickedAt: '2026-11-16T14:00:00Z' }), // the same story again
  ].map((p) => W.cleanPick({ ...p, seeded: false }));
  const weeks = W.groupWeeks(picks);
  assert.deepEqual(weeks.map((w) => w.key), ['2026-W48', '2026-W47', '2026-W45']);
  assert.deepEqual(weeks[1].picks.map((p) => p.title), ['Goat number 2 rides the bus', 'Goat number 5 rides the bus', 'Goat number 1 rides the bus']);
  assert.equal(weeks[1].start, '2026-11-16');
  assert.equal(weeks[1].end, '2026-11-22');
  assert.equal(weeks[2].picks[0].day, '2026-11-04');
});

test('a pick: the same story id as /api/weird, the outlet headline, only the editor\'s words, moderated like the front page', async () => {
  const raw = pick(7, { title: 'Watch: Goat rides the bus & "waves"', url: 'https://www.upi.com/Odd_News/2026/11/17/goat/1007/?utm_source=x', note: '  A hook\nline. ', summary: 'S'.repeat(900) });
  const p = W.cleanPick({ ...raw, seeded: false });
  assert.equal(p.title, 'Goat rides the bus & "waves"', 'the outlet\'s label is removed, as on the front page');
  assert.equal(p.url, 'https://www.upi.com/Odd_News/2026/11/17/goat/1007/');
  assert.equal(p.note, 'A hook line.');
  assert.equal(p.summary.length, 700);
  const api = await weird.weirdFor(new URLSearchParams({ limit: '60' }), {
    fetchImpl: async () => { throw new Error('offline'); }, now: Date.parse('2026-11-18T12:00:00Z'), sources: [], picks: [], dbPicks: [{ ...raw, pickedAt: undefined }], pageCache: false,
  });
  assert.equal(api.items.length, 1);
  assert.equal(p.id, api.items[0].id, 'story mode finds it by the same id');
  // Invalid rows are dropped; an unreviewed file pick gets every moderation rule, a published one only the drop rules.
  for (const bad of [{ url: 'http://x.com/a' }, { title: ' ' }, { outlet: '' }, { pickedAt: null, published: 'soon' }]) assert.equal(W.cleanPick({ ...pick(8), ...bad }), null, JSON.stringify(bad));
  const sad = { ...pick(9), title: 'Man killed by falling cheese wheel' };
  assert.equal(W.cleanPick({ ...sad, seeded: true }), null);
  assert.ok(W.cleanPick({ ...sad, seeded: false }));
});

test('reading the picks: publishable key, published only, with the publish time; summary falls away before its migration; { ok: false } on failure', async () => {
  const row = { url: 'https://www.upi.com/Odd_News/a/1/', title: 'Moose on the bus', outlet: 'UPI', published: '2026-11-15', category: 'animals', rating: 3, note: 'Hook.', summary: 'Ours.', published_at: '2026-11-16T19:56:14.86624+00:00' };
  const asked = [];
  let r = await W.loadPicks({ url: 'https://p.supabase.co', key: 'sb_publishable_x', fetchImpl: async (u, init) => { asked.push([u, init.headers]); return new Response(JSON.stringify([row, { url: 'javascript:x' }]), { status: 200 }); } });
  assert.equal(r.ok, true);
  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0].pickedAt, row.published_at);
  assert.equal(r.picks[0].summary, 'Ours.');
  assert.match(asked[0][0], /^https:\/\/p\.supabase\.co\/rest\/v1\/weird_picks\?select=url,title,outlet,published,category,rating,note,published_at,summary&status=eq\.published&/);
  assert.equal(asked[0][1].apikey, 'sb_publishable_x');
  assert.equal(asked[0][1].Authorization, undefined);
  asked.length = 0;
  r = await W.loadPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async (u) => {
    asked.push(u);
    return u.includes('summary') ? new Response(JSON.stringify({ code: '42703' }), { status: 400 }) : new Response(JSON.stringify([{ ...row, summary: undefined }]), { status: 200 });
  } });
  assert.equal(asked.length, 2);
  assert.equal(r.ok, true);
  assert.equal(r.picks[0].summary, null);
  for (const fetchImpl of [async () => new Response('x', { status: 500 }), async () => new Response('{"a":1}', { status: 200 }), async () => { throw new Error('down'); }, () => new Promise(() => {})]) {
    assert.deepEqual(await W.loadPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl, timeoutMs: 50 }), { ok: false, picks: [] });
  }
  assert.deepEqual(await W.loadPicks({ url: 'https://p.supabase.co', key: '' }), { ok: false, picks: [] });
});

/* ---------- RSS ---------- */

// A strict enough XML 1.0 well-formedness check for the feed: one root, every tag closed in order, attributes quoted,
// only the five predefined entities or numeric references, no raw "<" or "&" in text, no forbidden characters.
function wellFormed(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'XML declaration');
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), 'no control characters');
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack = [];
  let roots = 0;
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*(?:&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);[^"<&]*)*")*)\s*(\/?)>|([^<]+)/giy;
  let m, end = 0;
  while ((m = re.exec(body))) {
    end = re.lastIndex;
    if (m[5] !== undefined) {
      assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[5]), `bad entity in ${m[5].slice(0, 60)}`);
      assert.ok(stack.length || !m[5].trim(), 'no text outside the root');
      continue;
    }
    const [, close, name, , self] = m;
    if (close) assert.equal(stack.pop(), name, `</${name}> closes the open element`);
    else if (!self) { if (!stack.length) roots++; stack.push(name); } else if (!stack.length) roots++;
  }
  assert.equal(end, body.length, `parsed to the end (stopped at ${body.slice(end, end + 40)})`);
  assert.deepEqual(stack, [], 'every element closed');
  assert.equal(roots, 1, 'one root element');
}

test('RSS: valid RSS 2.0, newest first, at most 30 picks, story-mode links, stable guids, the editor\'s words only, all escaped', async () => {
  const picks = [
    W.cleanPick({ ...pick(1, { title: 'Cats & dogs < cats > "quoted" \u0007bell <i>tags go</i>', note: 'Our hook: <b>bold</b> & odd', summary: 'Two sentences, ours. Really ours.', url: 'https://www.upi.com/Odd_News/a?x=1&y=2', pickedAt: '2026-11-18T10:00:00Z' }), seeded: false }),
    ...Array.from({ length: 40 }, (_, i) => W.cleanPick({ ...pick(100 + i, { pickedAt: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 3600e3).toISOString() }), seeded: false })),
  ].sort((a, b) => b.time - a.time);
  const out = await W.render(new URLSearchParams({ view: 'feed' }), { dbPicks: [], filePicks: [], now: NOW });
  assert.equal(out.status, 200);
  assert.equal(out.type, 'application/rss+xml; charset=utf-8');
  assert.equal(out.cacheControl, W.CACHE_CONTROL);
  wellFormed(out.body);
  assert.equal((out.body.match(/<item>/g) || []).length, 0, 'no picks: an empty but valid channel');

  const fm = await import('../js/frontmodel.js');
  const xml = W.feedXml(picks, { catLabel: fm.catLabel, now: NOW });
  wellFormed(xml);
  assert.match(xml, /^<\?xml[^>]*>\n<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">\n  <channel>\n    <title>[^<]+<\/title>\n    <link>https:\/\/www\.thegatecast\.com\/weekly\/<\/link>\n    <atom:link href="https:\/\/www\.thegatecast\.com\/feed\.xml" rel="self" type="application\/rss\+xml"\/>\n    <description>/);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.equal(items.length, W.FEED_SIZE);
  const first = items[0];
  assert.match(first, /<title>Cats &amp; dogs &lt; cats &gt; &quot;quoted&quot; bell tags go<\/title>/, 'escaped; markup and control characters removed');
  assert.equal(W.xmlText('a\u0007b\uFFFEc<&>\'"'), 'abc&lt;&amp;&gt;&#39;&quot;', 'characters XML forbids are dropped');
  assert.match(first, new RegExp(`<link>https://www\\.thegatecast\\.com/\\?story=${picks[0].id}</link>`));
  assert.match(first, new RegExp(`<guid isPermaLink="false">gatecast-pick-${picks[0].id}</guid>`));
  assert.match(first, /<pubDate>Wed, 18 Nov 2026 10:00:00 \+0000<\/pubDate>/);
  assert.match(first, /<category>Strange animals<\/category>/);
  // The description is HTML, escaped once more for XML: the editor's hook and summary, then the original's link.
  const desc = first.match(/<description>([\s\S]*?)<\/description>/)[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal(desc, '<p>Our hook: bold &amp; odd</p><p><strong>In our words:</strong> Two sentences, ours. Really ours.</p><p>From UPI, 15 November 2026. <a href="https://www.upi.com/Odd_News/a?x=1&amp;y=2">Read the original at UPI</a>.</p>');
  // A pick with no words of the editor's: only where it is from and the link.
  assert.match(items[1], /<description>&lt;p&gt;From UPI, 15 November 2026\. &lt;a href=&quot;https:\/\/www\.upi\.com\/Odd_News\/[^&]+&quot;&gt;Read the original at UPI&lt;\/a&gt;\.&lt;\/p&gt;<\/description>/);
  // Newest first, and the same story always has the same guid.
  const dates = items.map((i) => Date.parse(i.match(/<pubDate>([^<]+)</)[1]));
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  assert.equal(W.feedXml(picks.slice(1), { catLabel: fm.catLabel }).includes(`gatecast-pick-${picks[1].id}`), true);
  assert.match(xml, /<lastBuildDate>Wed, 18 Nov 2026 10:00:00 \+0000<\/lastBuildDate>/, 'dated by the newest pick, so the body only changes with the picks');
});

/* ---------- Pages ---------- */

const DB = [
  pick(1, { pickedAt: '2026-11-17T12:00:00Z', note: 'A hook of ours.', summary: 'A summary of ours. Two sentences.', rating: 4 }),
  pick(2, { pickedAt: '2026-11-16T12:00:00Z', published: '2026-10-01' }), // the outlet's story is weeks old: off the front page
  pick(3, { pickedAt: '2026-11-10T12:00:00Z' }),
  pick(4, { pickedAt: '2026-10-20T12:00:00Z', title: 'Tiny horse & "cart" < 3 > 2' }),
];
const page = (q, over = {}) => W.render(new URLSearchParams(q), { dbPicks: DB, filePicks: [], now: NOW, config: { buttondown: null }, ...over });

test('/weekly/: every week with picks, newest first, plain HTML styled like the site, no outlet pictures', async () => {
  const out = await page({ view: 'weekly' });
  assert.equal(out.status, 200);
  assert.equal(out.type, 'text/html; charset=utf-8');
  assert.equal(out.cacheControl, 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  const h = out.body;
  assert.deepEqual([...h.matchAll(/href="\/weekly\/(\d{4}-W\d{2})\/"/g)].map((m) => m[1]), ['2026-W47', '2026-W46', '2026-W43']);
  assert.match(h, /<link rel="canonical" href="https:\/\/www\.thegatecast\.com\/weekly\/">/);
  assert.match(h, /<link rel="stylesheet" href="\/styles\/site\.css">/);
  assert.match(h, /class="site-header"/);
  assert.match(h, /this week so far/);
  assert.match(h, /Tiny horse &amp; &quot;cart&quot; &lt; 3 &gt; 2/);
  assert.ok(!/<img\b/.test(h), 'no pictures');
  assert.ok(!/noindex/.test(h), 'the index is indexed');
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
  assert.equal((h.match(/<link rel="alternate" type="application\/rss\+xml"/g) || []).length, 1);
  assert.match(h, /<script type="module" src="\/js\/analytics\.js"><\/script>\n<\/body>/);
  assert.ok(!/buttondown/i.test(h), 'no signup while the username is null');
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(ld['@type'], 'CollectionPage');
  assert.equal(ld.mainEntity.itemListElement.length, 3);
});

test('a week page: its picks with outlet, date, the editor\'s words, the original and story mode, and the weeks either side', async () => {
  const out = await page({ view: 'weekly', week: '2026-W47' });
  assert.equal(out.status, 200);
  const h = out.body;
  assert.match(h, /<title>Weird news of the week, 16 to 22 November 2026 — Gatecast<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/www\.thegatecast\.com\/weekly\/2026-W47\/">/);
  const items = [...h.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0]);
  assert.equal(items.length, 2);
  const [a, b] = items;
  const id1 = W.storyId(DB[0].url);
  assert.match(a, /Goat number 1 rides the bus/);
  assert.match(a, /UPI, 15 November 2026/);
  assert.match(a, /A hook of ours\./);
  assert.match(a, /In our words<\/p>\s*<p>A summary of ours\. Two sentences\.<\/p>/);
  assert.match(a, /Editor’s weird rating: 4 of 5/);
  assert.ok(a.includes(`href="${DB[0].url}" rel="noopener">Read it at UPI</a>`));
  assert.ok(a.includes(`href="/?story=${id1}">Open it on Gatecast</a>`), 'story mode, with the front page\'s id');
  assert.ok(!b.includes('?story='), 'a story that has left the front page links only to the original');
  assert.ok(!/In our words|weird rating/.test(b), 'nothing shown that the editor did not write');
  assert.match(h, /<a class="btn" rel="prev" href="\/weekly\/2026-W46\/">← 9 to 15 November 2026<\/a>/);
  assert.ok(!/rel="next"/.test(h), 'the newest week has no next');
  assert.match(h, /<meta name="robots" content="noindex, follow">/, `fewer than ${W.INDEX_MIN} picks with the editor's words: not indexed yet`);
  const mid = (await page({ view: 'weekly', week: '2026-W46' })).body;
  assert.match(mid, /rel="prev" href="\/weekly\/2026-W43\/"/, 'previous: the next older week with picks, skipping empty weeks');
  assert.match(mid, /rel="next" href="\/weekly\/2026-W47\/"/);
  // Enough picks with the editor's own words: indexed.
  const many = Array.from({ length: W.INDEX_MIN }, (_, i) => pick(20 + i, { note: `Hook ${i}.` }));
  assert.ok(!/noindex/.test((await page({ view: 'weekly', week: '2026-W47' }, { dbPicks: many })).body));
});

test('weeks without picks, bad addresses and a database failure', async () => {
  let out = await page({ view: 'weekly', week: '2026-W45' });
  assert.equal(out.status, 404);
  assert.match(out.body, /No picks that week/);
  assert.match(out.body, /noindex, follow/);
  assert.equal((await page({ view: 'weekly', week: '2026-W99' })).status, 404);
  const down = { dbPicks: undefined, fetchImpl: async () => new Response('x', { status: 500 }) };
  out = await page({ view: 'weekly' }, down);
  assert.equal(out.status, 503);
  assert.equal(out.cacheControl, 'no-store');
  assert.match(out.body, /could not be loaded/);
  assert.equal((await page({ view: 'weekly', week: '2026-W47' }, down)).status, 503);
  assert.equal((await page({ view: 'feed' }, down)).status, 503);
  out = await page({ view: 'weekly' }, { dbPicks: [] });
  assert.equal(out.status, 200);
  assert.match(out.body, /No picks yet/);
  assert.equal(await W.render(new URLSearchParams({ limit: '5' })), null, 'not one of these views: /api/weird answers as before');
  assert.equal(await W.render(new URLSearchParams({ view: 'other' })), null);
});

/* ---------- Newsletter ---------- */

test('newsletter: no form at all while the Buttondown username is null; otherwise a plain POST to its embed endpoint', async () => {
  for (const config of [null, {}, { buttondown: null }, { buttondown: '' }, { buttondown: 'has space' }, { buttondown: '"><script>' }, { buttondown: 42 }]) {
    assert.equal(buttondownUser(config), null, JSON.stringify(config));
    assert.equal(signupHTML(config), '', JSON.stringify(config));
  }
  assert.deepEqual(JSON.parse(read('data/site.json')).buttondown, null, 'off until the owner sets it');
  const html = signupHTML({ buttondown: ' gatecast-weird ' }, { id: 'nl' });
  assert.equal(buttondownUser({ buttondown: 'gatecast-weird' }), 'gatecast-weird');
  assert.equal(signupAction('gatecast-weird'), 'https://buttondown.com/api/emails/embed-subscribe/gatecast-weird');
  assert.ok(html.includes(`action="${BUTTONDOWN_EMBED}gatecast-weird" method="post"`));
  assert.match(html, /<label for="nl-email">Email address<\/label><input id="nl-email" name="email" type="email" autocomplete="email" required/);
  assert.match(html, /<input type="hidden" name="embed" value="1">/);
  assert.ok(!/<script|<img|<iframe|onsubmit|target=/.test(html), 'no script, pixel or pop-up');

  // The weekly pages: rendered with the form when the username is set, without it when not.
  assert.ok(!/<form/.test((await page({ view: 'weekly', week: '2026-W47' })).body));
  const on = (await page({ view: 'weekly', week: '2026-W47' }, { config: { buttondown: 'gatecast-weird' } })).body;
  assert.equal((on.match(/embed-subscribe\/gatecast-weird/g) || []).length, 1);
  assert.match((await page({ view: 'weekly' }, { config: { buttondown: 'gatecast-weird' } })).body, /id="newsletter-weekly-email"/);

  // The front page: filled from /data/site.json only when it names a username; otherwise left hidden and empty.
  const root = (id) => ({ id, hidden: true, innerHTML: '' });
  const serve = (body, status = 200) => async (url) => { assert.equal(url, '/data/site.json'); return new Response(JSON.stringify(body), { status }); };
  let el = root('newsletter');
  assert.equal(await mountNewsletter(el, { fetchImpl: serve({ buttondown: null }) }), false);
  assert.deepEqual(el, root('newsletter'));
  assert.equal(await mountNewsletter(el, { fetchImpl: serve({}, 404) }), false);
  assert.equal(await mountNewsletter(el, { fetchImpl: async () => { throw new Error('offline'); } }), false);
  assert.deepEqual(el, root('newsletter'));
  assert.equal(await mountNewsletter(el, { fetchImpl: serve({ buttondown: 'gatecast-weird' }) }), true);
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /id="newsletter-email"/);
  assert.match(read('index.html'), /<div id="newsletter" class="mb-6" hidden><\/div>/);
});

/* ---------- Analytics ---------- */

function fakeDoc() {
  const added = [];
  return {
    added, scripts: [],
    createElement: () => ({ getAttribute(k) { return this[k]; }, remove() {} }),
    head: { appendChild(s) { added.push(s); } },
  };
}

test('analytics: loaded only without Do Not Track and Global Privacy Control, once, from Gatecast\'s own address', () => {
  const ok = (nav, win = {}) => analyticsAllowed(nav, win);
  assert.equal(ok({}), true);
  assert.equal(ok({ doNotTrack: '0' }), true);
  assert.equal(ok({ doNotTrack: 'unspecified', globalPrivacyControl: false }), true);
  assert.equal(ok({ doNotTrack: '1' }), false, 'navigator.doNotTrack');
  assert.equal(ok({}, { doNotTrack: '1' }), false, 'window.doNotTrack');
  assert.equal(ok({ msDoNotTrack: '1' }), false);
  assert.equal(ok({ globalPrivacyControl: true }), false, 'Global Privacy Control');
  assert.equal(ok({ get globalPrivacyControl() { throw new Error('no'); } }), false, 'unreadable: not counted');

  for (const [nav, win] of [[{ doNotTrack: '1' }, {}], [{}, { doNotTrack: '1' }], [{ globalPrivacyControl: true }, {}]]) {
    const doc = fakeDoc();
    assert.equal(loadAnalytics({ doc, nav, win }), false);
    assert.equal(doc.added.length, 0);
    assert.equal(win.va, undefined, 'not even the queue');
  }
  const doc = fakeDoc(), win = {};
  assert.equal(loadAnalytics({ doc, nav: {}, win }), true);
  assert.equal(doc.added.length, 1);
  assert.equal(doc.added[0].src, '/_vercel/insights/script.js');
  assert.equal(SCRIPT_SRC, '/_vercel/insights/script.js');
  assert.equal(doc.added[0].defer, true);
  assert.equal(typeof win.va, 'function');
  win.va('event', { name: 'x' });
  assert.deepEqual(win.vaq, [['event', { name: 'x' }]]);
  doc.scripts = doc.added;
  assert.equal(loadAnalytics({ doc, nav: {}, win }), false, 'never twice');
  assert.equal(loadAnalytics({ doc: undefined, nav: {}, win: {} }), false, 'no document (Node): nothing');
});

test('the public pages: one RSS link before </head>, the counter at the end of the body; review.html has neither', () => {
  for (const f of ['index.html', 'how.html', 'trip.html', 'flights.html']) {
    const h = read(f);
    assert.match(h, /  <link rel="alternate" type="application\/rss\+xml" title="Gatecast: the editor’s weird-news picks" href="\/feed\.xml">\n<\/head>/, f);
    assert.match(h, /<script type="module" src="js\/analytics\.js"><\/script>\n(?:  <script[^\n]*\n)*<\/body>/, f);
    assert.ok(h.includes('<a href="/weekly/">Weird news, week by week</a>'), `${f} links the weekly archive`);
  }
  const review = read('review.html');
  assert.ok(!review.includes('analytics.js') && !review.includes('_vercel/insights'), 'the reviewer console is never counted');
  const how = read('how.html');
  assert.match(how, /<section class="doc-section" id="counting" aria-labelledby="counting-title">/);
  assert.match(how, /Do Not Track or Global Privacy Control, the counter doesn’t load/);
  assert.match(how, /https:\/\/vercel\.com\/docs\/analytics\/privacy-policy/);
});

/* ---------- Wiring ---------- */

test('routes: vercel.json sends /weekly/ and /feed.xml to the existing /api/weird function (no new function), cached at the edge', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(fs.readdirSync(new URL('../api/', import.meta.url)).filter((f) => f.endsWith('.js')).length, 12, 'still 12 functions (the Hobby limit)');
  const toRe = (src) => new RegExp(`^${src.replace(/:(\w+)\(([^)]+)\)/g, '($2)')}$`);
  for (const r of v.rewrites) {
    const sample = r.source.replace(/:week\([^)]+\)/, '2026-W47');
    assert.ok(toRe(r.source).test(sample), r.source);
    const q = W.routeQuery(sample);
    assert.ok(q, `${sample} is served locally too`);
    const dest = new URL(r.destination.replace(':week', '2026-W47'), 'https://x');
    assert.equal(dest.pathname, '/api/weird');
    assert.deepEqual(Object.fromEntries(dest.searchParams), Object.fromEntries(q), sample);
  }
  for (const p of ['/weekly/', '/weekly/2026-W47/', '/feed.xml', '/weekly/feed.xml']) assert.ok(v.rewrites.some((r) => toRe(r.source).test(p)), p);
  assert.ok(!v.rewrites.some((r) => toRe(r.source).test('/weekly/2026-W47')), 'without the slash: redirected first');
  const redirects = v.redirects.filter((r) => r.source.startsWith('/weekly')).map((r) => [r.source, r.destination, r.permanent]);
  assert.deepEqual(redirects, [['/weekly', '/weekly/', true], ['/weekly/:week(\\d{4}-W\\d{2})', '/weekly/:week/', true]]);
  for (const p of ['/weekly', '/weekly/2026-W47']) assert.equal(W.needsSlash(p), true, p);
  for (const p of ['/weekly/', '/weekly/2026-W47/', '/weekly/x']) assert.equal(W.needsSlash(p), false, p);
  for (const src of ['/weekly/(.*)', '/feed.xml']) {
    assert.equal(v.headers.find((h) => h.source === src)?.headers.find((x) => x.key === 'Cache-Control')?.value, W.CACHE_CONTROL, src);
  }
  assert.match(W.CACHE_CONTROL, /s-maxage=\d+/);
  assert.match(W.CACHE_CONTROL, /stale-while-revalidate=\d+/);
});

test('sitemap: /weekly/ is listed; the site origin is the same everywhere', async () => {
  const B = require('../scripts/build-data.cjs');
  const S = require('../scripts/build-stacks-pages.cjs');
  assert.equal(W.SITE, S.SITE_ORIGIN);
  assert.ok(B.SITEMAP_PAGES.includes('weekly/'));
  const xml = B.sitemapXml({ day: '2099-01-01', dateOf: (f) => (f === 'lib/weekly.js' ? '2026-11-18' : null) });
  assert.match(xml, /<url><loc>https:\/\/www\.thegatecast\.com\/weekly\/<\/loc><lastmod>2026-11-18<\/lastmod><\/url>/);
  assert.ok(!/\/weekly\/\d{4}-W/.test(xml), 'week pages are linked from the index, not listed');
});

test('the function and the local server serve the same pages; /api/weird JSON is untouched without ?view', async () => {
  const realFetch = globalThis.fetch;
  const rows = DB.map((p) => ({ ...p, published_at: p.pickedAt, pickedAt: undefined }));
  globalThis.fetch = async (u) => (String(u).includes('/rest/v1/weird_picks') ? new Response(JSON.stringify(rows), { status: 200 }) : realFetch(u));
  try {
    // The Vercel function, with a request and response like Vercel's.
    const handler = require('../api/weird.js');
    const res = { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
    await handler({ url: '/api/weird?view=feed', method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/rss+xml; charset=utf-8');
    assert.equal(res.headers['cache-control'], W.CACHE_CONTROL);
    wellFormed(res.body);
    assert.equal((res.body.match(/<item>/g) || []).length, DB.length);

    const { server } = require('../server.js');
    await new Promise((ok) => server.listen(0, ok));
    const base = `http://localhost:${server.address().port}`;
    try {
      let r = await realFetch(base + '/weekly', { redirect: 'manual' });
      assert.equal(r.status, 308);
      assert.equal(r.headers.get('location'), '/weekly/');
      r = await realFetch(base + '/weekly/2026-W47', { redirect: 'manual' });
      assert.equal(r.headers.get('location'), '/weekly/2026-W47/');
      r = await realFetch(base + '/weekly/');
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), W.CACHE_CONTROL);
      assert.match(await r.text(), /Weird news, week by week/);
      r = await realFetch(base + '/feed.xml');
      assert.equal(r.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
      assert.equal(await r.text(), res.body, 'the same feed as the function');
      r = await realFetch(base + '/api/weird?view=weekly&week=1999-W01');
      assert.equal(r.status, 404);
      r = await realFetch(base + '/weekly/nonsense/');
      assert.equal(r.status, 404);
      r = await realFetch(base + '/_vercel/insights/script.js');
      assert.equal(r.status, 200, 'the analytics script stands in locally, so nothing 404s');
      assert.match(r.headers.get('content-type'), /javascript/);
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  // Without view the function still answers with lib/weird.js, exactly as before.
  const src = read('api/weird.js');
  assert.match(src, /if \(weekly\.isView\(q\.get\('view'\)\)\) \{/);
  assert.match(src, /const body = await weird\.weirdFor\(q\);\n    res\.setHeader\('Cache-Control', q\.get\('debug'\) \? weird\.DEBUG_CACHE_CONTROL : weird\.CACHE_CONTROL\);\n    res\.status\(200\)\.json\(body\);/);
});
