// The community function's pure logic (supabase/functions/community/logic.mjs), the browser module's copy of the
// story-id code (js/community.js), and lib/picks-db.js. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  normaliseStoryUrl, storyId, sha256Hex, isStoryId, parseIPv6, clientAddress, clientKey, dayBucket, voterHash, tipHash, clickHash, saltReady,
  publicHost, checkTipUrl, validateVote, validateClick, parseIds, validateTip, publicRating, shapeRatings, shapeFavourites, route, ROUTE_METHOD,
  limitReply, originAllowed, corsHeaders, writeAllowed, VOTE_THRESHOLD, MAX_IDS, NOTE_MAX,
} from '../supabase/functions/community/logic.mjs';
import * as browser from '../js/community.js';

// Deno and browsers have Web Crypto on globalThis; Node 18 (still in the CI matrix) does not.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
import picksDb from '../lib/picks-db.js';

const { loadDbPicks, toPick, picksEndpoint } = picksDb;

/* ---------- story ids ---------- */

test('the normaliser folds case, scheme, fragments, tracking and trailing slashes', () => {
  const want = 'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131';
  for (const u of [
    'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131/',
    'https://WWW.UPI.com/Odd_News/2026/11/13/sheep/6691794592131',
    'http://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131',
    'https://www.upi.com:443/Odd_News/2026/11/13/sheep/6691794592131#comments',
    'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131?utm_source=x&utm_medium=social&UTM_Campaign=y',
    '  https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131?fbclid=abc  ',
  ]) assert.equal(normaliseStoryUrl(u), want, u);
  // Paths keep their case; other query parameters stay, in order.
  assert.equal(normaliseStoryUrl('https://a.com/Story?id=7&utm_source=x&page=2'), 'https://a.com/Story?id=7&page=2');
  assert.notEqual(normaliseStoryUrl('https://a.com/story'), normaliseStoryUrl('https://a.com/Story'));
  assert.equal(normaliseStoryUrl('https://a.com/'), 'https://a.com');
  assert.equal(normaliseStoryUrl('https://a.com:8443/x'), 'https://a.com:8443/x');
  for (const bad of ['', '   ', 'not a url', 'ftp://a.com/x', 'javascript:alert(1)', 'https://user:pw@a.com/x', null, 42, `https://a.com/${'x'.repeat(2048)}`]) {
    assert.equal(normaliseStoryUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('a story id is the first 16 hex characters of SHA-256 of the normalised URL', async () => {
  const n = 'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131';
  const expected = createHash('sha256').update(n).digest('hex').slice(0, 16);
  assert.equal(await storyId(`${n}/?utm_source=feed`), expected);
  assert.equal(await sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'));
  assert.equal(isStoryId(expected), true);
  assert.equal(isStoryId('ABCDEF0123456789'), false);
  assert.equal(await storyId('nope'), null);
});

test('the browser module and the function agree on normalising and hashing', async () => {
  const urls = [
    'https://www.upi.com/Odd_News/2026/11/13/sheep/6691794592131/',
    'http://Example.org/a/b/?utm_source=x&q=1#frag',
    'https://news.sky.com/story/odd-thing-13245678?ref=home&utm_campaign=z',
    'https://a.com/path%20with%20space/?b=2&a=1',
    'https://xn--bcher-kva.example/ü?x=ü',
    'https://bücher.de/über',
    'not a url',
    'https://a.com:443/',
  ];
  for (const u of urls) {
    assert.equal(browser.normaliseStoryUrl(u), normaliseStoryUrl(u), u);
    assert.equal(await browser.storyId(u), await storyId(u), u);
  }
  assert.equal(browser.VOTE_THRESHOLD, VOTE_THRESHOLD);
  assert.equal(browser.NOTE_MAX, NOTE_MAX);
});

/* ---------- visitors ---------- */

test('the visitor key comes from the first x-forwarded-for hop; IPv6 is cut to its /64', () => {
  assert.equal(clientKey('203.0.113.7, 10.0.0.1, 172.16.0.5'), '203.0.113.7');
  assert.equal(clientKey(' 198.51.100.20:5555 '), '198.51.100.20');
  assert.equal(clientKey('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64');
  assert.equal(clientKey('2001:DB8:ABCD:0012:ffff::1'), '2001:db8:abcd:12::/64', 'same /64, same key');
  assert.equal(clientKey('[2001:db8::1]:443'), '2001:db8:0:0::/64');
  assert.equal(clientKey('::ffff:203.0.113.9'), '203.0.113.9');
  for (const bad of [null, '', 'unknown', '999.1.1.1', 'a.b.c.d', 'x'.repeat(100), '1.2.3']) assert.equal(clientKey(bad), null, String(bad));
  // Which header the address is read from: the one the platform sets and a visitor cannot (cf-connecting-ip). A
  // forged x-forwarded-for changes nothing while it is there; without it (a local run) the first hop is used.
  const from = (h) => clientKey(clientAddress((name) => h[name] ?? null));
  assert.equal(from({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.7, 198.51.100.20, 10.0.0.1' }), '198.51.100.20', 'a forged first hop is ignored');
  assert.equal(from({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': 'not-an-address' }), '198.51.100.20');
  assert.equal(from({ 'cf-connecting-ip': '2001:db8:abcd:12:1:2:3:4' }), '2001:db8:abcd:12::/64');
  assert.equal(from({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), '203.0.113.7', 'local run: no platform header');
  assert.equal(from({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7');
  assert.equal(from({}), null);
  const index = readFileSync(new URL('../supabase/functions/community/index.ts', import.meta.url), 'utf8');
  assert.match(index, /clientKey\(clientAddress\(\(name: string\) => req\.headers\.get\(name\)\)\)/);
  assert.doesNotMatch(index, /clientKey\(req\.headers\.get\('x-forwarded-for'\)\)/);
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(parseIPv6('1::2::3'), null);
});

test('hashes are salted, purpose-bound, and tips change every UTC day', async () => {
  const salt = 's'.repeat(32);
  const v = await voterHash(salt, '203.0.113.7');
  assert.match(v, /^[0-9a-f]{64}$/);
  assert.notEqual(v, await voterHash('t'.repeat(32), '203.0.113.7'));
  assert.notEqual(v, await voterHash(salt, '203.0.113.8'));
  assert.ok(!v.includes('203'), 'the address does not appear in the hash');
  const d1 = await tipHash(salt, '203.0.113.7', '2026-11-16');
  assert.notEqual(d1, await tipHash(salt, '203.0.113.7', '2026-11-17'));
  assert.notEqual(d1, v);
  assert.equal(dayBucket(new Date('2026-11-16T23:59:59-05:00')), '2026-11-17', 'the day is UTC');
  const c1 = await clickHash(salt, '203.0.113.7', '2026-11-16');
  assert.match(c1, /^[0-9a-f]{64}$/);
  assert.notEqual(c1, await clickHash(salt, '203.0.113.7', '2026-11-17'), 'the click hash changes every UTC day');
  assert.notEqual(c1, d1, 'click and tip hashes differ for the same visitor and day');
  assert.notEqual(c1, v);
  assert.equal(saltReady(''), false);
  assert.equal(saltReady('short'), false);
  assert.equal(saltReady('x'.repeat(16)), true);
  assert.equal(saltReady(undefined), false);
});

/* ---------- validation ---------- */

test('public hosts only: no addresses, local names or reserved names', () => {
  for (const ok of ['www.upi.com', 'news.sky.com', 'odditycentral.com', 'xn--bcher-kva.de', 'a.co.uk']) assert.equal(publicHost(ok), true, ok);
  for (const bad of ['localhost', 'printer.local', 'db.internal', 'router.lan', 'x.home.arpa', 'intranet', '127.0.0.1', '10.0.0.1',
    '169.254.169.254', '[::1]', '::1', 'a.test', 'example', 'x.example', 'foo.onion', 'a..com', '-a.com', 'a.123', '', 'host.corp']) {
    assert.equal(publicHost(bad), false, bad);
  }
});

test('tipped links: https to a public host, default port, no credentials, normalised', () => {
  assert.deepEqual(checkTipUrl('https://www.upi.com/Odd_News/x/?utm_source=t#a'), { ok: true, url: 'https://www.upi.com/Odd_News/x' });
  assert.equal(checkTipUrl('http://www.upi.com/x').reason, 'not_https');
  assert.equal(checkTipUrl('https://127.0.0.1/x').reason, 'private_host');
  assert.equal(checkTipUrl('https://0x7f000001/x').reason, 'private_host');
  assert.equal(checkTipUrl('https://[::1]/x').reason, 'private_host');
  assert.equal(checkTipUrl('https://localhost/x').reason, 'private_host');
  assert.equal(checkTipUrl('https://metadata.google.internal/x').reason, 'private_host');
  assert.equal(checkTipUrl('https://a.com:8080/x').reason, 'bad_url');
  assert.equal(checkTipUrl('https://u:p@a.com/x').reason, 'bad_url');
  assert.equal(checkTipUrl('javascript:alert(1)').reason, 'not_https');
  assert.equal(checkTipUrl('').reason, 'missing');
  assert.equal(checkTipUrl(`https://a.com/${'x'.repeat(2100)}`).reason, 'too_long');
});

test('votes: a story URL on a public site and a whole rating from 1 to 5', () => {
  assert.deepEqual(validateVote({ storyUrl: 'https://www.upi.com/x/', rating: 4 }), { ok: true, url: 'https://www.upi.com/x', rating: 4 });
  for (const rating of [0, 6, 2.5, '3', null, undefined, NaN]) assert.equal(validateVote({ storyUrl: 'https://a.com/x', rating }).ok, false, String(rating));
  assert.equal(validateVote({ storyUrl: 'https://localhost/x', rating: 3 }).ok, false);
  assert.equal(validateVote({ storyUrl: 'nope', rating: 3 }).ok, false);
  assert.equal(validateVote(null).ok, false);
  assert.equal(validateVote([1]).ok, false);
});

test('clicks: only the story URL is read, normalised, and it must be on a public site', () => {
  assert.deepEqual(validateClick({ storyUrl: 'https://www.upi.com/Odd_News/x/?utm_source=t#c' }), { ok: true, url: 'https://www.upi.com/Odd_News/x' });
  assert.deepEqual(validateClick({ storyUrl: 'https://a.com/x', name: 'Ann', rating: 5, at: 'now' }), { ok: true, url: 'https://a.com/x' }, 'everything else is ignored');
  for (const bad of [{ storyUrl: 'https://localhost/x' }, { storyUrl: 'https://10.0.0.1/x' }, { storyUrl: 'nope' }, { storyUrl: 42 }, {}, null, [1], 'https://a.com/x']) {
    assert.equal(validateClick(bad).ok, false, JSON.stringify(bad));
  }
});

test('ratings ids: comma-separated story ids, at most 60', () => {
  const id = (n) => n.toString(16).padStart(16, '0');
  assert.deepEqual(parseIds(`${id(1)},${id(2)}, ${id(1)}`), { ok: true, ids: [id(1), id(2)] });
  assert.deepEqual(parseIds(id(255).toUpperCase()), { ok: true, ids: [id(255)] });
  assert.equal(parseIds('').ok, false);
  assert.equal(parseIds(null).ok, false);
  assert.equal(parseIds('xyz').ok, false);
  assert.equal(parseIds(`${id(1)},abc`).ok, false);
  const many = Array.from({ length: MAX_IDS }, (_, i) => id(i + 1));
  assert.equal(parseIds(many.join(',')).ok, true);
  assert.equal(parseIds([...many, id(999)].join(',')).ok, false);
});

test('tips: honeypot, note length and clean-up', () => {
  const ok = validateTip({ url: 'https://www.upi.com/x', note: '  A goat\nran the\tmeeting ', website: '' });
  assert.deepEqual(ok, { ok: true, url: 'https://www.upi.com/x', note: 'A goat ran the meeting', spam: false });
  assert.equal(validateTip({ url: 'https://www.upi.com/x' }).note, null);
  assert.equal(validateTip({ url: 'https://www.upi.com/x', website: 'http://spam' }).spam, true);
  assert.equal(validateTip({ url: 'https://www.upi.com/x', website: 0 }).spam, true);
  assert.equal(validateTip({ url: 'https://www.upi.com/x', note: 'é'.repeat(NOTE_MAX) }).ok, true);
  assert.equal(validateTip({ url: 'https://www.upi.com/x', note: '😀'.repeat(NOTE_MAX) }).ok, true, 'counted in characters, not UTF-16 units');
  assert.equal(validateTip({ url: 'https://www.upi.com/x', note: 'x'.repeat(NOTE_MAX + 1) }).ok, false);
  assert.equal(validateTip({ url: 'https://www.upi.com/x', note: 5 }).ok, false);
  assert.equal(validateTip({ url: 'http://www.upi.com/x' }).message, 'Use the story’s https:// link.');
  assert.equal(validateTip('x').ok, false);
});

/* ---------- the 50-vote rule ---------- */

test('the average shows only from the 50th vote', () => {
  assert.deepEqual(publicRating(0, null), { count: 0, average: null });
  assert.deepEqual(publicRating(49, 4.2), { count: 49, average: null }, 'never leaks below the threshold');
  assert.deepEqual(publicRating(50, 3.46), { count: 50, average: 3.5 });
  assert.deepEqual(publicRating(51, '3.4'), { count: 51, average: 3.4 });
  assert.deepEqual(publicRating(80, null), { count: 80, average: null });
  assert.deepEqual(publicRating(-3, 2), { count: 0, average: null });
  const a = '0123456789abcdef', b = 'fedcba9876543210';
  assert.deepEqual(shapeRatings([{ story_id: a, votes: 60, average: 4.1 }, { story_id: 'other', votes: 9, average: 1 }], [a, b]), {
    [a]: { count: 60, average: 4.1 }, [b]: { count: 0, average: null },
  });
  assert.deepEqual(shapeRatings(null, [a]), { [a]: { count: 0, average: null } });
  // Favourites keep the database's order and the same rule.
  assert.deepEqual(shapeFavourites([{ story_id: a, votes: 64, average: 4.62 }, { story_id: b, votes: 12, average: 4.5 }, { story_id: 'bad', votes: 99, average: 5 }]), [
    { storyId: a, count: 64, average: 4.6 }, { storyId: b, count: 12, average: null },
  ]);
  assert.equal(shapeFavourites(Array.from({ length: 20 }, () => ({ story_id: a, votes: 10, average: 3 }))).length, 12);
  assert.deepEqual(shapeFavourites(null), []);
  // The browser applies the same rule to whatever it is sent.
  assert.deepEqual(browser.shapeRating({ count: 12, average: 4 }), { count: 12, average: null });
  assert.deepEqual(browser.shapeRating({ count: 50, average: 4 }), { count: 50, average: 4 });
  assert.deepEqual(browser.shapeRating(null), { count: 0, average: null });
});

/* ---------- routing, limits, CORS ---------- */

test('routes and limit replies', () => {
  assert.equal(route('/community/vote'), 'vote');
  assert.equal(route('/functions/v1/community/ratings'), 'ratings');
  assert.equal(route('/community/tip/'), 'tip');
  assert.equal(route('/community'), null);
  assert.equal(route('/community/admin'), null);
  assert.equal(route('/community/favourites'), 'favourites');
  assert.equal(route('/community/hasOwnProperty'), null);
  assert.equal(route('/functions/v1/community/click'), 'click');
  assert.deepEqual(ROUTE_METHOD, { vote: 'POST', ratings: 'GET', favourites: 'GET', tip: 'POST', click: 'POST', book: 'POST' });
  const l = limitReply({ ok: false, error: 'rate_limited', retry_after: 1234 }, 'vote');
  assert.equal(l.status, 429);
  assert.equal(l.body.retryAfter, 1234);
  assert.equal(l.headers['Retry-After'], '1234');
  assert.equal(limitReply({ ok: false, error: 'tips_full', retry_after: 0 }, 'tip').body.error, 'tips_full');
  assert.equal(limitReply({ ok: false, error: 'tips_full', retry_after: 0 }, 'tip').body.retryAfter, 60);
  assert.match(limitReply({ ok: false, error: 'rate_limited', retry_after: 5 }, 'tip').body.message, /tips/);
  const c = limitReply({ ok: false, error: 'rate_limited', retry_after: 30 }, 'click');
  assert.equal(c.status, 429);
  assert.match(c.body.message, /clicks/);
  assert.equal(limitReply(null).status, 502);
  assert.equal(limitReply({ ok: false, error: 'something' }).status, 502);
});

test('CORS: production (the new address and the old one), the owner’s gatecast previews and localhost only', () => {
  for (const ok of [
    'https://thegatecast.com', 'https://www.thegatecast.com',
    'https://gatecast.vercel.app', // the address until 18 Nov 2026: still allowed while it answers
    'https://gatecast-a1b2c3d4e-victorparkerr-4350s-projects.vercel.app',
    'https://gatecast-git-claude-jolly-faraday-anudd2-victorparkerr-4350s-projects.vercel.app',
    'http://localhost:4173', 'http://localhost', 'http://127.0.0.1:8080',
  ]) assert.equal(originAllowed(ok), true, ok);
  for (const bad of [
    'http://thegatecast.com', 'https://thegatecast.com.evil.com', 'https://evil.thegatecast.com', 'https://thegatecast.com:8443',
    'https://evilthegatecast.com', 'https://THEGATECAST.com', 'https://thegatecast.co',
    'https://gatecast.vercel.app.evil.com',
    'https://evil.com/https://gatecast.vercel.app',
    'http://gatecast.vercel.app',
    'https://gatecast-evil.vercel.app',
    'https://evil-victorparkerr-4350s-projects.vercel.app',
    'https://gatecast-x-victorparkerr-4350s-projects.vercel.app.evil.com',
    'https://gatecast--victorparkerr-4350s-projects.vercel.app',
    'https://gatecast-a.b-victorparkerr-4350s-projects.vercel.app',
    'https://gatecast-abc-victorparkerr-4350s-projects-vercel.app',
    'https://GATECAST.vercel.app',
    'https://localhost:4173', 'http://localhost.evil.com', 'http://localhost:4173.evil.com', 'http://127.0.0.1.nip.io',
    'null', '', undefined,
  ]) assert.equal(originAllowed(bad), false, String(bad));
  assert.equal(originAllowed('https://weird.example.org', ['https://weird.example.org']), true);
  for (const o of ['https://thegatecast.com', 'https://www.thegatecast.com', 'https://gatecast.vercel.app']) assert.equal(corsHeaders(o)['Access-Control-Allow-Origin'], o);
  assert.equal(corsHeaders('https://evil.com')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('https://evil.com').Vary, 'Origin');
});

test('writes must be JSON and, from a browser, from our own pages', () => {
  assert.deepEqual(writeAllowed('https://thegatecast.com', 'application/json'), { ok: true });
  assert.deepEqual(writeAllowed('https://gatecast.vercel.app', 'application/json'), { ok: true }, 'the old address still works');
  assert.deepEqual(writeAllowed('', 'application/json; charset=utf-8'), { ok: true }, 'no Origin: not a cross-site browser request');
  assert.equal(writeAllowed('https://evil.com', 'application/json').status, 403);
  assert.equal(writeAllowed('https://thegatecast.com', 'text/plain').status, 415, 'a simple cross-site POST is refused');
  assert.equal(writeAllowed('https://thegatecast.com', null).status, 415);
});

/* ---------- browser module ---------- */

test('browser: tip checks and error sentences', () => {
  assert.equal(browser.tipProblem({ url: 'https://www.upi.com/x' }), null);
  assert.match(browser.tipProblem({ url: '' }), /Paste the link/);
  assert.match(browser.tipProblem({ url: 'www.upi.com/x' }), /web address/);
  assert.match(browser.tipProblem({ url: 'http://www.upi.com/x' }), /https/);
  assert.match(browser.tipProblem({ url: 'https://a.com/x', note: 'x'.repeat(281) }), /280/);
  assert.equal(browser.errorMessage(429, { message: 'Slow down.' }), 'Slow down.');
  assert.match(browser.errorMessage(429, null), /Too many/);
  assert.match(browser.errorMessage(0, null), /connection/);
  assert.match(browser.errorMessage(503, {}), /switched off/);
});

test('browser: calls go to the community function and never throw', async () => {
  const realFetch = globalThis.fetch;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/ratings?')) {
        const ids = new URL(url).searchParams.get('ids').split(',');
        return new Response(JSON.stringify({ ratings: Object.fromEntries(ids.map((id) => [id, { count: 51, average: 3.9 }])) }), { status: 200 });
      }
      if (url.endsWith('/favourites')) return new Response(JSON.stringify({ favourites: [{ storyId: '0123456789abcdef', count: 12, average: 4.4 }, { storyId: 'nope', count: 1 }] }), { status: 200 });
      if (url.endsWith('/vote')) return new Response(JSON.stringify({ count: 3, average: null, yours: 4 }), { status: 200 });
      if (url.endsWith('/tip')) return new Response(JSON.stringify({ error: 'rate_limited', message: 'Enough tips today.', retryAfter: 600 }), { status: 429 });
      return new Response('{}', { status: 404 });
    };
    const story = 'https://www.upi.com/Odd_News/x/';
    const vote = await browser.rateStory(story, 4);
    assert.deepEqual(vote, { ok: true, count: 3, average: null, yours: 4 });
    assert.ok(calls[0].url.startsWith(browser.BASE + '/vote'));
    assert.ok(browser.BASE.endsWith('/functions/v1/community'));
    assert.equal(calls[0].init.headers.apikey.length > 0, true);
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(await browser.yourVote(story), 4, 'remembered locally');
    assert.equal(await browser.yourVote('https://www.upi.com/Odd_News/x?utm_source=a'), 4, 'by story, not by exact link');

    const r = await browser.loadRatings([story, 'not a url']);
    assert.deepEqual(r, { [story]: { count: 51, average: 3.9, yours: 4 } });

    assert.deepEqual(await browser.loadFavourites(), [{ storyId: '0123456789abcdef', count: 12, average: null }]);
    assert.deepEqual(await browser.sendTip({ url: 'https://www.upi.com/y', note: 'hi' }), { ok: false, error: 'Enough tips today.' });
    assert.deepEqual(await browser.sendTip({ url: 'nope' }), { ok: false, error: 'That doesn’t look like a web address. Paste the full link, starting https://' });
    assert.equal((await browser.rateStory(story, 9)).ok, false);

    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.deepEqual(await browser.loadRatings([story]), {});
    assert.deepEqual(await browser.loadFavourites(), []);
    const failed = await browser.rateStory(story, 2);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /connection/);
    assert.equal((await browser.sendTip({ url: 'https://a.com/x' })).ok, false);

    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    globalThis.fetch = async () => new Response(JSON.stringify({ count: 1, average: null, yours: 5 }), { status: 200 });
    assert.equal((await browser.rateStory(story, 5)).ok, true, 'works without storage');
    assert.equal(await browser.yourVote(story), null);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});

test('browser: clicks are skipped under Do Not Track or Global Privacy Control', () => {
  assert.equal(browser.clickAllowed({}, {}), true);
  assert.equal(browser.clickAllowed({ doNotTrack: 'unspecified' }, {}), true);
  assert.equal(browser.clickAllowed({ doNotTrack: '0' }, {}), true);
  assert.equal(browser.clickAllowed({ globalPrivacyControl: false }, {}), true);
  assert.equal(browser.clickAllowed({ doNotTrack: '1' }, {}), false);
  assert.equal(browser.clickAllowed({ doNotTrack: 'yes' }, {}), false, 'old Firefox spelling');
  assert.equal(browser.clickAllowed({ msDoNotTrack: '1' }, {}), false, 'old IE spelling');
  assert.equal(browser.clickAllowed({}, { doNotTrack: '1' }), false, 'old Safari and IE put it on window');
  assert.equal(browser.clickAllowed({ globalPrivacyControl: true }, {}), false);
  assert.equal(browser.clickAllowed({ get doNotTrack() { throw new Error('x'); } }, {}), false, 'unreadable: not counted');
});

test('browser: a click sends the story URL only, never waits and never throws', () => {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.reject(new Error('offline')); };
  const story = 'https://www.upi.com/Odd_News/x/?utm_source=feed&fbclid=1#top';
  assert.equal(browser.countClick(story, { fetch, navigator: {}, window: {} }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, browser.BASE + '/click');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true, 'outlives the page as the reader leaves');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(calls[0].init.body), { storyUrl: 'https://www.upi.com/Odd_News/x' }, 'the normalised story address and nothing else');
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Content-Type', 'apikey']);

  // Do Not Track / GPC: nothing is sent at all.
  assert.equal(browser.countClick(story, { fetch, navigator: { doNotTrack: '1' }, window: {} }), false);
  assert.equal(browser.countClick(story, { fetch, navigator: { globalPrivacyControl: true }, window: {} }), false);
  assert.equal(calls.length, 1);
  // Not a story link.
  for (const bad of ['javascript:alert(1)', '', null, 'mailto:x@y.z']) assert.equal(browser.countClick(bad, { fetch, navigator: {}, window: {} }), false, String(bad));
  assert.equal(calls.length, 1);

  // keepalive fetch throws synchronously (quota, old browser): the beacon, with the same body.
  const beacons = [];
  const navigator = { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } };
  assert.equal(browser.countClick(story, { fetch: () => { throw new TypeError('keepalive'); }, navigator, window: {} }), true);
  assert.equal(beacons[0].url, browser.BASE + '/click');
  assert.equal(beacons[0].blob.type, 'application/json');
  // No fetch at all: the beacon too. A beacon that throws (some browsers refuse JSON beacons): false, no throw.
  assert.equal(browser.countClick(story, { fetch: undefined, navigator, window: {} }), true);
  assert.equal(browser.countClick(story, { fetch: undefined, navigator: { sendBeacon() { throw new Error('no'); } }, window: {} }), false);
  assert.equal(browser.countClick(story, { fetch: undefined, navigator: {}, window: {} }), false);
});

/* ---------- lib/picks-db.js ---------- */

const ROW = { url: 'https://www.upi.com/Odd_News/sheep', title: 'Loose sheep caught by lasso', outlet: 'UPI', published: '2026-11-13', category: 'animals', rating: 4, note: 'Forty-five days on the run.', videoId: null, imageUrl: null, video: null, summary: null };
const FAKE_ROW_NOTE = 'x'.repeat(200);

test('picks from the database: endpoint and shape', async () => {
  const ep = picksEndpoint('https://hfdwmzuedjcsaxgzhzmu.supabase.co/');
  assert.ok(ep.startsWith('https://hfdwmzuedjcsaxgzhzmu.supabase.co/rest/v1/weird_picks?'));
  assert.ok(ep.includes('status=eq.published'));
  assert.ok(ep.includes('select=url,title,outlet,published,category,rating,note,video_id,image_url,summary,video_provider,video_ref'));
  assert.deepEqual(toPick(ROW), ROW);
  assert.deepEqual(toPick({ ...ROW, category: 'aliens', rating: 9, note: '', published: 'soon' }), { ...ROW, category: 'other', rating: null, note: null, published: null });
  assert.equal(toPick({ ...ROW, note: FAKE_ROW_NOTE + 'x' }).note.length, 200, 'notes are at most 200 characters');
  assert.equal(toPick({ ...ROW, url: 'http://insecure.com/x' }), null);
  assert.equal(toPick({ ...ROW, title: ' ' }), null);
  assert.equal(toPick(null), null);

  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify([ROW, ROW, { url: 'javascript:x' }]), { status: 200 }); };
  const picks = await loadDbPicks({ url: 'https://p.supabase.co', key: 'sb_publishable_x', fetchImpl });
  assert.deepEqual(picks, [ROW], 'deduplicated, bad rows dropped');
  assert.equal(seen.init.headers.apikey, 'sb_publishable_x');
  assert.equal(seen.init.headers.Authorization, undefined);
});

test('picks from the database: [] on any failure, within the timeout', async () => {
  assert.deepEqual(await loadDbPicks({}), []);
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: '' }), []);
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async () => new Response('nope', { status: 500 }) }), []);
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async () => new Response('not json', { status: 200 }) }), []);
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async () => new Response('{"a":1}', { status: 200 }) }), []);
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async () => { throw new Error('down'); } }), []);
  const start = Date.now();
  const hang = () => new Promise(() => {}); // ignores the abort signal entirely
  assert.deepEqual(await loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: hang, timeoutMs: 50 }), []);
  assert.ok(Date.now() - start < 1000);
});
