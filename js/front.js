// The weird-news half of the front page (index.html): the edition strip, the section tabs, the headline ticker,
// the lead with its Weird-o-meter, favourites, "Also odd", the reading streak, the "Believe it or not" grid, the
// weird-weather line in the weather box, and the guestbook. Stories come from /api/weird via data.js loadWeird();
// votes, favourites, tips and anonymous click counts go through js/community.js. Pure rules live in js/frontmodel.js;
// a story's picture or video slot is js/frontmedia.js. A story with neither gets the text-led layout: no frame at all.
// Videos are a click-to-play facade: its still comes from Gatecast (api/yt-thumb, api/media-thumb) or is Gatecast's
// own poster, and the provider's player (youtube-nocookie.com, Vimeo, Facebook, X, TikTok; js/mediaproviders.js) is
// inserted only when the reader presses Play. The weather half is js/weather.js.
// Story mode (owner request, 17 Nov 2026): a story's headline, card, favourite, Also-odd row, ticker item or the
// weather box's weird-weather line opens it on "Gatecast TV" (js/tvscreen.js, pure rules in js/tvmodel.js) instead of
// leaving the site. Those links point at the story's own Gatecast address (?story=<id>), so a modifier-click, a
// middle-click or a shared link opens the same story. The explicit "Read it at <outlet>" links still go straight to
// the original, and so does story mode's "Read the full story at <outlet>"; only those count a click.
import * as data from './data.js';
import {
  cleanWeird, splitFront, gridFor, favourites, favCaption, favVotes, storyFor, PAGE, CATEGORIES, catLabel, stickerTone, metaLine, shortMeta, ratingLabel, videoLabel,
  monogram, editionLine, starPolygon, tickerSeconds, nextStreak, streakDigits, meterAngle, meterNote, METER_WORDS, tipUrl,
} from './frontmodel.js';
import { mediaSlot, playerFor } from './frontmedia.js';
import { X_WIDGETS } from './mediaproviders.js';
import { storyHref, channelOrder, channelLabel, relatedStories, tvView, urlWithStory } from './tvmodel.js';
import { createStoryTV } from './tvscreen.js';
import { esc } from './ui.js';
import { $, store } from './shell.js';

const locale = navigator.language || 'en-GB';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ICON = {
  out: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></svg>',
  tv: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l2.9 7.6L23 9.3l-6.2 5.3L18.8 23 12 18.6 5.2 23l2-8.4L1 9.3l8.1-.7z"/></svg>',
};

/* ---------- The edition strip ---------- */

let placeName = (() => { const p = store.get('gatecast:place', null); return p && p.name !== 'Your location' ? p.name : ''; })();
function renderEdition() {
  const e = editionLine(placeName, new Date(), locale);
  $('#edition-long').textContent = e.long;
  $('#edition-short').textContent = e.short;
}
document.addEventListener('gatecast:place', (ev) => { placeName = ev.detail?.name || ''; renderEdition(); });
renderEdition();
$('.masthead__burst-ink').style.setProperty('--burst', starPolygon(16, 38));

/* ---------- The reader's own streak (this device only) ---------- */

(function streak() {
  const s = nextStreak(store.get('gatecast:streak', null));
  store.set('gatecast:streak', s);
  $('#streak-digits').innerHTML = streakDigits(s.days).map((d) => `<span>${d}</span>`).join('');
  $('#streak-line').textContent = `You have read the front page ${s.days === 1 ? 'today' : `${s.days} days in a row`}. Kept on this device only, like an old hit counter that only counts you.`;
})();

/* ---------- Stories ---------- */

// favs: reader favourites from the database (10+ votes this week); ids: each story's id, to match them; urls: the
// stories' addresses, the only links whose clicks are counted.
const view = { items: [], counts: {}, cat: 'all', shown: PAGE, skip: [], ratings: {}, favs: [], ids: {}, urls: new Set() };
let community = null;
const communityReady = import('./community.js').then((m) => { community = m; return m; }).catch(() => null);

