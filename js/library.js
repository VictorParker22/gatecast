// The Stacks (library.html). Two layers over the same page:
// - The DOM shelves: bays of spine buttons rendered from data/books.json, search and shelf chips, the library
//   card, and the book you pull out in a real <dialog> (a CSS 3D box, or a flat card when motion is reduced).
//   This is the whole library on every device, and the accessible layer under the 3D one.
// - On capable devices (WebGL2, motion allowed, no Save-Data, not a very weak device) the 3D room from
//   js/stacks3d/ is mounted over it. The spine buttons then become a visually hidden list that drives the
//   scene (focus tips a book, Enter pulls it out) and the dialog holds the controls and the back-cover text.
// Pure logic: librarymodel.js and stacks3d/model.js.
import { initSettings, store } from './shell.js';
import {
  BOOKSHOP_AFFILIATE, BOOKSHOP_DISCLOSURE, authorLine, surname, filterView, statusText, pickRandom, spineStyle, balancedRows,
  bookBox, flightStart, parseHash, buildHash, stampCard, stampDate, worldcatUrl, bookshopUrl, openLibraryUrl, coverUrl, coverFor, needsCoverApi,
  previewPlace, previewShift,
} from './librarymodel.js';
import { createPreview } from './librarypreview.js';
import { bookLook, decideTier, stampText } from './stacks3d/model.js';
import * as sound from './stacks3d/sound.js';

initSettings();

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const svgNS = 'http://www.w3.org/2000/svg';
const CARD_KEY = 'gatecast:library-card';
const PREF_3D = 'gatecast:stacks-3d';
const CARD_MAX = 3;
const OBJECTS = { // decorative objects at the end of each bay (line drawings, DOM shelves only)
  lens: ['M38 40l16 18', 'M18 22a10 10 0 0 1 8-4', 'C 26 28 16'],
  file: ['M6 24h18l5 6h29v40H6z', 'M6 34h52', 'M14 46h22', 'M14 54h30'],
  candle: ['M24 34h16v36H24z', 'M32 34v-6', 'M32 12c5 6 5 10 0 14c-5-4-5-8 0-14z', 'M16 70h32'],
  glass: ['M16 6h32', 'M16 70h32', 'M20 6c0 18 24 18 24 32s-24 14-24 32', 'M44 6c0 18-24 18-24 32s24 14 24 32'],
  flask: ['M26 6h12', 'M28 6v20L12 64a4 4 0 0 0 4 6h32a4 4 0 0 0 4-6L36 26V6', 'M18 52h28'],
  hat: ['M20 20h24v36H20z', 'M8 56h48', 'M20 46h24', 'M44 62l10 10'],
};
// Photographic textures and backdrops (assets/stacks/, generated imagery). {size} is 1024 or 512.
const ASSETS = {
  wood: 'assets/stacks/tex-wood-{size}.webp', cloth: 'assets/stacks/tex-cloth-{size}.webp', leather: 'assets/stacks/tex-leather-{size}.webp',
  paper: 'assets/stacks/tex-paper-{size}.webp', pages: 'assets/stacks/tex-pages-512.webp', pocket: 'assets/stacks/pocket-{size}.webp',
  brass: 'assets/stacks/tex-brass-512.webp',
};

const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
const reduceMq = mq('(prefers-reduced-motion: reduce)');
const tapMq = mq('(max-width: 767px), (pointer: coarse)');
const has3d = !window.CSS || !CSS.supports || CSS.supports('transform-style', 'preserve-3d');
const motionOn = () => !reduceMq.matches && has3d;
const locale = navigator.language || undefined;

/* ---------- Which library: 3D or DOM ---------- */

const root = document.documentElement;
const tier = (() => {
  let override = null;
  try { override = new URLSearchParams(location.search).get('stacks'); } catch {}
  let pref = null;
  try { pref = localStorage.getItem(PREF_3D); } catch {}
  if (pref === 'off' && !override) override = 'dom';
  return decideTier({
    webgl2: !!window.WebGL2RenderingContext, reducedMotion: reduceMq.matches, saveData: !!navigator.connection?.saveData,
    deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, mobile: tapMq.matches, override,
  });
})();
// The head script guessed already (so the page reserves room for the cases before first paint); agree with it.
if (tier === 'dom') root.classList.remove('s3d'); else root.classList.add('s3d');
// Start fetching the 3D code at once, while the shelves load.
const stacksModule = tier !== 'dom' ? import('./stacks3d/index.js').catch((e) => { console.warn('3D shelves unavailable:', e); return null; }) : null;

const state = { data: null, shelf: 'all', query: '', covers: {}, open: null, card: [] };
const spines = new Map(); // id -> button on the shelf
const shelfOf = (id) => state.data.shelves.find((s) => s.id === id);
const bookOf = (id) => state.data.books.find((b) => b.id === id);
let s3d = null; // the mounted 3D scene, when there is one

/* ---------- Spines and bays ---------- */

