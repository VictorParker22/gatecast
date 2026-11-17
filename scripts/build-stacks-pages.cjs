// The Stacks as plain pages: one static HTML page per book (/stacks/<book-id>/), per shelf (/stacks/<shelf-id>/)
// and an index (/stacks/), written into public/ by the build step (scripts/build-data.cjs) and rendered on request
// by server.js locally. Everything on them comes from data/books.json (and, at build time, the books authors and
// publishers put forward that the editor approved; see buildData): our descriptions, the "Worth knowing" caveats
// and content notes, which until now only the 3D library (library.html) showed, through JavaScript, and Gatecast's
// take on a book where it has one. Each shelf page also has an introduction, its own <title> and meta description
// from data/shelf-intros.json (see INTRO_* below). The pages need
// no script at all (the only inline scripts are the colour-scheme line every page has and JSON-LD), load nothing
// from three.js, cannon or gsap, and embed nothing: a cover is the only third-party file (Open Library, hotlinked,
// lazy, no referrer, never for the NO_COVER books), and an approved preview video or scan is a plain link out.
// Indexing: the index and shelf pages are indexed and in sitemap.xml; a book page only once the book has a `take`
// of TAKE_MIN_WORDS words or more (see below), otherwise it carries noindex, follow.
// The links (WorldCat, Bookshop.org, Open Library) come from the same builders as the library (js/librarymodel.js),
// and the stand-in cover uses the library's binding colours (js/stacks3d/model.js bookLook).
// Styles: utilities (scanned by styles/main.css through @source) and styles/components/stacks-pages.css (bundled
// into site-library.css by styles/main-library.css). Fixed wording lives in UI_TEXT so the tests can prove that
// every other word on a page comes from books.json or shelf-intros.json.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The site's address, in one place: canonicals, Open Graph, JSON-LD and sitemap.xml (build-data.cjs) all read it.
const SITE_ORIGIN = 'https://gatecast.vercel.app';
const OG_IMAGE = SITE_ORIGIN + '/vendor/og/gatecast-og.png';
const OG_ALT = 'Gatecast: weird news from real outlets, the weather on top, and a library of strange true stories.';
const DESC_MAX = 155;
const MORE_ON_SHELF = 6;
// A book page is indexed (and listed in sitemap.xml) only when the book has a `take` in books.json: Gatecast's own
// write-up, approved by the editor and shown as "Gatecast’s take", of at least this many words (at most
// TAKE_MAX_WORDS), with `takeDate`, the day it was written (YYYY-MM-DD). Without one the page is a short
// description, so it is published with noindex, follow (readers and links still reach it; search engines are asked
// not to list it). The index and every stocked shelf page are always indexed.
const TAKE_MIN_WORDS = 150;
const TAKE_MAX_WORDS = 300;
// Shelf introductions (data/shelf-intros.json, keyed by shelf id): { title, description, updated, intro: [paragraphs] }.
// The title replaces the shelf page's <title> (at most INTRO_TITLE_MAX characters), the description its meta
// description (at most DESC_MAX), and the intro, INTRO_MIN_WORDS to INTRO_MAX_WORDS words, sits under the shelf's
// note. A shelf with no entry keeps the plain title and its note as the description.
const INTRO_TITLE_MAX = 60;
const INTRO_MIN_WORDS = 120;
const INTRO_MAX_WORDS = 250;

const root = path.join(__dirname, '..');
const DATA_FILE = path.join(root, 'data', 'books.json');
const INTROS_FILE = path.join(root, 'data', 'shelf-intros.json');

// The library's own logic is an ES module; load it once (dynamic import works from CommonJS on every Node >= 20).
async function loadModel() {
  const lib = await import(pathToFileURL(path.join(root, 'js', 'librarymodel.js')).href);
  const s3d = await import(pathToFileURL(path.join(root, 'js', 'stacks3d', 'model.js')).href);
  return { ...lib, bookLook: s3d.bookLook };
}
const readData = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
// The shelf introductions: data.intros when given (renderStacks reads the file once), otherwise the file, read fresh.
const readIntros = () => JSON.parse(fs.readFileSync(INTROS_FILE, 'utf8'));
const introsOf = (data) => (data && data.intros) || readIntros();
const introFor = (shelf, data) => {
  const e = introsOf(data).shelves?.[shelf.id];
  return e && typeof e === 'object' ? e : null;
};
// Only shelves that have books get pages (a shelf added before its books are merged stays out, as in the library).
const stocked = (data) => {
  const has = new Set(data.books.map((b) => b.shelf));
  return data.shelves.every((sh) => has.has(sh.id)) ? data : { ...data, shelves: data.shelves.filter((sh) => has.has(sh.id)) };
};

