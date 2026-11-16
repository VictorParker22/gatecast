// Motion for the Today page. No library: CSS keyframes keyed on a class, and the Web Animations API.
// Everything is skipped when the visitor asks for reduced motion, so the page reads the same without it.
// Timings come from the tokens in styles/tokens.css and the motion tokens at the top of styles/motion.css.

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reducedQuery.matches;

let entered = false;
// Plays once per page load, when the first forecast arrives: a short staggered arrival (CSS, keyed on
// the .motion-enter class) and, when countUp() says so (the page allows it once a day), the temperature
// in the glass card counting up to its value. Otherwise the temperature is readable at once.
export function enter(root = document.documentElement, { countUp: shouldCount = () => true } = {}) {
  if (entered) return;
  entered = true;
  if (reduced()) return;
  root.classList.add('motion-enter');
  setTimeout(() => root.classList.remove('motion-enter'), 1000);
  const temp = document.querySelector('.now__temp');
  if (temp && shouldCount()) countUp(temp);
}

function countUp(el, duration = 480) {
  const text = el.textContent, m = text.match(/-?\d+/);
  if (!m) return;
  const to = +m[0];
  if (Math.abs(to) < 3) return;
  // Lock the width (one read) so the counting digits never push the condition beside it.
  el.style.width = `${el.getBoundingClientRect().width}px`;
  el.style.whiteSpace = 'nowrap';
  el.setAttribute('aria-hidden', 'true'); // the hour list and condition carry the reading meanwhile
  const t0 = performance.now();
  const done = () => { if (el.isConnected) { el.textContent = text; el.style.width = ''; el.style.whiteSpace = ''; el.removeAttribute('aria-hidden'); } };
  const step = () => {
    if (!el.isConnected) return; // re-rendered meanwhile (units changed): the new text is already right
    const p = Math.min(1, Math.max(0, (performance.now() - t0) / duration)), e = 1 - (1 - p) ** 3;
    el.textContent = text.replace(m[0], String(Math.round(to * e)));
    if (p < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
}