function spineInner(book, st, look) {
  const frag = document.createDocumentFragment();
  frag.append(el('span', 'lib-spine__cloth ' + (look.binding.kind === 'leather' ? 'is-leather' : 'is-cloth')));
  const deco = el('span', 'lib-spine__deco lib-spine__deco--' + look.band); frag.append(deco);
  const title = el('span', 'lib-spine__title', book.title);
  Object.assign(title.style, { fontFamily: st.font, fontSize: st.fontSize + 'px', fontWeight: st.weight, textTransform: st.upper ? 'uppercase' : 'none' });
  frag.append(title);
  frag.append(el('span', 'lib-spine__author', surname(book.authors[0])));
  frag.append(el('span', 'lib-spine__foot lib-spine__deco--' + look.band));
  for (const n of frag.children) n.setAttribute('aria-hidden', 'true');
  return frag;
}

function dress(node, look) {
  node.style.setProperty('--cloth', look.binding.base);
  node.style.setProperty('--foil', look.binding.foil);
  node.style.setProperty('--second', look.second.base);
}

function makeSpine(book) {
  const st = spineStyle(book, { minWidth: tapMq.matches ? 44 : 0 });
  const look = bookLook(book);
  const b = el('button', 'lib-spine');
  b.type = 'button';
  b.dataset.book = book.id;
  b.style.width = st.width + 'px';
  b.style.height = st.height + 'px';
  dress(b, look);
  b.append(spineInner(book, st, look));
  b.addEventListener('click', () => (s3d ? open3d(book.id) : openBook(book.id, b)));
  b.addEventListener('focus', () => {
    if (!s3d) return;
    s3d.focusBook(book.id, b.matches(':focus-visible'));
    // The button itself is hidden; bring the book on the shelf into view instead.
    requestAnimationFrame(() => {
      const r = s3d?.spineRect(book.id);
      if (r && (r.top < 8 || r.top + r.height > window.innerHeight - 8)) window.scrollBy({ top: r.top + r.height / 2 - window.innerHeight / 2, behavior: 'smooth' });
    });
  });
  b.addEventListener('blur', () => { if (s3d) s3d.focusBook(null); });
  b._style = st; b._look = look;
  return b;
}

function objectSvg(kind) {
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', '0 0 64 74'); s.setAttribute('class', 'lib-obj'); s.setAttribute('aria-hidden', 'true');
  for (const d of OBJECTS[kind] || []) {
    let n;
    if (d.startsWith('C')) { const [, cx, cy, r] = d.split(' '); n = document.createElementNS(svgNS, 'circle'); n.setAttribute('cx', cx); n.setAttribute('cy', cy); n.setAttribute('r', r); }
    else { n = document.createElementNS(svgNS, 'path'); n.setAttribute('d', d); }
    s.append(n);
  }
  return s;
}

let lastInner = 0;
function renderBays() {
  const rootEl = $('lib-bays');
  rootEl.textContent = '';
  spines.clear();
  for (const shelf of state.data.shelves) {
    const bay = el('section', 'lib-bay');
    bay.dataset.shelf = shelf.id;
    bay.setAttribute('aria-labelledby', 'shelf-' + shelf.id);
    const plate = el('div', 'lib-bay__plate');
    const h2 = el('h2', null, shelf.name); h2.id = 'shelf-' + shelf.id;
    plate.append(h2); bay.append(plate);
    bay.append(el('div', 'lib-bay__rows'));
    bay.append(el('p', 'lib-bay__note', shelf.note));
    const list = state.data.books.filter((b) => b.shelf === shelf.id).map(makeSpine);
    list.forEach((s) => spines.set(s.dataset.book, s));
    bay._spines = list;
    bay._object = shelf.object;
    rootEl.append(bay);
  }
  layoutRows();
  applyFilter();
}

// Lays each bay's spines onto as many shelf boards as its width needs. Re-run when the bay width changes.
function layoutRows() {
  const bays = [...document.querySelectorAll('.lib-bay')];
  const visible = bays.find((b) => !b.hidden) || bays[0];
  if (!visible) return;
  const inner = Math.max(240, Math.floor(visible.clientWidth - 28 - 24)); // bay padding 14+14, shelf padding 12+12
  lastInner = inner;
  for (const bay of bays) {
    const wrap = bay.querySelector('.lib-bay__rows');
    const list = bay._spines;
    const widths = list.map((s, j) => s._style.width + (j % 3 === 2 ? 6 : 0));
    const rows = balancedRows(widths, inner - 22, 3); // 22px kept free for the leaning last book
    wrap.textContent = '';
    rows.forEach((row, r) => {
      const shelf = el('div', 'lib-shelf');
      row.forEach((i, k) => {
        const s = list[i];
        const last = k === row.length - 1;
        s.classList.toggle('is-lean', last);
        s.style.marginRight = !last && i % 3 === 2 ? '6px' : '0';
        shelf.append(s);
      });
      if (r === rows.length - 1) {
        const used = row.reduce((n, i) => n + widths[i] + 3, 0) + 22;
        if (inner - used >= 60) { shelf.append(el('span', 'lib-spacer')); shelf.append(objectSvg(bay._object)); }
      }
      wrap.append(shelf);
      wrap.append(el('div', 'lib-board ' + (r === rows.length - 1 ? 'lib-board--last' : 'lib-board--mid')));
      wrap.lastChild.setAttribute('aria-hidden', 'true');
    });
  }
}

