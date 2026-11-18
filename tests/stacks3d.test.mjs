// The Stacks in 3D: the pure logic behind the WebGL scene (js/stacks3d/model.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BINDINGS, bookLook, BAY, bayX, spanOf, frameWorld, layoutBay, frameCamera, windowFor, windowX, pageCount, PULL, pullFraction, pointerSpeed,
  releaseAction, springStep, springAtRest, decideTier, renderScale, frameInterval, stampText, coverCrop,
} from '../js/stacks3d/model.js';

const data = JSON.parse(readFileSync(new URL('../data/books.json', import.meta.url), 'utf8'));

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
};

/* ---------- Bindings ---------- */

test('bindings: foil on cloth passes 4.5:1; no bright red, orange/amber or teal (risk hues)', () => {
  for (const b of BINDINGS) {
    assert.ok(contrast(b.base, b.foil) >= 4.5, `${b.name} ${contrast(b.base, b.foil).toFixed(2)}`);
    const { h, s, l } = hsl(b.base);
    assert.ok(!(s > 0.5 && (h < 40 || h >= 340)), `${b.name} reads as red/orange`);
    assert.ok(!(s > 0.3 && h >= 160 && h <= 200), `${b.name} reads as teal`);
    // Oxblood is allowed only as a dark leather tone.
    if (h < 15 || h >= 345) assert.ok(b.kind === 'leather' && l < 0.25, `${b.name} red-ish must be dark leather`);
  }
});

test('bookLook is derived from the id: stable, varied, sizes in range', () => {
  const z = data.books.find((b) => b.id === 'zodiac');
  assert.deepEqual(bookLook({ ...z }), bookLook(z));
  const seen = new Set();
  for (const b of data.books) {
    const l = bookLook(b);
    assert.ok(l.thick >= 0.058 && l.thick <= 0.092, `${b.id} thick ${l.thick}`);
    assert.ok(l.height >= 0.3 && l.height <= 0.415, `${b.id} height ${l.height}`); // tall books (the owner's design)
    assert.ok(l.depth > 0.2 && l.depth <= 0.27);
    assert.ok(l.height / l.depth >= 1.4 && l.height / l.depth <= 1.6, 'a cover of a usual shape');
    assert.ok(l.height <= BAY.clear - 0.04, 'fits under the shelf above with room for the hand');
    assert.notEqual(l.second, l.binding);
    seen.add(l.binding.name + l.band);
  }
  assert.ok(seen.size >= 20, 'bindings vary');
});

/* ---------- Bookcases ---------- */

test('bays: in a row, centred, three fit a 2.16 m window; the frame keeps headroom over the cases', () => {
  assert.equal(bayX(0) + bayX(5), 0);
  assert.equal(bayX(0, 8) + bayX(7, 8), 0);
  assert.equal(Math.round((bayX(1) - bayX(0)) * 1000) / 1000, BAY.pitch);
  assert.ok(Math.abs(spanOf(3) - 2.16) < 1e-9);
  assert.deepEqual(frameWorld(3), { w: 2.24, h: 1.65 });
  assert.ok(Math.abs(BAY.floors[0] - BAY.floors[1] - (BAY.clear + BAY.board)) < 1e-9);
});

test('layoutBay: rows packed edge to edge: every book once, blank fillers after them, room kept for props', () => {
  for (const [i, shelf] of data.shelves.entries()) {
    const looks = data.books.filter((b) => b.shelf === shelf.id).map(bookLook);
    if (!looks.length) continue; // a shelf whose books are not merged yet stays out of the room (tests/stacks-v2-front.test.mjs)
    const props = [0.16, 0.2];
    const { placed, fillers, free } = layoutBay(looks, i, props);
    assert.equal(placed.length, looks.length);
    assert.equal(new Set(placed.map((p) => p.id)).size, looks.length);
    for (const f of fillers) assert.match(f.id, /^filler-/, 'fillers never take a real id');
    for (const r of [0, 1]) {
      const items = [...placed.filter((p) => p.row === r).map((p) => ({ x: p.x, t: looks.find((l) => l.id === p.id).thick })),
        ...fillers.filter((f) => f.row === r).map((f) => ({ x: f.x, t: f.thick }))].sort((a, b) => a.x - b.x);
      assert.ok(placed.filter((p) => p.row === r).length >= 3, `${shelf.id} row ${r}`);
      for (let k = 1; k < items.length; k++) assert.ok(items[k].x - items[k].t / 2 >= items[k - 1].x + items[k - 1].t / 2 - 1e-6, `${shelf.id} row ${r} overlap`);
      const span = items.reduce((t, it) => t + it.t, 0);
      const f = free.find((x) => x.row === r);
      assert.ok(f.x1 - f.x0 >= Math.min(props[r], 0.12) - 1e-6, `${shelf.id} row ${r} keeps room for props`);
      assert.ok(span + props[r] > BAY.inner - 0.09, `${shelf.id} row ${r} is full (${span.toFixed(3)})`);
      for (const it of items) assert.ok(it.x - it.t / 2 >= -BAY.inner / 2 - 1e-6 && it.x + it.t / 2 <= BAY.inner / 2 + 1e-6, 'inside the bay');
      // Props and books do not overlap.
      for (const it of items) assert.ok(it.x + it.t / 2 <= f.x0 + 1e-6 || it.x - it.t / 2 >= f.x1 - 1e-6, `${shelf.id} row ${r} prop zone`);
    }
  }
});

