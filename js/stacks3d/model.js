// The Stacks in 3D: pure logic shared by the WebGL scene, the DOM shelves and the tests (no DOM, no three.js).
// The look of each book (cloth or leather, foil, bands, size) is derived from its id, so a book keeps its
// binding when others are added or reordered. Units in the scene are metres.
import { hashId, spineStyle } from '../librarymodel.js';

/* ---------- Bindings ---------- */

// Book cloth and leather, each with the foil its title is stamped in. Muted, aged library colours. No bright
// red, orange/amber or teal (those hues mean risk on Gatecast); oxblood is allowed as a dark leather tone.
// Every base/foil pair is at least 4.5:1 so the DOM shelves stay readable (tested).
export const BINDINGS = [
  { name: 'navy cloth', kind: 'cloth', base: '#26395E', foil: '#E2C47A', metal: true },
  { name: 'forest cloth', kind: 'cloth', base: '#2C4A35', foil: '#E2C47A', metal: true },
  { name: 'oxblood leather', kind: 'leather', base: '#4A1E1E', foil: '#D9BA6E', metal: true },
  { name: 'plum cloth', kind: 'cloth', base: '#4B2C48', foil: '#E2C47A', metal: true },
  { name: 'slate cloth', kind: 'cloth', base: '#36424F', foil: '#EDE3C8', metal: false },
  { name: 'black leather', kind: 'leather', base: '#1C1915', foil: '#D9BA6E', metal: true },
  { name: 'brown leather', kind: 'leather', base: '#4B3221', foil: '#E2C47A', metal: true },
  { name: 'olive cloth', kind: 'cloth', base: '#46462A', foil: '#EDE3C8', metal: false },
  { name: 'tan buckram', kind: 'cloth', base: '#B49A6A', foil: '#1E1A14', metal: false },
  { name: 'mustard cloth', kind: 'cloth', base: '#B8953F', foil: '#15120E', metal: false },
  { name: 'sage cloth', kind: 'cloth', base: '#4E6448', foil: '#F0E6CB', metal: false },
  { name: 'midnight cloth', kind: 'cloth', base: '#172036', foil: '#C9CED6', metal: true },
  { name: 'burgundy cloth', kind: 'cloth', base: '#4C2233', foil: '#D9BA6E', metal: true },
  { name: 'dusty blue cloth', kind: 'cloth', base: '#33557E', foil: '#F0E6CB', metal: false },
  { name: 'charcoal cloth', kind: 'cloth', base: '#2B2B2E', foil: '#D9BA6E', metal: true },
  { name: 'violet cloth', kind: 'cloth', base: '#45366A', foil: '#E2C47A', metal: true },
  { name: 'vellum', kind: 'leather', base: '#E3D6B8', foil: '#2A1D0A', metal: false },
];
export const BANDS = ['rules', 'panel', 'blocks', 'plain', 'rules'];

const pickFrom = (h0, salt, n) => (Math.imul(h0 ^ salt, 0x9e3779b1) >>> 0) % n;

// Everything about one book's binding, in metres for the scene and px for the DOM spine.
export const BOOK_TALL = 1.4;
export function bookLook(book) {
  const h0 = hashId(book.id);
  const st = spineStyle(book);
  const binding = BINDINGS[pickFrom(h0, 0x11, BINDINGS.length)];
  // A contrasting second cloth for the blocks/panel style, never the same as the base.
  let second = BINDINGS[pickFrom(h0, 0x12, BINDINGS.length)];
  if (second === binding) second = BINDINGS[(BINDINGS.indexOf(binding) + 5) % BINDINGS.length];
  const thick = round3(0.058 + ((st.width - 30) / 22) * 0.034);
  // Tall books, as in the owner's design (18 Nov 2026): 0.31 to 0.41 m in a 0.5 m shelf opening, a spine about five
  // times as tall as it is wide. The cover keeps a book's usual shape (about 2 : 3), so the book is deeper too.
  const height = round3((0.22 + ((st.height - 206) / 51) * 0.075) * BOOK_TALL);
  return {
    id: book.id, binding, second, band: BANDS[pickFrom(h0, 0x13, BANDS.length)], font: st.kind,
    wear: 0.25 + pickFrom(h0, 0x14, 60) / 100, // 0.25..0.84
    thick, height, depth: round3(Math.min(0.27, height / 1.42)),
    px: { width: st.width, height: st.height },
  };
}
const round3 = (n) => Math.round(n * 1000) / 1000;