/* ---------- Filtering, chips, status ---------- */

function renderChips() {
  const wrap = $('lib-chips');
  wrap.textContent = '';
  for (const s of [{ id: 'all', chip: 'All shelves' }, ...state.data.shelves]) {
    const b = el('button', 'lib-chip');
    b.type = 'button';
    b.dataset.shelf = s.id;
    b.append(el('span', 'lib-chip__label', s.chip));
    b.addEventListener('click', () => { setShelf(s.id); writeHash(); });
    wrap.append(b);
  }
}

function setShelf(id) {
  state.shelf = id;
  for (const b of document.querySelectorAll('.lib-chip')) b.setAttribute('aria-pressed', String(b.dataset.shelf === id));
  // The 3D room keeps every case standing (the others dim); the DOM shelves hide the other bays.
  for (const bay of document.querySelectorAll('.lib-bay')) bay.hidden = !s3d && id !== 'all' && bay.dataset.shelf !== id;
  applyFilter();
}

function applyFilter() {
  const view = filterView(state.data, { shelf: state.shelf, query: state.query });
  const hits = new Set();
  for (const bay of view.bays) {
    for (const { book, hit } of bay.books) {
      if (hit) hits.add(book.id);
      const s = spines.get(book.id);
      if (!s) continue;
      s.classList.toggle('is-dim', !hit);
      s.setAttribute('aria-label', `${book.title}, ${authorLine(book.authors)}, ${book.year}${view.query && !hit ? ' (not a match)' : ''}. Pull it off the shelf.`);
    }
  }
  $('lib-status').textContent = statusText(view, { motion: motionOn() || !!s3d });
  s3d?.setView({ shelf: state.shelf, hits: view.query ? hits : null });
  return view;
}

/* ---------- Library card (localStorage only) ---------- */

function loadCard() {
  const raw = store.get(CARD_KEY, []);
  state.card = Array.isArray(raw) ? raw.filter((c) => c && typeof c.id === 'string' && bookOf(c.id)).slice(0, CARD_MAX) : [];
}
function renderCard(fresh = null) {
  const list = $('card-list');
  list.textContent = '';
  for (const c of state.card) {
    const book = bookOf(c.id);
    const li = el('li');
    const b = el('button', null, book.title);
    b.type = 'button';
    b.addEventListener('click', () => pullOut(book.id));
    const st = el('span', 'lib-stamp', stampDate(c.at));
    st.setAttribute('aria-label', 'Stamped ' + stampText(c.at, locale));
    li.append(b, st);
    if (fresh === c.id) li.classList.add('is-fresh');
    list.append(li);
  }
  const empty = !state.card.length;
  list.hidden = empty; $('card-foot').hidden = empty; $('card-empty').hidden = !empty;
  const n = state.card.length;
  const count = empty ? 'NO STAMPS' : `${n} ${n === 1 ? 'STAMP' : 'STAMPS'}`;
  $('card-count').textContent = count;
  $('card-toggle-n').textContent = empty ? 'no stamps' : `${n} ${n === 1 ? 'stamp' : 'stamps'}`;
  if (fresh) { for (const n2 of [$('card-count'), $('card-toggle')]) { n2.classList.remove('is-bump'); void n2.offsetWidth; n2.classList.add('is-bump'); } }
}
function stamp(id) {
  state.card = stampCard(state.card, id, Date.now(), CARD_MAX);
  store.set(CARD_KEY, state.card);
  renderCard(id);
}
const announce = (text) => { const a = $('lib-announce'); a.textContent = ''; setTimeout(() => { a.textContent = text; }, 30); };

/* ---------- Hash ---------- */

function writeHash() {
  const h = buildHash({ shelf: state.shelf, book: state.open ? state.open.id : null });
  try { history.replaceState(null, '', h || location.pathname + location.search); } catch {}
}
function readHash() {
  const h = parseHash(location.hash, state.data);
  if (h.shelf !== state.shelf) setShelf(h.shelf);
  if (h.book && (!state.open || state.open.id !== h.book)) {
    if (state.open) closeBook(true);
    pullOut(h.book);
  } else if (!h.book && state.open) closeBook();
}

/* ---------- The book ---------- */

const dlg = $('lib-dlg');
const bookEl = $('lib-book');
const front = $('bk-front');
const back = $('bk-back');
const turnBtn = $('bk-turn');
const borrowBtn = $('bk-borrow');
const pvBtn = $('bk-pv-btn');
const pvRoot = $('bk-preview');
const pv = createPreview(pvRoot);
let timers = [];
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const coverOf = (book) => coverFor(book, state.covers);

