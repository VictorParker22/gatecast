// The editor's picks, week by week, and as a feed: /weekly/ (every week with picks, newest first),
// /weekly/<YYYY>-W<ww>/ (one ISO week's picks, with the previous and next week) and /feed.xml (RSS 2.0, the latest
// FEED_SIZE picks). Plain, crawlable HTML and XML, rendered on request from the published picks.
//
// Why on request, not at build time: picks are published in the reviewer console without a deploy, so a page written
// by the build would be stale until the next one. Vercel Hobby is at its 12-function limit, so these routes are served
// by the existing /api/weird function (?view=weekly|feed, reached through rewrites in vercel.json) and cached at the
// edge like /api/weird itself (CACHE_CONTROL: five minutes, then five more served stale while it refreshes), so a new
// pick shows within about ten minutes and the database is read at most a few times an hour. server.js serves the
// same routes locally.
//
// What is shown (docs/content-sources.md): the outlet's own headline, its name and date, a link to the original and
// to the story on Gatecast (/?story=<id>, the same id /api/weird gives), and only the editor's own words: the hook
// (note) and the summary ("In our words"), each written or approved by the editor in the console. No outlet text,
// no outlet pictures (they would be indexed against Gatecast's address), nothing else written for the page.
//
// Weeks: a pick belongs to the ISO week (Monday to Sunday) in which the editor published it (weird_picks.published_at,
// read with the publishable key like lib/picks-db.js), as a calendar day in US Eastern time like the front page's days.
// A pick without that time (data/weird-picks.json) falls back to the outlet's date.
const crypto = require('node:crypto');
const news = require('./news.js');
const weird = require('./weird.js');
const { moderate } = require('./moderation.js');
const picksDb = require('./picks-db.js');
const PICK_FILE = require('../data/weird-picks.json');
const SITE_CONFIG = require('../data/site.json');

const SITE = require('./site.js').SITE_ORIGIN; // the site's address, written once (also read by scripts/build-stacks-pages.cjs)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfdwmzuedjcsaxgzhzmu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_a2KiR862D8VC63YjqFIYSQ_U5YnwpMJ';
const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const FEED_SIZE = 30;
// A week page asks to be indexed only when it has this many picks with the editor's own words (a hook or a summary);
// a thinner week is still published, with noindex, follow (as The Stacks does for a book without the editor's take).
const INDEX_MIN = 5;
const DB_LIMIT = 1000;
const TIMEOUT_MS = 5000;
const DAY = 24 * 3600e3;
const FRONT_PAGE_DAYS = Number(PICK_FILE.maxAgeDays) || 21; // how long lib/weird.js keeps a pick on the front page

const TYPES = { html: 'text/html; charset=utf-8', rss: 'application/rss+xml; charset=utf-8' };

/* ---------- ISO weeks ---------- */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcOf = (ymd) => { const m = YMD.exec(ymd); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// 'YYYY-MM-DD' -> { year, week } (ISO 8601: weeks start on Monday; week 1 holds the year's first Thursday).
function isoWeek(ymd) {
  const t = utcOf(ymd);
  if (!Number.isFinite(t)) return null;
  const dow = new Date(t).getUTCDay() || 7;
  const thursday = t + (4 - dow) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  return { year, week: Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1 };
}
const weeksInYear = (year) => isoWeek(`${year}-12-28`).week;
const weekKey = ({ year, week }) => `${year}-W${String(week).padStart(2, '0')}`;
// '2026-W47' -> { year, week }, or null for anything else (including a week the year does not have).
function parseWeek(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const year = +m[1], week = +m[2];
  return year >= 2000 && week >= 1 && week <= weeksInYear(year) ? { year, week } : null;
}
// The Monday and Sunday of an ISO week, as 'YYYY-MM-DD'.
function weekRange({ year, week }) {
  const jan4 = Date.UTC(year, 0, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() || 7) - 1) * DAY + (week - 1) * 7 * DAY;
  return { start: ymdOf(monday), end: ymdOf(monday + 6 * DAY) };
}

