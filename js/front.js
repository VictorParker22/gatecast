// The weird-news half of the front page (index.html): the edition strip, the section tabs, the headline ticker,
// the lead with its Weird-o-meter, favourites, "Also odd", the reading streak, the "Believe it or not" grid, the
// weird-weather line in the weather box, and the guestbook. Stories come from /api/weird via data.js loadWeird();
// votes and tips go through js/community.js. Pure rules live in js/frontmodel.js. The weather half is js/weather.js.
import * as data from './data.js';
import {
  cleanWeird, splitFront, gridFor, favourites, PAGE, CATEGORIES, catLabel, stickerTone, metaLine, shortMeta, ratingLabel,
  monogram, editionLine, starPolygon, tickerSeconds, nextStreak, streakDigits, meterAngle, meterNote, METER_WORDS, tipUrl,
} from './frontmodel.js';
import { esc } from './ui.js';
import { $, store } from './shell.js';

const locale = navigator.language || 'en-GB';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ICON = {
  out: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  camera: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
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

const view = { items: [], counts: {}, cat: 'all', shown: PAGE, skip: [], ratings: {} };
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
  view.items = w.items; view.counts = w.counts;
  render();
  // Favourites and the lead's meter need the readers' votes; the page does not wait for them.
  const m = await communityReady;
  if (!m || !view.items.length) return;
  view.ratings = await m.loadRatings(view.items.map((x) => x.url)).catch(() => ({})) || {};
  renderFavs();
  renderGrid(); renderAlso();
  renderMeter();
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
const videoTag = (x) => (x.video ? '<span class="vtag">VIDEO AT SOURCE</span>' : '');

// A publisher's preview image (hotlinked, lazy, credited) or a designed typographic tile: never a stand-in photo.
const tileHTML = (cat, outlet) => `<span class="ftile ftile--${esc(cat)}" aria-hidden="true"><span class="ftile__mono">${esc(monogram(outlet))}</span></span><span class="credit credit--none">${ICON.camera}Picture at the source</span>`;
function media(x, { cls, w, h, eager = false }) {
  if (!x.image) return tileHTML(x.category, x.outlet);
  return `<img class="${cls}__img" src="${esc(x.image)}" alt="" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-cat="${esc(x.category)}" data-outlet="${esc(x.outlet)}"><span class="credit">${ICON.camera}${esc(x.imageCredit)}</span>`;
}
// A picture that fails, or turns out to be a pixel, becomes the tile. error/load do not bubble: caught on the way down.
function noPicture(img) {
  const credit = img.nextElementSibling;
  if (credit?.classList.contains('credit')) credit.remove();
  img.insertAdjacentHTML('beforebegin', tileHTML(img.dataset.cat || 'other', img.dataset.outlet || ''));
  img.remove();
}
document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.closest('.front, #wxbox')) noPicture(e.target); }, true);
document.addEventListener('load', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.closest('.front') && img.naturalWidth < 80 && img.naturalHeight < 80) noPicture(img);
}, true);

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
  const row = (hidden) => `<ul class="ticker__list"${hidden ? ' aria-hidden="true"' : ''}>${list.map((x) => `<li>${ICON.star}<a href="${esc(x.url)}" rel="noopener"${hidden ? ' tabindex="-1"' : ''}>${esc(x.title)}</a><span class="ticker__src">${esc(shortMeta(x, locale))}</span></li>`).join('')}</ul>`;
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
  el.innerHTML = `<div class="lead__tags"><span class="lead__tag">TODAY'S LEAD<span class="lead__tag-cat"> · ${esc(catLabel(x.category).toUpperCase())}</span></span>
      <span class="lead__sticker">${ICON.check}${x.video ? 'Video at the source' : 'Links to the original'}</span></div>
    <h2 class="lead__h" id="lead-h">${esc(x.title)}</h2>
    <div class="lead__body">
      <figure class="lead__fig">
        <a class="lead__media" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true">${media(x, { cls: 'lead', w: 1200, h: 900, eager: true })}</a>
        <div class="lead__burst" aria-hidden="true"><span class="lead__burst-ink burst" style="--burst:${starPolygon(20, 40)}"></span>
          <span class="lead__burst-text">${x.pick ? '<small>Editor’s</small>Pick' : `<small>Straight from</small>${esc(monogram(x.outlet))}`}</span></div>
      </figure>
      <div class="lead__text">
        ${x.note ? `<p class="lead__note">${esc(x.note)}<span class="lead__by"> — the editor</span></p>` : ''}
        <p class="lead__meta"><span class="lead__meta-long">${esc(metaLine(x, locale))}</span><span class="lead__meta-short">${esc(shortMeta(x, locale))}</span></p>
        <a class="bev lead__go" href="${esc(x.url)}" rel="noopener">Read it at ${esc(x.outlet)}${ICON.out}</a>
        ${rating ? `<p class="pips" role="img" aria-label="${esc(rating)}"><span class="pips__k">EDITOR</span>${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= x.rating ? 'on' : ''}"></i>`).join('')}</p>` : ''}
        <section class="meter" id="meter" aria-labelledby="meter-h">
          <div class="meter__top">
            <svg class="meter__gauge" viewBox="0 0 92 54" aria-hidden="true">
              <path d="M6 50a40 40 0 0 1 80 0" class="meter__track"/>
              <path d="M6 50a40 40 0 0 1 80 0" class="meter__fill" pathLength="100"/>
              <g class="meter__needle"><path d="M46 50L46 16"/></g><circle cx="46" cy="50" r="5"/>
            </svg>
            <div><h3 class="meter__h" id="meter-h">Weird-o-meter</h3><p class="meter__note" id="meter-note" aria-live="polite"></p></div>
          </div>
          <div class="meter__votes" role="group" aria-label="How weird is this story? Rate it from 1 to 5">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bev meter__vote" data-vote="${n}" aria-pressed="false" aria-label="${n} of 5, ${METER_WORDS[n].toLowerCase()}">${n}</button>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  renderMeter();
}