async function loadStories() {
  // data.js loadWeird() is the contract; fall back to the endpoint itself if this copy of data.js predates it.
  let json = null;
  try {
    json = typeof data.loadWeird === 'function' ? await data.loadWeird({ limit: 30 })
      : await fetch('api/weird?limit=30').then((r) => (r.ok ? r.json() : null));
  } catch {}
  const w = cleanWeird(json);
  view.items = w.items; view.counts = w.counts; view.urls = new Set(w.items.map((x) => x.url));
  render();
  openFromAddress();
  // The lead's meter and the reader-ranked favourites need the readers' votes; the page does not wait for them.
  // Until they arrive the favourites row is the editor's.
  const m = await communityReady;
  if (!m || !view.items.length) return;
  const [ratings, favs, ids] = await Promise.all([
    m.loadRatings(view.items.map((x) => x.url)).catch(() => ({})),
    m.loadFavourites().catch(() => []),
    Promise.all(view.items.map(async (x) => [x.url, await m.storyId(x.url)])).then(Object.fromEntries).catch(() => ({})),
  ]);
  view.ratings = ratings || {}; view.favs = favs || []; view.ids = ids || {};
  renderFavs();
  renderGrid(); renderAlso();
  renderMeter();
}

/* ---------- Story mode: Gatecast TV ---------- */

// The channels: every story in the order the page shows it (lead, favourites, then Also odd and the grid).
const tvOrder = () => channelOrder(view.items, view.skip);

// One story as a zine spread: the hero (category sticker, slab headline, the outlet and date as a lower third), the
// picture or video big in a glass frame, the hook as a pull quote, the editor's summary ("In our words") in large
// reading type, the read-more button, credits, the Weird-o-meter, and "Next on Gatecast".
function tvHTML(x, c) {
  const v = tvView(x, { locale, failed: failedPics });
  const slot = mediaSlot(x, { cls: 'stv', w: 1200, h: 900, eager: true, failed: failedPics, link: false });
  const rel = relatedStories(tvOrder(), x.id, 4);
  const tone = stickerTone(x.category);
  const words = v.summary
    ? `<section class="stv-words stv-block" style="--i:3" aria-labelledby="stv-words-h">
        <h3 class="stv-words__h" id="stv-words-h"><span>${esc(v.summaryLabel)}</span></h3>
        <p class="stv-words__p">${esc(v.summary)}</p>
        <p class="stv-words__by">Written by Gatecast’s editor from ${esc(x.outlet)}’s report. Their full story is one click away.</p>
      </section>`
    : `<p class="stv-only stv-block" style="--i:3">${esc(v.only)}</p>`;
  const credits = [...v.credits, `Headline: ${x.outlet}`];
  const orig = v.video && v.video.url ? `<a class="stv-credits__orig" href="${esc(v.video.url)}" rel="noopener">Original post on ${esc(v.video.name)}</a>` : '';
  return `<article class="stv-story stv-story--${v.media} stv-tone--${tone}${v.hook ? ' has-hook' : ''}${v.summary ? ' has-words' : ''}">
    <header class="stv-hero stv-block" style="--i:0">
      <p class="stv-hero__tags"><span class="sticker sticker--${tone} stv-hero__cat">${esc(v.kicker)}</span>${v.pick ? '<span class="stv-hero__pick">Editor’s pick</span>' : ''}<span class="stv-hero__ch">${esc(channelLabel(c.number))}</span></p>
      <h2 class="stv-h" id="stv-h" tabindex="-1">${esc(v.title)}</h2>
      <p class="stv-lower"><span class="stv-lower__out">${esc(x.outlet)}</span><span class="stv-lower__date">${esc(v.date)}</span></p>
    </header>
    <div class="stv-body">
      ${slot.html ? `<figure class="stv-media stv-block" style="--i:1"><div class="stv-media__glass">${slot.html}</div></figure>` : ''}
      <div class="stv-side">
        ${v.hook ? `<blockquote class="stv-hook stv-block" style="--i:2"><p>${esc(v.hook)}</p></blockquote>` : ''}
        ${words}
        <div class="stv-go stv-block" style="--i:4">
          <a class="bev bev--sun stv-go__btn" href="${esc(v.readMore.href)}" rel="noopener">${esc(v.readMore.label)}${ICON.out}</a>
          <p class="stv-credits">${credits.map((t) => `<span>${esc(t)}</span>`).join('')}${orig}</p>
        </div>
        <div class="stv-block" style="--i:5">${meterHTML(x, 'stv-meter')}</div>
      </div>
    </div>
    ${rel.length ? `<section class="stv-next stv-block" style="--i:6" aria-labelledby="stv-next-h">
      <h3 class="stv-next__h" id="stv-next-h">Next on Gatecast</h3>
      <ol class="stv-next__list">${rel.map((r) => {
        const n = tvOrder().findIndex((o) => o.id === r.id) + 1;
        return `<li><a class="stv-next__item" ${storyAttrs(r)}><span class="stv-next__ch">${esc(channelLabel(n))}</span><span class="stv-next__cat sticker sticker--${stickerTone(r.category)}">${esc(catLabel(r.category))}</span><span class="stv-next__t">${esc(r.title)}</span><span class="stv-next__src">${esc(shortMeta(r, locale))}</span></a></li>`;
      }).join('')}</ol>
    </section>` : ''}
  </article>`;
}

