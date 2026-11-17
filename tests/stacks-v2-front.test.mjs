// The Stacks v2, front end: N shelves (8 with the fiction shelves) in 3D and in the DOM, the Book of the Week, the
// figurines on the cornices, the "Suggested by the author" note, and the form for putting a book forward.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BAY, HEADROOM, FRAME_CY, MAX_BAYS, frameWorld, fitBays, visibleBays, featuredSpot, figurineSide, lampOffsets, bayX, windowFor, windowX, pageCount,
  layoutBay, bookLook,
} from '../js/stacks3d/model.js';
import { FIGURINES, FIGURINE_DEFAULT, FIGURINE_DIR, FIGURINE_INSET, FIGURINE_MAX_BYTES, figurineFor, fitFigurine, figurinePose } from '../js/stacks3d/figurines.js';
import { libraryData, stockedShelves, bayColumns, featuredView, originNote, REASON_MAX, validate } from '../js/librarymodel.js';
import { bookProblems, isbn13, BOOK_LIMITS } from '../js/community.js';
import { validateBook, toIsbn13, BOOK_LIMITS as SERVER_LIMITS } from '../supabase/functions/community/logic.mjs';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const data = JSON.parse(read('data/books.json'));

// Fixture: the two fiction shelves filled with made-up test books (not real records), and a featured pick.
function full() {
  const books = [...data.books];
  // Top the fiction shelves up to 10 books each with fixtures, so a full room is packed whether or not the real books
  // have been merged yet.
  for (const shelf of ['fantasy', 'scifi']) {
    for (let k = data.books.filter((b) => b.shelf === shelf).length; k < 10; k++) {
      books.push({ id: `${shelf}-test-${k}`, shelf, title: `Test ${shelf} book number ${k}`, authors: ['Test Author'], year: 1900 + k, description: 'A test book. It checks the layout.', tags: ['Test'], olWork: null, olEdition: null, olVerified: false });
    }
  }
  return { ...data, books, featured: { bookId: 'the-hobbit', reason: 'A test reason.', since: '2026-11-16' } };
}

/* ---------- The room for N shelves ---------- */

test('the frame the stylesheet reserves matches frameWorld(n), and fitBays reads it back as 4, 3, 2 and 1 bays', () => {
  const css = read('styles/components/library.css');
  const ratios = [...css.matchAll(/\.s3d \.lib-cases \{[^}]*aspect-ratio: ([\d.]+) \/ ([\d.]+);/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(ratios.length, 4, 'one base rule and three breakpoints');
  ratios.forEach(([w, h], k) => {
    const n = MAX_BAYS - k;
    assert.deepEqual({ w, h }, frameWorld(n), `${n} bays`);
    assert.equal(fitBays(1000 * w, 1000 * h), n);
    assert.equal(fitBays(Math.round(1000 * w), Math.round(1000 * h) + 3), n, 'rounding in px does not drop a bay');
  });
  for (const [bp, n] of [['1099px', 3], ['939px', 2], ['599px', 1]]) assert.ok(css.includes(`@media (max-width: ${bp}) {\n    .s3d .lib-cases { aspect-ratio: ${frameWorld(n).w} / ${frameWorld(n).h}; }`), bp);
  assert.equal(frameWorld(4).h, Math.round((BAY.height + HEADROOM + 0.03) * 1000) / 1000);
  assert.ok(Math.abs(FRAME_CY - (BAY.height + HEADROOM) / 2) < 1e-9);
  assert.ok(HEADROOM >= 0.33, 'room for the Book of the Week on its stand');
});

test('visibleBays: the fewest pages, then pages that divide the shelves evenly, then the wider view', () => {
  assert.equal(visibleBays(4, 8), 4); // 2 pages of 4
  assert.equal(visibleBays(4, 6), 3); // 2 pages of 3, not 4 + an overlapping 4
  assert.equal(visibleBays(4, 7), 4);
  assert.equal(visibleBays(3, 8), 3);
  assert.equal(visibleBays(3, 6), 3);
  assert.equal(visibleBays(2, 8), 2);
  assert.equal(visibleBays(1, 8), 1);
  assert.equal(visibleBays(4, 2), 2, 'never more than there are');
  assert.equal(visibleBays(4, 1), 1);
  assert.equal(visibleBays(0, 8), 1);
  for (let count = 1; count <= 12; count++) for (let fit = 1; fit <= 4; fit++) {
    const v = visibleBays(fit, count);
    assert.ok(v >= 1 && v <= Math.min(fit, count), `${fit}/${count}`);
  }
});

test('pages of 8 shelves: two of 4 on a wide screen, 0-2 / 3-5 / 5-7 at three, one at a time on a phone', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => windowFor(i, 4, 8)), [0, 0, 0, 0, 4, 4, 4, 4]);
  assert.deepEqual([0, 3, 4, 5, 6, 7].map((i) => windowFor(i, 3, 8)), [0, 3, 3, 3, 5, 5]);
  assert.equal(pageCount(4, 8), 2);
  assert.equal(pageCount(1, 8), 8);
  assert.equal(windowX(0, 4, 8), Math.round(((bayX(1, 8) + bayX(2, 8)) / 2) * 1000) / 1000);
  assert.equal(windowX(4, 4, 8), -windowX(0, 4, 8), 'the two pages mirror each other');
});