const meter = { yours: 0, count: 0, average: null, error: '', busy: false };
function renderMeter() {
  const x = view.items[0], el = $('#meter');
  if (!x || !el) return;
  const r = view.ratings[x.url];
  if (r && !meter.busy) { meter.count = r.count || 0; meter.average = r.average ?? null; if (r.yours) meter.yours = r.yours; }
  const v = meter.yours;
  el.style.setProperty('--needle', `${meterAngle(v)}deg`);
  el.style.setProperty('--fill', `${v ? v * 20 : 0}`);
  for (const b of el.querySelectorAll('[data-vote]')) {
    b.setAttribute('aria-pressed', String(+b.dataset.vote === v));
    b.classList.toggle('is-lit', +b.dataset.vote <= v);
    b.disabled = meter.busy;
  }
  $('#meter-note').textContent = meter.error || meterNote(meter);
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-vote]');
  if (!b || meter.busy) return;
  const x = view.items[0], n = +b.dataset.vote;
  const prev = meter.yours;
  meter.yours = n; meter.error = ''; meter.busy = true; renderMeter(); // the needle swings at once
  const m = await communityReady;
  const res = m ? await m.rateStory(x.url, n) : { ok: false, error: 'Votes can’t be sent right now. Try again in a minute.' };
  meter.busy = false;
  if (res.ok) {
    Object.assign(meter, { yours: res.yours, count: res.count, average: res.average ?? null });
    view.ratings[x.url] = { count: res.count, average: res.average ?? null, yours: res.yours };
  } else {
    meter.yours = prev;
    meter.error = `Your vote didn’t go through. ${res.error || ''}`.trim();
  }
  renderMeter();
  $(`[data-vote="${n}"]`)?.focus();
});