function fillBook(book) {
  const shelf = shelfOf(book.shelf);
  const idx = state.data.shelves.indexOf(shelf) + 1;
  const st = spineStyle(book);
  const look = bookLook(book);
  const cover = coverOf(book);
  $('bk-name').textContent = `${book.title}, by ${authorLine(book.authors)}`;
  // Stand-in cover, in the binding's colours.
  const standin = $('bk-standin');
  const len = book.title.length;
  for (const [k, v] of Object.entries({ '--cloth': look.binding.base, '--foil': look.binding.foil, '--font': st.font, '--fw': st.weight, '--case': st.upper ? 'uppercase' : 'none',
    '--cfs': ((len > 30 ? 34 : len > 16 ? 42 : 54) - (st.kind === 'slab' ? 6 : 0)) + 'px' })) standin.style.setProperty(k, String(v));
  $('bk-cover-shelf').textContent = shelf.name;
  $('bk-cover-title').textContent = book.title;
  $('bk-cover-author').textContent = authorLine(book.authors);
  front.querySelector('.lib-cover')?.remove();
  $('bk-credit').hidden = true;
  // In 3D the scene loads the cover itself; the DOM cover only matters on the DOM shelves.
  const src = !s3d ? coverUrl(cover) : null;
  if (src) {
    const img = el('img', 'lib-cover');
    img.alt = `Cover of ${book.title}`;
    img.width = 380; img.height = 559;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.style.visibility = 'hidden';
    img.addEventListener('load', () => {
      // Open Library answers a missing image with a 1x1 pixel; treat that as no cover.
      if (img.naturalWidth < 20) { img.remove(); return; }
      img.style.visibility = ''; $('bk-credit').hidden = false;
    });
    img.addEventListener('error', () => img.remove());
    img.src = src;
    front.append(img);
  }
  const sp = $('bk-spine');
  sp.textContent = '';
  const shelfSpine = spines.get(book.id);
  const w = shelfSpine ? shelfSpine._style.width : st.width;
  sp.style.width = w + 'px'; sp.style.height = st.height + 'px';
  dress(sp, look);
  sp.className = 'lib-face__spine lib-spine';
  sp.append(spineInner(book, st, look));
  $('bk-shelf').textContent = `${shelf.name.toUpperCase()} · SHELF ${idx}`;
  $('bk-title').textContent = book.title;
  $('bk-author').textContent = authorLine(book.authors);
  $('bk-year').textContent = String(book.year);
  $('bk-desc').textContent = book.description;
  const tags = $('bk-tags'); tags.textContent = '';
  for (const t of book.tags) tags.append(el('li', null, t));
  $('bk-note').hidden = !book.contentNote; $('bk-note-text').textContent = book.contentNote || '';
  $('bk-caveat').hidden = !book.caveat; $('bk-caveat-text').textContent = book.caveat || '';
  $('bk-wc').href = worldcatUrl(book);
  $('bk-buy').href = bookshopUrl(book);
  $('bk-ol').href = openLibraryUrl(book, cover);
  $('bk-disclosure').textContent = BOOKSHOP_AFFILIATE ? ' · ' + BOOKSHOP_DISCLOSURE : '';
  back.scrollTop = 0;
  // The date-due slip (DOM shelves): earlier stamps from this device's card.
  $('bk-slip-title').textContent = book.title;
  setBorrowed(false);
  // Preview: only for books with approved preview data.
  resetPreview();
  const has = pv.setBook(book, shelf.name);
  pvBtn.hidden = !has;
  dlg.classList.toggle('has-preview', has);
}

function setBorrowed(done) {
  borrowBtn.setAttribute('aria-disabled', String(!!done)); // not `disabled`: focus must stay on it
  borrowBtn.querySelector('span').textContent = done ? 'Borrowed' : 'Borrow';
  dlg.classList.toggle('is-borrowed', !!done);
}

function slipRows(stampedAt = null) {
  const prev = state.card.filter((c) => !state.open || c.id !== state.open.id).slice(0, 3).map((c) => stampText(c.at, locale));
  const list = $('bk-slip-rows');
  list.textContent = '';
  prev.forEach((d) => list.append(el('li', 'is-old', d)));
  if (stampedAt) { const li = el('li', 'is-new', stampText(stampedAt, locale)); list.append(li); }
  return prev;
}

function setFace(face) {
  state.open.face = face;
  // Only the side facing you can be reached: the other is inert (no focus, hidden from assistive tech).
  front.inert = face === 'back';
  back.inert = face !== 'back';
  turnBtn.textContent = face === 'back' ? 'Show the cover' : 'Turn it over';
}

function setTransform(t, transition) {
  bookEl.style.transition = transition || 'none';
  bookEl.style.setProperty('--tx', t.x + 'px');
  bookEl.style.setProperty('--ty', t.y + 'px');
  bookEl.style.setProperty('--ts', String(t.s));
  bookEl.style.setProperty('--tz', t.z + 'px');
  bookEl.style.setProperty('--tr', t.r + 'deg');
}

const EASE = {
  cover: 'transform 900ms cubic-bezier(.2,1.25,.35,1)',
  turn: 'transform 950ms cubic-bezier(.65,0,.25,1)',
  close: 'transform 520ms cubic-bezier(.55,0,.75,.2)',
};

// Height kept free under the book for the dialog's buttons. A book with a Preview has four, which take two rows on
// a narrow phone (library.css, below 30rem): keep the second row free too.
const PREVIEW_ROW = 50;
const controlsH = (base, vw = window.innerWidth) => base + (!pvBtn.hidden && vw < 480 ? PREVIEW_ROW : 0);

