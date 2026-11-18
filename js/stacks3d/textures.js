// The Stacks in 3D: everything drawn on <canvas> for the scene. Spines with foil titles, stand-in covers, brass
// name plates, the date-due slip and its red stamp, notes, a map and case folders (blank: no photos, no names),
// plus procedural wood/cloth/leather/paper used until (or instead of) the photographic textures load.
// Each painter returns canvases; scene.js turns them into textures. PBR canvases carry roughness in G and
// metalness in B (the channels three.js reads).

export const FONTS = {
  slab: '"Alfa Slab One", Rockwell, Georgia, serif',
  cond: '"Barlow Condensed", "Arial Narrow", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Inter Variable", Inter, system-ui, sans-serif',
};
import { hashId } from '../librarymodel.js';

const WEIGHT = { slab: '400', cond: '800', serif: '700', sans: '600' };

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

// Small seeded random generator (mulberry32), so a book's wear is the same on every visit.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise with smooth interpolation, on a hashed lattice.
function lattice(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = lattice(xi, yi, seed), b = lattice(xi + 1, yi, seed), c = lattice(xi, yi + 1, seed), d = lattice(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise2(x * f, y * f, seed + i * 17); f *= 2; amp *= 0.5; }
  return s;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a = 1) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
export function shade(h, f) { // f < 0 darkens, > 0 lightens
  const [r, g, b] = hex(h).map((c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f));
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

/* ---------- Procedural base materials (used until the photographic textures arrive, or if they fail) ---------- */

// Dark walnut, grain along u (x). 0..255 luminance kept low.
export function woodCanvas(size = 512, seed = 7) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const warp = fbm(nx * 3, ny * 9, seed, 4) * 7;
      const g = ny * 46 + warp;
      const ring = 0.5 + 0.5 * Math.sin(g * Math.PI);
      const streak = fbm(nx * 40, ny * 260, seed + 3, 3);
      const t = 0.55 * ring ** 3 + 0.45 * streak;
      const pore = noise2(x * 0.9, y * 0.18, seed + 9) > 0.93 ? -18 : 0;
      const i = (y * size + x) * 4;
      d[i] = 52 + t * 46 + pore; d[i + 1] = 33 + t * 28 + pore * 0.7; d[i + 2] = 20 + t * 15 + pore * 0.5; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Neutral (mid-grey) cloth weave or pebbled leather, to multiply/overlay onto a colour.
export function grainCanvas(kind = 'cloth', size = 256, seed = 3) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v;
      if (kind === 'cloth') {
        const wx = Math.sin((x / size) * Math.PI * 2 * 64), wy = Math.sin((y / size) * Math.PI * 2 * 64);
        v = 128 + 14 * (wx > 0 ? wy : -wy) + (noise2(x * 0.3, y * 0.3, seed) - 0.5) * 30 + (fbm(x / 40, y / 40, seed + 2) - 0.5) * 30;
      } else if (kind === 'leather') {
        const cell = noise2(x * 0.22, y * 0.22, seed), cell2 = noise2(x * 0.08, y * 0.08, seed + 5);
        v = 128 + (cell - 0.5) * 60 + (cell2 - 0.5) * 30 - (cell < 0.18 ? 30 : 0);
      } else { // paper
        v = 236 + (fbm(x / 30, y / 30, seed) - 0.5) * 22 + (noise2(x * 0.8, y * 0.8, seed + 1) - 0.5) * 10;
      }
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Normal and roughness maps from an albedo image, by luminance: Sobel for the normal (dark = deeper), and
// roughness rising in the dark grooves.
export function derivePBR(src, { size = 512, strength = 2.2, rough = 0.62, roughGain = 0.25, metal = 0 } = {}) {
  const w = size, h = Math.round(size * (src.height / src.width));
  const c = makeCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const s = ctx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (s[i * 4] * 0.299 + s[i * 4 + 1] * 0.587 + s[i * 4 + 2] * 0.114) / 255;
  const n = makeCanvas(w, h), nctx = n.getContext('2d'), nd = nctx.createImageData(w, h);
  const r = makeCanvas(w, h), rctx = r.getContext('2d'), rd = rctx.createImageData(w, h);
  const at = (x, y) => L[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength, ny = gy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      nd.data[i] = (nx * 0.5 + 0.5) * 255; nd.data[i + 1] = (ny * 0.5 + 0.5) * 255; nd.data[i + 2] = (nz * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
      rd.data[i] = 0; rd.data[i + 1] = Math.max(0, Math.min(1, rough + (0.5 - L[y * w + x]) * roughGain)) * 255; rd.data[i + 2] = metal * 255; rd.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nd, 0, 0); rctx.putImageData(rd, 0, 0);
  return { normal: n, rough: r };
}

// A rounded spine: normals tilt toward the edges across u, so light rolls over it like a real cloth spine.
export function spineCurveCanvas() {
  const w = 64, c = makeCanvas(w, 4), ctx = c.getContext('2d'), img = ctx.createImageData(w, 4);
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w * 2 - 1; // -1..1
    const nx = Math.sin(u * 1.15) * 0.85, nz = Math.sqrt(Math.max(0, 1 - nx * nx));
    for (let y = 0; y < 4; y++) {
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = 128; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Page edges: fine stripes along u, cream with a little grime.
export function pagesCanvas(size = 256, seed = 11) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const line = Math.sin(x * 2.1 + noise2(x * 0.1, y * 0.01, seed) * 6) * 0.5 + 0.5;
      const grime = fbm(x / 60, y / 60, seed + 4);
      const v = 222 - line * 34 - grime * 30;
      const i = (y * size + x) * 4;
      d[i] = v; d[i + 1] = v * 0.94; d[i + 2] = v * 0.8; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------- Text helpers ---------- */

function font(kind, px) { return `${WEIGHT[kind]} ${px}px ${FONTS[kind]}`; }

// Largest font size (<= max) at which `text` fits `width`; splits into two lines when one would be too small.
function fitText(ctx, kind, text, width, height, max, min) {
  const upper = kind === 'cond';
  const t = upper ? text.toUpperCase() : text;
  for (let px = max; px >= min; px -= 1) {
    ctx.font = font(kind, px);
    if (ctx.measureText(t).width <= width && px <= height) return { lines: [t], px };
  }
  const words = t.split(/\s+/);
  if (words.length > 1) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      for (let px = Math.min(max, height / 2.1); px >= min * 0.75; px -= 1) {
        ctx.font = font(kind, px);
        if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= width) { if (!best || px > best.px) best = { lines: [a, b], px }; break; }
      }
    }
    if (best) return best;
  }
  ctx.font = font(kind, min);
  return { lines: [t], px: min, squeeze: Math.min(1, width / ctx.measureText(t).width) };
}

// Wrap text into lines within `width` at the current font.
function wrap(ctx, text, width) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Foil: a gradient so gilt catches a little light even in the albedo, then rubbed away where the book is worn.
function foilStyle(ctx, color, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shade(color, 0.25)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.2));
  return g;
}
function rubAway(ctx, w, h, amount, rand) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h * 0.004 * amount);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.3 + rand() * 0.7;
    const r = 0.4 + rand() * 1.6 * (w / 128);
    ctx.beginPath(); ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Drawn on a texture so a base colour shows the weave/grain (overlay keeps the hue).