test('the Book of the Week stands over the middle of the first page; figurines take the far ends', () => {
  assert.deepEqual(featuredSpot(4, 8), { x: windowX(0, 4, 8), bay: 1 });
  assert.deepEqual(featuredSpot(3, 6), { x: bayX(1, 6), bay: 1 });
  assert.deepEqual(featuredSpot(1, 8), { x: bayX(0, 8), bay: 0 });
  assert.deepEqual(featuredSpot(2, 8), { x: windowX(0, 2, 8), bay: 0 });
  assert.deepEqual(featuredSpot(4, 2), { x: windowX(0, 2, 2), bay: 0 }, 'fewer shelves than fit');
  for (const [v, count] of [[4, 8], [3, 6], [2, 8], [1, 8], [3, 8]]) {
    const { x, bay } = featuredSpot(v, count);
    assert.equal(windowFor(bay, v, count), 0, 'on the first page');
    for (let i = 0; i < count; i++) {
      const side = figurineSide(i, count, x);
      assert.ok(side === 1 || side === -1);
      // A figurine never stands on the stand's side of its own cornice.
      const fx = bayX(i, count) + side * FIGURINE_INSET;
      if (Math.abs(bayX(i, count) - x) < BAY.pitch) assert.ok(Math.abs(fx - x) >= FIGURINE_INSET - 1e-9, `${v}/${count} bay ${i}`);
    }
  }
  assert.equal(figurineSide(0, 8, Infinity), -1, 'no Book of the Week: all on the left end');
});

test('lamps: one over each bay in view, the spares over the next bays out', () => {
  assert.deepEqual(lampOffsets(4), [-1.5, -0.5, 0.5, 1.5]);
  assert.deepEqual(lampOffsets(3), [-1, 0, 1, 2]);
  assert.deepEqual(lampOffsets(2), [-0.5, 0.5, 1.5, -1.5]);
  assert.deepEqual(lampOffsets(1), [0, 1, -1, 2]);
  for (const v of [1, 2, 3, 4]) assert.equal(new Set(lampOffsets(v)).size, 4, 'no two lamps in one place');
});

test('layoutBay packs every shelf of a full 8-shelf room (fixture books on the fiction shelves)', () => {
  const d = full();
  assert.equal(d.shelves.length, 8);
  for (const [i, shelf] of d.shelves.entries()) {
    const looks = d.books.filter((b) => b.shelf === shelf.id).map(bookLook);
    const { placed, fillers } = layoutBay(looks, i, [0.17, 0.17]);
    assert.equal(placed.length, looks.length, shelf.id);
    for (const it of [...placed.map((p) => ({ x: p.x, t: looks.find((l) => l.id === p.id).thick })), ...fillers.map((f) => ({ x: f.x, t: f.thick }))]) {
      assert.ok(it.x - it.t / 2 >= -BAY.inner / 2 - 1e-6 && it.x + it.t / 2 <= BAY.inner / 2 + 1e-6, `${shelf.id} inside the bay`);
    }
  }
});

/* ---------- Figurines ---------- */

