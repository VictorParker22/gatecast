// Video from any provider (js/mediaproviders.js, the shared rulebook; lib/videos.js on the server; api/media-thumb.js;
// the facade and player in js/frontmedia.js): every link form per provider, the guardrails, oEmbed checks with a
// stubbed fetch, page extraction per provider, the still endpoint's host allowlist, and the promise that nothing loads
// from any provider before Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as mp from '../js/mediaproviders.js';
import { cleanItem } from '../js/frontmodel.js';
import { mediaSlot, playerFor } from '../js/frontmedia.js';

const require = createRequire(import.meta.url);
const videos = require('../lib/videos.js');
const news = require('../lib/news.js');
const mediaThumbApi = require('../api/media-thumb.js');
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url), 'utf8');

const { parseVideoLink, videoLinkProblem, classifyMediaLink, embedSrc, originalUrl, thumbPath, oembedUrl, readOembed, thumbHostAllowed, creditLine, findPageVideos, cleanVideo, EMBED_HOSTS, PROVIDER_IDS } = mp;

/* ---------- Every link form, per provider ---------- */

const GOOD = {
  youtube: [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://youtu.be/dQw4w9WgXcQ?t=3', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'], ['//www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ],
  vimeo: [
    ['https://vimeo.com/76979871', '76979871'], ['https://www.vimeo.com/76979871', '76979871'], ['vimeo.com/76979871', '76979871'],
    ['https://player.vimeo.com/video/76979871', '76979871'], ['https://player.vimeo.com/video/76979871?autoplay=1', '76979871'],
    ['https://vimeo.com/channels/staffpicks/76979871', '76979871'], ['https://vimeo.com/groups/shortfilms/videos/76979871', '76979871'],
    ['https://vimeo.com/album/1234/video/76979871', '76979871'], ['https://vimeo.com/showcase/1234/video/76979871', '76979871'],
  ],
  facebook: [
    ['https://www.facebook.com/UPI/videos/1234567890/', 'https://www.facebook.com/UPI/videos/1234567890/'],
    ['https://facebook.com/UPI/videos/1234567890', 'https://www.facebook.com/UPI/videos/1234567890/'],
    ['https://m.facebook.com/UPI/videos/a-moose-on-a-bus/1234567890/', 'https://www.facebook.com/UPI/videos/1234567890/'],
    ['https://www.facebook.com/watch/?v=1234567890', 'https://www.facebook.com/watch/?v=1234567890'],
    ['https://www.facebook.com/watch?v=1234567890&ref=sharing', 'https://www.facebook.com/watch/?v=1234567890'],
    ['https://www.facebook.com/video.php?v=1234567890', 'https://www.facebook.com/watch/?v=1234567890'],
    ['https://www.facebook.com/reel/1234567890', 'https://www.facebook.com/reel/1234567890'],
    ['https://fb.watch/abCD12/', 'https://fb.watch/abCD12/'],
    ['https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FUPI%2Fvideos%2F1234567890%2F&show_text=0', 'https://www.facebook.com/UPI/videos/1234567890/'],
  ],
  x: [
    ['https://x.com/upi/status/1600000000000000001', '1600000000000000001'], ['https://twitter.com/upi/status/1600000000000000001/video/1', '1600000000000000001'],
    ['https://mobile.twitter.com/upi/status/1600000000000000001?s=20', '1600000000000000001'], ['https://x.com/i/status/1600000000000000001', '1600000000000000001'],
    ['https://twitter.com/i/web/status/1600000000000000001', '1600000000000000001'], ['https://platform.twitter.com/embed/Tweet.html?id=1600000000000000001', '1600000000000000001'],
  ],
  tiktok: [
    ['https://www.tiktok.com/@odditycentral/video/7301234567890123456', 'odditycentral/7301234567890123456'],
    ['https://tiktok.com/@odd.news_1/video/7301234567890123456?is_from_webapp=1', 'odd.news_1/7301234567890123456'],
    ['https://m.tiktok.com/@odditycentral/video/7301234567890123456', 'odditycentral/7301234567890123456'],
  ],
  instagram: [
    ['https://www.instagram.com/reel/Cx12345AbCd/', 'reel/Cx12345AbCd'], ['https://instagram.com/p/Cx12345AbCd', 'p/Cx12345AbCd'],
    ['https://www.instagram.com/reels/Cx12345AbCd/', 'reel/Cx12345AbCd'], ['https://www.instagram.com/upi/p/Cx12345AbCd/', 'p/Cx12345AbCd'],
    ['https://www.instagram.com/tv/Cx12345AbCd/', 'tv/Cx12345AbCd'],
  ],
};
const BAD = [
  '', 'not a link', 'https://example.com/video/1', 'https://vimeo.com.evil.example/76979871', 'https://evilvimeo.com/76979871',
  'https://vimeo.com/76979871/abcdef1234', 'https://player.vimeo.com/video/76979871?h=abcdef', 'https://vimeo.com/12', 'https://vimeo.com/user123',
  'https://www.facebook.com/UPI', 'https://www.facebook.com/groups/123/videos/1234567890/', 'https://www.facebook.com/stories/123/1234567890/',
  'https://www.facebook.com/sharer/sharer.php?u=https://x', 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fevil.example%2Fv',
  'https://x.com/upi', 'https://x.com/upi/status/abc', 'https://x.com.evil.example/upi/status/1600000000000000001',
  'https://vm.tiktok.com/ZM123abc/', 'https://www.tiktok.com/embed/v2/7301234567890123456', 'https://www.tiktok.com/@odditycentral',
  'https://www.instagram.com/stories/upi/123/', 'https://www.instagram.com/upi/', 'ftp://vimeo.com/76979871',
  'https://user:pw@vimeo.com/76979871', 'https://vimeo.com:8443/76979871', 'javascript:alert(1)', `https://vimeo.com/${'1'.repeat(3000)}`,
];

test('every common link form of each provider gives its provider and reference', () => {
  for (const [provider, list] of Object.entries(GOOD)) {
    for (const [link, ref] of list) assert.deepEqual(parseVideoLink(link), { provider, ref }, link);
  }
  assert.deepEqual(PROVIDER_IDS, ['youtube', 'vimeo', 'facebook', 'x', 'tiktok', 'instagram']);
});

test('anything that is not a public video on a listed provider is refused, with a message that says what to paste', () => {
  for (const link of BAD) assert.equal(parseVideoLink(link), null, link);
  assert.equal(videoLinkProblem(''), null);
  assert.equal(videoLinkProblem('https://vimeo.com/76979871'), null);
  assert.match(videoLinkProblem('https://vimeo.com/76979871/abcdef1234'), /unlisted/);
  assert.match(videoLinkProblem('https://player.vimeo.com/video/76979871?h=abcdef'), /unlisted/);
  assert.match(videoLinkProblem('https://vm.tiktok.com/ZM123abc/'), /share link/);
  assert.match(videoLinkProblem('https://www.tiktok.com/embed/v2/7301234567890123456'), /full address/);
  assert.match(videoLinkProblem('https://www.facebook.com/UPI'), /not a public video/);
  assert.match(videoLinkProblem('dQw4w9WgXcQ'), /whole video link/);
  assert.match(videoLinkProblem('https://example.com/v'), /YouTube, Vimeo, Facebook, X, TikTok or Instagram/);
});

test('the console\'s one Media box: a video goes to Video, any other https link to Picture', () => {
  assert.deepEqual(classifyMediaLink(''), { kind: 'empty' });
  assert.deepEqual(classifyMediaLink('https://vimeo.com/76979871'), { kind: 'video', provider: 'vimeo', ref: '76979871' });
  assert.deepEqual(classifyMediaLink(' https://cdnph.upi.com/svc/moose.jpg '), { kind: 'picture', url: 'https://cdnph.upi.com/svc/moose.jpg' });
  assert.equal(classifyMediaLink('https://www.facebook.com/UPI').kind, 'unknown', 'a provider page that is not a video is not a picture');
  assert.equal(classifyMediaLink('http://cdnph.upi.com/m.jpg').kind, 'unknown', 'pictures are https only');
});

/* ---------- Guardrails: official players only, Gatecast's own stills, a credit and a link to the post ---------- */

const SAMPLE = { youtube: 'dQw4w9WgXcQ', vimeo: '76979871', facebook: 'https://www.facebook.com/UPI/videos/1234567890/', x: '1600000000000000001', tiktok: 'odditycentral/7301234567890123456', instagram: 'reel/Cx12345AbCd' };

test('players only from the official embed hosts, in their privacy-friendly forms; X by widget, Instagram never', () => {
  for (const [provider, ref] of Object.entries(SAMPLE)) {
    const src = embedSrc({ provider, ref });
    if (provider === 'x' || provider === 'instagram') { assert.equal(src, null, provider); continue; }
    assert.ok(EMBED_HOSTS.includes(new URL(src).hostname), `${provider}: ${src}`);
  }
  assert.equal(embedSrc({ provider: 'youtube', ref: SAMPLE.youtube }), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
  assert.equal(embedSrc({ provider: 'vimeo', ref: SAMPLE.vimeo }), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
  assert.equal(embedSrc({ provider: 'facebook', ref: SAMPLE.facebook }), 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FUPI%2Fvideos%2F1234567890%2F&show_text=false&autoplay=true');
  assert.equal(embedSrc({ provider: 'tiktok', ref: SAMPLE.tiktok }), 'https://www.tiktok.com/player/v1/7301234567890123456?autoplay=1&rel=0');
  assert.equal(embedSrc({ provider: 'vimeo', ref: '1"><script>' }), null, 'a bad reference never becomes an address');
  assert.equal(embedSrc({ provider: 'dailymotion', ref: 'x8abc' }), null, 'unknown providers have no player');
});

test('stills are Gatecast\'s own address, or none (Gatecast\'s poster); oEmbed only where the provider is public', () => {
  assert.equal(thumbPath({ provider: 'youtube', ref: SAMPLE.youtube }), 'api/yt-thumb?id=dQw4w9WgXcQ');
  assert.equal(thumbPath({ provider: 'vimeo', ref: SAMPLE.vimeo }), 'api/media-thumb?p=vimeo&id=76979871');
  assert.equal(thumbPath({ provider: 'tiktok', ref: SAMPLE.tiktok }), 'api/media-thumb?p=tiktok&id=odditycentral%2F7301234567890123456');
  for (const p of ['facebook', 'x', 'instagram']) assert.equal(thumbPath({ provider: p, ref: SAMPLE[p] }), null, p);
  assert.match(oembedUrl({ provider: 'vimeo', ref: SAMPLE.vimeo }), /^https:\/\/vimeo\.com\/api\/oembed\.json\?url=https%3A%2F%2Fvimeo\.com%2F76979871$/);
  assert.match(oembedUrl({ provider: 'x', ref: SAMPLE.x }), /^https:\/\/publish\.twitter\.com\/oembed\?url=/);
  assert.match(oembedUrl({ provider: 'tiktok', ref: SAMPLE.tiktok }), /^https:\/\/www\.tiktok\.com\/oembed\?url=https%3A%2F%2Fwww\.tiktok\.com%2F%40odditycentral%2Fvideo%2F7301234567890123456$/);
  assert.equal(oembedUrl({ provider: 'facebook', ref: SAMPLE.facebook }), null, 'Meta\'s oEmbed needs an app token');
  assert.equal(oembedUrl({ provider: 'instagram', ref: SAMPLE.instagram }), null);
  assert.equal(originalUrl({ provider: 'x', ref: SAMPLE.x }), 'https://x.com/i/status/1600000000000000001');
  assert.equal(originalUrl({ provider: 'instagram', ref: SAMPLE.instagram }), 'https://www.instagram.com/reel/Cx12345AbCd/');
  assert.equal(creditLine({ provider: 'vimeo', ref: SAMPLE.vimeo, author: 'Hessdalen Observatory' }), 'Video: Hessdalen Observatory on Vimeo');
  assert.equal(creditLine({ provider: 'facebook', ref: SAMPLE.facebook }), 'Video: UPI on Facebook', 'the page handle stands in for the author');
  assert.equal(creditLine({ provider: 'facebook', ref: 'https://www.facebook.com/watch/?v=1234567890' }), 'Video on Facebook');
  assert.equal(creditLine({ provider: 'tiktok', ref: SAMPLE.tiktok }), 'Video: @odditycentral on TikTok');
});

test('oEmbed answers: removed, private or not embeddable is dropped; stills only from the provider\'s own host', () => {
  for (const p of ['youtube', 'vimeo', 'x', 'tiktok']) for (const status of [400, 401, 403, 404]) assert.deepEqual(readOembed(p, status, null), { state: 'gone' }, `${p} ${status}`);
  assert.deepEqual(readOembed('vimeo', 500, null), { state: 'failed' });
  assert.deepEqual(readOembed('vimeo', 200, 'nope'), { state: 'failed' });
  assert.deepEqual(readOembed('vimeo', 200, { type: 'photo' }), { state: 'gone' });
  assert.deepEqual(readOembed('vimeo', 200, { type: 'video', title: ' Lights\n over  the hills ', author_name: 'Obs', thumbnail_url: 'https://i.vimeocdn.com/video/1-d_640', duration: 192 }),
    { state: 'ok', title: 'Lights over the hills', author: 'Obs', thumbUrl: 'https://i.vimeocdn.com/video/1-d_640', duration: '3:12' });
  assert.equal(readOembed('vimeo', 200, { type: 'video', thumbnail_url: 'https://evil.example/x.jpg' }).thumbUrl, null);
  assert.equal(readOembed('tiktok', 200, { type: 'video', thumbnail_url: 'https://p16-sign-va.tiktokcdn.com/obj/x.jpeg' }).thumbUrl, 'https://p16-sign-va.tiktokcdn.com/obj/x.jpeg');
  assert.equal(readOembed('x', 200, { type: 'rich', author_name: 'UPI' }).author, 'UPI');
  assert.deepEqual(readOembed('x', 200, { type: 'video' }), { state: 'gone' });
  assert.equal(thumbHostAllowed('vimeo', 'https://i.vimeocdn.com/a.jpg'), true);
  for (const bad of ['http://i.vimeocdn.com/a.jpg', 'https://i.vimeocdn.com.evil.example/a.jpg', 'https://user@i.vimeocdn.com/a.jpg', 'https://i.vimeocdn.com:444/a.jpg', 'nope']) assert.equal(thumbHostAllowed('vimeo', bad), false, bad);
  assert.equal(thumbHostAllowed('tiktok', 'https://tiktokcdn.com.evil.example/a.jpg'), false);
  assert.equal(thumbHostAllowed('facebook', 'https://scontent.xx.fbcdn.net/a.jpg'), false, 'no still host for Facebook');
});

/* ---------- Finding videos in article pages ---------- */

test('page extraction finds each provider\'s player, in page order, never in scripts and never Instagram', () => {
  assert.deepEqual(findPageVideos(fixture('vimeo.html')), [{ provider: 'vimeo', ref: '76979871', duration: '3:12' }], 'JSON-LD with its length; the unlisted iframe is refused');
  assert.deepEqual(findPageVideos(fixture('facebook.html')), [
    { provider: 'facebook', ref: 'https://www.facebook.com/OddityCentral/videos/1234567890/', duration: null },
    { provider: 'facebook', ref: 'https://www.facebook.com/OddityCentral/videos/9876543210/', duration: null },
  ], 'fb-video blocks and the plugin iframe; never the share link');
  assert.deepEqual(findPageVideos(fixture('x.html')).map((v) => v.ref), ['1600000000000000002', '1600000000000000003'], 'X posts only when marked as video');
  assert.deepEqual(findPageVideos(fixture('tiktok.html')), [{ provider: 'tiktok', ref: 'odditycentral/7301234567890123456', duration: null }], 'the blockquote names the account; the bare embed and Instagram are skipped');
  assert.deepEqual(findPageVideos(fixture('iframe.html')).map((v) => `${v.provider}:${v.ref}`), ['vimeo:123456', 'youtube:aBcDeFgHi_1', 'youtube:SECONDxxxxx']);
  assert.deepEqual(findPageVideos(fixture('none.html')), []);
  assert.equal(findPageVideos(`<iframe src="https://player.vimeo.com/video/76979871"></iframe>`.repeat(9)).length, 1, 'no repeats');
  assert.ok(!JSON.stringify(findPageVideos(fixture('facebook.html'))).includes('NEVER-SHOW'));
});

test('the server reads every provider\'s players from an outlet\'s article page', async () => {
  const src = { homepage: 'https://www.odditycentral.com/', feed: 'https://www.odditycentral.com/feed' };
  const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];
  const page = (html) => async () => ({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) }, text: async () => html });
  const got = await news.pageMedia('https://www.odditycentral.com/news/spoon-bike.html', src, { fetchImpl: page(fixture('tiktok.html')), lookupImpl });
  assert.deepEqual(got.videos, [{ provider: 'tiktok', ref: 'odditycentral/7301234567890123456', duration: null }]);
  assert.equal(got.video, null, 'the YouTube-only field stays as it was');
});

/* ---------- oEmbed checks on the server (stubbed fetch) ---------- */

function oembedStub(answers) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const host = new URL(url).hostname;
    const a = answers[host];
    if (!a) throw new Error(`unexpected ${url}`);
    if (a instanceof Error) throw a;
    return { ok: a.status === 200, status: a.status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(a.body ?? {}), body: { cancel: async () => {} } };
  };
  return { fetchImpl, asked };
}

