// Weird news for the front page: /api/weird. The outlets in data/weird-sources.json, read from their public RSS
// or Atom feeds, plus the editor's picks in data/weird-picks.json. Shared by server.js (local) and api/weird.js
// (Vercel function). No dependencies.
// Feed reading, headline text, preview images and the SSRF guards are lib/news.js's own (required, not copied):
// as for the brief, only the outlet's headline, name, time, link and preview image are kept. Descriptions and
// article text are never read. Every item then passes lib/moderation.js; what it holds or drops never reaches the
// response (?debug=1 shows only counts per rule). Outside UPI's odd-news desk, a story must also show some sign of
// being strange (weirdness(), below) to run, and general outlets are capped at a few stories each.
// Editor's picks come from the reviewer database (lib/picks-db.js) and data/weird-picks.json.
const crypto = require('node:crypto');
const dns = require('node:dns');
const news = require('./news.js');
const { moderate, RULES, ANIMAL, PERSON } = require('./moderation.js');
const { loadDbPicks } = require('./picks-db.js');
const SOURCE_FILE = require('../data/weird-sources.json');
const PICK_FILE = require('../data/weird-picks.json');

// The reviewer database. The publishable key is public by design (js/config.js sends it from every browser);
// row-level security lets it read published picks only. Overridable per deployment.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfdwmzuedjcsaxgzhzmu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_a2KiR862D8VC63YjqFIYSQ_U5YnwpMJ';

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
    enabled: s.enabled !== false, stale: typeof s.stale === 'string' ? s.stale : null,
    images: s.images !== false, review: s.review === true, categoryHints: hints,
    filter: s.filter ? { categories: lowerList(s.filter.categories), paths: lowerList(s.filter.paths) } : null,
    exclude: s.exclude ? { titles: lowerList(s.exclude.titles), paths: lowerList(s.exclude.paths) } : null,
    listicles: s.listicles !== false, // false: drop listicles, quizzes and evergreen explainers
    minWeirdness: Number.isFinite(s.minWeirdness) ? s.minWeirdness : 0,
    cap: Number.isInteger(s.cap) && s.cap > 0 ? s.cap : null,
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

// A story's address without tracking parameters (utm_*, fbclid, gclid, mc_*).
function cleanUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(k)) x.searchParams.delete(k);
    return x.href;
  } catch { return u; }
}

/* ---------- Weirdness ---------- */

// Evergreen posts that are not news: listicles ("10 Old-Fashioned Words for..."), quizzes, word origins, rankings.
const LISTICLE = [
  /^\s*(?:the\s+)?\d{1,3}\s+(?:\S+\s+){0,3}?\S*s\b/i, // a leading number and a plural noun
  /\bquiz(?:zes)?\b/i, /^\s*why do we\b/i, /\bthings\b/i, /\bwords? for\b/i, /\bways to\b/i, /^\s*how to\b/i,
  /\bfacts about\b/i, /\byou (?:didn'?t|never|probably don'?t) know\b/i, /\bthe year you were born\b/i, /\bpuns\b/i,
  /\branked\b/i, /\bmost popular\b/i, /\bcan you (?:name|guess|identify|spot)\b/i, /\bgift guide\b/i,
];
const isListicle = (title) => LISTICLE.some((re) => re.test(String(title || '')));

