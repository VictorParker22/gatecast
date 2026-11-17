// Build step: generates the two large data files and assembles the static site in public/
// (pages, the 404 page, robots.txt, sitemap.xml, the site icons, the IndexNow key file, any search engine
// verification files from verify/, styles, scripts and vendor files including the share image), writes the plain
// /stacks/ pages from data/books.json (scripts/build-stacks-pages.cjs), compiles the Tailwind stylesheets into
// public/styles/ (site.css and the page bundles; scripts/build-css.cjs), and bundles The Stacks' scripts into hashed,
// minified files in public/js/dist/, pointing public/library.html at them (scripts/build-js.cjs).
// Airports come from mwgg/Airports (MIT), ranked with OurAirports (public domain); the land outline from Natural Earth via world-atlas.
const fs = require('node:fs');
const path = require('node:path');
const topo = require('topojson-client');
const { spawnSync } = require('node:child_process');
const { buildCss } = require('./build-css.cjs');
const { buildJs } = require('./build-js.cjs');
const stacks = require('./build-stacks-pages.cjs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const SRC = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const SIZES = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const SITE = stacks.SITE_ORIGIN + '/'; // one constant for the whole site (canonicals, JSON-LD, this sitemap)
// Public pages, in sitemap order, each with the source files its content comes from (its lastmod is the newest of
// their last commits). review.html is left out on purpose (noindex), and so is 404.html. weekly/ is the index of
// the editor's picks by week, rendered on request (lib/weekly.js); its week pages are not listed (they are not files,
// and a thin week is noindex), the index links every one.
const PAGE_SOURCES = {
  '': ['index.html'],
  'library.html': ['library.html', 'data/books.json'],
  'trip.html': ['trip.html'],
  'flights.html': ['flights.html'],
  'how.html': ['how.html'],
  'weekly/': ['lib/weekly.js'],
};
const SITEMAP_PAGES = Object.keys(PAGE_SOURCES);
// The site icons (drawn by scripts/build-icons.cjs), served from the site root like robots.txt.
const ICON_FILES = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-512.png'];
const STATIC_FILES = ['index.html', 'library.html', 'flights.html', 'trip.html', 'review.html', 'how.html', '404.html', 'robots.txt', ...ICON_FILES];
const today = () => new Date().toISOString().slice(0, 10);

// The IndexNow key file at the repo root (<32 hex>.txt holding the same key; public by design, see scripts/indexnow.cjs).
const INDEXNOW_KEY_FILE = /^[0-9a-f]{32}\.txt$/;
function indexNowKeyFile(dir = root) {
  const found = fs.readdirSync(dir).filter((f) => INDEXNOW_KEY_FILE.test(f));
  if (found.length > 1) throw new Error('more than one IndexNow key file at the repo root: ' + found.join(', '));
  return found[0] || null;
}

// Search engine ownership files (Google's googleXXXX.html, Bing's BingSiteAuth.xml, ...): the owner drops them into
// verify/ and the build copies them to the site root, where the search engines look for them. Only plain .html, .txt
// and .xml files with simple names are copied, and never one that would replace a page or file of the site itself.
const VERIFY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(html|txt|xml)$/;
function verifyFiles(dir = path.join(root, 'verify'), taken = [...STATIC_FILES, 'sitemap.xml']) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => VERIFY_NAME.test(f) && fs.statSync(path.join(dir, f)).isFile());
  const clash = files.filter((f) => taken.includes(f) || INDEXNOW_KEY_FILE.test(f));
  if (clash.length) throw new Error('verify/ would replace a site file: ' + clash.join(', '));
  return files;
}

// The commits that are the cut-off edge of a shallow clone, or an empty set for a full clone (or no git).
function shallowEdges(cwd = root) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-path', 'shallow'], { cwd, encoding: 'utf8', timeout: 5000 });
    const file = r.status === 0 ? path.resolve(cwd, r.stdout.trim()) : '';
    return new Set(file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean) : []);
  } catch { return new Set(); }
}