function clothOn(ctx, w, h, base, grain, scale = 1, alpha = 0.9) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  if (!grain) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = alpha;
  const pat = ctx.createPattern(grain, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(scale));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ---------- Spines ---------- */

// look: from model.bookLook; grains: { cloth, leather } canvases or images (neutral grey).
// Returns { map, pbr } canvases, w x h, title reading top to bottom.
export function paintSpine(book, look, grains, { w = 128 } = {}) {
  const h = Math.round(w * (look.height / look.thick) / 8) * 8;
  const rand = rng(hashId(look.id));
  const b = look.binding, s = look.second;
  const map = makeCanvas(w, h), ctx = map.getContext('2d');
  const grain = b.kind === 'leather' ? grains.leather : grains.cloth;
  clothOn(ctx, w, h, b.base, grain, w / 256, b.kind === 'leather' ? 0.75 : 0.9);
  const foil = makeCanvas(w, h), f = foil.getContext('2d');
  const panel = { y0: 0, y1: 0 };
  const rule = (y, t = 0.012) => { f.fillRect(w * 0.06, y * h, w * 0.88, Math.max(1.5, h * t * 0.25)); };
  f.fillStyle = '#000';
  // Bands.
  if (look.band === 'rules') { rule(0.055); rule(0.07); rule(0.925); rule(0.94); }
  if (look.band === 'blocks') {
    clothBand(ctx, 0, h * 0.13, s.base, grain, w); clothBand(ctx, h * 0.87, h, s.base, grain, w);
    rule(0.13); rule(0.865);
  }
  if (look.band === 'panel') {
    panel.y0 = h * 0.16; panel.y1 = h * 0.74;
    clothBand(ctx, panel.y0, panel.y1, shade(s.base, -0.25), grains.leather, w);
    f.strokeStyle = '#000'; f.lineWidth = Math.max(1.5, w * 0.02);
    f.strokeRect(w * 0.12, panel.y0 + w * 0.06, w * 0.76, panel.y1 - panel.y0 - w * 0.12);
    rule(0.06); rule(0.94);
  }
  // Title, rotated to read top to bottom.
  const titleTop = look.band === 'blocks' ? 0.17 : look.band === 'panel' ? 0.2 : 0.11;
  const titleBottom = look.band === 'panel' ? 0.7 : 0.74;
  const avail = (titleBottom - titleTop) * h, across = w * 0.72;
  const fitted = fitText(f, look.font, book.title, avail, across, Math.round(w * 0.56), Math.round(w * 0.2));
  f.save();
  f.translate(w / 2, h * (titleTop + titleBottom) / 2);
  f.rotate(Math.PI / 2);
  f.textAlign = 'center'; f.textBaseline = 'middle';
  f.font = font(look.font, fitted.px);
  const lh = fitted.px * 1.02;
  fitted.lines.forEach((line, i) => {
    const y = (i - (fitted.lines.length - 1) / 2) * lh + fitted.px * 0.04;
    if (fitted.squeeze && fitted.squeeze < 1) { f.save(); f.scale(fitted.squeeze, 1); f.fillText(line, 0, y); f.restore(); }
    else f.fillText(line, 0, y);
  });
  f.restore();
  // Author's surname near the foot.
  const sur = (book.authors[0] || '').trim().split(/\s+/).pop().toUpperCase();
  f.save();
  f.translate(w / 2, h * 0.84);
  f.rotate(Math.PI / 2);
  f.textAlign = 'center'; f.textBaseline = 'middle';
  let apx = Math.round(w * 0.26);
  f.font = font('cond', apx);
  while (f.measureText(sur).width > h * 0.14 && apx > 8) { apx -= 1; f.font = font('cond', apx); }
  f.fillText(sur, 0, 0);
  f.restore();
  // A small ornament between title and author.
  f.beginPath(); f.arc(w / 2, h * 0.775, Math.max(1.5, w * 0.035), 0, Math.PI * 2); f.fill();
  rubAway(f, w, h, look.wear, rand);
  // Foil onto the cloth, in its colour.
  const tint = makeCanvas(w, h), tc = tint.getContext('2d');
  tc.drawImage(foil, 0, 0);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = foilStyle(tc, b.foil, 0, h); tc.fillRect(0, 0, w, h);
  // Debossed edge: a dark shadow under the foil.
  ctx.save(); ctx.globalAlpha = 0.45; ctx.filter = 'blur(0.6px)'; ctx.drawImage(foil, 0.8, 1.2); ctx.restore();
  ctx.drawImage(tint, 0, 0);
  wearSpine(ctx, w, h, look.wear, rand);
  // PBR: cloth rough, foil smooth and (if gilt) metallic.
  const pbr = makeCanvas(w, h), p = pbr.getContext('2d');
  p.fillStyle = `rgb(0,${Math.round((b.kind === 'leather' ? 0.6 : 0.86) * 255)},0)`; p.fillRect(0, 0, w, h);
  const pf = makeCanvas(w, h), pfc = pf.getContext('2d');
  pfc.drawImage(foil, 0, 0); pfc.globalCompositeOperation = 'source-in';
  pfc.fillStyle = b.metal ? 'rgb(0,80,255)' : 'rgb(0,150,0)'; pfc.fillRect(0, 0, w, h);
  p.drawImage(pf, 0, 0);
  return { map, pbr, w, h };
}

