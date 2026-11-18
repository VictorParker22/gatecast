// Story mode, "Gatecast TV": the view model (js/tvmodel.js: share addresses, channels, what the screen shows for a
// pick and for a feed story, "Next on Gatecast"), and how the front page is wired to it (js/front.js, js/tvscreen.js,
// styles/components/tv.css): story links stay on Gatecast, the explicit read-more links go to the original, the
// dialog is a real modal with Escape, Back and focus return, and reduced motion is honoured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  storyHref, shareUrl, storyFromUrl, urlWithStory, isStoryId, channelOrder, channelOf, channelLabel, relatedStories, tvView, STORY_PARAM, SUMMARY_LABEL,
} from '../js/tvmodel.js';
import { cleanItem } from '../js/frontmodel.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const item = (id, over = {}) => cleanItem({
  id, title: `Story ${id}`, url: `https://www.upi.com/Odd_News/${id}`, outlet: 'UPI', published: '2026-11-16T12:00:00Z', category: 'animals', ...over,
});

/* ---------- Shareable addresses ---------- */

test('each story has its own address, /?story=<id>, read back from any form of the address', () => {
  assert.equal(STORY_PARAM, 'story');
  assert.equal(storyHref('a1b2c3d4e5f6'), '?story=a1b2c3d4e5f6');
  assert.equal(shareUrl('a1b2c3d4e5f6'), 'https://thegatecast.com/?story=a1b2c3d4e5f6');
  assert.equal(shareUrl('a1b2c3d4e5f6', 'http://localhost:4173/?r=1#x'), 'http://localhost:4173/?story=a1b2c3d4e5f6');
  for (const href of ['https://thegatecast.com/?story=a1b2c3d4e5f6', '/?story=a1b2c3d4e5f6', '?story=a1b2c3d4e5f6', '?x=1&story=a1b2c3d4e5f6#top']) {
    assert.equal(storyFromUrl(href), 'a1b2c3d4e5f6', href);
  }
  for (const bad of ['https://thegatecast.com/', '?story=', '?story=../etc', '?story=<script>', `?story=${'a'.repeat(65)}`, null]) assert.equal(storyFromUrl(bad), null, String(bad));
  assert.equal(urlWithStory('https://thegatecast.com/?r=1#news', 'abc123'), 'https://thegatecast.com/?r=1&story=abc123#news');
  assert.equal(urlWithStory('https://thegatecast.com/?story=abc123&r=1', null), 'https://thegatecast.com/?r=1');
  assert.equal(storyHref('no spaces'), null);
  assert.equal(isStoryId('a1b2c3d4e5f6'), true);
});

/* ---------- Channels ---------- */

test('channels follow the page: the lead, the favourites row, then Also odd and the grid, each story once', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(id));
  const order = channelOrder(items, [items[4].url, items[2].url]);
  assert.deepEqual(order.map((x) => x.id), ['a', 'e', 'c', 'b', 'd', 'f']);
  assert.deepEqual(channelOrder([], []), []);
  const at = channelOf(order, 'c');
  assert.deepEqual([at.index, at.number, at.total, at.prev.id, at.next.id], [2, 3, 6, 'e', 'b']);
  assert.equal(channelOf(order, 'a').prev.id, 'f', 'Prev wraps round from the first channel');
  assert.equal(channelOf(order, 'f').next.id, 'a', 'Next wraps round from the last');
  assert.equal(channelOf(order, 'zz'), null);
  const one = channelOf([items[0]], 'a');
  assert.equal(one.prev, null);
  assert.equal(one.next, null);
  assert.equal(channelLabel(3), 'CH 03');
  assert.equal(channelLabel(30), 'CH 30');
});