// The build's data: books.json plus the approved books from the database (lib/stacks-db.js:
// loadStacksExtras({ url, key, fetchImpl, timeoutMs }) -> { books, featured }, never throws; mergeBooks(static,
// extras)). Each extra book must pass the library's own validate() on its own and not reuse an id, or it is left out
// with a warning; a missing module, no network or no key means the static books only. GATECAST_STACKS_DB=off skips
// the database. No Book of the Week here: it would go stale between deploys.
async function buildData({ data = readData(), m = null, env = process.env, load = null } = {}) {
  if (env.GATECAST_STACKS_DB === 'off') return data;
  let extras = null, db = null;
  try {
    db = load || require('../lib/stacks-db.js');
    extras = await db.loadStacksExtras({
      url: env.SUPABASE_URL || 'https://hfdwmzuedjcsaxgzhzmu.supabase.co',
      key: env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_a2KiR862D8VC63YjqFIYSQ_U5YnwpMJ',
      timeoutMs: 8000,
    });
  } catch (err) {
    console.warn('stacks pages: approved books not loaded (' + String((err && err.message) || err).split('\n')[0] + '); static books only');
    return data;
  }
  const extra = Array.isArray(extras && extras.books) ? extras.books : [];
  if (!extra.length) return data;
  m ||= await loadModel();
  const ids = new Set([...data.books.map((b) => b.id), ...data.shelves.map((sh) => sh.id)]);
  const ok = [];
  for (const b of extra) {
    const errs = b && typeof b === 'object' && typeof b.id === 'string' && !ids.has(b.id) ? m.validate({ ...data, books: [b] }) : ['missing or clashing id'];
    if (errs.length) { console.warn(`stacks pages: left out approved book ${b && b.id}: ${errs.join('; ')}`); continue; }
    ids.add(b.id); ok.push(b);
  }
  if (!ok.length) return data;
  let merged = null;
  try { if (typeof db.mergeBooks === 'function') merged = db.mergeBooks(data, { books: ok, featured: null }); } catch {}
  return merged && Array.isArray(merged.books) && Array.isArray(merged.shelves) ? merged : { ...data, books: [...data.books, ...ok] };
}

/* ---------- Small pure helpers ---------- */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pagePath = (id) => (id ? `/stacks/${id}/` : '/stacks/');
const pageUrl = (id) => SITE_ORIGIN + pagePath(id);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The description's first sentence (the same split data validation uses: validate() in librarymodel.js).
function firstSentence(text) {
  return String(text || '').split(/(?<=[a-z0-9)”’][.?!])\s+(?=[A-Z“])/)[0].trim();
}

// At most `max` characters, cut at a word, with an ellipsis when cut.
function metaDescription(text, max = DESC_MAX) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max); // max - 1 characters of text, plus the ellipsis
  const at = cut.lastIndexOf(' ', max - 1);
  return cut.slice(0, at > 0 ? at : max - 1).replace(/[\s,;:—–-]+$/, '') + '…';
}