/* ---------- Picks ---------- */

// The same story id as /api/weird (lib/weird.js idOf): from the cleaned, normalised story address.
const storyId = (url) => crypto.createHash('sha1').update(news.urlKey(url)).digest('hex').slice(0, 12);
const storyHref = (id) => `${SITE}/?story=${id}`;

// One pick (from the database or data/weird-picks.json) -> what the pages show, or null when it lacks a link, a
// headline, an outlet or any date, or when the moderation rules would keep it off the front page (a database pick
// was published by a reviewer: drop rules only; a file pick gets every rule, as in lib/weird.js).
function cleanPick(p) {
  if (!p || typeof p !== 'object') return null;
  const safe = news.httpsUrl(p.url);
  const url = safe ? weird.cleanUrl(safe) : null;
  const raw = typeof p.title === 'string' ? news.plainText(p.title) : '';
  const outlet = typeof p.outlet === 'string' ? news.plainText(p.outlet).slice(0, 120) : '';
  if (!url || !raw || !outlet) return null;
  const published = typeof p.published === 'string' && YMD.test(p.published) && Number.isFinite(utcOf(p.published)) ? p.published : null;
  const pickedMs = typeof p.pickedAt === 'string' ? Date.parse(p.pickedAt) : NaN;
  const pickedAt = Number.isFinite(pickedMs) ? pickedMs : null;
  const day = pickedAt !== null ? weird.dayOf(pickedAt) : published;
  if (!day) return null;
  if (!moderate({ title: raw, url }, { holds: p.seeded !== false }).ok) return null;
  const words = (v, max) => (typeof v === 'string' && v.trim() ? news.plainText(v).slice(0, max) : null);
  return {
    id: storyId(url), url, title: weird.headline(raw).title, outlet, published, pickedAt, day,
    time: pickedAt ?? weird.pickTime(published),
    category: weird.CATEGORIES.includes(p.category) ? p.category : 'other',
    rating: Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5 ? p.rating : null,
    note: words(p.note, 200), summary: words(p.summary, 700),
  };
}

// Picks -> weeks, newest week first; within a week, the newest pick first. Each story once.
function groupWeeks(picks) {
  const byKey = new Map();
  const seen = new Set();
  for (const p of [...picks].sort((a, b) => b.time - a.time)) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    const w = isoWeek(p.day);
    const key = weekKey(w);
    if (!byKey.has(key)) byKey.set(key, { key, ...w, ...weekRange(w), picks: [] });
    byKey.get(key).picks.push(p);
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/* ---------- Reading the picks ---------- */

// The published picks with the time the editor published each one. Columns as lib/picks-db.js reads them, plus
// published_at (granted to the publishable key since the first community migration); summary falls away until its
// migration is applied, as in picks-db. Never throws: { ok: false } on any failure, so a page can say so instead of
// claiming there are no picks.
const BASE_COLUMNS = 'url,title,outlet,published,category,rating,note,published_at';
const COLUMN_SETS = [`${BASE_COLUMNS},summary`, BASE_COLUMNS];
const missingColumn = (status, body) => (status === 400 && body?.code === '42703') || ((status === 401 || status === 403) && body?.code === '42501') || body?.code === 'PGRST204';
const endpoint = (base, columns) => `${String(base).replace(/\/+$/, '')}/rest/v1/weird_picks?select=${columns}&status=eq.published&order=published_at.desc.nullslast&limit=${DB_LIMIT}`;

async function loadPicks({ url = SUPABASE_URL, key = SUPABASE_KEY, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof key !== 'string' || !key || typeof fetchImpl !== 'function') return { ok: false, picks: [] };
  const ctrl = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve({ ok: false, picks: [] }); }, timeoutMs); });
  const work = (async () => {
    try {
      let res;
      for (const columns of COLUMN_SETS) {
        res = await fetchImpl(endpoint(url, columns), { headers: { apikey: key, Accept: 'application/json' }, signal: ctrl.signal });
        if (!res || res.ok) break;
        if (!missingColumn(res.status, await res.json().catch(() => null))) return { ok: false, picks: [] };
      }
      if (!res || !res.ok) return { ok: false, picks: [] };
      const rows = await res.json();
      if (!Array.isArray(rows)) return { ok: false, picks: [] };
      const picks = [];
      for (const row of rows) {
        const p = picksDb.toPick(row);
        if (p) picks.push({ ...p, pickedAt: typeof row.published_at === 'string' ? row.published_at : null });
      }
      return { ok: true, picks };
    } catch {
      return { ok: false, picks: [] };
    }
  })();
  try { return await Promise.race([work, deadline]); } finally { clearTimeout(timer); }
}

