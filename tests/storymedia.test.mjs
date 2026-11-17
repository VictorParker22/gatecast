// Story media: YouTube links, the editor's picture rule, oEmbed checks and their cache, videos found in article pages,
// the picks' media columns, api/yt-thumb, the front page's choice of picture / video / text-led layout, and the
// promise that nothing on the page points a visitor's browser at YouTube before Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { youtubeId, ytThumb, ytEmbed, isVideoId, registrableDomain, pickImageProblem, pickVideoProblem, sourceFor } from '../js/storymedia.js';
import { cleanItem, cleanWeird, storyMedia, cleanYoutube, videoLabel, playLabel, durationWords } from '../js/frontmodel.js';
import { mediaSlot, playerHTML } from '../js/frontmedia.js';
import { pickErrors, cleanPick, pickMediaView, pickBlock, mediaColumnsMissing, pickSaveError, pickVideoLink } from '../js/reviewmodel.js';

const require = createRequire(import.meta.url);
const yt = require('../lib/youtube.js');
const news = require('../lib/news.js');
const picksDb = require('../lib/picks-db.js');
const weird = require('../lib/weird.js');
const ytThumbApi = require('../api/yt-thumb.js');
const SOURCES = require('../data/weird-sources.json').sources;
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url), 'utf8');

const ID = 'dQw4w9WgXcQ';

/* ---------- YouTube links ---------- */

const GOOD_LINKS = [
  `https://www.youtube.com/watch?v=${ID}`,
  `https://youtube.com/watch?v=${ID}&t=42s`,
  `https://m.youtube.com/watch?feature=share&v=${ID}`,
  `http://www.youtube.com/watch?v=${ID}`,
  `www.youtube.com/watch?v=${ID}`,
  `https://youtu.be/${ID}`,
  `https://youtu.be/${ID}?si=abcDEF123&t=10`,
  `youtu.be/${ID}`,
  `https://www.youtube.com/shorts/${ID}`,
  `https://youtube.com/shorts/${ID}?feature=share`,
  `https://www.youtube.com/embed/${ID}`,
  `https://www.youtube.com/embed/${ID}?rel=0&autoplay=1`,
  `https://www.youtube-nocookie.com/embed/${ID}`,
  `https://youtube-nocookie.com/embed/${ID}?start=5`,
  `https://www.youtube.com/live/${ID}`,
  `https://music.youtube.com/watch?v=${ID}&list=RD`,
  `  https://youtu.be/${ID}  `,
];
const BAD_LINKS = [
  '', '   ', null, undefined, 42, ID, // a bare id is not a link
  'https://vimeo.com/123456',
  `https://www.youtube.com.evil.example/watch?v=${ID}`,
  `https://evil.example/https://youtu.be/${ID}`,
  `https://notyoutube.com/watch?v=${ID}`,
  `https://youtu.be.evil.example/${ID}`,
  'https://www.youtube.com/watch?v=short',
  `https://www.youtube.com/watch?v=${ID}x`, // 12 characters
  'https://www.youtube.com/watch?v=dQw4w9WgXc!',
  'https://www.youtube.com/@RickAstleyYT',
  'https://www.youtube.com/playlist?list=PL1234567890',
  'https://www.youtube.com/results?search_query=moose',
  `https://www.youtube.com/channel/${ID}`,
  `https://youtu.be/${ID}/extra`,
  `https://www.youtube-nocookie.com/watch?v=${ID}`,
  `javascript:alert('https://youtu.be/${ID}')`,
  `ftp://youtu.be/${ID}`,
  `https://user:pw@youtu.be/${ID}`,
  `https://youtu.be:8443/${ID}`,
  `https://youtu.be/${ID} trailing words`,
  `https://www.youtube.com/watch?v=${'x'.repeat(3000)}`,
];

test('youtubeId: every common YouTube link form gives the 11-character id', () => {
  for (const s of GOOD_LINKS) assert.equal(youtubeId(s), ID, s);
  assert.equal(youtubeId('https://youtu.be/a-b_c-D_e-1'), 'a-b_c-D_e-1', 'ids use letters, digits, - and _');
});

test('youtubeId: anything that is not a YouTube video link is refused', () => {
  for (const s of BAD_LINKS) assert.equal(youtubeId(s), null, String(s));
  assert.equal(isVideoId(ID), true);
  assert.equal(isVideoId('dQw4w9WgXc'), false);
  assert.equal(isVideoId({ id: ID }), false);
});

test('the server and the browser read YouTube links and domains the same way', () => {
  for (const s of [...GOOD_LINKS, ...BAD_LINKS]) assert.equal(yt.youtubeId(s), youtubeId(s), String(s));
  for (const h of ['cdnph.upi.com', 'www.upi.com', 'news.bbc.co.uk', 'bbc.co.uk', 'co.uk', 'i0.wp.com', 'soranews24.wordpress.com', 'th-thumbnailer.cdn-si-edu.com', 'localhost', '127.0.0.1', 'intranet', 'a.test', '']) {
    assert.equal(yt.registrableDomain(h), registrableDomain(h), h);
  }
});

test('pickVideoProblem: empty is fine, a link is fine, anything else says what to paste', () => {
  assert.equal(pickVideoProblem(''), null);
  assert.equal(pickVideoProblem('  '), null);
  assert.equal(pickVideoProblem(`https://youtu.be/${ID}`), null);
  assert.match(pickVideoProblem(ID), /whole YouTube link/);
  assert.match(pickVideoProblem('https://vimeo.com/1'), /YouTube video link/);
});