// The newest real date behind a book's page: when the list was checked, and any per-book date the data carries.
function bookLastmod(book, data) {
  const dates = [data.checked, book.checked, book.cover && book.cover.checked, book.preview && book.preview.checked, book.take && book.takeDate].filter((d) => DATE.test(d || ''));
  return dates.sort().pop() || null;
}
const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}]+(?:[’'.-][\p{L}\p{N}]+)*/gu) || []).length;
const takeParagraphs = (book) => (typeof book.take === 'string' ? book.take.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean) : []);
const indexable = (book) => typeof book.take === 'string' && wordCount(book.take) >= TAKE_MIN_WORDS;
const newest = (dates) => dates.filter(Boolean).sort().pop() || null;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-11-17" -> "17 November 2026" (a calendar day: no time zone involved).
const longDate = (d) => (DATE.test(d || '') ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : null);

// What the build refuses (writeStacksPages): a take or a shelf introduction outside its limits, or a take with no
// date. A shelf with no introduction is allowed (it keeps the plain page). Returns a list of problems.
function contentErrors(data) {
  const errors = [];
  for (const b of data.books || []) {
    if (b.take === undefined) continue;
    const w = wordCount(b.take);
    if (typeof b.take !== 'string' || w < 1) errors.push(`${b.id}: take must be text`);
    else if (w > TAKE_MAX_WORDS) errors.push(`${b.id}: take is ${w} words (at most ${TAKE_MAX_WORDS})`);
    if (!DATE.test(b.takeDate || '')) errors.push(`${b.id}: takeDate must be a date (YYYY-MM-DD)`);
  }
  for (const [id, e] of Object.entries(introsOf(data).shelves || {})) {
    if (!(data.shelves || []).some((s) => s.id === id)) { errors.push(`shelf-intros: ${id} is not a shelf`); continue; }
    if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > INTRO_TITLE_MAX) errors.push(`shelf-intros ${id}: title must be 1 to ${INTRO_TITLE_MAX} characters`);
    if (typeof e.description !== 'string' || !e.description.trim() || e.description.length > DESC_MAX) errors.push(`shelf-intros ${id}: description must be 1 to ${DESC_MAX} characters`);
    if (!DATE.test(e.updated || '')) errors.push(`shelf-intros ${id}: updated must be a date`);
    const paras = Array.isArray(e.intro) && e.intro.length && e.intro.every((p) => typeof p === 'string' && p.trim()) ? e.intro : null;
    const w = paras ? wordCount(paras.join(' ')) : 0;
    if (w < INTRO_MIN_WORDS || w > INTRO_MAX_WORDS) errors.push(`shelf-intros ${id}: intro must be ${INTRO_MIN_WORDS} to ${INTRO_MAX_WORDS} words in paragraphs (${w})`);
  }
  return errors;
}

// Sitemap entries for /stacks/, each shelf and each indexable book (see TAKE_MIN_WORDS), dated from the data (not
// the build day). A shelf's date is its newest book's, listed or not, since the shelf page shows every book, or its
// introduction's `updated` when that is newer.
function stacksSitemapEntries(all = readData()) {
  const data = stocked(all);
  const byShelf = (id) => data.books.filter((b) => b.shelf === id);
  const books = data.books.filter(indexable).map((b) => ({ loc: pageUrl(b.id), lastmod: bookLastmod(b, data) }));
  const introDate = (s) => { const e = introFor(s, data); return e && DATE.test(e.updated || '') ? e.updated : null; };
  const shelves = data.shelves.map((s) => ({ loc: pageUrl(s.id), lastmod: newest([data.checked, introDate(s), ...byShelf(s.id).map((b) => bookLastmod(b, data))]) }));
  const index = { loc: pageUrl(null), lastmod: newest([data.checked, ...data.books.map((b) => bookLastmod(b, data))]) };
  return [index, ...shelves, ...books];
}

// Siblings for "More on this shelf": the books after this one in the editor's shelf order, wrapping round.
function siblings(book, data, n = MORE_ON_SHELF) {
  const shelf = data.books.filter((b) => b.shelf === book.shelf);
  const i = shelf.findIndex((b) => b.id === book.id);
  return [...shelf.slice(i + 1), ...shelf.slice(0, i)].slice(0, n);
}

/* ---------- Fixed wording ---------- */

// Every fixed phrase the templates write. Anything else on a page is from data/books.json (tested).
const UI_TEXT = [
  'Skip to content', 'Gatecast home', 'Gatecast', 'Main', 'Shelves', 'Front page', 'Library', 'Trips', 'Flights', 'Breadcrumb',
  'The Stacks', 'books', 'by', 'First published', 'Shelf', 'Topics', 'Worth knowing.', 'Content note.',
  'Open it in The Stacks', 'Find at your library', 'Buy at Bookshop.org', 'Open Library record',
  'Library search by WorldCat. The Bookshop.org link is a plain search.',
  'Cover of', 'Cover: Open Library', 'Cover art not available. This is our stand-in.',
  'Gatecast’s take', 'Written', ...MONTHS, 'More on this shelf', 'All shelves', 'Watch', 'Look inside', 'Watch on YouTube', 'Watch on C-SPAN', 'Watch on PBS', 'Watch on Criterion', 'Opens on',
  'Scanned pages at the Internet Archive', 'A preview at Google Books', 'Look inside at the Internet Archive', 'Look inside at Google Books',
  'Nothing from it loads on this page.',
  'book on this shelf', 'books on this shelf', ', first published in', ', first published between', 'and',
  'Open this shelf in The Stacks', 'The books', 'Other shelves',
  'All shelves and books', 'Every shelf and book in The Stacks, as a plain list.',
  'Real books on true crime, unsolved mysteries, weird history, strange science, cults and cons, beside classic fantasy and science fiction, picked by our editor and described in our own words.',
  'Open the 3D library', 'Every shelf and book in The Stacks: real books on true crime, unsolved mysteries, weird history, strange science, cults and cons, and classic fantasy and science fiction, described in our own words.',
  'Titles, authors and dates are checked by our editor. Descriptions are written by us. Covers and records:', 'Open Library', 'How the books are chosen', 'How Gatecast works',
  'Suggested by the author', 'Suggested by the publisher',
  'Where a book has a cover, your browser loads it from Open Library. Links to WorldCat, Bookshop.org, Open Library, YouTube, C-SPAN, PBS, Criterion, Google Books and the Internet Archive go to those sites; nothing from them loads here until you follow one.',
];