test('verifyMedia asks each provider\'s public oEmbed, and drops what is gone or not embeddable', async () => {
  const ok = oembedStub({
    'vimeo.com': { status: 200, body: { type: 'video', title: 'Lights', author_name: 'Obs', thumbnail_url: 'https://i.vimeocdn.com/v/1_640', duration: 75 } },
    'publish.twitter.com': { status: 200, body: { type: 'rich', author_name: 'UPI', html: '<blockquote>…</blockquote>' } },
    'www.tiktok.com': { status: 200, body: { type: 'video', title: 'Parrot', author_name: 'Oddity Central', thumbnail_url: 'https://p16-sign.tiktokcdn-us.com/x.jpeg' } },
  });
  assert.deepEqual(await videos.verifyMedia({ provider: 'vimeo', ref: '76979871' }, { fetchImpl: ok.fetchImpl, cache: false }),
    { provider: 'vimeo', id: '76979871', title: 'Lights', author: 'Obs', duration: '1:15', thumbUrl: 'https://i.vimeocdn.com/v/1_640' });
  assert.equal((await videos.verifyMedia({ provider: 'x', ref: SAMPLE.x }, { fetchImpl: ok.fetchImpl, cache: false })).author, 'UPI');
  assert.equal((await videos.verifyMedia({ provider: 'tiktok', ref: SAMPLE.tiktok }, { fetchImpl: ok.fetchImpl, cache: false })).title, 'Parrot');
  assert.deepEqual(ok.asked.map((u) => new URL(u).hostname), ['vimeo.com', 'publish.twitter.com', 'www.tiktok.com']);

  const gone = oembedStub({ 'vimeo.com': { status: 403 }, 'www.tiktok.com': { status: 404 }, 'publish.twitter.com': { status: 404 } });
  assert.equal(await videos.verifyMedia({ provider: 'vimeo', ref: '76979871' }, { fetchImpl: gone.fetchImpl, cache: false }), null, 'Vimeo 403: private or not embeddable');
  assert.equal(await videos.verifyMedia({ provider: 'tiktok', ref: SAMPLE.tiktok }, { fetchImpl: gone.fetchImpl, cache: false }), null);
  assert.equal(await videos.verifyMedia({ provider: 'x', ref: SAMPLE.x }, { fetchImpl: gone.fetchImpl, cache: false }), null);

  // Facebook and Instagram cannot be asked without an app token: served as given, without a request.
  const none = oembedStub({});
  assert.deepEqual(await videos.verifyMedia({ provider: 'facebook', ref: SAMPLE.facebook }, { fetchImpl: none.fetchImpl, cache: false }),
    { provider: 'facebook', id: SAMPLE.facebook, title: '', author: 'UPI', duration: null, thumbUrl: null });
  assert.equal((await videos.verifyMedia({ provider: 'instagram', ref: SAMPLE.instagram }, { fetchImpl: none.fetchImpl, cache: false })).provider, 'instagram');
  assert.equal(none.asked.length, 0);
  assert.equal(await videos.verifyMedia({ provider: 'vimeo', ref: 'nope' }, { fetchImpl: none.fetchImpl }), null);
});

