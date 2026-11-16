// Weird news for the front page: /api/weird. The outlets in data/weird-sources.json, read from their public RSS
// or Atom feeds, plus the editor's picks in data/weird-picks.json. Shared by server.js (local) and api/weird.js
// (Vercel function). No dependencies.
// Feed reading, headline text, preview images and the SSRF guards are lib/news.js's own (required, not copied):
// as for the brief, only the outlet's headline, name, time, link and preview image are kept. Descriptions and
// article text are never read. Every item then passes lib/moderation.js; what it holds or drops never reaches the
// response (?debug=1 shows only counts per rule).
const crypto = require('node:crypto');
const dns = require('node:dns');
const news = require('./news.js');
const { moderate, RULES, ANIMAL, PERSON } = require('./moderation.js');
const SOURCE_FILE = require('../data/weird-sources.json');
const PICK_FILE = require('../data/weird-picks.json');

const DAY = 24 * 3600e3;
const LIMITS = { feedMaxAgeMs: 14 * DAY, skewMs: 3600e3, perOutlet: 8, perReviewOutlet: 3, pool: 150, defaultLimit: 30, maxLimit: 60 };
const PICK_MAX_AGE_MS = (Number(PICK_FILE.maxAgeDays) || 21) * DAY;
const FEED_TIMEOUT_MS = 6000;
const MAX_FEED_BYTES = 4e6;
const CATEGORIES = ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other'];
const CACHE_CONTROL = news.CACHE_CONTROL; // public, s-maxage=900, stale-while-revalidate=3600
const DEBUG_CACHE_CONTROL = 'no-store';

/* ---------- Sources ---------- */

const lowerList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).map((x) => x.toLowerCase()) : []);
function normaliseSource(s) {
  const hints = {};
  for (const [k, v] of Object.entries((s && s.categoryHints) || {})) if (CATEGORIES.includes(v)) hints[k.toLowerCase()] = v;
  return {
    id: s.id, name: s.name, section: s.section || null, home: s.home, feed: s.feed,
    images: s.images !== false, review: s.review === true, categoryHints: hints,
    filter: s.filter ? { categories: lowerList(s.filter.categories), paths: lowerList(s.filter.paths) } : null,
    exclude: s.exclude ? { titles: lowerList(s.exclude.titles), paths: lowerList(s.exclude.paths) } : null,
  };
}
const SOURCES = SOURCE_FILE.sources.map(normaliseSource);

/* ---------- Feeds ---------- */

