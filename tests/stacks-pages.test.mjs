// The plain /stacks/ pages (scripts/build-stacks-pages.cjs): what is generated, what is in the head, what the
// JSON-LD says, which covers may appear, that every word comes from data/books.json or a fixed label, that nothing
// needs JavaScript, the sitemap, robots.txt, the Vercel redirects and the local server route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const S = require('../scripts/build-stacks-pages.cjs');
const B = require('../scripts/build-data.cjs');
// The shelves as the pages show them: those with books (a shelf added before its books are merged has no page yet).
const raw = JSON.parse(read('data/books.json'));
const INTROS = JSON.parse(read('data/shelf-intros.json'));
const data = S.stocked(raw);
const NB = data.books.length, NS = data.shelves.length, NG = S.GUIDES.length; // books, stocked shelves, the two guides
const m = await S.loadModel();
const pages = S.renderStacks(data, m);
const byId = new Map(pages.map((p) => [p.id, p]));
const shelfIds = new Set(data.shelves.map((s) => s.id));

// A stand-in take of exactly TAKE_MIN_WORDS words, two paragraphs (tests only; real takes are the owner's words).
const TAKE = ('word '.repeat(S.TAKE_MIN_WORDS / 2).trim() + '\n\n' + 'more '.repeat(S.TAKE_MIN_WORDS / 2).trim());
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (html, re) => { const x = re.exec(html); return x ? decode(x[1]) : null; };
const title = (html) => attr(html, /<title>([^<]*)<\/title>/);
const canonical = (html) => attr(html, /<link rel="canonical" href="([^"]+)">/);
const metaDesc = (html) => attr(html, /<meta name="description" content="([^"]*)">/);
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => JSON.parse(x[1]));

test('one page per book, per stocked shelf and an index, written to public/stacks/<id>/index.html', async () => {
  assert.ok(NB >= 58, 'at least the 58 books of the first six shelves');
  assert.ok(NS >= 6 && NS <= raw.shelves.length);
  assert.equal(pages.length, NB + NS + NG + 1);
  assert.equal(new Set(pages.map((p) => p.path)).size, pages.length, 'paths are unique');
  for (const s of data.shelves) assert.ok(!data.books.some((b) => b.id === s.id), `shelf id ${s.id} is not also a book id`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatecast-stacks-'));
  assert.equal(await S.writeStacksPages(dir, data), NB + NS + NG + 1);
  assert.ok(fs.existsSync(path.join(dir, 'stacks', 'index.html')));
  for (const b of data.books) assert.ok(fs.existsSync(path.join(dir, 'stacks', b.id, 'index.html')), b.id);
  for (const s of data.shelves) assert.ok(fs.existsSync(path.join(dir, 'stacks', s.id, 'index.html')), s.id);
  fs.rmSync(dir, { recursive: true, force: true });
  // An id used twice would overwrite a page: refused.
  assert.throws(() => S.renderStacks({ ...data, shelves: [...data.shelves, { ...data.shelves[0], id: data.books[0].id }] }, m), /more than one/);
});

test('titles, canonicals and meta descriptions: unique, in the agreed form, from one site constant', () => {
  assert.equal(S.SITE_ORIGIN, 'https://thegatecast.com');
  assert.equal(B.SITE, S.SITE_ORIGIN + '/', 'the sitemap uses the same constant');
  const titles = pages.map((p) => title(p.html));
  const canon = pages.map((p) => canonical(p.html));
  assert.equal(new Set(titles).size, pages.length, 'titles are unique');
  assert.equal(new Set(canon).size, pages.length, 'canonicals are unique');
  for (const b of data.books) {
    const html = byId.get(b.id).html;
    assert.equal(title(html), `${b.title} by ${m.authorLine(b.authors)} — The Stacks · Gatecast`);
    assert.equal(canonical(html), `https://thegatecast.com/stacks/${b.id}/`);
    assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), canonical(html), 'og:url = canonical');
    assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), 'book');
    assert.equal(attr(html, /<meta property="og:image" content="([^"]+)">/), 'https://thegatecast.com/vendor/og/gatecast-og.png');
    assert.equal(attr(html, /<meta name="twitter:card" content="([^"]+)">/), 'summary_large_image');
    const d = metaDesc(html);
    assert.ok(d.length <= 155, `${b.id}: meta description is ${d.length} characters`);
    if (d.endsWith('…')) {
      const kept = d.slice(0, -1);
      assert.ok(b.description.startsWith(kept), `${b.id}: a cut of our description`);
      assert.match(b.description.slice(kept.length), /^[\s,;:—–-]/, `${b.id}: cut at a word`);
    } else assert.equal(d, b.description);
  }
  for (const s of data.shelves) {
    const html = byId.get(s.id).html;
    const intro = INTROS.shelves[s.id];
    assert.equal(title(html), intro ? intro.title : `${s.name} books — The Stacks · Gatecast`);
    assert.equal(canonical(html), `https://thegatecast.com/stacks/${s.id}/`);
    assert.equal(metaDesc(html), intro ? intro.description : s.note);
    assert.equal(attr(html, /<meta property="og:title" content="([^"]+)">/), title(html));
    assert.equal(attr(html, /<meta property="og:description" content="([^"]+)">/), metaDesc(html));
  }
  // A shelf with no introduction keeps the plain title and its note.
  const bare = S.shelfPage(data.shelves[0], { ...data, intros: { shelves: {} } }, m);
  assert.equal(title(bare), `${data.shelves[0].name} books — The Stacks · Gatecast`);
  assert.equal(metaDesc(bare), data.shelves[0].note);
  assert.ok(!bare.includes('<div class="stk-intro'));
  assert.equal(canonical(byId.get(null).html), 'https://thegatecast.com/stacks/');
  assert.equal(S.metaDescription('word '.repeat(60)).length <= 155, true);
  assert.equal(S.metaDescription('short.'), 'short.');
});