test('figurine table: an entry per shelf, sane numbers, files that exist, fit the budget and need only what is vendored', () => {
  for (const s of data.shelves) assert.ok(Object.hasOwn(FIGURINES, s.id), `${s.id} has a tuning entry`);
  const SUPPORTED = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp', 'KHR_draco_mesh_compression', 'KHR_texture_transform', 'KHR_materials_emissive_strength']);
  for (const [id, t] of Object.entries(FIGURINES)) {
    assert.ok(t.height > 0.05 && t.height <= HEADROOM - 0.06, `${id}: height fits the headroom`);
    assert.ok(t.maxW > 0 && t.maxW <= 0.22, `${id}: maxW clears the stand`);
    if (!t.file) continue;
    const file = path.join(root, FIGURINE_DIR, t.file);
    assert.ok(existsSync(file), `${id}: ${t.file} exists`);
    const buf = readFileSync(file);
    assert.ok(buf.length <= FIGURINE_MAX_BYTES, `${id}: ${buf.length} bytes`);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, `${id}: glTF binary`);
    assert.equal(buf.readUInt32LE(4), 2, `${id}: glTF 2.0`);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    for (const ext of json.extensionsRequired || []) assert.ok(SUPPORTED.has(ext), `${id}: needs ${ext}`);
    for (const ext of json.extensionsUsed || []) assert.ok(!/basisu|transmission|volume|lights_punctual/i.test(ext), `${id}: uses ${ext}`);
  }
  // The stand (plinth up to ±0.16 m, js/stacks3d/index.js) and a figurine at most 0.22 m wide never meet, and the
  // figurine stays on the cornice (±0.365 m, a hair of overhang allowed).
  assert.ok(FIGURINE_INSET - 0.22 / 2 >= 0.16);
  assert.ok(FIGURINE_INSET + 0.22 / 2 <= 0.385);
  assert.ok(read('js/stacks3d/index.js').includes('const plinthW = Math.max(0.24, d + 0.05)'), 'plinth width as assumed');
});

test('figurineFor: only configured files (or every shelf with tryAll), safe names, clamped numbers', () => {
  assert.equal(figurineFor('crime').url, FIGURINE_DIR + FIGURINES.crime.file);
  assert.equal(figurineFor('../etc'), null);
  assert.equal(figurineFor(''), null);
  assert.equal(figurineFor('newshelf'), null, 'no file, no request');
  assert.equal(figurineFor('newshelf', { tryAll: true }).url, 'assets/figurines/newshelf.glb');
  assert.equal(figurineFor('x', { table: { x: { file: '../x.glb' } } }), null);
  assert.equal(figurineFor('x', { table: { x: { file: 'x.gltf' } } }), null, 'binary glTF only');
  const t = figurineFor('x', { table: { x: { file: 'x.glb', height: 9, maxW: -1, scale: 100, y: 'a', rotY: 1, front: -0.5 } } });
  assert.equal(t.height, 0.34); assert.equal(t.maxW, 0.03); assert.equal(t.scale, 3); assert.equal(t.y, 0); assert.equal(t.front, -0.5);
  assert.equal(figurineFor('x', { table: { x: { file: 'x.glb' } } }).height, FIGURINE_DEFAULT.height);
});

test('fitFigurine: any units and any origin come out the asked height, base on the cornice, centred', () => {
  // A model centred on its origin (as delivered), largest side 1.0.
  const box = { min: { x: -0.5, y: -0.346, z: -0.5 }, max: { x: 0.5, y: 0.346, z: 0.5 } };
  const f = fitFigurine(box, { height: 0.3, maxW: 0.22, scale: 1, y: 0 });
  assert.ok(Math.abs(f.scale - 0.22) < 1e-9, 'held to maxW across');
  assert.ok(Math.abs(f.offset.y - 0.346 * 0.22) < 1e-9, 'base lifted onto y = 0');
  assert.equal(f.offset.x, -0); assert.equal(f.offset.z, -0);
  const tall = fitFigurine({ min: { x: 10, y: 100, z: 0 }, max: { x: 12, y: 300, z: 2 } }, { height: 0.25, maxW: 0.2, scale: 1.2, y: 0.01 });
  assert.ok(Math.abs(tall.scale - (0.25 / 200) * 1.2) < 1e-12, 'height-limited, then the multiplier');
  assert.ok(Math.abs(tall.offset.y - (-100 * tall.scale + 0.01)) < 1e-12);
  assert.ok(Math.abs(tall.offset.x + 11 * tall.scale) < 1e-12);
  assert.equal(fitFigurine({ min: { x: 0, y: 1, z: 0 }, max: { x: 1, y: 1, z: 1 } }, { height: 0.2, maxW: 0.2 }), null, 'flat');
  assert.equal(fitFigurine({ min: { x: 0, y: NaN, z: 0 }, max: { x: 1, y: 1, z: 1 } }, { height: 0.2, maxW: 0.2 }), null);
});