// Every pick, cleaned, newest first, and the weeks they make. The database's version of a story wins over the file's
// (lib/weird.js mergePicks). Kept in memory for 4 minutes (30 seconds after a failure) so one warm function serves
// many requests with one read.
async function archive({ fetchImpl, filePicks = PICK_FILE.picks, dbPicks } = {}) {
  const db = dbPicks !== undefined ? { ok: true, picks: dbPicks } : await loadPicks({ fetchImpl });
  const merged = weird.mergePicks(filePicks, db.picks);
  const picks = merged.map(cleanPick).filter(Boolean).sort((a, b) => b.time - a.time);
  return { ok: db.ok, picks, weeks: groupWeeks(picks) };
}
let cached = null; // { at, ttl, promise }
function cachedArchive() {
  const now = Date.now();
  if (cached && now - cached.at < cached.ttl) return cached.promise;
  const entry = { at: now, ttl: 30e3 };
  entry.promise = archive().then((a) => { entry.ttl = a.ok ? 4 * 60e3 : 30e3; return a; }, (err) => { entry.ttl = 0; throw err; });
  cached = entry;
  return entry.promise;
}

/* ---------- Words ---------- */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Characters XML 1.0 does not allow at all (a stray control character would make the whole feed unreadable).
const xmlText = (s) => esc(String(s ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, ''));

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const dayMonth = (ymd) => { const t = utcOf(ymd); return `${new Date(t).getUTCDate()} ${MONTH.format(t)}`; };
const longDay = (ymd) => `${dayMonth(ymd)} ${ymd.slice(0, 4)}`;
// '16 to 22 November 2026', '30 November to 6 December 2026', '29 December 2025 to 4 January 2026'.
function rangeLabel({ start, end }) {
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${longDay(start)} to ${longDay(end)}`;
  if (start.slice(0, 7) !== end.slice(0, 7)) return `${dayMonth(start)} to ${longDay(end)}`;
  return `${new Date(utcOf(start)).getUTCDate()} to ${longDay(end)}`;
}
const weekLabel = (w) => `Week ${w.week}, ${w.year}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hasWords = (p) => Boolean(p.note || p.summary);

/* ---------- Pages ---------- */

const NAV = [
  ['/', 'Front page', '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4"/>'],
  ['/library.html', 'Library', '<path d="M4 20V5h4v15M10 20V3h4v17M16 20l2.5-14 3.5.7L19.5 20M3 20h19"/>'],
  ['/trip.html', 'Trips', '<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M9 7V4h6v3M3 12h18"/>'],
  ['/flights.html', 'Flights', '<path d="M2.5 13.5l19-7-4 13-5-4.5-3 3.5v-5l12-7"/>'],
];
const OG_IMAGE = SITE + '/vendor/og/gatecast-og.png';
const OG_ALT = 'Gatecast: weird news from real outlets, the weather on top, and a library of strange true stories.';
const FEED_TITLE = 'Gatecast: the editor’s weird-news picks';
const ldJson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function shell({ title, description, path, body, ld = [], noindex = false }) {
  const url = SITE + path;
  const nav = NAV.map(([href, label, icon]) => `<li><a href="${href}"><svg class="site-nav__icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></a></li>`).join('\n        ');
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
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F3EEE2">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1B1813">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Gatecast">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
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
  ${ld.map(ldJson).join('\n  ')}
  <link rel="alternate" type="application/rss+xml" title="${esc(FEED_TITLE)}" href="/feed.xml">
</head>
<body>
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

  <main id="main" class="frame grid gap-8 pt-4 pb-12">
${body}
  </main>

  <footer class="site-footer">
    <p>Headlines belong to the outlets named beside them; every story links to its original, and we copy none of their reporting. Words under a headline are our editor’s own. <a href="/weekly/">Weird news, week by week</a>. <a href="/feed.xml">RSS feed</a>. <a href="/stacks/">The Stacks, as a list</a>. <a href="/how.html">How Gatecast works</a>.</p>
  </footer>
  <script type="module" src="/js/analytics.js"></script>
</body>
</html>
`;
}

function crumbs(trail) {
  const items = [{ name: 'Gatecast', path: '/' }, { name: 'Weekly', path: '/weekly/' }, ...trail];
  const html = `    <nav aria-label="Breadcrumb" class="text-sm">
      <ol class="flex flex-wrap items-center gap-x-2 text-np-muted">
        ${items.map((c, i) => (i === items.length - 1 ? `<li><span class="inline-flex min-h-tap items-center" aria-current="page">${esc(c.name)}</span></li>` : `<li><a class="inline-flex min-h-tap items-center" href="${c.path}">${esc(c.name)}</a> <span aria-hidden="true">›</span></li>`)).join('\n        ')}
      </ol>
    </nav>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.path })),
  };
  return { html, ld };
}