function clothBand(ctx, y0, y1, color, grain, w) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y0, w, y1 - y0); ctx.clip();
  ctx.fillStyle = color; ctx.fillRect(0, y0, w, y1 - y0);
  if (grain) {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.85;
    const pat = ctx.createPattern(grain, 'repeat');
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(w / 256));
    ctx.fillStyle = pat; ctx.fillRect(0, y0, w, y1 - y0);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y1 - 1, w, 1.5); ctx.fillRect(0, y0, w, 1);
}

// Rubbed head and tail caps, scuffs, a little dust: old library copies.
function wearSpine(ctx, w, h, wear, rand) {
  ctx.save();
  for (const [y, dir] of [[0, 1], [h, -1]]) {
    const g = ctx.createLinearGradient(0, y, 0, y + dir * h * 0.035);
    g.addColorStop(0, `rgba(235,220,190,${0.28 * wear})`); g.addColorStop(1, 'rgba(235,220,190,0)');
    ctx.fillStyle = g; ctx.fillRect(0, Math.min(y, y + dir * h * 0.035), w, h * 0.035);
  }
  const n = Math.round(6 + wear * 26);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.12 * wear;
    ctx.strokeStyle = rand() > 0.5 ? '#f3e6c8' : '#000';
    ctx.lineWidth = 0.6 + rand() * 1.2;
    const x = rand() * w, y = rand() * h;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * w * 0.6, y + (rand() - 0.5) * w * 0.4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Edge darkening where the cloth wraps round the boards.
  const e = ctx.createLinearGradient(0, 0, w, 0);
  e.addColorStop(0, 'rgba(0,0,0,0.38)'); e.addColorStop(0.1, 'rgba(0,0,0,0)'); e.addColorStop(0.9, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = e; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ---------- Covers ---------- */

// Our stand-in front cover, in the binding's colours: frame rules, title, author, shelf name, and a plain note
// that it is a stand-in. Square-ish canvas sized to the board (depth x height).
export function paintCover(book, look, shelfName, grains, { w = 512 } = {}) {
  const h = Math.round(w * (look.height / look.depth));
  const b = look.binding;
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  clothOn(ctx, w, h, b.base, b.kind === 'leather' ? grains.leather : grains.cloth, w / 512, 0.85);
  const ink = b.foil;
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineWidth = w * 0.008; ctx.strokeRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12);
  ctx.lineWidth = w * 0.003; ctx.strokeRect(w * 0.085, w * 0.085, w * 0.83, h - w * 0.17);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = font('cond', Math.round(w * 0.045));
  ctx.fillText(shelfName.toUpperCase(), w / 2, w * 0.2);
  const kind = look.font;
  let px = Math.round(w * (book.title.length > 30 ? 0.085 : book.title.length > 16 ? 0.105 : 0.13));
  let lines;
  for (;;) {
    ctx.font = font(kind, px);
    lines = wrap(ctx, kind === 'cond' ? book.title.toUpperCase() : book.title, w * 0.74);
    if (lines.length * px * 1.08 < h * 0.42 || px < w * 0.05) break;
    px -= 2;
  }
  const top = h * 0.3;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + (i + 0.8) * px * 1.08));
  const ry = top + lines.length * px * 1.08 + px * 0.6;
  ctx.fillRect(w / 2 - w * 0.08, ry, w * 0.16, w * 0.008);
  ctx.font = font('sans', Math.round(w * 0.042));
  wrap(ctx, book.authors.join(', '), w * 0.74).forEach((l, i) => ctx.fillText(l, w / 2, ry + w * 0.09 + i * w * 0.055));
  ctx.globalAlpha = 0.85;
  ctx.font = `500 ${Math.round(w * 0.026)}px ${FONTS.sans}`;
  ctx.fillText('Cover art not available: this is our stand-in', w / 2, h - w * 0.12);
  ctx.globalAlpha = 1;
  wearSpine(ctx, w, h, look.wear * 0.6, rng(look.px.width * 31 + look.px.height));
  return c;
}

