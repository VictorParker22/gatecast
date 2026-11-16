// Headlines for the Today page's "The brief": the outlets in data/news-sources.json, read from their public
// RSS or Atom feeds. Shared by server.js (local) and api/news.js (Vercel function). No dependencies.
// We keep only what a link needs: the outlet's own headline, its name, the time and the story's address.
// Descriptions, opening paragraphs and images are never read out of the feed, so they can never be shown.
const SOURCES = require('../data/news-sources.json').sources;

const DAY = 24 * 3600e3;
const LIMITS = { maxAgeMs: 7 * DAY, perOutlet: 3, total: 8, skewMs: 3600e3 };
const FEED_TIMEOUT_MS = 6000;
const MAX_FEED_BYTES = 4e6;

/* ---------- Text ---------- */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', copy: '©', reg: '®', trade: '™', deg: '°' };

// "&amp;", "&#8217;", "&#x2019;" -> characters. Unknown or invalid references are left as written.
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    }
    const c = NAMED[e.toLowerCase()];
    return c === undefined ? m : c;
  });
}

// The text of an element's raw content: CDATA kept as written, everything else XML-decoded once; then any
// HTML tags are removed, HTML entities decoded and whitespace collapsed. Control characters are dropped.
function plainText(raw) {
  const html = String(raw || '').split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map((part) =>
    (part.startsWith('<![CDATA[') ? part.slice(9, -3) : decodeEntities(part))).join('');
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:p|br|div|li|h[1-6]|tr|td|blockquote)\b[^<>]*>/gi, ' ').replace(/<\/?[a-z][^<>]*>/gi, ''))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f​-‍﻿]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Only https: addresses with a host, returned in normalised form; anything else is null.
function httpsUrl(raw) {
  const s = plainText(raw);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

/* ---------- Feeds ---------- */

const esc = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Raw content of the first <name>...</name> (attributes allowed), or ''.
function element(xml, name) {
  const m = xml.match(new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i'));
  return m ? m[1] : '';
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4]);
  return out;
}
// Atom: <link href="..."/> with rel="alternate" (or no rel); RSS: <link>...</link>.
function linkOf(block) {
  const tags = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => attrs(m[1])).filter((a) => a.href);
  const alt = tags.find((a) => !a.rel || a.rel === 'alternate');
  if (alt) return httpsUrl(alt.href);
  const text = element(block, 'link');
  if (text) return httpsUrl(text);
  // A guid (RSS) or id (Atom) is often the permalink itself.
  return httpsUrl(element(block, 'guid')) || httpsUrl(element(block, 'id'));
}
function dateOf(block) {
  for (const name of ['pubDate', 'published', 'updated', 'dc:date', 'a10:updated', 'issued']) {
    const raw = plainText(element(block, name));
    const ms = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

// RSS 2.0 or Atom -> [{ title, url, published (ms) }]. Items without an https link, a title or a date are dropped.
function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = text.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const full of blocks) {
    // The outlet's own words beyond the headline are never read: drop them before looking for anything.
    const block = full.replace(/<(description|summary|content(?::encoded)?|media:[\w-]+|itunes:[\w-]+|enclosure)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/gi, '');
    const title = plainText(element(block, 'title'));
    const url = linkOf(block);
    const published = dateOf(block);
    if (!title || !url || !Number.isFinite(published)) continue;
    out.push({ title: title.length > 240 ? title.slice(0, 239).trimEnd() + '…' : title, url, published });
  }
  return out;
}

/* ---------- Choosing what to show ---------- */

const urlKey = (u) => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (x.search || '')).toLowerCase();
  } catch { return u; }
};
const words = (t) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Near-identical: the same words once punctuation and case are ignored, or nearly all words shared.
function sameStory(a, b) {
  const wa = words(a), wb = words(b);
  if (wa === wb) return true;
  const A = new Set(wa.split(' ')), B = new Set(wb.split(' '));
  if (A.size < 5 || B.size < 5) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both) >= 0.8;
}

// items: [{ title, url, published, outlet, ... }] from every feed. Keeps the past week (and nothing dated more
// than an hour ahead), newest first, without repeats, at most perOutlet per outlet and total overall.
function selectItems(items, now = Date.now(), opts = {}) {
  const { maxAgeMs, perOutlet, total, skewMs } = { ...LIMITS, ...opts };
  const fresh = items
    .filter((x) => x && Number.isFinite(x.published) && x.published >= now - maxAgeMs && x.published <= now + skewMs)
    .sort((a, b) => b.published - a.published);
  const seen = new Set(), kept = [], perCount = new Map();
  for (const x of fresh) {
    const key = urlKey(x.url);
    if (seen.has(key) || kept.some((k) => sameStory(k.title, x.title))) continue;
    seen.add(key);
    const n = perCount.get(x.outlet) || 0;
    if (n >= perOutlet) continue;
    perCount.set(x.outlet, n + 1);
    kept.push(x);
    if (kept.length >= total) break;
  }
  return kept;
}

/* ---------- Fetching ---------- */

const knownState = (code) => SOURCES.some((s) => s.state === code);
// "ny" -> "NY" when we have outlets for it; anything else (missing, malformed, no outlets) -> null.
function normaliseState(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) && knownState(s) ? s : null;
}
const sourcesFor = (state) => SOURCES.filter((s) => s.state === (state || 'national'));

async function readFeed(src, fetchImpl) {
  const res = await fetchImpl(src.feed, {
    headers: { 'User-Agent': 'gatecast/1.0 (headline links)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1' },
    redirect: 'follow', signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('feed too large');
  return parseFeed(text);
}

// All of a state's feeds in parallel; a feed that fails or times out is skipped.
async function loadNews(state, { fetchImpl = fetch, now = Date.now() } = {}) {
  const list = sourcesFor(state);
  const results = await Promise.allSettled(list.map((s) => readFeed(s, fetchImpl)));
  const all = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const src = list[i];
    for (const x of r.value) all.push({ ...x, outlet: src.name, outletUrl: src.homepage, source: src.id });
  });
  const items = selectItems(all, now).map(({ title, url, outlet, outletUrl, published }) => ({ title, url, outlet, outletUrl, published: new Date(published).toISOString() }));
  return {
    state: state || null,
    items,
    sources: list.map((s, i) => ({ id: s.id, name: s.name, url: s.homepage, ok: results[i].status === 'fulfilled' })),
    checkedAt: new Date(now).toISOString(),
  };
}

// Many visitors share one round of feed requests per state.
const cache = new Map();
async function newsFor(q) {
  const state = normaliseState(q && q.get ? q.get('state') : q);
  const key = state || 'national';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = await loadNews(state);
  // A round where every feed failed is retried sooner.
  cache.set(key, { at: Date.now(), ttl: value.sources.some((s) => s.ok) ? 10 * 60e3 : 60e3, value });
  return value;
}

const CACHE_CONTROL = 'public, s-maxage=900, stale-while-revalidate=3600';

module.exports = { newsFor, loadNews, parseFeed, selectItems, plainText, decodeEntities, httpsUrl, sameStory, normaliseState, CACHE_CONTROL, SOURCES };