test('the same-origin addresses: Gatecast\'s still, and the privacy-enhanced player only', () => {
  assert.equal(ytThumb(ID), `api/yt-thumb?id=${ID}`);
  assert.equal(ytEmbed(ID), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
  assert.equal(ytThumb('../../etc'), null);
  assert.equal(ytEmbed('x"><script>'), null);
});

/* ---------- The editor's picture rule ---------- */

const UPI = 'https://www.upi.com/Odd_News/2026/11/13/Moose-on-the-bus/1001763050000/';
test('pickImageProblem: the story\'s own site, or the outlet\'s listed image host', () => {
  const opts = { outlet: 'UPI', sources: SOURCES };
  assert.equal(pickImageProblem('', UPI, opts), null, 'empty is fine');
  assert.equal(pickImageProblem('https://cdnph.upi.com/svc/sv/i/1001763050000/moose.jpg', UPI, opts), null, 'same registrable domain');
  assert.equal(pickImageProblem('https://www.upi.com/i/moose.jpg', UPI, opts), null);
  assert.match(pickImageProblem('https://i.imgur.com/moose.jpg', UPI, opts), /story’s own site \(upi\.com\)/);
  assert.match(pickImageProblem('https://upi.com.evil.org/moose.jpg', UPI, opts), /own site/);
  assert.match(pickImageProblem('http://cdnph.upi.com/moose.jpg', UPI, opts), /https/);
  assert.match(pickImageProblem('https://user:pw@cdnph.upi.com/m.jpg', UPI, opts), /plain/);
  assert.match(pickImageProblem('https://cdnph.upi.com:8443/m.jpg', UPI, opts), /plain/);
  assert.match(pickImageProblem('https://127.0.0.1/m.jpg', UPI, opts), /public website/);
  assert.match(pickImageProblem('https://cdnph.upi.com/logo.svg', UPI, opts), /SVG/);
  assert.match(pickImageProblem('not a link', UPI, opts), /full link/);
  assert.match(pickImageProblem(`https://cdnph.upi.com/${'x'.repeat(2100)}.jpg`, UPI, opts), /too long/);
  assert.match(pickImageProblem('https://cdnph.upi.com/m.jpg', '', opts), /story link first/);

  // Listed image hosts (data/weird-sources.json imageHosts), and their subdomains; only for that outlet.
  const smith = 'https://www.smithsonianmag.com/smart-news/a-giant-croc-180985000/';
  assert.equal(pickImageProblem('https://th-thumbnailer.cdn-si-edu.com/abc=/fit-in/1072x0/croc.jpg', smith, { outlet: 'Smithsonian Magazine', sources: SOURCES }), null);
  assert.match(pickImageProblem('https://th-thumbnailer.cdn-si-edu.com/croc.jpg', UPI, opts), /own site/, 'another outlet\'s CDN does not count');
  const sora = 'https://soranews24.com/2026/11/14/vending-machine/';
  assert.equal(pickImageProblem('https://i0.wp.com/soranews24.com/wp-content/uploads/a.jpg', sora, { outlet: 'SoraNews24', sources: SOURCES }), null);
  assert.equal(pickImageProblem('https://img.x.e3.365dm.com/a.jpg', 'https://news.sky.com/story/x-1', { outlet: 'Sky News', sources: SOURCES }), null, 'a subdomain of a listed host');

  // An outlet with pictures switched off takes none, even from the editor.
  assert.match(pickImageProblem('https://www.sciencedaily.com/images/a.jpg', 'https://www.sciencedaily.com/releases/2026/11/x.htm', { outlet: 'ScienceDaily', sources: SOURCES }), /without pictures/);
  // Without the outlet list, only the story's own site.
  assert.equal(pickImageProblem('https://cdnph.upi.com/m.jpg', UPI, {}), null);
  assert.equal(sourceFor(UPI, '', SOURCES).name, 'UPI', 'found by the story\'s address');
});

test('the server applies the same picture rule to picks it serves', () => {
  const norm = SOURCES.map(weird.normaliseSource);
  const src = (name) => norm.find((s) => s.name === name);
  assert.equal(yt.pickImage('https://cdnph.upi.com/m.jpg', UPI, src('UPI')), 'https://cdnph.upi.com/m.jpg');
  assert.equal(yt.pickImage('https://i.imgur.com/m.jpg', UPI, src('UPI')), null);
  assert.equal(yt.pickImage('https://th-thumbnailer.cdn-si-edu.com/c.jpg', 'https://www.smithsonianmag.com/x/', src('Smithsonian Magazine')), 'https://th-thumbnailer.cdn-si-edu.com/c.jpg');
  assert.equal(yt.pickImage('https://www.sciencedaily.com/images/a.jpg', 'https://www.sciencedaily.com/releases/x.htm', src('ScienceDaily')), null, 'pictures off');
  assert.equal(yt.pickImage('https://cdnph.upi.com/m.svg', UPI, src('UPI')), null);
  assert.equal(yt.pickImage('https://cdnph.upi.com/m.jpg', UPI, null), 'https://cdnph.upi.com/m.jpg', 'an outlet not in the list: its own site only');
  assert.deepEqual(src('SoraNews24').imageHosts, ['i0.wp.com', 'i1.wp.com', 'i2.wp.com']);
  assert.deepEqual(weird.normaliseSource({ id: 'x', name: 'X', home: 'https://x.org', feed: 'https://x.org/f', imageHosts: ['CDN.X.org', 'localhost', '10.0.0.1', 5] }).imageHosts, ['cdn.x.org'], 'only public host names are kept');
});

/* ---------- oEmbed checks and their cache ---------- */

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
function oembedStub(answers) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const id = new URL(new URL(url).searchParams.get('url')).searchParams.get('v');
    const a = typeof answers === 'function' ? answers(id, calls.length) : answers[id];
    if (a instanceof Error) throw a;
    return typeof a === 'number' ? json({}, a) : json(a);
  };
  return { fetchImpl, calls };
}