test('Next on Gatecast: the same category first, then the rest, in channel order after the current story', () => {
  const items = [item('a'), item('b', { category: 'laws' }), item('c'), item('d', { category: 'laws' }), item('e')];
  assert.deepEqual(relatedStories(items, 'c', 4).map((x) => x.id), ['e', 'a', 'd', 'b']);
  assert.deepEqual(relatedStories(items, 'b', 2).map((x) => x.id), ['d', 'c']);
  assert.deepEqual(relatedStories(items, 'zz'), []);
});

/* ---------- What the screen shows ---------- */

test('a pick shows its hook and "In our words"; a feed story shows the headline, its media and the link only', () => {
  const pick = item('p', { pick: true, note: 'The driver kept to the timetable.', summary: 'A moose rode a bus. Nobody was hurt.', image: 'https://cdnph.upi.com/m.jpg', media: { video: { provider: 'vimeo', id: '76979871', author: 'Obs' } } });
  const v = tvView(pick, { locale: 'en-GB', timeZone: 'UTC' });
  assert.equal(v.hook, 'The driver kept to the timetable.');
  assert.equal(v.summary, 'A moose rode a bus. Nobody was hurt.');
  assert.equal(v.summaryLabel, SUMMARY_LABEL);
  assert.equal(SUMMARY_LABEL, 'In our words');
  assert.equal(v.media, 'image');
  assert.deepEqual(v.credits, ['Picture: UPI', 'Video: Obs on Vimeo']);
  assert.deepEqual(v.readMore, { href: 'https://www.upi.com/Odd_News/p', label: 'Read the full story at UPI' });
  assert.equal(v.only, '');
  assert.equal(v.kicker, 'STRANGE ANIMALS');
  assert.equal(v.date, 'MON 16 NOV 2026');

  // A feed story never has a hook or a summary, even if the answer carried one.
  const feed = item('f', { pick: false, note: 'sneaked in', summary: 'Should never show. Not ours.' });
  const f = tvView(feed);
  assert.equal(f.hook, null);
  assert.equal(f.summary, null);
  assert.equal(f.media, 'text');
  assert.deepEqual(f.credits, []);
  assert.equal(f.only, 'We show the headline here. The full story is at UPI.');
  assert.equal(tvView(item('g', { youtube: { id: 'dQw4w9WgXcQ', channel: 'UPI' } })).only, 'We show the headline and the video here. The full story is at UPI.');
  // A pick without a summary says the same plainly.
  assert.match(tvView(item('h', { pick: true, note: 'Hook.' })).only, /^We show the headline here/);
  assert.equal(tvView(null), null);
});

/* ---------- The front page's wiring ---------- */