test('JSON-LD: Book and BreadcrumbList on book pages, CollectionPage with an ItemList on shelf pages', () => {
  const urls = new Set(pages.map((p) => S.SITE_ORIGIN + p.path));
  const crumbsOk = (bc, names) => {
    assert.equal(bc['@context'], 'https://schema.org');
    assert.equal(bc['@type'], 'BreadcrumbList');
    assert.deepEqual(bc.itemListElement.map((i) => i.name), names);
    bc.itemListElement.forEach((i, n) => { assert.equal(i['@type'], 'ListItem'); assert.equal(i.position, n + 1); assert.match(i.item, /^https:\/\/thegatecast\.com\//); });
  };
  for (const b of data.books) {
    const html = byId.get(b.id).html;
    const shelf = data.shelves.find((s) => s.id === b.shelf);
    const [book, bc] = ld(html);
    assert.equal(book['@context'], 'https://schema.org');
    assert.equal(book['@type'], 'Book');
    assert.equal(book.name, b.title);
    assert.deepEqual(book.author, b.authors.map((name) => ({ '@type': 'Person', name })));
    assert.equal(book.datePublished, String(b.year));
    assert.equal(book.inLanguage, 'en');
    assert.equal(book.url, canonical(html));
    assert.equal(book.genre, shelf.name);
    assert.deepEqual(book.about, { '@type': 'Thing', name: shelf.name });
    assert.equal(book.isbn, b.isbn13, `${b.id}: isbn only when isbn13 exists`);
    const shown = !m.NO_COVER.has(b.id) && b.cover && b.cover.id;
    assert.equal(book.image, shown ? `https://covers.openlibrary.org/b/id/${b.cover.id}-L.jpg` : undefined, `${b.id}: image only with a cover`);
    crumbsOk(bc, ['Gatecast', 'The Stacks', shelf.name, b.title]);
    assert.equal(bc.itemListElement[3].item, book.url);
  }
  for (const s of data.shelves) {
    const [cp, bc] = ld(byId.get(s.id).html);
    const books = data.books.filter((b) => b.shelf === s.id);
    assert.equal(cp['@type'], 'CollectionPage');
    assert.equal(cp.url, `https://thegatecast.com/stacks/${s.id}/`);
    assert.equal(cp.mainEntity['@type'], 'ItemList');
    assert.equal(cp.mainEntity.numberOfItems, books.length);
    assert.deepEqual(cp.mainEntity.itemListElement.map((i) => i.url), books.map((b) => `https://thegatecast.com/stacks/${b.id}/`));
    for (const [n, i] of cp.mainEntity.itemListElement.entries()) { assert.equal(i['@type'], 'ListItem'); assert.equal(i.position, n + 1); assert.ok(urls.has(i.url)); }
    crumbsOk(bc, ['Gatecast', 'The Stacks', s.name]);
  }
  const [cp, bc] = ld(byId.get(null).html);
  assert.equal(cp['@type'], 'CollectionPage');
  assert.equal(cp.mainEntity.numberOfItems, NS);
  crumbsOk(bc, ['Gatecast', 'The Stacks']);
  // A string that tries to close the script element stays inside it.
  const evil = { ...data, books: data.books.map((b, i) => (i ? b : { ...b, title: 'A </script><b>x' })) };
  const html = S.bookPage(evil.books[0], evil, m);
  assert.equal(ld(html)[0].name, 'A </script><b>x');
});

test('covers: only checked Open Library covers, never for NO_COVER books; otherwise the stand-in', () => {
  assert.ok(m.NO_COVER.has('helter-skelter'));
  for (const b of data.books) {
    const html = byId.get(b.id).html;
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((x) => x[0]);
    if (m.NO_COVER.has(b.id) || !(b.cover && b.cover.id)) {
      assert.equal(imgs.length, 0, `${b.id}: no <img>`);
      assert.ok(!html.includes('covers.openlibrary.org'), `${b.id}: no cover address anywhere`);
      assert.match(html, /class="lib-standin"/, `${b.id}: the stand-in`);
      assert.ok(!html.includes('Cover: Open Library'), `${b.id}: no cover credit`);
    } else {
      assert.equal(imgs.length, 1, b.id);
      const img = imgs[0];
      assert.ok(img.includes(`src="https://covers.openlibrary.org/b/id/${b.cover.id}-L.jpg"`), b.id);
      assert.match(img, /loading="lazy"/);
      assert.match(img, /width="\d+" height="\d+"/);
      assert.match(img, /referrerpolicy="no-referrer"/);
      assert.equal(attr(img, /alt="([^"]*)"/), `Cover of ${b.title}`);
      assert.ok(html.includes('Cover: Open Library'));
    }
  }
  // Even a NO_COVER book that gains a baked cover id in the data gets no picture.
  const hs = data.books.find((b) => b.id === 'helter-skelter');
  assert.ok(!S.bookPage({ ...hs, cover: { id: 12345, olKey: null, checked: '2026-11-16' } }, data, m).includes('<img'));
});

test('every word on every page is from data/books.json or a fixed label', () => {
  const check = (pagesToCheck, d) => {
    const strings = new Set([...S.UI_TEXT, S.OG_ALT]);
    for (const s of d.shelves) [s.name, s.chip, s.note].forEach((x) => strings.add(x));
    for (const e of Object.values(INTROS.shelves)) [e.title, e.description, ...e.intro].forEach((x) => strings.add(x));
    for (const b of d.books) {
      [b.title, ...b.authors, m.authorLine(b.authors), String(b.year), b.description, S.firstSentence(b.description), b.contentNote, b.caveat, ...b.tags].forEach((x) => x && strings.add(x));
      S.takeParagraphs(b).forEach((x) => strings.add(x));
      const w = b.preview && b.preview.watch;
      if (w) [w.title, w.channel, w.label, w.duration].forEach((x) => strings.add(x));
    }
    const all = [...strings].filter(Boolean).sort((a, b) => b.length - a.length);
    const longText = [...d.books.map((b) => b.description), ...d.shelves.map((s) => s.note), ...S.UI_TEXT];
    for (const p of pagesToCheck) {
      const h = p.html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      const texts = [...h.matchAll(/>([^<]+)</g)].map((x) => decode(x[1]).trim()).filter(Boolean);
      for (const x of h.matchAll(/\s(?:alt|aria-label)="([^"]*)"/g)) texts.push(decode(x[1]));
      for (const x of h.matchAll(/<meta (?:name|property)="(?:description|og:title|og:description|og:image:alt|twitter:title|twitter:description)" content="([^"]*)"/g)) {
        const t = decode(x[1]);
        if (t.endsWith('…')) assert.ok(longText.some((l) => l.startsWith(t.slice(0, -1))), `${p.path}: "${t}" is a cut of our text`);
        else texts.push(t);
      }
      for (const t of texts) {
        let rest = t;
        for (const s of all) rest = rest.split(s).join(' ');
        assert.match(rest, /^[\s\d.,;:·—–›()'’"“”|-]*$/, `${p.path}: "${t}" has words not in books.json or UI_TEXT ("${rest.trim()}")`);
      }
    }
  };
  check(pages, data);
  // With an approved preview the video's own title and channel appear, and nothing else new.
  const withPreview = { ...data, books: data.books.map((b, i) => (i ? b : { ...b, preview: { watch: { kind: 'youtube', id: 'abcdefghijk', title: 'A talk about the book', channel: 'A Channel', duration: '12:34', label: 'Author talk' }, look: { kind: 'archive', identifier: 'someidentifier00' } } })) };
  check(S.renderStacks(withPreview, m).filter((p) => p.id === data.books[0].id), withPreview);
});

test('no JavaScript is needed and nothing is embedded: plain HTML with site.css and site-library.css', () => {
  for (const p of pages) {
    const h = p.html;
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${p.path}: one h1`);
    assert.match(h, /<main id="main"/);
    assert.match(h, /<header class="site-header">/);
    assert.match(h, /<footer class="site-footer">/);
    assert.match(h, /<nav class="stk-crumbs" aria-label="Breadcrumb">/);
    const sheets = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((x) => x[1]);
    assert.deepEqual(sheets, ['/styles/site.css', '/styles/site-library.css'], p.path);
    assert.ok(!/<script[^>]*\ssrc=/.test(h), `${p.path}: no script files`);
    assert.ok(!/type="module"|importmap|vendor\/three|three\.module|cannon-es|gsap|js\/library\.js/.test(h), `${p.path}: no module, three.js, cannon or gsap`);
    for (const s of h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (s[1].includes('application/ld+json')) continue;
      assert.match(s[2], /^\s*try \{ document\.querySelector\('meta\[name="color-scheme"\]'\)/, `${p.path}: only the colour-scheme line runs`);
    }
    assert.ok(!/<(iframe|embed|object|video|audio)\b/.test(h), `${p.path}: no embeds`);
    for (const src of h.matchAll(/\ssrc="([^"]+)"/g)) assert.match(src[1], /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-L\.jpg$/, `${p.path}: the only third-party file is a cover`);
  }
});

test('book pages link the shelf, the 3D library, the same outbound links as the library, and 4–6 siblings', () => {
  for (const b of data.books) {
    const h = byId.get(b.id).html;
    assert.ok(h.includes(`href="/library.html#book=${b.id}">Open it in The Stacks</a>`), b.id);
    assert.ok(h.includes(`href="/stacks/${b.shelf}/"`), `${b.id}: shelf linked`);
    assert.ok(h.includes(`href="${m.worldcatUrl(b).replace(/&/g, '&amp;')}"`), `${b.id}: WorldCat`);
    assert.ok(h.includes(`href="${m.bookshopUrl(b, null).replace(/&/g, '&amp;')}"`), `${b.id}: Bookshop.org, plain`);
    assert.ok(!/a_aid=|bookshop\.org\/a\//.test(h), `${b.id}: no affiliate link`);
    assert.ok(h.includes(`href="${m.openLibraryUrl(b, m.coverFor(b)).replace(/&/g, '&amp;')}"`), `${b.id}: Open Library`);
    if (b.caveat) assert.ok(h.includes('<strong>Worth knowing.</strong>'), b.id); else assert.ok(!h.includes('Worth knowing.'), b.id);
    if (b.contentNote) assert.ok(h.includes('<strong>Content note.</strong>'), b.id); else assert.ok(!h.includes('Content note.'), b.id);
    const more = h.split('id="more-title"')[1].split('</ul>')[0];
    const links = [...more.matchAll(/href="\/stacks\/([a-z0-9-]+)\/"/g)].map((x) => x[1]);
    assert.ok(links.length >= 4 && links.length <= 6, `${b.id}: ${links.length} siblings`);
    assert.ok(!links.includes(b.id), `${b.id}: not itself`);
    for (const id of links) assert.equal(data.books.find((x) => x.id === id).shelf, b.shelf);
    assert.equal(h.includes('id="preview-title"'), Boolean(m.previewFor(b)), `${b.id}: a preview section only with approved preview data`);
  }
  // Every book is reachable from its shelf page and the index.
  for (const b of data.books) {
    assert.ok(byId.get(b.shelf).html.includes(`href="/stacks/${b.id}/"`), `${b.id} on its shelf page`);
    assert.ok(byId.get(null).html.includes(`href="/stacks/${b.id}/"`), `${b.id} on the index`);
  }
  for (const s of data.shelves) {
    const h = byId.get(s.id).html;
    assert.ok(h.includes(`href="/library.html#shelf=${s.id}"`));
    assert.ok(h.includes(S.shelfIntro(data.books.filter((b) => b.shelf === s.id))));
  }
  assert.ok(byId.get(null).html.includes('href="/library.html"'));
});

test('an approved preview is a link out: YouTube or C-SPAN watch page, Internet Archive details, no embed', () => {
  const b0 = data.books.find((b) => b.id === 'in-cold-blood');
  const yt = S.bookPage({ ...b0, preview: { watch: { kind: 'youtube', id: 'abcdefghijk', title: 'A talk', channel: 'A Channel', duration: '58:10', label: 'Author talk' }, look: { kind: 'archive', identifier: 'incoldblood00capo' } } }, data, m);
  assert.ok(yt.includes('href="https://www.youtube.com/watch?v=abcdefghijk"'));
  assert.ok(yt.includes('href="https://archive.org/details/incoldblood00capo"'));
  for (const t of ['A talk', 'A Channel', 'Author talk · 58:10', 'Watch on YouTube']) assert.ok(yt.includes(t), t);
  assert.ok(!/i\.ytimg\.com|youtube-nocookie|<iframe|archive\.org\/embed/.test(yt), 'no poster, player or embed');
  const cs = S.bookPage({ ...b0, preview: { watch: { kind: 'cspan', url: 'https://www.c-span.org/video/?123456-1/talk', title: 'A talk', channel: 'C-SPAN', duration: '1:04:05', label: 'Book talk' } } }, data, m);
  assert.ok(cs.includes('href="https://www.c-span.org/video/?123456-1/talk"') && cs.includes('Watch on C-SPAN'));
  // Invalid preview data is ignored (previewFor), not printed.
  const bad = S.bookPage({ ...b0, preview: { watch: { kind: 'youtube', id: 'x', title: '<b>', channel: 'c', duration: 'long', label: 'Trailer' } } }, data, m);
  assert.ok(!bad.includes('id="preview-title"'));
});

test('sitemap: the pages, /stacks/, the stocked shelves and the books with a take, dated from git and the data, not the build day', () => {
  const xml = B.sitemapXml({ day: '2099-01-01', dateOf: (f) => (f === 'how.html' ? '2026-11-10' : null) });
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((x) => ({ loc: x[1], lastmod: x[2] }));
  const listed = data.books.filter(S.indexable).length;
  assert.equal(urls.length, B.SITEMAP_PAGES.length + 1 + NS + NG + listed, 'pages, /stacks/, shelves and only the books with a take');
  assert.equal(new Set(urls.map((u) => u.loc)).size, urls.length, 'no duplicates');
  const at = (loc) => urls.find((u) => u.loc === 'https://thegatecast.com/' + loc);
  assert.equal(at('how.html').lastmod, '2026-11-10', 'a page: its last commit');
  assert.equal(at('trip.html').lastmod, '2099-01-01', 'no git date: the build day');
  assert.ok(!xml.includes('review.html'));
  for (const u of urls.filter((x) => x.loc.includes('/stacks/'))) {
    assert.match(u.loc, /^https:\/\/thegatecast\.com\/stacks\/([a-z0-9-]+\/)?$/);
    assert.notEqual(u.lastmod, '2099-01-01', `${u.loc}: dated from the data`);
    assert.match(u.lastmod, /^\d{4}-\d{2}-\d{2}$/);
  }
  // A per-book date wins when it is newer, and lifts its shelf and the index.
  const newer = { ...data, books: data.books.map((b) => (b.id === 'in-cold-blood' ? { ...b, checked: '2026-12-01', take: TAKE } : b)) };
  const e = S.stacksSitemapEntries(newer);
  const get = (id) => e.find((x) => x.loc === S.pageUrl(id)).lastmod;
  assert.equal(get('in-cold-blood'), '2026-12-01');
  assert.equal(get('crime'), '2026-12-01');
  assert.equal(get(null), '2026-12-01');
  assert.equal(get('serial'), [INTROS.shelves.serial.updated, ...data.books.filter((b) => b.shelf === 'serial').map((b) => S.bookLastmod(b, data))].sort().pop());
  // A shelf introduction's date lifts its shelf page; a take's date lifts its book page.
  const later = { ...data, intros: { shelves: { ...INTROS.shelves, cults: { ...INTROS.shelves.cults, updated: '2027-01-05' } } } };
  assert.equal(S.stacksSitemapEntries(later).find((x) => x.loc === S.pageUrl('cults')).lastmod, '2027-01-05');
  const sky = data.books.find((b) => b.id === 'skyjack');
  assert.equal(S.bookLastmod(sky, data), [data.checked, sky.cover.checked, sky.takeDate].sort().pop());
  // The default reads git when it can; whatever it returns is a date or null.
  const g = B.gitDate('how.html');
  assert.ok(g === null || /^\d{4}-\d{2}-\d{2}$/.test(g));
});

test('robots.txt: /stacks/ and the three page-data endpoints allowed, the rest of /api/ not, review.html not blocked', () => {
  const robots = read('robots.txt');
  const groups = robots.split(/\n(?=User-agent:)/).filter((g) => g.startsWith('User-agent:'));
  assert.deepEqual(groups.map((g) => g.split('\n')[0]), ['User-agent: *', 'User-agent: OAI-SearchBot', 'User-agent: PerplexityBot']);
  for (const g of groups) {
    const lines = g.split('\n').map((l) => l.trim());
    const dis = lines.indexOf('Disallow: /api/');
    assert.ok(dis > 0, 'the API stays disallowed');
    for (const a of ['Allow: /stacks/', 'Allow: /api/weird', 'Allow: /api/news', 'Allow: /api/book-covers']) {
      const i = lines.indexOf(a);
      assert.ok(i > 0 && i < dis, `${lines[0]}: ${a} before Disallow: /api/`);
    }
    assert.ok(!lines.some((l) => /^Disallow: \/review\.html/.test(l)), `${lines[0]}: review.html is not blocked (its noindex header must be seen)`);
  }
  assert.match(robots, /^Sitemap: https:\/\/thegatecast\.com\/sitemap\.xml$/m);
  const v = JSON.parse(read('vercel.json'));
  const header = (src) => v.headers.find((h) => h.source === src)?.headers.find((x) => x.key === 'X-Robots-Tag')?.value;
  assert.equal(header('/review.html'), 'noindex, nofollow');
  assert.equal(header('/api/(.*)'), 'noindex');
});

test('vercel.json: only /stacks/ (and /weekly/) URLs get a trailing-slash redirect (no site-wide trailingSlash)', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.trailingSlash, undefined);
  assert.equal(v.cleanUrls, undefined);
  // The /weekly/ redirects are the weekly archive's own (tests/weekly.test.mjs); the one with a host condition sends
  // the old address to the new one (tests/seo.test.mjs).
  const r = v.redirects.filter((x) => !x.source.startsWith('/weekly') && !x.has);
  assert.deepEqual(r.map((x) => [x.source, x.destination, x.permanent]), [['/stacks', '/stacks/', true], ['/stacks/:id([a-z0-9-]+)', '/stacks/:id/', true]]);
  // Vercel matches sources strictly (a trailing slash is not optional): the same pattern as a regular expression.
  const re = /^\/stacks\/([a-z0-9-]+)$/;
  for (const p of pages.filter((x) => x.id)) { assert.ok(re.test(p.path.slice(0, -1)), p.path); assert.ok(!re.test(p.path), `${p.path} is not redirected again`); }
  assert.ok(!re.test('/stacks/index.html'));
});

test('local server: /stacks/<id> redirects to the slash form, which serves the page; unknown ids are 404', async () => {
  const { server } = require('../server.js');
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}`;
  try {
    let r = await fetch(base + '/stacks/crime', { redirect: 'manual' });
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), '/stacks/crime/');
    r = await fetch(base + '/stacks', { redirect: 'manual' });
    assert.equal(r.headers.get('location'), '/stacks/');
    r = await fetch(base + '/stacks/in-cold-blood/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /<h1 id="book-title" class="stk-title">In Cold Blood<\/h1>/);
    assert.equal((await fetch(base + '/stacks/')).status, 200);
    assert.equal((await fetch(base + '/stacks/crime/index.html')).status, 200);
    assert.equal((await fetch(base + '/stacks/no-such-book/')).status, 404);
    assert.equal((await fetch(base + '/stacks/../server.js')).status, 404);
  } finally { await new Promise((ok) => server.close(ok)); }
});

test('styles: the page template is scanned by Tailwind and its components ship in site-library.css', () => {
  assert.match(read('styles/main.css'), /^@source "\.\.\/scripts\/build-stacks-pages\.cjs";/m);
  assert.match(read('styles/main-library.css'), /^@import "\.\/components\/stacks-pages\.css";$/m);
  const css = read('styles/components/stacks-pages.css');
  for (const sel of ['.stk-book', '.stk-cover', '.stk-note', '.stk-crumbs', '.stk-list', '.stk-link']) assert.ok(css.includes(sel), sel);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'tokens only, no hex colours');
  assert.ok(read('scripts/build-data.cjs').includes('writeStacksPages(out)'), 'the build writes the pages');
});

test('indexing: book pages are noindex, follow and left out of the sitemap until the book has a take of 150+ words', () => {
  assert.equal(S.TAKE_MIN_WORDS, 150);
  assert.equal(S.wordCount('It’s a well-known, 1966 book.'), 5);
  // Only the books with a take are indexed and listed; every other book page is noindex, follow.
  const withTakes = data.books.filter((b) => typeof b.take === 'string');
  assert.deepEqual(withTakes.map((b) => b.id), ['skyjack'], 'the takes written so far');
  for (const b of data.books) {
    const h = byId.get(b.id).html;
    const has = withTakes.includes(b);
    assert.equal(S.indexable(b), has, b.id);
    assert.equal(h.includes('<meta name="robots" content="noindex, follow">'), !has, `${b.id}: noindex, follow only without a take`);
    assert.equal(h.includes('id="take-title"'), has, `${b.id}: a take section only with a take`);
  }
  for (const p of pages.filter((x) => !x.id || shelfIds.has(x.id))) assert.ok(!p.html.includes('name="robots"'), `${p.path} is indexed`);
  const locs = S.stacksSitemapEntries(data).map((e) => e.loc);
  assert.deepEqual(locs, [S.pageUrl(null), ...data.shelves.map((s) => S.pageUrl(s.id)), ...S.GUIDES.map((g) => S.pageUrl(g.id)), ...withTakes.map((b) => S.pageUrl(b.id))]);

  // With a take of TAKE_MIN_WORDS words: indexed, in the sitemap, and the take is shown in its paragraphs.
  const b0 = data.books.find((b) => b.id === 'helter-skelter');
  const withTake = { ...data, books: data.books.map((b) => (b.id === b0.id ? { ...b, take: TAKE, takeDate: '2026-12-01' } : b)) };
  assert.equal(S.wordCount(TAKE), S.TAKE_MIN_WORDS);
  const h = S.bookPage(withTake.books.find((b) => b.id === b0.id), withTake, m);
  assert.ok(!h.includes('name="robots"'), 'indexable');
  assert.ok(h.includes('<h2 id="take-title" class="stk-take__title">Gatecast’s take</h2>'));
  assert.equal((h.match(/<section class="stk-take"[\s\S]*?<\/section>/)[0].match(/<p>/g) || []).length, 2, 'one <p> per paragraph');
  assert.ok(h.includes('Written <time datetime="2026-12-01">1 December 2026</time>'));
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
  const entries = S.stacksSitemapEntries(withTake);
  assert.ok(entries.some((e) => e.loc === S.pageUrl(b0.id)), 'listed in the sitemap');
  assert.equal(entries.length, 1 + NS + NG + withTakes.length + 1);
  assert.equal((B.sitemapXml({ data: withTake, dateOf: () => null }).match(/<url>/g) || []).length, B.SITEMAP_PAGES.length + 1 + NS + NG + withTakes.length + 1);

  // One word short: shown, but still noindex and unlisted.
  const short = TAKE.replace(/ more$/, '');
  const withShort = { ...data, books: data.books.map((b) => (b.id === b0.id ? { ...b, take: short } : b)) };
  const hs = S.bookPage(withShort.books.find((b) => b.id === b0.id), withShort, m);
  assert.ok(hs.includes('id="take-title"'));
  assert.ok(hs.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(!S.stacksSitemapEntries(withShort).some((e) => e.loc === S.pageUrl(b0.id)));
});

test('the <noscript> list for library.html links every shelf and book page', () => {
  const h = S.noscriptHtml(data, m);
  assert.match(h, /^<noscript>[\s\S]*<\/noscript>$/);
  assert.ok(h.includes('href="/stacks/"'));
  for (const id of [...data.shelves.map((s) => s.id), ...data.books.map((b) => b.id)]) assert.ok(h.includes(`href="/stacks/${id}/"`), id);
  assert.ok(!/<script|<img/.test(h));
});


/* ---------- Stacks v2: N shelves, empty shelves, approved author books ---------- */

// Two fiction shelves filled with made-up test books (fixtures only, not real records), as the lead will merge them.
function withFiction(base = raw) {
  const books = [...base.books];
  for (const shelf of ['fantasy', 'scifi']) {
    for (let k = 0; k < 9; k++) {
      books.push({ id: `${shelf}-test-${k}`, shelf, title: `Test ${shelf} book ${k}`, authors: ['Test Author'], year: 1900 + k, description: 'A test book. It checks the layout.', tags: ['Test'], olWork: null, olEdition: null, olVerified: false });
    }
  }
  return { ...base, books };
}

test('a shelf with no books yet has no page, is not listed and is not in the sitemap; with books it is', () => {
  const empty = raw.shelves.filter((sh) => !raw.books.some((b) => b.shelf === sh.id)).map((sh) => sh.id);
  const all = S.renderStacks(raw, m);
  for (const id of empty) {
    assert.ok(!all.some((p) => p.id === id), `${id}: no page`);
    assert.ok(!all.find((p) => p.id === null).html.includes(`/stacks/${id}/`), `${id}: not on the index`);
    assert.ok(!S.stacksSitemapEntries(raw).some((e) => e.loc === S.pageUrl(id)));
    assert.ok(!S.noscriptHtml(raw, m).includes(`/stacks/${id}/`));
  }
  const full = withFiction();
  const fp = S.renderStacks(full, m);
  assert.equal(fp.length, full.books.length + raw.shelves.length + NG + 1);
  assert.ok(fp.some((p) => p.id === 'fantasy') && fp.some((p) => p.id === 'scifi'));
  assert.equal(S.stacksSitemapEntries(full).length, 1 + raw.shelves.length + NG + full.books.filter(S.indexable).length);
  assert.equal(S.shelfIntro([]), '');
});

test('approved author books: the "Suggested by the author/publisher" note, and nothing else extra', () => {
  const b = { id: 'test-author-book', shelf: 'history', title: 'A Test Book', authors: ['Test Author'], year: 2025, description: 'A test book. It is not real.', tags: ['Test'], isbn13: '9780306406157', olWork: null, olEdition: null, olVerified: false, origin: 'author' };
  const d = { ...data, books: [...data.books, b] };
  const h = S.bookPage(b, d, m);
  assert.ok(h.includes('<p class="stk-origin">Suggested by the author</p>'));
  assert.ok(S.bookPage({ ...b, origin: 'publisher' }, d, m).includes('<p class="stk-origin">Suggested by the publisher</p>'));
  assert.ok(!S.bookPage(data.books[0], data, m).includes('stk-origin'), 'the editor’s own books carry no note');
  assert.ok(S.UI_TEXT.includes('Suggested by the author') && S.UI_TEXT.includes('Suggested by the publisher'));
});

test('buildData: approved books from lib/stacks-db.js join the static ones; bad or clashing ones and failures are left out', async () => {
  const quiet = console.warn; console.warn = () => {};
  try {
    const good = { id: 'test-approved', shelf: 'science', title: 'A Test Approved Book', authors: ['Test Author'], year: 2024, description: 'A test book. It is approved.', tags: ['Test'], olWork: null, olEdition: null, olVerified: false };
    const clash = { ...good, id: raw.books[0].id };
    const bad = { ...good, id: 'Bad Id' };
    const load = { loadStacksExtras: async () => ({ books: [good, clash, bad], featured: { bookId: 'test-approved', reason: 'x', since: '2026-11-16' } }) };
    const out = await S.buildData({ data: raw, m, env: {}, load });
    assert.equal(out.books.length, raw.books.length + 1);
    assert.ok(out.books.some((b) => b.id === 'test-approved'));
    assert.equal(out.featured, undefined, 'no Book of the Week on static pages');
    const merged = await S.buildData({ data: raw, m, env: {}, load: { ...load, mergeBooks: (st, ex) => ({ ...st, books: [...st.books, ...ex.books], merged: true }) } });
    assert.equal(merged.merged, true, 'uses mergeBooks when the module has it');
    assert.equal(await S.buildData({ data: raw, m, env: {}, load: { loadStacksExtras: async () => { throw new Error('offline'); } } }), raw);
    assert.equal(await S.buildData({ data: raw, m, env: {}, load: { loadStacksExtras: async () => ({ books: [], featured: null }) } }), raw);
    assert.equal(await S.buildData({ data: raw, m, env: { GATECAST_STACKS_DB: 'off' }, load }), raw);
  } finally { console.warn = quiet; }
});

test('the guides: every "Worth knowing" note of the true-story shelves and every content note, word for word, indexed and in the sitemap', () => {
  assert.deepEqual(S.GUIDES.map((g) => g.id), ['worth-knowing', 'content-notes']);
  const fiction = new Set(data.shelves.filter((sh) => sh.fiction).map((sh) => sh.id));
  const esc = S.esc;
  // Worth knowing: the true-story shelves only, each note exactly as the book page shows it.
  const wk = byId.get('worth-knowing').html;
  const disputed = data.books.filter((b) => b.caveat && !fiction.has(b.shelf));
  assert.ok(disputed.length >= 20);
  for (const b of disputed) {
    assert.ok(wk.includes(`<h3 class="stk-item__title"><a class="inline-flex min-h-tap items-center" href="/stacks/${b.id}/">${esc(b.title)}</a></h3>`), `${b.id}: the shared title style, a 44px link`);
    assert.ok(wk.includes(`<p class="stk-note stk-note--caveat"><strong>Worth knowing.</strong> ${esc(b.caveat)}</p>`), b.id);
  }
  for (const b of data.books.filter((x) => x.caveat && fiction.has(x.shelf))) assert.ok(!wk.includes(esc(b.caveat)), `${b.id}: an edition note of a fiction shelf is not a dispute`);
  assert.equal((wk.match(/class="stk-note stk-note--caveat"/g) || []).length, disputed.length);
  // Content notes: every shelf.
  const cn = byId.get('content-notes').html;
  const noted = data.books.filter((b) => b.contentNote);
  for (const b of noted) assert.ok(cn.includes(`<p class="stk-note"><strong>Content note.</strong> ${esc(b.contentNote)}</p>`), b.id);
  assert.equal((cn.match(/class="stk-note"/g) || []).length, noted.length);
  for (const g of S.GUIDES) {
    const h = byId.get(g.id).html;
    assert.ok(g.title.length <= S.INTRO_TITLE_MAX && g.description.length <= S.DESC_MAX, g.id);
    assert.ok(!/name="robots" content="noindex/.test(h), `${g.id} is indexed`);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
    assert.ok(h.includes(`<li><span aria-current="page">${esc(g.h1)}</span></li>`), 'the last crumb is the heading, as on every /stacks/ page');
    assert.ok(g.title.startsWith(g.h1), 'one name in the title and the heading');
    assert.ok(h.includes(`<link rel="canonical" href="https://thegatecast.com/stacks/${g.id}/">`));
    assert.ok(!/<script(?![^>]*application\/ld\+json)[^>]*src=/.test(h), 'no script file');
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => JSON.parse(x[1]));
    assert.ok(lds.some((x) => x['@type'] === 'CollectionPage' && x.mainEntity.numberOfItems > 0));
    assert.ok(S.stacksSitemapEntries(data).some((e) => e.loc === S.pageUrl(g.id) && /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)));
    assert.ok(byId.get(null).html.includes(`<a href="/stacks/${g.id}/">${g.name}</a>`), 'linked from the index');
  }
  // A shelf or a book may not take a guide's id.
  assert.throws(() => S.renderStacks({ ...raw, books: [...raw.books, { ...raw.books[0], id: 'content-notes' }] }, m), /content-notes/);
});