// A photographed cover (Open Library) laid on the board, with the edge wear of a library copy.
export function paintPhotoCover(img, look, { w = 512 } = {}) {
  const h = Math.round(w * (look.height / look.depth));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.05, 'rgba(0,0,0,0.05)'); g.addColorStop(0.08, 'rgba(255,255,255,0.06)'); g.addColorStop(0.12, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); // the hinge groove next to the spine
  wearSpine(ctx, w, h, look.wear * 0.5, rng(look.px.width * 13 + look.px.height));
  return c;
}

// Back board: plain cloth with a blind-stamped frame (the readable text is HTML in the dialog).
export function paintBack(look, grains, { w = 256 } = {}) {
  const h = Math.round(w * (look.height / look.depth));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  clothOn(ctx, w, h, look.binding.base, look.binding.kind === 'leather' ? grains.leather : grains.cloth, w / 512, 0.85);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = w * 0.01;
  ctx.strokeRect(w * 0.08, w * 0.08, w * 0.84, h - w * 0.16);
  wearSpine(ctx, w, h, look.wear * 0.7, rng(look.px.height * 7));
  return c;
}

/* ---------- Brass name plates ---------- */

export function plateSize(text, worldH = 0.056) {
  const c = makeCanvas(8, 8).getContext('2d');
  c.font = font('cond', 100);
  const tw = c.measureText(text.toUpperCase()).width * 1.08 + 0.12 * 100; // letter-spacing
  const worldW = Math.max(0.24, Math.min(0.6, worldH * (tw / 100) * 0.62 + worldH * 2.2));
  return { worldW, worldH };
}

