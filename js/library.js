// The Stacks (library.html): renders the bays from data/books.json, search and shelf chips, the library card,
// and the book you pull out (a real <dialog>: a 3D box that flies off the shelf, shows its cover, then turns
// to its back; a flat card instead when motion is reduced or 3D is unsupported). Pure logic: librarymodel.js.
import { initSettings, store } from './shell.js';
import {
  BOOKSHOP_AFFILIATE, BOOKSHOP_DISCLOSURE, authorLine, surname, filterView, statusText, pickRandom, spineStyle, balancedRows,
  bookBox, flightStart, parseHash, buildHash, stampCard, stampDate, worldcatUrl, bookshopUrl, openLibraryUrl, coverUrl, coverFor, needsCoverApi,
} from './librarymodel.js';

initSettings();

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const svgNS = 'http://www.w3.org/2000/svg';
const CARD_KEY = 'gatecast:library-card';
const OBJECTS = { // decorative objects at the end of each bay (the board's line drawings)
  lens: ['M38 40l16 18', 'M18 22a10 10 0 0 1 8-4', 'C 26 28 16'],
  file: ['M6 24h18l5 6h29v40H6z', 'M6 34h52', 'M14 46h22', 'M14 54h30'],
  candle: ['M24 34h16v36H24z', 'M32 34v-6', 'M32 12c5 6 5 10 0 14c-5-4-5-8 0-14z', 'M16 70h32'],
  glass: ['M16 6h32', 'M16 70h32', 'M20 6c0 18 24 18 24 32s-24 14-24 32', 'M44 6c0 18-24 18-24 32s24 14 24 32'],
  flask: ['M26 6h12', 'M28 6v20L12 64a4 4 0 0 0 4 6h32a4 4 0 0 0 4-6L36 26V6', 'M18 52h28'],
  hat: ['M20 20h24v36H20z', 'M8 56h48', 'M20 46h24', 'M44 62l10 10'],
};

const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
const reduceMq = mq('(prefers-reduced-motion: reduce)');
const tapMq = mq('(max-width: 767px), (pointer: coarse)');
const has3d = !window.CSS || !CSS.supports || CSS.supports('transform-style', 'preserve-3d');
const motionOn = () => !reduceMq.matches && has3d;

const state = { data: null, shelf: 'all', query: '', covers: {}, open: null, card: [] };
const spines = new Map(); // id -> button on the shelf
const shelfOf = (id) => state.data.shelves.find((s) => s.id === id);
const bookOf = (id) => state.data.books.find((b) => b.id === id);

/* ---------- Spines and bays ---------- */

function decorate(node, st) {
  node.style.backgroundColor = st.bg;
  node.style.color = st.fg;
}

// The inside of a spine (also cloned onto the pulled-out book's spine face).
function spineInner(book, st) {
  const frag = document.createDocumentFragment();
  const cloth = el('span', 'lib-spine__cloth cloth'); frag.append(cloth);
  const deco = el('span', 'lib-spine__deco'); deco.style.background = st.trim; frag.append(deco);
  const title = el('span', 'lib-spine__title', book.title);
  Object.assign(title.style, { fontFamily: st.font, fontSize: st.fontSize + 'px', fontWeight: st.weight, textTransform: st.upper ? 'uppercase' : 'none' });
  frag.append(title);
  frag.append(el('span', 'lib-spine__author', surname(book.authors[0])));
  const foot = el('span', 'lib-spine__foot'); foot.style.background = st.foot; frag.append(foot);
  for (const n of frag.children) n.setAttribute('aria-hidden', 'true');
  return frag;
}

