// Motion helpers for the weather board. No library: the Web Animations API, view transitions and CSS.
// Every helper falls back to an instant change when the visitor asks for reduced motion, so behaviour
// is identical with or without animation. Timings come from the tokens in styles/tokens.css and the
// motion tokens at the top of styles/motion.css.

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reducedQuery.matches;

let tokenCache;
function tok() {
  if (tokenCache) return tokenCache;
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const ms = (name, fallback) => parseFloat(v(name, '')) || fallback;
  tokenCache = {
    fast: ms('--duration-fast', 120), base: ms('--duration-base', 240), move: ms('--duration-move', 300),
    out: v('--ease-out', 'ease-out'), in: v('--ease-in', 'ease-in'), spring: v('--ease-spring', 'ease-out'),
    lift: parseFloat(v('--lift-scale', '1.03')) || 1.03, tilt: v('--lift-tilt', '-1deg'),
  };
  return tokenCache;
}

/* ---------- Layout changes ---------- */

// Animates elements from where they were to where `change` puts them (First, Last, Invert, Play).
// Reads layout twice per call (before and after the change), never per frame. Animates transform only.
export function flip(elements, change, { scale = true, duration } = {}) {
  if (reduced()) { change(); return; }
  const els = [...elements];
  const first = new Map();
  for (const el of els) if (!el.hidden) first.set(el, el.getBoundingClientRect()); // includes any glide in progress
  for (const el of els) for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
  change();
  const t = tok(), d = duration ?? t.move;
  for (const el of els) {
    if (el.hidden || !el.isConnected) continue;
    const a = first.get(el), b = el.getBoundingClientRect();
    if (!a) { // newly shown: fade up in place
      el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { id: 'flip', duration: d, easing: t.out });
      continue;
    }
    const dx = a.left - b.left, dy = a.top - b.top;
    const sx = scale && b.width ? a.width / b.width : 1, sy = scale && b.height ? a.height / b.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue;
    el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { id: 'flip', duration: d, easing: t.out });
  }
}

// A modal or its closing transition is on screen. View transitions paint above the top layer, so
// while a sheet shows, layout changes animate in the page itself (behind the frosted backdrop).
function overlayShowing() {
  for (const d of document.querySelectorAll('dialog')) if (d.open || getComputedStyle(d).display !== 'none') return true;
  return false;
}

// Board layout changes: a view transition (boxes glide and grow, contents cross-fade), or FLIP when a
// sheet is over the page, or an instant change under reduced motion.
export function morph(change, items = () => document.querySelectorAll('[data-tile]')) {
  if (reduced()) return change();
  if (!document.startViewTransition || overlayShowing()) return flip(items(), change);
  document.startViewTransition(change);
}

/* ---------- First load ---------- */

let entered = false;
// Plays once per page load, when the first forecast arrives: a short staggered arrival (CSS, keyed on
// the .motion-enter class) and, when countUp() says so (the page allows it once a day), the big
// temperature counting up to its value. Otherwise the temperature is readable at once: it skips the fade.
export function enter(root = document.documentElement, { countUp: shouldCount = () => true } = {}) {
  if (entered) return;
  entered = true;
  if (reduced()) return;
  root.classList.add('motion-enter');
  setTimeout(() => root.classList.remove('motion-enter'), 1000);
  const temp = document.querySelector('.hero-wx__temp');
  if (!temp) return;
  if (shouldCount()) countUp(temp);
  else for (const a of temp.closest('.hero-wx__now')?.getAnimations() ?? []) a.finish();
}