test('verifyVideo asks YouTube\'s oEmbed and keeps only the title and channel', async () => {
  yt.clearVideoCache();
  const { fetchImpl, calls } = oembedStub({ [ID]: { type: 'video', title: ' Moose  rides\nthe bus ', author_name: 'UPI', html: '<iframe src="https://www.youtube.com/embed/x"></iframe>', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' } });
  const v = await yt.verifyVideo(ID, { fetchImpl, now: 0 });
  assert.deepEqual(v, { id: ID, title: 'Moose rides the bus', channel: 'UPI' });
  assert.equal(calls[0], `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}&format=json`);
  assert.equal(await yt.verifyVideo('bad', { fetchImpl }), null, 'a malformed id is never sent');
  assert.equal(calls.length, 1);
});

test('verifyVideo: 400, 401, 403 and 404 mean gone or not embeddable, and the video is dropped', async () => {
  for (const status of [400, 401, 403, 404]) {
    yt.clearVideoCache();
    const { fetchImpl } = oembedStub(() => status);
    assert.equal(await yt.verifyVideo(ID, { fetchImpl, now: 0 }), null, String(status));
  }
});

test('verifyVideo caches answers for 6 hours, failures for 10 minutes, and a failure never drops a verified video', async () => {
  yt.clearVideoCache();
  let mode = 'ok';
  const { fetchImpl, calls } = oembedStub(() => (mode === 'ok' ? { type: 'video', title: 'T', author_name: 'C' } : mode === 'down' ? new Error('ECONNRESET') : mode === 'gone' ? 401 : 503));
  const H = 3600e3, M = 60e3;
  assert.ok(await yt.verifyVideo(ID, { fetchImpl, now: 0 }));
  assert.ok(await yt.verifyVideo(ID, { fetchImpl, now: 5 * H }));
  assert.equal(calls.length, 1, 'served from the cache within 6 hours');

  mode = 'down';
  assert.deepEqual(await yt.verifyVideo(ID, { fetchImpl, now: 6 * H + 1 }), { id: ID, title: 'T', channel: 'C' }, 'network failure: the verified video stays');
  assert.equal(calls.length, 2);
  await yt.verifyVideo(ID, { fetchImpl, now: 6 * H + 9 * M });
  assert.equal(calls.length, 2, 'a failure is retried only after 10 minutes');
  mode = 'error';
  assert.ok(await yt.verifyVideo(ID, { fetchImpl, now: 6 * H + 11 * M }), 'YouTube\'s own 503: still the verified video');
  assert.equal(calls.length, 3);

  mode = 'gone';
  assert.equal(await yt.verifyVideo(ID, { fetchImpl, now: 6 * H + 22 * M }), null, 'a real answer that it is gone drops it');
  mode = 'down';
  assert.equal(await yt.verifyVideo(ID, { fetchImpl, now: 13 * H }), null, 'and a later failure does not bring it back');

  // Never verified and YouTube unreachable: not served (nothing to label it with), asked again in 10 minutes.
  yt.clearVideoCache();
  const other = 'aBcDeFgHi_1';
  assert.equal(await yt.verifyVideo(other, { fetchImpl, now: 0 }), null);

  // Two requests at once share one check.
  yt.clearVideoCache();
  mode = 'ok';
  const before = calls.length;
  await Promise.all([yt.verifyVideo(ID, { fetchImpl, now: 0 }), yt.verifyVideo(ID, { fetchImpl, now: 0 })]);
  assert.equal(calls.length, before + 1);
});

test('verifyVideo refuses an oEmbed answer that is not a video, too big or not JSON', async () => {
  yt.clearVideoCache();
  assert.equal(await yt.verifyVideo(ID, { fetchImpl: oembedStub(() => ({ type: 'rich', title: 'x' })).fetchImpl, now: 0, cache: false }), null);
  const big = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ type: 'video', title: 'x'.repeat(70000) }) });
  assert.equal(await yt.verifyVideo(ID, { fetchImpl: big, now: 0, cache: false }), null);
  const junk = async () => ({ ok: true, status: 200, text: async () => '<html>' });
  assert.equal(await yt.verifyVideo(ID, { fetchImpl: junk, now: 0, cache: false }), null);
});

/* ---------- Videos in article pages ---------- */

