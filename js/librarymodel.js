// The Stacks (library.html): pure logic, no DOM. Search and filtering, shelf rows, the look of each spine
// (derived from the book id, so a book keeps its spine when others are added or reordered), the book's
// size when pulled out, the URL hash, the library card and every outbound link.

// Bookshop.org affiliate ID. null = plain search links and no disclosure. When the owner joins the
// programme, set it here (one place); the links then carry it and the page shows the disclosure line.
export const BOOKSHOP_AFFILIATE = null;
export const BOOKSHOP_DISCLOSURE = 'Bookshop.org links are affiliate links: if you buy through one we earn a small commission, and so do independent bookshops. It never decides what goes on a shelf.';

/* ---------- Text ---------- */

// Lower case, accents and punctuation removed, so "Fordlândia" matches "fordlandia" and "I’ll" matches "ill".
export function fold(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export const surname = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter((p) => !/^(jr|sr|ii|iii)\.?$/i.test(p));
  return parts[parts.length - 1] || '';
};

// "A", "A and B", "A, B and C".
export function authorLine(authors = []) {
  if (authors.length <= 1) return authors[0] || '';
  return authors.slice(0, -1).join(', ') + ' and ' + authors[authors.length - 1];
}

/* ---------- Search and filtering ---------- */

export function haystack(book, shelfName = '') {
  return fold([book.title, ...(book.authors || []), book.year, shelfName, ...(book.tags || []), book.description].join(' '));
}

// Every word of the query must appear somewhere in the title, authors, year, shelf, tags or description.
export function matches(book, query, shelfName = '') {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = haystack(book, shelfName);
  return words.every((w) => hay.includes(w));
}

// Which bays are shown (all, or the one chosen) and which books in them match the query.
export function filterView(data, { shelf = 'all', query = '' } = {}) {
  const shelves = data.shelves.filter((s) => shelf === 'all' || s.id === shelf);
  let shown = 0, matched = 0;
  const bays = shelves.map((s) => {
    const books = data.books.filter((b) => b.shelf === s.id).map((b) => {
      const hit = matches(b, query, s.name);
      shown++; if (hit) matched++;
      return { book: b, hit };
    });
    return { shelf: s, books };
  });
  return { bays, shown, matched, query: String(query || '').trim() };
}

export function statusText({ shown, matched, query, bays }, { motion = true } = {}) {
  const n = bays.length;
  let s = `${shown} ${shown === 1 ? 'book' : 'books'} on ${n} ${n === 1 ? 'shelf' : 'shelves'}`;
  if (query) {
    s = matched
      ? `${matched} ${matched === 1 ? 'book matches' : 'books match'} “${query}”. The rest are dimmed.`
      : `Nothing matches “${query}”. Try an author, a place or a year.`;
  }
  if (!motion) s += ' · Motion is off, so books open as a flat card.';
  return s;
}

