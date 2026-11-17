// The Stacks: a book's Preview sheet (library.html #bk-preview), with up to two tabs that exist only when the book
// has approved data in data/books.json: Watch (an official video) and Look inside (the publisher's pages through
// Google Books, or the Internet Archive's reader). What each tab shows, and what it loads, comes from watchView and
// lookView in librarymodel.js. Nothing third-party loads before a click:
// - Watch shows a facade (the video still from i.ytimg.com, a brass play button, title, channel, duration, label);
//   only Play inserts the youtube-nocookie.com player. C-SPAN, PBS and Criterion are links out, never embedded.
// - Look inside shows a facade until the tab is clicked (or its button pressed); only then does it load Google's
//   viewer script or the Internet Archive's embed.
// Leaving a tab, leaving the Preview or closing the book removes the player and the viewer.
// Tabs follow the ARIA tabs pattern with manual activation: arrows, Home and End move focus (roving tabindex);
// Enter, Space or a click selects, because selecting Look inside is what loads it.
import { previewTabs, previewNote, watchView, lookView, PREVIEW_URLS } from './librarymodel.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const svg = (paths, cls) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
  for (const d of paths) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
};
const GB_TIMEOUT = 15000;

// Google's viewer script, loaded once, on demand. Resolves with google.books once its viewer API is ready.
let gbReady = null;
function loadGoogleBooks() {
  if (window.google?.books?.DefaultViewer) return Promise.resolve(window.google.books);
  if (!gbReady) {
    gbReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PREVIEW_URLS.gbScript;
      s.async = true;
      s.onload = () => {
        try { window.google.books.load(); window.google.books.setOnLoadCallback(() => resolve(window.google.books)); } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('Google Books did not load'));
      document.head.append(s);
      setTimeout(() => reject(new Error('Google Books took too long')), GB_TIMEOUT);
    }).catch((e) => { gbReady = null; throw e; });
  }
  return gbReady;
}

