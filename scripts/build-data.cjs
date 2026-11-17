// Build step: generates the two large data files and assembles the static site in public/
// (pages, robots.txt, sitemap.xml, styles, scripts and vendor files including the share image), writes the plain
// /stacks/ pages from data/books.json (scripts/build-stacks-pages.cjs), and compiles the Tailwind stylesheets into
// public/styles/ (site.css and the page bundles; scripts/build-css.cjs).
// Airports come from mwgg/Airports (MIT), ranked with OurAirports (public domain); the land outline from Natural Earth via world-atlas.
const fs = require('node:fs');
const path = require('node:path');
const topo = require('topojson-client');
const { spawnSync } = require('node:child_process');
const { buildCss } = require('./build-css.cjs');
const stacks = require('./build-stacks-pages.cjs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const SRC = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const SIZES = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const SITE = stacks.SITE_ORIGIN + '/'; // one constant for the whole site (canonicals, JSON-LD, this sitemap)
// Public pages, in sitemap order. review.html is left out on purpose (noindex).
const SITEMAP_PAGES = ['', 'library.html', 'trip.html', 'flights.html', 'how.html'];
const STATIC_FILES = ['index.html', 'library.html', 'flights.html', 'trip.html', 'review.html', 'how.html', 'robots.txt'];
const today = () => new Date().toISOString().slice(0, 10);

// The day (YYYY-MM-DD) of the last commit that touched a file, or null when git or its history is not available.
// Vercel's Git deployments build from a shallow clone (the last few commits): a file untouched in that window gets the
// date of the oldest commit there, which is newer than the truth but never in the future (set VERCEL_DEEP_CLONE=true
// on the project for exact dates). A deploy without git (vercel deploy from a folder) falls back to the build day.
function gitDate(file) {
  try {
    const r = spawnSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: root, encoding: 'utf8', timeout: 5000 });
    const d = r.status === 0 ? r.stdout.trim() : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch { return null; }
}

// Every URL in the sitemap with a real lastmod: the pages from their last commit (build day without git), and the
// /stacks/ pages from the dates in data/books.json (scripts/build-stacks-pages.cjs stacksSitemapEntries).
function sitemapEntries({ day = today(), dateOf = gitDate, data } = {}) {
  const pages = SITEMAP_PAGES.map((p) => ({ loc: SITE + p, lastmod: dateOf(p || 'index.html') || day }));
  const books = stacks.stacksSitemapEntries(data).map((e) => ({ loc: e.loc, lastmod: e.lastmod || day }));
  return [...pages, ...books];
}

function sitemapXml(opts = {}) {
  const urls = sitemapEntries(opts).map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
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
  const sitemap = sitemapXml();
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap);
  const stackPages = await stacks.writeStacksPages(out);
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.copyFileSync(path.join(root, 'data', 'books.json'), path.join(out, 'data', 'books.json'));
  // The weird-news outlets, for the reviewer console's picture rule (a pick's picture must be on the story's site or
  // one of the outlet's imageHosts; js/storymedia.js pickImageProblem). Public facts only: names, feeds and hosts.
  fs.copyFileSync(path.join(root, 'data', 'weird-sources.json'), path.join(out, 'data', 'weird-sources.json'));

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
  console.log('built public/: site.css ' + fs.statSync(path.join(out, 'styles', 'site.css')).size + ' bytes, ' + rows.length + ' airports, map outline ' + d.length + ' bytes, ' + stackPages + ' /stacks/ pages, sitemap of ' + (sitemap.match(/<url>/g) || []).length + ' URLs');
}

if (require.main === module) build().catch((err) => { console.error(err); process.exit(1); });
module.exports = { sitemapXml, sitemapEntries, gitDate, SITEMAP_PAGES, SITE };