test('figurinePose: the far end, turned toward the middle of the case', () => {
  const t = { x: 0.02, rotY: 0.3, mirror: true };
  assert.deepEqual(figurinePose(t, 1), { x: FIGURINE_INSET - 0.02, rotY: -0.3 });
  assert.deepEqual(figurinePose(t, -1), { x: -(FIGURINE_INSET - 0.02), rotY: 0.3 });
  assert.deepEqual(figurinePose({ x: 0, rotY: 0.3, mirror: false }, -1), { x: -FIGURINE_INSET, rotY: 0.3 });
});

test('vendored loaders: three r187 GLTFLoader, meshopt and Draco, with every relative import present; never from a CDN', () => {
  const files = ['vendor/three/addons/loaders/GLTFLoader.js', 'vendor/three/addons/loaders/DRACOLoader.js', 'vendor/three/addons/libs/meshopt_decoder.module.js',
    'vendor/three/addons/utils/BufferGeometryUtils.js', 'vendor/three/addons/utils/SkeletonUtils.js', 'vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js', 'vendor/three/addons/libs/draco/gltf/draco_decoder.wasm'];
  for (const f of files) assert.ok(existsSync(path.join(root, f)), f);
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    for (const m of read(f).matchAll(/from '(\.[^']+)'/g)) assert.ok(existsSync(path.join(root, path.dirname(f), m[1])), `${f} imports ${m[1]}`);
  }
  const idx = read('js/stacks3d/index.js');
  assert.ok(idx.includes("import('three/addons/loaders/GLTFLoader.js')"), 'loaded lazily through the import map');
  assert.ok(!/https?:\/\/[^'"]*(cdn|unpkg|jsdelivr|gstatic)/.test(idx));
  assert.ok(!read('js/library.js').includes('GLTFLoader'), 'the DOM tiers never load it');
  assert.match(read('vendor/three/README.txt'), /Draco, Apache License 2\.0/);
  assert.ok(statSync(path.join(root, 'vendor/three/addons/libs/draco/gltf/draco_decoder.wasm')).size > 100000);
});

/* ---------- Data, shelves and the Book of the Week ---------- */

test('libraryData accepts /api/books or books.json, and rejects anything else', () => {
  const d = libraryData({ ...data, featured: { bookId: 'zodiac', reason: 'x', since: '2026-11-16' } });
  assert.equal(d.books.length, data.books.length);
  assert.equal(d.featured.bookId, 'zodiac');
  assert.equal(libraryData(data).featured, null);
  for (const bad of [null, 'x', {}, { shelves: [], books: [] }, { shelves: data.shelves }, { books: data.books }, [1, 2]]) assert.equal(libraryData(bad), null);
  const junk = libraryData({ shelves: [...data.shelves, null, { id: 1 }], books: [...data.books, null, { id: 'x', title: 'y', shelf: 'nope', authors: [] }] });
  assert.equal(junk.shelves.length, data.shelves.length);
  assert.equal(junk.books.length, data.books.length, 'books on unknown shelves are dropped');
});

test('stockedShelves: a shelf with no books yet stays out; with books it is in, in its place', () => {
  const s = stockedShelves(data);
  assert.ok(s.shelves.every((sh) => data.books.some((b) => b.shelf === sh.id)));
  for (const sh of data.shelves) if (!data.books.some((b) => b.shelf === sh.id)) assert.ok(!s.shelves.includes(sh), `${sh.id} hidden`);
  assert.deepEqual(stockedShelves(full()).shelves.map((sh) => sh.id), data.shelves.map((sh) => sh.id));
  assert.equal(s.books, data.books);
});

test('bayColumns: even rows of DOM shelves', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(bayColumns), [1, 2, 3, 4, 3, 3, 4, 4, 3, 4]);
  assert.ok(read('styles/components/library.css').includes('var(--cols, 3)'));
});