test('pageVideo finds the YouTube player an article embeds: og:video, then JSON-LD, then the first iframe', () => {
  assert.deepEqual(news.pageVideo(fixture('ogvideo.html')), { id: 'Moose_Bus-1', duration: null }, 'og:video first');
  assert.deepEqual(news.pageVideo(fixture('jsonld.html')), { id: 'HailStone01', duration: '2:31' }, 'a VideoObject in an @graph, with its length');
  assert.deepEqual(news.pageVideo(fixture('iframe.html')), { id: 'aBcDeFgHi_1', duration: null }, 'the first YouTube iframe; Vimeo and script text ignored');
  assert.equal(news.pageVideo(fixture('none.html')), null, 'Vimeo, Dailymotion, look-alike hosts and plain links are not embeds');
  assert.equal(news.pageVideo(''), null);
  assert.equal(news.pageVideo('<iframe data-src="//www.youtube.com/embed/LazyLoad_01"></iframe>').id, 'LazyLoad_01', 'lazy loaders\' data-src');
  assert.equal(news.pageVideo('<meta name="twitter:player" content="https://www.youtube.com/embed/TwitterPl_1">').id, 'TwitterPl_1');
  assert.equal(news.pageVideo('<script type="application/ld+json">{ not json</script>'), null);
  assert.equal(news.pageVideo('<!-- <iframe src="https://www.youtube.com/embed/Commented01"></iframe> -->'), null, 'comments are not read');
  assert.equal(yt.isoDuration('PT1H4M5S'), '1:04:05');
  assert.equal(yt.isoDuration('PT45S'), '0:45');
  assert.equal(yt.isoDuration('P1D'), null);
  assert.equal(yt.isoDuration('PT0S'), null);
});

test('pageMedia reads past </head> for the player but never more than the cap, on the outlet\'s own site only', async () => {
  const src = { homepage: 'https://www.atlasobscura.com/', feed: 'https://www.atlasobscura.com/feeds/articles' };
  const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];
  const page = (html) => async () => ({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, text: async () => html });
  const got = await news.pageMedia('https://www.atlasobscura.com/articles/goat', src, { fetchImpl: page(fixture('iframe.html')), lookupImpl });
  assert.deepEqual(got, {
    image: { url: 'https://img.atlasobscura.com/fixture/goat.jpg' }, video: { id: 'aBcDeFgHi_1', duration: null },
    // Every provider's player, in page order (js/mediaproviders.js findPageVideos); the one in a script is never read.
    videos: [{ provider: 'vimeo', ref: '123456', duration: null }, { provider: 'youtube', ref: 'aBcDeFgHi_1', duration: null }, { provider: 'youtube', ref: 'SECONDxxxxx', duration: null }],
  });
  assert.ok(!JSON.stringify(got).includes('NEVER-SHOW'));
  // An iframe past the size cap is never seen.
  const far = `<html><head></head><body>${' '.repeat(news.MAX_HEAD_BYTES)}<iframe src="https://www.youtube.com/embed/aBcDeFgHi_1"></iframe></body></html>`;
  assert.equal((await news.pageMedia('https://www.atlasobscura.com/articles/far', src, { fetchImpl: page(far), lookupImpl })).video, null);
  // Another site, or a private address: never read.
  let asked = 0;
  const count = async () => { asked++; return page('')(); };
  assert.equal(await news.pageMedia('https://evil.example.org/x', src, { fetchImpl: count, lookupImpl }), null);
  assert.equal(await news.pageMedia('https://www.atlasobscura.com/x', src, { fetchImpl: count, lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }] }), null);
  assert.equal(asked, 0);
  // The brief's preview-image read still stops at </head>.
  let streamed = 0;
  const stream = async () => ({
    ok: true, status: 200, headers: { get: () => 'text/html' },
    body: { getReader: () => { let i = 0; const parts = ['<html><head><meta property="og:image" content="https://img.atlasobscura.com/a.jpg"></head>', '<body>', '<iframe src="https://www.youtube.com/embed/aBcDeFgHi_1"></iframe>']; return { read: async () => { streamed++; return i < parts.length ? { done: false, value: new TextEncoder().encode(parts[i++]) } : { done: true }; }, cancel: async () => {} }; } },
  });
  assert.deepEqual(await news.pageImage('https://www.atlasobscura.com/x', src, { fetchImpl: stream, lookupImpl }), { image: { url: 'https://img.atlasobscura.com/a.jpg' } });
  assert.equal(streamed, 1, 'the brief stops at </head>');
  streamed = 0;
  assert.equal((await news.pageMedia('https://www.atlasobscura.com/x', src, { fetchImpl: stream, lookupImpl })).video.id, 'aBcDeFgHi_1');
  assert.ok(streamed > 1, 'the weird news reads on for the player');
});

/* ---------- The picks' media columns ---------- */

