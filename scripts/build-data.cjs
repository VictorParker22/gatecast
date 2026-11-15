// Build step: generates the two large data files and assembles the static site in public/.
// Airports come from mwgg/Airports (MIT), ranked with OurAirports (public domain); the land outline from Natural Earth via world-atlas.
const fs = require('node:fs');
const path = require('node:path');
const topo = require('topojson-client');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const SRC = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const SIZES = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';

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

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  for (const dir of ['styles', 'js', 'vendor']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  for (const page of ['index.html', 'flights.html', 'trip.html']) fs.copyFileSync(path.join(root, page), path.join(out, page));
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });

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
  console.log('built public/: ' + rows.length + ' airports, map outline ' + d.length + ' bytes');
})().catch((err) => { console.error(err); process.exit(1); });