const RECORD = KEYWORDS[0][1];
const MYSTERY = /\b(?:myster(?:y|ies|ious(?:ly)?)|unexplained|strange(?:ly|st)?|bizarre|odd(?:ly|est|ity|ities)?|weird(?:est|ly)?|baffl\w*|puzzl\w*|enigma\w*|unusual(?:ly)?|peculiar|eerie|inexplicabl\w*|unidentified|ufos?|uaps?|ghosts?|haunted|paranormal|curious)\b/i;
const WEIRD_LABEL = /\b(?:weird|bizarre|strange|odd|offbeat|oddit(?:y|ies)|myster(?:y|ies)|quirky)\b/i;
const LOOSE = /\b(?:escap(?:e|es|ed|ee|ees)|loose|on the lam|runaway|wander(?:s|ed|ing)?|stray(?:ed|s)?|invad(?:e|es|ed|ing)|sneak(?:s|ed|ing)?|snuck|stowaways?|hitch(?:es|ed|hik\w*)|interrupt(?:s|ed|ing)?|board(?:s|ed|ing)|rides?|riding|moves? into|takes? over|spotted (?:in|on|at)|turns? up|shows? up)\b/i;
const ODD_PLACE = /\b(?:bus(?:es)?|police|cops?|deputies|sheriff'?s?|airports?|planes?|flights?|airlines?|soccer|football|baseball|basketball|hockey|golf|games?|match|stadium|stores?|shops?|supermarkets?|grocery|mall|walmart|costco|driveways?|kitchens?|offices?|banks?|restaurants?|caf[eé]s?|bars?|pubs?|hotels?|church(?:es)?|courthouses?|librar(?:y|ies)|museums?|trains?|subway|stations?|cars?|trucks?|vans?|highways?|freeways?|interstate|roads?|homes?|house|garage|pools?|toilets?|bathrooms?|bedrooms?|classrooms?|parliament|city hall|weddings?|parades?|drive-thru|fast[- ]food|gas station|parking (?:lot|garage)|elevators?|roofs?|chimneys?|post office|mailbox|car wash|gym|yoga|concerts?|theat(?:er|re)s?|cinema)\b/i;
const TWIST = /\b(?:turns? out|turned out|mistaken for|mistook|accidentally|by mistake|unexpected(?:ly)?|surpris(?:e|ing|ingly)|dressed (?:as|up)|costumes?|giant|tiny|world'?s (?:first|only))\b/i;
const QUOTED = /(?:^|[\s(:])['‘"“][^'"‘’“”]{2,80}['’"”](?=$|[\s:,.!?)])/;
const NUMBER = /(?:^|[^$\d,.])(\d{1,3}(?:,\d{3})+|\d{3,})\s+((?:[a-z-]+\s+){0,2}[a-z-]+)/gi;
const PLAIN_COUNT = /^(?:years?|percent|dollars|people|residents|users|jobs|homes|households|cases|deaths|miles|feet|km|kilometers|meters|times|million|billion|students|employees|workers|fans|visitors|bc|ad|bce|ce)\b/i;

// How strange a story looks from its headline, address and the feed's labels: a small whole number, the same every
// time for the same input. Signals: a record (+2); mystery or oddity words in the headline (+2); the outlet's own
// "weird" label or section in its address (+1); an animal loose or out of place (+2); an animal with a human
// place or institution (+2); a quoted phrase in the headline (+1); an unusual number, like "3,000 tarantulas"
// (+1, +1 more for animals); a twist (+1).
// Used to gate outlets that are not odd-news desks and to order each day's stories. (Listicles are a separate
// filter, isListicle, for the outlets whose entry sets listicles: false.)
function weirdness(item) {
  const title = String((item && (item.rawTitle || item.title)) || '').replace(/[‘’]/g, "'");
  const path = item && item.url ? pathOf(item.url).replace(/[/_.+-]+/g, ' ') : '';
  const text = `${title} ${path}`;
  const labels = Array.isArray(item && item.categories) ? item.categories.join(' | ') : '';
  const animal = ANIMAL.test(text);
  let score = 0;
  if (RECORD.test(text)) score += 2;
  if (MYSTERY.test(title)) score += 2;
  if (WEIRD_LABEL.test(`${labels} | ${path}`)) score += 1; // the outlet's own label or section ("Odd News", /strange-news/)
  if (animal && LOOSE.test(text)) score += 2;
  if (animal && ODD_PLACE.test(text)) score += 2;
  if (QUOTED.test(String((item && (item.rawTitle || item.title)) || ''))) score += 1;
  for (const m of title.matchAll(NUMBER)) {
    const digits = m[1].replace(/,/g, '');
    if (!m[1].includes(',') && /^(?:1\d|20)\d\d$/.test(digits)) continue; // a year
    if (PLAIN_COUNT.test(m[2])) continue;
    score += ANIMAL.test(m[2]) ? 2 : 1;
    break;
  }
  if (TWIST.test(text)) score += 1;
  return score;
}

// The calendar day a story was published, in US Eastern time (most readers' "today").
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (ms) => DAY_FMT.format(new Date(ms));
// Newest day first; within a day the strangest first; then newest first.
const byDayThenWeird = (a, b) => (dayOf(b.published) < dayOf(a.published) ? -1 : dayOf(b.published) > dayOf(a.published) ? 1 : 0)
  || b.weirdness - a.weirdness || b.published - a.published;

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
  const stats = { listed: 0, fromDb: 0, shown: 0, expired: 0, held: 0, invalid: 0 };
  const out = [];
  for (const p of Array.isArray(picks) ? picks : []) {
    stats.listed++;
    if (p && p.fromDb) stats.fromDb++;
    const url = p && news.httpsUrl(p.url) ? cleanUrl(news.httpsUrl(p.url)) : null;
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
    out[out.length - 1].weirdness = weirdness(out[out.length - 1]);
  }
  out.sort((a, b) => b.published - a.published);
  for (const x of out) if (!x.category) x.category = categorise(x, x.src || { categoryHints: {} });
  stats.shown = out.length;
  return { items: out, stats };
}

// Picks from the reviewer database and from data/weird-picks.json. A database pick was published by a reviewer, so
// it counts as reviewed (seeded: false); on the same address the database's version wins.
function mergePicks(filePicks, dbPicks) {
  const db = (Array.isArray(dbPicks) ? dbPicks : []).filter((p) => p && typeof p.url === 'string')
    .map((p) => ({ ...p, seeded: false, fromDb: true }));
  const taken = new Set(db.map((p) => news.urlKey(p.url)));
  return [...db, ...(Array.isArray(filePicks) ? filePicks : []).filter((p) => p && !taken.has(news.urlKey(p.url)))];
}

/* ---------- One round: every feed, moderated, merged ---------- */

// All feeds in parallel (and the database's picks alongside), then for each story: the 14-day window, the source's
// own filter and exclusions, listicles (for outlets that run them), moderation, and the source's weirdness minimum.
// Then the picks merged in. Order: picks newest first; then regular outlets, newest day first and the strangest
// first within a day; then review outlets the same way. Repeats removed (same address or near-identical headline);
// at most `cap` feed stories per outlet (default perOutlet, perReviewOutlet for a review outlet; picks are on top);
// at most `pool` in all. A disabled source is still read, for ?debug=1 only: its stories are never used.
// Images are not read here: only for the items a request returns (see respond).
async function loadRound({
  fetchImpl = fetch, now = Date.now(), sources = SOURCES, picks = PICK_FILE.picks,
  dbPicks = () => loadDbPicks({ url: SUPABASE_URL, key: SUPABASE_KEY, fetchImpl }),
} = {}) {
  const [results, fromDb] = await Promise.all([
    Promise.all(sources.map((s) => readFeed(s, fetchImpl))),
    Promise.resolve(typeof dbPicks === 'function' ? dbPicks() : dbPicks).catch(() => []),
  ]);
  const held = {};
  const report = [];
  const regular = [], review = [];
  results.forEach((r, i) => {
    const src = sources[i];
    const row = {
      name: src.name, enabled: src.enabled, stale: src.stale, ok: r.ok, status: r.status, error: r.error, items: r.items.length,
      kept: 0, shown: 0, old: 0, filtered: 0, listicle: 0, held: 0, dull: 0, labels: {},
    };
    for (const raw of r.items) for (const c of raw.categories) row.labels[c] = (row.labels[c] || 0) + 1;
    row.labels = Object.fromEntries(Object.entries(row.labels).sort((x, y) => y[1] - x[1]).slice(0, 15));
    report.push(row);
    if (!src.enabled) return;
    for (const raw of r.items) {
      if (!(raw.published >= now - LIMITS.feedMaxAgeMs && raw.published <= now + LIMITS.skewMs)) { row.old++; continue; }
      const h = headline(raw.title);
      const item = {
        title: h.title, rawTitle: raw.title, url: cleanUrl(raw.url), published: raw.published, categories: raw.categories,
        outlet: src.name, outletUrl: src.home, src, image: src.images && raw.image ? raw.image.url : null,
        video: h.video, pick: false, rating: null, note: null,
      };
      if (!sourceAllows(item, src)) { row.filtered++; continue; }
      if (!src.listicles && isListicle(raw.title)) { row.listicle++; continue; }
      const verdict = moderate({ title: raw.title, url: raw.url, categories: raw.categories });
      if (!verdict.ok) { row.held++; held[verdict.rule] = (held[verdict.rule] || 0) + 1; continue; }
      item.weirdness = weirdness(item);
      if (item.weirdness < src.minWeirdness) { row.dull++; continue; }
      item.category = categorise(item, src);
      row.kept++;
      (src.review ? review : regular).push(item);
    }
  });

  const { items: pickList, stats: pickStats } = pickItems(mergePicks(picks, fromDb), sources, now, held);
  // A feed item for the same story as a pick lends the pick its picture and video label, then is dropped.
  const isSame = (a, b) => news.urlKey(a.url) === news.urlKey(b.url) || news.sameStory(a.rawTitle, b.rawTitle);
  const feedItems = [...regular.sort(byDayThenWeird), ...review.sort(byDayThenWeird)];
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
      const cap = x.src && x.src.cap ? x.src.cap : x.src && x.src.review ? LIMITS.perReviewOutlet : LIMITS.perOutlet;
      if (n >= cap) continue;
      perCount.set(x.outlet, n + 1);
    }
    kept.push(x);
    if (kept.length >= LIMITS.pool) break;
  }
  for (const row of report) row.shown = perCount.get(row.name) || 0;
  return {
    pool: kept, held, report, picks: pickStats, checkedAt: new Date(now).toISOString(),
    anyOk: results.some((r, i) => r.ok && sources[i].enabled), sources,
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
      ...(debug ? { weirdness: x.weirdness } : {}),
    };
  });
  const out = {
    items, categories, checkedAt: round.checkedAt,
    sources: round.report.filter((r) => r.enabled).map((r) => ({ name: r.name, ok: r.ok, count: items.filter((x) => x.outlet === r.name).length })),
  };
  if (debug) {
    out.held = Object.fromEntries(Object.keys(RULES).concat('H0').filter((k) => round.held[k]).map((k) => [k, round.held[k]]));
    out.debug = {
      rules: RULES,
      sources: round.report,
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
  normaliseSource, readFeed, weirdness, isListicle, cleanUrl, mergePicks, dayOf, SOURCES, CATEGORIES, LIMITS, CACHE_CONTROL, DEBUG_CACHE_CONTROL,
};
