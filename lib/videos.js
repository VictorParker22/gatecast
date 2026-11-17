// Videos from any provider on the server: checking a video with the provider's public oEmbed endpoint before it is
// ever served, and fetching its still for api/media-thumb.js, so a visitor's browser contacts nobody but Gatecast
// until they press Play. The rules (which providers, which link forms, which embed and image hosts) are the shared
// pure module js/mediaproviders.js, loaded here with import() because it is an ES module the browser uses too.
// YouTube keeps lib/youtube.js (its oEmbed check and api/yt-thumb). No dependencies.

const youtube = require('./youtube.js');

let mpPromise = null;
// The shared rulebook (js/mediaproviders.js). Resolves once; every caller awaits the same module.
const providers = () => (mpPromise ||= import('../js/mediaproviders.js'));

const OEMBED_TIMEOUT_MS = 4000;
const MAX_OEMBED_BYTES = 64 * 1024;
const VERIFIED_TTL = 6 * 3600e3;
const FAILED_TTL = 10 * 60e3;
const CACHE_MAX = 2000;

// One oEmbed request -> readOembed's answer ({ state: 'ok' | 'gone' | 'failed', ... }). Never throws. No redirects
// are followed to another host: the endpoint is fixed per provider.
async function askProvider(mp, v, fetchImpl) {
  const url = mp.oembedUrl(v);
  if (!url) return { state: 'failed' };
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': 'gatecast/1.0 (video check)', Accept: 'application/json' },
      redirect: 'follow', signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
  } catch { return { state: 'failed' }; }
  const status = res && Number.isInteger(res.status) ? res.status : 0;
  if (status !== 200) { res?.body?.cancel?.().catch?.(() => {}); return mp.readOembed(v.provider, status, null); }
  try {
    const text = String(await res.text());
    if (text.length > MAX_OEMBED_BYTES) return { state: 'failed' };
    return mp.readOembed(v.provider, 200, JSON.parse(text));
  } catch { return { state: 'failed' }; }
}

// key -> { at, ttl, result, good } (as lib/youtube.js: a verified answer survives a failed re-check).
const cache = new Map();
const pending = new Map();

