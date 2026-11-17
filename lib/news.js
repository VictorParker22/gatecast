// Headlines for the Today page's "The brief": the outlets in data/news-sources.json, read from their public
// RSS or Atom feeds. Shared by server.js (local) and api/news.js (Vercel function). No dependencies.
// We keep only what a link needs: the outlet's own headline, its name, the time and the story's address, plus
// the preview image the publisher offers for links to the story (owner decision, 16 Nov 2026). Descriptions,
// opening paragraphs and article text are never read, so they can never be shown. The image is only an
// address: the visitor's browser loads it from the publisher (hotlinked, credited, never stored or proxied).
// For the weird news (lib/weird.js) an article page can also give the YouTube video it embeds (pageMedia): only the
// player's address is read, and the video is checked with YouTube (lib/youtube.js) before it is served.
const dns = require('node:dns');
const yt = require('./youtube.js');
const SOURCES = require('../data/news-sources.json').sources;

const DAY = 24 * 3600e3;
const LIMITS = { maxAgeMs: 7 * DAY, perOutlet: 3, total: 8, skewMs: 3600e3 };
const FEED_TIMEOUT_MS = 6000;
const MAX_FEED_BYTES = 4e6;
const PAGE_TIMEOUT_MS = 4000;      // an article page read for its og:image
const MAX_HEAD_BYTES = 256 * 1024; // ...and only up to </head>, at most this much
const MAX_REDIRECTS = 3;
const MIN_IMAGE_SIDE = 80;         // a declared width or height below this is a pixel or an icon, not a photo

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

// RSS 2.0 or Atom -> [{ title, url, published (ms), image }]. Items without an https link, a title or a date
// are dropped; image is the publisher's preview image ({ url, width?, height? }) or null.
function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = text.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const full of blocks) {
    // The outlet's own words beyond the headline are never read: drop them before looking for anything.
    // Media and enclosure tags stay, but only their attributes (an image address and its size) are read.
    const block = full.replace(TEXT_ELEMENTS, '');
    const rest = block.replace(/<\/?(?:media:[\w-]+|enclosure)\b[^>]*>/gi, '');
    const title = plainText(element(rest, 'title'));
    const url = linkOf(rest);
    const published = dateOf(rest);
    if (!title || !url || !Number.isFinite(published)) continue;
    out.push({ title: title.length > 240 ? title.slice(0, 239).trimEnd() + '…' : title, url, published, image: feedImage(block, url) });
  }
  return out;
}
// Elements whose content is the outlet's writing (or a caption, a credit line, podcast notes).
const TEXT_ELEMENTS = /<(description|summary|content(?::encoded)?|media:(?:description|title|text|keywords|credit|copyright|comments|subtitle|embed|player)|itunes:[\w-]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/gi;

/* ---------- Preview images ---------- */

const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif)$/i;
const TRACKER_PATH = /(?:^|[/_.-])(?:pixel|spacer|blank|clear|1x1|transparent)\.(?:gif|png)$/i;
const dim = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= 20000 ? n : 0;
};

// The address of a preview image, or null: https only, no credentials, the default port, a named public host
// (never an address literal or a local name, which would point visitors' browsers at their own network).
function imageUrl(raw, base) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  let u;
  try { u = new URL(s, base || undefined); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  if (!publicName(u.hostname)) return null;
  return u.href;
}

// A candidate from a feed tag or a page's meta tags -> { url, width?, height? } or null. Rejected: anything
// whose declared type is not an image, SVGs, tracking pixels and other tiny declared sizes. needsHint: the tag
// may carry other media (media:content, Atom enclosure links), so it must say image by type, medium or name.
function previewImage(c, base) {
  if (!c || !c.url) return null;
  const type = String(c.type || '').trim().toLowerCase();
  const medium = String(c.medium || '').trim().toLowerCase();
  if (type && (!type.startsWith('image/') || type.includes('svg'))) return null;
  if (medium && medium !== 'image') return null;
  const url = imageUrl(c.url, base);
  if (!url) return null;
  const path = new URL(url).pathname;
  if (/\.svgz?$/i.test(path) || TRACKER_PATH.test(path)) return null;
  if (c.needsHint && !type && !medium && !IMAGE_PATH.test(path)) return null;
  if (c.needsType && !type) return null;
  const width = dim(c.width), height = dim(c.height);
  if ((width && width < MIN_IMAGE_SIDE) || (height && height < MIN_IMAGE_SIDE)) return null;
  return width && height ? { url, width, height } : { url };
}