const weekPath = (w) => `/weekly/${w.key}/`;
// The story on Gatecast (story mode) only while it is still on the front page: /?story=<id> for an older pick would
// only say that it has left. The original is always linked.
const onFrontPage = (p, now) => {
  const t = weird.pickTime(p.published);
  return Number.isFinite(t) && t >= now - FRONT_PAGE_DAYS * DAY && t <= now + DAY;
};

function pickItem(p, { now, catLabel }) {
  const date = p.published ? `, ${longDay(p.published)}` : '';
  const links = [`<a class="inline-flex min-h-tap items-center font-semibold" href="${esc(p.url)}" rel="noopener">Read it at ${esc(p.outlet)}</a>`];
  if (onFrontPage(p, now)) links.push(`<a class="inline-flex min-h-tap items-center" href="/?story=${esc(p.id)}">Open it on Gatecast</a>`);
  return `      <li>
        <article class="doc-card gap-3 border-2 border-np-ink" aria-labelledby="pick-${esc(p.id)}">
          <p class="signage text-sm text-np-muted">${esc(catLabel(p.category))}</p>
          <h2 id="pick-${esc(p.id)}" class="text-xl/tight"><a href="${esc(p.url)}" rel="noopener">${esc(p.title)}</a></h2>
          <p class="text-sm text-np-muted">${esc(p.outlet)}${esc(date)}</p>${p.note ? `
          <p class="max-w-read font-semibold">${esc(p.note)}</p>` : ''}${p.summary ? `
          <div class="grid max-w-read gap-1 border-l-3 border-np-cobalt pl-3">
            <p class="signage text-xs text-np-muted">In our words</p>
            <p>${esc(p.summary)}</p>
          </div>` : ''}${p.rating ? `
          <p class="text-sm text-np-muted">Editor’s weird rating: ${p.rating} of 5</p>` : ''}
          <p class="flex flex-wrap gap-x-6">${links.join('')}</p>
        </article>
      </li>`;
}

const feedLine = () => `    <p class="text-sm text-np-muted">Follow the picks in a feed reader: <a href="/feed.xml">RSS feed</a>.</p>`;
const signup = (config, newsletterHTML, id) => {
  const form = newsletterHTML(config, { id });
  return form ? `    <section class="border-t border-line pt-6" aria-label="Newsletter">
${form}
    </section>` : '';
};

