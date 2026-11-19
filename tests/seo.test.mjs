// Search basics across the site: every page head (titles, descriptions, locale, robots, icons, JSON-LD), the icon
// files themselves, the 404 page, the sitemap's per-page dates (git, shallow clones), the verify/ folder, the IndexNow
// key and script (with a mocked fetch; nothing is sent), the local server's icon and 404 routes, and the front page's
// font preloads, slab fallback and the brief's wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const B = require('../scripts/build-data.cjs');
const N = require('../scripts/indexnow.cjs');
const S = require('../scripts/build-stacks-pages.cjs');

const PUBLIC = ['index.html', 'library.html', 'trip.html', 'flights.html', 'how.html'];
// A page's address has no ".html": library.html is /library, and the front page is /.
const slug = (f) => (f === 'index.html' ? '' : f.replace(/\.html$/, ''));
const head = (html) => html.slice(0, html.indexOf('</head>'));
const meta = (html, attr, key) => { const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`).exec(html); return m ? m[1] : null; };
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = (html) => ldOf(html).flatMap((x) => x['@graph'] || [x]);

test('every public page: British English, its own title and a description of at most 155 characters, repeated in the share tags', () => {
  const titles = new Set();
  for (const f of PUBLIC) {
    const h = head(read(f));
    assert.match(h, /^<!doctype html>\n<html lang="en-GB">/, `${f}: lang en-GB`);
    assert.equal(meta(h, 'property', 'og:locale'), 'en_GB', `${f}: og:locale`);
    const title = /<title>([^<]+)<\/title>/.exec(h)[1];
    assert.ok(!titles.has(title), `${f}: unique title`); titles.add(title);
    assert.ok(title.length <= 70, `${f}: title ${title.length} chars`);
    assert.equal(meta(h, 'property', 'og:title'), title, `${f}: og:title`);
    assert.equal(meta(h, 'name', 'twitter:title'), title, `${f}: twitter:title`);
    const d = meta(h, 'name', 'description');
    assert.ok(d && d.length >= 70 && d.length <= 155, `${f}: description is ${d && d.length} chars`);
    assert.equal(meta(h, 'property', 'og:description'), d, `${f}: og:description`);
    assert.equal(meta(h, 'name', 'twitter:description'), d, `${f}: twitter:description`);
    assert.equal(meta(h, 'name', 'robots'), 'max-image-preview:large', `${f}: large image previews allowed`);
  }
  assert.ok(!/Gatecast — Gatecast|works — Gatecast/.test(read('how.html')), 'the brand is not repeated in the how title');
  // The library holds fiction too: its description must not promise only real books.
  const lib = meta(read('library.html'), 'name', 'description');
  assert.ok(!/^Real books/.test(lib) && /fantasy/.test(lib) && /science fiction/.test(lib));
});

test('the noindex pages: review.html keeps noindex, nofollow and gets no image-preview line; 404.html is noindex', () => {
  const r = head(read('review.html'));
  assert.equal(meta(r, 'name', 'robots'), 'noindex, nofollow');
  assert.equal((r.match(/name="robots"/g) || []).length, 1);
  const nf = read('404.html');
  assert.equal(meta(nf, 'name', 'robots'), 'noindex');
  assert.ok(!nf.includes('rel="canonical"'), 'no canonical on an error page');
});

test('icons: every page links the real files from the site root, and no page keeps the old data: URI', () => {
  for (const f of [...PUBLIC, 'review.html', '404.html']) {
    const h = head(read(f));
    assert.ok(!h.includes('href="data:image'), `${f}: no data: icon`);
    assert.ok(h.includes('<link rel="icon" href="/favicon.ico" sizes="48x48">'), `${f}: favicon.ico`);
    assert.ok(h.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'), `${f}: favicon.svg`);
    assert.ok(h.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'), `${f}: apple-touch-icon`);
  }
  for (const f of B.ICON_FILES) assert.ok(B.STATIC_FILES.includes(f) && fs.existsSync(path.join(root, f)), `${f} exists and is copied`);
  const png = (f) => { const b = fs.readFileSync(path.join(root, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(png('apple-touch-icon.png'), [180, 180]);
  assert.deepEqual(png('icon-512.png'), [512, 512]);
  const ico = fs.readFileSync(path.join(root, 'favicon.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'an ICO header');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i]);
  assert.deepEqual(sizes, [16, 32, 48]);
  const svg = read('favicon.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
  assert.ok(svg.includes('#1C36C7') && svg.includes('M5 20V9a7 7 0 0 1 14 0v11'), 'the cobalt square and the gate arch of the brand mark');
  // The generator writes the same SVG that is committed.
  assert.equal(require('../scripts/build-icons.cjs').markSvg(), svg);
});

test('JSON-LD: it parses; the home page names the logo and en-GB; the other pages have breadcrumbs; how.html is an AboutPage', () => {
  const home = nodes(read('index.html'));
  const site = home.find((n) => n['@type'] === 'WebSite');
  assert.equal(site.inLanguage, 'en-GB');
  const org = home.find((n) => n['@type'] === 'Organization');
  assert.equal(org.logo.url, B.SITE + 'icon-512.png');
  assert.deepEqual([org.logo.width, org.logo.height], [512, 512]);
  for (const [f, name] of [['library.html', 'The Stacks'], ['trip.html', 'Trips'], ['flights.html', 'Flights'], ['how.html', 'How Gatecast works']]) {
    const crumbs = nodes(read(f)).find((n) => n['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, `${f}: BreadcrumbList`);
    assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.name, i.item]), [[1, 'Gatecast', B.SITE], [2, name, B.SITE + slug(f)]], f);
  }
  const how = nodes(read('how.html'));
  const about = how.find((n) => n['@type'] === 'AboutPage');
  assert.equal(about.url, B.SITE + 'how');
  assert.equal(about.inLanguage, 'en-GB');
  assert.equal(about.isPartOf['@id'], site['@id']);
  assert.equal(about.breadcrumb['@id'], how.find((n) => n['@type'] === 'BreadcrumbList')['@id']);
  assert.equal(how.find((n) => n['@type'] === 'Organization').logo.url, org.logo.url, 'the same logo everywhere');
});

test('the /stacks/ pages are en-GB too; a book keeps the language it is written in', async () => {
  const m = await S.loadModel();
  const pages = S.renderStacks(S.stocked(JSON.parse(read('data/books.json'))), m);
  for (const p of pages) {
    assert.match(p.html, /<html lang="en-GB">/, p.path);
    assert.ok(p.html.includes('<meta property="og:locale" content="en_GB">'), p.path);
  }
  const index = pages.find((p) => p.id === null);
  assert.equal(nodes(index.html).find((n) => n['@type'] === 'CollectionPage').inLanguage, 'en-GB');
  const vercel = JSON.parse(read('vercel.json'));
  const h = vercel.headers.find((x) => x.source === '/stacks/(.*)');
  assert.deepEqual(h.headers, [{ key: 'X-Robots-Tag', value: 'max-image-preview:large' }], '/stacks/ pages allow large image previews by header');
});

test('404.html: the site header and nav, links home, to The Stacks, Trips and Flights, every link from the root; built into public/', () => {
  const html = read('404.html');
  assert.ok(B.STATIC_FILES.includes('404.html'), 'copied to public/404.html, which Vercel serves with a 404 status');
  assert.ok(html.includes('class="site-header"') && html.includes('aria-label="Main"'));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  for (const href of ['/', '/library', '/trip', '/flights']) assert.ok(html.includes(`href="${href}"`), href);
  const rel = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((x) => x[1]).filter((u) => !u.startsWith('/') && !u.startsWith('#'));
  assert.deepEqual(rel, [], 'no relative links: the page is served at any depth');
  assert.ok(read('styles/main.css').includes('@source "../404.html";'), 'Tailwind scans it');
});

test('sitemap lastmod: the newest commit among a page\'s sources; the build day only when none is known', () => {
  assert.equal(B.pageLastmod(['a', 'b'], (f) => ({ a: '2026-11-10', b: '2026-11-14' })[f], '2099-01-01'), '2026-11-14');
  assert.equal(B.pageLastmod(['a', 'b'], (f) => (f === 'a' ? '2026-11-10' : null), '2099-01-01'), '2026-11-10', 'an unknown source is older than the window');
  assert.equal(B.pageLastmod(['a'], () => null, '2099-01-01'), '2099-01-01');
  assert.deepEqual(B.PAGE_SOURCES.library, ['library.html', 'data/books.json']);
  assert.deepEqual(B.SITEMAP_PAGES, ['', 'library', 'trip', 'flights', 'how', 'weekly/']);
  assert.deepEqual(B.PAGE_SOURCES['weekly/'], ['lib/weekly.js']);
  const dates = { 'index.html': '2026-11-01', 'library.html': '2026-11-02', 'data/books.json': '2026-11-09', 'trip.html': '2026-11-03', 'how.html': '2026-11-05', 'lib/weekly.js': '2026-11-17' };
  const e = B.sitemapEntries({ day: '2099-01-01', dateOf: (f) => dates[f] || null });
  const at = (p) => e.find((x) => x.loc === B.SITE + p).lastmod;
  assert.equal(at(''), '2026-11-01');
  assert.equal(at('library'), '2026-11-09', 'the library moves with its books');
  assert.equal(at('trip'), '2026-11-03');
  assert.equal(at('flights'), '2099-01-01', 'unknown: the build day');
  assert.equal(at('how'), '2026-11-05');
  assert.equal(at('weekly/'), '2026-11-17');
});

test('gitDate: real dates from a full history; unknown (not the cut-off date) in a shallow clone; null without git', (t) => {
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (git(os.tmpdir(), '--version').status !== 0) return t.skip('git not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-git-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    const commit = (file, date) => {
      fs.writeFileSync(path.join(repo, file), date);
      git(repo, 'add', file);
      const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', file],
        { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date + 'T12:00:00Z', GIT_COMMITTER_DATE: date + 'T12:00:00Z' } });
      assert.equal(r.status, 0, r.stderr);
    };
    commit('old.html', '2026-01-05');
    commit('mid.html', '2026-03-07');
    commit('new.html', '2026-11-09');
    assert.equal(B.gitDate('old.html', { cwd: repo }), '2026-01-05');
    assert.equal(B.gitDate('new.html', { cwd: repo }), '2026-11-09');
    assert.equal(B.gitDate('missing.html', { cwd: repo }), null, 'never committed');
    assert.equal(B.shallowEdges(repo).size, 0);
    // A shallow clone of the last two commits, as Vercel builds from: old.html seems to change in the cut-off commit.
    const shallow = path.join(dir, 'shallow');
    assert.equal(git(dir, 'clone', '-q', '--depth', '2', 'file://' + repo, shallow).status, 0);
    assert.equal(B.shallowEdges(shallow).size, 1);
    assert.equal(B.gitDate('new.html', { cwd: shallow }), '2026-11-09', 'inside the window: exact');
    assert.equal(B.gitDate('old.html', { cwd: shallow }), null, 'before the window: unknown, not 2026-03-07');
    assert.equal(B.gitDate('mid.html', { cwd: shallow }), null, 'changed in the cut-off commit itself: cannot tell, so unknown');
    // No git repository at all (a deploy from a folder).
    const bare = path.join(dir, 'plain');
    fs.mkdirSync(bare);
    fs.writeFileSync(path.join(bare, 'x.html'), 'x');
    assert.equal(B.gitDate('x.html', { cwd: bare }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify/: Google and Bing ownership files are copied to the site root; nothing may replace a site file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-verify-'));
  try {
    assert.deepEqual(B.verifyFiles(path.join(dir, 'none')), [], 'no folder, nothing to copy');
    for (const f of ['google1234abcd5678ef90.html', 'BingSiteAuth.xml', 'README.md', '.hidden.html', 'run.js']) fs.writeFileSync(path.join(dir, f), 'x');
    assert.deepEqual(B.verifyFiles(dir).sort(), ['BingSiteAuth.xml', 'google1234abcd5678ef90.html']);
    fs.writeFileSync(path.join(dir, 'robots.txt'), 'x');
    assert.throws(() => B.verifyFiles(dir), /robots\.txt/);
    fs.rmSync(path.join(dir, 'robots.txt'));
    fs.writeFileSync(path.join(dir, 'sitemap.xml'), 'x');
    assert.throws(() => B.verifyFiles(dir), /sitemap\.xml/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(fs.existsSync(path.join(root, 'verify', 'README.md')), 'the folder is kept, with how to use it');
  assert.deepEqual(B.verifyFiles(), B.verifyFiles().filter((f) => f !== 'README.md'));
  const src = read('scripts/build-data.cjs');
  assert.match(src, /for \(const file of verify\) fs\.copyFileSync\(path\.join\(root, 'verify', file\), path\.join\(out, file\)\)/);
});

test('IndexNow key: one 32-hex file at the repo root holding its own name, copied to the site root', () => {
  const key = N.readKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(B.indexNowKeyFile(), key + '.txt');
  assert.equal(read(key + '.txt').trim(), key);
  assert.match(read('scripts/build-data.cjs'), /if \(key\) fs\.copyFileSync\(path\.join\(root, key\), path\.join\(out, key\)\)/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-key-'));
  try {
    assert.throws(() => N.readKey(dir), /found 0/);
    fs.writeFileSync(path.join(dir, 'a'.repeat(32) + '.txt'), 'b'.repeat(32));
    assert.throws(() => N.readKey(dir), /must hold its own name/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('indexnow.cjs: the payload, the key-file check and the answers, against a mocked fetch (nothing is sent)', async () => {
  const site = 'https://www.thegatecast.com/', key = 'f'.repeat(32);
  assert.deepEqual(N.urlsFromSitemap('<urlset><url><loc>https://a.example/x</loc></url><url><loc> https://a.example/y </loc></url></urlset>'), ['https://a.example/x', 'https://a.example/y']);
  const urls = N.sitemapUrls();
  assert.ok(urls.includes(site) && urls.includes(site + 'how') && urls.some((u) => u.includes('/stacks/')));
  const [p] = N.payloads([site, site + 'how', site], { site, key });
  assert.deepEqual(p, { host: 'www.thegatecast.com', key, keyLocation: `https://www.thegatecast.com/${key}.txt`, urlList: [site, site + 'how'] });
  assert.throws(() => N.payloads(['https://evil.example/'], { site, key }), /not on https:\/\/www\.thegatecast\.com/);
  for (const other of ['http://www.thegatecast.com/', 'https://thegatecast.com/', 'https://gatecast.vercel.app/']) assert.throws(() => N.payloads([other], { site, key }), /not on/, other);
  assert.throws(() => N.payloads([], { site, key }), /no URLs/);
  const many = Array.from({ length: N.MAX_URLS + 5 }, (_, i) => `${site}p${i}`);
  assert.deepEqual(N.payloads(many, { site, key }).map((b) => b.urlList.length), [N.MAX_URLS, 5]);

  const calls = [];
  const fetchImpl = (status, keyBody = key) => async (url, opts = {}) => {
    calls.push({ url, ...opts });
    if (url.endsWith('.txt')) return { ok: keyBody !== null, status: keyBody === null ? 404 : 200, text: async () => keyBody ?? '' };
    return { ok: status < 300, status, text: async () => '' };
  };
  const log = [];
  let out = await N.submit([site, site + 'how'], { site, key, fetchImpl: fetchImpl(202), log: (x) => log.push(x) });
  assert.equal(calls[0].url, `https://www.thegatecast.com/${key}.txt`, 'checks the live key file first');
  assert.equal(calls[1].url, N.ENDPOINT);
  assert.equal(N.ENDPOINT, 'https://api.indexnow.org/indexnow');
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].headers['Content-Type'], /^application\/json/);
  assert.deepEqual(JSON.parse(calls[1].body).urlList, [site, site + 'how']);
  assert.deepEqual(out, { sent: 2, results: [{ status: 202, count: 2, ok: true }] });
  assert.match(log[0], /202 Accepted/);

  calls.length = 0;
  out = await N.submit([site], { site, key, fetchImpl: fetchImpl(403), log: () => {} });
  assert.equal(out.sent, 0);
  assert.equal(out.results[0].ok, false);

  calls.length = 0;
  await assert.rejects(N.submit([site], { site, key, fetchImpl: fetchImpl(200, null), log: () => {} }), /answered 404; deploy first/);
  assert.equal(calls.length, 1, 'nothing is submitted when the key file is not live');
  calls.length = 0;
  await assert.rejects(N.submit([site], { site, key, fetchImpl: fetchImpl(200, 'wrong'), log: () => {} }), /does not hold the key/);

  calls.length = 0;
  const said = [];
  out = await N.submit([site], { site, key, fetchImpl: fetchImpl(200), log: (x) => said.push(x), dryRun: true });
  assert.equal(calls.length, 0, 'a dry run sends nothing');
  assert.match(said[0], /would POST 1 URLs/);
  await assert.rejects(N.main(['--bogus']), /unknown option/);
});