/* ---------- Page shell ---------- */

const NAV = [
  ['/', 'Front page', '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4"/>'],
  ['/library.html', 'Library', '<path d="M4 20V5h4v15M10 20V3h4v17M16 20l2.5-14 3.5.7L19.5 20M3 20h19"/>'],
  ['/trip.html', 'Trips', '<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M9 7V4h6v3M3 12h18"/>'],
  ['/flights.html', 'Flights', '<path d="M2.5 13.5l19-7-4 13-5-4.5-3 3.5v-5l12-7"/>'],
];

// JSON for a <script type="application/ld+json">: "<" escaped so no string can close the element.
const ldJson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function shell({ title, description, id, ogType = 'website', ld = [], body, noindex = false }) {
  const url = pageUrl(id);
  const nav = NAV.map(([href, label, icon]) => `<li><a href="${href}"${label === 'Library' ? ' aria-current="true"' : ''}><svg class="site-nav__icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></a></li>`).join('\n        ');
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <script>
    try { document.querySelector('meta[name="color-scheme"]').content = localStorage.getItem("color-scheme") ?? "light dark"; } catch (e) {}
  </script>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">${noindex ? '\n  <meta name="robots" content="noindex, follow">' : ''}
  <link rel="canonical" href="${url}">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ecebe6">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#07090d">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="Gatecast">
  <meta property="og:locale" content="en_GB">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(OG_ALT)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${OG_IMAGE}">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/vendor/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/vendor/fonts/alfa-slab-one-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles/site.css">
  <link rel="stylesheet" href="/styles/site-library.css">
  ${ld.map(ldJson).join('\n  ')}
</head>
<body class="stk-page">
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <a class="brand" href="/" aria-label="Gatecast home">
      <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"/><g transform="translate(4 5)"><path d="M5 20V9a7 7 0 0 1 14 0v11"/><path d="M12 13v7"/></g></svg>
      <span class="brand__name">Gatecast</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <ul>
        ${nav}
      </ul>
    </nav>
  </header>

  <main id="main" class="frame grid gap-10 pt-4 pb-12">
${body}
  </main>

  <footer class="site-footer">
    <p>Titles, authors and dates are checked by our editor. Descriptions are written by us. Covers and records: <a href="https://openlibrary.org/" rel="noopener">Open Library</a>. <a href="/how.html#books">How the books are chosen</a>. <a href="/how.html">How Gatecast works</a>.</p>
    <p>Where a book has a cover, your browser loads it from Open Library. Links to WorldCat, Bookshop.org, Open Library, YouTube, C-SPAN, PBS, Criterion, Google Books and the Internet Archive go to those sites; nothing from them loads here until you follow one.</p>
  </footer>
</body>
</html>
`;
}

// Gatecast › The Stacks › [Shelf ›] [Book], as links (the current page last, unlinked) and as JSON-LD.
function crumbs(trail) {
  const items = [{ name: 'Gatecast', path: '/' }, { name: 'The Stacks', path: '/stacks/' }, ...trail];
  const html = `    <nav class="stk-crumbs" aria-label="Breadcrumb">
      <ol>
        ${items.map((c, i) => (i === items.length - 1 ? `<li><span aria-current="page">${esc(c.name)}</span></li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`)).join('\n        ')}
      </ol>
    </nav>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_ORIGIN + c.path })),
  };
  return { html, ld };
}

/* ---------- The book page ---------- */