// A video as it may be served: { provider, id, title, author, duration, thumbUrl } or null.
//   - YouTube: lib/youtube.js verifyVideo (oEmbed, cached).
//   - Vimeo, X, TikTok: the provider's public oEmbed; removed, private or not embeddable -> null. Cached 6 hours; a
//     failed check is retried after 10 minutes, and meanwhile a video verified before is still served.
//   - Facebook: Meta's oEmbed needs an app token, so it is served as given (the page links the post beside it).
//   - Instagram: a link-out card only; served as given (nothing of Instagram's loads on Gatecast).
// v: { provider, ref, duration? }. opts.cache = false (tests) asks every time.
async function verifyMedia(v, { fetchImpl = globalThis.fetch, now = Date.now(), cache: useCache = true } = {}) {
  const mp = await providers();
  if (!mp.isVideo(v) || typeof fetchImpl !== 'function') return null;
  const duration = typeof v.duration === 'string' ? v.duration : null;
  if (v.provider === 'youtube') {
    const ok = await youtube.verifyVideo(v.ref, { fetchImpl, now, cache: useCache });
    return ok ? { provider: 'youtube', id: ok.id, title: ok.title, author: ok.channel, duration, thumbUrl: youtube.thumbUrl(ok.id) } : null;
  }
  if (!mp.PROVIDERS[v.provider].check) return { provider: v.provider, id: v.ref, title: '', author: mp.authorOf(v), duration, thumbUrl: null };
  const key = `${v.provider}:${v.ref}`;
  const hit = useCache ? cache.get(key) : null;
  const answer = (entry) => {
    const r = entry.result.state === 'ok' ? entry.result : entry.result.state === 'failed' ? entry.good : null;
    return r ? { provider: v.provider, id: v.ref, title: r.title || '', author: r.author || mp.authorOf(v), duration: r.duration || duration, thumbUrl: r.thumbUrl || null } : null;
  };
  if (hit && now - hit.at < hit.ttl) return answer(hit);
  if (useCache && pending.has(key)) return pending.get(key);
  const work = askProvider(mp, v, fetchImpl).then((result) => {
    const prev = useCache ? cache.get(key) : null;
    const entry = {
      at: now, ttl: result.state === 'failed' ? FAILED_TTL : VERIFIED_TTL, result,
      good: result.state === 'ok' ? result : result.state === 'gone' ? null : (prev && prev.good) || null,
    };
    if (useCache) {
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return answer(entry);
  }).finally(() => pending.delete(key));
  if (useCache) pending.set(key, work);
  return work;
}

// The first of several candidates (a page's embeds, in page order) that may be served, or null. At most `max` are
// asked about.
async function firstPlayable(list, opts = {}, max = 3) {
  for (const v of (Array.isArray(list) ? list : []).slice(0, max)) {
    const ok = await verifyMedia(v, opts);
    if (ok) return ok;
  }
  return null;
}

const clearMediaCache = () => { cache.clear(); pending.clear(); youtube.clearVideoCache(); };

/* ---------- The still image, for api/media-thumb.js ---------- */

const THUMB_TIMEOUT_MS = 5000;
const MAX_THUMB_BYTES = 512 * 1024;
const TYPES = /^image\/(jpeg|png|webp)\b/i;

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

// GET /api/media-thumb?p=<provider>&id=<ref> -> { status, headers, body }. YouTube is lib/youtube.js thumbFor (the
// same as api/yt-thumb). For Vimeo and TikTok the still is the one the provider's oEmbed names (verifyMedia, cached),
// fetched only from that provider's own image host (THUMB_HOSTS in js/mediaproviders.js), no redirects followed,
// nothing from the visitor's request passed on, at most 512 KB, JPEG, PNG or WebP only. Providers without a public
// still (Facebook, X, Instagram) answer 404: the page shows Gatecast's own poster. 400 for an unknown provider or a
// malformed reference; 404 when the video is gone or has no still; 502 when the provider cannot be reached.
async function mediaThumb(provider, ref, { fetchImpl = globalThis.fetch, cache: useCache = true } = {}) {
  const mp = await providers();
  const base = { 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
  const plain = (status, body, cacheControl) => ({ status, headers: { ...base, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cacheControl }, body });
  const v = { provider: String(provider ?? ''), ref: String(ref ?? '') };
  if (!mp.isVideo(v)) return plain(400, 'bad video', 'no-store');
  if (v.provider === 'youtube') return youtube.thumbFor(v.ref, { fetchImpl });
  if (mp.PROVIDERS[v.provider].still !== 'proxy') return plain(404, 'no still', 'public, max-age=600, s-maxage=600');
  const ok = await verifyMedia(v, { fetchImpl, cache: useCache });
  if (!ok || !ok.thumbUrl || !mp.thumbHostAllowed(v.provider, ok.thumbUrl)) return plain(404, 'no still', 'public, max-age=600, s-maxage=600');
  let res;
  try {
    res = await fetchImpl(ok.thumbUrl, {
      headers: { 'User-Agent': 'gatecast/1.0 (video still)', Accept: 'image/jpeg, image/webp, image/png' },
      redirect: 'manual', signal: AbortSignal.timeout(THUMB_TIMEOUT_MS),
    });
  } catch { return plain(502, 'unavailable', 'no-store'); }
  const status = res && Number.isInteger(res.status) ? res.status : 0;
  const type = res.headers && typeof res.headers.get === 'function' ? String(res.headers.get('content-type') || '') : '';
  if (status === 404) { res.body?.cancel?.().catch?.(() => {}); return plain(404, 'no still', 'public, max-age=600, s-maxage=600'); }
  if (status !== 200 || !TYPES.test(type)) { res?.body?.cancel?.().catch?.(() => {}); return plain(502, 'unavailable', 'no-store'); }
  let body;
  try { body = await readCapped(res, MAX_THUMB_BYTES); } catch { return plain(502, 'unavailable', 'no-store'); }
  if (!body || body.length < 100) return plain(502, 'unavailable', 'no-store');
  // A provider's still can change when the video is edited: a day at the edge, not immutable.
  return { status: 200, headers: { ...base, 'Content-Type': type.split(';')[0].toLowerCase(), 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800', 'Content-Length': String(body.length) }, body };
}

module.exports = { providers, verifyMedia, firstPlayable, mediaThumb, clearMediaCache, MAX_THUMB_BYTES };