export function pickRandom(list, rand = Math.random) {
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/* ---------- Spines ---------- */

// FNV-1a, 32-bit: a stable number from the book id.
export function hashId(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// Cloth colours and the type on them. Every pair passes 4.5:1 (tested). No red, orange or teal:
// those hues mean risk elsewhere on Gatecast.
export const SPINE_PALETTE = [
  ['#15120E', '#E8D27A'], ['#E8D9B0', '#15120E'], ['#23395B', '#F3EEE2'], ['#4C6A3B', '#F3EEE2'],
  ['#D9C9A0', '#2A1D0A'], ['#3D4A55', '#F3EEE2'], ['#6B4E2E', '#F3E6C8'], ['#1B2A44', '#E8D27A'],
  ['#5A2A48', '#F3E6C8'], ['#2E2E2E', '#C8F03C'], ['#6E4F82', '#FFFFFF'], ['#C7B58B', '#15120E'],
  ['#1C36C7', '#FFFFFF'], ['#F0E6CF', '#23395B'], ['#2F3B2A', '#F3E6C8'], ['#FFD23F', '#15120E'],
  ['#4A3B5C', '#E8D27A'], ['#3E5641', '#F3EEE2'],
];
export const SPINE_FONTS = {
  slab: "var(--font-slab, 'Alfa Slab One'), Georgia, serif",
  cond: "var(--font-sign, 'Barlow Condensed'), 'Arial Narrow', sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
};
const GOLD = 'rgba(232,210,122,0.9)';

// The board's spine recipe, seeded from the id instead of the list position. Sizes are whole pixels.
export function spineStyle(book, { minWidth = 0 } = {}) {
  const h0 = hashId(book.id);
  const pick = (salt, n) => (Math.imul(h0 ^ salt, 0x9e3779b1) >>> 0) % n;
  const [bg, fg] = SPINE_PALETTE[pick(0x1, SPINE_PALETTE.length)];
  const len = book.title.length;
  const kind = len > 24 ? 'cond' : ['cond', 'slab', 'serif'][pick(0x2, 3)];
  const height = 206 + pick(0x3, 52);
  const width = Math.max(minWidth, Math.round(30 + Math.min(18, len * 0.5) + pick(0x4, 5)));
  let fontSize = len <= 8 ? 19 : len <= 16 ? 16 : len <= 26 ? 14 : 12;
  if (kind === 'slab') fontSize -= 2;
  const trims = [
    `linear-gradient(180deg, transparent 0 22%, ${GOLD} 22% 30%, transparent 30% 52%, ${GOLD} 52% 60%, transparent 60%)`,
    fg,
    `radial-gradient(${GOLD} 1.4px, transparent 1.8px) 0 0/7px 7px`,
    `linear-gradient(180deg, ${fg} 0 40%, transparent 40% 60%, ${fg} 60% 100%)`,
    'transparent',
  ];
  const t = pick(0x5, trims.length);
  return {
    bg, fg, width, height, kind, fontSize,
    font: SPINE_FONTS[kind], weight: kind === 'slab' ? 400 : 700, upper: kind === 'cond',
    trim: trims[t], foot: t === 1 ? fg : 'rgba(0,0,0,0.25)', trimIndex: t,
  };
}

// Greedy rows: books keep their order and go onto the next shelf board when the next spine would not fit.
// widths: spine widths in px; avail: the inner width of the bay; gap: px between spines.
export function shelfRows(widths, avail, gap = 3) {
  const rows = [];
  let row = [], used = 0;
  widths.forEach((w, i) => {
    const need = row.length ? used + gap + w : w;
    if (row.length && need > avail) { rows.push(row); row = [i]; used = w; } else { row.push(i); used = need; }
  });
  if (row.length) rows.push(row);
  return rows;
}

// As few boards as greedy filling needs, but with the books shared out evenly between them (7 + 3 becomes
// 5 + 5), so no board is left nearly empty. Falls back to greedy when an even split would not fit.
export function balancedRows(widths, avail, gap = 3) {
  const greedy = shelfRows(widths, avail, gap);
  const k = greedy.length, n = widths.length;
  if (k < 2) return greedy;
  const rows = [];
  let i = 0;
  for (let r = 0; r < k; r++) {
    const size = Math.floor(n / k) + (r < n % k ? 1 : 0);
    rows.push(Array.from({ length: size }, (_, j) => i + j));
    i += size;
  }
  const fits = rows.every((row) => row.reduce((t, j) => t + widths[j], 0) + gap * (row.length - 1) <= avail);
  return fits ? rows : greedy;
}

/* ---------- The book, pulled out ---------- */

export const BOOK_ASPECT = 1.47; // height / width, from the board

// Size and place of the book in the middle of the viewport: from min(width, height) less margins, the board's
// 380px cap, aspect ratio kept, everything on whole pixels. `controls` is the height kept free below for buttons.
export function bookBox(vw, vh, { margin = 16, top = 24, controls = 88, max = 380 } = {}) {
  const availW = Math.max(120, vw - 2 * margin);
  const availH = Math.max(160, vh - top - controls);
  let W = Math.floor(Math.min(max, availW, availH / BOOK_ASPECT));
  W -= W % 2; // even, so the spine and page faces sit on whole pixels either side of the centre
  const H = Math.round(W * BOOK_ASPECT);
  const left = Math.round((vw - W) / 2);
  const y = Math.round(top + (availH - H) / 2);
  return { W, H, left, top: y, cx: left + W / 2, cy: y + H / 2 };
}

// Where the box starts: standing on the shelf where the spine was, scaled down to the spine's size.
// depth: how thick the book is at full size, from the spine's width.
export function flightStart(spine, box) {
  const s = spine.height / box.H;
  const depth = Math.round(Math.max(26, Math.min(140, spine.width / s)));
  return { s, depth, dx: spine.left + spine.width / 2 - box.cx, dy: spine.top + spine.height / 2 - box.cy };
}

/* ---------- Hash state ---------- */

export function parseHash(hash, { shelves = [], books = [] } = {}) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const shelf = p.get('shelf');
  const book = p.get('book');
  return {
    shelf: shelves.some((s) => s.id === shelf) ? shelf : 'all',
    book: books.some((b) => b.id === book) ? book : null,
  };
}

export function buildHash({ shelf = 'all', book = null } = {}) {
  const p = new URLSearchParams();
  if (shelf && shelf !== 'all') p.set('shelf', shelf);
  if (book) p.set('book', book);
  const s = p.toString();
  return s ? '#' + s : '';
}

/* ---------- The data: /api/books or data/books.json, shelves, the Book of the Week ---------- */

// The library's data from a reply of /api/books (books.json plus approved author books and `featured`) or
// data/books.json itself, or null when it is not that shape (the page then falls back to the static file).
export function libraryData(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.shelves) || !Array.isArray(body.books)) return null;
  const shelves = body.shelves.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string');
  const ids = new Set(shelves.map((s) => s.id));
  const books = body.books.filter((b) => b && typeof b.id === 'string' && typeof b.title === 'string' && ids.has(b.shelf) && Array.isArray(b.authors));
  if (!shelves.length || !books.length) return null;
  return { ...body, shelves, books, featured: body.featured ?? null };
}