test('a failed check keeps a video verified before; firstPlayable serves the first embeddable of a page\'s videos', async () => {
  videos.clearMediaCache();
  const t0 = Date.UTC(2026, 10, 17, 12);
  const good = oembedStub({ 'vimeo.com': { status: 200, body: { type: 'video', title: 'Lights', author_name: 'Obs' } } });
  assert.ok(await videos.verifyMedia({ provider: 'vimeo', ref: '11111111' }, { fetchImpl: good.fetchImpl, now: t0 }));
  const down = oembedStub({ 'vimeo.com': new Error('reset') });
  const later = t0 + 7 * 3600e3;
  assert.equal((await videos.verifyMedia({ provider: 'vimeo', ref: '11111111' }, { fetchImpl: down.fetchImpl, now: later })).title, 'Lights');
  assert.equal(down.asked.length, 1);

  const mixed = oembedStub({ 'vimeo.com': { status: 403 }, 'www.youtube.com': { status: 200, body: { type: 'video', title: 'Bear', author_name: 'UPI' } } });
  const first = await videos.firstPlayable([{ provider: 'vimeo', ref: '22222222' }, { provider: 'youtube', ref: 'aBcDeFgHi_1' }], { fetchImpl: mixed.fetchImpl, cache: false });
  assert.equal(first.provider, 'youtube');
  assert.equal(first.author, 'UPI');
  videos.clearMediaCache();
});

