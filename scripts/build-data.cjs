// Build step: generates the two large data files and assembles the static site in public/.
// Airports come from mwgg/Airports (MIT); the land outline from Natural Earth via world-atlas.
const fs = require('node:fs');
const path = require('node:path');
const topo = require('topojson-client');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const SRC = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  for (const dir of ['styles', 'js']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });

  const res = await fetch(SRC);
  if (!res.ok) throw new Error('airport list download failed: ' + res.status);
  const all = await res.json();
  const rows = [];
  for (const k in all) {
    const p = all[k];
    if (!p.iata || !/^[A-Z0-9]{3}$/.test(p.iata) || !p.tz) continue;
    if (/heliport|air base|afb|army|naval|seaplane/i.test(p.name)) continue;
    rows.push([p.iata, p.icao, p.name, p.city || '', p.country || '', +p.lat.toFixed(3), +p.lon.toFixed(3), p.tz]);
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
