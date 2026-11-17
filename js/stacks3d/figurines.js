// The Stacks in 3D: one figurine on top of each bookcase (assets/figurines/<shelfId>.glb), standing on the cornice
// at the end away from the Book of the Week (model.js figurineSide). Pure: the tuning table and the maths that
// fits a model of any size onto a cornice. The loading (GLTFLoader, meshopt and Draco decoders) is in index.js,
// lazily, after the room is interactive, on the 3D tiers only; a missing or broken file leaves the case as it was.
//
// TUNING TABLE (the lead adjusts these when the real files land; units are metres in the room):
//   file    the GLB under assets/figurines/, or null until it exists (null = no request at all, so no 404s;
//           ?figurines=try on library.html requests assets/figurines/<shelfId>.glb for every shelf, for testing)
//   height  how tall the figurine stands; the model is scaled so its bounding box is this tall (a case is 0.94 m,
//           its books 0.22 to 0.30 m; the headroom over the cornice is 0.36 m and the Book of the Week uses ~0.33)
//   maxW    the widest it may be across the case (x) or deep (z); if the box is wider, it is scaled down to fit
//   scale   a final multiplier after the fit (1 = as fitted)
//   y       lift above the cornice top (m), for models whose base is not at the bottom of their box
//   x       nudge toward the middle of the cornice (m, positive = inward), after the end it stands on is chosen
//   rotY    turn about the vertical (radians). glTF models face +Z, toward the visitor; with mirror (the default) a
//           positive rotY turns the figurine toward the middle of its case whichever end it stands on (about 0.3
//           reads best); with mirror: false it is applied as is (positive = counter-clockwise seen from above)
//   front   the turn (radians) that makes this model face +Z (the visitor) before anything else: the delivered files
//           face +Z after -0.5. Applied first, so the fit and the bounding box use the model as it will stand
export const FIGURINE_DIR = 'assets/figurines/';

export const FIGURINES = {
  crime: { file: 'crime.glb', height: 0.19, maxW: 0.2, scale: 1, y: 0, x: 0, rotY: 0.3, front: -0.5, mirror: true }, // magnifying glass on case folders
  serial: { file: 'serial.glb', height: 0.17, maxW: 0.2, scale: 1, y: 0, x: 0, rotY: 0.3, front: -0.5, mirror: true }, // 1950s typewriter
  unsolved: { file: 'unsolved.glb', height: 0.16, maxW: 0.19, scale: 1, y: 0, x: 0, rotY: 0.3, front: -0.5, mirror: true }, // ship's compass in an open mahogany box
  history: { file: 'history.glb', height: 0.25, maxW: 0.15, scale: 1, y: 0, x: 0, rotY: 0, front: -0.5, mirror: false }, // hourglass
  science: { file: 'science.glb', height: 0.27, maxW: 0.16, scale: 1, y: 0, x: 0, rotY: 0.4, front: -0.5, mirror: true }, // brass microscope
  cults: { file: 'cults.glb', height: 0.2, maxW: 0.2, scale: 1, y: 0, x: 0, rotY: 0.3, front: -0.5, mirror: true }, // magician's top hat with cards
  fantasy: { file: 'fantasy.glb', height: 0.26, maxW: 0.2, scale: 1, y: 0, x: 0, rotY: 0.4, front: -0.5, mirror: true }, // bronze dragon on old books
  scifi: { file: 'scifi.glb', height: 0.28, maxW: 0.15, scale: 1, y: 0, x: 0, rotY: 0.2, front: -0.5, mirror: true }, // retro tin rocket
};
// Any shelf without an entry (a shelf added later) gets these, with the default file name.
export const FIGURINE_DEFAULT = { file: null, height: 0.16, maxW: 0.18, scale: 1, y: 0, x: 0, rotY: 0.3, front: 0, mirror: true };
// How far from the middle of the cornice a figurine stands (m); the cornice's top is ±0.365 wide, and the Book of
// the Week's plinth at most ±0.16 (index.js): a figurine up to 0.2 m wide clears it on the bay they share.
export const FIGURINE_INSET = 0.265;
// A file bigger than this is not used (bytes): the perf budget is ~400 KB per figurine.
export const FIGURINE_MAX_BYTES = 600 * 1024;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*\.glb$/;

// The figurine to load for a shelf, or null. `tryAll`: request <shelfId>.glb even where the table has no file yet.
// Files (8 delivered 17 Nov 2026): glTF 2.0 binary, Y-up, any units (fitted by bounding box), EXT_meshopt_compression
// and/or KHR_mesh_quantization, EXT_texture_webp or PNG/JPEG textures, opaque PBR metallic-roughness; Draco works
// too. No KTX2/Basis textures, no transmission, no lights or cameras (stripped), no animation (ignored).
export function figurineFor(shelfId, { tryAll = false, table = FIGURINES } = {}) {
  if (!SLUG.test(String(shelfId || ''))) return null;
  const t = { ...FIGURINE_DEFAULT, ...(Object.hasOwn(table, shelfId) ? table[shelfId] : {}) };
  const file = t.file || (tryAll ? `${shelfId}.glb` : null);
  if (!file || !FILE.test(file)) return null;
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    url: FIGURINE_DIR + file,
    height: num(t.height, 0.16, 0.03, 0.34),
    maxW: num(t.maxW, 0.18, 0.03, 0.2),
    scale: num(t.scale, 1, 0.1, 3),
    y: num(t.y, 0, -0.1, 0.2),
    x: num(t.x, 0, -0.2, 0.2),
    rotY: num(t.rotY, 0, -Math.PI * 2, Math.PI * 2),
    front: num(t.front, 0, -Math.PI * 2, Math.PI * 2),
    mirror: t.mirror !== false,
  };
}

// How to place a model whose bounding box (after rotation) is `box` ({ min: {x,y,z}, max: {x,y,z} }, any units)
// so it stands `t.height` tall (or less, to keep within t.maxW across and deep), times t.scale, its base on y = 0
// and its middle on x = z = 0. Returns { scale, offset: { x, y, z } }: put the model in a group, set its scale,
// then its position to offset (in the group's units, i.e. already scaled). null for an empty or flat box.
export function fitFigurine(box, t) {
  const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
  if (![sx, sy, sz].every(Number.isFinite) || sy <= 1e-9) return null;
  let s = t.height / sy;
  const wide = Math.max(sx, sz) * s;
  if (wide > t.maxW) s *= t.maxW / wide;
  s *= t.scale ?? 1;
  return {
    scale: s,
    offset: { x: -((box.min.x + box.max.x) / 2) * s, y: -box.min.y * s + (t.y || 0), z: -((box.min.z + box.max.z) / 2) * s },
  };
}

// Where on the cornice (x relative to the bay's centre) and which way it turns, for the end it stands on.
export function figurinePose(t, side) {
  return { x: side * (FIGURINE_INSET - (t.x || 0)), rotY: t.mirror ? -side * t.rotY : t.rotY };
}
