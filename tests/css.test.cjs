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
const MIGRATED = ['how.html', 'trip.html', 'flights.html', 'review.html'];
const LEGACY = ['index.html', 'library.html']; // phase 2: still on tokens.css + app.css

let css;
test('the build emits a minified site.css with the theme, components and only the newsprint and risk colours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-css-'));
  const [out, consoleOut] = buildCss(path.join(dir, 'styles'));
  assert.equal(path.basename(out), 'site.css');
  assert.ok(fs.existsSync(out) && fs.existsSync(consoleOut), 'site.css and console.css are written');
  css = fs.readFileSync(out, 'utf8');
  const consoleCss = fs.readFileSync(consoleOut, 'utf8');
  assert.ok(consoleCss.includes('.rv-row') && !css.includes('.rv-row'), 'the console components ship only in console.css');
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

test('every migrated page links site.css and nothing else; index and library keep the legacy sheets for now', () => {
  for (const page of MIGRATED) {
    const sheets = [...read(page).matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    // The private reviewer console adds its own components (styles/main-console.css) after the shared sheet.
    assert.deepEqual(sheets, page === 'review.html' ? ['styles/site.css', 'styles/console.css'] : ['styles/site.css'], page);
  }
  for (const page of LEGACY) assert.match(read(page), /href="styles\/app\.css"/, page);
  for (const gone of ['how.css', 'trip.css', 'flights.css', 'review.css'])
    assert.ok(!fs.existsSync(path.join(root, 'styles', gone)), `styles/${gone} is gone`);
});

test('the deploy build compiles site.css into public/ and does not ship the Tailwind sources', () => {
  const src = read('scripts/build-data.cjs');
  assert.match(src, /buildCss\(path\.join\(out, 'styles'\)\)/);
  assert.ok(src.includes('(main\\.css|main-console\\.css|site\\.css|console\\.css|components)'), 'the Tailwind sources are filtered out of public/styles');
  assert.match(read('.gitignore'), /^styles\/site\.css$/m);
  assert.match(read('.gitignore'), /^styles\/console\.css$/m);
});
