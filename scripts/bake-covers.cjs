#!/usr/bin/env node
// Bakes Open Library cover matches into data/books.json, so the library never has to ask Open Library at page load.
//   node scripts/bake-covers.cjs results.json [more.json ...] [--date=2026-11-16] [--accept-mismatch]
// Each results file is a saved /api/book-covers?only=... response ({ covers, errors }), a plain /api/book-covers
// response, or an array of either. A book gets `cover: { id, olKey, year, checked }` only when its result is a
// match with a cover ID; nulls, errors and books not in the results are left untouched. A match whose Open
// Library year is more than a year from ours (yearMismatch) is skipped unless --accept-mismatch is given, after
// checking it by eye. The file is rewritten in its existing one-book-per-block layout, so diffs stay small.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'books.json');

// Collects { id: result } from any mix of response shapes; later files win.
function collect(inputs) {
  const out = {};
  const add = (r) => {
    if (Array.isArray(r)) return r.forEach(add);
    if (r && typeof r === 'object' && r.covers && typeof r.covers === 'object') Object.assign(out, r.covers);
  };
  inputs.forEach(add);
  return out;
}

function bake(data, results, { date, acceptMismatch = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('date must be YYYY-MM-DD');
  const baked = [], skipped = [];
  for (const book of data.books) {
    if (!Object.prototype.hasOwnProperty.call(results, book.id)) continue;
    const r = results[book.id];
    if (!r || !Number.isInteger(r.coverId) || r.coverId <= 0) { skipped.push({ id: book.id, why: r ? 'matched, but no cover' : 'no match' }); continue; }
    const yearOff = Number.isInteger(r.year) && Math.abs(r.year - book.year) > 1;
    if ((r.yearMismatch || yearOff) && !acceptMismatch) { skipped.push({ id: book.id, why: `year mismatch: Open Library ${r.year}, ours ${book.year}` }); continue; }
    const olKey = typeof r.olKey === 'string' && /^\/works\/OL\d+W$/.test(r.olKey) ? r.olKey : null;
    book.cover = { id: r.coverId, olKey, year: Number.isInteger(r.year) ? r.year : null, checked: date };
    baked.push(book.id);
  }
  for (const id of Object.keys(results)) if (!data.books.some((b) => b.id === id)) skipped.push({ id, why: 'unknown book id' });
  return { data, baked, skipped };
}

/* ---------- The file's own layout ---------- */

const inline = (v) => {
  if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ') + ' }';
  return JSON.stringify(v);
};
const LINES = [['id', 'shelf', 'title', 'authors', 'year'], ['description'], ['tags'], ['contentNote'], ['caveat'], ['olWork', 'olEdition', 'olVerified', 'isbn13'], ['cover']];

function formatBook(b) {
  const used = new Set();
  const lines = [];
  for (const keys of LINES) {
    const parts = keys.filter((k) => k in b).map((k) => { used.add(k); return `${JSON.stringify(k)}: ${inline(b[k])}`; });
    if (parts.length) lines.push(parts.join(', '));
  }
  for (const k of Object.keys(b)) if (!used.has(k)) lines.push(`${JSON.stringify(k)}: ${inline(b[k])}`);
  return '    {\n' + lines.map((l) => '      ' + l).join(',\n') + '\n    }';
}

function formatBooks(data) {
  const head = Object.keys(data).filter((k) => k !== 'shelves' && k !== 'books').map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(data[k])}`);
  const shelves = '  "shelves": [\n' + data.shelves.map((s) => '    ' + inline(s)).join(',\n') + '\n  ]';
  const books = data.books.map((b, i) => (i && b.shelf !== data.books[i - 1].shelf ? '\n' : '') + formatBook(b));
  return '{\n' + [...head, shelves, '  "books": [\n' + books.join(',\n') + '\n  ]'].join(',\n') + '\n}\n';
}

function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--'));
  const date = (argv.find((a) => a.startsWith('--date=')) || '').slice(7) || new Date().toISOString().slice(0, 10);
  if (!files.length) { console.error('usage: node scripts/bake-covers.cjs results.json [...] [--date=YYYY-MM-DD] [--accept-mismatch]'); process.exit(2); }
  const results = collect(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const out = bake(data, results, { date, acceptMismatch: argv.includes('--accept-mismatch') });
  fs.writeFileSync(FILE, formatBooks(out.data));
  console.log(`baked ${out.baked.length}: ${out.baked.join(', ') || '-'}`);
  for (const s of out.skipped) console.log(`skipped ${s.id}: ${s.why}`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { collect, bake, formatBooks };