/* ---------- Bookcases ---------- */

// One bay (bookcase), in metres. y = 0 is the floor, z = 0 the front edge of the shelves.
export const BAY = {
  width: 0.68, side: 0.03, depth: 0.3, gap: 0.06, board: 0.025, clear: 0.5,
  floors: [0.615, 0.09], // the top of the board each row of books stands on: upper row, lower row
  header: [1.115, 1.22], cornice: 1.26, height: 1.26,
};
BAY.inner = BAY.width - 2 * BAY.side;
BAY.pitch = BAY.width + BAY.gap;
// Room kept above the cases for the Book of the Week on its stand and the figurines on the cornices (m).
export const HEADROOM = 0.36;
// The world rectangle the camera fits into the page's reserved frame: n bays plus a margin, from just under the
// floor to the headroom over the cornices. Its centre height is FRAME_CY (the camera looks at it level).
export const frameWorld = (n) => ({ w: round3(spanOf(n) + 0.08), h: round3(BAY.height + HEADROOM + 0.03) });
export const FRAME_CY = round3((BAY.height + HEADROOM) / 2);
// The frame shapes the stylesheet reserves (.lib-cases aspect-ratio, styles/components/library.css), widest first:
// 3 bays from 940px, 2 from 600px, 1 below (the design shows three; a 4-bay frame still fits if the CSS reserves one). Tested against the CSS.
export const MAX_BAYS = 4;

export const bayX = (i, count = 6) => round3((i - (count - 1) / 2) * BAY.pitch);
// Width of n bays side by side.
export function spanOf(n) { return n * BAY.width + (n - 1) * BAY.gap; }

// Packs a bay's two rows edge to edge, like a real library shelf: the bay's own books in their order (at most 5
// on the upper row), then blank old volumes ("fillers": no titles, not interactive) up to the props, which keep
// `propWidths[row]` at the far end. The lower row of every other bay runs right to left. The last filler leans
// into whatever gap is left. x is the centre relative to the bay centre; lean in radians (+ = top toward +x).
export function layoutBay(looks, bayIndex = 0, propWidths = [0.18, 0.18]) {
  const inner = BAY.inner, pad = 0.01, gap = 0.002;
  const nTop = Math.min(5, Math.ceil(looks.length / 2));
  const rows = [looks.slice(0, nTop), looks.slice(nTop)];
  const placed = [], fillers = [], free = [];
  rows.forEach((row, r) => {
    const dir = r === 1 && bayIndex % 2 === 1 ? -1 : 1; // +1: from the left edge rightward
    const startEdge = -dir * (inner / 2 - pad);
    const booksW = row.reduce((t, b) => t + b.thick + gap, 0);
    const propW = Math.max(0, Math.min(propWidths[r] || 0, inner - 2 * pad - booksW)); // props shrink before books move
    const limit = inner - 2 * pad - propW; // length the books and fillers may take
    let used = 0;
    const put = (thick) => { const c = startEdge + dir * (used + thick / 2); used += thick + gap; return round3(c); };
    row.forEach((b) => placed.push({ id: b.id, row: r, x: put(b.thick), lean: 0 }));
    // Fillers: deterministic sizes from the bay and row.
    let k = 0;
    while (true) {
      const h = hashId(`filler-${bayIndex}-${r}-${k}`);
      const thick = round3(0.03 + (h % 29) / 1000);
      if (used + thick > limit - 0.004) break;
      fillers.push({ id: `filler-${bayIndex}-${r}-${k}`, row: r, x: put(thick), thick, height: round3((0.2 + ((h >>> 5) % 80) / 1000) * BOOK_TALL), depth: round3(0.17 + ((h >>> 11) % 60) / 1000), tone: (h >>> 17) % 6, lean: 0 });
      k++;
    }
    const left = limit - used;
    const last = fillers.filter((f) => f.row === r).pop();
    if (last && left > 0.012) last.lean = dir * Math.min(0.2, Math.asin(Math.min(1, (left - 0.004) / last.height)));
    const propStart = startEdge + dir * (inner - 2 * pad - propW);
    const propEnd = dir * (inner / 2 - pad);
    free.push({ row: r, x0: round3(Math.min(propStart, propEnd)), x1: round3(Math.max(propStart, propEnd)) });
  });
  return { placed, fillers, free };
}

/* ---------- Camera framing ---------- */

