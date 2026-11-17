// Story mode, "Gatecast TV": a reusable full-screen <dialog> that a story opens into instead of sending the reader
// away (owner request, 17 Nov 2026). It grows out of the clicked story the way a book leaves the shelf in The Stacks,
// flips the channel with a burst of static, shows a station-ident title card (the story's category, rotated, with the
// channel number), then the story as a scrolling zine spread that the caller renders. Prev / Next channel (the buttons
// and the Left / Right arrow keys) move through the stories in page order; Escape, the Close button and the browser's
// Back button close it, and focus returns to the story that opened it, with the page still where it was.
//
// Accessibility: a native modal <dialog> (the page behind is inert), labelled by the story's headline; focus moves to
// the headline on open and back to the opener on close; every control is a real button or link at least 44px; the
// title card and the static are decoration (aria-hidden), and channel changes are announced in a polite live region.
// Under prefers-reduced-motion the opener, the static and the power-off are a short cross-fade.
//
// Each story has its own address (?story=<id>, js/tvmodel.js): opening pushes it, changing channel replaces it,
// closing goes back, and opening the address directly opens the story on load. The caller supplies the content:
//   const tv = createStoryTV({ order: () => [...stories], render: (story, at) => html, afterRender(story, root) {},
//                              ident: (story, at) => ({ channel: 'CH 03', title: 'STRANGE ANIMALS', tone: 'sun' }) });
//   tv.open(id, { from: element });  tv.go(id);  tv.close();  tv.syncFromUrl();
// The styles are styles/components/tv.css.
import { channelOf, channelLabel, shareUrl, storyFromUrl, urlWithStory } from './tvmodel.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