export function paintPlate(text, worldW, worldH, { h = 96, brass = null } = {}) {
  const w = Math.round(h * worldW / worldH);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#DCC690'); g.addColorStop(0.45, '#B4985C'); g.addColorStop(1, '#806634');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (brass) { // the photographed brass, laid over the bevel gradient
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.55;
    ctx.drawImage(brass, 0, 0, brass.naturalWidth, brass.naturalWidth * h / w, 0, 0, w, h); ctx.restore();
  }
  const rand = rng(text.length * 97);
  for (let i = 0; i < h * 2; i++) { // brushed streaks
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,240,200,0.08)' : 'rgba(60,40,10,0.08)';
    ctx.fillRect(0, rand() * h, w, 0.6 + rand());
  }
  ctx.strokeStyle = 'rgba(255,240,200,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.strokeStyle = 'rgba(40,25,5,0.65)'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, w - 10, h - 10);
  for (const x of [h * 0.32, w - h * 0.32]) screw(ctx, x, h / 2, h * 0.09);
  // Engraved letters: dark fill with a bright lower lip.
  const label = text.toUpperCase().split('').join(String.fromCharCode(8202));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let px = Math.round(h * 0.6);
  ctx.font = font('cond', px);
  while (ctx.measureText(label).width > w - h * 1.1 && px > 10) { px -= 1; ctx.font = font('cond', px); }
  ctx.fillStyle = 'rgba(255,236,180,0.55)'; ctx.fillText(label, w / 2, h / 2 + 2.2);
  ctx.fillStyle = '#140D03'; ctx.fillText(label, w / 2, h / 2 + 0.5);
  const pbr = makeCanvas(w, h), p = pbr.getContext('2d');
  p.fillStyle = 'rgb(0,120,115)'; p.fillRect(0, 0, w, h); // half metal: the painted brass and its dark letters read under the picture light
  p.textAlign = 'center'; p.textBaseline = 'middle'; p.font = font('cond', px);
  p.fillStyle = 'rgb(0,200,40)'; p.fillText(label, w / 2, h / 2 + 0.5);
  return { map: c, pbr };
}
function screw(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#F4E1A6'); g.addColorStop(1, '#6E5220');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,5,0.8)'; ctx.lineWidth = r * 0.28;
  ctx.beginPath(); ctx.moveTo(x - r * 0.7, y + r * 0.2); ctx.lineTo(x + r * 0.7, y - r * 0.2); ctx.stroke();
}

/* ---------- Paper props: notes, a map, case folders (all blank or illegible: no names, no photos) ---------- */

function paperBase(ctx, w, h, tone, grain) {
  ctx.fillStyle = tone; ctx.fillRect(0, 0, w, h);
  if (grain) {
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.9;
    const pat = ctx.createPattern(grain, 'repeat'); ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(70,45,15,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// Handwriting-like scribble that cannot be read.
export function scribble(ctx, x, y, width, size, rand, color = 'rgba(40,30,25,0.8)') {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.09); ctx.lineCap = 'round';
  let cx = x;
  while (cx < x + width) {
    const word = size * (1.5 + rand() * 3.5);
    ctx.beginPath(); ctx.moveTo(cx, y);
    for (let t = 0; t < word; t += size * 0.28) {
      const up = Math.sin(t / size * 6.2 + rand() * 0.8) * size * (0.28 + rand() * 0.2) - (rand() > 0.9 ? size * 0.5 : 0);
      ctx.lineTo(cx + t, y + up);
    }
    ctx.stroke();
    cx += word + size * (0.6 + rand() * 0.5);
  }
  ctx.restore();
}

export function paintNote(seed, grain, { w = 256, h = 192, lines = 5 } = {}) {
  const rand = rng(seed);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#EFE6CF', grain);
  for (let i = 0; i < lines; i++) scribble(ctx, w * 0.08, h * (0.2 + i * 0.15), w * (0.6 + rand() * 0.3), h * 0.06, rand, 'rgba(35,30,40,0.75)');
  return c;
}

export function paintMap(seed, grain, { w = 512, h = 400 } = {}) {
  const rand = rng(seed);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#D9C49A', grain);
  ctx.strokeStyle = 'rgba(90,60,30,0.25)'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += w / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += h / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(70,45,20,0.75)'; ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) { // coast and rivers
    ctx.beginPath();
    let x = rand() * w * 0.2, y = rand() * h;
    ctx.moveTo(x, y);
    for (let i = 0; i < 40; i++) { x += w / 40 + (rand() - 0.5) * 8; y += (rand() - 0.5) * 26; ctx.lineTo(x, y); }
    ctx.stroke(); ctx.lineWidth = 1.2;
  }
  ctx.strokeStyle = 'rgba(70,45,20,0.45)'; ctx.setLineDash([5, 4]);
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(rand() * w, rand() * h); ctx.quadraticCurveTo(rand() * w, rand() * h, rand() * w, rand() * h); ctx.stroke(); }
  ctx.setLineDash([]);
  // Compass rose.
  const cx = w * 0.82, cy = h * 0.2, r = h * 0.09;
  ctx.fillStyle = 'rgba(70,45,20,0.7)';
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.2, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.2, cy); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy + r * 0.2); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy - r * 0.2); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 4; i++) scribble(ctx, rand() * w * 0.7, h * (0.3 + rand() * 0.6), w * 0.12, h * 0.025, rand, 'rgba(60,40,20,0.6)');
  return c;
}