const tagAttrs = (block, re) => [...block.matchAll(re)].map((m) => attrs(m[1]));
// The image a feed item offers for previews: its media:content image, an image enclosure, an Atom enclosure
// link, then its media:thumbnail; the first acceptable one in that order. Relative addresses resolve against
// the story's own address (base).
function feedImage(block, base) {
  const found = [
    ...tagAttrs(block, /<media:content\b([^>]*)>/gi).map((a) => ({ url: a.url, type: a.type, medium: a.medium, width: a.width, height: a.height, needsHint: true })),
    ...tagAttrs(block, /<enclosure\b([^>]*)>/gi).map((a) => ({ url: a.url, type: a.type, needsType: true })),
    ...tagAttrs(block, /<link\b([^>]*)>/gi).filter((a) => String(a.rel || '').toLowerCase() === 'enclosure')
      .map((a) => ({ url: a.href, type: a.type, needsHint: true })),
    ...tagAttrs(block, /<media:thumbnail\b([^>]*)>/gi).map((a) => ({ url: a.url, width: a.width, height: a.height })),
  ];
  for (const c of found) {
    const got = previewImage(c, base);
    if (!got) continue;
    // The size, when this tag does not give it, from another tag for the same picture (a thumbnail often has it).
    if (!got.width) {
      const twin = found.find((o) => o !== c && o.url === c.url && dim(o.width) >= MIN_IMAGE_SIDE && dim(o.height) >= MIN_IMAGE_SIDE);
      if (twin) return { ...got, width: dim(twin.width), height: dim(twin.height) };
    }
    return got;
  }
  return null;
}

// og:image (or og:image:url / og:image:secure_url), then twitter:image, from a page's <head>. Relative
// addresses resolve against the page's own address. Only meta tags are read: never the page's text or body.
const PAGE_KEYS = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];
function headImage(html, pageUrl) {
  const head = String(html || '').split(/<\/head\s*>/i)[0]
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const metas = tagAttrs(head, /<meta\b([^>]*)>/gi).map((a) => ({ key: String(a.property || a.name || '').trim().toLowerCase(), value: a.content }));
  const first = (k) => metas.find((m) => m.key === k)?.value;
  for (const key of PAGE_KEYS) {
    const og = key.startsWith('og:');
    for (const m of metas) {
      if (m.key !== key) continue;
      const got = previewImage({ url: m.value, type: og ? first('og:image:type') : undefined, width: first(og ? 'og:image:width' : 'twitter:image:width'), height: first(og ? 'og:image:height' : 'twitter:image:height') }, pageUrl);
      if (got) return got;
    }
  }
  return null;
}

/* ---------- Article pages: SSRF care ---------- */

function v4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((n) => n > 255) ? null : ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
const V4_BLOCKED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]
  .map(([b, bits]) => [v4(b), bits]);
const v4Private = (n) => V4_BLOCKED.some(([b, bits]) => n >>> (32 - bits) === b >>> (32 - bits));
// Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges, for IPv4 and
// IPv6 (including IPv6 forms that wrap an IPv4 address). Anything unparseable counts as private.
function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const n = v4(s);
  if (n !== null) return v4Private(n);
  // An IPv4 address written inside IPv6: only the plain mapped form (::ffff:a.b.c.d) of a public one passes.
  const tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) return !(s.slice(0, -tail[1].length) === '::ffff:' && v4(tail[1]) !== null && !v4Private(v4(tail[1])));
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) || []).length > 1) return true;
  const [l, r = ''] = s.split('::');
  const L = l ? l.split(':') : [], R = r ? r.split(':') : [];
  const g = [...L, ...Array(Math.max(0, 8 - L.length - R.length)).fill('0'), ...R].map((x) => parseInt(x, 16));
  if (g.length !== 8 || g.some((x) => !(x >= 0 && x <= 0xffff))) return true;
  if (g.slice(0, 7).every((x) => x === 0)) return true; // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Private(((g[6] << 16) >>> 0) + g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  if (g[0] === 0x2002) return v4Private(((g[1] << 16) >>> 0) + g[2]);
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8 || (g[1] & 0xffe0) === 0x10)) return true;
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00 || g[0] === 0x100;
}
// A host name that can only be on the public internet by its shape: dotted, not an address, not a local name.
function publicName(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h.includes(':') || h.startsWith('[') || v4(h) !== null || /^[\d.]+$/.test(h) || /^0x/i.test(h)) return false;
  return h.includes('.') && !/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|invalid|test|example)$/.test(h);
}
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
// An article page we may read: https, the default port, and on the outlet's own site (its homepage's or its
// feed's domain, or a subdomain of one). A feed can therefore never send the server anywhere else.
function pageAllowed(raw, src) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !publicName(u.hostname)) return false;
  const host = u.hostname.toLowerCase();
  const own = [src.homepage, src.feed].map((x) => { try { return bare(new URL(x).hostname); } catch { return null; } }).filter(Boolean);
  return own.some((d) => host === d || host.endsWith('.' + d));
}
// Every address the name resolves to must be public. Behind an outbound proxy (NODE_USE_ENV_PROXY with
// HTTPS_PROXY set) names are resolved by the proxy and the local resolver may know nothing: there the shape and
// own-site checks above are what apply. Anywhere else a failed lookup blocks the page.
const PROXIED = Boolean(process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy));
async function resolvesPublic(host, lookupImpl) {
  try {
    const list = await lookupImpl(host, { all: true });
    return Array.isArray(list) && list.length > 0 && list.every((a) => !isPrivateAddress(a.address));
  } catch { return PROXIED; }
}