// Only the shelves that have books: a shelf added to books.json before its books are merged stays out of the room,
// the DOM shelves, the chips, search and the /stacks/ pages until it has at least one (decided 17 Nov 2026).
export function stockedShelves(data) {
  const has = new Set((data.books || []).map((b) => b.shelf));
  return { ...data, shelves: (data.shelves || []).filter((s) => has.has(s.id)) };
}

// The DOM shelves' grid: at most this many bays side by side, so the rows come out even (8 shelves: two rows of 4;
// 6: two rows of 3; 7: 4 + 3). The stylesheet still drops to fewer columns on narrow screens.
export function bayColumns(count) {
  const n = Math.max(1, count | 0);
  if (n <= 4) return n;
  return n % 4 === 0 || n % 4 === 3 ? 4 : 3;
}

export const REASON_MAX = 140;
const oneLine = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

// The Book of the Week, ready to show, or null: no pick, or a pick whose book is not on the shelves. The reason is
// the editor's one line (plain text, at most REASON_MAX characters; longer is left out rather than cut).
// `label` is the accessible name of the featured element everywhere: "Book of the week: <title>".
export function featuredView(data) {
  const f = data && data.featured;
  if (!f || typeof f !== 'object' || typeof f.bookId !== 'string') return null;
  const book = (data.books || []).find((b) => b.id === f.bookId);
  const shelf = book && (data.shelves || []).find((s) => s.id === book.shelf);
  if (!book || !shelf) return null;
  const reason = oneLine(f.reason);
  const since = typeof f.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.since) ? f.since : null;
  return {
    book, shelf, since,
    reason: reason && [...reason].length <= REASON_MAX ? reason : '',
    label: `Book of the week: ${book.title}`,
    byline: authorLine(book.authors),
  };
}

// "Suggested by the author" / "Suggested by the publisher" for books an author or publisher put forward (the
// editor approved them and wrote their text); null for every book the editor chose.
export function originNote(book) {
  const o = book && book.origin;
  return o === 'author' ? 'Suggested by the author' : o === 'publisher' ? 'Suggested by the publisher' : null;
}

/* ---------- Library card (kept in this browser only) ---------- */

export function stampCard(card, id, at, max = 5) {
  const list = Array.isArray(card) ? card.filter((c) => c && c.id && c.id !== id) : [];
  return [{ id, at }, ...list].slice(0, max);
}

// "16 NOV", in UTC so a test is stable; the page passes the visitor's local date.
export function stampDate(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone }).format(new Date(ms)).toUpperCase().replace('.', '');
  } catch { return ''; }
}