export function paintFolder(seed, grain, { w = 384, h = 300, tab = true } = {}) {
  const rand = rng(seed);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#C9A66B', grain);
  if (tab) { ctx.fillStyle = 'rgba(255,250,235,0.55)'; ctx.fillRect(w * 0.08, h * 0.08, w * 0.42, h * 0.11); }
  scribble(ctx, w * 0.1, h * 0.14, w * 0.34, h * 0.04, rand, 'rgba(30,25,25,0.75)');
  ctx.strokeStyle = 'rgba(60,40,15,0.4)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) { const y = h * (0.42 + i * 0.12); ctx.beginPath(); ctx.moveTo(w * 0.1, y); ctx.lineTo(w * 0.9, y); ctx.stroke(); }
  for (let i = 0; i < 3; i++) scribble(ctx, w * 0.12, h * (0.4 + i * 0.12), w * (0.4 + rand() * 0.35), h * 0.035, rand, 'rgba(30,25,25,0.55)');
  return c;
}

/* ---------- The library pocket, the date-due slip and the stamp ---------- */

// The inside page: a library pocket with the date-due slip in it. `slip`: { title, previous: ['15 NOV 2026', ...],
// stamped: '16 NOV 2026' | null }. `pocket` is the photographic pocket image if it loaded.
export function paintPocketPage(slip, look, grains, pocketImg, { w = 512 } = {}) {
  if (pocketImg) return paintPhotoPocket(slip, look, pocketImg, { w });
  const h = Math.round(w * (look.height / look.depth));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#EDE3CB', grains.paper);
  const rand = rng(slip.title.length * 131);
  // The slip, standing out of the pocket.
  const sx = w * 0.12, sw = w * 0.76, sy = h * 0.1, sh = h * 0.62;
  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.018); ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
  ctx.shadowColor = 'rgba(40,25,5,0.35)'; ctx.shadowBlur = w * 0.02; ctx.shadowOffsetY = w * 0.006;
  ctx.fillStyle = '#F6EFDC'; ctx.fillRect(sx, sy, sw, sh);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#1E1A14'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = font('cond', Math.round(w * 0.062));
  ctx.fillText('THE STACKS LIBRARY', sx + sw * 0.07, sy + sh * 0.11);
  ctx.fillRect(sx + sw * 0.07, sy + sh * 0.13, sw * 0.86, Math.max(1.5, w * 0.004));
  ctx.font = `600 ${Math.round(w * 0.04)}px ${FONTS.sans}`;
  const tl = wrap(ctx, slip.title, sw * 0.86).slice(0, 2);
  tl.forEach((l, i) => ctx.fillText(l, sx + sw * 0.07, sy + sh * (0.21 + i * 0.07)));
  // Ruled DATE DUE column.
  const top = sy + sh * (tl.length > 1 ? 0.33 : 0.27);
  ctx.font = font('cond', Math.round(w * 0.034));
  ctx.fillStyle = '#4A443A';
  ctx.fillText('DATE DUE', sx + sw * 0.07, top);
  ctx.strokeStyle = 'rgba(60,70,120,0.45)'; ctx.lineWidth = 1;
  const rowH = (sy + sh - top - sh * 0.04) / 5;
  for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.moveTo(sx + sw * 0.05, top + i * rowH); ctx.lineTo(sx + sw * 0.95, top + i * rowH); ctx.stroke(); }
  // Earlier stamps from this device's card, in old, faded ink.
  (slip.previous || []).slice(0, 3).forEach((d, i) => inkStamp(ctx, d, sx + sw * 0.5, top + (i + 0.72) * rowH, w * 0.055, '#2E2A4A', 0.62, rand));
  const row = Math.min(3, (slip.previous || []).length);
  const stampAt = rotateAbout(sx + sw * 0.5, top + (row + 0.72) * rowH, sx + sw / 2, sy + sh / 2, -0.018);
  if (slip.stamped) inkStamp(ctx, slip.stamped, sx + sw * 0.5, top + (row + 0.72) * rowH, w * 0.068, '#A3302C', 0.92, rand, true);
  ctx.restore();
  // The pocket, over the bottom of the slip.
  const py = h * 0.52;
  if (pocketImg) {
    // The photographed pocket is cropped to its lower part (the pocket itself); the slip above is ours.
    const iw = pocketImg.naturalWidth, ih = pocketImg.naturalHeight;
    ctx.drawImage(pocketImg, 0, ih * 0.45, iw, ih * 0.55, w * 0.06, py, w * 0.88, h - py - w * 0.05);
  } else {
    ctx.save();
    ctx.shadowColor = 'rgba(40,25,5,0.4)'; ctx.shadowBlur = w * 0.02; ctx.shadowOffsetY = -w * 0.004;
    ctx.fillStyle = '#C6A774';
    ctx.beginPath();
    ctx.moveTo(w * 0.06, py); ctx.lineTo(w * 0.94, py); ctx.lineTo(w * 0.94, h - w * 0.05); ctx.lineTo(w * 0.06, h - w * 0.05); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.6;
    ctx.fillStyle = ctx.createPattern(grains.paper, 'repeat'); ctx.fillRect(w * 0.06, py, w * 0.88, h - py - w * 0.05); ctx.restore();
    // The thumb notch.
    ctx.fillStyle = 'rgba(80,55,20,0.35)';
    ctx.beginPath(); ctx.ellipse(w / 2, py, w * 0.09, w * 0.035, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = '#1E1A14'; ctx.lineWidth = w * 0.006;
    const bx = w * 0.3, by = py + (h - py) * 0.3, bw = w * 0.4, bh = (h - py) * 0.42;
    ctx.strokeRect(bx, by, bw, bh); ctx.lineWidth = w * 0.002; ctx.strokeRect(bx + 4, by + 4, bw - 8, bh - 8);
    ctx.fillStyle = '#1E1A14'; ctx.textAlign = 'center';
    ctx.font = font('cond', Math.round(w * 0.05));
    ctx.fillText('PLEASE RETURN', w / 2, by + bh * 0.42);
    ctx.fillText('BY THE LAST DATE', w / 2, by + bh * 0.78);
  }
  return { canvas: c, stampAt };
}
const rotateAbout = (x, y, cx, cy, a) => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) });