test('featuredView: the pick, its shelf, the reason as plain text, the accessible name; null when there is nothing to show', () => {
  const d = full();
  const v = featuredView(d);
  assert.equal(v.book.id, 'the-hobbit');
  assert.equal(v.shelf.id, 'fantasy');
  assert.equal(v.reason, 'A test reason.');
  assert.equal(v.since, '2026-11-16');
  assert.equal(v.label, 'Book of the week: The Hobbit');
  assert.equal(v.byline, 'J. R. R. Tolkien');
  assert.equal(featuredView({ ...d, featured: null }), null);
  assert.equal(featuredView(data), null, 'books.json has no pick');
  assert.equal(featuredView({ ...d, featured: { bookId: 'not-a-book', reason: 'x' } }), null);
  assert.equal(featuredView({ ...d, featured: { bookId: 42 } }), null);
  assert.equal(featuredView(null), null);
  assert.equal(featuredView({ ...d, featured: { bookId: 'zodiac', reason: '  Two\nlines\u0000 here  ', since: 'Monday' } }).reason, 'Two lines here');
  assert.equal(featuredView({ ...d, featured: { bookId: 'zodiac', reason: 'x', since: 'Monday' } }).since, null);
  assert.equal(featuredView({ ...d, featured: { bookId: 'zodiac', reason: 'é'.repeat(REASON_MAX) } }).reason.length, REASON_MAX);
  assert.equal(featuredView({ ...d, featured: { bookId: 'zodiac', reason: 'x'.repeat(REASON_MAX + 1) } }).reason, '', 'too long: shown without it');
  assert.equal(featuredView({ ...d, featured: { bookId: 'zodiac', reason: { html: '<b>' } } }).reason, '');
  // The pick can be on a shelf that is out of the room (no books): then it is not shown.
  assert.equal(featuredView(stockedShelves({ ...data, featured: { bookId: 'x' } })), null);
});

test('originNote: the label for books an author or publisher put forward, nothing for the editor’s own', () => {
  assert.equal(originNote({ origin: 'author' }), 'Suggested by the author');
  assert.equal(originNote({ origin: 'publisher' }), 'Suggested by the publisher');
  for (const b of [{}, { origin: 'editor' }, { origin: 'AUTHOR' }, null, undefined]) assert.equal(originNote(b), null);
  for (const b of data.books) assert.equal(originNote(b), null, `${b.id}: static books carry no origin`);
});

test('library.js: /api/books first, books.json on any failure; empty shelves out; the pick only from the data', () => {
  const js = read('js/library.js');
  assert.match(js, /for \(const url of \['\/api\/books', 'data\/books\.json'\]\)/);
  assert.ok(js.includes('state.data = stockedShelves(d);'));
  assert.ok(js.includes('state.featured = featuredView(state.data);'));
  const html = read('library.html');
  assert.ok(html.includes('<link rel="preload" href="/api/books" as="fetch" type="application/json" crossorigin>'));
  assert.ok(!html.includes('href="data/books.json" as="fetch"'), 'no preload left unused');
  assert.ok(html.includes('<p class="lib-back__origin" id="bk-origin" hidden></p>'));
});

/* ---------- Putting a book forward ---------- */