// The first part of a page, at most MAX_HEAD_BYTES: up to </head> (whole: false), or on past it to the cap
// (whole: true, when looking for an embedded video). The rest is never downloaded.
async function readHead(res, { whole = false } = {}) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) return String(await res.text()).slice(0, MAX_HEAD_BYTES);
  const decoder = new TextDecoder('utf-8');
  let html = '', bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (bytes >= MAX_HEAD_BYTES || (!whole && /<\/head\s*>/i.test(html.slice(-value.length - 8)))) break;
    }
  } finally { reader.cancel().catch(() => {}); }
  return html.slice(0, MAX_HEAD_BYTES);
}

// One article page on the outlet's own site: the HTML read by readHead and the address it was read from (after at
// most MAX_REDIRECTS redirects, each checked again), or null on any failure. Same guards for every read.
async function readArticle(url, src, { fetchImpl = fetch, lookupImpl = dns.promises.lookup, whole = false, agent = 'link preview image' } = {}) {
  const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
  let next = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!pageAllowed(next, src) || !(await resolvesPublic(new URL(next).hostname, lookupImpl))) return null;
      const res = await fetchImpl(next, {
        headers: { 'User-Agent': `gatecast/1.0 (${agent})`, Accept: 'text/html, application/xhtml+xml;q=0.9' },
        redirect: 'manual', signal,
      });
      const location = res.headers && res.headers.get ? res.headers.get('location') : null;
      if (res.status >= 300 && res.status < 400) {
        res.body?.cancel?.().catch(() => {});
        if (!location) return null;
        next = new URL(location, next).href; // checked again at the top of the loop
        continue;
      }
      const type = res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
      if (!res.ok || (type && !/html/i.test(type))) { res.body?.cancel?.().catch(() => {}); return null; }
      return { html: await readHead(res, { whole }), url: next };
    }
  } catch { /* timeout, refused, reset: nothing */ }
  return null;
}

// An article page's preview image: { image } when the page was read (image may be null), or null on failure.
async function pageImage(url, src, opts = {}) {
  const page = await readArticle(url, src, { ...opts, whole: false });
  return page ? { image: headImage(page.html, page.url) } : null;
}

/* ---------- Article pages: an embedded YouTube video ---------- */

// The YouTube video an article page embeds, from three places, in this order: the page's og:video (or
// twitter:player) meta tag, a JSON-LD VideoObject's embedUrl, then the first YouTube player iframe (src, or the
// data-src lazy loaders use). Only YouTube's embed player counts (youtube.com or youtube-nocookie.com); any other
// iframe or video is ignored. Only tag attributes and JSON-LD video objects are read, never the page's text.
//   -> { id, duration } (duration "2:31" from the VideoObject when it gives one, else null), or null.
// Not yet checked with YouTube: lib/youtube.js verifyVideo decides whether it is served.
const VIDEO_KEYS = ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player'];
const MAX_LD_BYTES = 100 * 1024;
function pageVideo(html) {
  const doc = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const head = doc.split(/<\/head\s*>/i)[0].replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const metas = tagAttrs(head, /<meta\b([^>]*)>/gi).map((a) => ({ key: String(a.property || a.name || '').trim().toLowerCase(), value: a.content }));
  for (const key of VIDEO_KEYS) {
    for (const m of metas) {
      if (m.key !== key) continue;
      const id = yt.embedId(m.value);
      if (id) return { id, duration: null };
    }
  }
  for (const m of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(String(attrs(m[1]).type || ''))) continue;
    if (m[2].length > MAX_LD_BYTES) continue;
    let data;
    try { data = JSON.parse(m[2].trim()); } catch { continue; }
    const found = videoObject(data);
    if (found) return found;
  }
  const body = doc.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (const a of tagAttrs(body, /<iframe\b([^>]*)>/gi)) {
    const id = yt.embedId(a.src) || yt.embedId(a['data-src']) || yt.embedId(a['data-lazy-src']);
    if (id) return { id, duration: null };
  }
  return null;
}
// The first VideoObject with a YouTube embedUrl in a JSON-LD value (an object, an array or an @graph), looking at
// most 6 levels deep and 500 nodes.
function videoObject(data) {
  const stack = [[data, 0]];
  let seen = 0;
  while (stack.length && seen < 500) {
    const [node, depth] = stack.shift();
    seen++;
    if (Array.isArray(node)) { if (depth < 6) for (const x of node) stack.push([x, depth + 1]); continue; }
    if (!node || typeof node !== 'object') continue;
    const type = node['@type'];
    const isVideo = (Array.isArray(type) ? type : [type]).some((t) => String(t || '') === 'VideoObject');
    if (isVideo) {
      const id = yt.embedId(Array.isArray(node.embedUrl) ? node.embedUrl[0] : node.embedUrl);
      if (id) return { id, duration: yt.isoDuration(node.duration) };
    }
    if (depth < 6) for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push([v, depth + 1]);
  }
  return null;
}