// The hand-inked marks (Rough.js draws them in js/library.js). A mark's seed comes from what it marks, so the same
// stamp has the same wobble on every visit: a positive 31-bit integer from the book id and the time it was stamped.
export function inkSeed(id, at = 0) {
  let h = 2166136261;
  for (const ch of String(id) + '|' + String(at)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2147483646) + 1;
}
// How far a stamp is turned, in degrees: between -7 and 3, never flat (a real stamp is never square to the card).
export function stampTilt(seed) {
  const t = Math.round((-7 + ((Number(seed) || 1) % 101) / 10) * 10) / 10;
  return Math.abs(t) < 1 ? -4 : t;
}

// The rubber stamp on an empty card turns once: how far through the turn it is (0 to 1) for a time 0 to 1, slow at
// both ends.
export function stampTurn(p) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/* ---------- Links ---------- */

const q = (book) => `${book.title} ${book.authors?.[0] || ''}`.trim();

export const worldcatUrl = (book) => 'https://search.worldcat.org/search?q=' + encodeURIComponent(q(book));

export function bookshopUrl(book, affiliate = BOOKSHOP_AFFILIATE) {
  if (affiliate && book.isbn13) return `https://bookshop.org/a/${encodeURIComponent(affiliate)}/${book.isbn13}`;
  const base = 'https://bookshop.org/search?keywords=' + encodeURIComponent(q(book));
  return affiliate ? base + '&a_aid=' + encodeURIComponent(affiliate) : base;
}

// The cover to show: one baked into data/books.json (checked by a person, no API call) wins; otherwise whatever
// /api/book-covers found for this book, if anything. Same shape either way: { coverId, olKey, year }.
// Books that always show our stand-in (decided 16 Nov 2026, see tests/library.test.mjs): Open Library's match is
// the wrong book or a film tie-in, or the usual cover shows a killer or a cult leader. Not even the cover API may
// give them a picture.
export const NO_COVER = new Set(['the-monster-of-florence', 'the-lost-city-of-z', 'helter-skelter', 'the-stranger-beside-me', 'wicked-beyond-belief',
  'the-executioners-song', 'the-road-to-jonestown', 'the-man-in-the-rockefeller-suit']);

export function coverFor(book, apiCovers = {}) {
  if (book && NO_COVER.has(book.id)) return null;
  const c = book && book.cover;
  if (c && Number.isInteger(c.id) && c.id > 0) return { coverId: c.id, olKey: c.olKey || null, year: c.year ?? null, baked: true };
  const r = apiCovers && book ? apiCovers[book.id] : null;
  return r && typeof r === 'object' ? r : null;
}

// Do any books still need the cover API? (Only those with no baked cover may ask.)
export const needsCoverApi = (books) => books.some((b) => !NO_COVER.has(b.id) && !(b.cover && Number.isInteger(b.cover.id) && b.cover.id > 0));

// A record that was matched (baked into the data, or confirmed by the server: title and author matched) wins; an unverified ID is never linked as if it
// were certain, so until then the link is an Open Library search for the title and author.
export function openLibraryUrl(book, cover) {
  if (cover && typeof cover.olKey === 'string' && /^\/works\/OL\d+W$/.test(cover.olKey)) return 'https://openlibrary.org' + cover.olKey;
  if (book.olVerified && book.olWork) return 'https://openlibrary.org/works/' + book.olWork;
  return 'https://openlibrary.org/search?q=' + encodeURIComponent(book.title) + '&author=' + encodeURIComponent(book.authors?.[0] || '');
}

export function coverUrl(cover, size = 'M') {
  const id = cover && cover.coverId;
  return Number.isInteger(id) && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null;
}

/* ---------- Previews: an official video (Watch) and the publisher's pages (Look inside) ---------- */

