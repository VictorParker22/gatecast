// YouTube on the server, for weird stories that have a video: reading a YouTube address, checking a video with
// YouTube's oEmbed endpoint before it is ever served, and fetching a video's still image for api/yt-thumb.js, so a
// visitor's browser contacts nobody but Gatecast until they press Play. No dependencies.
// youtubeId() and registrableDomain() are the same rules as js/storymedia.js (the browser's copy, an ES module);
// tests/storymedia.test.mjs checks that both copies agree.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const isVideoId = (id) => typeof id === 'string' && YT_ID.test(id);
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

// A YouTube link in any common form -> its 11-character id, or null (see js/storymedia.js youtubeId).
function youtubeId(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\//i.test(s)) return null;
    s = `https://${s}`;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (SHORT_HOSTS.has(host)) id = parts.length === 1 ? parts[0] : null;
  else if (NOCOOKIE_HOSTS.has(host)) id = parts.length === 2 && parts[0] === 'embed' ? parts[1] : null;
  else if (YT_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts.length === 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  return isVideoId(id) ? id : null;
}

// A player address found in a page (an iframe's src, og:video, a VideoObject's embedUrl): only YouTube's embed
// player, on youtube.com or youtube-nocookie.com, counts. Protocol-relative addresses ("//www.youtube.com/embed/…")
// are read as https. -> id or null.
function embedId(raw) {
  let s = String(raw ?? '').trim();
  if (s.startsWith('//')) s = `https:${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!YT_HOSTS.has(host) && !NOCOOKIE_HOSTS.has(host)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 2 && (parts[0] === 'embed' || parts[0] === 'v') && isVideoId(parts[1])) return parts[1];
  // og:video sometimes names the watch page instead of the player.
  if (YT_HOSTS.has(host) && parts.length === 1 && parts[0] === 'watch' && isVideoId(u.searchParams.get('v'))) return u.searchParams.get('v');
  return null;
}

// "PT2M31S" -> "2:31", "PT1H4M5S" -> "1:04:05"; null when it is not an ISO 8601 duration of a sensible length.
function isoDuration(raw) {
  const m = /^P(?:T(?:(\d{1,2})H)?(?:(\d{1,3})M)?(?:(\d{1,5})S)?)$/i.exec(String(raw ?? '').trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const total = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  if (total <= 0 || total >= 100 * 3600) return null;
  const h = Math.floor(total / 3600), mi = Math.floor((total % 3600) / 60), se = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(mi)}:${two(se)}` : `${mi}:${two(se)}`;
}

/* ---------- The editor's picture rule (js/storymedia.js pickImageProblem) ---------- */

const MULTI = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'co.za', 'org.za', 'gov.za', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.mx', 'com.ar', 'com.tr', 'com.sg', 'com.hk', 'com.tw', 'co.kr', 'or.kr', 'com.my', 'co.id', 'co.il',
  'com.ph', 'com.pk', 'com.ng', 'co.ke', 'com.eg', 'com.sa', 'com.ua', 'co.th',
  'blogspot.com', 'wordpress.com', 'github.io', 'substack.com', 'netlify.app', 'vercel.app', 'pages.dev', 'herokuapp.com', 'appspot.com',
]);
function publicHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.([a-z]{2,63}|xn--[a-z0-9-]+)$/.test(h) || h.includes('..')) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|invalid|test|example)$/.test(h)) return null;
  return h;
}
function registrableDomain(host) {
  const h = publicHost(host);
  if (!h) return null;
  const labels = h.split('.');
  const two = labels.slice(-2).join('.');
  if (MULTI.has(two)) return labels.length >= 3 ? labels.slice(-3).join('.') : null;
  return two;
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

// The editor's picture for a pick, or null when it breaks the rule: https, no credentials or port, a public host,
// not an SVG, and on the story's own site (same registrable domain) or a host listed for the outlet (imageHosts or a
// subdomain of one). src: the pick's outlet from data/weird-sources.json (normalised), or null. An outlet whose
// pictures are off takes none.
function pickImage(imageUrl, storyUrl, src) {
  const s = String(imageUrl ?? '').trim();
  if (!s || s.length > 2048) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = publicHost(u.hostname);
  if (!host || /\.svgz?$/i.test(u.pathname)) return null;
  if (src && src.images === false) return null;
  const storyDom = registrableDomain(hostOf(storyUrl));
  if (!storyDom) return null;
  if (registrableDomain(host) === storyDom) return u.href;
  const listed = src && Array.isArray(src.imageHosts) ? src.imageHosts : [];
  return listed.some((h) => host === h || host.endsWith(`.${h}`)) ? u.href : null;
}

/* ---------- oEmbed: is the video there, and may it be embedded? ---------- */

const OEMBED_TIMEOUT_MS = 4000;
const MAX_OEMBED_BYTES = 64 * 1024;
const VERIFIED_TTL = 6 * 3600e3;   // an answer from YouTube (embeddable, or gone / not embeddable)
const FAILED_TTL = 10 * 60e3;      // no answer (network, timeout, YouTube's own error): ask again after this
const CACHE_MAX = 2000;
const oembedUrl = (id) => `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
const short = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// One oEmbed request: { state: 'ok', title, channel } | { state: 'gone' } (400, 401, 403 or 404: removed, private or
// not embeddable) | { state: 'failed' } (anything else). Never throws.
async function askYouTube(id, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(oembedUrl(id), {
      headers: { 'User-Agent': 'gatecast/1.0 (video check)', Accept: 'application/json' },
      redirect: 'follow', signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
  } catch { return { state: 'failed' }; }
  const status = res && Number.isInteger(res.status) ? res.status : 0;
  if ([400, 401, 403, 404].includes(status)) { res.body?.cancel?.().catch?.(() => {}); return { state: 'gone' }; }
  if (!res || !res.ok) { res?.body?.cancel?.().catch?.(() => {}); return { state: 'failed' }; }
  try {
    const text = String(await res.text());
    if (text.length > MAX_OEMBED_BYTES) return { state: 'failed' };
    const j = JSON.parse(text);
    if (!j || typeof j !== 'object' || (j.type && j.type !== 'video')) return { state: 'gone' };
    return { state: 'ok', title: short(j.title, 200), channel: short(j.author_name, 100) };
  } catch { return { state: 'failed' }; }
}

// id -> { at, ttl, result, good }. good: the last 'ok' answer, kept so a failed re-check does not drop a video that
// was verified before.
const cache = new Map();
const pending = new Map();

// A video as it may be served: { id, title, channel } when YouTube says it exists and may be embedded, or null.
// Cached for 6 hours; a failed check is retried after 10 minutes, and while it fails a video verified before is
// still served. opts.cache = false (tests) asks every time.
async function verifyVideo(id, { fetchImpl = globalThis.fetch, now = Date.now(), cache: useCache = true } = {}) {
  if (!isVideoId(id) || typeof fetchImpl !== 'function') return null;
  const hit = useCache ? cache.get(id) : null;
  if (hit && now - hit.at < hit.ttl) return answer(id, hit);
  if (useCache && pending.has(id)) return pending.get(id);
  const work = askYouTube(id, fetchImpl).then((result) => {
    const prev = useCache ? cache.get(id) : null;
    const entry = {
      at: now, ttl: result.state === 'failed' ? FAILED_TTL : VERIFIED_TTL, result,
      good: result.state === 'ok' ? result : result.state === 'gone' ? null : (prev && prev.good) || null,
    };
    if (useCache) {
      cache.delete(id);
      cache.set(id, entry);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return answer(id, entry);
  }).finally(() => pending.delete(id));
  if (useCache) pending.set(id, work);
  return work;
}
function answer(id, entry) {
  const r = entry.result.state === 'ok' ? entry.result : entry.result.state === 'failed' ? entry.good : null;
  return r ? { id, title: r.title || '', channel: r.channel || '' } : null;
}
const clearVideoCache = () => { cache.clear(); pending.clear(); };

/* ---------- The still image, for api/yt-thumb.js ---------- */

const THUMB_HOST = 'i.ytimg.com';
const THUMB_TIMEOUT_MS = 5000;
const MAX_THUMB_BYTES = 256 * 1024;
const THUMB_CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable';
const MISSING_CACHE = 'public, max-age=600, s-maxage=600';
const thumbUrl = (id) => `https://${THUMB_HOST}/vi/${id}/hqdefault.jpg`;

// Reads at most `max` bytes of a body; null when it is longer.
async function readCapped(res, max) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > max ? null : buf;
  }
  const chunks = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) return null;
      chunks.push(Buffer.from(value));
    }
  } finally { reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

// GET /api/yt-thumb?id=<11 characters> -> { status, headers, body }. Only that id's hqdefault.jpg on i.ytimg.com is
// ever fetched (no redirects followed, nothing from the visitor's request is passed on), at most 256 KB, a JPEG
// only. Answers: 200 with the image (cached a day at the browser and the edge), 400 for a malformed id, 404 when
// YouTube has no still (YouTube answers 404 with a grey placeholder), 502 when YouTube cannot be reached.
async function thumbFor(rawId, { fetchImpl = globalThis.fetch } = {}) {
  const base = { 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
  const id = typeof rawId === 'string' ? rawId : '';
  if (!isVideoId(id)) return { status: 400, headers: { ...base, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'bad id' };
  const fail = (status, cacheControl) => ({ status, headers: { ...base, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cacheControl }, body: status === 404 ? 'no still' : 'unavailable' });
  let res;
  try {
    res = await fetchImpl(thumbUrl(id), {
      headers: { 'User-Agent': 'gatecast/1.0 (video still)', Accept: 'image/jpeg' },
      redirect: 'manual', signal: AbortSignal.timeout(THUMB_TIMEOUT_MS),
    });
  } catch { return fail(502, 'no-store'); }
  const status = res && Number.isInteger(res.status) ? res.status : 0;
  if (status === 404) { res.body?.cancel?.().catch?.(() => {}); return fail(404, MISSING_CACHE); }
  const type = res.headers && typeof res.headers.get === 'function' ? String(res.headers.get('content-type') || '') : '';
  if (status !== 200 || !/^image\/jpeg\b/i.test(type)) { res?.body?.cancel?.().catch?.(() => {}); return fail(502, 'no-store'); }
  let body;
  try { body = await readCapped(res, MAX_THUMB_BYTES); } catch { return fail(502, 'no-store'); }
  if (!body || body.length < 100) return fail(502, 'no-store');
  return { status: 200, headers: { ...base, 'Content-Type': 'image/jpeg', 'Cache-Control': THUMB_CACHE, 'Content-Length': String(body.length) }, body };
}

module.exports = {
  youtubeId, embedId, isVideoId, isoDuration, registrableDomain, publicHost, pickImage,
  verifyVideo, clearVideoCache, oembedUrl, thumbFor, thumbUrl, THUMB_CACHE, MAX_THUMB_BYTES, VERIFIED_TTL, FAILED_TTL,
};