/* ---------- Camera ---------- */

test('frameCamera: the bookcases fill the reserved rectangle and sit on its centre', () => {
  const f = frameCamera({ canvasW: 1440, canvasH: 1000, rect: { x: 95, y: 470, w: 1250, h: 520 }, worldW: 2.16, worldH: 0.9, fov: 28 });
  // Width-limited: 2.16 m across 1250 px.
  assert.ok(Math.abs(f.perPx - Math.max(2.16 / 1250, 0.9 / 520)) < 1e-12);
  const visibleH = 2 * f.distance * Math.tan((28 * Math.PI) / 360);
  assert.ok(Math.abs(visibleH / 1000 - f.perPx) < 1e-12);
  assert.ok(Math.abs(f.shiftX - 0) < 1e-9);
  assert.ok(Math.abs(f.shiftY - (1 - 2 * 730 / 1000)) < 1e-9);
});

test('windowFor keeps whole pages, windowX centres them', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => windowFor(i, 3)), [0, 0, 0, 3, 3, 3]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => windowFor(i, 1)), [0, 1, 2, 3, 4, 5]);
  assert.equal(windowFor(4, 6), 0);
  assert.equal(pageCount(3), 2);
  assert.equal(pageCount(1), 6);
  assert.equal(windowX(0, 3), bayX(1));
  assert.equal(windowX(3, 3), bayX(4));
  assert.equal(windowX(2, 1), bayX(2));
});

/* ---------- Pull, flick, springs ---------- */

test('pull: resistance grows toward the end; full at pxForFull', () => {
  assert.equal(pullFraction(0), 0);
  assert.ok(Math.abs(pullFraction(PULL.pxForFull) - 1) < 1e-9);
  assert.equal(pullFraction(PULL.pxForFull * 3), 1);
  assert.ok(pullFraction(PULL.pxForFull / 2) > 0.5, 'first half moves more than half');
  assert.ok(pullFraction(-20) === 0);
});

test('pointerSpeed and releaseAction: click, flick, pulled out, or back home', () => {
  const s = [{ t: 0, x: 0, y: 0 }, { t: 40, x: 0, y: 30 }, { t: 80, x: 0, y: 80 }];
  assert.equal(pointerSpeed(s), 1);
  assert.equal(pointerSpeed([{ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 10 }, { t: 520, x: 0, y: 12 }]), 0.1);
  assert.equal(pointerSpeed([]), 0);
  assert.equal(releaseAction({ travel: 2, duration: 120, speed: 0, fraction: 0 }), 'click');
  assert.equal(releaseAction({ travel: 2, duration: 900, speed: 0, fraction: 0 }), 'back');
  assert.equal(releaseAction({ travel: 60, duration: 200, speed: 1.2, fraction: 0.3 }), 'flick');
  assert.equal(releaseAction({ travel: 60, duration: 200, speed: 0.5, fraction: 0.3 }), 'back');
  assert.equal(releaseAction({ travel: 140, duration: 900, speed: 0.1, fraction: 0.8 }), 'out');
});

test('springStep settles on the target without blowing up', () => {
  let s = { x: 0, v: 0 };
  let peak = 0;
  for (let i = 0; i < 240; i++) { s = springStep(s, 1, 1 / 60); peak = Math.max(peak, s.x); }
  assert.ok(springAtRest(s, 1, 1e-3));
  assert.ok(peak < 1.25, 'a little overshoot, no more');
});

/* ---------- Governor ---------- */