test('the server and the browser share one rulebook (js/mediaproviders.js), loaded by lib/videos.js', async () => {
  assert.equal(await videos.providers(), mp);
});

/* ---------- api/media-thumb: only the provider's own image host ---------- */

test('media-thumb fetches only the still oEmbed names, from that provider\'s own image host', async () => {
  const jpeg = Buffer.alloc(2000, 7);
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push({ url, redirect: init?.redirect });
    const host = new URL(url).hostname;
    if (host === 'vimeo.com') return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ type: 'video', title: 'T', thumbnail_url: 'https://i.vimeocdn.com/video/1-d_640' }) };
    if (host === 'www.tiktok.com') return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ type: 'video', thumbnail_url: 'https://evil.example/steal.jpg' }) };
    if (host === 'i.vimeocdn.com') return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => jpeg };
    throw new Error(`unexpected ${url}`);
  };
  const ok = await videos.mediaThumb('vimeo', '76979871', { fetchImpl, cache: false });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'image/jpeg');
  assert.equal(ok.headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(ok.body.length, 2000);
  assert.deepEqual(fetched.map((f) => new URL(f.url).hostname), ['vimeo.com', 'i.vimeocdn.com']);
  assert.equal(fetched[1].redirect, 'manual', 'no redirect is followed to another host');

  fetched.length = 0;
  const evil = await videos.mediaThumb('tiktok', SAMPLE.tiktok, { fetchImpl, cache: false });
  assert.equal(evil.status, 404, 'a still on any other host is never fetched');
  assert.deepEqual(fetched.map((f) => new URL(f.url).hostname), ['www.tiktok.com']);

  fetched.length = 0;
  for (const [p, ref, status] of [['facebook', SAMPLE.facebook, 404], ['x', SAMPLE.x, 404], ['instagram', SAMPLE.instagram, 404], ['vimeo', '../../etc', 400], ['dailymotion', 'x8', 400], [null, null, 400]]) {
    assert.equal((await videos.mediaThumb(p, ref, { fetchImpl, cache: false })).status, status, `${p}`);
  }
  assert.equal(fetched.length, 0, 'nothing is fetched for a provider without a still or a bad reference');

  // The Vercel function: GET and HEAD only.
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
  await mediaThumbApi({ method: 'POST', url: '/api/media-thumb?p=vimeo&id=76979871' }, res);
  assert.equal(res.code, 405);
  const res2 = { ...res, headers: {} };
  await mediaThumbApi({ method: 'GET', url: '/api/media-thumb?p=vimeo&id=nope' }, res2);
  assert.equal(res2.code, 400);
});