test('local server: the icons and the key file are served; an unknown address gets the 404 page with a 404 status', async () => {
  const { server } = require('../server.js');
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}`;
  try {
    let r = await fetch(base + '/favicon.ico');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/x-icon');
    assert.equal((await fetch(base + '/favicon.svg')).headers.get('content-type'), 'image/svg+xml');
    assert.equal((await fetch(base + '/icon-512.png')).status, 200);
    const key = N.readKey();
    r = await fetch(`${base}/${key}.txt`);
    assert.equal((await r.text()).trim(), key);
    r = await fetch(base + '/no/such/page');
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /That page isn’t on the shelf/);
    assert.equal((await fetch(base + '/server.js')).status, 404);
    assert.equal((await fetch(base + '/%E0%A4%A')).status, 404, 'a malformed address is a 404, not a crash');
  } finally { await new Promise((ok) => server.close(ok)); }
});

test('front page fonts: only the slab and Inter are preloaded; the slab has a metric-matched fallback', () => {
  const h = head(read('index.html'));
  const preloads = [...h.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => path.basename(m[1]));
  assert.deepEqual(preloads, ['alfa-slab-one-latin-400-normal.woff2', 'inter-latin-wght-normal.woff2']);
  const css = read('styles/main.css');
  const face = /@font-face \{ font-family: "Alfa Slab Fallback";[^}]*\}/.exec(css)[0];
  for (const d of ['size-adjust: 109.5%', 'ascent-override: 94.6%', 'descent-override: 30.4%', 'line-gap-override: 0%', 'local("Times New Roman Bold")', 'local("Liberation Serif Bold")']) assert.ok(face.includes(d), d);
  assert.match(read('styles/components/front.css'), /\.masthead__h1 \{ font-family: "Alfa Slab One", "Alfa Slab Fallback", var\(--font-slab\); \}/);
});

test('front page layout shift: the blocks the scripts fill keep their room until they arrive', () => {
  const html = read('index.html');
  for (const id of ['ticker', 'lead', 'also', 'wx-find', 'wx-weird']) {
    const tag = new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`).exec(html)[0];
    assert.ok(!/\shidden[\s>]/.test(tag), `#${id} is not hidden in the HTML`);
  }
  assert.match(html, /<article class="lead" id="lead" aria-labelledby="lead-h"><\/article>/, 'the lead starts empty, so :empty keeps its room');
  assert.match(html, /document\.documentElement\.dataset\.start = 'first';\n\s+try \{/, 'data-start is set even without storage');
  const css = read('styles/components/front.css');
  for (const rule of ['.lead:empty', '.also:has(> .also__list:empty)', '.wxbox__pills:empty', '.streak__digits:empty', ':root[data-start="place"] .wxbox__find', ':root:not([data-start])']) assert.ok(css.includes(rule), rule);
});

