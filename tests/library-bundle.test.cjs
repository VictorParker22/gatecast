// The Stacks' deploy bundle (scripts/build-js.cjs) and the hero picture's preloads in library.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildJs, rewriteHtml, DIST } = require('../scripts/build-js.cjs');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

async function buildInto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-js-'));
  fs.copyFileSync(path.join(root, 'library.html'), path.join(dir, 'library.html'));
  const r = await buildJs(dir);
  return { dir, r, html: fs.readFileSync(path.join(dir, 'library.html'), 'utf8') };
}

test('build-js: library.html in public/ loads one hashed, minified entry instead of the import map', async () => {
  const { dir, r, html } = await buildInto();
  try {
    assert.match(r.entry, /^js\/dist\/library-[A-Z0-9]{8}\.js$/);
    assert.ok(html.includes(`<script type="module" src="${r.entry}"`), 'the page loads the bundle');
    assert.ok(!html.includes('type="importmap"'), 'no import map left');
    assert.ok(!html.includes('src="js/library.js"'), 'no unbundled entry left');
    for (const p of r.preloads) {
      assert.ok(html.includes(`<link rel="modulepreload" href="${p}">`), p);
      assert.ok(fs.existsSync(path.join(dir, p)), p);
    }
    // Every file is content-hashed (vercel.json caches js/dist/ for a year), minified, with no source map.
    const files = fs.readdirSync(path.join(dir, DIST));
    assert.ok(files.length >= 3, files.join());
    for (const f of files) {
      assert.match(f, /^[\w.]+-[A-Z0-9]{8}\.js$/, f);
      const src = fs.readFileSync(path.join(dir, DIST, f), 'utf8');
      assert.ok(!/sourceMappingURL/.test(src), f + ' has no source map');
    }
    // Minified: the entry is a handful of lines, and the whole bundle is well under the ~3 MB of unbundled sources.
    assert.ok(fs.readFileSync(path.join(dir, r.entry), 'utf8').split('\n').length < 40, 'the entry is minified');
    const total = files.reduce((s, f) => s + fs.statSync(path.join(dir, DIST, f)).size, 0);
    assert.ok(total < 1.3e6, 'bundle ' + total + ' bytes');
    // The 3D room (three.js and friends) is a separate chunk, fetched by a dynamic import: not loaded or preloaded
    // with the page, so the shelves come first.
    const entrySrc = fs.readFileSync(path.join(dir, r.entry), 'utf8');
    const three = files.filter((f) => fs.readFileSync(path.join(dir, DIST, f), 'utf8').includes('WebGLRenderer'));
    assert.ok(three.length >= 1, 'three is bundled');
    for (const f of three) {
      assert.ok(!r.preloads.includes(`${DIST}/${f}`), f + ' is not preloaded');
      assert.ok(!new RegExp(`from"\\./${f.replace('.', '\\.')}"`).test(entrySrc), f + ' is not a static import of the entry');
    }
    // ...but js/library.js preloads the room's chunks together (three.js among them) when it starts the 3D import.
    assert.ok(html.includes(`<script type="module" src="${r.entry}" data-preload-3d="${r.preload3d.join(' ')}"></script>`));
    assert.match(r.preload3d[0], /^js\/dist\/stacks3d-[A-Z0-9]{8}\.js$/);
    for (const f of three) assert.ok(r.preload3d.includes(`${DIST}/${f}`), f + ' is preloaded with the room');
    for (const p of r.preload3d) assert.ok(fs.existsSync(path.join(dir, p)) && !r.preloads.includes(p), p);
    assert.match(fs.readFileSync(path.join(root, 'js/library.js'), 'utf8'), /script\[data-preload-3d\]/);
    // The figurine loaders stay lazy chunks too, and the meshopt decoder is in the build.
    assert.ok(files.some((f) => /^GLTFLoader-/.test(f)) && files.some((f) => /^meshopt_decoder/.test(f)), files.join());
    // stacks3d/index.js finds the Draco decoder at new URL('../../vendor/…', import.meta.url): from js/dist/ that is
    // still /vendor/…, as from js/stacks3d/.
    assert.equal(DIST.split('/').length, 'js/stacks3d'.split('/').length);
    assert.ok(fs.existsSync(path.join(root, 'vendor/three/addons/libs/draco/gltf/draco_decoder.wasm')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-js: the same sources give the same files (deterministic names and bytes)', async () => {
  const a = await buildInto(), b = await buildInto();
  try {
    const list = (d) => fs.readdirSync(path.join(d, DIST)).sort();
    assert.deepEqual(list(a.dir), list(b.dir));
    for (const f of list(a.dir)) assert.ok(fs.readFileSync(path.join(a.dir, DIST, f)).equals(fs.readFileSync(path.join(b.dir, DIST, f))), f);
    assert.equal(a.html, b.html);
  } finally { for (const x of [a, b]) fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test('build-js: a library.html without the import map or the entry tag fails the build loudly', () => {
  assert.throws(() => rewriteHtml('<html><head></head></html>', 'js/dist/library-X.js', []), /not found/);
  const html = read('library.html');
  const out = rewriteHtml(html, 'js/dist/library-ABCDEFGH.js', ['js/dist/chunk-ABCDEFGH.js']);
  assert.equal(out.replace(/\n[ \t]*<link rel="modulepreload"[^\n]*/, ''), html.replace(/[ \t]*<script type="importmap">[\s\S]*?<\/script>\n/, '').replace('src="js/library.js"', 'src="js/dist/library-ABCDEFGH.js"'));
});

test('build-data runs build-js after copying the pages, so the deploy gets the bundle', () => {
  const src = read('scripts/build-data.cjs');
  const copy = src.indexOf('for (const file of STATIC_FILES) fs.copyFileSync');
  const js = src.indexOf('await buildJs(out)');
  assert.ok(copy > 0 && js > copy);
  assert.ok(JSON.parse(read('package.json')).devDependencies.esbuild, 'esbuild is a devDependency');
});

test('vercel.json: only the hashed bundle is cached for a year', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const i = (src) => cfg.headers.findIndex((h) => h.source === src);
  const rule = cfg.headers[i('/js/dist/(.*)')];
  assert.ok(rule, 'a rule for /js/dist/');
  assert.equal(rule.headers.find((h) => h.key === 'Cache-Control').value, 'public, max-age=31536000, immutable');
  assert.ok(i('/js/dist/(.*)') > i('/(.*)'), 'after the catch-all, so it wins');
  const immutable = cfg.headers.filter((h) => h.headers.some((x) => /immutable/.test(x.value))).map((h) => h.source);
  assert.deepEqual(immutable, ['/js/dist/(.*)']);
});

/* ---------- The hero picture (LCP): preloads that pick the same file as the CSS ---------- */

// A small evaluator for the media queries used here: min-/max-width, min-/max-resolution, orientation and the
// level-4 range forms ("(480px < width <= 700px)", "(resolution > 2dppx)"). Comma = or, "and" = and.
function evalFeature(f, env) {
  f = f.trim().replace(/^\(|\)$/g, '').trim();
  let m = /^(min|max)-(width|resolution):\s*([\d.]+)(?:px|dppx)$/.exec(f);
  if (m) return m[1] === 'min' ? env[m[2]] >= +m[3] : env[m[2]] <= +m[3];
  m = /^orientation:\s*(portrait|landscape)$/.exec(f);
  if (m) return (env.height >= env.width ? 'portrait' : 'landscape') === m[1];
  const cmp = (a, op, b) => ({ '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b })[op];
  m = /^([\d.]+)(?:px|dppx)\s*(<=?|>=?)\s*(width|resolution)\s*(<=?|>=?)\s*([\d.]+)(?:px|dppx)$/.exec(f);
  if (m) return cmp(+m[1], m[2], env[m[3]]) && cmp(env[m[3]], m[4], +m[5]);
  m = /^(width|resolution)\s*(<=?|>=?)\s*([\d.]+)(?:px|dppx)$/.exec(f);
  if (m) return cmp(env[m[1]], m[2], +m[3]);
  throw new Error('unknown media feature: ' + f);
}
const matches = (query, env) => query.split(',').some((part) => part.split(/\)\s+and\s+\(/).map((x, i, a) => (i > 0 ? '(' : '') + x + (i < a.length - 1 ? ')' : '')).every((f) => evalFeature(f, env)));

test('library.html preloads exactly the room picture the stylesheet shows, at every size', () => {
  const css = read('styles/components/library.css');
  const base = /\.lib-room__bg \{[^}]*url\("\.\.\/(assets\/stacks\/room-[\w-]+\.webp)"\)/.exec(css)[1];
  const rules = [...css.matchAll(/@media ([^{]+)\{\s*\.lib-room__bg \{[^}]*url\("\.\.\/(assets\/stacks\/room-[\w-]+\.webp)"\)/g)].map((m) => ({ media: m[1].trim(), file: m[2] }));
  assert.equal(rules.length, 3, 'the three overrides in library.css');
  const html = read('library.html');
  const preloads = [...html.matchAll(/<link rel="preload" as="image" href="([^"]+)" type="image\/webp" fetchpriority="high" media="([^"]+)">/g)].map((m) => ({ file: m[1], media: m[2] }));
  assert.deepEqual(preloads.map((p) => p.file).sort(), [base, ...rules.map((r) => r.file)].sort(), 'one preload per picture');
  for (const p of preloads) assert.ok(fs.existsSync(path.join(root, p.file)), p.file);
  let n = 0;
  for (let width = 280; width <= 2200; width += 0.5) for (const height of [400, 700, 844, 1000, 1400]) for (const resolution of [1, 1.25, 1.5, 2, 2.5, 3]) {
    const env = { width, height, resolution };
    let want = base;
    for (const r of rules) if (matches(r.media, env)) want = r.file; // the cascade: the last match wins
    const got = preloads.filter((p) => matches(p.media, env)).map((p) => p.file);
    assert.deepEqual(got, [want], JSON.stringify(env));
    n++;
  }
  assert.ok(n > 50000);
});