// The cover: the baked Open Library cover when there is one and the book is not on NO_COVER; otherwise the
// library's cloth stand-in, in the book's binding colours.
function coverHtml(book, shelf, m) {
  const cover = m.coverFor(book); // no API covers here: only covers a person checked (baked into the data)
  const src = cover && cover.baked ? m.coverUrl(cover, 'L') : null;
  if (src) {
    return `<figure class="stk-cover">
          <div class="stk-cover__frame"><img src="${src}" alt="Cover of ${esc(book.title)}" width="320" height="470" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>
          <figcaption class="stk-cover__credit">Cover: Open Library</figcaption>
        </figure>`;
  }
  const st = m.spineStyle(book);
  const look = m.bookLook(book);
  const len = book.title.length;
  // The library's title sizes (54/42/34px, 6px less in slab, on a cover up to 380px wide) as a share of the cover's
  // width, so the stand-in scales with it (.stk-cover__frame is a size container).
  const cqi = Math.round((((len > 30 ? 34 : len > 16 ? 42 : 54) - (st.kind === 'slab' ? 6 : 0)) / 380) * 1000) / 10;
  const vars = `--cloth:${look.binding.base};--foil:${look.binding.foil};--font:${st.font.replace(/"/g, "'")};--fw:${st.weight};--case:${st.upper ? 'uppercase' : 'none'};--cfs:${cqi}cqi`;
  return `<figure class="stk-cover">
          <div class="stk-cover__frame">
            <div class="lib-standin" style="${esc(vars)}">
              <span class="lib-standin__shelf">${esc(shelf.name)}</span>
              <span class="lib-standin__title">${esc(book.title)}</span>
              <span class="lib-standin__rule" aria-hidden="true"></span>
              <span class="lib-standin__author">${esc(m.authorLine(book.authors))}</span>
              <span class="lib-standin__note">Cover art not available. This is our stand-in.</span>
            </div>
          </div>
        </figure>`;
}

// An approved preview (previewFor in librarymodel.js validates it), as plain links out: no embeds, no posters.
function previewHtml(book, m) {
  const p = m.previewFor(book);
  if (!p) return '';
  const cards = [];
  if (p.watch) {
    const w = p.watch;
    const yt = w.kind === 'youtube';
    const href = yt ? m.PREVIEW_URLS.ytWatch(w.id) : w.url;
    cards.push(`<li><a class="stk-link stk-link--watch" href="${esc(href)}" rel="noopener">
            <span class="stk-link__kicker">${esc(w.label)}${w.duration ? ` · ${esc(w.duration)}` : ''}</span>
            <span class="stk-link__title">${esc(w.title)}</span>
            <span class="stk-link__meta">${esc(w.channel)}</span>
            <span class="stk-link__go">${yt ? 'Watch on YouTube' : `Watch on ${esc(m.WATCH_SITES[w.kind].name)}`}</span>
          </a></li>`);
  }
  if (p.look) {
    const l = p.look;
    const archive = l.kind === 'archive';
    const href = archive ? `https://archive.org/details/${encodeURIComponent(l.identifier)}` : `https://books.google.com/books?id=${encodeURIComponent(l.volumeId)}`;
    cards.push(`<li><a class="stk-link" href="${esc(href)}" rel="noopener">
            <span class="stk-link__kicker">Look inside</span>
            <span class="stk-link__title">${archive ? 'Scanned pages at the Internet Archive' : 'A preview at Google Books'}</span>
            <span class="stk-link__go">${archive ? 'Look inside at the Internet Archive' : 'Look inside at Google Books'}</span>
          </a></li>`);
  }
  return `
    <section class="stk-section" aria-labelledby="preview-title">
      <h2 id="preview-title" class="stk-section__title">${p.watch ? 'Watch' : 'Look inside'}</h2>
      <ul class="stk-links">
          ${cards.join('\n          ')}
      </ul>
      <p class="stk-small">Nothing from it loads on this page.</p>
    </section>`;
}

function bookItem(b, m, { line = false } = {}) {
  return `<li class="stk-item">
          <a class="stk-item__link" href="${pagePath(b.id)}">
            <span class="stk-item__title">${esc(b.title)}</span>
            <span class="stk-item__meta">${esc(m.authorLine(b.authors))} · ${b.year}</span>${line ? `
            <span class="stk-item__line">${esc(firstSentence(b.description))}</span>` : ''}
          </a>
        </li>`;
}