function placeBox() {
  const vw = dlg.clientWidth || window.innerWidth, vh = dlg.clientHeight || window.innerHeight;
  const box = bookBox(vw, vh, { controls: controlsH(vw < 736 ? 84 : 88, vw) });
  const o = state.open;
  o.box = box;
  bookEl.style.setProperty('--x', box.left + 'px');
  bookEl.style.setProperty('--y', box.top + 'px');
  bookEl.style.setProperty('--W', box.W + 'px');
  bookEl.style.setProperty('--H', box.H + 'px');
  const stage = dlg.querySelector('.lib-stage');
  stage.style.perspectiveOrigin = `${box.cx}px ${box.cy}px`;
  stage.style.setProperty('--sx', box.cx + 'px');
  stage.style.setProperty('--sy', (box.top + box.H + 14) + 'px');
  stage.style.setProperty('--sw', Math.round(box.W * 0.9) + 'px');
  return box;
}

const rest = (o, r) => ({ x: 0, y: 0, s: 1, z: -o.depth / 2, r });
const away = (o, r) => ({ x: o.start.dx, y: o.start.dy, s: o.start.s, z: -o.box.W / 2, r });

// DOM shelves: the CSS 3D book (or the flat card when motion is reduced).
function openBook(id, spineEl) {
  if (state.open || !spineEl) return;
  const book = bookOf(id);
  if (!book) return;
  clearTimers();
  const flat = !motionOn();
  state.open = { id, spine: spineEl, flat, face: flat ? 'back' : 'cover' };
  fillBook(book);
  slipRows();
  dlg.classList.toggle('is-flat', flat);
  dlg.classList.remove('is-settled', 'is-gl', 'is-turned', 'is-slip');
  writeHash();
  if (flat) {
    bookEl.style.cssText = '';
    front.inert = false; back.inert = false;
    dlg.showModal();
    borrowBtn.focus();
    return;
  }
  const r = spineEl.getBoundingClientRect();
  dlg.showModal();
  const box = placeBox();
  const start = flightStart({ left: r.left, top: r.top, width: r.width, height: r.height }, box);
  state.open.start = start;
  state.open.depth = start.depth;
  bookEl.style.setProperty('--D', start.depth + 'px');
  $('bk-spine').style.transform = `scale(${box.H / spineEl._style.height})`;
  setFace('cover');
  setTransform(away(state.open, 90));
  spineEl.classList.add('is-out');
  borrowBtn.focus({ preventScroll: true });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!state.open) return;
    setTransform(rest(state.open, -18), EASE.cover);
    dlg.classList.add('is-settled');
  }));
}

function turn(face) {
  const o = state.open;
  if (!o || o.flat || o.closing) return;
  if (o.gl) { turn3d(face); return; }
  clearTimers();
  setFace(face);
  setTransform(rest(o, face === 'back' ? -180 : -18), EASE.turn);
}

function finish() {
  const o = state.open;
  if (!o) return;
  clearTimers();
  resetPreview();
  state.open = null;
  o.spine?.classList.remove('is-out', 'is-fly');
  dlg.classList.remove('is-settled', 'is-turned', 'is-slip');
  root.classList.remove('is-reading');
  if (dlg.open) dlg.close();
  bookEl.style.transition = 'none';
  front.inert = false; back.inert = false;
  writeHash();
  if (o.spine && o.spine.isConnected) o.spine.focus({ preventScroll: true });
}

function closeBook(now = false) {
  const o = state.open;
  if (!o || o.closing) return;
  if (o.gl) { putBack3d(now); return; }
  if (o.flat || now) { finish(); return; }
  o.closing = true;
  clearTimers();
  resetPreview();
  dlg.classList.remove('is-settled', 'is-slip');
  setTransform(away(o, o.face === 'back' ? -270 : 90), EASE.close);
  later(finish, 560);
}

// Borrow: stamp the date-due slip and the library card.
async function borrow() {
  const o = state.open;
  if (!o || o.borrowed || o.closing || o.preview === 'pending') return;
  sound.unlock();
  if (o.preview) closePreview(false);
  o.borrowed = true;
  const book = bookOf(o.id);
  const at = Date.now();
  const date = stampText(at, locale);
  const done = () => {
    stamp(o.id);
    setBorrowed(true);
    announce(`Stamped ${date}. ${book.title} is on your library card.`);
  };
  if (o.gl) {
    if (o.face === 'back') { dlg.classList.remove('is-turned'); setFace('cover'); }
    const prev = state.card.filter((c) => c.id !== o.id).slice(0, 3).map((c) => stampText(c.at, locale));
    borrowBtn.setAttribute('aria-disabled', 'true');
    await s3d.borrow({ title: book.title, previous: prev, stamped: date }, done);
    turnBtn.textContent = 'Turn it over';
    return;
  }
  // DOM shelves: the slip slides up and the stamp comes down (no animation when motion is reduced).
  slipRows();
  dlg.classList.add('is-slip');
  const slip = $('bk-slip');
  if (motionOn()) {
    slip.classList.remove('is-stamping'); void slip.offsetWidth; slip.classList.add('is-stamping');
    setTimeout(() => { slipRows(at); sound.stampThud(); done(); }, 620);
  } else { slipRows(at); done(); }
}