// Optional `preview` on a book, filled in only after the owner approves each one:
//   preview.watch = { kind: 'youtube', id, url, title, channel, duration, label }   (embedded after a click)
//                 | { kind: 'cspan' | 'pbs' | 'criterion', url, title, channel, duration, label }   (a link out, no embed)
//   duration is optional (shown when known).
//   preview.look  = { kind: 'googlebooks', volumeId } | { kind: 'archive', identifier }
// Nothing loads from YouTube, Google or the Internet Archive until the reader opens Preview and presses Play or
// opens Look inside. Anything that does not match exactly is rejected (validate) and never shown (previewFor).
export const PREVIEW_URLS = {
  ytPoster: (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ytEmbed: (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
  ytWatch: (id) => `https://www.youtube.com/watch?v=${id}`,
  gbScript: 'https://www.google.com/books/jsapi.js',
  archiveEmbed: (identifier) => `https://archive.org/embed/${identifier}`,
};
export const WATCH_LABELS = ['Author interview', 'Author talk', 'Book talk', 'Author lesson', 'Reading', 'Lecture', 'Documentary', 'Film trailer', 'TV series trailer'];
// Sites a Watch link may open (never embedded): the kind, its exact host, and how the page names it.
export const WATCH_SITES = {
  cspan: { host: 'www.c-span.org', name: 'C-SPAN', domain: 'c-span.org' },
  pbs: { host: 'www.pbs.org', name: 'PBS', domain: 'pbs.org' },
  criterion: { host: 'www.criterion.com', name: 'Criterion', domain: 'criterion.com' },
};
const PREVIEW_ID = {
  youtube: /^[A-Za-z0-9_-]{6,20}$/,
  googlebooks: /^[A-Za-z0-9_-]{8,16}$/,
  archive: /^[A-Za-z0-9._-]{3,100}$/,
};
const DURATION = /^(?:[1-9]\d?:[0-5]\d:[0-5]\d|[1-5]?\d:[0-5]\d)$/; // 2:31, 58:10, 1:04:05
const siteUrlOk = (kind, url) => typeof url === 'string' && url.startsWith(`https://${WATCH_SITES[kind].host}/`)
  && /^https:\/\/[a-z.-]+\/[A-Za-z0-9/?=&._~%+-]+$/.test(url);
const plain = (s, max) => typeof s === 'string' && s.trim() === s && s.length >= 1 && s.length <= max && !/[<>\u0000-\u001f]/.test(s);
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

export function watchErrors(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return ['preview.watch must be an object'];
  const e = [];
  if (w.kind === 'youtube') {
    if (!onlyKeys(w, ['kind', 'id', 'url', 'title', 'channel', 'duration', 'label'])) e.push('preview.watch has unknown keys');
    if (!PREVIEW_ID.youtube.test(w.id || '')) e.push('preview.watch.id is not a YouTube video id');
    else if (w.url !== undefined && w.url !== PREVIEW_URLS.ytWatch(w.id) && w.url !== `https://youtu.be/${w.id}`) e.push('preview.watch.url must be the YouTube watch link for its id');
  } else if (Object.hasOwn(WATCH_SITES, w.kind)) {
    if (!onlyKeys(w, ['kind', 'url', 'title', 'channel', 'duration', 'label'])) e.push('preview.watch has unknown keys');
    if (!siteUrlOk(w.kind, w.url)) e.push(`preview.watch.url must be a https://${WATCH_SITES[w.kind].host}/ link`);
  } else return [`preview.watch.kind must be youtube or one of: ${Object.keys(WATCH_SITES).join(', ')}`];
  if (!plain(w.title, 160)) e.push('preview.watch.title missing');
  if (!plain(w.channel, 80)) e.push('preview.watch.channel missing');
  if (w.duration !== undefined && !DURATION.test(w.duration)) e.push('preview.watch.duration must look like 2:31 or 1:04:05');
  if (!WATCH_LABELS.includes(w.label)) e.push(`preview.watch.label must be one of: ${WATCH_LABELS.join(', ')}`);
  return e;
}

export function lookErrors(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['preview.look must be an object'];
  if (l.kind === 'googlebooks') {
    if (!onlyKeys(l, ['kind', 'volumeId'])) return ['preview.look has unknown keys'];
    return PREVIEW_ID.googlebooks.test(l.volumeId || '') ? [] : ['preview.look.volumeId is not a Google Books volume id'];
  }
  if (l.kind === 'archive') {
    if (!onlyKeys(l, ['kind', 'identifier'])) return ['preview.look has unknown keys'];
    return PREVIEW_ID.archive.test(l.identifier || '') && !/^\.|\.\./.test(l.identifier) ? [] : ['preview.look.identifier is not an Internet Archive identifier'];
  }
  return ['preview.look.kind must be googlebooks or archive'];
}

export function previewErrors(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['preview must be an object'];
  if (!onlyKeys(p, ['watch', 'look'])) return ['preview has unknown keys (only watch and look)'];
  if (p.watch === undefined && p.look === undefined) return ['preview is empty'];
  return [...(p.watch !== undefined ? watchErrors(p.watch) : []), ...(p.look !== undefined ? lookErrors(p.look) : [])];
}

// The parts of a book's preview that are valid, or null. The page shows only these, whatever the file says.
export function previewFor(book) {
  const p = book && book.preview;
  if (!p || typeof p !== 'object') return null;
  const watch = p.watch !== undefined && !watchErrors(p.watch).length ? p.watch : null;
  const look = p.look !== undefined && !lookErrors(p.look).length ? p.look : null;
  return watch || look ? { watch, look } : null;
}

// The tabs a book's Preview has: Watch and/or Look inside, in that order; none without approved data.
export function previewTabs(book) {
  const p = previewFor(book);
  if (!p) return [];
  return [p.watch && { id: 'watch', label: 'Watch' }, p.look && { id: 'look', label: 'Look inside' }].filter(Boolean);
}

// "1:04:05" -> "1 hour 4 minutes", "12:34" -> "12 minutes 34 seconds", "2:31" -> "2 minutes 31 seconds".
export function durationWords(d) {
  const parts = String(d || '').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return '';
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  const unit = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return (h ? [unit(h, 'hour'), unit(m, 'minute')] : [unit(m, 'minute'), unit(s, 'second')]).filter(Boolean).join(' ') || '0 seconds';
}

// What the Watch tab shows. Before Play: a facade (no embed). After Play: the privacy-enhanced player. C-SPAN, PBS
// and Criterion are
// never embedded: a link out. No poster for the books that never show a picture (NO_COVER): a thumbnail chosen by
// the uploader could show the killer or the cult leader.
export function watchView(book, { played = false } = {}) {
  const w = previewFor(book)?.watch;
  if (!w) return null;
  const yt = w.kind === 'youtube';
  const site = yt ? { name: 'YouTube', domain: 'youtube.com' } : WATCH_SITES[w.kind];
  const dur = w.duration ? `, ${durationWords(w.duration)}` : '';
  const note = w.label === 'Film trailer' ? 'This is the trailer for the film adaptation.'
    : w.label === 'TV series trailer' ? 'This is the trailer for the TV adaptation.' : '';
  return {
    kind: w.kind, site: site.name, title: w.title, channel: w.channel, duration: w.duration || '', label: w.label,
    poster: yt && !NO_COVER.has(book.id) ? PREVIEW_URLS.ytPoster(w.id) : null,
    embed: yt && played ? PREVIEW_URLS.ytEmbed(w.id) : null,
    link: yt ? PREVIEW_URLS.ytWatch(w.id) : w.url,
    linkText: `Watch on ${site.name}`,
    playLabel: yt ? `Play: ${w.title}${dur}, ${w.channel}` : `Watch on ${site.domain}: ${w.title}${dur}, ${w.channel} (opens a new tab)`,
    credit: yt ? `Video: ${w.channel} on YouTube` : `Video: ${w.channel}, on ${site.domain}`,
    note,
  };
}

// What the Look inside tab shows. Nothing loads until it is opened (a click on the tab or its button).
export function lookView(book, { opened = false } = {}) {
  const l = previewFor(book)?.look;
  if (!l) return null;
  const gb = l.kind === 'googlebooks';
  return {
    kind: l.kind,
    script: gb && opened ? PREVIEW_URLS.gbScript : null,
    volumeId: gb ? l.volumeId : null,
    iframe: !gb && opened ? PREVIEW_URLS.archiveEmbed(l.identifier) : null,
    credit: gb ? 'Preview: Google Books' : 'Preview: Internet Archive',
    source: gb ? 'Google Books' : 'the Internet Archive',
  };
}

// The sheet's small print: what loads from where, and when, for this book's preview only.
export function previewNote(book) {
  const w = watchView(book), l = lookView(book);
  const parts = [];
  if (w && w.kind === 'youtube') parts.push((w.poster ? 'The video still comes from YouTube; the' : 'The') + ' video loads from YouTube only when you press play');
  if (l) parts.push(`${parts.length ? 'the' : 'The'} pages load from ${l.source} only when you open them`);
  let s = parts.length ? parts.join(', and ') + '. That service then sees your request.' : '';
  if (w && w.kind !== 'youtube') s += (s ? ' ' : '') + `The ${w.site} link opens ${WATCH_SITES[w.kind].domain} in a new tab; nothing loads from it here.`;
  return s;
}

// Every third-party address the preview loads in a given state (tests: nothing before a click).
// open: the Preview view is showing; tab: the selected tab; played / opened: Play pressed / Look inside opened.
export function previewRequests(book, { open = false, tab = null, played = false, opened = false } = {}) {
  if (!open) return [];
  const out = [];
  const w = watchView(book, { played });
  const l = lookView(book, { opened });
  if (tab === 'watch' && w) { if (w.poster) out.push(w.poster); if (w.embed) out.push(w.embed); }
  if (tab === 'look' && l) { if (l.script) out.push(l.script); if (l.iframe) out.push(l.iframe); }
  return out;
}

// Where the Preview sheet goes, in viewport px, given the book's rectangle on screen. Beside the book when there is
// room (`side`); otherwise full width over the lower part of the book, its top edge still showing (`over`).
// bottom: px kept free for the dialog's buttons.
export function previewPlace(book, vw, vh, { bottom = 96, gutter = 16, gap = 32, min = 400, max = 560, wide = 720, top = 16, peek = 0.22, minH = 420 } = {}) {
  const floor = vh - bottom;
  const right = vw - (book.left + book.width) - gap - gutter;
  if (right >= min && book.left >= 0) {
    const t = Math.max(top, Math.min(book.top, floor - minH));
    return { mode: 'side', left: Math.round(book.left + book.width + gap), top: Math.round(t), width: Math.round(Math.min(max, right)), height: Math.round(floor - t) };
  }
  const width = Math.min(vw - 2 * gutter, wide);
  const t = Math.max(top, Math.min(book.top + book.height * peek, floor - minH));
  return { mode: 'over', left: Math.round((vw - width) / 2), top: Math.round(t), width: Math.round(width), height: Math.round(Math.max(0, floor - t)) };
}

// DOM shelves on a wide screen: how far to slide the book left so the book and the sheet beside it sit centred.
export function previewShift(box, vw, { gutter = 16, gap = 32, min = 400, max = 560 } = {}) {
  const room = vw - 2 * gutter - box.W - gap;
  if (room < min) return 0;
  const group = box.W + gap + Math.min(max, room);
  return Math.round((vw - group) / 2 - box.left);
}

/* ---------- Data check (used by the tests and on load) ---------- */

export function validate(data) {
  const errors = [];
  const shelfIds = new Set((data.shelves || []).map((s) => s.id));
  const seen = new Set();
  for (const b of data.books || []) {
    const where = b.id || b.title;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.id || '')) errors.push(`${where}: bad id`);
    if (seen.has(b.id)) errors.push(`${where}: duplicate id`);
    seen.add(b.id);
    if (!shelfIds.has(b.shelf)) errors.push(`${where}: unknown shelf`);
    if (!b.title || !Array.isArray(b.authors) || !b.authors.length) errors.push(`${where}: title or authors missing`);
    // Up to next year: an author may put a book forward a few weeks before its publication year turns.
    if (!Number.isInteger(b.year) || b.year < 1500 || b.year > new Date().getUTCFullYear() + 1) errors.push(`${where}: bad year`);
    // Books put forward by their author or publisher (lib/stacks-db.js) carry origin; the static list never does.
    if (b.origin !== undefined && b.origin !== 'author' && b.origin !== 'publisher') errors.push(`${where}: origin must be author or publisher`);
    for (const k of ['olWork', 'olEdition']) if (b[k] != null && typeof b[k] !== 'string') errors.push(`${where}: ${k} must be text or null`);
    if (!b.description || b.description.split(/(?<=[a-z0-9)”’][.?!])\s+(?=[A-Z“])/).length > 2) errors.push(`${where}: description must be one or two sentences`);
    if (!Array.isArray(b.tags) || !b.tags.length) errors.push(`${where}: tags missing`);
    if (b.olVerified !== false && b.olVerified !== true) errors.push(`${where}: olVerified missing`);
    if (b.cover !== undefined) {
      const c = b.cover;
      if (!c || !Number.isInteger(c.id) || c.id <= 0) errors.push(`${where}: cover.id must be a positive integer`);
      else if (c.olKey !== null && !/^\/works\/OL\d+W$/.test(c.olKey || '')) errors.push(`${where}: cover.olKey must be /works/OL…W or null`);
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(c.checked || '')) errors.push(`${where}: cover.checked must be a date`);
    }
    if (b.preview !== undefined) for (const e of previewErrors(b.preview)) errors.push(`${where}: ${e}`);
  }
  return errors;
}