function weekPage(week, { prev = null, next = null, now = Date.now(), config = SITE_CONFIG, catLabel, signupHTML }) {
  const label = rangeLabel(week);
  const current = weekKey(isoWeek(weird.dayOf(now))) === week.key;
  const trail = crumbs([{ name: weekLabel(week), path: weekPath(week) }]);
  const n = week.picks.length;
  const title = `Weird news of the week, ${label} — Gatecast`;
  const description = `Our editor’s weird-news picks for ${label}: ${plural(n, 'story', 'stories')} from real outlets, each with the outlet’s own headline and a link to the original.`;
  const other = (w, rel, arrow) => (w ? `<a class="btn" rel="${rel}" href="${weekPath(w)}">${rel === 'prev' ? `${arrow} ` : ''}${esc(rangeLabel(w))}${rel === 'next' ? ` ${arrow}` : ''}</a>` : '');
  const body = `${trail.html}

    <section class="hero hero--compact pb-0" aria-labelledby="week-title">
      <p class="signage mb-2 text-sm text-np-muted">The editor’s picks · ${esc(weekLabel(week))}</p>
      <h1 id="week-title" class="hero__title">Weird news of the week, ${esc(label)}</h1>
      <p class="hero__lede max-w-measure">${esc(plural(n, 'story', 'stories'))} from real outlets, picked by our editor${current ? ' so far this week' : ''}. Each headline is the outlet’s own and links to the original. Any words under it are the editor’s, written or approved by a person (<a href="/how.html#weird">how picks are written</a>).</p>
    </section>

    <ol class="grid gap-4" aria-label="Picks">
${week.picks.map((p) => pickItem(p, { now, catLabel })).join('\n')}
    </ol>

    <nav class="flex flex-wrap items-center gap-3" aria-label="Other weeks">
      ${[other(prev, 'prev', '←'), '<a class="btn" href="/weekly/">All weeks</a>', other(next, 'next', '→')].filter(Boolean).join('\n      ')}
    </nav>
${signup(config, signupHTML, 'newsletter-week')}
${feedLine()}`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `Weird news of the week, ${label}`, description, url: SITE + weekPath(week), inLanguage: 'en-GB',
    isPartOf: { '@type': 'WebSite', name: 'Gatecast', url: SITE + '/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: n, itemListElement: week.picks.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: p.url, name: p.title })) },
  };
  const indexable = week.picks.filter(hasWords).length >= INDEX_MIN;
  return shell({ title, description, path: weekPath(week), body, ld: [ld, trail.ld], noindex: !indexable });
}