turnBtn.addEventListener('click', () => {
  sound.unlock();
  const o = state.open;
  if (!o || o.preview === 'pending') return;
  if (o.preview) { closePreview(false); turn('back'); return; }
  turn(o.face === 'back' ? 'cover' : 'back');
});
pvBtn.addEventListener('click', () => { sound.unlock(); if (state.open?.preview) closePreview(); else openPreview(); });
borrowBtn.addEventListener('click', borrow);
$('bk-close').addEventListener('click', () => closeBook());
dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeBook(); });
dlg.addEventListener('close', () => { if (state.open && !state.open.gl) finish(); });
dlg.addEventListener('click', (e) => {
  if (e.target === dlg || (e.target instanceof Element && e.target.hasAttribute('data-close'))) closeBook();
});
window.addEventListener('resize', () => {
  const o = state.open;
  if (!o || o.closing) return;
  if (o.gl) { if (o.face === 'back') placeBack(); if (o.preview === true) requestAnimationFrame(placePreview); return; }
  if (o.flat) return;
  placeBox();
  setTransform(rest(o, o.face === 'back' ? -180 : -18));
  if (o.preview === true) placePreview(false);
});

/* ---------- The book in 3D ---------- */

async function open3d(id, { flick = false } = {}) {
  if (state.open || !s3d || s3d.isBusy()) return;
  const book = bookOf(id);
  if (!book) return;
  // The room must be on screen for the book to fly to you.
  const cases = $('lib-cases').getBoundingClientRect();
  if (cases.top > window.innerHeight * 0.75 || cases.bottom < window.innerHeight * 0.4) $('lib-cases').scrollIntoView({ block: 'end', behavior: 'instant' });
  state.open = { id, spine: spines.get(id), gl: true, face: 'cover' };
  fillBook(book);
  dlg.classList.add('is-gl');
  dlg.classList.remove('is-flat', 'is-settled', 'is-turned', 'is-slip');
  root.classList.add('is-reading');
  setFace('cover');
  dlg.showModal();
  borrowBtn.focus({ preventScroll: true });
  writeHash();
  const res = await s3d.pullOut(id, { flick });
  if (!res) { state.open = null; root.classList.remove('is-reading'); if (dlg.open) dlg.close(); return; }
  $('bk-credit').hidden = !res.photo;
  if (state.open && state.open.id === id) dlg.classList.add('is-settled');
}

function placeBorrowOnPage() {
  const r = s3d?.faceRect('leftpage');
  if (!r || r.width < 80) return;
  borrowBtn.style.setProperty('--px', Math.round(r.left + r.width / 2) + 'px');
  borrowBtn.style.setProperty('--py', Math.round(r.top + r.height * 0.7) + 'px');
  borrowBtn.classList.add('is-onpage');
}
const borrowOffPage = () => borrowBtn.classList.remove('is-onpage');

function placeBack() {
  const r = s3d.faceRect('back');
  if (!r) return;
  const inset = Math.round(r.width * 0.06);
  bookEl.style.setProperty('--bx', Math.round(r.left + inset) + 'px');
  bookEl.style.setProperty('--by', Math.round(r.top + inset) + 'px');
  bookEl.style.setProperty('--bw', Math.round(r.width - 2 * inset) + 'px');
  bookEl.style.setProperty('--bh', Math.round(r.height - 2 * inset) + 'px');
}

async function turn3d(face) {
  const o = state.open;
  if (!o || s3d.isBusy()) return;
  dlg.classList.remove('is-turned');
  borrowOffPage();
  setFace(face);
  await s3d.turn(face);
  if (face === 'back' && state.open === o) { placeBack(); dlg.classList.add('is-turned'); back.focus({ preventScroll: true }); }
  if (o.borrowed) setBorrowed(true);
}

async function putBack3d() {
  const o = state.open;
  if (!o || o.closing) return;
  o.closing = true;
  resetPreview();
  borrowOffPage();
  dlg.classList.remove('is-turned', 'is-settled');
  root.classList.remove('is-reading');
  if (dlg.open) dlg.close();
  state.open = null;
  writeHash();
  if (o.spine && o.spine.isConnected) o.spine.focus({ preventScroll: true });
  await s3d.putBack();
}

// Opens a book from anywhere (card, hash, Surprise me): show its bay, bring the spine into view, then pull it out.
function pullOut(id, { fly = false } = {}) {
  const book = bookOf(id);
  if (!book) return;
  if (s3d) { open3d(id, { flick: fly }); return; }
  if (state.shelf !== 'all' && state.shelf !== book.shelf) { setShelf(book.shelf); }
  const s = spines.get(id);
  if (!s) return;
  const r = s.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) s.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (fly && motionOn()) {
    s.classList.add('is-fly');
    setTimeout(() => { s.classList.remove('is-fly'); openBook(id, s); }, 430);
  } else openBook(id, s);
}

