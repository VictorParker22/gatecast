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

/* ---------- Links ---------- */

const q = (book) => `${book.title} ${book.authors?.[0] || ''}`.trim();

export const worldcatUrl = (book) => 'https://search.worldcat.org/search?q=' + encodeURIComponent(q(book));

export function bookshopUrl(book, affiliate = BOOKSHOP_AFFILIATE) {
  if (affiliate && book.isbn13) return `https://bookshop.org/a/${encodeURIComponent(affiliate)}/${book.isbn13}`;
  const base = 'https://bookshop.org/search?keywords=' + encodeURIComponent(q(book));
  return affiliate ? base + '&a_aid=' + encodeURIComponent(affiliate) : base;
}

// A record the server confirmed (title and author matched) wins; an unverified ID is never linked as if it
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
    if (!Number.isInteger(b.year) || b.year < 1500 || b.year > 2026) errors.push(`${where}: bad year`);
    if (!b.description || b.description.split(/(?<=[a-z0-9)”’][.?!])\s+(?=[A-Z“])/).length > 2) errors.push(`${where}: description must be one or two sentences`);
    if (!Array.isArray(b.tags) || !b.tags.length) errors.push(`${where}: tags missing`);
    if (b.olVerified !== false && b.olVerified !== true) errors.push(`${where}: olVerified missing`);
  }
  return errors;
}