function makeSpine(book) {
  const st = spineStyle(book, { minWidth: tapMq.matches ? 44 : 0 });
  const b = el('button', 'lib-spine');
  b.type = 'button';
  b.dataset.book = book.id;
  b.style.width = st.width + 'px';
  b.style.height = st.height + 'px';
  decorate(b, st);
  b.append(spineInner(book, st));
  b.addEventListener('click', () => openBook(book.id, b));
  b._style = st;
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
  const root = $('lib-bays');
  root.textContent = '';
  spines.clear();
  for (const shelf of state.data.shelves) {
    const bay = el('section', 'lib-bay');
    bay.dataset.shelf = shelf.id;
    bay.setAttribute('aria-labelledby', 'shelf-' + shelf.id);
    const plate = el('div', 'lib-bay__plate');
    const h2 = el('h2', null, shelf.name); h2.id = 'shelf-' + shelf.id;
    plate.append(h2); bay.append(plate);
    const rowsWrap = el('div', 'lib-bay__rows');
    bay.append(rowsWrap);
    bay.append(el('p', 'lib-bay__note', shelf.note));
    const list = state.data.books.filter((b) => b.shelf === shelf.id).map(makeSpine);
    list.forEach((s) => spines.set(s.dataset.book, s));
    bay._spines = list;
    bay._object = shelf.object;
    root.append(bay);
  }
  layoutRows();
  applyFilter();
}

// Lays each bay's spines onto as many shelf boards as its width needs. Re-run when the bay width changes.
function layoutRows() {
  const bays = [...document.querySelectorAll('.lib-bay')];
  const visible = bays.find((b) => !b.hidden) || bays[0];
  if (!visible) return;
  const inner = Math.floor(visible.clientWidth - 28 - 24); // bay padding 14+14, shelf padding 12+12
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
    const b = el('button', 'lib-bev lib-chip', s.chip);
    b.type = 'button';
    b.dataset.shelf = s.id;
    b.addEventListener('click', () => { setShelf(s.id); writeHash(); });
    wrap.append(b);
  }
}

function setShelf(id) {
  state.shelf = id;
  for (const b of document.querySelectorAll('.lib-chip')) b.setAttribute('aria-pressed', String(b.dataset.shelf === id));
  for (const bay of document.querySelectorAll('.lib-bay')) bay.hidden = id !== 'all' && bay.dataset.shelf !== id;
  applyFilter();
}

function applyFilter() {
  const view = filterView(state.data, { shelf: state.shelf, query: state.query });
  for (const bay of view.bays) {
    for (const { book, hit } of bay.books) {
      const s = spines.get(book.id);
      if (!s) continue;
      s.classList.toggle('is-dim', !hit);
      s.setAttribute('aria-label', `${book.title}, ${authorLine(book.authors)}, ${book.year}${view.query && !hit ? ' (not a match)' : ''}. Pull it off the shelf.`);
    }
  }
  $('lib-status').textContent = statusText(view, { motion: motionOn() });
  return view;
}

/* ---------- Library card (localStorage only) ---------- */

function loadCard() {
  const raw = store.get(CARD_KEY, []);
  state.card = Array.isArray(raw) ? raw.filter((c) => c && typeof c.id === 'string' && bookOf(c.id)).slice(0, 5) : [];
}
function renderCard() {
  const list = $('card-list');
  list.textContent = '';
  for (const c of state.card) {
    const book = bookOf(c.id);
    const li = el('li');
    const b = el('button', null, book.title);
    b.type = 'button';
    b.addEventListener('click', () => pullOut(book.id));
    li.append(b, el('span', 'lib-stamp', stampDate(c.at)));
    list.append(li);
  }
  const empty = !state.card.length;
  list.hidden = empty; $('card-foot').hidden = empty; $('card-empty').hidden = !empty;
  $('card-count').textContent = empty ? 'NO STAMPS' : `${state.card.length} ${state.card.length === 1 ? 'STAMP' : 'STAMPS'}`;
}
function stamp(id) {
  state.card = stampCard(state.card, id, Date.now());
  store.set(CARD_KEY, state.card);
  renderCard();
}

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
let timers = [];
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