/* ---------- The page: nothing from any provider before Play ---------- */

const story = (video, extra = {}) => cleanItem({
  id: 'a1b2c3d4e5f6', title: 'Moose rides the bus', url: 'https://www.upi.com/Odd_News/moose', outlet: 'UPI', published: '2026-11-16T12:00:00Z',
  category: 'animals', media: { video }, ...extra,
});
const VIDEOS = Object.entries(SAMPLE).map(([provider, id]) => ({ provider, id, title: 'A "title" <b>', author: 'UPI', duration: provider === 'vimeo' ? '3:12' : null }));

test('before Play no markup asks any provider for anything: no iframe, no script, only Gatecast\'s own still', () => {
  const PROVIDER_HOSTS = /youtube|ytimg|youtu\.be|vimeo|vimeocdn|facebook|fbcdn|fb\.watch|twitter|twimg|x\.com|tiktok|instagram|cdninstagram/i;
  for (const v of VIDEOS) {
    for (const extra of [{}, { image: 'https://cdnph.upi.com/m.jpg' }]) {
      const x = story(v, extra);
      assert.equal(x.player.provider, v.provider);
      for (const cls of ['lead', 'fav', 'card', 'stv']) {
        const { html } = mediaSlot(x, { cls, eager: cls === 'lead', href: '?story=a1b2c3d4e5f6' });
        assert.ok(!/<iframe|<script|<video|<embed|<object/i.test(html), `${v.provider} ${cls}: no player before Play`);
        for (const m of html.matchAll(/\ssrc="([^"]*)"/g)) {
          const src = m[1].replace(/&amp;/g, '&');
          assert.ok(src.startsWith('api/') || src === 'https://cdnph.upi.com/m.jpg', `${v.provider} ${cls}: src ${src}`);
          const host = new URL(src, 'https://thegatecast.com/').hostname;
          assert.ok(!PROVIDER_HOSTS.test(host), `${v.provider} ${cls}: ${src}`);
        }
        assert.ok(!/srcset|poster="/.test(html));
      }
    }
  }
});