// Rubber-stamp ink: condensed type, a slight rotation, uneven ink and a faint second impression.
export function inkStamp(ctx, text, x, y, size, color, alpha, rand, fresh = false) {
  const w = Math.ceil(size * text.length * 0.62 + size), h = Math.ceil(size * 1.6);
  const t = makeCanvas(w, h), tc = t.getContext('2d');
  tc.font = font('cond', Math.round(size));
  tc.textAlign = 'center'; tc.textBaseline = 'middle';
  tc.fillStyle = color;
  tc.fillText(text, w / 2, h / 2);
  if (fresh) { tc.globalAlpha = 0.18; tc.fillText(text, w / 2 + size * 0.04, h / 2 + size * 0.05); tc.globalAlpha = 1; }
  tc.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h * 0.03; i++) { tc.globalAlpha = rand() * 0.8; tc.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5); }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y); ctx.rotate((rand() - 0.5) * 0.08 - 0.03);
  ctx.drawImage(t, -w / 2, -h / 2);
  ctx.restore();
}

// End paper for the inside of the front board.
export function paintEndpaper(look, grains, { w = 256 } = {}) {
  const h = Math.round(w * (look.height / look.depth));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#F3EBD8', grains.paper);
  const edge = ctx.createLinearGradient(w, 0, w * 0.85, 0);
  edge.addColorStop(0, 'rgba(60,40,10,0.3)'); edge.addColorStop(1, 'rgba(60,40,10,0)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  // A bookplate: "Ex libris · The Stacks".
  const bw = w * 0.56, bh = bw * 0.72, bx = (w - bw) / 2, by = h * 0.3;
  ctx.fillStyle = 'rgba(250,244,228,0.9)'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#3A2A18'; ctx.lineWidth = w * 0.006; ctx.strokeRect(bx + w * 0.012, by + w * 0.012, bw - w * 0.024, bh - w * 0.024);
  ctx.lineWidth = w * 0.002; ctx.strokeRect(bx + w * 0.026, by + w * 0.026, bw - w * 0.052, bh - w * 0.052);
  ctx.fillStyle = '#3A2A18'; ctx.textAlign = 'center';
  ctx.font = font('cond', Math.round(w * 0.04)); ctx.fillText('EX LIBRIS', w / 2, by + bh * 0.3);
  ctx.font = font('slab', Math.round(w * 0.07)); ctx.fillText('The Stacks', w / 2, by + bh * 0.58);
  ctx.beginPath(); ctx.moveTo(w / 2 - bw * 0.22, by + bh * 0.7); ctx.lineTo(w / 2 + bw * 0.22, by + bh * 0.7); ctx.stroke();
  ctx.font = font('cond', Math.round(w * 0.028)); ctx.fillText('GATECAST · OPEN ALL NIGHT', w / 2, by + bh * 0.83);
  return c;
}

// The glow of a flame: a soft radial sprite.
export function glowCanvas(size = 128, inner = 'rgba(255,200,120,1)', outer = 'rgba(255,140,40,0)') {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, 'rgba(255,170,80,0.45)'); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}

// Ambient-occlusion shading for a bookcase back panel: darker under each shelf and in the corners.
export function backPanelShade(w, h, floorsPx) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  for (const [top, bottom] of floorsPx) {
    let g = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * 0.45);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, top, w, bottom - top);
    g = ctx.createLinearGradient(0, bottom, 0, bottom - (bottom - top) * 0.2);
    g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, top, w, bottom - top);
  }
  for (const [x0, x1] of [[0, w * 0.12], [w, w * 0.88]]) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  return c;
}

export { rgba };

/* ---------- The room (used when no photographed backdrop is available) ---------- */