/* ---------- Preview: Watch and Look inside (js/librarypreview.js) ---------- */

// Shows the Preview sheet. The book turns to its cover first (in 3D through the scene's own turn); on wide DOM
// shelves it slides left to make room. Without motion the sheet takes the back cover's place in the flat card.
async function openPreview() {
  const o = state.open;
  if (!o || o.closing || o.preview || pvBtn.hidden) return;
  if (o.gl) {
    o.preview = 'pending';
    // Still flying in or turning: wait for the scene, then go on (unless the book was put back meanwhile).
    while (s3d?.isBusy() && state.open === o && !o.closing) await new Promise((r) => setTimeout(r, 60));
    if (state.open !== o || o.closing || !s3d) return;
    dlg.classList.remove('is-turned');
    borrowOffPage();
    setFace('cover');
    if (s3d.reading()?.face !== 'cover') await s3d.turn('cover');
    if (state.open !== o || o.closing) return;
    if (o.borrowed) setBorrowed(true);
  } else if (!o.flat) {
    clearTimers();
    setFace('cover');
  }
  o.preview = true;
  back.inert = true;
  if (o.flat) bookEl.append(pvRoot);
  dlg.classList.add('is-preview');
  pvBtn.setAttribute('aria-pressed', 'true');
  placePreview();
  pv.show();
}

// Back to the book: the player and viewer are removed, focus returns to the Preview button.
function closePreview(focus = true) {
  const o = state.open;
  if (!o || o.preview !== true) return;
  resetPreview();
  if (o.flat) back.inert = false;
  else if (!o.gl) setTransform(rest(o, -18), EASE.turn);
  else setFace('cover');
  if (focus) pvBtn.focus({ preventScroll: true });
}

// Hides the sheet and puts it back in the dialog (the flat card borrows it), whatever state the book is in.
function resetPreview() {
  if (state.open) state.open.preview = false;
  pv.hide();
  dlg.classList.remove('is-preview');
  pvBtn.setAttribute('aria-pressed', 'false');
  if (pvRoot.parentNode !== dlg) dlg.insertBefore(pvRoot, $('bk-controls'));
}

// Places the sheet beside the book or over its lower part (previewPlace), above the dialog's buttons.
function placePreview(animate = true) {
  const o = state.open;
  if (!o || !o.preview || o.flat) return;
  const vw = dlg.clientWidth || window.innerWidth, vh = dlg.clientHeight || window.innerHeight;
  const bottom = vh - $('bk-controls').offsetTop + 12;
  let rect;
  if (o.gl) rect = s3d.faceRect('box');
  else {
    const box = o.box;
    const shift = previewShift(box, vw);
    setTransform({ ...rest(o, -18), x: shift }, animate ? EASE.turn : null);
    rect = { left: box.left + shift, top: box.top, width: box.W, height: box.H };
  }
  if (!rect) return;
  const p = previewPlace(rect, vw, vh, { bottom });
  pvRoot.dataset.mode = p.mode;
  for (const [k, v] of Object.entries({ x: p.left, y: p.top, w: p.width, h: p.height })) pvRoot.style.setProperty('--pv-' + k, v + 'px');
}

/* ---------- Mounting the 3D room ---------- */

function backdropUrl() {
  const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle($('lib-room-bg')).backgroundImage || '');
  return m ? m[1] : null;
}

async function mount3d() {
  const canvas = $('lib-gl');
  const mod = await stacksModule;
  if (!mod) { toDom(); return; }
  canvas.hidden = false;
  try {
    const mounting = mod.mount({
      canvas, stage: $('lib-room'), region: $('lib-cases'), data: state.data, tier, mobile: tapMq.matches, assets: ASSETS,
      backdropUrl: backdropUrl(), ringEl: $('lib-ring'),
      coverUrl: (book) => coverUrl(coverOf(book), 'L'),
      shelfName: (id) => shelfOf(id)?.name || '',
      safeTop: () => {
        const card = document.querySelector('.lib-cardwrap').getBoundingClientRect();
        const wide = window.innerWidth >= 1100;
        return Math.max(16, wide ? 16 : card.bottom + 8);
      },
      safeBottom: () => controlsH(window.innerWidth < 736 ? 92 : 96),
      stampPause: Number(new URLSearchParams(location.search).get('stamppause')) || 160,
      on: {
        ready: () => { root.classList.add('s3d-ready'); },
        lost: () => toDom(),
        pull: (id, o) => open3d(id, o),
        window: (first, visible) => updatePager(first, visible),
        stampPhase: (phase) => {
          root.dataset.stamp = phase;
          // Once the cover is open, the Borrow plate sits on the left-hand page, as in the design.
          if (phase === 'air') placeBorrowOnPage();
        },
      },
    });
    s3d = await Promise.race([mounting, new Promise((_, rej) => setTimeout(() => rej(new Error('3D took too long')), 25000))]);
    window.__stacks3d = s3d; // for the screenshot scripts and debugging
    setShelf(state.shelf);
    if (parseHash(location.hash, state.data).book) readHash();
  } catch (e) {
    console.warn('3D shelves failed, using the DOM shelves:', e);
    toDom();
  }
}