test('the facade per provider: a still or Gatecast\'s poster, a play button, the credit; Instagram is a link out', () => {
  const vimeo = mediaSlot(story(VIDEOS[1]), { cls: 'card' }).html;
  assert.match(vimeo, /<img class="vplay__img" src="api\/media-thumb\?p=vimeo&amp;id=76979871"/);
  assert.match(vimeo, /<button type="button" class="vplay vplay--vimeo" data-play="76979871" aria-label="Play the video: A &quot;title&quot; &lt;b&gt; \(UPI on Vimeo, 3 minutes 12 seconds\)">/);
  assert.match(vimeo, /Video: UPI on Vimeo/);
  const fb = mediaSlot(story(VIDEOS[2]), { cls: 'card' }).html;
  assert.match(fb, /vplay__poster vplay__poster--facebook/);
  assert.match(fb, /<span class="vplay__brand">Facebook<\/span>/);
  assert.ok(!/<img/.test(fb), 'no still for Facebook');
  const ig = mediaSlot(story(VIDEOS[5]), { cls: 'card' }).html;
  assert.match(ig, /<a class="vplay vplay--link" href="https:\/\/www\.instagram\.com\/reel\/Cx12345AbCd\/" rel="noopener"/);
  assert.ok(!/data-play/.test(ig), 'Instagram is never played here');
  const chip = mediaSlot(story(VIDEOS[4], { image: 'https://cdnph.upi.com/m.jpg' }), { cls: 'card' }).html;
  assert.match(chip, /<button type="button" class="vchip" data-play="odditycentral\/7301234567890123456"/);
  const tiktok = mediaSlot(story(VIDEOS[4]), { cls: 'stv' }).html;
  assert.match(tiktok, /data-provider="tiktok"/, 'a tall frame for a vertical video');
});