test('the brief: the front page and how.html give the same four inputs, matching what js/weather.js uses', () => {
  const idx = /<p>The brief is picked from ([^<]+)<\/p>/.exec(read('index.html'))[1];
  const how = /<p>The brief on the front page is built from ([^<]+)<\/p>/.exec(read('how.html'))[1];
  for (const text of [idx, how]) {
    assert.match(text, /^four things/);
    for (const part of ['the place you chose', 'the weather there', 'National Weather Service alerts', 'the forecast at the airports near you', 'the US state that place is in', 'a trip saved on this device', 'only adds a note when an alert covers your departure']) assert.ok(text.includes(part), part);
  }
  const wx = read('js/weather.js');
  for (const used of ['alertItems(state.alerts', 'airportSignal(state.airports', 'nearDeparture(p)', 'b.code']) assert.ok(wx.includes(used), used);
});

test('positioning: package.json, the README and CONTRIBUTING describe weird news, the weather and The Stacks', () => {
  const pkg = JSON.parse(read('package.json')).description;
  for (const w of ['weird news', 'weather', 'the stacks']) assert.ok(pkg.toLowerCase().includes(w), `package.json: ${w}`);
  const readme = read('README.md');
  const what = readme.slice(readme.indexOf('## What it does'), readme.indexOf('## Quick start'));
  for (const w of ['weird news', 'The Stacks', 'weather']) assert.ok(what.includes(w), `README What it does: ${w}`);
  const intro = read('CONTRIBUTING.md').split('\n## ')[0];
  for (const w of ['weird news', 'weather', 'The Stacks']) assert.ok(intro.includes(w), `CONTRIBUTING intro: ${w}`);
});