// An article page's preview image and embedded YouTube video: { image, video } when the page was read (either may be
// null), or null on failure. Read past </head>, still at most MAX_HEAD_BYTES, so an iframe in the article can be
// found; only for outlets whose pictures are on (the caller checks).
// videos: every embeddable player the page carries, from any provider in js/mediaproviders.js (YouTube, Vimeo,
// Facebook, X video posts, TikTok), in page order (findPageVideos); lib/weird.js serves the first one its provider
// says may be embedded. video stays the first YouTube one, as before.
async function pageMedia(url, src, opts = {}) {
  const page = await readArticle(url, src, { ...opts, whole: true, agent: 'link preview' });
  if (!page) return null;
  const mp = await require('./videos.js').providers();
  return { image: headImage(page.html, page.url), video: pageVideo(page.html), videos: mp.findPageVideos(page.html) };
}

// Six hours per article: a story's preview image rarely changes, and many visitors share one read.
const PAGE_TTL = 6 * 3600e3, PAGE_RETRY = 30 * 60e3, PAGE_CACHE_MAX = 1000;
const pageCache = new Map();
async function cachedPageImage(url, src, opts = {}) {
  const now = Date.now();
  const hit = pageCache.get(url);
  if (hit && now - hit.at < hit.ttl) return hit.image;
  const got = await pageImage(url, src, opts);
  pageCache.delete(url);
  pageCache.set(url, { at: now, ttl: got ? PAGE_TTL : PAGE_RETRY, image: got ? got.image : null });
  while (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
  return got ? got.image : null;
}
// The same for pageMedia (the weird news): six hours per article, 30 minutes after a failed read.
const mediaCache = new Map();
async function cachedPageMedia(url, src, opts = {}) {
  const now = Date.now();
  const hit = mediaCache.get(url);
  if (hit && now - hit.at < hit.ttl) return hit.media;
  const got = await pageMedia(url, src, opts);
  mediaCache.delete(url);
  mediaCache.set(url, { at: now, ttl: got ? PAGE_TTL : PAGE_RETRY, media: got });
  while (mediaCache.size > PAGE_CACHE_MAX) mediaCache.delete(mediaCache.keys().next().value);
  return got;
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

const imagesOn = (src) => src.images !== false;
// All of a state's feeds in parallel; a feed that fails or times out is skipped. Then, only for the items about to
// be returned, the preview image: the feed's own, or else the article page's og:image (read in parallel, cached).
// An outlet whose "images" switch is false gets no image at all, and its pages are never read.
async function loadNews(state, { fetchImpl = fetch, lookupImpl = dns.promises.lookup, now = Date.now(), pageCache: usePageCache = true } = {}) {
  const list = sourcesFor(state);
  const results = await Promise.allSettled(list.map((s) => readFeed(s, fetchImpl)));
  const all = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const src = list[i];
    for (const x of r.value) all.push({ ...x, outlet: src.name, outletUrl: src.homepage, source: src.id, src });
  });
  const picked = selectItems(all, now);
  const read = usePageCache ? cachedPageImage : async (u, s, o) => { const got = await pageImage(u, s, o); return got ? got.image : null; };
  const images = await Promise.all(picked.map(async (x) => {
    if (!imagesOn(x.src)) return null;
    return x.image || read(x.url, x.src, { fetchImpl, lookupImpl });
  }));
  const items = picked.map(({ title, url, outlet, outletUrl, published }, i) => {
    const im = images[i];
    const image = im ? { url: im.url, ...(im.width && im.height ? { width: im.width, height: im.height } : {}) } : null;
    return { title, url, outlet, outletUrl, published: new Date(published).toISOString(), image };
  });
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

module.exports = {
  newsFor, loadNews, parseFeed, selectItems, plainText, decodeEntities, httpsUrl, sameStory, normaliseState, CACHE_CONTROL, SOURCES,
  feedImage, headImage, previewImage, imageUrl, pageImage, pageAllowed, isPrivateAddress, publicName,
  cachedPageImage, urlKey, // shared with lib/weird.js
  pageMedia, cachedPageMedia, pageVideo, readArticle, MAX_HEAD_BYTES, PAGE_TIMEOUT_MS,
};