test('after Play: each provider\'s own player from the official hosts only, with a title; X by its widget', () => {
  for (const v of VIDEOS) {
    const html = playerFor(cleanVideo(v));
    if (v.provider === 'instagram') { assert.equal(html, ''); continue; }
    if (v.provider === 'x') {
      assert.match(html, /^<div class="smedia__x"><blockquote class="twitter-tweet" data-dnt="true"[^>]*><a href="https:\/\/twitter\.com\/i\/status\/1600000000000000001">/);
      assert.ok(!/<script|<iframe/.test(html), 'the widget script is added by js/front.js after Play');
      continue;
    }
    const src = /<iframe class="smedia__player smedia__player--[a-z]+" src="([^"]+)" title="Video: A &quot;title&quot; &lt;b&gt;"/.exec(html);
    assert.ok(src, `${v.provider}: ${html}`);
    assert.ok(EMBED_HOSTS.includes(new URL(src[1].replace(/&amp;/g, '&')).hostname));
  }
  assert.match(playerFor(cleanVideo(VIDEOS[2])), /<a class="smedia__orig" href="https:\/\/www\.facebook\.com\/UPI\/videos\/1234567890\/" rel="noopener">Not playing\? Open it on Facebook<\/a>/);
  assert.equal(playerFor({ provider: 'vimeo', ref: 'bad' }), '');
  assert.equal(playerFor({ id: 'dQw4w9WgXcQ', title: 'T' }).includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'), true, 'the YouTube shape of older answers still plays');
});

test('cleanVideo rebuilds every address from the provider and id, whatever the server sent', () => {
  const v = cleanVideo({ provider: 'vimeo', id: '76979871', title: 'T', author: 'A', duration: '3:12', thumb: 'https://evil.example/x.jpg', url: 'https://evil.example/' });
  assert.equal(v.thumb, 'api/media-thumb?p=vimeo&id=76979871');
  assert.equal(v.url, 'https://vimeo.com/76979871');
  assert.equal(v.channel, 'A');
  assert.equal(cleanVideo({ provider: 'vimeo', id: '1' }), null);
  assert.equal(cleanVideo({ provider: 'dailymotion', id: 'x8abc' }), null);
  assert.equal(cleanVideo({ provider: 'youtube', id: 'dQw4w9WgXcQ', duration: '10 minutes' }).duration, null);
  // Older answers with only the youtube field still get a player.
  assert.equal(cleanItem({ id: 'z', title: 'T', url: 'https://www.upi.com/x', outlet: 'UPI', published: '2026-11-16T12:00:00Z', youtube: { id: 'dQw4w9WgXcQ', title: 'T', channel: 'UPI' } }).player.provider, 'youtube');
});