function fillBook(book) {
  const shelf = shelfOf(book.shelf);
  const idx = state.data.shelves.indexOf(shelf) + 1;
  const st = spineStyle(book);
  const cover = coverFor(book, state.covers);
  $('bk-name').textContent = `${book.title}, by ${authorLine(book.authors)}`;
  // Stand-in cover, in the spine's colours and type.
  const standin = $('bk-standin');
  const len = book.title.length;
  for (const [k, v] of Object.entries({ '--bg': st.bg, '--fg': st.fg, '--font': st.font, '--fw': st.weight, '--case': st.upper ? 'uppercase' : 'none',
    '--deco': st.trimIndex === 1 ? st.fg : st.trim.replace('0 0/7px 7px', '0 0/12px 12px'),
    '--cfs': ((len > 30 ? 34 : len > 16 ? 42 : 54) - (st.kind === 'slab' ? 6 : 0)) + 'px' })) standin.style.setProperty(k, String(v));
  $('bk-cover-shelf').textContent = shelf.name;
  $('bk-cover-title').textContent = book.title;
  $('bk-cover-author').textContent = authorLine(book.authors);
  front.querySelector('.lib-cover')?.remove();
  $('bk-credit').hidden = true;
  const src = coverUrl(cover);
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
  // The spine face: the shelf spine's own markup, scaled up.
  const sp = $('bk-spine');
  sp.textContent = '';
  const shelfSpine = spines.get(book.id);
  const w = shelfSpine ? shelfSpine._style.width : st.width;
  sp.style.width = w + 'px'; sp.style.height = st.height + 'px';
  decorate(sp, st);
  sp.className = 'lib-face__spine cloth';
  sp.append(spineInner(book, st));
  // The back.
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
}

function setFace(face) {
  state.open.face = face;
  // Only the side facing you can be reached: the other is inert (no focus, hidden from assistive tech).
  front.inert = face === 'back';
  back.inert = face === 'cover';
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

function placeBox() {
  const vw = dlg.clientWidth || window.innerWidth, vh = dlg.clientHeight || window.innerHeight;
  const box = bookBox(vw, vh, { controls: vw < 736 ? 84 : 88 });
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

// Resting transforms. The face toward you sits at z = 0, so at rest it is drawn at its true size on whole pixels.
const rest = (o, r) => ({ x: 0, y: 0, s: 1, z: -o.depth / 2, r });
const away = (o, r) => ({ x: o.start.dx, y: o.start.dy, s: o.start.s, z: -o.box.W / 2, r });

function openBook(id, spineEl) {
  if (state.open || !spineEl) return;
  const book = bookOf(id);
  if (!book) return;
  clearTimers();
  const flat = !motionOn();
  state.open = { id, spine: spineEl, flat, face: flat ? 'back' : 'cover' };
  fillBook(book);
  dlg.classList.toggle('is-flat', flat);
  dlg.classList.remove('is-settled');
  stamp(id);
  writeHash();
  if (flat) {
    bookEl.style.cssText = '';
    front.inert = false; back.inert = false;
    dlg.showModal();
    $('bk-close').focus();
    return;
  }
  const r = spineEl.getBoundingClientRect();
  dlg.showModal();
  const box = placeBox();
  const start = flightStart({ left: r.left, top: r.top, width: r.width, height: r.height }, box);
  state.open.start = start;
  state.open.depth = start.depth;
  bookEl.style.setProperty('--D', start.depth + 'px');
  const sp = $('bk-spine');
  sp.style.transform = `scale(${box.H / spineEl._style.height})`;
  setFace('cover');
  setTransform(away(state.open, 90));
  spineEl.classList.add('is-out');
  $('bk-close').focus({ preventScroll: true });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!state.open) return;
    setTransform(rest(state.open, -18), EASE.cover);
    dlg.classList.add('is-settled');
  }));
  later(() => { if (state.open && state.open.face === 'cover' && !state.open.closing) turn('back'); }, 1250);
}

function turn(face) {
  const o = state.open;
  if (!o || o.flat || o.closing) return;
  clearTimers();
  setFace(face);
  setTransform(rest(o, face === 'back' ? -180 : -18), EASE.turn);
}