const tv = createStoryTV({
  order: tvOrder,
  render: tvHTML,
  afterRender: (x) => paintMeters(x.url),
  ident: (x, c) => ({ channel: channelLabel(c.number), title: catLabel(x.category).toUpperCase(), tone: stickerTone(x.category) }),
});

// Where focus goes back to: the link that opened the story, or (for the ticker's hidden copy, a picture's
// out-of-order link) the story's main link in the same place.
function opener(a) {
  if (!a.closest('[aria-hidden="true"]') && a.getAttribute('tabindex') !== '-1') return a;
  const id = a.dataset.storyId;
  const scope = a.closest('#ticker') ? $('#ticker-track .ticker__list:not([aria-hidden])') : a.closest('li, article') || document;
  return scope?.querySelector(`a[data-story-id="${CSS.escape(id)}"]:not([tabindex="-1"])`) || a;
}

// A plain click on a story link opens story mode (or tunes to it when story mode is already on). Modifier clicks and
// middle clicks are left alone: the browser opens the story's Gatecast address, which opens it there.
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[data-story-id]') : null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const id = a.dataset.storyId;
  if (!tvOrder().some((x) => x.id === id)) return; // not on the page: let the link load it
  e.preventDefault();
  if (tv.isOpen()) tv.go(id);
  else tv.open(id, { from: opener(a) });
});

// A shared link (?story=<id>): open that story once the stories are in. If it has left the front page, say so and
// tidy the address.
function openFromAddress() {
  const r = tv.syncFromUrl();
  if (r !== false) return;
  history.replaceState(null, '', urlWithStory(location.href, null));
  const note = $('#front-gone');
  if (note) { note.hidden = false; note.textContent = 'That story has left the front page. Here is today’s weird news instead.'; }
}

function render() {
  const has = view.items.length > 0;
  $('#ticker').hidden = !has;
  $('#believe').hidden = !has;
  $('#front-empty').hidden = has;
  $('#front-empty').textContent = 'The odd news desk is quiet right now: no stories came back from our sources. Try again in a little while.';
  if (!has) { $('#front-top').hidden = true; return; }
  renderTicker(); renderTabs(); renderLead(); renderFavs(); renderAlso(); renderFilters(); renderGrid(); renderWxWeird();
}