const ITEM_BLOCK = /<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OUTLET_WORDS = /<(description|summary|content(?::encoded)?)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/gi;
// The feed's own labels for an item: RSS <category>text</category>, Atom <category term="..."/>, <dc:subject>.
function feedCategories(block) {
  const b = block.replace(OUTLET_WORDS, '');
  const out = [];
  for (const m of b.matchAll(/<(category|dc:subject)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
    let v = news.plainText(m[3] || '');
    if (!v) {
      const t = /\b(?:term|label)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
      v = t ? news.plainText(news.decodeEntities(t[1] ?? t[2])) : '';
    }
    if (v && v.length <= 80 && !out.includes(v)) out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

// RSS or Atom -> [{ title, url, published (ms), image, categories }]. Each item block goes through lib/news.js's
// own parseFeed, so the same items are kept and the same text is never read; only the category labels are added.
function parseWeirdFeed(xml) {
  const out = [];
  for (const block of String(xml || '').match(ITEM_BLOCK) || []) {
    const [item] = news.parseFeed(block);
    if (item) out.push({ ...item, categories: feedCategories(block) });
  }
  return out;
}

function errorClass(e) {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  const code = e && e.cause && e.cause.code;
  return typeof code === 'string' && /^[A-Z_]{2,32}$/.test(code) ? `network ${code}` : 'network';
}

// One feed: { ok, status, error, items }. Never throws. error is a class only ('http', 'timeout', 'network ...',
// 'too large', 'not a feed'), never a message from elsewhere.
async function readFeed(src, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(src.feed, {
      headers: { 'User-Agent': 'gatecast/1.0 (headline links)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1' },
      redirect: 'follow', signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (e) { return { ok: false, status: null, error: errorClass(e), items: [] }; }
  const status = Number.isInteger(res && res.status) ? res.status : null;
  if (!res || !res.ok) { res?.body?.cancel?.().catch?.(() => {}); return { ok: false, status, error: 'http', items: [] }; }
  let text;
  try { text = String(await res.text()); } catch (e) { return { ok: false, status, error: errorClass(e), items: [] }; }
  if (text.length > MAX_FEED_BYTES) return { ok: false, status, error: 'too large', items: [] };
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 4000))) return { ok: false, status, error: 'not a feed', items: [] };
  return { ok: true, status, error: null, items: parseWeirdFeed(text) };
}

/* ---------- Headlines, filters, categories ---------- */

// UPI-style labels in front of a headline. "Watch:" means the outlet made it a video; both labels are removed,
// and the rest of the headline is kept exactly as written.
const LABEL = /^\s*(watch|look)\s*:\s*/i;
function headline(title) {
  const m = LABEL.exec(title);
  if (!m) return { title, video: false };
  const rest = title.slice(m[0].length).trim();
  return rest ? { title: rest, video: m[1].toLowerCase() === 'watch' } : { title, video: false };
}

const pathOf = (url) => { try { return decodeURIComponent(new URL(url).pathname).toLowerCase(); } catch { return ''; } };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text, term) => new RegExp(`(?:^|[^a-z0-9])${escRe(term)}(?:$|[^a-z0-9])`, 'i').test(text);

// A source's own filter (only these sections of a general feed) and exclusions (shopping posts).
function sourceAllows(item, src) {
  const path = pathOf(item.url);
  const cats = item.categories.map((c) => c.toLowerCase());
  if (src.exclude) {
    if (src.exclude.titles.some((t) => hasTerm(item.rawTitle.toLowerCase(), t))) return false;
    if (src.exclude.paths.some((p) => path.includes(p))) return false;
  }
  if (src.filter) {
    const byCat = src.filter.categories.some((f) => cats.some((c) => c === f || hasTerm(c, f)));
    const byPath = src.filter.paths.some((p) => path.includes(p));
    if (!byCat && !byPath) return false;
  }
  return true;
}

const KEYWORDS = [
  ['records', /\b(?:guinness|world records?|record[- ](?:breaking|breaker|breakers|setting|holders?|attempts?)|(?:sets?|setting|breaks?|breaking|broke|smash(?:es|ed)?|claims?|claimed|earns?|earned)\s+(?:[\w-]+\s+){0,2}records?|world'?s\s+(?:largest|longest|tallest|biggest|smallest|heaviest|oldest|loudest|fastest|shortest|highest|deepest|most|first))\b/i],
  ['laws', /\b(?:laws?|legal(?:ly|i[sz]e[sd]?)?|illegal(?:ly)?|outlaw(?:s|ed)?|bans?|banned|banning|ordinances?|statutes?|legislat\w*|lawmakers?|bylaws?|regulations?|permits?|fined|fines|speeding ticket|parking ticket|ticketed|citations?|lawsuits?|sued|sues|council vote[sd]?|loophole)\b/i],
  ['unexplained', /\b(?:myster(?:y|ies|ious(?:ly)?)|unexplained|unidentified|ufos?|uaps?|extraterrestrials?|aliens?(?!\s+(?:species|plants?|invasive))|ghosts?|ghostly|haunt(?:ed|ing|s)?|paranormal|poltergeists?|cryptids?|bigfoot|sasquatch|yeti|loch ness|nessie|baffl(?:e|es|ed|ing)|puzzl(?:e|es|ed|ing)|enigma(?:s|tic)?|strange (?:lights?|sounds?|noises?|objects?|signals?)|monoliths?|unknown origin)\b/i],
  ['animals', ANIMAL],
  ['weather', /\b(?:weather|storms?(?!\s+drains?)|tornado(?:e?s)?|waterspouts?|hail(?:storms?|stones?)?|snow(?:fall|storms?|flakes?)?|blizzards?|lightning|thunder\w*|heat ?waves?|cold snap|frost|fog|rainbows?|auroras?|northern lights|el ni[nñ]o|la ni[nñ]a|monster waves|rogue waves?|cyclones?|hurricanes?|typhoons?|ice storms?|sleet|rainfall|downpours?|meteors?|fireballs?|dust devils?|sandstorms?|whirlwinds?|icicles?|frozen waves?|polar vortex)\b/i],
  ['people', PERSON],
  ['people', /\b(?:crowds?|hundreds|thousands|artists?|town criers?|teachers?|chefs?|farmers?|mayor|officials?|villagers?|family|families|athletes?|runners?|swimmers?|hikers?|fisherm[ae]n|anglers?|inventors?|collectors?|bakers?)\b/i],
];
// The feed's own label first (when the source maps it), then the headline's words; otherwise 'other'.
function categorise(item, src) {
  const cats = item.categories.map((c) => c.toLowerCase());
  for (const [hint, cat] of Object.entries(src.categoryHints || {})) if (cats.some((c) => c.includes(hint))) return cat;
  const text = `${item.rawTitle} ${pathOf(item.url).replace(/[/_.-]+/g, ' ')}`.replace(/[‘’]/g, "'");
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'other';
}

const idOf = (url) => crypto.createHash('sha1').update(news.urlKey(url)).digest('hex').slice(0, 12);

/* ---------- Editor's picks ---------- */

// A pick's date: "2026-11-13" is read as noon UTC that day (so it reads as that date everywhere); a full timestamp as given.
function pickTime(v) {
  const s = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

// The picks still in their window that pass moderation, newest first. Seeded picks (not yet reviewed by the owner)
// get every rule; reviewed ones (seeded: false) only the drop rules.
function pickItems(picks, sources, now, held) {
  const stats = { listed: 0, shown: 0, expired: 0, held: 0, invalid: 0 };
  const out = [];
  for (const p of Array.isArray(picks) ? picks : []) {
    stats.listed++;
    const url = p && news.httpsUrl(p.url);
    const title = p && typeof p.title === 'string' ? news.plainText(p.title) : '';
    const published = pickTime(p && p.published);
    if (!url || !title || !Number.isFinite(published) || typeof p.outlet !== 'string') { stats.invalid++; continue; }
    if (published < now - PICK_MAX_AGE_MS || published > now + DAY) { stats.expired++; continue; }
    const verdict = moderate({ title, url }, { holds: p.seeded !== false });
    if (!verdict.ok) { stats.held++; held[verdict.rule] = (held[verdict.rule] || 0) + 1; continue; }
    const src = sources.find((s) => s.name === p.outlet) || null;
    let outletUrl = src ? src.home : null;
    if (!outletUrl) { try { outletUrl = new URL(url).origin + '/'; } catch { outletUrl = null; } }
    const rating = Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5 ? p.rating : null;
    const note = typeof p.note === 'string' && p.note.trim() ? news.plainText(p.note).slice(0, 200) : null;
    const h = headline(title);
    out.push({
      title: h.title, rawTitle: title, url, published, outlet: p.outlet, outletUrl, src,
      category: CATEGORIES.includes(p.category) ? p.category : null,
      image: null, video: p.video === true || h.video, pick: true, rating, note, categories: [],
    });
  }
  out.sort((a, b) => b.published - a.published);
  for (const x of out) if (!x.category) x.category = categorise(x, x.src || { categoryHints: {} });
  stats.shown = out.length;
  return { items: out, stats };
}

/* ---------- One round: every feed, moderated, merged ---------- */

// All feeds in parallel, then: the 14-day window, each source's own filter, moderation, the picks merged in
// (picks first, newest first; then regular outlets newest first; then review outlets newest first), repeats removed
// (same address or near-identical headline), at most perOutlet feed stories per outlet (perReviewOutlet for a
// review outlet; picks are on top of that), capped at pool. Images are not read here: only for the items a
// request returns (see respond).
async function loadRound({ fetchImpl = fetch, now = Date.now(), sources = SOURCES, picks = PICK_FILE.picks } = {}) {
  const results = await Promise.all(sources.map((s) => readFeed(s, fetchImpl)));
  const held = {};
  const report = [];
  const regular = [], review = [];
  results.forEach((r, i) => {
    const src = sources[i];
    const row = { name: src.name, ok: r.ok, status: r.status, error: r.error, items: r.items.length, kept: 0, filtered: 0, old: 0, held: 0 };
    for (const raw of r.items) {
      if (!(raw.published >= now - LIMITS.feedMaxAgeMs && raw.published <= now + LIMITS.skewMs)) { row.old++; continue; }
      const h = headline(raw.title);
      const item = {
        title: h.title, rawTitle: raw.title, url: raw.url, published: raw.published, categories: raw.categories,
        outlet: src.name, outletUrl: src.home, src, image: src.images && raw.image ? raw.image.url : null,
        video: h.video, pick: false, rating: null, note: null,
      };
      if (!sourceAllows(item, src)) { row.filtered++; continue; }
      const verdict = moderate({ title: raw.title, url: raw.url, categories: raw.categories });
      if (!verdict.ok) { row.held++; held[verdict.rule] = (held[verdict.rule] || 0) + 1; continue; }
      item.category = categorise(item, src);
      row.kept++;
      (src.review ? review : regular).push(item);
    }
    report.push(row);
  });

  const { items: pickList, stats: pickStats } = pickItems(picks, sources, now, held);
  // A feed item for the same story as a pick lends the pick its picture and video label, then is dropped.
  const isSame = (a, b) => news.urlKey(a.url) === news.urlKey(b.url) || news.sameStory(a.rawTitle, b.rawTitle);
  const feedItems = [...regular.sort((a, b) => b.published - a.published), ...review.sort((a, b) => b.published - a.published)];
  for (const p of pickList) {
    for (const x of feedItems) {
      if (x.outlet !== p.outlet || !isSame(p, x)) continue;
      if (!p.image && x.image) p.image = x.image;
      if (x.video) p.video = true;
    }
  }

  const kept = [], seen = new Set(), perCount = new Map();
  for (const x of [...pickList, ...feedItems]) {
    const key = news.urlKey(x.url);
    if (seen.has(key) || kept.some((k) => news.sameStory(k.rawTitle, x.rawTitle))) continue;
    seen.add(key);
    if (!x.pick) {
      const n = perCount.get(x.outlet) || 0;
      if (n >= (x.src && x.src.review ? LIMITS.perReviewOutlet : LIMITS.perOutlet)) continue;
      perCount.set(x.outlet, n + 1);
    }
    kept.push(x);
    if (kept.length >= LIMITS.pool) break;
  }
  return {
    pool: kept, held, report, picks: pickStats, checkedAt: new Date(now).toISOString(),
    anyOk: results.some((r) => r.ok), sources,
  };
}

/* ---------- One answer ---------- */

function emptyCounts() { return Object.fromEntries(CATEGORIES.map((c) => [c, 0])); }

// Query -> { limit 1-60 (default 30), category or null, debug }.
function parseQuery(q) {
  const get = (k) => (q && typeof q.get === 'function' ? q.get(k) : q && q[k]);
  const n = parseInt(String(get('limit') ?? ''), 10);
  const limit = Number.isFinite(n) ? Math.min(LIMITS.maxLimit, Math.max(1, n)) : LIMITS.defaultLimit;
  const c = String(get('category') ?? '').trim().toLowerCase();
  return { limit, category: CATEGORIES.includes(c) ? c : null, debug: get('debug') === '1' || get('debug') === 'true' };
}

// The response for one query from a round. The publisher's og:image is read (cached, on the outlet's own site
// only, lib/news.js) for returned feed items that have no feed image, when the outlet's images switch is on.
// Picks get a picture only from the feed, never from a page read.
async function respond(round, { limit, category, debug }, { fetchImpl = fetch, lookupImpl = dns.promises.lookup, pageCache = true } = {}) {
  const chosen = round.pool.filter((x) => !category || x.category === category).slice(0, limit);
  const read = pageCache ? news.cachedPageImage : async (u, s, o) => { const got = await news.pageImage(u, s, o); return got ? got.image : null; };
  const images = await Promise.all(chosen.map(async (x) => {
    if (x.image || x.pick || !x.src || !x.src.images) return x.image || null;
    const got = await read(x.url, { homepage: x.src.home, feed: x.src.feed }, { fetchImpl, lookupImpl });
    return got ? got.url : null;
  }));
  const categories = emptyCounts();
  const items = chosen.map((x, i) => {
    categories[x.category]++;
    return {
      id: idOf(x.url), title: x.title, url: x.url, outlet: x.outlet, outletUrl: x.outletUrl,
      published: new Date(x.published).toISOString(), category: x.category,
      image: images[i], imageCredit: images[i] ? `Image: ${x.outlet}` : null,
      video: Boolean(x.video), pick: Boolean(x.pick), rating: x.pick ? x.rating : null, note: x.pick ? x.note : null,
    };
  });
  const out = {
    items, categories, checkedAt: round.checkedAt,
    sources: round.report.map((r) => ({ name: r.name, ok: r.ok, count: items.filter((x) => x.outlet === r.name).length })),
  };
  if (debug) {
    out.held = Object.fromEntries(Object.keys(RULES).concat('H0').filter((k) => round.held[k]).map((k) => [k, round.held[k]]));
    out.debug = {
      rules: RULES,
      sources: round.report.map(({ name, ok, status, error, items: n, kept, filtered, old, held }) => ({ name, ok, status, error, items: n, kept, filtered, old, held })),
      picks: round.picks,
      pool: round.pool.length,
    };
  }
  return out;
}

/* ---------- Cache ---------- */

// Many visitors share one round of feed requests: 10 minutes, or 1 minute when every feed failed. Within a round,
// each distinct query's answer is kept too.
let current = null; // { at, ttl, promise, answers: Map }
function round() {
  const now = Date.now();
  if (current && now - current.at < current.ttl) return current;
  const entry = { at: now, ttl: 60e3, answers: new Map() };
  entry.promise = loadRound().then((r) => { entry.ttl = r.anyOk ? 10 * 60e3 : 60e3; return r; },
    (err) => { entry.ttl = 0; throw err; });
  current = entry;
  return entry;
}

// GET /api/weird. Throws (the caller answers 502) only when there is nothing at all to show: every feed failed
// and no pick is in its window. opts (tests only: fetchImpl, lookupImpl, now, sources, picks) bypass the cache.
async function weirdFor(q, opts) {
  const query = parseQuery(q);
  if (opts) {
    const r = await loadRound(opts);
    if (!r.anyOk && r.pool.length === 0) throw new Error('all feeds failed');
    return respond(r, query, { pageCache: false, ...opts });
  }
  const entry = round();
  const r = await entry.promise;
  if (!r.anyOk && r.pool.length === 0) throw new Error('all feeds failed');
  const key = `${query.limit}|${query.category || ''}|${query.debug ? 1 : 0}`;
  if (!entry.answers.has(key)) entry.answers.set(key, respond(r, query).catch((err) => { entry.answers.delete(key); throw err; }));
  return entry.answers.get(key);
}

module.exports = {
  weirdFor, loadRound, respond, parseQuery, parseWeirdFeed, feedCategories, headline, categorise, sourceAllows, pickItems, pickTime,
  normaliseSource, readFeed, SOURCES, CATEGORIES, LIMITS, CACHE_CONTROL, DEBUG_CACHE_CONTROL,
};