function bookJsonLd(book, shelf, m) {
  const cover = m.coverFor(book);
  const image = cover && cover.baked ? m.coverUrl(cover, 'L') : null;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Book',
    name: book.title,
    author: book.authors.map((name) => ({ '@type': 'Person', name })),
    datePublished: String(book.year),
    inLanguage: 'en',
    description: book.description,
    genre: shelf.name,
    about: { '@type': 'Thing', name: shelf.name },
    keywords: book.tags.join(', '),
    url: pageUrl(book.id),
  };
  if (book.isbn13) ld.isbn = book.isbn13;
  if (image) ld.image = image;
  return ld;
}

function bookPage(book, data, m) {
  const shelf = data.shelves.find((s) => s.id === book.shelf);
  const by = m.authorLine(book.authors);
  const trail = crumbs([{ name: shelf.name, path: pagePath(shelf.id) }, { name: book.title, path: pagePath(book.id) }]);
  const notes = [
    book.contentNote && `<p class="stk-note"><strong>Content note.</strong> ${esc(book.contentNote)}</p>`,
    book.caveat && `<p class="stk-note stk-note--caveat"><strong>Worth knowing.</strong> ${esc(book.caveat)}</p>`,
  ].filter(Boolean);
  const more = siblings(book, data);
  const take = takeParagraphs(book);
  const body = `${trail.html}

    <article class="stk-book" aria-labelledby="book-title">
        ${coverHtml(book, shelf, m)}
      <div class="stk-book__body">
        <p class="stk-kicker"><a href="${pagePath(shelf.id)}">${esc(shelf.name)}</a></p>
        <h1 id="book-title" class="stk-title">${esc(book.title)}</h1>
        <p class="stk-byline">by ${esc(by)}</p>${m.originNote && m.originNote(book) ? `
        <p class="stk-origin">${esc(m.originNote(book))}</p>` : ''}
        <dl class="stk-facts">
          <div><dt>First published</dt><dd>${book.year}</dd></div>
          <div><dt>Shelf</dt><dd><a href="${pagePath(shelf.id)}">${esc(shelf.name)}</a></dd></div>
        </dl>
        <p class="stk-desc">${esc(book.description)}</p>
        ${notes.join('\n        ')}${take.length ? `
        <section class="stk-take" aria-labelledby="take-title">
          <h2 id="take-title" class="stk-take__title">Gatecast’s take</h2>
          ${take.map((p) => `<p>${esc(p)}</p>`).join('\n          ')}${longDate(book.takeDate) ? `
          <p class="stk-small text-np-muted">Written <time datetime="${book.takeDate}">${longDate(book.takeDate)}</time></p>` : ''}
        </section>` : ''}
        <ul class="stk-tags" aria-label="Topics">
          ${book.tags.map((t) => `<li>${esc(t)}</li>`).join('')}
        </ul>
        <div class="stk-actions">
          <a class="btn btn--primary" href="/library.html#book=${encodeURIComponent(book.id)}">Open it in The Stacks</a>
          <a class="btn" href="${esc(m.worldcatUrl(book))}" rel="noopener">Find at your library</a>
          <a class="btn" href="${esc(m.bookshopUrl(book, null))}" rel="noopener">Buy at Bookshop.org</a>
          <a class="btn" href="${esc(m.openLibraryUrl(book, m.coverFor(book)))}" rel="noopener">Open Library record</a>
        </div>
        <p class="stk-small">Library search by WorldCat. The Bookshop.org link is a plain search.</p>
      </div>
    </article>
${previewHtml(book, m)}
    <section class="stk-section" aria-labelledby="more-title">
      <h2 id="more-title" class="stk-section__title">More on this shelf</h2>
      <ul class="stk-list">
        ${more.map((b) => bookItem(b, m)).join('\n        ')}
      </ul>
      <p><a class="stk-more" href="${pagePath(shelf.id)}">${esc(shelf.name)}</a> · <a class="stk-more" href="/stacks/">All shelves</a></p>
    </section>`;
  return shell({
    title: `${book.title} by ${by} — The Stacks · Gatecast`,
    description: metaDescription(book.description),
    id: book.id, ogType: 'book',
    ld: [bookJsonLd(book, shelf, m), trail.ld],
    body, noindex: !indexable(book),
  });
}

/* ---------- The shelf page ---------- */

// "10 books on this shelf, first published between 1966 and 2019." Only counts and years from the data.
function shelfIntro(books) {
  if (!books.length) return '';
  const years = books.map((b) => b.year);
  const lo = Math.min(...years), hi = Math.max(...years);
  const n = `${books.length} ${books.length === 1 ? 'book on this shelf' : 'books on this shelf'}`;
  return lo === hi ? `${n}, first published in ${lo}.` : `${n}, first published between ${lo} and ${hi}.`;
}