test('decideTier: DOM for no WebGL2, reduced motion, Save-Data and very weak devices; low for phones and modest ones', () => {
  assert.equal(decideTier({ webgl2: false }), 'dom');
  assert.equal(decideTier({ webgl2: true, reducedMotion: true }), 'dom');
  assert.equal(decideTier({ webgl2: true, saveData: true }), 'dom');
  assert.equal(decideTier({ webgl2: true, deviceMemory: 1, cores: 8 }), 'dom');
  assert.equal(decideTier({ webgl2: true, cores: 2 }), 'dom');
  assert.equal(decideTier({ webgl2: true, mobile: true, deviceMemory: 8, cores: 8 }), 'low');
  assert.equal(decideTier({ webgl2: true, deviceMemory: 4, cores: 8 }), 'low');
  assert.equal(decideTier({ webgl2: true, deviceMemory: 8, cores: 4 }), 'low');
  assert.equal(decideTier({ webgl2: true, deviceMemory: 8, cores: 8 }), 'high');
  assert.equal(decideTier({ webgl2: true }), 'high', 'unknown memory and cores (Safari, Firefox) count as capable');
  assert.equal(decideTier({ webgl2: true, override: 'dom' }), 'dom');
  assert.equal(decideTier({ webgl2: false, override: 'high' }), 'dom', 'an override never forces WebGL where there is none');
  assert.equal(decideTier({ webgl2: true, reducedMotion: true, override: 'low' }), 'low');
});

test('renderScale caps the pixel ratio and the pixel budget', () => {
  assert.equal(renderScale({ w: 1440, h: 1000, dpr: 3 }), 1.71);
  assert.equal(renderScale({ w: 1440, h: 1000, dpr: 1 }), 1);
  assert.equal(renderScale({ w: 390, h: 1100, dpr: 3, tier: 'low', mobile: true }), 1.5);
  assert.ok(renderScale({ w: 2560, h: 1700, dpr: 2 }) * renderScale({ w: 2560, h: 1700, dpr: 2 }) * 2560 * 1700 <= 4.3e6);
  assert.ok(renderScale({ w: 8000, h: 6000, dpr: 1 }) >= 0.75);
});

test('frameInterval: full rate while moving, ~20 fps idle, nothing hidden', () => {
  assert.equal(frameInterval({ moving: true, visible: true, tier: 'high' }), 0);
  assert.equal(frameInterval({ moving: false, visible: true, tier: 'high' }), 50);
  assert.equal(frameInterval({ moving: false, visible: true, tier: 'low' }), 66);
  assert.equal(frameInterval({ moving: true, visible: false, tier: 'high' }), Infinity);
});

/* ---------- Stamp and crop ---------- */

test('stampText: day month year like a library stamp, in the visitor\'s language and time zone', () => {
  const t = Date.UTC(2026, 10, 16, 12);
  assert.equal(stampText(t, 'en-GB', 'UTC'), '16 NOV 2026');
  assert.equal(stampText(t, 'en-US', 'UTC'), '16 NOV 2026');
  assert.equal(stampText(Date.UTC(2026, 10, 16, 23, 30), 'en-GB', 'Asia/Tokyo'), '17 NOV 2026');
  assert.match(stampText(t, 'fr-FR', 'UTC'), /^16 NOV 2026$/);
  assert.match(stampText(t, 'de-DE', 'UTC'), /^16 NOV 2026$/);
  assert.equal(stampText(Date.UTC(2026, 0, 5), 'en-GB', 'UTC'), '05 JAN 2026');
});

test('coverCrop matches CSS background-size: cover', () => {
  // 16:9 image in a 4:3 box, centred horizontally, top-aligned: full height shows, sides cropped.
  const c = coverCrop(1600, 900, 1200, 900, 0.5, 0);
  assert.equal(c.repeatY, 1);
  assert.ok(Math.abs(c.repeatX - 0.75) < 1e-9);
  assert.ok(Math.abs(c.offsetX - 0.125) < 1e-9);
  // A tall box: width shows in full, the top of the image is kept (texture v counts from the bottom).
  const d = coverCrop(1600, 900, 1600, 600, 0.5, 0);
  assert.equal(d.repeatX, 1);
  assert.ok(Math.abs(d.repeatY - 600 / 900) < 1e-9);
  assert.ok(Math.abs(d.offsetY - 300 / 900) < 1e-9);
});

/* ---------- The page's files ---------- */