test('picks-db reads video_id and image_url, and checks them', async () => {
  const row = { url: 'https://www.upi.com/Odd_News/moose', title: 'Moose on the bus', outlet: 'UPI', published: '2026-11-15', category: 'animals', rating: 5, note: null, video_id: ID, image_url: 'https://cdnph.upi.com/m.jpg' };
  assert.deepEqual(picksDb.toPick(row), { url: row.url, title: row.title, outlet: 'UPI', published: '2026-11-15', category: 'animals', rating: 5, note: null, videoId: ID, imageUrl: 'https://cdnph.upi.com/m.jpg', video: { provider: 'youtube', ref: ID }, summary: null });
  for (const bad of ['dQw4w9WgXc', `${ID}x`, 'dQw4w9WgXc!', 42, '']) assert.equal(picksDb.toPick({ ...row, video_id: bad }).videoId, null, String(bad));
  for (const bad of ['http://cdnph.upi.com/m.jpg', 'javascript:alert(1)', `https://cdnph.upi.com/${'x'.repeat(2050)}`, 7]) assert.equal(picksDb.toPick({ ...row, image_url: bad }).imageUrl, null, String(bad).slice(0, 30));
  assert.ok(picksDb.picksEndpoint('https://p.supabase.co').includes('select=url,title,outlet,published,category,rating,note,video_id,image_url'));

  // Before either migration: the database refuses the new columns, and the picks are read with the columns of the
  // migration before each (summary and provider video, then picture and YouTube id, then neither).
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.includes('video_id')) return new Response(JSON.stringify({ code: '42703', message: 'column weird_picks.video_id does not exist' }), { status: 400 });
    return new Response(JSON.stringify([{ ...row, video_id: undefined, image_url: undefined }]), { status: 200 });
  };
  const picks = await picksDb.loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl });
  assert.equal(asked.length, 3);
  assert.ok(asked[0].includes(`select=${picksDb.COLUMNS}&`));
  assert.ok(asked[1].includes(`select=${picksDb.MEDIA_COLUMNS}&`));
  assert.ok(asked[2].includes(`select=${picksDb.LEGACY_COLUMNS}&`));
  assert.equal(picks.length, 1);
  assert.equal(picks[0].videoId, null);
  // Any other failure is still [] with one request.
  asked.length = 0;
  assert.deepEqual(await picksDb.loadDbPicks({ url: 'https://p.supabase.co', key: 'k', fetchImpl: async (u) => { asked.push(u); return new Response('{}', { status: 500 }); } }), []);
  assert.equal(asked.length, 1);
});

/* ---------- /api/weird with media ---------- */

test('/api/weird: the editor\'s picture and verified video for a pick; a gone video is dropped', async () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const GONE = 'Gone_Video1';
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.startsWith('https://www.youtube.com/oembed')) {
      const id = new URL(new URL(url).searchParams.get('url')).searchParams.get('v');
      return id === GONE ? json({}, 401) : json({ type: 'video', title: 'Moose rides the bus', author_name: 'UPI' });
    }
    return { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '' };
  };
  const pick = (n, extra) => ({ url: `https://www.upi.com/Odd_News/2026/11/1${n}/Pick-${n}/100${n}/`, title: `Odd pick number ${n} turns heads`, outlet: 'UPI', published: `2026-11-1${n}`, category: 'animals', ...extra });
  const out = await weird.weirdFor(new URLSearchParams({ limit: '10' }), {
    fetchImpl, lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }], now, pageCache: false, sources: [],
    picks: [],
    dbPicks: [
      pick(5, { rating: 5, videoId: ID }),
      pick(4, { rating: 4, imageUrl: 'https://cdnph.upi.com/p4.jpg', videoId: ID }),
      pick(3, { rating: 3, imageUrl: 'https://i.imgur.com/stolen.jpg' }),
      pick(2, { rating: 2, videoId: GONE }),
    ],
  });
  const byN = (n) => out.items.find((x) => x.title.includes(`number ${n}`));
  assert.deepEqual(byN(5).youtube, { id: ID, title: 'Moose rides the bus', channel: 'UPI', duration: null, from: 'editor' });
  assert.equal(byN(5).image, null);
  assert.equal(byN(5).video, true);
  assert.equal(byN(4).image, 'https://cdnph.upi.com/p4.jpg');
  assert.equal(byN(4).imageCredit, 'Image: UPI');
  assert.equal(byN(4).youtube.id, ID);
  assert.equal(byN(3).image, null, 'a picture from another site is refused');
  assert.equal(byN(2).youtube, null, 'not embeddable or gone: dropped');
  assert.equal(byN(2).video, false);
  assert.ok(!asked.some((u) => u.includes('upi.com/Odd_News')), 'a pick\'s page is never read');
  assert.ok(!JSON.stringify(out).includes('ytimg'), 'the answer never names YouTube\'s image server');
});