// Old brick: muted reds and browns, uneven mortar, soot toward the top.
export function bricksCanvas(w = 512, h = 512, seed = 21) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = '#2A211B'; ctx.fillRect(0, 0, w, h); // mortar
  const bw = w / 6, bh = h / 16, gap = Math.max(2, w / 200);
  for (let r = 0; r < 16; r++) {
    const off = (r % 2) * bw / 2;
    for (let k = -1; k < 7; k++) {
      const x = k * bw + off, y = r * bh;
      const t = rand();
      const base = t < 0.5 ? [92, 48, 36] : t < 0.8 ? [78, 44, 34] : [104, 66, 48];
      const v = 0.75 + rand() * 0.4;
      ctx.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
      ctx.fillRect(x + gap, y + gap, bw - 2 * gap, bh - 2 * gap);
    }
  }
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = (noise2(x * 0.15, y * 0.15, seed) - 0.5) * 34 + (fbm(x / 60, y / 60, seed + 3) - 0.5) * 40;
    const i = (y * w + x) * 4;
    d[i] += n; d[i + 1] += n * 0.8; d[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Dark plaster with damp stains.
export function plasterCanvas(w = 512, h = 512, seed = 31) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / 90, y / 90, seed, 5), f = noise2(x * 0.6, y * 0.6, seed + 1);
    const v = 58 + n * 46 + f * 8;
    const i = (y * w + x) * 4;
    d[i] = v * 0.78; d[i + 1] = v * 0.8; d[i + 2] = v * 0.9; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// The moonlit window: cold sky with a soft glow, drawn into the glass (mullions are geometry).
export function windowGlassCanvas(w = 256, h = 512) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w * 0.55, h * 0.3, 0, w * 0.5, h * 0.45, h * 0.7);
  g.addColorStop(0, '#F2F6FF'); g.addColorStop(0.35, '#AFC3E8'); g.addColorStop(1, '#3D5684');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  return c;
}

// A lampshade: warm parchment glowing from inside, darker at the rims.
export function shadeCanvas(w = 128, h = 64) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7A4A1C'); g.addColorStop(0.25, '#F1B866'); g.addColorStop(0.8, '#FFD9A0'); g.addColorStop(1, '#A86A2C');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  return c;
}

// The photographed inside page (assets/stacks/pocket-*.webp: a library pocket with a blank, ruled date-due slip).
// We write on its slip: the library's name, the title, earlier stamps from this device's card in old ink with an
// illegible initial, and today's date in red. Fractions below are measured on the photo.
const SLIP = { crop: [0, 0.025, 0.955, 0.95], x0: 0.234, x1: 0.764, colA: 0.42, colB: 0.595, top: 0.166, row: 0.0298 };
function paintPhotoPocket(slip, look, img, { w = 512 } = {}) {
  const h = Math.round(w * (look.height / look.depth));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const [cx, cy, cw, ch] = SLIP.crop, iw = img.naturalWidth, ih = img.naturalHeight;
  ctx.drawImage(img, cx * iw, cy * ih, cw * iw, ch * ih, 0, 0, w, h);
  const X = (f) => (f - cx) / cw * w, Y = (f) => (f - cy) / ch * h;
  const rand = rng(hashId(slip.title));
  ctx.fillStyle = '#2A2016'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = font('cond', Math.round(h * 0.034));
  ctx.fillText('THE STACKS LIBRARY', X(SLIP.x0 + 0.015), Y(SLIP.top - 0.017));
  ctx.font = `600 ${Math.round(h * 0.022)}px ${FONTS.sans}`;
  let title = slip.title;
  while (ctx.measureText(title).width > X(SLIP.x1) - X(SLIP.x0) - w * 0.03 && title.length > 4) title = title.slice(0, -2).trimEnd() + '…';
  ctx.fillText(title, X(SLIP.x0 + 0.012), Y(SLIP.top + SLIP.row - 0.007));
  const rowY = (k) => Y(SLIP.top + (k + 1.5) * SLIP.row);
  (slip.previous || []).slice(0, 3).forEach((d, k) => {
    inkStamp(ctx, d, X((SLIP.x0 + SLIP.colB) / 2), rowY(k + 0.5), h * 0.03, '#2E2A4A', 0.66, rand);
    scribble(ctx, X(SLIP.colB + 0.02), rowY(k + 0.5) + h * 0.004, X(SLIP.x1) - X(SLIP.colB) - w * 0.05, h * 0.016, rand, 'rgba(30,30,60,0.7)');
  });
  const row = Math.min(3, (slip.previous || []).length);
  const stampAt = { x: X((SLIP.x0 + SLIP.colB) / 2), y: rowY(row + 0.5) };
  if (slip.stamped) inkStamp(ctx, slip.stamped, stampAt.x, stampAt.y + h * 0.006, h * 0.042, '#A3302C', 0.93, rand, true);
  return { canvas: c, stampAt };
}
