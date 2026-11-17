// Compiles the Tailwind entries into minified stylesheets with the Tailwind CLI:
//   styles/main.css          -> site.css     (every page on Tailwind: theme, base, shared components, utilities)
//   styles/main-console.css  -> console.css  (the reviewer console's own components; review.html only)
//   node scripts/build-css.cjs           -> styles/site.css + styles/console.css (local, git-ignored; served by server.js)
//   node scripts/build-css.cjs --watch   -> the same, rebuilt on every change (npm run dev)
//   buildCss(dir) from build-data.cjs    -> public/styles/site.css + console.css for the deploy
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const STYLES = path.join(root, 'styles');
const ENTRIES = { 'site.css': 'main.css', 'console.css': 'main-console.css' };
const OUTPUTS = Object.keys(ENTRIES);
const cli = path.join(root, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const args = (input, out, extra = []) => [cli, '-i', path.join(STYLES, input), '-o', out, '--minify', ...extra];

// One build of every entry into dir; throws with the CLI's output if one fails. Returns the written paths.
function buildCss(dir = STYLES) {
  if (!fs.existsSync(cli)) throw new Error('Tailwind CLI not installed: run npm ci (or npm install) first');
  fs.mkdirSync(dir, { recursive: true });
  return Object.entries(ENTRIES).map(([out, input]) => {
    const file = path.join(dir, out);
    const r = spawnSync(process.execPath, args(input, file), { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`CSS build of ${input} failed:\n` + r.stderr + r.stdout);
    return file;
  });
}

// True when a local stylesheet is missing or older than any of its sources (styles, pages, scripts).
function stale(dir = STYLES) {
  const outs = OUTPUTS.map((o) => path.join(dir, o));
  if (outs.some((o) => !fs.existsSync(o))) return true;
  const built = Math.min(...outs.map((o) => fs.statSync(o).mtimeMs));
  const dirs = [STYLES, path.join(STYLES, 'components'), path.join(root, 'js'), root];
  return dirs.some((d) => fs.readdirSync(d).some((f) => /\.(css|html|js)$/.test(f) && !OUTPUTS.includes(f) && fs.statSync(path.join(d, f)).mtimeMs > built));
}

function watchCss(dir = STYLES) {
  return Object.entries(ENTRIES).map(([out, input]) => spawn(process.execPath, args(input, path.join(dir, out), ['--watch']), { cwd: root, stdio: 'inherit' }));
}

if (require.main === module) {
  if (process.argv.includes('--watch')) watchCss();
  else console.log('built ' + buildCss(process.argv[2] ? path.resolve(process.argv[2]) : STYLES).map((f) => path.relative(root, f)).join(', '));
}
module.exports = { buildCss, watchCss, stale, ENTRIES, OUTPUTS };