test('the form mirrors the function: same limits, same ISBN maths, same verdicts and messages', () => {
  assert.deepEqual(BOOK_LIMITS, SERVER_LIMITS);
  const isbns = ['9780679745587', '978-0-679-74558-7', '0679745580', '0-8044-2957-X', '080442957x', '979-10-90636-07-1', 'ISBN-13: 978-0-679-74558-7',
    '9780679745588', '067974558', '12345', '', null, 42, 'abcdefghij', '979-0-679-74558-7'];
  for (const i of isbns) assert.equal(isbn13(i), toIsbn13(i), String(i));
  const now = new Date('2026-11-17T12:00:00Z');
  const ok = { title: 'A Book', authors: 'A. Writer', isbn: '0679745580', year: '2024', publisher: '', shelf: 'history', pitch: 'Why it fits.', relation: 'author', email: '', confirm: true, website: '' };
  const cases = [
    ok, { ...ok, title: '' }, { ...ok, title: 'x'.repeat(201) }, { ...ok, authors: ' ' }, { ...ok, isbn: '' }, { ...ok, isbn: '0679745581' },
    { ...ok, year: '1799' }, { ...ok, year: '2028' }, { ...ok, year: '2027' }, { ...ok, year: 2025 }, { ...ok, year: '20x5' }, { ...ok, publisher: 'p'.repeat(121) },
    { ...ok, shelf: '' }, { ...ok, shelf: 'Not A Slug' }, { ...ok, pitch: '' }, { ...ok, pitch: 'é'.repeat(600) }, { ...ok, pitch: 'é'.repeat(601) },
    { ...ok, relation: 'reader' }, { ...ok, email: 'nope' }, { ...ok, email: 'a@b.co' }, { ...ok, confirm: false }, { ...ok, confirm: 'true' },
    { ...ok, title: 'a​b\u0007c' },
  ];
  for (const c of cases) {
    const mine = bookProblems(c, { now });
    const theirs = validateBook(c, { now });
    assert.equal(mine.length === 0, theirs.ok, JSON.stringify(c).slice(0, 80));
    if (!theirs.ok) assert.equal(mine[0].message, theirs.message, JSON.stringify(c).slice(0, 80));
  }
  // Every problem at once, each against its field, so the form can mark them all.
  assert.deepEqual(bookProblems({}, { now }).map((p) => p.field), ['title', 'authors', 'isbn', 'year', 'shelf', 'pitch', 'relation', 'confirm']);
  assert.deepEqual(bookProblems({ ...ok, shelf: 'fantasy' }, { now, shelves: ['history'] }).map((p) => p.field), ['shelf'], 'only the shelves offered');
});

test('the form on library.html: every field labelled, the honeypot hidden, the rules in plain words, fiction shelves not offered', () => {
  const html = read('library.html');
  const form = html.slice(html.indexOf('<section class="lib-submit"'), html.indexOf('</section>', html.indexOf('<section class="lib-submit"')));
  assert.ok(form.includes('Wrote a true story? Put your book forward'));
  assert.ok(form.includes('aria-controls="sub-form"') && form.includes('id="sub-form" novalidate hidden'));
  for (const id of ['sub-book-title', 'sub-authors', 'sub-isbn', 'sub-year', 'sub-publisher', 'sub-shelf', 'sub-pitch', 'sub-email', 'sub-confirm']) {
    assert.ok(form.includes(`for="${id}"`) || form.includes(`<input id="${id}" name="confirm"`), `${id} labelled`);
    assert.ok(form.includes(`id="${id}-err"`), `${id} has an error line`);
  }
  assert.ok(form.includes('<div class="lib-submit__hp" aria-hidden="true"><label for="sub-website">Website</label><input id="sub-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>'));
  assert.match(read('styles/components/library.css'), /\.lib-submit__hp \{ @apply absolute overflow-hidden whitespace-nowrap; width: 1px; height: 1px; clip-path: inset\(50%\); \}/);
  for (const words of ['true story, published, with an ISBN', 'the editor writes its description and notes', 'no payment', 'no promise of a place', 'we write back whether or not', '90 days', '180 days', '7 days']) assert.ok(form.includes(words), words);
  assert.ok(read('js/library.js').includes('shelves.filter((sh) => !sh.fiction)'));
  assert.ok(form.includes('aria-live="polite">A person reads every one.</p>'));
});

test('the copy: the fiction shelves fit; the true-crime line stays; the How page explains both new things', () => {
  const html = read('library.html');
  assert.ok(!html.includes('The Stacks: true stories that sound made up'), 'the title no longer says every book is a true story');
  assert.ok(html.includes('True-crime shelves focus on the cases and the people who solved them, never on making killers famous.'));
  assert.ok(html.includes('the Book of the Week’s cover when the page opens'), 'the footer says when the pick’s cover loads');
  const how = read('how.html');
  assert.ok(how.includes('<div id="put-forward"><dt>Books put forward by authors</dt>'));
  assert.ok(how.includes('<div id="book-of-the-week"><dt>Book of the Week</dt>'));
  assert.ok(how.includes('a library of strange true stories and the classics they sit beside'));
  // The fiction shelves carry the owner-approved notes (17 Nov 2026) and the `fiction` flag.
  assert.deepEqual(data.shelves.filter((x) => x.fiction).map((x) => x.id), ['fantasy', 'scifi']);
  for (const s of data.shelves.filter((x) => x.fiction)) assert.ok(s.note && s.note.length <= 140, s.id);
  assert.equal(validate(data).length, 0);
});