function indexPage(weeks, { now = Date.now(), config = SITE_CONFIG, ok = true, signupHTML }) {
  const trail = crumbs([]);
  const thisWeek = weekKey(isoWeek(weird.dayOf(now)));
  const list = weeks.length ? `    <ol class="grid gap-4" aria-label="Weeks, newest first">
${weeks.map((w) => {
    const shown = w.picks.slice(0, 3);
    const more = w.picks.length - shown.length;
    return `      <li class="doc-card border-2 border-np-ink">
        <h2 class="text-xl/tight"><a href="${weekPath(w)}">${esc(rangeLabel(w))}</a></h2>
        <p class="signage text-sm text-np-muted">${esc(weekLabel(w))} · ${esc(plural(w.picks.length, 'pick', 'picks'))}${w.key === thisWeek ? ' · this week so far' : ''}</p>
        <ul class="grid gap-1 pl-4 text-sm list-[square]">
          ${shown.map((p) => `<li>${esc(p.title)} <span class="text-np-muted">(${esc(p.outlet)})</span></li>`).join('\n          ')}${more > 0 ? `\n          <li class="list-none text-np-muted">and ${more} more</li>` : ''}
        </ul>
      </li>`;
  }).join('\n')}
    </ol>` : `    <p class="max-w-read">${ok ? 'No picks yet. The first week appears here as soon as our editor publishes a pick.' : 'The picks could not be loaded just now. Please try again in a minute.'}</p>`;
  const body = `${trail.html}

    <section class="hero hero--compact pb-0" aria-labelledby="weekly-title">
      <p class="signage mb-2 text-sm text-np-muted">The editor’s picks</p>
      <h1 id="weekly-title" class="hero__title">Weird news, week by week</h1>
      <p class="hero__lede max-w-measure">Every story our editor has picked, grouped by the week it was picked, newest first. Each one is the outlet’s own headline with a link to the original; the only words we add are the editor’s.</p>
    </section>

${list}
${signup(config, signupHTML, 'newsletter-weekly')}
${feedLine()}`;
  const description = 'Weird news from real outlets, picked by Gatecast’s editor and grouped by week, newest first: the outlet’s own headline and a link to every original.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'Weird news, week by week', description, url: SITE + '/weekly/', inLanguage: 'en-GB',
    isPartOf: { '@type': 'WebSite', name: 'Gatecast', url: SITE + '/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: weeks.length, itemListElement: weeks.map((w, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + weekPath(w), name: `Weird news of the week, ${rangeLabel(w)}` })) },
  };
  return shell({ title: 'Weird news, week by week — the editor’s picks · Gatecast', description, path: '/weekly/', body, ld: [ld, trail.ld] });
}

function messagePage({ title, heading, text, path }) {
  const body = `${crumbs([]).html}

    <section class="hero hero--compact pb-0" aria-labelledby="msg-title">
      <h1 id="msg-title" class="hero__title">${esc(heading)}</h1>
      <p class="hero__lede max-w-measure">${esc(text)}</p>
    </section>
    <p><a class="btn" href="/weekly/">All weeks</a></p>`;
  return shell({ title, description: text, path, body, noindex: true });
}

/* ---------- The feed ---------- */

const rfc822 = (ms) => new Date(ms).toUTCString().replace('GMT', '+0000');