/* ---------- Favourites: readers' (from real votes) or the editor's picks ---------- */
// PAUSED by the owner (to be planned before it ships): with FAVOURITES false the section stays hidden and the rest of
// the page lays out as if it did not exist. To remove it entirely: this block, the #favs section in index.html, the
// "Favourites" block in styles/home.css, favourites() in js/frontmodel.js and its tests.
const FAVOURITES = false;
function renderFavs() {
  const sec = $('#favs');
  if (!FAVOURITES) { sec.hidden = true; view.skip = []; return; }
  const f = favourites(view.items, view.ratings);
  view.skip = f.list.map((x) => x.url);
  sec.hidden = !f.list.length;
  if (!f.list.length) return;
  const readers = f.mode === 'readers';
  $('#favs-h').textContent = readers ? 'Reader favourites' : 'Editor’s favourites';
  $('#favs-kicker').textContent = readers ? "RANKED BY READERS' WEIRD-O-METER VOTES · PAST 7 DAYS" : "THE EDITOR'S PICKS · EVERY ONE LINKS TO THE ORIGINAL";
  $('#favs-list').innerHTML = f.list.map((x, i) => `<li class="fav">
      <p class="fav__src"><span class="fav__rank" aria-hidden="true">${i + 1}</span><span class="fav__mark">${esc(x.outlet)}</span>${videoTag(x)}</p>
      <h3 class="fav__h"><a class="fav__link" href="${esc(x.url)}" rel="noopener">${esc(x.title)}<span class="sr-only">. Read it at ${esc(x.outlet)}</span></a></h3>
      ${x.note ? `<p class="fav__hook">${esc(x.note)}</p>` : '<p class="fav__hook fav__hook--none"></p>'}
      <p class="fav__meta">${esc(metaLine(x, locale))}${readers ? ` · ${x.votes} VOTES` : ''}</p>
      <span class="fav__media">${media(x, { cls: 'fav', w: 600, h: 600 })}</span>
      <span class="fav__cta" aria-hidden="true">Read it at ${esc(x.outlet)}${ICON.out}</span>
    </li>`).join('');
}

/* ---------- Also odd ---------- */

function renderAlso() {
  const { also } = splitFront(view.items, view.skip);
  $('#also').hidden = !also.length;
  $('#also-list').innerHTML = also.map((x, i) => `<li><span class="also__n" aria-hidden="true">${i + 1}</span>
    <span class="also__body"><a class="stretch" href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a><span class="also__meta">${esc(shortMeta(x, locale))}</span></span></li>`).join('');
}

/* ---------- Believe it or not: filters, the grid, show more ---------- */

function renderFilters() {
  const c = view.counts;
  const cats = [['all', 'Everything'], ...CATEGORIES.filter(([id]) => c[id] > 0)];
  $('#filters').innerHTML = cats.map(([id, label]) => `<button type="button" class="bev chipf${view.cat === id ? ' is-on' : ''}" data-filter="${id}" aria-pressed="${view.cat === id}">${esc(label)}<span class="chipf__n">${String(c[id] ?? 0).padStart(2, '0')}</span></button>`).join('');
}
function card(x) {
  const rating = ratingLabel(x.rating);
  return `<li class="card" id="story-${esc(x.id).replace(/[^\w-]/g, '').slice(0, 40)}">
    <a class="card__media card__media--${esc(x.category)}" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true">
      <span class="card__tags">${stickerHTML(x.category)}${videoTag(x)}</span>${media(x, { cls: 'card', w: 640, h: 400 })}</a>
    <h3 class="card__h"><a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a></h3>
    <p class="card__meta">${esc(metaLine(x, locale))}</p>
    <p class="card__foot">${rating ? `<span class="pips" role="img" aria-label="${esc(rating)}"><span class="pips__k">WEIRD</span>${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= x.rating ? 'on' : ''}"></i>`).join('')}</span>` : '<span></span>'}
      <a class="card__go" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true">Read at ${esc(x.outlet)}${ICON.out}</a></p>
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
  a.href = x.url; a.rel = 'noopener';
  a.innerHTML = `<span class="wxbox__tag">Weird weather</span><span><strong>${esc(x.title)}</strong> · ${esc(x.outlet)}</span>`;
}

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