test('/api/weird: a feed story gets the video its article embeds, checked first', async () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const src = weird.normaliseSource({ id: 'ao', name: 'Atlas Obscura', home: 'https://www.atlasobscura.com/', feed: 'https://www.atlasobscura.com/feeds/articles', images: true, minWeirdness: 0, categoryHints: {} });
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>AO</title>
    <item><title>Mysterious goat climbs a dam wall</title><link>https://www.atlasobscura.com/articles/goat</link><pubDate>Sun, 15 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Mysterious hail the size of grapefruit</title><link>https://www.atlasobscura.com/articles/hail</link><pubDate>Sun, 15 Nov 2026 09:00:00 GMT</pubDate><media:content url="https://img.atlasobscura.com/hail.jpg" medium="image"/></item>
  </channel></rss>`;
  const html = { '/articles/goat': fixture('iframe.html'), '/articles/hail': fixture('jsonld.html') };
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url === src.feed) return { ok: true, status: 200, headers: { get: () => 'application/rss+xml' }, text: async () => rss };
    if (url.startsWith('https://www.youtube.com/oembed')) return json({ type: 'video', title: 'A goat', author_name: 'Atlas Obscura' });
    const page = html[new URL(url).pathname];
    return page ? { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => page } : { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '' };
  };
  const out = await weird.weirdFor(new URLSearchParams(), { fetchImpl, lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }], now, pageCache: false, sources: [src], picks: [], dbPicks: [] });
  const goat = out.items.find((x) => /goat/.test(x.title));
  const hail = out.items.find((x) => /hail/.test(x.title));
  assert.equal(goat.image, 'https://img.atlasobscura.com/fixture/goat.jpg', 'no feed picture: the page\'s og:image');
  assert.deepEqual(goat.youtube, { id: 'aBcDeFgHi_1', title: 'A goat', channel: 'Atlas Obscura', duration: null, from: 'page' });
  assert.equal(hail.image, 'https://img.atlasobscura.com/hail.jpg', 'the feed\'s picture first');
  assert.equal(hail.youtube, null, 'with a feed picture and no video label the page is not read');
  assert.ok(!asked.includes('https://www.atlasobscura.com/articles/hail'));
});

/* ---------- api/yt-thumb ---------- */

function jpeg(bytes = 2000, status = 200, type = 'image/jpeg') {
  const body = new Uint8Array(bytes).fill(0xff);
  return { ok: status === 200, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => body.buffer, body: null };
}

test('thumbFor: only an 11-character id, only i.ytimg.com, a JPEG within the size cap, cached a day', async () => {
  const asked = [];
  const ok = async (url, init) => { asked.push({ url, init }); return jpeg(); };
  for (const bad of [undefined, '', 'short', `${ID}x`, '../../../etc/passwd', 'dQw4w9WgXc%', `${ID}/../x`]) {
    const r = await yt.thumbFor(bad, { fetchImpl: ok });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.headers['Cache-Control'], 'no-store');
  }
  assert.equal(asked.length, 0, 'nothing is fetched for a bad id');

  const r = await yt.thumbFor(ID, { fetchImpl: ok });
  assert.equal(r.status, 200);
  assert.equal(asked[0].url, `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  assert.equal(asked[0].init.redirect, 'manual', 'never follows YouTube anywhere else');
  assert.ok(!('cookie' in asked[0].init.headers) && !('Cookie' in asked[0].init.headers));
  assert.equal(r.headers['Content-Type'], 'image/jpeg');
  assert.match(r.headers['Cache-Control'], /^public, max-age=86400, s-maxage=86400/);
  assert.match(r.headers['Cache-Control'], /immutable/);
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.body.length, 2000);

  assert.equal((await yt.thumbFor(ID, { fetchImpl: async () => jpeg(1097, 404) })).status, 404, 'YouTube\'s grey placeholder is a 404');
  assert.match((await yt.thumbFor(ID, { fetchImpl: async () => jpeg(1097, 404) })).headers['Cache-Control'], /max-age=600/);
  assert.equal((await yt.thumbFor(ID, { fetchImpl: async () => jpeg(yt.MAX_THUMB_BYTES + 1) })).status, 502, 'too big');
  assert.equal((await yt.thumbFor(ID, { fetchImpl: async () => jpeg(2000, 200, 'text/html') })).status, 502, 'not a JPEG');
  assert.equal((await yt.thumbFor(ID, { fetchImpl: async () => jpeg(2000, 302) })).status, 502, 'a redirect is not followed');
  assert.equal((await yt.thumbFor(ID, { fetchImpl: async () => { throw new Error('down'); } })).status, 502);
});

test('api/yt-thumb answers with those headers and refuses other methods', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jpeg(3000);
  const res = () => {
    const r = { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, end(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
    return r;
  };
  try {
    const a = res();
    await ytThumbApi({ method: 'GET', url: `/api/yt-thumb?id=${ID}` }, a);
    assert.equal(a.statusCode, 200);
    assert.equal(a.headers['Content-Type'], 'image/jpeg');
    assert.match(a.headers['Cache-Control'], /public, max-age=86400, s-maxage=86400/);
    assert.equal(a.body.length, 3000);
    const b = res();
    await ytThumbApi({ method: 'GET', url: '/api/yt-thumb?id=<script>' }, b);
    assert.equal(b.statusCode, 400);
    const c = res();
    await ytThumbApi({ method: 'POST', url: `/api/yt-thumb?id=${ID}` }, c);
    assert.equal(c.statusCode, 405);
  } finally { globalThis.fetch = realFetch; }
});

/* ---------- The front page: picture, video or text-led ---------- */

const item = (extra = {}) => ({
  id: 's1', title: 'Moose rides the bus', url: 'https://www.upi.com/Odd_News/2026/11/15/moose/1/', outlet: 'UPI',
  published: '2026-11-15T12:00:00Z', category: 'animals', image: null, imageCredit: null, video: false, youtube: null, pick: true, rating: null, note: null, ...extra,
});
const YT = { id: ID, title: 'Moose rides the bus', channel: 'UPI', duration: '2:31', from: 'editor' };

test('cleanItem keeps a real YouTube video and builds its still address itself', () => {
  const x = cleanItem(item({ youtube: { ...YT, thumb: 'https://i.ytimg.com/vi/x/maxres.jpg', extra: 'x' } }));
  assert.deepEqual(x.youtube, { id: ID, title: 'Moose rides the bus', channel: 'UPI', duration: '2:31', thumb: `api/yt-thumb?id=${ID}` });
  assert.equal(x.video, true, 'a playable video is a video');
  assert.equal(cleanItem(item({ youtube: { id: 'nope' } })).youtube, null);
  assert.equal(cleanItem(item({ youtube: 'dQw4w9WgXcQ' })).youtube, null);
  assert.equal(cleanYoutube({ id: ID, duration: '99:99' }).duration, null);
  assert.equal(cleanYoutube({ id: ID, duration: '1:04:05' }).duration, '1:04:05');
});

test('data.js loadWeird passes a well-formed video through, and only its id and label words', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [
    { ...item({ id: 'a' }), youtube: { ...YT, thumb: 'https://i.ytimg.com/vi/x/hqdefault.jpg' } },
    { ...item({ id: 'b', url: 'https://www.upi.com/b/' }), youtube: { id: '../../x' } },
  ] }), { headers: { 'content-type': 'application/json' } });
  try {
    const { loadWeird } = await import('../js/data.js');
    const out = await loadWeird();
    assert.deepEqual(out.items[0].youtube, { id: ID, title: 'Moose rides the bus', channel: 'UPI', duration: '2:31' });
    assert.equal(out.items[1].youtube, null);
  } finally { globalThis.fetch = realFetch; }
});