const stickerHTML = (cat, cls = 'sticker') => `<span class="${cls} ${cls}--${stickerTone(cat)}">${esc(catLabel(cat))}</span>`;
// A link that opens a story in story mode: the story's own Gatecast address, handled by the click listener below.
const storyAttrs = (x) => `href="${esc(storyHref(x.id) || x.url)}"${storyHref(x.id) ? ` data-story-id="${esc(x.id)}"` : ' rel="noopener"'}`;
// "VIDEO AT SOURCE": the outlet itself calls the story a video, and the page has no player for it.
const videoTag = (x) => (x.video && !x.player ? '<span class="vtag">VIDEO AT SOURCE</span>' : '');

/* ---------- Pictures and videos ---------- */

// Publisher pictures that did not load here (blocked, gone, hotlinking refused) or were a pixel. A story whose
// picture fails is drawn again without it: its video facade if it has one, else the text-led layout. Never a
// broken-image icon and never a stand-in. error and load do not bubble, so they are caught on the way down.
const failedPics = new Set();
const redraw = new Set();
function noPicture(img) {
  const url = img.dataset.pic;
  if (!url || failedPics.has(url)) return;
  failedPics.add(url);
  const area = img.closest('#lead') ? 'lead' : img.closest('#favs') ? 'favs' : img.closest('#grid') ? 'grid' : img.closest('#stv') ? 'tv' : null;
  if (!area) return;
  if (!redraw.size) requestAnimationFrame(() => {
    if (redraw.has('lead')) renderLead();
    if (redraw.has('favs')) renderFavs();
    if (redraw.has('grid')) renderGrid();
    if (redraw.has('tv')) tv?.refresh();
    redraw.clear();
  });
  redraw.add(area);
}
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.front, #stv')) return;
  if (img.hasAttribute('data-still')) img.remove(); // the facade keeps its play button and label on a plain ground
  else noPicture(img);
}, true);
document.addEventListener('load', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.dataset.pic && img.closest('.front, #stv') && img.naturalWidth < 80 && img.naturalHeight < 80) noPicture(img);
}, true);

// Play: the facade (or a picture's "Has video" control) becomes the provider's own player (YouTube's
// privacy-enhanced one, Vimeo without tracking, Facebook's video plugin, TikTok's player, or X's post embed), and
// focus moves into it. This is the only place a player is built, so nothing contacts a provider before the reader
// asks. X's widget script is loaded here, on the first X Play, and never before.
function loadXWidgets(el) {
  if (window.twttr?.widgets?.load) { window.twttr.widgets.load(el); return; }
  if (document.querySelector('script[data-x-widgets]')) return;
  const s = document.createElement('script');
  s.src = X_WIDGETS; s.async = true; s.charset = 'utf-8'; s.dataset.xWidgets = '';
  document.head.appendChild(s);
}
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-play]') : null;
  const slot = b?.closest('.smedia');
  if (!slot || !slot.closest('.front, #stv')) return;
  const x = view.items.find((i) => i.url === slot.dataset.story);
  const v = x?.player;
  if (!v || v.ref !== b.dataset.play || !v.embeddable) return;
  const html = playerFor(v);
  if (!html) return;
  slot.innerHTML = html;
  slot.classList.add('is-playing');
  slot.closest('.lead, .fav, .card, .stv-media')?.classList.add('is-playing');
  if (v.provider === 'x') { loadXWidgets(slot); slot.querySelector('a')?.focus(); }
  else slot.querySelector('iframe')?.focus();
});

/* ---------- Section tabs and the ticker ---------- */

function renderTabs() {
  const nav = $('#sections');
  const cats = CATEGORIES.filter(([id]) => view.counts[id] > 0);
  nav.innerHTML = `<ul>${cats.map(([id, label]) => `<li><a class="bev tab" href="#believe" data-cat="${id}">${esc(label)}</a></li>`).join('')}</ul>`;
  nav.hidden = !cats.length;
}
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-cat]');
  if (tab) { view.cat = tab.dataset.cat; view.shown = PAGE; renderFilters(); renderGrid(); }
});