test('library.html: import map points at vendored files that exist, with their licences', async () => {
  const { existsSync } = await import('node:fs');
  const html = readFileSync(new URL('../library.html', import.meta.url), 'utf8');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  assert.deepEqual(Object.keys(map).sort(), ['cannon-es', 'gsap', 'three', 'three/addons/']);
  for (const [k, v] of Object.entries(map)) assert.ok(existsSync(new URL('../' + v.replace('./', ''), import.meta.url)), `${k} -> ${v}`);
  for (const f of ['vendor/three/LICENSE', 'vendor/cannon-es/LICENSE', 'vendor/gsap/LICENSE.md', 'vendor/three/three.core.js']) assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
  assert.match(readFileSync(new URL('../vendor/three/three.core.js', import.meta.url), 'utf8').slice(0, 2000), /REVISION = '187'/);
  // Only the library page loads 3D code.
  for (const page of ['index.html', 'trip.html', 'flights.html', 'how.html']) assert.ok(!/importmap|stacks3d/.test(readFileSync(new URL('../' + page, import.meta.url), 'utf8')), page);
});

test('every image the library asks for is in assets/stacks', async () => {
  const { existsSync } = await import('node:fs');
  const css = readFileSync(new URL('../styles/components/library.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../js/library.js', import.meta.url), 'utf8');
  const refs = new Set([...css.matchAll(/assets\/stacks\/([\w.{}-]+\.webp)/g), ...js.matchAll(/assets\/stacks\/([\w.{}-]+\.webp)/g)].map((m) => m[1]));
  assert.ok(refs.size >= 10);
  for (const r of refs) for (const size of ['1024', '512']) {
    const f = r.replace('{size}', size);
    assert.ok(existsSync(new URL('../assets/stacks/' + f, import.meta.url)), f);
  }
});

// Owner report, 17 Nov 2026: on real graphics cards the first four bookcases were blank. The Book of the Week's beam
// took pow() of a varying that anti-aliasing can push below zero; that not-a-number pixel went into the half-float
// buffer and the bloom blur spread it into a rectangle about 1,400px wide. These checks read the shader source.
test('3D shaders: no maths that can leave a pixel that is not a number', () => {
  for (const file of ['index.js', 'room.js']) {
    const src = readFileSync(new URL('../js/stacks3d/' + file, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''); // code, not comments
    // pow() only of a clamped, max()ed or constant base.
    for (const m of src.matchAll(/pow\(\s*([^,]+),/g)) {
      const base = m[1].trim();
      assert.ok(/^(clamp|max)\(/.test(base) || /^[\d.]+$/.test(base) || /^1\.0 - uv\.y$/.test(base), `${file}: pow(${base}, …) can take a negative base`);
    }
    // smoothstep(edge0, edge1, x) is undefined when edge0 >= edge1.
    for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      assert.ok(Number(m[1]) < Number(m[2]), `${file}: smoothstep(${m[1]}, ${m[2]}, …) has its edges the wrong way round`);
    }
    assert.ok(!/smoothstep\(\s*[\d.]+ \+[^,]+,\s*[\d.]+\s*,/.test(src), `${file}: a smoothstep whose first edge is the larger one`);
  }
  const index = readFileSync(new URL('../js/stacks3d/index.js', import.meta.url), 'utf8');
  assert.match(index, /float edge = pow\(clamp\(vFacing, 0\.0, 1\.0\), 2\.2\);/, 'the beam clamps before pow()');
  // The guards: the bloom reads only finite colour, and the last pass writes an opaque, finite pixel.
  assert.match(index, /materialHighPassFilter\.fragmentShader = SAFE_BRIGHT/);
  const bright = index.slice(index.indexOf('const SAFE_BRIGHT'), index.indexOf('const FLAME'));
  assert.match(bright, /isnan\(texel\)/);
  assert.match(bright, /isinf\(texel\)/);
  const last = index.slice(index.indexOf('const VIGNETTE_GRAIN'), index.indexOf('const SAFE_BRIGHT'));
  assert.match(last, /isnan\(c\.rgb\)/);
  assert.match(last, /gl_FragColor = vec4\(c\.rgb, 1\.0\);/);
  // three's own bright pass still has the uniforms SAFE_BRIGHT declares (a three upgrade that renames them fails here).
  const theirs = readFileSync(new URL('../vendor/three/addons/shaders/LuminosityHighPassShader.js', import.meta.url), 'utf8');
  for (const u of ['tDiffuse', 'luminosityThreshold', 'smoothWidth', 'defaultColor', 'defaultOpacity']) {
    assert.ok(theirs.includes(`'${u}'`) && bright.includes(u), u);
  }
  const pass = readFileSync(new URL('../vendor/three/addons/postprocessing/UnrealBloomPass.js', import.meta.url), 'utf8');
  assert.ok(pass.includes('this.materialHighPassFilter = new ShaderMaterial'), 'UnrealBloomPass keeps its bright-pass material where we replace it');
});