// The day (YYYY-MM-DD) of the last commit that touched a file, or null when it cannot be known: no git (a deploy
// from a folder), a file never committed, or a shallow clone whose history stops before the file's last change.
// Vercel's Git deployments build from a shallow clone (the last few commits). In one, a file untouched in that
// window seems to have changed in the oldest commit there (the cut-off edge, which has no parents); that date is
// not the file's, so it counts as unknown (set VERCEL_DEEP_CLONE=true on the project for exact dates everywhere).
function gitDate(file, { cwd = root, edges } = {}) {
  try {
    const r = spawnSync('git', ['log', '-1', '--format=%H %cs', '--', file], { cwd, encoding: 'utf8', timeout: 5000 });
    const [hash, d] = r.status === 0 ? r.stdout.trim().split(' ') : [];
    if (!hash || !/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
    return (edges || shallowEdges(cwd)).has(hash) ? null : d;
  } catch { return null; }
}

// A page's lastmod: the newest known date among its sources, else the build day. A source whose date is unknown
// because the shallow history stops before it is older than every commit in the window, so the newest known
// date is still right; with no git at all every source is unknown and the build day is used.
function pageLastmod(sources, dateOf, day) {
  const known = sources.map((f) => dateOf(f)).filter(Boolean).sort();
  return known.length ? known[known.length - 1] : day;
}

// Every URL in the sitemap with a real lastmod: the pages from their sources' last commits (build day without git),
// and the /stacks/ pages from the dates in data/books.json (scripts/build-stacks-pages.cjs stacksSitemapEntries).
function sitemapEntries({ day = today(), dateOf, data } = {}) {
  if (!dateOf) { const edges = shallowEdges(); dateOf = (f) => gitDate(f, { edges }); }
  const pages = SITEMAP_PAGES.map((p) => ({ loc: SITE + p, lastmod: pageLastmod(PAGE_SOURCES[p], dateOf, day) }));
  const books = stacks.stacksSitemapEntries(data).map((e) => ({ loc: e.loc, lastmod: e.lastmod || day }));
  return [...pages, ...books];
}

function sitemapXml(opts = {}) {
  const urls = sitemapEntries(opts).map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// /llms.txt: a short plain-text guide to the site for AI assistants and answer engines (the llms.txt convention:
// a Markdown file at the root with a title, a one-paragraph summary and lists of the pages worth reading). Made
// from the same data as the pages, so the counts and shelves never drift. Facts only, in the site's own words.
function llmsTxt(all = stacks.readData()) {
  const data = stacks.stocked(all);
  const fiction = data.shelves.filter((s) => s.fiction);
  const trueShelves = data.shelves.filter((s) => !s.fiction);
  const count = (list) => data.books.filter((b) => list.some((s) => s.id === b.shelf)).length;
  const link = (name, url, note) => `- [${name}](${url})${note ? `: ${note}` : ''}`;
  const takes = data.books.filter(stacks.indexable);
  const lines = [
    '# Gatecast',
    '',
    `> Gatecast is a free website with three parts: weird news from real outlets (each story is the outlet’s own headline, linked to the original), the local weather told plainly, and The Stacks, a library of ${data.books.length} real books with content notes and “Worth knowing” accuracy notes written by its editor.`,
    '',
    'Gatecast is independent: no ads, no affiliate links, no tracking cookies, no accounts. It lives at https://gatecast.vercel.app and is not connected to other projects called Gatecast.',
    '',
    'How Gatecast handles sources: it never copies an outlet’s article. A story shows the outlet’s headline, its name, the date and a link. For the editor’s picks it adds a short hook and a summary in its own words. Stories whose oddness is someone’s misfortune (deaths, injuries, children, crime) are held back.',
    '',
    '## The Stacks (books)',
    '',
    link('The Stacks, all shelves and books', SITE + 'stacks/', `${count(trueShelves)} true-story books on ${trueShelves.length} shelves and ${count(fiction)} fiction classics on ${fiction.length}, each with the editor’s own description`),
    link('Worth knowing', SITE + 'stacks/worth-knowing/', 'what is disputed about famous true-story books (for example In Cold Blood and Catch Me If You Can), one note per book'),
    link('Content notes', SITE + 'stacks/content-notes/', 'what each book describes, so a reader can decide before starting'),
    ...data.shelves.map((s) => link(s.name, stacks.pageUrl(s.id), s.note)),
    ...takes.map((b) => link(`${b.title}: Gatecast’s take`, stacks.pageUrl(b.id), 'why the book is on the shelf, what it does well and what to keep in mind')),
    link('The 3D library', SITE + 'library.html', 'the same books in a 3D reading room'),
    '',
    '## Weird news',
    '',
    link('Front page', SITE, 'today’s weird news from real outlets, with the weather'),
    link('Weird news, week by week', SITE + 'weekly/', 'the editor’s picks, grouped by week'),
    link('RSS feed', SITE + 'feed.xml', 'the editor’s picks'),
    '',
    '## How it works',
    '',
    link('How Gatecast works', SITE + 'how.html', 'how stories and books are chosen, where the data comes from, what Gatecast never does, corrections'),
    link('How the books are chosen', SITE + 'how.html#books'),
    '',
    '## Weather tools',
    '',
    link('Trips', SITE + 'trip.html', 'will the weather disrupt a flight connection?'),
    link('Flights', SITE + 'flights.html', 'a flight’s status with the weather at both ends'),
    '',
  ];
  return lines.join('\n');
}

// Airport importance from OurAirports (public domain): 2 = large with airline service, 1 = medium with airline service.
// If the download fails the site still builds; airports are then simply unranked.
async function airportRanks() {
  const rank = new Map();
  try {
    const res = await fetch(SIZES);
    if (!res.ok) throw new Error(String(res.status));
    const lines = (await res.text()).split('\n');
    const cols = lines[0].split(',').map((c) => c.replace(/"/g, ''));
    const iIdent = cols.indexOf('ident'), iType = cols.indexOf('type'), iSched = cols.indexOf('scheduled_service'), iIcao = cols.indexOf('icao_code');
    for (const line of lines.slice(1)) {
      const f = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g);
      if (!f) continue;
      const v = (i) => (f[i] || '').replace(/,$/, '').replace(/^"|"$/g, '');
      if (v(iSched) !== 'yes') continue;
      const r = v(iType) === 'large_airport' ? 2 : v(iType) === 'medium_airport' ? 1 : 0;
      if (r) { rank.set(v(iIdent), r); if (v(iIcao)) rank.set(v(iIcao), r); }
    }
  } catch (err) { console.warn('airport sizes unavailable: ' + err.message); }
  return rank;
}

async function build() {
  fs.rmSync(out, { recursive: true, force: true });
  // styles/: the legacy stylesheets that index.html and library.html still link (phase 2), not the Tailwind sources.
  const notSource = (src) => !/[/\\]styles[/\\](main(-\w+)?\.css|site(-\w+)?\.css|console\.css|components)$/.test(src);
  for (const dir of ['styles', 'js', 'vendor', 'assets']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true, filter: notSource });
  buildCss(path.join(out, 'styles'));
  for (const file of STATIC_FILES) fs.copyFileSync(path.join(root, file), path.join(out, file));
  const key = indexNowKeyFile();
  if (key) fs.copyFileSync(path.join(root, key), path.join(out, key));
  const verify = verifyFiles();
  for (const file of verify) fs.copyFileSync(path.join(root, 'verify', file), path.join(out, file));
  const js = await buildJs(out); // after the pages: it rewrites public/library.html
  const sitemap = sitemapXml();
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(out, 'llms.txt'), llmsTxt());
  const stackPages = await stacks.writeStacksPages(out);
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.copyFileSync(path.join(root, 'data', 'books.json'), path.join(out, 'data', 'books.json'));
  // The weird-news outlets, for the reviewer console's picture rule (a pick's picture must be on the story's site or
  // one of the outlet's imageHosts; js/storymedia.js pickImageProblem). Public facts only: names, feeds and hosts.
  fs.copyFileSync(path.join(root, 'data', 'weird-sources.json'), path.join(out, 'data', 'weird-sources.json'));
  // Site switches the front page reads (the newsletter signup: js/newsletter.js). Public by design.
  fs.copyFileSync(path.join(root, 'data', 'site.json'), path.join(out, 'data', 'site.json'));

  const res = await fetch(SRC);
  if (!res.ok) throw new Error('airport list download failed: ' + res.status);
  const all = await res.json();
  const rank = await airportRanks();
  const rows = [];
  for (const k in all) {
    const p = all[k];
    if (!p.iata || !/^[A-Z0-9]{3}$/.test(p.iata) || !p.tz) continue;
    if (/heliport|air base|afb|army|naval|seaplane/i.test(p.name)) continue;
    rows.push([p.iata, p.icao, p.name, p.city || '', p.country || '', +p.lat.toFixed(3), +p.lon.toFixed(3), p.tz, rank.get(p.icao) || 0]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length < 5000) throw new Error('airport list looks incomplete: ' + rows.length);
  fs.writeFileSync(path.join(out, 'data', 'airports.json'), JSON.stringify(rows));

  const w = require('world-atlas/land-110m.json');
  const land = topo.feature(w, w.objects.land);
  const geoms = land.features ? land.features.map((f) => f.geometry) : [land.geometry];
  const polys = geoms.flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates));
  let d = '';
  for (const poly of polys) for (const ring of poly) d += 'M' + ring.map(([x, y]) => (x + 180).toFixed(1) + ' ' + (90 - y).toFixed(1)).join('L') + 'Z';
  fs.writeFileSync(path.join(out, 'js', 'world.js'), '// Natural Earth 110m land (public domain), equirectangular 360x180\nexport const LAND_PATH="' + d + '";\n');
  console.log('built public/: site.css ' + fs.statSync(path.join(out, 'styles', 'site.css')).size + ' bytes, library JS ' + js.files.length + ' files (' + js.entry + '), ' + rows.length + ' airports, map outline ' + d.length + ' bytes, ' + stackPages + ' /stacks/ pages, sitemap of ' + (sitemap.match(/<url>/g) || []).length + ' URLs'
    + (verify.length ? ', verification files ' + verify.join(', ') : '') + (key ? '' : ', no IndexNow key file'));
}

if (require.main === module) build().catch((err) => { console.error(err); process.exit(1); });
module.exports = {
  sitemapXml, sitemapEntries, llmsTxt, gitDate, shallowEdges, pageLastmod, indexNowKeyFile, verifyFiles,
  SITEMAP_PAGES, PAGE_SOURCES, STATIC_FILES, ICON_FILES, SITE,
};