let tickerPaused = false;
function renderTicker() {
  const list = view.items.slice(0, 12);
  const row = (hidden) => `<ul class="ticker__list"${hidden ? ' aria-hidden="true"' : ''}>${list.map((x) => `<li>${ICON.star}<a ${storyAttrs(x)}${hidden ? ' tabindex="-1"' : ''}>${esc(x.title)}</a><span class="ticker__src">${esc(shortMeta(x, locale))}</span></li>`).join('')}</ul>`;
  const track = $('#ticker-track');
  track.innerHTML = row(false) + row(true);
  requestAnimationFrame(() => track.style.setProperty('--ticker-s', `${tickerSeconds(track.scrollWidth / 2)}s`));
  syncTicker();
}
function syncTicker() {
  const t = $('#ticker'), stopped = tickerPaused || reduced.matches;
  t.classList.toggle('is-paused', stopped);
  t.classList.toggle('is-still', reduced.matches);
  const btn = $('#ticker-btn');
  btn.hidden = reduced.matches; // under reduced motion it never moves; the list scrolls by hand instead
  btn.setAttribute('aria-pressed', String(tickerPaused));
  $('#ticker-btn-label').textContent = tickerPaused ? 'Play the headline ticker' : 'Pause the headline ticker';
}
$('#ticker-btn').addEventListener('click', () => { tickerPaused = !tickerPaused; syncTicker(); });
reduced.addEventListener?.('change', syncTicker);

/* ---------- The lead and its Weird-o-meter ---------- */