test('story links open story mode at the story\'s Gatecast address; only explicit read-more links go out, and count', () => {
  const src = code('js/front.js');
  // The ticker, the lead's headline and picture, favourites, Also odd, the grid's headlines and pictures, the weather
  // box's weird-weather line, and Next on Gatecast all use the story's own address.
  assert.match(src, /const storyAttrs = \(x\) => `href="\$\{esc\(storyHref\(x\.id\) \|\| x\.url\)\}"/);
  for (const where of ['<li>${ICON.star}<a ${storyAttrs(x)}', '<a class="lead__link" ${storyAttrs(x)}>', '<a class="fav__link" ${storyAttrs(x)}>', '<a class="stretch" ${storyAttrs(x)}>', '<h3 class="card__h"><a ${storyAttrs(x)}>', '<a class="stv-next__item" ${storyAttrs(r)}>']) {
    assert.ok(src.includes(where), where);
  }
  assert.ok(!/<a (class="[^"]*" )?href="\$\{esc\(x\.url\)\}" rel="noopener">\$\{esc\(x\.title\)\}/.test(src), 'no headline links straight out');
  // The lead's "Read it at", the cards' "Read at" and story mode's big button go to the original, with rel="noopener".
  assert.match(src, /<a class="bev lead__go" href="\$\{esc\(x\.url\)\}" rel="noopener">Read it at/);
  assert.match(src, /<a class="bev bev--sun stv-go__btn" href="\$\{esc\(v\.readMore\.href\)\}" rel="noopener">/);
  // Clicks are counted only when a reader follows a link to the original, story mode's included.
  assert.match(src, /const CLICK_AREAS = '#ticker, #lead, #favs, #also, #grid, #stv';/);
  assert.match(src, /community\.countClick\(url\)/);
  // A plain click opens story mode; modifier and middle clicks are left to the browser.
  assert.match(src, /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;/);
  // A shared address opens the story once the stories are in, and says so when the story has left the page.
  assert.match(src, /openFromAddress\(\);/);
  assert.match(read('index.html'), /<p class="front__gone" id="front-gone" role="status" hidden><\/p>/);
  // The Weird-o-meter in story mode is the same code path as the lead's.
  assert.match(src, /meterHTML\(x, 'meter'\)/);
  assert.match(src, /meterHTML\(x, 'stv-meter'\)/);
  assert.equal((src.match(/rateStory\(/g) || []).length, 1);
});

test('story mode is a real modal dialog: labelled, Escape and Back close it, focus goes in and comes back', () => {
  const src = code('js/tvscreen.js');
  assert.match(src, /document\.createElement\('dialog'\)/);
  assert.match(src, /setAttribute\('aria-labelledby', 'stv-h'\)/);
  assert.match(src, /dlg\.showModal\(\)/);
  assert.match(src, /addEventListener\('cancel', \(e\) => \{ e\.preventDefault\(\); close\(\); \}\)/);
  assert.match(src, /history\.pushState\(\{ stv: id \}/);
  assert.match(src, /history\.replaceState/);
  assert.match(src, /addEventListener\('popstate'/);
  assert.match(src, /history\.back\(\)/);
  assert.match(src, /querySelector\('#stv-h'\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /back\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /e\.key === 'ArrowLeft'/);
  assert.match(src, /e\.key === 'ArrowRight'/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /content\.innerHTML = ''; \/\/ stops any player/);
  // The story's headline is the dialog's label, focusable by script only.
  assert.match(code('js/front.js'), /<h2 class="stv-h" id="stv-h" tabindex="-1">/);
});

test('the look: part of the front-page bundle, 44px controls, the page stays put, reduced motion and forced colours', () => {
  assert.match(read('styles/main-front.css'), /@import "\.\/components\/tv\.css";/);
  const css = read('styles/components/tv.css');
  assert.match(css, /html:has\(dialog\.stv\[open\]\) \{ overflow: hidden; \}/);
  assert.match(css, /\.stv__btn \{[^}]*min-height: var\(--spacing-tap\);[^}]*min-width: var\(--spacing-tap\);/);
  assert.match(css, /\.stv__knob \{[^}]*min-height: 3\.25rem;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.stv__fx \{ display: none; \}/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/@supports not[\s\S]*?\n {2}\}\n\}/, '')), 'colours are tokens (hex only in the light-dark() fallback)');
  assert.ok(!/MTV|music television/i.test(css + read('js/tvscreen.js')), 'original design: no network names');
  const main = read('styles/main.css');
  for (const t of ['--color-tv-stage:', '--text-tv-head:', '--text-tv-card:', '--text-tv-words:']) assert.ok(main.includes(t), t);
});

test('data.js passes the summary and any provider\'s video through to the page', () => {
  const src = read('js/data.js');
  assert.match(src, /summary: pick \? text\(x\.summary\) : null/);
  assert.match(src, /media: \{ video: x\.media\?\.video/);
  const x = cleanItem({ id: 'p', title: 'T', url: 'https://www.upi.com/p', outlet: 'UPI', published: '2026-11-16T12:00:00Z', pick: true, summary: '  Two  sentences. Here.  ' });
  assert.equal(x.summary, 'Two sentences. Here.');
  assert.equal(cleanItem({ id: 'f', title: 'T', url: 'https://www.upi.com/f', outlet: 'UPI', published: '2026-11-16T12:00:00Z', summary: 'Not a pick.' }).summary, null);
});