function finish() {
  const o = state.open;
  if (!o) return;
  clearTimers();
  state.open = null;
  o.spine.classList.remove('is-out', 'is-fly');
  dlg.classList.remove('is-settled');
  if (dlg.open) dlg.close();
  bookEl.style.transition = 'none';
  front.inert = false; back.inert = false;
  writeHash();
  if (o.spine.isConnected) o.spine.focus({ preventScroll: false });
}

function closeBook(now = false) {
  const o = state.open;
  if (!o || o.closing) return;
  if (o.flat || now) { finish(); return; }
  o.closing = true;
  clearTimers();
  dlg.classList.remove('is-settled');
  setTransform(away(o, o.face === 'back' ? -270 : 90), EASE.close);
  later(finish, 560);
}

turnBtn.addEventListener('click', () => { if (state.open) turn(state.open.face === 'back' ? 'cover' : 'back'); });
$('bk-close').addEventListener('click', () => closeBook());
dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeBook(); });
dlg.addEventListener('close', () => { if (state.open) finish(); });
dlg.addEventListener('click', (e) => {
  if (e.target === dlg || (e.target instanceof Element && e.target.hasAttribute('data-close'))) closeBook();
});
window.addEventListener('resize', () => {
  const o = state.open;
  if (!o || o.flat || o.closing) return;
  placeBox();
  setTransform(rest(o, o.face === 'back' ? -180 : -18));
});

// Opens a book from anywhere (card, hash, Surprise me): show its bay, bring the spine into view, then pull it out.
function pullOut(id, { fly = false } = {}) {
  const book = bookOf(id);
  if (!book) return;
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

/* ---------- Start ---------- */

// Books with a baked cover never call the API; the rest may ask once (cached at the edge) and otherwise
// show their stand-in.
async function loadCovers() {
  if (!needsCoverApi(state.data.books)) return;
  try {
    const res = await fetch('/api/book-covers');
    if (!res.ok) return;
    const body = await res.json();
    if (body && body.covers && typeof body.covers === 'object') state.covers = body.covers;
  } catch {}
}

async function start() {
  try {
    const res = await fetch('data/books.json');
    if (!res.ok) throw new Error(String(res.status));
    state.data = await res.json();
  } catch {
    const msg = el('p', 'lib-msg', 'The shelves could not be loaded. Please try again in a moment.');
    $('lib-bays').replaceChildren(msg);
    $('lib-status').textContent = 'The shelves could not be loaded.';
    return;
  }
  renderChips();
  loadCard();
  renderCard();
  renderBays();
  setShelf(parseHash(location.hash, state.data).shelf);
  $('lib-q').addEventListener('input', (e) => { state.query = e.target.value; applyFilter(); });
  $('lib-search').addEventListener('submit', (e) => e.preventDefault());
  $('lib-surprise').addEventListener('click', () => {
    const view = filterView(state.data, { shelf: state.shelf, query: state.query });
    const all = view.bays.flatMap((b) => b.books);
    const hits = all.filter((x) => x.hit);
    const pick = pickRandom(hits.length ? hits : all);
    if (pick) pullOut(pick.book.id, { fly: true });
  });
  $('card-clear').addEventListener('click', () => { state.card = []; store.set(CARD_KEY, []); renderCard(); $('card-empty').focus(); });
  reduceMq.addEventListener?.('change', applyFilter);
  const relayout = () => {
    const visible = [...document.querySelectorAll('.lib-bay')].find((b) => !b.hidden);
    if (visible && Math.floor(visible.clientWidth - 52) !== lastInner) layoutRows();
  };
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe($('lib-bays'));
  else window.addEventListener('resize', relayout);
  tapMq.addEventListener?.('change', () => { if (!state.open) renderBays(); });
  window.addEventListener('hashchange', readHash);
  if (parseHash(location.hash, state.data).book) requestAnimationFrame(() => readHash());
  loadCovers();
}

start();