test('storyMedia chooses the picture, then the video, then the text-led layout', () => {
  const pic = 'https://cdnph.upi.com/m.jpg';
  const both = cleanItem(item({ image: pic, imageCredit: 'Image: UPI', youtube: YT }));
  assert.equal(storyMedia(both).kind, 'image');
  assert.equal(storyMedia(both).video.id, ID, 'a picture with a video keeps the video for "Has video"');
  assert.equal(storyMedia(cleanItem(item({ youtube: YT }))).kind, 'video');
  assert.equal(storyMedia(cleanItem(item())).kind, 'text');
  assert.equal(storyMedia(cleanItem(item({ video: true }))).kind, 'text', 'a "VIDEO AT SOURCE" label alone is not a player');
  // A picture that failed to load counts as none: the video facade, else text-led.
  assert.equal(storyMedia(both, new Set([pic])).kind, 'video');
  assert.equal(storyMedia(cleanItem(item({ image: pic })), new Set([pic])).kind, 'text');
  const w = cleanWeird({ items: [item({ youtube: YT }), item({ id: 's2', url: 'https://www.upi.com/b/', image: pic }), item({ id: 's3', url: 'https://www.upi.com/c/' })] });
  assert.deepEqual(w.items.map((x) => storyMedia(x).kind), ['video', 'image', 'text']);
});

test('the facade\'s words: the channel on YouTube, and a play button that says what it plays', () => {
  assert.equal(videoLabel({ channel: 'UPI' }), 'Video: UPI on YouTube');
  assert.equal(videoLabel({ channel: '' }), 'Video on YouTube');
  assert.equal(playLabel({ title: 'Moose', channel: 'UPI', duration: '2:31' }), 'Play the video: Moose (UPI on YouTube, 2 minutes 31 seconds)');
  assert.equal(playLabel({ title: '', channel: '', duration: null }), 'Play the video (YouTube)');
  assert.equal(durationWords('1:00:01'), '1 hour 1 second');
});