// RSS 2.0: the latest FEED_SIZE picks, newest first by the time the editor published them. Each item: the outlet's
// headline, the story on Gatecast (/?story=<id>), a guid that stays the same for the story, and a description with
// only the editor's words and a link to the original.
function feedXml(picks, { catLabel, now = Date.now() } = {}) {
  const items = picks.slice(0, FEED_SIZE);
  const built = items.length ? items[0].time : now;
  const item = (p) => {
    const html = [
      p.note ? `<p>${esc(p.note)}</p>` : '',
      p.summary ? `<p><strong>In our words:</strong> ${esc(p.summary)}</p>` : '',
      `<p>From ${esc(p.outlet)}${p.published ? `, ${esc(longDay(p.published))}` : ''}. <a href="${esc(p.url)}">Read the original at ${esc(p.outlet)}</a>.</p>`,
    ].join('');
    return `    <item>
      <title>${xmlText(p.title)}</title>
      <link>${xmlText(storyHref(p.id))}</link>
      <guid isPermaLink="false">gatecast-pick-${xmlText(p.id)}</guid>
      <pubDate>${rfc822(p.time)}</pubDate>
      <category>${xmlText(catLabel(p.category))}</category>
      <description>${xmlText(html)}</description>
    </item>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlText(FEED_TITLE)}</title>
    <link>${SITE}/weekly/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Weird news from real outlets, picked by Gatecast’s editor. Each item links to the story on Gatecast and to the original at the outlet; the only words in it are the editor’s own.</description>
    <language>en-gb</language>
    <lastBuildDate>${rfc822(built)}</lastBuildDate>
    <docs>https://www.rssboard.org/rss-specification</docs>
${items.map(item).join('\n')}
  </channel>
</rss>
`;
}

/* ---------- Routes ---------- */

const VIEWS = ['weekly', 'feed'];
const isView = (v) => VIEWS.includes(v);

// The public addresses -> the query the function gets (the same mapping as the rewrites in vercel.json), or null.
function routeQuery(pathname) {
  if (pathname === '/feed.xml' || pathname === '/weekly/feed.xml') return new URLSearchParams({ view: 'feed' });
  if (pathname === '/weekly/') return new URLSearchParams({ view: 'weekly' });
  const m = /^\/weekly\/(\d{4}-W\d{2})\/$/.exec(pathname);
  return m ? new URLSearchParams({ view: 'weekly', week: m[1] }) : null;
}
// The addresses that only lack their trailing slash (redirected, as for /stacks/).
const needsSlash = (pathname) => pathname === '/weekly' || /^\/weekly\/\d{4}-W\d{2}$/.test(pathname);

let modules = null; // the browser's own modules, for the category names and the signup form
const browserModules = () => (modules ||= Promise.all([import('../js/frontmodel.js'), import('../js/newsletter.js')])
  .then(([fm, nl]) => ({ catLabel: fm.catLabel, signupHTML: nl.signupHTML })));

// One request -> { status, type, cacheControl, body }, or null when the query is not one of these views.
// opts (tests): fetchImpl, dbPicks, filePicks, now, config; any of them bypasses the in-memory cache.
async function render(q, opts = {}) {
  const get = (k) => (q && typeof q.get === 'function' ? q.get(k) : q && q[k]);
  const view = get('view');
  if (!isView(view)) return null;
  const now = opts.now ?? Date.now();
  const config = opts.config ?? SITE_CONFIG;
  const { catLabel, signupHTML } = await browserModules();
  const fresh = ['fetchImpl', 'dbPicks', 'filePicks'].some((k) => k in opts);
  const data = fresh ? await archive(opts) : await cachedArchive();
  const html = (status, body, cacheControl = status === 200 ? CACHE_CONTROL : ERROR_CACHE_CONTROL) => ({ status, type: TYPES.html, cacheControl, body });

  if (view === 'feed') {
    if (!data.ok && !data.picks.length) return { status: 503, type: 'text/plain; charset=utf-8', cacheControl: ERROR_CACHE_CONTROL, body: 'The picks could not be loaded just now.\n' };
    return { status: 200, type: TYPES.rss, cacheControl: CACHE_CONTROL, body: feedXml(data.picks, { catLabel, now }) };
  }
  const key = get('week');
  if (key === null || key === undefined || key === '') {
    if (!data.ok && !data.weeks.length) return html(503, indexPage([], { now, config, ok: false, signupHTML }));
    return html(200, indexPage(data.weeks, { now, config, signupHTML }));
  }
  const w = parseWeek(key);
  const i = w ? data.weeks.findIndex((x) => x.key === weekKey(w)) : -1;
  if (i < 0) {
    if (!data.ok) return html(503, messagePage({ title: 'The picks could not be loaded — Gatecast', heading: 'The picks could not be loaded', text: 'Please try again in a minute.', path: '/weekly/' }));
    // A 404 is cached briefly at the edge, so a week that gets its first pick shows within minutes.
    return html(404, messagePage({ title: 'No picks that week — Gatecast', heading: 'No picks that week', text: 'Our editor did not publish any picks in that week, or the address is not a week. Every week with picks is listed on the weekly page.', path: '/weekly/' }), 'public, max-age=0, s-maxage=60');
  }
  // weeks run newest first: the previous (older) week is the next one in the list.
  return html(200, weekPage(data.weeks[i], { prev: data.weeks[i + 1] || null, next: data.weeks[i - 1] || null, now, config, catLabel, signupHTML }));
}

module.exports = {
  render, routeQuery, needsSlash, isView, archive, loadPicks, cleanPick, groupWeeks, feedXml, isoWeek, weekKey, parseWeek,
  weekRange, weeksInYear, rangeLabel, storyId, xmlText, endpoint, CACHE_CONTROL, ERROR_CACHE_CONTROL, FEED_SIZE, INDEX_MIN, SITE, TYPES,
};
