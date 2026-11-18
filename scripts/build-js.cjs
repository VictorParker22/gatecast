// Bundles The Stacks' scripts (library.html) for the deploy with esbuild:
//   js/library.js and everything it imports, including the 3D room (js/stacks3d/, loaded with a dynamic import) and the
//   vendored libraries it uses (three r187 and its addons, cannon-es, gsap, roughjs, zdog), become a few minified ES modules in
//   public/js/dist/, named by a hash of their content (so vercel.json can cache them for a year), with no source maps.
//   Same sources, same files: the output is deterministic.
//   buildJs(outRoot) from build-data.cjs -> public/js/dist/*.js, and public/library.html pointed at the entry
//   node scripts/build-js.cjs [dir]       -> the same into dir (default public/), for a look at the sizes
// Locally, server.js serves the unbundled sources: library.html loads js/library.js through its import map, so editing
// a script needs no build. Only the copy of library.html in public/ is rewritten.
// The dist folder sits two levels deep (js/dist/), like js/stacks3d/: stacks3d/index.js finds the Draco decoder with
// new URL('../../vendor/...', import.meta.url), which resolves to the same file from either place.
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const DIST = 'js/dist';
const ENTRY = 'js/library.js';
const ROOM = 'js/stacks3d/index.js'; // the 3D room, a dynamic import of the entry
const vendor = (p) => path.join(root, 'vendor', p);
// The bare specifiers of library.html's import map, resolved to the same vendored files.
const ALIASES = { three: vendor('three/three.module.js'), 'cannon-es': vendor('cannon-es/cannon-es.js'), gsap: vendor('gsap/index.js'), roughjs: vendor('roughjs/rough.esm.js'), zdog: vendor('zdog/zdog.esm.js') };

const importMapPlugin = {
  name: 'gatecast-importmap',
  setup(build) {
    build.onResolve({ filter: /^(three|cannon-es|gsap|roughjs|zdog)$/ }, (a) => ({ path: ALIASES[a.path] }));
    build.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: vendor('three/addons/' + a.path.slice('three/addons/'.length)) }));
  },
};

// The import map and the unbundled entry in library.html, replaced in the deployed copy.
const IMPORT_MAP = /[ \t]*<script type="importmap">[\s\S]*?<\/script>\n/;
const ENTRY_TAG = /<script type="module" src="js\/library\.js"><\/script>/;

// preload3d: the 3D room's chunks, for js/library.js to preload all at once when it starts the 3D import (read from
// the script tag's data-preload-3d; otherwise the browser would find three.js only after the room's chunk arrived).
function rewriteHtml(html, entry, preloads, preload3d = []) {
  if (!IMPORT_MAP.test(html) || !ENTRY_TAG.test(html)) throw new Error('library.html: import map or <script src="js/library.js"> not found; update scripts/build-js.cjs');
  const data = preload3d.length ? ` data-preload-3d="${preload3d.join(' ')}"` : '';
  const tags = [...preloads.map((p) => `<link rel="modulepreload" href="${p}">`), `<script type="module" src="${entry}"${data}></script>`];
  return html.replace(IMPORT_MAP, '').replace(ENTRY_TAG, tags.join('\n  '));
}

async function buildJs(outRoot = path.join(root, 'public')) {
  const esbuild = require('esbuild');
  const outdir = path.join(outRoot, DIST);
  fs.rmSync(outdir, { recursive: true, force: true });
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: { library: ENTRY },
    bundle: true, splitting: true, format: 'esm', minify: true, sourcemap: false, treeShaking: true,
    target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
    outdir, entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]',
    legalComments: 'eof', charset: 'utf8', metafile: true, logLevel: 'warning',
    // Not every vendored file carries its licence in a comment (cannon-es does not): point at the files that do.
    banner: { js: '/* Gatecast, The Stacks. Built from js/ and vendor/: three.js (MIT) /vendor/three/LICENSE, cannon-es (MIT) /vendor/cannon-es/LICENSE, GSAP /vendor/gsap/LICENSE.md, Rough.js (MIT) /vendor/roughjs/LICENSE, Zdog (MIT) /vendor/zdog/LICENSE */' },
    plugins: [importMapPlugin],
  });
  const rel = (f) => path.relative(outRoot, path.join(root, f)).split(path.sep).join('/');
  const outputs = result.metafile.outputs;
  const entryOut = Object.keys(outputs).find((f) => outputs[f].entryPoint === ENTRY);
  // The chunks the entry imports statically: preloaded with it, so they don't wait for the entry to download first.
  const staticClosure = (start) => {
    const seen = new Set(), todo = [start];
    while (todo.length) for (const i of outputs[todo.pop()].imports) if (i.kind === 'import-statement' && !seen.has(i.path)) { seen.add(i.path); todo.push(i.path); }
    return seen;
  };
  const preloads = [...staticClosure(entryOut)].map(rel);
  // The 3D room's chunk and everything it imports statically, less what the page has already loaded.
  const room = Object.keys(outputs).find((f) => outputs[f].entryPoint === ROOM);
  if (!room) throw new Error('build-js: no chunk for ' + ROOM + ' (is it still imported by js/library.js?)');
  const preload3d = [room, ...[...staticClosure(room)].filter((f) => !staticClosure(entryOut).has(f))].map(rel);
  const files = Object.keys(outputs).map((f) => ({ file: rel(f), bytes: outputs[f].bytes }));
  const htmlFile = path.join(outRoot, 'library.html');
  if (fs.existsSync(htmlFile)) fs.writeFileSync(htmlFile, rewriteHtml(fs.readFileSync(htmlFile, 'utf8'), rel(entryOut), preloads, preload3d));
  return { entry: rel(entryOut), preloads, preload3d, files };
}

if (require.main === module) {
  buildJs(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then((r) => { for (const f of r.files) console.log(f.file.padEnd(40) + String(f.bytes).padStart(9)); console.log('entry ' + r.entry); })
    .catch((err) => { console.error(err); process.exit(1); });
}
module.exports = { buildJs, rewriteHtml, DIST, ALIASES };