// Back to the DOM shelves (WebGL lost or failed): same page, same state.
function toDom() {
  if (state.open?.gl) { resetPreview(); state.open = null; if (dlg.open) dlg.close(); root.classList.remove('is-reading'); }
  try { s3d?.destroy(); } catch {}
  s3d = null;
  root.classList.remove('s3d', 's3d-ready');
  $('lib-gl').hidden = true;
  setShelf(state.shelf);
  layoutRows();
}

function updatePager(first, visible) {
  const n = state.data.shelves.length;
  const names = state.data.shelves.slice(first, first + visible).map((s) => s.name).join(', ');
  $('lib-pager').textContent = visible === 1 ? `Shelf ${first + 1} of ${n}: ${names}` : `Shelves ${first + 1}–${first + visible} of ${n}`;
  $('lib-prev').disabled = first <= 0;
  $('lib-next').disabled = first + visible >= n;
}

/* ---------- Start ---------- */

async function loadCovers() {
  if (!needsCoverApi(state.data.books)) return;
  try {
    const res = await fetch('/api/book-covers');
    if (!res.ok) return;
    const body = await res.json();
    if (body && body.covers && typeof body.covers === 'object') state.covers = body.covers;
  } catch {}
}

function surprise() {
  sound.unlock();
  const view = filterView(state.data, { shelf: state.shelf, query: state.query });
  let all = view.bays.flatMap((b) => b.books);
  if (s3d) { const vis = new Set(s3d.visibleBooks()); const here = all.filter((x) => vis.has(x.book.id)); if (here.some((x) => x.hit)) all = here; }
  const hits = all.filter((x) => x.hit);
  const pick = pickRandom(hits.length ? hits : all);
  if (pick) pullOut(pick.book.id, { fly: true });
}

function setupToggles() {
  const sBtn = $('lib-sound');
  const paintSound = () => { sBtn.setAttribute('aria-pressed', String(sound.soundOn())); sBtn.title = sound.soundOn() ? 'Sound is on' : 'Sound is off'; };
  sBtn.addEventListener('click', () => { sound.setSound(!sound.soundOn()); sound.unlock(); paintSound(); });
  paintSound();
  const vBtn = $('lib-3d');
  const on3d = tier !== 'dom';
  vBtn.setAttribute('aria-pressed', String(!on3d));
  vBtn.hidden = !window.WebGL2RenderingContext || reduceMq.matches;
  vBtn.addEventListener('click', () => {
    try { localStorage.setItem(PREF_3D, on3d ? 'off' : 'on'); } catch {}
    const u = new URL(location.href); u.searchParams.delete('stacks'); location.replace(u.href);
  });
  const cardBtn = $('card-toggle');
  cardBtn.addEventListener('click', () => {
    const open = cardBtn.getAttribute('aria-expanded') !== 'true';
    cardBtn.setAttribute('aria-expanded', String(open));
    $('lib-card').classList.toggle('is-open', open);
  });
  $('lib-prev').addEventListener('click', () => s3d?.pan(-1));
  $('lib-next').addEventListener('click', () => s3d?.pan(1));
  // Any first gesture may start the audio (browsers need one).
  const first = () => sound.unlock();
  window.addEventListener('pointerdown', first, { once: true, capture: true });
  window.addEventListener('keydown', first, { once: true, capture: true });
}

async function start() {
  setupToggles();
  try {
    const res = await fetch('data/books.json');
    if (!res.ok) throw new Error(String(res.status));
    state.data = await res.json();
  } catch {
    const msg = el('p', 'lib-msg', 'The shelves could not be loaded. Please try again in a moment.');
    $('lib-bays').replaceChildren(msg);
    $('lib-status').textContent = 'The shelves could not be loaded.';
    toDom();
    return;
  }
  renderChips();
  loadCard();
  renderCard();
  renderBays();
  setShelf(parseHash(location.hash, state.data).shelf);
  $('lib-q').addEventListener('input', (e) => { state.query = e.target.value; applyFilter(); });
  $('lib-search').addEventListener('submit', (e) => e.preventDefault());
  $('lib-surprise').addEventListener('click', surprise);
  $('card-clear').addEventListener('click', () => { state.card = []; store.set(CARD_KEY, []); renderCard(); $('card-empty').focus(); announce('Library card cleared.'); });
  reduceMq.addEventListener?.('change', applyFilter);
  const relayout = () => {
    if (s3d) return;
    const visible = [...document.querySelectorAll('.lib-bay')].find((b) => !b.hidden);
    if (visible && Math.floor(visible.clientWidth - 52) !== lastInner) layoutRows();
  };
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe($('lib-bays'));
  else window.addEventListener('resize', relayout);
  tapMq.addEventListener?.('change', () => { if (!state.open) renderBays(); });
  window.addEventListener('hashchange', readHash);
  loadCovers();
  if (tier !== 'dom') mount3d();
  else if (parseHash(location.hash, state.data).book) requestAnimationFrame(() => readHash());
}

start();