function shelfPage(shelf, data, m) {
  const books = data.books.filter((b) => b.shelf === shelf.id);
  const intro = introFor(shelf, data);
  const paras = intro && Array.isArray(intro.intro) ? intro.intro.map((p) => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const description = intro && intro.description ? intro.description : metaDescription(shelf.note);
  const trail = crumbs([{ name: shelf.name, path: pagePath(shelf.id) }]);
  const others = data.shelves.filter((s) => s.id !== shelf.id);
  const body = `${trail.html}

    <section class="stk-head" aria-labelledby="shelf-title">
      <p class="stk-kicker">The Stacks</p>
      <h1 id="shelf-title" class="stk-title">${esc(shelf.name)}</h1>
      <p class="stk-lede">${esc(shelf.note)}</p>${paras.length ? `
      <div class="stk-intro grid gap-3">
        ${paras.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
      </div>` : ''}
      <p class="stk-intro text-sm text-np-muted">${esc(shelfIntro(books))}</p>
      <div class="stk-actions"><a class="btn btn--primary" href="/library.html#shelf=${encodeURIComponent(shelf.id)}">Open this shelf in The Stacks</a></div>
    </section>

    <section class="stk-section" aria-labelledby="books-title">
      <h2 id="books-title" class="stk-section__title">The books</h2>
      <ul class="stk-list stk-list--wide">
        ${books.map((b) => bookItem(b, m, { line: true })).join('\n        ')}
      </ul>
    </section>

    <nav class="stk-section" aria-labelledby="others-title">
      <h2 id="others-title" class="stk-section__title">Other shelves</h2>
      <ul class="stk-shelves">
        ${others.map((s) => `<li><a href="${pagePath(s.id)}">${esc(s.name)}</a></li>`).join('\n        ')}
        <li><a href="/stacks/">All shelves</a></li>
      </ul>
    </nav>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `${shelf.name} — The Stacks`, description, url: pageUrl(shelf.id), inLanguage: 'en-GB',
    isPartOf: { '@type': 'WebSite', name: 'Gatecast', url: SITE_ORIGIN + '/' },
    mainEntity: {
      '@type': 'ItemList', numberOfItems: books.length,
      itemListElement: books.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: pageUrl(b.id), name: b.title })),
    },
  };
  const title = intro && intro.title ? intro.title : `${shelf.name} books — The Stacks · Gatecast`;
  return shell({ title, description, id: shelf.id, ld: [ld, trail.ld], body });
}

/* ---------- The index ---------- */

function indexPage(data, m) {
  const trail = crumbs([]); // Gatecast › The Stacks
  const shelves = data.shelves.map((s) => {
    const books = data.books.filter((b) => b.shelf === s.id);
    return `    <section class="stk-section" aria-labelledby="shelf-${s.id}">
      <h2 id="shelf-${s.id}" class="stk-section__title"><a href="${pagePath(s.id)}">${esc(s.name)}</a></h2>
      <p class="stk-note-line">${esc(s.note)}</p>
      <ul class="stk-list">
        ${books.map((b) => bookItem(b, m)).join('\n        ')}
      </ul>
    </section>`;
  }).join('\n\n');
  const body = `${trail.html}

    <section class="stk-head" aria-labelledby="stacks-title">
      <p class="stk-kicker">All shelves and books</p>
      <h1 id="stacks-title" class="stk-title">The Stacks</h1>
      <p class="stk-lede">Real books on true crime, unsolved mysteries, weird history, strange science, cults and cons, beside classic fantasy and science fiction, picked by our editor and described in our own words.</p>
      <p class="stk-intro">Every shelf and book in The Stacks, as a plain list.</p>
      <div class="stk-actions"><a class="btn btn--primary" href="/library.html">Open the 3D library</a></div>
      <ul class="stk-shelves" aria-label="Shelves">
        ${data.shelves.map((s) => `<li><a href="${pagePath(s.id)}">${esc(s.name)}</a></li>`).join('\n        ')}
      </ul>
    </section>

${shelves}`;
  const description = 'Every shelf and book in The Stacks: real books on true crime, unsolved mysteries, weird history, strange science, cults and cons, and classic fantasy and science fiction, described in our own words.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'The Stacks', description, url: pageUrl(null), inLanguage: 'en-GB',
    isPartOf: { '@type': 'WebSite', name: 'Gatecast', url: SITE_ORIGIN + '/' },
    mainEntity: {
      '@type': 'ItemList', numberOfItems: data.shelves.length,
      itemListElement: data.shelves.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: pageUrl(s.id), name: s.name })),
    },
  };
  return shell({ title: 'All shelves and books — The Stacks · Gatecast', description: metaDescription(description), id: null, ld: [ld, trail.ld], body });
}

/* ---------- For library.html ---------- */

// The <noscript> list for library.html's #lib-bays: every shelf and book, linked to its plain page. Printed by
// `node scripts/build-stacks-pages.cjs --noscript` to paste into the page (library.html is hand-written).
function noscriptHtml(all, m) {
  const data = stocked(all);
  const shelves = data.shelves.map((s) => `          <li><a href="/stacks/${s.id}/">${esc(s.name)}</a>
            <ul>
${data.books.filter((b) => b.shelf === s.id).map((b) => `              <li><a href="/stacks/${b.id}/">${esc(b.title)}</a>, ${esc(m.authorLine(b.authors))} (${b.year})</li>`).join('\n')}
            </ul>
          </li>`).join('\n');
  return `<noscript>
        <div class="lib-msg lib-msg--list">
          <p>The 3D shelves need JavaScript. Every book is also on a plain page: <a href="/stacks/">browse the shelves as a list</a>.</p>
          <ul>
${shelves}
          </ul>
        </div>
      </noscript>`;
}

/* ---------- Everything ---------- */

// Every page as { id, path, file, html }: the index, the shelves, the books. Throws if an id would collide.
function renderStacks(given, m) {
  const all = given.intros ? given : { ...given, intros: readIntros() }; // read once for every page
  const data = stocked(all);
  const ids = [...all.shelves.map((s) => s.id), ...all.books.map((b) => b.id)]; // every shelf, with books or not
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`stacks pages: "${dup}" is used by more than one shelf or book`);
  const page = (id, html) => ({ id, path: pagePath(id), file: id ? path.join('stacks', id, 'index.html') : path.join('stacks', 'index.html'), html });
  return [
    page(null, indexPage(data, m)),
    ...data.shelves.map((s) => page(s.id, shelfPage(s, data, m))),
    ...data.books.map((b) => page(b.id, bookPage(b, data, m))),
  ];
}

// The build step: write public/stacks/**. Returns the number of pages written.
async function writeStacksPages(outDir, given) {
  const m = await loadModel();
  const data = given || await buildData({ m });
  const errors = [...m.validate(data), ...contentErrors(data)];
  if (errors.length) throw new Error('data/books.json or data/shelf-intros.json does not validate:\n' + errors.join('\n'));
  const pages = renderStacks(data, m);
  for (const p of pages) {
    const file = path.join(outDir, p.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, p.html);
  }
  return pages.length;
}

// server.js (local): the page for a /stacks/ path that ends in a slash (or index.html), or null. Reads the data
// fresh each time, so an edit to books.json shows on reload, like the sitemap.
let modelPromise = null;
async function pageFor(urlPath) {
  const mm = /^\/stacks\/(?:([a-z0-9]+(?:-[a-z0-9]+)*)\/)?(?:index\.html)?$/.exec(urlPath);
  if (!mm) return null;
  modelPromise ||= loadModel();
  const m = await modelPromise;
  const data = stocked(readData()); // locally the static books only (no database call per request)
  const id = mm[1] || null;
  if (!id) return indexPage(data, m);
  const shelf = data.shelves.find((s) => s.id === id);
  if (shelf) return shelfPage(shelf, data, m);
  const book = data.books.find((b) => b.id === id);
  return book ? bookPage(book, data, m) : null;
}

module.exports = {
  SITE_ORIGIN, OG_IMAGE, OG_ALT, DESC_MAX, MORE_ON_SHELF, TAKE_MIN_WORDS, TAKE_MAX_WORDS, INTRO_TITLE_MAX, INTRO_MIN_WORDS, INTRO_MAX_WORDS,
  UI_TEXT, MONTHS, wordCount, takeParagraphs, indexable, longDate, contentErrors, readIntros, introFor,
  loadModel, readData, buildData, stocked, esc, pagePath, pageUrl, firstSentence, metaDescription, bookLastmod, stacksSitemapEntries, siblings, shelfIntro,
  bookPage, shelfPage, indexPage, renderStacks, writeStacksPages, pageFor, noscriptHtml,
};

if (require.main === module && process.argv.includes('--noscript')) loadModel().then((m) => console.log(noscriptHtml(readData(), m)));
