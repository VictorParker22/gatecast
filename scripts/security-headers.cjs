#!/usr/bin/env node
// Works out the browser protection headers for the live site and keeps vercel.json in step with them.
//   node scripts/security-headers.cjs           print the headers
//   node scripts/security-headers.cjs --write   write them into vercel.json (the "/(.*)" entry)
// The Content-Security-Policy names each inline script by its hash, so run --write after changing an inline
// <script> in a page (index.html, library.html, ...), in scripts/build-stacks-pages.cjs or in lib/weekly.js.
// tests/security-headers.test.mjs fails until vercel.json matches. The rules themselves are in lib/security-headers.js.
const fs = require('node:fs');
const path = require('node:path');
const { inlineScriptHashes, securityHeaders } = require('../lib/security-headers.js');

const root = path.join(__dirname, '..');
const IMPORT_MAP = /<script type="importmap">[\s\S]*?<\/script>/; // only in the repo's library.html: the build removes it

// Every HTML document the live site serves: the hand-written pages as deployed, the /stacks/ pages, and the weekly
// pages (rendered on request by lib/weekly.js).
async function productionDocuments() {
  const { STATIC_FILES } = require('./build-data.cjs');
  const docs = STATIC_FILES.filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(root, f), 'utf8').replace(IMPORT_MAP, ''));
  const S = require('./build-stacks-pages.cjs');
  for (const p of S.renderStacks(S.stocked(JSON.parse(fs.readFileSync(path.join(root, 'data/books.json'), 'utf8'))), await S.loadModel())) docs.push(p.html);
  const W = require('../lib/weekly.js');
  const pick = { id: '00000000-0000-4000-8000-000000000000', title: 'A', url: 'https://example.org/a', outlet: 'Example', category: 'odd', picked_at: '2026-11-17T12:00:00Z' };
  for (const q of [{ view: 'weekly' }, { view: 'weekly', week: '2026-W47' }, { view: 'weekly', week: '1999-W01' }]) {
    const out = await W.render(new URLSearchParams(q), { dbPicks: [pick], filePicks: [], now: Date.parse('2026-11-18T00:00:00Z'), config: { buttondown: null } });
    if (out && /html/.test(out.type)) docs.push(out.body);
  }
  return docs;
}
async function productionHashes() {
  const all = new Set();
  for (const d of await productionDocuments()) for (const h of inlineScriptHashes(d)) all.add(h);
  return [...all].sort();
}
async function productionHeaders() { return securityHeaders(await productionHashes()); }

// The headers as vercel.json holds them: on the entry for every path, after its own headers.
const SITE_WIDE = '/(.*)';
function withHeaders(config, headers) {
  const names = new Set(headers.map(([k]) => k));
  const entry = config.headers.find((h) => h.source === SITE_WIDE);
  if (!entry) throw new Error(`vercel.json has no headers entry for ${SITE_WIDE}`);
  entry.headers = [...entry.headers.filter((h) => !names.has(h.key)), ...headers.map(([key, value]) => ({ key, value }))];
  return config;
}

if (require.main === module) {
  productionHeaders().then((headers) => {
    if (!process.argv.includes('--write')) { for (const [k, v] of headers) console.log(`${k}: ${v}`); return; }
    const file = path.join(root, 'vercel.json');
    const text = fs.readFileSync(file, 'utf8');
    // Keep the file's hand formatting: replace the one entry's headers array in place.
    const re = /(\{\s*"source": "\/\(\.\*\)",\s*"headers": )\[[\s\S]*?\]\n(\s*)\}/;
    const m = re.exec(text);
    if (!m) throw new Error('vercel.json: the "/(.*)" headers entry was not found');
    const entry = withHeaders(JSON.parse(text), headers).headers.find((h) => h.source === SITE_WIDE);
    const lines = entry.headers.map((h) => `        ${JSON.stringify(h).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace('","value":', '", "value": ').replace('"key":', '"key": ')}`);
    fs.writeFileSync(file, text.replace(re, `$1[\n${lines.join(',\n')}\n      ]\n$2}`));
    console.log(`vercel.json: ${headers.length} headers written, ${(headers[0][1].match(/'sha256-/g) || []).length} inline scripts allowed`);
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { productionDocuments, productionHashes, productionHeaders, withHeaders, SITE_WIDE };