function renderLead() {
  const x = view.items[0], el = $('#lead');
  el.hidden = !x;
  if (!x) return;
  const rating = ratingLabel(x.rating);
  const slot = mediaSlot(x, { cls: 'lead', w: 1200, h: 900, eager: true, failed: failedPics, href: storyHref(x.id) });
  const text = slot.kind === 'text';
  // Text-led (no picture, no video): no figure at all. The headline leads, the burst stands beside it in its own
  // space, and the hook, the link and the Weird-o-meter sit side by side under a double rule.
  el.className = `lead lead--${slot.kind}`;
  const burst = `<div class="lead__burst" aria-hidden="true"><span class="lead__burst-ink burst" style="--burst:${starPolygon(20, 40)}"></span>
          <span class="lead__burst-text">${x.pick ? '<small>Editor’s</small>Pick' : `<small>Straight from</small>${esc(monogram(x.outlet))}`}</span></div>`;
  el.innerHTML = `<div class="lead__tags"><span class="lead__tag">TODAY'S LEAD<span class="lead__tag-cat"> · ${esc(catLabel(x.category).toUpperCase())}</span></span>
      <span class="lead__sticker">${ICON.check}${x.video ? 'Video at the source' : 'Links to the original'}</span></div>
    <div class="lead__head"><h2 class="lead__h" id="lead-h"><a class="lead__link" ${storyAttrs(x)}>${esc(x.title)}</a></h2>${text ? burst : ''}</div>
    <div class="lead__body">
      ${text ? '' : `<figure class="lead__fig">${slot.html}${burst}</figure>`}
      <div class="lead__text">
        ${x.note ? `<p class="lead__note">${esc(x.note)}</p>` : ''}
        <p class="lead__meta"><span class="lead__meta-long">${esc(metaLine(x, locale))}</span><span class="lead__meta-short">${esc(shortMeta(x, locale))}</span></p>
        <a class="bev lead__go" href="${esc(x.url)}" rel="noopener">Read it at ${esc(x.outlet)}${ICON.out}</a>
        ${rating ? `<p class="pips" role="img" aria-label="${esc(rating)}"><span class="pips__k">EDITOR</span>${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= x.rating ? 'on' : ''}"></i>`).join('')}</p>` : ''}
        ${meterHTML(x, 'meter')}
      </div>
    </div>`;
  renderMeter();
}

// The Weird-o-meter, for any story: the lead's, and the one in story mode. One code path for both: the markup
// (meterHTML), the state per story (meters), the needle and buttons (paintMeters) and the vote (the click below,
// js/community.js rateStory). A vote in story mode moves the lead's needle too when it is the same story.
function meterHTML(x, id) {
  return `<section class="meter${id === 'meter' ? '' : ' meter--tv'}" id="${id}" data-story="${esc(x.url)}" aria-labelledby="${id}-h">
          <div class="meter__top">
            <svg class="meter__gauge" viewBox="0 0 92 54" aria-hidden="true">
              <path d="M6 50a40 40 0 0 1 80 0" class="meter__track"/>
              <path d="M6 50a40 40 0 0 1 80 0" class="meter__fill" pathLength="100"/>
              <g class="meter__needle"><path d="M46 50L46 16"/></g><circle cx="46" cy="50" r="5"/>
            </svg>
            <div><h3 class="meter__h" id="${id}-h">Weird-o-meter</h3><p class="meter__note" id="${id}-note" aria-live="polite"></p></div>
          </div>
          <div class="meter__votes" role="group" aria-label="How weird is this story? Rate it from 1 to 5">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bev meter__vote" data-vote="${n}" aria-pressed="false" aria-label="${n} of 5, ${METER_WORDS[n].toLowerCase()}">${n}</button>`).join('')}
          </div>
        </section>`;
}
const meters = new Map(); // story url -> { yours, count, average, error, busy }
function meterOf(url) {
  if (!meters.has(url)) meters.set(url, { yours: 0, count: 0, average: null, error: '', busy: false });
  return meters.get(url);
}
function paintMeters(url) {
  for (const el of document.querySelectorAll('.meter[data-story]')) {
    if (url && el.dataset.story !== url) continue;
    const st = meterOf(el.dataset.story);
    const r = view.ratings[el.dataset.story];
    if (r && !st.busy) { st.count = r.count || 0; st.average = r.average ?? null; if (r.yours) st.yours = r.yours; }
    const v = st.yours;
    el.style.setProperty('--needle', `${meterAngle(v)}deg`);
    el.style.setProperty('--fill', `${v ? v * 20 : 0}`);
    for (const b of el.querySelectorAll('[data-vote]')) {
      b.setAttribute('aria-pressed', String(+b.dataset.vote === v));
      b.classList.toggle('is-lit', +b.dataset.vote <= v);
      b.disabled = st.busy;
    }
    el.querySelector('.meter__note').textContent = st.error || meterNote(st);
  }
}
const renderMeter = () => paintMeters();
document.addEventListener('click', async (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-vote]') : null;
  const sec = b?.closest('.meter[data-story]');
  if (!b || !sec) return;
  const url = sec.dataset.story, st = meterOf(url), n = +b.dataset.vote;
  if (st.busy || !view.items.some((i) => i.url === url)) return;
  const prev = st.yours;
  st.yours = n; st.error = ''; st.busy = true; paintMeters(url); // the needle swings at once
  const m = await communityReady;
  const res = m ? await m.rateStory(url, n) : { ok: false, error: 'Votes can’t be sent right now. Try again in a minute.' };
  st.busy = false;
  if (res.ok) {
    Object.assign(st, { yours: res.yours, count: res.count, average: res.average ?? null });
    view.ratings[url] = { count: res.count, average: res.average ?? null, yours: res.yours };
  } else {
    st.yours = prev;
    st.error = `Your vote didn’t go through. ${res.error || ''}`.trim();
  }
  paintMeters(url);
  sec.querySelector(`[data-vote="${n}"]`)?.focus();
});

/* ---------- Favourites: the editor's order until readers' votes rank it ---------- */
// Owner decision, 17 Nov 2026: the editor's picks in the editor's order, until a story has 10 or more Weird-o-meter
// votes in the past 7 days; such stories rank first, by the readers' votes. The heading says which it is. Each entry
// shows its hook line (the editor-approved line under the headline) when it has one.
function renderFavs() {
  const sec = $('#favs');
  const f = favourites(view.items, view.favs, view.ids);
  view.skip = f.list.map((x) => x.url);
  sec.hidden = !f.list.length;
  if (!f.list.length) return;
  const cap = favCaption(f);
  $('#favs-h').innerHTML = `${esc(cap.title)}${cap.how ? `<span class="favs__how"> — ${esc(cap.how)}</span>` : ''}`;
  $('#favs-kicker').textContent = cap.kicker;
  // A favourite without picture or video is text-led: the headline takes the card's full width.
  $('#favs-list').innerHTML = f.list.map((x, i) => {
    const slot = mediaSlot(x, { cls: 'fav', w: 600, h: 600, failed: failedPics, href: storyHref(x.id) });
    return `<li class="fav fav--${slot.kind}">
      <p class="fav__src"><span class="fav__rank" aria-hidden="true">${i + 1}</span><span class="fav__mark">${esc(x.outlet)}</span>${videoTag(x)}</p>
      <h3 class="fav__h"><a class="fav__link" ${storyAttrs(x)}>${esc(x.title)}<span class="sr-only">. Open the story</span></a></h3>
      ${x.note ? `<p class="fav__hook">${esc(x.note)}</p>` : '<p class="fav__hook fav__hook--none"></p>'}
      <p class="fav__meta">${esc(metaLine(x, locale))}${x.by === 'readers' ? ` · ${esc(favVotes(x))}` : f.mode === 'readers' ? " · EDITOR'S PICK" : ''}${slot.kind === 'video' ? `<span class="fav__vlabel"> · ${esc(videoLabel(x.player).toUpperCase())}</span>` : ''}</p>
      ${slot.html}
      <span class="fav__cta" aria-hidden="true">${ICON.tv}Open the story</span>
    </li>`;
  }).join('');
}

/* ---------- Also odd ---------- */

function renderAlso() {
  const { also } = splitFront(view.items, view.skip);
  $('#also').hidden = !also.length;
  $('#also-list').innerHTML = also.map((x, i) => `<li><span class="also__n" aria-hidden="true">${i + 1}</span>
    <span class="also__body"><a class="stretch" ${storyAttrs(x)}>${esc(x.title)}</a><span class="also__meta">${esc(shortMeta(x, locale))}${x.video ? '<span class="also__video"> · VIDEO</span>' : ''}</span></span></li>`).join('');
}

/* ---------- Believe it or not: filters, the grid, show more ---------- */

function renderFilters() {
  const c = view.counts;
  const cats = [['all', 'Everything'], ...CATEGORIES.filter(([id]) => c[id] > 0)];
  $('#filters').innerHTML = cats.map(([id, label]) => `<button type="button" class="bev chipf${view.cat === id ? ' is-on' : ''}" data-filter="${id}" aria-pressed="${view.cat === id}">${esc(label)}<span class="chipf__n">${String(c[id] ?? 0).padStart(2, '0')}</span></button>`).join('');
}
// A card is a picture card, a video card (the facade) or a text-led card: no media row at all, the sticker and a
// slab headline fill the top of the card, over a double rule, so a row of cards still lines up.
function card(x) {
  const rating = ratingLabel(x.rating);
  const tags = `<span class="card__tags" aria-hidden="true">${stickerHTML(x.category)}${videoTag(x)}</span>`;
  const slot = mediaSlot(x, { cls: 'card', w: 640, h: 400, failed: failedPics, extra: tags, href: storyHref(x.id) });
  const head = `<h3 class="card__h"><a ${storyAttrs(x)}>${esc(x.title)}</a></h3>`;
  return `<li class="card card--${slot.kind}" id="story-${esc(x.id).replace(/[^\w-]/g, '').slice(0, 40)}">
    ${slot.kind === 'text' ? `<div class="card__type">${tags}${head}</div>` : `${slot.html}
    ${head}`}
    <p class="card__meta">${esc(metaLine(x, locale))}</p>
    <p class="card__foot">${rating ? `<span class="pips" role="img" aria-label="${esc(rating)}"><span class="pips__k">WEIRD</span>${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= x.rating ? 'on' : ''}"></i>`).join('')}</span>` : '<span></span>'}
      ${slot.kind === 'video' ? `<span class="card__vlabel">${esc(videoLabel(x.player))}</span>` : ''}<a class="card__go" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true">Read at ${esc(x.outlet)}${ICON.out}</a></p>
  </li>`;
}
function renderGrid(focusFrom = -1) {
  const g = gridFor(view.items, view.cat, view.shown, view.skip);
  $('#grid').innerHTML = g.list.map(card).join('');
  const more = $('#more');
  more.hidden = !g.left;
  more.textContent = `Show ${Math.min(PAGE, g.left)} more weird ${Math.min(PAGE, g.left) === 1 ? 'story' : 'stories'}`;
  $('#grid-note').textContent = `${g.list.length} of ${g.total} ${view.cat === 'all' ? 'more stories' : catLabel(view.cat).toLowerCase() + ' stories'} shown`;
  if (focusFrom >= 0) $('#grid').children[focusFrom]?.querySelector('h3 a')?.focus();
}
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]');
  if (f) { view.cat = f.dataset.filter; view.shown = PAGE; renderFilters(); renderGrid(); $(`[data-filter="${view.cat}"]`)?.focus(); }
});
$('#more').addEventListener('click', () => { const from = view.shown; view.shown += PAGE; renderGrid(from); });