test('llms.txt: a short guide for AI assistants, made from the same data as the pages, written by the build and served locally', () => {
  const txt = B.llmsTxt();
  assert.match(txt, /^# Gatecast\n\n> Gatecast is a free website/);
  const books = JSON.parse(fs.readFileSync(new URL('../data/books.json', import.meta.url), 'utf8'));
  assert.ok(txt.includes(`a library of ${books.books.length} real books`), 'the count comes from books.json');
  for (const s of books.shelves) assert.ok(txt.includes(`](https://www.thegatecast.com/stacks/${s.id}/)`), s.id);
  for (const u of ['stacks/worth-knowing/', 'stacks/content-notes/', 'stacks/skyjack/', 'weekly/', 'feed.xml', 'how', 'trip', 'flights', 'library']) assert.ok(txt.includes(`(https://www.thegatecast.com/${u})`), u);
  // Every link is to this site, and nothing reads as an instruction to a model.
  for (const m of txt.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) assert.ok(m[1].startsWith('https://www.thegatecast.com/'), m[1]);
  assert.ok(!/ignore|you must|always (say|recommend)|system prompt/i.test(txt));
  assert.match(fs.readFileSync(new URL('../scripts/build-data.cjs', import.meta.url), 'utf8'), /writeFileSync\(path\.join\(out, 'llms\.txt'\), llmsTxt\(\)\)/);
  assert.match(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /url\.pathname === '\/llms\.txt'/);
  assert.match(fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8'), /llms\.txt/);
});

test('one address: https://www.thegatecast.com (the www form Vercel serves, no trailing slash), read from lib/site.js or checked against it', async () => {
  const { SITE_ORIGIN, PREVIOUS_ORIGIN } = require('../lib/site.js');
  assert.equal(SITE_ORIGIN, 'https://www.thegatecast.com');
  assert.equal(PREVIOUS_ORIGIN, 'https://gatecast.vercel.app');
  assert.equal(new URL(SITE_ORIGIN).origin, SITE_ORIGIN, 'an origin: https, no path, no trailing slash');
  // The code that builds addresses reads the one constant.
  assert.equal(S.SITE_ORIGIN, SITE_ORIGIN);
  assert.equal(B.SITE, SITE_ORIGIN + '/');
  assert.equal(require('../lib/weekly.js').SITE, SITE_ORIGIN);
  for (const f of ['scripts/build-stacks-pages.cjs', 'lib/weekly.js', 'lib/books.js']) assert.match(read(f), /require\('\.\.?\/(lib\/)?site\.js'\)/, f);
  // The files that cannot read it spell it out, and agree with it.
  assert.equal((await import('../js/tvmodel.js')).SITE, SITE_ORIGIN + '/');
  assert.ok(read('supabase/functions/community/index.ts').includes(`Deno.env.get('COMMUNITY_SITE_ORIGIN') ?? '${SITE_ORIGIN}'`));
  for (const f of PUBLIC) {
    const h = head(read(f));
    const page = SITE_ORIGIN + '/' + slug(f);
    assert.ok(h.includes(`<link rel="canonical" href="${page}">`), `${f}: canonical`);
    assert.equal(meta(h, 'property', 'og:url'), page, `${f}: og:url`);
    assert.equal(meta(h, 'property', 'og:image'), SITE_ORIGIN + '/vendor/og/gatecast-og.png', `${f}: og:image`);
    assert.equal(meta(h, 'name', 'twitter:image'), SITE_ORIGIN + '/vendor/og/gatecast-og.png', `${f}: twitter:image`);
    for (const n of nodes(read(f))) {
      // Every address in the structured data on a host named ...gatecast... (the site's own, not its GitHub page).
      for (const u of JSON.stringify(n).match(/https?:\/\/[^"\\/]*gatecast[^"\\]*/g) || []) assert.ok(u.startsWith(SITE_ORIGIN + '/'), `${f}: ${u}`);
    }
  }
  assert.ok(read('robots.txt').includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml\n`));
  assert.ok(read('robots.txt').includes(`${SITE_ORIGIN}/llms.txt`));
  assert.ok(B.llmsTxt().includes(`It lives at ${SITE_ORIGIN} and`));
  // Nothing the site serves or builds still names the old address or the bare domain (which only redirects to www). The old address stays only where
  // it must keep working: lib/site.js (as PREVIOUS_ORIGIN), the functions' allowed origins and the tip box's
  // own-pages check (js/frontmodel.js tipUrl).
  const stale = /gatecast\\?\.vercel\\?\.app|\/\/thegatecast\\?\.com/;
  const served = [...B.STATIC_FILES.filter((f) => /\.(html|txt)$/.test(f)), 'scripts/build-data.cjs', 'scripts/build-stacks-pages.cjs', 'scripts/indexnow.cjs', 'lib/weekly.js', 'lib/books.js', 'js/tvmodel.js', 'server.js', 'supabase/functions/community/index.ts'];
  for (const f of served) assert.doesNotMatch(read(f), stale, f);
  for (const out of [B.sitemapXml({ day: '2099-01-01', dateOf: () => null }), B.llmsTxt()]) assert.doesNotMatch(out, stale);
});

test('vercel.json: the old address redirects for good to the same page at the new one, in one block that only it matches', () => {
  const { SITE_ORIGIN, PREVIOUS_ORIGIN } = require('../lib/site.js');
  const v = JSON.parse(read('vercel.json'));
  const hosted = v.redirects.filter((r) => r.has);
  assert.equal(hosted.length, 1, 'one redirect with a host condition');
  const [r] = hosted;
  assert.equal(v.redirects[0], r, 'it comes first, apart from the path redirects');
  assert.deepEqual(r.has, [{ type: 'host', value: new URL(PREVIOUS_ORIGIN).host }], 'only requests for the old address');
  assert.equal(r.destination, SITE_ORIGIN + '/:path*');
  assert.equal(r.permanent, true, 'a 308');
  assert.deepEqual(Object.keys(r).sort(), ['destination', 'has', 'permanent', 'source']);
  // The source as a regular expression (Vercel's path-to-regexp): every path, except a search engine's ownership
  // file at the root, which Google will not follow to another domain.
  assert.equal(r.source, '/:path((?!google[0-9a-f]+\\.html$|BingSiteAuth\\.xml$).*)');
  const re = /^\/((?!google[0-9a-f]+\.html$|BingSiteAuth\.xml$).*)$/;
  for (const p of ['/', '/how.html', '/library.html', '/stacks/', '/stacks/skyjack/', '/weekly/2026-W47/', '/feed.xml', '/api/weird', '/sitemap.xml', '/' + B.indexNowKeyFile(), '/stacks/google12ab.html']) assert.ok(re.test(p), p);
  for (const p of ['/google1234abcd5678ef90.html', '/BingSiteAuth.xml']) assert.ok(!re.test(p), p);
  // Nothing here redirects between www and the bare domain: that is set on the domain in Vercel, and a second rule
  // in the code pointing the other way would loop.
  assert.doesNotMatch(JSON.stringify(v), /"value":\s*"(www\.)?thegatecast/);
});

test('clean addresses: /library, not /library.html, in every link, canonical and sitemap entry; the old ones redirect', async () => {
  const { CLEAN_PAGES } = require('../lib/site.js');
  assert.deepEqual(CLEAN_PAGES, ['library', 'trip', 'flights', 'how']);
  const v = JSON.parse(read('vercel.json'));
  // Each page: its file served at the clean address, and the old address sent there for good. The front page is "/".
  const redirects = v.redirects.filter((r) => r.source.endsWith('.html') && !r.has).map((r) => [r.source, r.destination, r.permanent]);
  assert.deepEqual(redirects, [['/index.html', '/', true], ...CLEAN_PAGES.map((p) => [`/${p}.html`, `/${p}`, true])]);
  const rewrites = v.rewrites.filter((r) => r.destination.endsWith('.html')).map((r) => [r.source, r.destination]);
  assert.deepEqual(rewrites, CLEAN_PAGES.map((p) => [`/${p}`, `/${p}.html`]));
  for (const p of CLEAN_PAGES) assert.ok(read(`${p}.html`).length > 1000, `${p}.html is still the file`);
  // Not a site-wide switch: Google's ownership file and the editor's sign-in page keep their ".html".
  assert.equal(v.cleanUrls, undefined);
  assert.ok(!v.redirects.some((r) => /review|google/.test(r.source) && !r.has));
  // Nothing the site writes points at an old address: the hand-written pages, the scripts that build links, the
  // generated pages, the sitemap and llms.txt.
  const OLD = /(?:href|action)="[^"]*\b(?:index|library|trip|flights|how)\.html|thegatecast\.com\/(?:index|library|trip|flights|how)\.html|[`'"]\/?(?:library|trip|flights|how)\.html[?#$`'"]/;
  for (const f of [...PUBLIC, '404.html', 'js/weather.js', 'js/flights.js', 'lib/weekly.js']) {
    const text = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
    assert.doesNotMatch(text, OLD, f);
  }
  for (const page of S.renderStacks(S.stocked(JSON.parse(read('data/books.json'))), await S.loadModel())) assert.doesNotMatch(page.html, OLD, page.path);
  assert.doesNotMatch(B.sitemapXml({ day: '2099-01-01', dateOf: () => null }), /\.html/);
  assert.doesNotMatch(B.llmsTxt(), /thegatecast\.com\/[a-z]+\.html/);
  // Locally the same: server.js reads the list.
  assert.match(read('server.js'), /CLEAN_PAGES\.includes\(rel\)\) rel \+= '\.html'/);
});

test('the maker is named the same way everywhere: ORYNTLabs LLC, with one contact address', () => {
  const MAKER = 'ORYNTLabs LLC', EMAIL = 'contact@oryntlabs.co';
  // Every hand-written page's footer names the maker and links to the How page's section about it.
  for (const f of ['index.html', 'how.html', 'trip.html', 'flights.html', 'library.html']) {
    const h = read(f), foot = h.slice(h.indexOf('<footer'), h.indexOf('</footer>'));
    assert.ok(foot.includes(`Made by <a href="how#who">${MAKER}</a>.`), `${f}: footer`);
    assert.equal(foot.split(MAKER).length - 1, 1, `${f}: named once in the footer`);
  }
  // The How page has that section, in its list of contents, with the address written out as a mailto link.
  const how = read('how.html');
  assert.ok(how.includes('<li><a class="inline-flex min-h-tap items-center" href="#who">Who makes Gatecast</a></li>'));
  const who = how.slice(how.indexOf('id="who"'), how.indexOf('id="corrections"'));
  assert.ok(who.includes(`<a href="https://oryntlabs.co/" rel="noopener">${MAKER}</a>`) && who.includes(`<a href="mailto:${EMAIL}">${EMAIL}</a>`));
  assert.ok(!how.includes('There is no email address yet'));
  // The structured data: Gatecast is the brand, the company its parent.
  for (const f of ['index.html', 'how.html']) {
    const org = nodes(read(f)).find((n) => n['@type'] === 'Organization');
    assert.equal(org.name, 'Gatecast', f);
    assert.equal(org.email, EMAIL, f);
    assert.deepEqual([org.parentOrganization.name, org.parentOrganization.legalName, org.parentOrganization.url], [MAKER, MAKER, 'https://oryntlabs.co/'], f);
  }
  // And the guide for AI assistants, as plain text (its links stay on the site's own address).
  assert.ok(B.llmsTxt().includes(`Gatecast is made by ${MAKER}, an independent product studio in New Jersey, USA (oryntlabs.co)`));
  // No other spelling of the name anywhere a reader or a crawler sees it.
  for (const f of ['index.html', 'how.html', 'trip.html', 'flights.html', 'library.html']) assert.doesNotMatch(read(f), /Orynt ?Labs|OryntLabs|ORYNT Labs/, f);
});