// Static between channels: grey noise and a rolling bar on a small canvas, scaled up with crisp pixels.
function staticBurst(canvas, ms) {
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  const w = (canvas.width = 160), h = (canvas.height = 100);
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const frame = (t) => {
      const roll = Math.floor(((t / 6) % (h + 30)) - 15);
      for (let i = 0; i < px.length; i++) {
        const y = (i / w) | 0;
        let v = (Math.random() * 255) | 0;
        if (y >= roll && y < roll + 12) v = Math.min(255, v + 70);
        px[i] = (255 << 24) | (v << 16) | (v << 8) | v;
      }
      ctx.putImageData(img, 0, 0);
      if (t < end) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function createStoryTV({ order, render, afterRender = () => {}, ident = () => null, param = 'story', host = document.body, onClose = () => {} } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'stv';
  dlg.id = 'stv';
  dlg.setAttribute('aria-labelledby', 'stv-h');
  dlg.innerHTML = `<div class="stv__set">
      <div class="stv__bar">
        <p class="stv__bug" aria-hidden="true"><span class="stv__bug-gc">Gatecast</span><span class="stv__bug-tv">TV</span></p>
        <p class="stv__ch"><span class="stv__ch-n" id="stv-ch"></span><span class="stv__ch-of" id="stv-of"></span></p>
        <div class="stv__tools">
          <button type="button" class="stv__btn stv__copy" data-stv="copy">${ICON.link}<span>Copy link</span></button>
          <button type="button" class="stv__btn stv__power" data-stv="close" aria-label="Close story mode and go back to the page" aria-keyshortcuts="Escape">${ICON.power}<span>Close</span></button>
        </div>
      </div>
      <div class="stv__screen" id="stv-screen"><div class="stv__content" id="stv-content"></div></div>
      <nav class="stv__deck" aria-label="Change channel">
        <button type="button" class="stv__knob stv__knob--prev" data-stv="prev" aria-keyshortcuts="ArrowLeft">${ICON.prev}<span>Prev<span class="stv__knob-long"> channel</span></span></button>
        <span class="stv__dial" aria-hidden="true"><span class="stv__dial-face"><span class="stv__dial-n" id="stv-dial"></span></span></span>
        <button type="button" class="stv__knob stv__knob--next" data-stv="next" aria-keyshortcuts="ArrowRight"><span>Next<span class="stv__knob-long"> channel</span></span>${ICON.next}</button>
      </nav>
      <div class="stv__fx" aria-hidden="true">
        <canvas class="stv__static"></canvas>
        <div class="stv__card"><span class="stv__card-ch"></span><span class="stv__card-t"></span><span class="stv__card-sub">Gatecast TV · odd news from real outlets</span></div>
      </div>
      <p class="sr-only" id="stv-status" aria-live="polite"></p>
    </div>`;
  host.appendChild(dlg);
  const $ = (s) => dlg.querySelector(s);
  const set = $('.stv__set'), screen = $('#stv-screen'), content = $('#stv-content'), canvas = $('.stv__static');

  const state = { id: null, from: null, pushed: false, busy: false, closing: false, skip: null };

  const at = (id) => channelOf(order(), id);

  function paint(id) {
    const c = at(id);
    if (!c) return false;
    state.id = id;
    content.innerHTML = render(c.story, c);
    screen.scrollTop = 0;
    $('#stv-ch').textContent = channelLabel(c.number);
    $('#stv-of').textContent = ` of ${c.total}`;
    $('#stv-dial').textContent = String(c.number).padStart(2, '0');
    dlg.style.setProperty('--dial', `${(c.index / Math.max(1, c.total)) * 300 - 150}deg`);
    const prev = $('[data-stv="prev"]'), next = $('[data-stv="next"]');
    prev.disabled = !c.prev; next.disabled = !c.next;
    prev.setAttribute('aria-label', c.prev ? `Previous channel: ${c.prev.title}` : 'Previous channel');
    next.setAttribute('aria-label', c.next ? `Next channel: ${c.next.title}` : 'Next channel');
    const card = ident(c.story, c) || {};
    $('.stv__card-ch').textContent = card.channel || channelLabel(c.number);
    $('.stv__card-t').textContent = card.title || '';
    $('.stv__card').dataset.tone = card.tone || 'sun';
    afterRender(c.story, content, c);
    return true;
  }

  // The station ident: static, then the title card, then the spread arrives. Any key or click skips it.
  async function ident_(kind) {
    if (reduced()) { dlg.classList.add('is-fade'); await wait(160); dlg.classList.remove('is-fade'); return; }
    let skipped = false;
    state.skip = () => { skipped = true; dlg.classList.remove('is-static', 'is-ident'); dlg.classList.add('is-in'); };
    dlg.classList.remove('is-in');
    dlg.classList.add('is-static');
    await staticBurst(canvas, kind === 'open' ? 260 : 220);
    if (skipped) return;
    dlg.classList.remove('is-static');
    dlg.classList.add('is-ident');
    await wait(kind === 'open' ? 900 : 560);
    if (skipped) return;
    dlg.classList.remove('is-ident');
    dlg.classList.add('is-in');
    state.skip = null;
  }

  // The rectangle the set grows out of (and shrinks back into): the opener, when it is on screen.
  function originRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.closest('li, article, .lead__head, .ticker__list li, a')?.getBoundingClientRect?.() || el.getBoundingClientRect();
    if (!r || r.width < 4 || r.bottom < 0 || r.top > innerHeight) return null;
    return r;
  }
  const insetOf = (r) => `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px)`;

  function setUrl(id, mode) {
    const href = urlWithStory(location.href, id);
    if (!href) return;
    if (mode === 'push') history.pushState({ stv: id }, '', href);
    else history.replaceState(id ? { stv: id } : null, '', href);
  }

  async function open(id, { from = null, push = true } = {}) {
    if (dlg.open) return go(id);
    if (!paint(id)) return false;
    state.from = from || null;
    state.pushed = push;
    state.closing = false;
    if (push) setUrl(id, 'push');
    dlg.classList.remove('is-closing', 'is-in');
    dlg.showModal();
    // Focus goes to the headline, so a screen reader starts with what the story is.
    content.querySelector('#stv-h')?.focus({ preventScroll: true });
    $('#stv-status').textContent = '';
    const r = reduced() ? null : originRect(from);
    if (r && set.animate) {
      set.animate([{ clipPath: insetOf(r), filter: 'brightness(1.8)' }, { clipPath: 'inset(0px 0px 0px 0px)', filter: 'brightness(1)' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      await wait(380);
    }
    await ident_('open');
    return true;
  }

  async function go(id, { replace = true } = {}) {
    if (!dlg.open || state.busy || id === state.id) return false;
    if (!at(id)) return false;
    state.busy = true;
    if (replace) setUrl(id, 'replace');
    const quick = reduced();
    if (!quick) { dlg.classList.remove('is-in'); dlg.classList.add('is-static'); }
    else dlg.classList.add('is-fade');
    await wait(quick ? 120 : 110);
    paint(id);
    const c = at(id);
    $('#stv-status').textContent = `${channelLabel(c.number)}: ${c.story.title}`;
    content.querySelector('#stv-h')?.focus({ preventScroll: true });
    if (quick) { dlg.classList.remove('is-fade'); state.busy = false; return true; }
    dlg.classList.remove('is-static');
    await ident_('switch');
    state.busy = false;
    return true;
  }

  // Close: the picture collapses to a line and a dot, like an old set switching off, back towards the story that
  // opened it. fromHistory: the Back button already moved the address.
  async function close({ fromHistory = false } = {}) {
    if (!dlg.open || state.closing) return;
    // Opened with its own history entry: going back closes it (the popstate handler calls close({ fromHistory })).
    if (!fromHistory && state.pushed) { state.pushed = false; history.back(); return; }
    state.closing = true;
    state.skip?.();
    if (!fromHistory) setUrl(null, 'replace');
    state.pushed = false;
    if (!reduced() && set.animate) {
      dlg.classList.add('is-closing');
      const a = set.animate([
        { transform: 'scale(1, 1)', filter: 'brightness(1)', opacity: 1 },
        { transform: 'scale(1, 0.006)', filter: 'brightness(3)', opacity: 1, offset: 0.55 },
        { transform: 'scale(0.002, 0.006)', filter: 'brightness(4)', opacity: 0 },
      ], { duration: 360, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' });
      await a.finished.catch(() => {});
    } else {
      dlg.classList.add('is-fade');
      await wait(140);
    }
    dlg.close();
    dlg.classList.remove('is-closing', 'is-fade', 'is-in', 'is-static', 'is-ident');
    content.innerHTML = ''; // stops any player
    const back = state.from && state.from.isConnected ? state.from : null;
    const id = state.id;
    state.id = null; state.from = null; state.closing = false;
    onClose(id, back);
    back?.focus({ preventScroll: true });
  }

  function step(dir) {
    const c = at(state.id);
    const to = c && (dir < 0 ? c.prev : c.next);
    if (to) go(to.id);
  }

  async function copyLink() {
    const url = shareUrl(state.id, new URL('./', location.href).href);
    const status = $('#stv-status'), label = $('.stv__copy span');
    try { await navigator.clipboard.writeText(url); label.textContent = 'Link copied'; status.textContent = 'Link copied.'; }
    catch { label.textContent = 'Copy failed'; status.textContent = `Copy this link: ${url}`; }
    setTimeout(() => { label.textContent = 'Copy link'; }, 2200);
  }

  dlg.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-stv]') : null;
    if (state.skip && !b) state.skip();
    if (!b) return;
    const act = b.dataset.stv;
    if (act === 'close') close();
    else if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'copy') copyLink();
  });
  // Escape: the dialog's own cancel, turned into the animated close (and Back in the history).
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', (e) => {
    if (state.skip && e.key !== 'Tab') state.skip();
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  // Back and Forward: an entry with a story opens (or tunes to) it; one without closes story mode.
  addEventListener('popstate', (e) => {
    const id = e.state?.stv || storyFromUrl(location.href);
    if (id && at(id)) { if (dlg.open) go(id, { replace: false }); else open(id, { push: false }).then(() => { state.pushed = false; }); }
    else if (dlg.open) close({ fromHistory: true });
  });

  // The address asks for a story (a shared link): open it, without a history entry of its own; closing then removes
  // ?story= from the address. -> true when a story opened, false when the address names one that is not on the page.
  function syncFromUrl() {
    const id = storyFromUrl(location.href);
    if (!id) return null;
    if (!at(id)) return false;
    history.replaceState({ stv: id }, '', location.href);
    open(id, { push: false });
    return true;
  }

  // Draw the current story again (a picture that failed to load, new vote counts).
  const refresh = () => { if (dlg.open && state.id) paint(state.id); };

  return { open, go, close, refresh, syncFromUrl, isOpen: () => dlg.open, current: () => state.id, element: dlg, param, esc };
}