function countUp(el, duration = 480) {
  const text = el.textContent, m = text.match(/-?\d+/);
  if (!m) return;
  const to = +m[0];
  if (Math.abs(to) < 3) return;
  // The hero is a live region: hold announcements until the number settles, and lock the width
  // (one read) so the counting digits never push the condition beside it.
  const live = el.closest('[aria-live]');
  live?.setAttribute('aria-busy', 'true');
  el.style.width = `${el.getBoundingClientRect().width}px`;
  el.style.whiteSpace = 'nowrap';
  const t0 = performance.now();
  const done = () => { live?.removeAttribute('aria-busy'); if (el.isConnected) { el.textContent = text; el.style.width = ''; el.style.whiteSpace = ''; } };
  const step = () => {
    if (!el.isConnected) return done(); // re-rendered meanwhile (units changed): the new text is already right
    const p = Math.min(1, Math.max(0, (performance.now() - t0) / duration)), e = 1 - (1 - p) ** 3;
    el.textContent = text.replace(m[0], String(Math.round(to * e)));
    if (p < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
}

/* ---------- Small reactions ---------- */

// Adds a class for one short reaction (CSS keys its keyframes on it), then removes it.
export function react(el, cls, ms = 900) {
  if (!el || reduced()) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation if it is still running
  el.classList.add(cls);
  clearTimeout(el[`_${cls}`]);
  el[`_${cls}`] = setTimeout(() => el.classList.remove(cls), ms);
}

// Something just landed on the shelf: the shelf glows briefly and the chip pops in.
export function landOnShelf(shelf, id) {
  react(shelf, 'is-landed', 700);
  react(shelf.querySelector(`[data-jump="${CSS.escape(id)}"]`), 'is-new', 700);
}

/* ---------- Dragging: the box lifts and follows the pointer ---------- */

let settling = null; // the previous drop's landing, finished at once if a new drag starts

// Lifts a floating copy of `el` under the pointer. Reads layout once here; move() only writes a transform.
export function lift(el, x, y, { shelf } = {}) {
  settling?.();
  const t = tok(), r = el.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.removeAttribute('id'); g.removeAttribute('data-tile'); g.removeAttribute('tabindex');
  for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
  g.classList.remove('is-dragging', 'is-flash');
  g.classList.add('drag-ghost');
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  // Large boxes shrink a little as they lift, so the board stays visible around them.
  const s = Math.max(0.45, Math.min(t.lift, 600 / r.width, 440 / r.height));
  let k = s; // current scale: smaller while over the shelf
  const ox = x - r.left, oy = y - r.top; // grab point stays under the pointer
  Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px`, transformOrigin: `${ox}px ${oy}px`, translate: `${r.left}px ${r.top}px`, viewTransitionName: 'none', scale: String(s), rotate: reduced() ? '0deg' : t.tilt });
  document.body.append(g);
  if (!reduced()) g.animate([{ scale: 1, rotate: '0deg' }, { scale: s, rotate: t.tilt }], { duration: t.base, easing: t.spring });
  const zoneBottom = shelf && !shelf.hidden ? shelf.getBoundingClientRect().top : innerHeight;
  let px = x, py = y;
  const gone = () => { g.remove(); };

  return {
    move(nx, ny) { px = nx; py = ny; g.style.translate = `${px - ox}px ${py - oy}px`; },
    // Over the shelf the box shrinks toward the pointer: it will become a shortcut, not move.
    overShelf(on) { const n = on ? Math.min(s, 0.5) : s; if (n !== k) { k = n; g.style.scale = String(k); } },
    // Scrolls the page when the pointer rests near the top, or just above the shelf. Returns true if it scrolled.
    autoScroll() {
      const zone = 64;
      let dy = 0;
      if (py < zone) dy = -Math.ceil((zone - py) / zone * 16);
      else if (py > zoneBottom - zone && py < zoneBottom) dy = Math.ceil((py - (zoneBottom - zone)) / zone * 16);
      if (!dy) return false;
      const before = scrollY;
      scrollBy(0, dy);
      return scrollY !== before;
    },
    // Lands the box in its slot, then calls done (which reveals the real box).
    settle(slot, done) {
      for (const a of slot.getAnimations()) a.finish();
      const to = slot.getBoundingClientRect();
      if (reduced()) { gone(); done(); return; }
      const anim = g.animate([
        { translate: g.style.translate, scale: k, rotate: t.tilt },
        { translate: `${to.left}px ${to.top}px`, scale: 1, rotate: '0deg' },
      ], { duration: t.base, easing: t.out, fill: 'forwards' });
      const finish = () => { if (settling !== finish) return; settling = null; anim.cancel(); gone(); done(); };
      settling = finish;
      anim.finished.then(finish, () => {});
    },
    // Shrinks the box into a point (the new shelf chip), while the real box fades back into the board.
    flyTo(target, slot, done) {
      done();
      if (reduced() || !target) { gone(); return; }
      const to = target.getBoundingClientRect();
      slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: t.base, easing: t.out });
      const anim = g.animate([
        { translate: g.style.translate, scale: k, opacity: 1 },
        { translate: `${to.left + to.width / 2 - ox}px ${to.top + to.height / 2 - oy}px`, scale: 0.12, opacity: 0 },
      ], { duration: t.base, easing: t.in, fill: 'forwards' });
      const finish = () => { if (settling !== finish) return; settling = null; anim.cancel(); gone(); };
      settling = finish;
      anim.finished.then(finish, () => {});
    },
  };
}