// The weather box's footer: the newest weird-weather story, if there is one.
function renderWxWeird() {
  const x = view.items.find((i) => i.category === 'weather');
  const a = $('#wx-weird');
  a.hidden = !x;
  if (!x) return;
  a.href = storyHref(x.id) || x.url;
  if (storyHref(x.id)) a.dataset.storyId = x.id; else a.rel = 'noopener';
  a.innerHTML = `<span class="wxbox__tag">Weird weather</span><span><strong>${esc(x.title)}</strong> · ${esc(x.outlet)}</span>`;
}

/* ---------- Clicks: anonymous totals per weird story ---------- */
// A click (or middle-click) on a link to a weird story's original (the lead's and the cards' "Read it at <outlet>",
// and story mode's "Read the full story at <outlet>") adds one to that story's total for the day, so the editor sees which stories land. Only the story's address is sent,
// as the link opens (never waited for, never blocking it); nothing is sent when the browser asks for Do Not Track or
// Global Privacy Control (js/community.js countClick). Clicks never rank anything on the page.
const CLICK_AREAS = '#ticker, #lead, #favs, #also, #grid, #stv';
function onStoryClick(e) {
  if (e.type === 'auxclick' && e.button !== 1) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || !community || !a.closest(CLICK_AREAS)) return;
  const url = storyFor(a.href, view.urls);
  if (url) community.countClick(url);
}
document.addEventListener('click', onStoryClick, true);
document.addEventListener('auxclick', onStoryClick, true);

