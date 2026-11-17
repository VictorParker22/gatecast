// The Tailwind build: scripts/build-css.cjs emits one minified site.css that the migrated pages link, and the
// build step (scripts/build-data.cjs) puts it in public/styles/site.css for the deploy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCss } = require('../scripts/build-css.cjs');


const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PAGES = ['index.html', 'library.html', 'how.html', 'trip.html', 'flights.html', 'review.html'];
const OLD = ['tokens.css', 'app.css', 'home.css', 'civic.css', 'sky.css', 'motion.css', 'library.css', 'how.css', 'trip.css', 'flights.css', 'review.css'];

let css;
test('the build emits a minified site.css with the theme, components and only the newsprint and risk colours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-css-'));
  const files = buildCss(path.join(dir, 'styles'));
  assert.deepEqual(files.map((f) => path.basename(f)), ['site.css', 'site-front.css', 'site-library.css', 'console.css']);
  for (const f of files) assert.ok(fs.existsSync(f), `${path.basename(f)} is written`);
  const [out, frontOut, libOut, consoleOut] = files;
  css = fs.readFileSync(out, 'utf8');
  const only = (file, sel) => assert.ok(fs.readFileSync(file, 'utf8').includes(sel) && !css.includes(sel), `${sel} ships only in ${path.basename(file)}`);
  only(consoleOut, '.rv-row');
  only(frontOut, '.masthead__h1');
  only(libOut, '.lib-spine');
  // The page bundles read tokens that site.css defines on every page.
  for (const t of ['--text-masthead:', '--color-lib-night:', '--spacing-lib-gutter:']) assert.ok(css.includes(t), `site.css defines ${t}`);
  assert.ok(css.length > 20000, 'not empty');
  assert.ok(!/\n\s{2,}\S/.test(css.slice(0, 5000)), 'minified');
  for (const sel of ['.site-header', '.site-nav', '.btn', '.chip', '.settings', '.segmented', '.stop', '.hours', '.verdict', '.sr-only'])
    assert.ok(css.includes(sel), `has ${sel}`);
  // Exact risk colours, both editions, so contrast stays as documented.
  for (const hex of ['#0b6b5f', '#5fd3c0', '#8f4e00', '#f2b450', '#a81c48', '#ff8aa8']) assert.ok(css.toLowerCase().includes(hex), `risk colour ${hex}`);
  // Tailwind's default palette is cleared: no stray red, amber, orange or teal can be used for decoration.
  assert.ok(!/--color-(red|amber|orange|teal|rose)-\d/.test(css), 'no default palette');
  assert.ok(css.includes('url(../vendor/fonts/'), 'font files resolve next to styles/');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every page links site.css and nothing else, and the hand-written sheets are gone', () => {
  for (const page of PAGES) {
    const sheets = [...read(page).matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    // Three pages add their own components after the shared sheet: the console, the front page and The Stacks.
    const own = { 'review.html': 'styles/console.css', 'index.html': 'styles/site-front.css', 'library.html': 'styles/site-library.css' }[page];
    assert.deepEqual(sheets, own ? ['styles/site.css', own] : ['styles/site.css'], page);
  }
  for (const page of PAGES) for (const old of OLD) assert.ok(!read(page).includes('styles/' + old), `${page} does not link ${old}`);
  for (const gone of OLD) assert.ok(!fs.existsSync(path.join(root, 'styles', gone)), `styles/${gone} is gone`);
});

test('the deploy build compiles site.css into public/ and does not ship the Tailwind sources', () => {
  const src = read('scripts/build-data.cjs');
  assert.match(src, /buildCss\(path\.join\(out, 'styles'\)\)/);
  assert.ok(src.includes('(main(-\\w+)?\\.css|site(-\\w+)?\\.css|console\\.css|components)'), 'the Tailwind sources are filtered out of public/styles');
  assert.match(read('.gitignore'), /^styles\/site\.css$/m);
  for (const f of ['console', 'site-front', 'site-library']) assert.match(read('.gitignore'), new RegExp(`^styles/${f}\\.css$`, 'm'));
});