// Fits a world rectangle (worldW x worldH metres, centred on the camera's axis) into a pixel rectangle of the
// canvas. Returns the camera distance and the lens shift (in NDC) that puts the rectangle's centre on the
// rectangle's pixel centre, so the bookcases line up with the DOM region reserved for them.
export function frameCamera({ canvasW, canvasH, rect, worldW, worldH, fov }) {
  const t = Math.tan((fov * Math.PI) / 360);
  const perPx = Math.max(worldW / rect.w, worldH / rect.h); // metres per CSS px at the bookcase plane
  const distance = (perPx * canvasH) / (2 * t);
  const ndcX = (2 * (rect.x + rect.w / 2)) / canvasW - 1;
  const ndcY = 1 - (2 * (rect.y + rect.h / 2)) / canvasH;
  return { distance, shiftX: ndcX, shiftY: ndcY, perPx };
}

// How many bays fit the reserved frame (w x h CSS px): the most bays, up to MAX_BAYS, whose world rectangle is no
// wider in shape than the frame (5% slack for rounding in the stylesheet's aspect ratios).
export function fitBays(w, h, max = MAX_BAYS) {
  const ar = w / Math.max(1, h);
  for (let n = max; n > 1; n--) { const f = frameWorld(n); if (f.w / f.h <= ar * 1.05) return n; }
  return 1;
}

// How many bays to show at once, given how many fit and how many shelves there are: as few pages as possible, then
// pages that divide the shelves evenly (no bay shown on two pages), then the wider view. 8 shelves in a 4-wide frame
// are two pages of 4; 6 shelves in the same frame are two pages of 3, not 4 + an overlapping 4.
export function visibleBays(fit, count) {
  const n = Math.max(1, count | 0);
  const top = Math.max(1, Math.min(fit | 0, n));
  let best = top, bestKey = null;
  for (let v = top; v >= Math.max(1, top - 1); v--) {
    const pages = Math.ceil(n / v), waste = pages * v - n;
    const key = [pages, waste, -v];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = v; bestKey = key; }
  }
  return best;
}

// Where the Book of the Week stands: on the cornices at the centre of the first page, so it is the first thing in
// view at every width (on top of bay 0 on a phone, bay 1 of three, straddling bays 1 and 2 of four). `bay` is the
// bay whose page shows it.
export function featuredSpot(visible, count) {
  const v = Math.max(1, Math.min(visible, count));
  return { x: windowX(0, v, count), bay: Math.floor((v - 1) / 2) };
}

// Which end of its cornice a bay's figurine stands on: away from the Book of the Week (-1 left, +1 right), so the
// two never touch. Bays left of the stand put theirs on the left; the bay under it and those to the right, right.
export function figurineSide(i, count, featuredX) {
  return bayX(i, count) < featuredX - 1e-6 ? -1 : 1;
}

// The picture lamps over the cases, as offsets from the middle of the window in bay pitches: one over each bay in
// view (up to four), and the spare ones over the next bays out, so a pan never slides into the dark.
export function lampOffsets(visible, lamps = 4) {
  const v = Math.max(1, Math.min(visible, lamps));
  const own = Array.from({ length: v }, (_, k) => k - (v - 1) / 2);
  const spare = [];
  for (let d = 1; own.length + spare.length < lamps; d++) {
    spare.push((v - 1) / 2 + d);
    if (own.length + spare.length < lamps) spare.push(-(v - 1) / 2 - d);
  }
  return [...own, ...spare];
}

// Which bays a window of `visible` bays shows so that bay `index` is in it, as the index of the first bay.
// The window stays on whole pages of `visible` when it can (bays 0-2, 3-5), so chips and arrows agree.
export function windowFor(index, visible, count = 6) {
  if (visible >= count) return 0;
  const page = Math.floor(index / visible) * visible;
  return Math.max(0, Math.min(count - visible, page));
}
export const pageCount = (visible, count = 6) => Math.ceil(count / visible);

// Camera x for a window starting at bay `first`.
export const windowX = (first, visible, count = 6) => round3((bayX(first, count) + bayX(first + visible - 1, count)) / 2);

/* ---------- Pull and flick ---------- */

export const PULL = {
  maxOut: 0.17, // how far a book slides out of the shelf before it leaves it (m)
  pxForFull: 150, // pointer travel (CSS px) that pulls a book all the way out
  leave: 0.72, // released beyond this fraction of maxOut, the book comes off the shelf
  flickSpeed: 0.75, // px per ms over the last ~90 ms: a flick
  clickMove: 6, // px: below this a press is a click, not a drag
  clickTime: 450, // ms
};