/* ---------- The guestbook ---------- */

const gb = $('#guestbook');
gb.addEventListener('submit', async (e) => {
  e.preventDefault();
  const link = $('#gb-link'), note = $('#gb-note'), btn = $('#gb-send');
  const url = tipUrl(link.value);
  const m = await communityReady;
  const problem = !url ? (m?.tipProblem?.({ url: link.value, note: $('#gb-why').value }) || 'Paste the full link to the story, starting https://')
    : m?.tipProblem?.({ url, note: $('#gb-why').value }) || null;
  link.toggleAttribute('aria-invalid', Boolean(problem) && !url);
  if (problem) { note.textContent = problem; note.classList.add('is-error'); link.focus(); return; }
  btn.disabled = true; btn.textContent = 'Sending…'; note.classList.remove('is-error');
  const res = m ? await m.sendTip({ url, note: $('#gb-why').value, website: $('#gb-website').value }) : { ok: false, error: 'Tips can’t be sent right now. Try again in a minute.' };
  btn.disabled = false; btn.textContent = 'Send to the editor';
  if (res.ok) { gb.reset(); note.textContent = 'Thanks — a person reads every tip.'; }
  else { note.textContent = `That didn’t send. ${res.error || ''}`.trim(); note.classList.add('is-error'); }
});

loadStories();