test('before Play, no markup points at YouTube: no i.ytimg.com, no player, no youtube address at all', () => {
  const pic = 'https://cdnph.upi.com/m.jpg';
  const cases = [
    cleanItem(item({ youtube: YT })),
    cleanItem(item({ image: pic, imageCredit: 'Image: UPI', youtube: YT })),
    cleanItem(item({ image: pic, imageCredit: 'Image: UPI' })),
    cleanItem(item({ youtube: { ...YT, title: '"><iframe src="https://www.youtube.com/embed/x">', channel: '<img src=https://i.ytimg.com/x>' } })),
  ];
  for (const cls of ['lead', 'fav', 'card']) {
    for (const x of cases) {
      const { html } = mediaSlot(x, { cls, eager: cls === 'lead' });
      assert.ok(!/i\.ytimg\.com|<iframe|youtube\.com|youtube-nocookie|youtu\.be/i.test(html.replace(/&lt;|&gt;|&quot;/g, '')
        .replace(/aria-label="[^"]*"/g, '').replace(/>[^<]*</g, '><')), `${cls}: ${html}`);
      assert.ok(!/<iframe/i.test(html));
    }
  }
  const video = mediaSlot(cases[0], { cls: 'lead' });
  assert.equal(video.kind, 'video');
  assert.match(video.html, new RegExp(`<img class="vplay__img" src="api/yt-thumb\\?id=${ID}"`));
  assert.match(video.html, /<button type="button" class="vplay vplay--youtube" data-play="dQw4w9WgXcQ" aria-label="Play the video: Moose rides the bus \(UPI on YouTube, 2 minutes 31 seconds\)">/);
  assert.match(video.html, /Video: UPI on YouTube/);
  assert.match(video.html, /class="vplay__dur" aria-hidden="true">2:31</);
  assert.ok(!/vplay__dur/.test(mediaSlot(cleanItem(item({ youtube: { ...YT, duration: null } })), { cls: 'card' }).html), 'no length shown when it is not known');
  const chip = mediaSlot(cases[1], { cls: 'card' });
  assert.equal(chip.kind, 'image');
  assert.match(chip.html, /<button type="button" class="vchip" data-play="dQw4w9WgXcQ"[^>]*>.*Has video<\/button>/s);
  assert.match(chip.html, /aria-label="Has video\. Play the video: Moose rides the bus/, 'the name starts with the visible words');
  assert.match(chip.html, /referrerpolicy="no-referrer"/);
  assert.deepEqual(mediaSlot(cleanItem(item()), { cls: 'lead' }), { kind: 'text', html: '' }, 'text-led: no slot at all');
  assert.ok(!/Picture at the source|ftile/.test(JSON.stringify(cases.map((x) => mediaSlot(x, { cls: 'card' })))));
});

test('the player exists only on request: youtube-nocookie.com, autoplay, a title, nothing else', () => {
  const html = playerHTML(ID, 'Moose rides the bus');
  assert.match(html, /^<iframe class="smedia__player" src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1&amp;rel=0" title="Video: Moose rides the bus"/);
  assert.equal(playerHTML('nope'), '');
  // front.js builds the player only in the Play handler, and names no YouTube address of its own.
  const src = fs.readFileSync(new URL('../js/front.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/ytimg|youtube\.com|youtube-nocookie|youtu\.be/.test(code));
  assert.equal(src.match(/playerHTML\(/g).length, 1);
  assert.ok(!/tileHTML|Picture at the source/.test(src), 'the placeholder tile is gone');
  const css = fs.readFileSync(new URL('../styles/components/front.css', import.meta.url), 'utf8');
  assert.ok(!/\.ftile/.test(css));
  // The brief has no stand-in tile either.
  assert.ok(!/class="tile /.test(fs.readFileSync(new URL('../js/weather.js', import.meta.url), 'utf8')));
});

/* ---------- The console's pick form ---------- */

const FORM = { url: UPI, title: 'Moose rides the bus', outlet: 'UPI', published: '2026-11-13', category: 'animals', rating: '', note: '', video: '', image_url: '' };

test('pick form: the two media fields are optional and checked like the site checks them', () => {
  assert.deepEqual(pickErrors(FORM, { sources: SOURCES }), {});
  assert.deepEqual(pickErrors({ ...FORM, video: `https://youtu.be/${ID}`, image_url: 'https://cdnph.upi.com/m.jpg' }, { sources: SOURCES }), {});
  const e = pickErrors({ ...FORM, video: 'https://vimeo.com/1', image_url: 'https://i.imgur.com/x.jpg' }, { sources: SOURCES });
  assert.deepEqual(Object.keys(e).sort(), ['image_url', 'video']);
  assert.deepEqual(cleanPick({ ...FORM, video: `https://www.youtube.com/shorts/${ID}?feature=share`, image_url: ' https://cdnph.upi.com/m.jpg ' }).video_id, ID);
  assert.equal(cleanPick({ ...FORM, image_url: ' https://cdnph.upi.com/m.jpg ' }).image_url, 'https://cdnph.upi.com/m.jpg');
  assert.equal(cleanPick(FORM).video_id, null);
  assert.equal(cleanPick(FORM).image_url, null);
  assert.equal(pickVideoLink(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(pickBlock({ ...cleanPick(FORM), status: 'draft', video_id: ID, image_url: 'https://i.imgur.com/x.jpg' }, { sources: SOURCES }).startsWith('Edit the pick first'), true);
});

test('pick form previews: Gatecast\'s still for the video, the publisher\'s picture before saving', () => {
  assert.deepEqual(pickMediaView(FORM), { video: null, image: null });
  const m = pickMediaView({ ...FORM, video: `https://youtu.be/${ID}`, image_url: 'https://cdnph.upi.com/m.jpg' }, { sources: SOURCES });
  assert.deepEqual(m.video, { id: ID, thumb: `api/yt-thumb?id=${ID}`, watch: `https://www.youtube.com/watch?v=${ID}` });
  assert.deepEqual(m.image, { url: 'https://cdnph.upi.com/m.jpg', host: 'cdnph.upi.com', site: 'upi.com', outlet: 'UPI' });
  assert.match(pickMediaView({ ...FORM, video: 'nope' }).video.problem, /YouTube/);
  assert.match(pickMediaView({ ...FORM, image_url: 'https://i.imgur.com/x.jpg' }).image.problem, /own site/);
});

test('a save refused for missing media columns is told apart from other refusals', () => {
  assert.equal(mediaColumnsMissing(400, { code: 'PGRST204', message: 'Could not find the \'image_url\' column of \'weird_picks\' in the schema cache' }), true);
  assert.equal(mediaColumnsMissing(400, { code: '42703', message: 'column "video_id" does not exist' }), true);
  assert.equal(mediaColumnsMissing(400, { code: '23514' }), false);
  assert.match(pickSaveError(400, { code: 'PGRST204' }), /pick-media migration/);
});

test('the migration adds the two columns with their checks, is safe to run twice, and logs media edits', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261117150000_pick_media.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists video_id text;/);
  assert.match(sql, /add column if not exists image_url text;/);
  assert.match(sql, /drop constraint if exists weird_picks_video_id_check;[\s\S]*check \(video_id is null or video_id ~ '\^\[A-Za-z0-9_-\]\{11\}\$'\)/);
  assert.match(sql, /drop constraint if exists weird_picks_image_url_check;[\s\S]*image_url ~ '\^https:\/\/\[\^\[:space:\]\]\+\$' and char_length\(image_url\) <= 2048/);
  assert.match(sql, /grant select \(video_id, image_url\) on public\.weird_picks to anon;/);
  assert.match(sql, /create or replace function private\.weird_picks_guard\(\)[\s\S]*new\.video_id, new\.image_url\)[\s\S]*old\.video_id, old\.image_url\)/);
  assert.ok(!/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b/i.test(sql));
});