// Pointer travel to how far the book is out (0..1), with resistance: it gets harder toward the end.
export function pullFraction(travelPx) {
  const x = Math.max(0, travelPx) / PULL.pxForFull;
  return Math.min(1, (1 - Math.exp(-1.6 * x)) / (1 - Math.exp(-1.6)));
}

// Speed of the pointer over the last `windowMs`, from samples [{t, x, y}] (newest last).
export function pointerSpeed(samples, windowMs = 90) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) { if (last.t - samples[i].t > windowMs) break; first = samples[i]; }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return Math.hypot(last.x - first.x, last.y - first.y) / dt;
}

// What a release does: 'click' (pull out), 'flick' (fly out), 'out' (pulled far enough) or 'back' (slide home).
export function releaseAction({ travel, duration, speed, fraction }) {
  if (travel < PULL.clickMove && duration < PULL.clickTime) return 'click';
  if (speed >= PULL.flickSpeed && fraction > 0.08) return 'flick';
  if (fraction >= PULL.leave) return 'out';
  return 'back';
}

// One step of a damped spring (semi-implicit Euler). Returns the new { x, v }.
export function springStep({ x, v }, target, dt, k = 170, c = 16) {
  const a = -k * (x - target) - c * v;
  const nv = v + a * dt;
  return { x: x + nv * dt, v: nv };
}
export const springAtRest = ({ x, v }, target, eps = 1e-4) => Math.abs(x - target) < eps && Math.abs(v) < eps * 10;

/* ---------- Performance governor ---------- */

// 'dom' (today's DOM shelves), 'low' (3D, no bloom/DoF/shadows, small textures) or 'high'.
export function decideTier({ webgl2 = false, reducedMotion = false, saveData = false, deviceMemory, cores, mobile = false, override = null } = {}) {
  if (override === 'dom' || override === 'low' || override === 'high') return override === 'dom' || webgl2 ? override : 'dom';
  if (!webgl2 || reducedMotion || saveData) return 'dom';
  if ((deviceMemory != null && deviceMemory < 2) || (cores != null && cores < 3)) return 'dom';
  if (mobile || (deviceMemory != null && deviceMemory <= 4) || (cores != null && cores <= 4)) return 'low';
  return 'high';
}

// Pixel ratio for the canvas: at most 2 on desktop and 1.5 on phones / low tier, and never more than a pixel
// budget for the whole canvas (big screens at 2x would otherwise shade 15+ million pixels a frame).
export function renderScale({ w, h, dpr = 1, tier = 'high', mobile = false }) {
  const cap = tier === 'high' && !mobile ? 2 : 1.5;
  const budget = tier === 'high' ? 4.2e6 : 2.2e6;
  const byBudget = Math.sqrt(budget / Math.max(1, w * h));
  return Math.max(0.75, Math.round(Math.min(dpr, cap, byBudget) * 100) / 100);
}

// Frame pacing: full rate while something moves, ~20 fps for the candle and dust when idle, nothing when hidden.
export function frameInterval({ moving, visible, tier }) {
  if (!visible) return Infinity;
  if (moving) return 0;
  return tier === 'high' ? 50 : 66;
}

/* ---------- Dates and the library card ---------- */

// The date-due stamp: "16 NOV 2026", day-month-year like a library stamp, the month in the visitor's language,
// the day in their time zone.
export function stampText(ms, locale, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat(locale || undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone }).formatToParts(new Date(ms));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    const month = get('month').replace(/[.,]/g, '').trim().toLocaleUpperCase(locale || undefined);
    return `${get('day')} ${month} ${get('year')}`.trim();
  } catch { return ''; }
}

/* ---------- Backdrop crop (CSS background-size: cover, as texture offset/repeat) ---------- */

export function coverCrop(imgW, imgH, boxW, boxH, posX = 0.5, posY = 0) {
  const s = Math.max(boxW / imgW, boxH / imgH);
  const visW = boxW / (imgW * s), visH = boxH / (imgH * s); // fraction of the image that shows
  // Texture v runs bottom-up; CSS position runs top-down.
  return { repeatX: visW, repeatY: visH, offsetX: (1 - visW) * posX, offsetY: (1 - visH) * (1 - posY) };
}