export function createPreview(root) {
  const $ = (id) => root.querySelector('#' + id);
  const IDS = ['watch', 'look'];
  const tabs = { watch: $('pv-tab-watch'), look: $('pv-tab-look') };
  const panels = { watch: $('pv-watch'), look: $('pv-look') };
  const tablist = $('pv-tabs');
  let book = null, list = [], selected = null, token = 0;
  const state = { played: false, opened: false };

  // Removes the player and the viewer (and ignores any answer still on its way from Google).
  function teardown() {
    token++;
    state.played = false; state.opened = false;
    for (const id of IDS) panels[id].textContent = '';
  }

  function setBook(b, shelfName = '') {
    teardown();
    book = b;
    list = previewTabs(b).map((t) => t.id);
    for (const id of IDS) tabs[id].hidden = !list.includes(id);
    $('pv-kicker').textContent = ('Preview · ' + shelfName).toUpperCase();
    $('pv-title').textContent = b.title;
    $('pv-note').textContent = previewNote(b);
    selected = list[0] || null;
    root.hidden = true;
    return list.length > 0;
  }

  function select(id, { focus = false, activate = false } = {}) {
    if (!list.includes(id)) return;
    if (selected !== id || !panels[id].childElementCount) {
      teardown();
      selected = id;
      for (const k of IDS) {
        const on = k === id;
        tabs[k].setAttribute('aria-selected', String(on));
        tabs[k].tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
      }
      root.dataset.tab = id;
      if (id === 'watch') renderWatch(); else renderLook(activate);
    } else if (id === 'look' && activate && !state.opened) renderLook(true);
    if (focus) tabs[id].focus({ preventScroll: true });
  }

  /* ---------- Watch ---------- */

  function renderWatch() {
    const v = watchView(book);
    const panel = panels.watch;
    panel.textContent = '';
    if (!v) return;
    const fig = el('figure', 'lib-watch');
    const frame = el('div', 'lib-watch__frame');
    const standin = el('div', 'lib-watch__standin');
    standin.setAttribute('aria-hidden', 'true');
    standin.append(el('span', null, v.kind !== 'youtube' ? v.site : v.label.toUpperCase()), el('b', null, book.title));
    frame.append(standin);
    if (v.kind === 'youtube') {
      const play = el('button', 'lib-watch__play');
      play.type = 'button';
      play.setAttribute('aria-label', v.playLabel);
      if (v.poster) {
        const img = el('img', 'lib-watch__poster');
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => img.remove());
        img.src = v.poster;
        play.append(img);
      }
      const knob = el('span', 'lib-watch__knob');
      knob.append(svg(['M7 4.5v15l13-7.5z']));
      play.append(knob);
      if (v.duration) {
        play.append(el('span', 'lib-watch__dur', v.duration));
        play.lastChild.setAttribute('aria-hidden', 'true');
      }
      play.addEventListener('click', () => playVideo(frame, v));
      frame.append(play);
    } else {
      // C-SPAN, PBS, Criterion: no embed, a clear way out.
      const out = el('a', 'lib-brass lib-watch__out', v.linkText);
      out.href = v.link; out.target = '_blank'; out.rel = 'noopener';
      out.setAttribute('aria-label', v.playLabel);
      const wrap = el('div', 'lib-watch__play');
      wrap.append(out);
      frame.append(wrap);
    }
    fig.append(frame);
    const cap = el('figcaption', 'lib-watch__cap');
    cap.append(el('span', 'lib-watch__label', v.label), el('span', 'lib-watch__title', v.title));
    const meta = el('span', 'lib-watch__meta', `${v.channel} · ${v.duration ? `${v.duration} · ` : ''}`);
    const link = el('a', null, v.linkText);
    link.href = v.link; link.target = '_blank'; link.rel = 'noopener';
    meta.append(link);
    cap.append(meta);
    if (v.note) cap.append(el('span', 'lib-watch__note', v.note));
    cap.append(el('span', 'lib-watch__meta', v.kind !== 'youtube' ? `${v.credit}. ${v.site} videos open on its own site.` : v.credit));
    fig.append(cap);
    panel.append(fig);
  }

  function playVideo(frame, v) {
    const played = watchView(book, { played: true });
    if (!played?.embed) return;
    state.played = true;
    const f = el('iframe', 'lib-watch__player');
    f.title = `Video: ${v.title}`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.src = played.embed;
    frame.replaceChildren(f);
    f.focus();
  }

  /* ---------- Look inside ---------- */

  function renderLook(opened) {
    const v = lookView(book, { opened });
    const panel = panels.look;
    panel.textContent = '';
    if (!v) return;
    const wrap = el('div', 'lib-look');
    const frame = el('div', 'lib-look__frame');
    wrap.append(frame, el('p', 'lib-preview__small', v.credit));
    panel.append(wrap);
    if (!opened) {
      const facade = el('div', 'lib-look__facade');
      facade.append(el('p', null, `Read a few pages of ${book.title}, shared by the publisher through ${v.source}. They load from ${v.source} when you open them.`));
      const go = el('button', 'lib-brass', 'Open the pages');
      go.type = 'button';
      go.setAttribute('aria-label', `Open the pages of ${book.title} from ${v.source}`);
      go.addEventListener('click', () => { renderLook(true); tabs.look.focus({ preventScroll: true }); });
      facade.append(go);
      frame.append(facade);
      return;
    }
    state.opened = true;
    if (v.iframe) {
      const f = el('iframe');
      f.title = `Look inside ${book.title} (Internet Archive)`;
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.src = v.iframe;
      frame.append(f);
      return;
    }
    // Google Books: the viewer draws into its own element; a calm message if the publisher shares nothing.
    const t = token;
    const status = el('div', 'lib-look__msg');
    status.setAttribute('role', 'status');
    status.append(el('p', null, 'Opening the pages from Google Books…'));
    frame.append(status);
    const message = (head, text) => {
      if (t !== token) return;
      const m = el('div', 'lib-look__msg');
      m.setAttribute('role', 'status');
      m.append(el('b', null, head), el('p', null, text));
      frame.replaceChildren(m);
    };
    loadGoogleBooks().then((gb) => {
      if (t !== token) return;
      const canvas = el('div', 'lib-look__viewer');
      frame.append(canvas);
      const viewer = new gb.DefaultViewer(canvas);
      viewer.load(v.volumeId,
        () => message('No preview from the publisher', 'Google Books has no pages to show for this book. Your library may have a copy.'),
        () => { if (t === token) status.remove(); });
    }).catch(() => message('The pages did not load', 'Google Books could not be reached just now. Please try again later.'));
  }

  /* ---------- Keyboard: roving tabindex, manual activation ---------- */

  for (const id of IDS) tabs[id].addEventListener('click', () => select(id, { activate: true }));
  tablist.addEventListener('keydown', (e) => {
    const visible = IDS.filter((id) => list.includes(id)).map((id) => tabs[id]);
    const i = visible.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: visible.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = visible[(to + visible.length) % visible.length];
    for (const t of visible) t.tabIndex = t === next ? 0 : -1;
    next.focus();
  });
  // Leaving the tab row: Tab comes back to the selected tab.
  tablist.addEventListener('focusout', (e) => {
    if (tablist.contains(e.relatedTarget)) return;
    for (const id of IDS) tabs[id].tabIndex = id === selected ? 0 : -1;
  });

  return {
    setBook,
    has: () => list.length > 0,
    tab: () => selected,
    // Shows the sheet on its last tab (the first, for a new book) and focuses that tab.
    show() {
      if (!list.length) return;
      root.hidden = false;
      select(selected || list[0], { focus: true });
    },
    hide() { teardown(); root.hidden = true; },
  };
}
