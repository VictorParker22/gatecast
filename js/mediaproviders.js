// Video from any provider with an official embed player: the one shared rulebook for the server (lib/videos.js,
// lib/news.js, lib/weird.js, api/media-thumb.js load it with import()), the reviewer console (js/reviewmodel.js,
// js/review.js) and the front page (js/frontmodel.js, js/frontmedia.js). No DOM and no network, so it is tested with
// plain Node (tests/mediaproviders.test.mjs). Owner decision, 17 Nov 2026: "if the source has a video from Facebook,
// from YouTube, from anywhere, unless they have something protected, we should be able to use their display".
//
// Guardrails, all enforced here:
// - Only the official embed players in PROVIDERS, at the exact addresses embedSrc() builds. Nothing else is ever
//   put in an iframe, and nothing is downloaded or re-hosted: Gatecast plays the provider's own player.
// - Nothing from a provider loads in a reader's browser before Play: a story shows a facade whose still is served
//   by Gatecast (api/yt-thumb, api/media-thumb, from the provider's own image host only: THUMB_HOSTS) or, for
//   providers without a public still, Gatecast's own poster. embedSrc() is called only from a Play click.
// - A video the provider marks as removed, private or not embeddable (oEmbed 400/401/403/404, or the wrong type) is
//   dropped (readOembed). Private, unlisted and members-only forms are refused when the link is read (no Vimeo
//   unlisted hash, no Facebook group or story, no Instagram stories).
// - Instagram has no embed without an app token, so it is a link-out card only; Facebook has no public check
//   (Meta's oEmbed needs an app token), so it is served as the editor or the page gave it, with a link to the post
//   beside the player in case the plugin will not play.
// - Every video carries "Video: <author> on <Provider>" (creditLine) and a link to the original post (originalUrl).
import { youtubeId, ytEmbed, ytThumb, ytWatch, isVideoId } from './storymedia.js';

// The providers, in the order the console names them. play: how the video plays after Play (an iframe of the
// provider's player, X's widget script, or a link out). still: 'proxy' (served by Gatecast from the provider's
// image host) or 'poster' (Gatecast's own design). check: whether the server can ask the provider (public oEmbed).
export const PROVIDERS = {
  youtube: { name: 'YouTube', play: 'iframe', still: 'proxy', check: true, aspect: '16 / 9' },
  vimeo: { name: 'Vimeo', play: 'iframe', still: 'proxy', check: true, aspect: '16 / 9' },
  facebook: { name: 'Facebook', play: 'iframe', still: 'poster', check: false, aspect: '16 / 9' },
  x: { name: 'X', play: 'widget', still: 'poster', check: true, aspect: '1 / 1' },
  tiktok: { name: 'TikTok', play: 'iframe', still: 'proxy', check: true, aspect: '9 / 16' },
  instagram: { name: 'Instagram', play: 'link', still: 'poster', check: false, aspect: '4 / 5' },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const providerName = (p) => PROVIDERS[p]?.name || '';
export const PROVIDER_LIST = 'YouTube, Vimeo, Facebook, X, TikTok or Instagram';

// The hosts an iframe or script may ever point at, after Play only. tests/mediaproviders.test.mjs checks every
// embedSrc() against it.
export const EMBED_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.facebook.com', 'www.tiktok.com', 'platform.twitter.com'];
export const X_WIDGETS = 'https://platform.twitter.com/widgets.js';

// The image hosts Gatecast's still endpoint may fetch from, per provider: exact hosts, or (suffix) a host ending in
// "." + it. Only the still oEmbed names is fetched, never an address from a visitor.
export const THUMB_HOSTS = {
  youtube: { exact: ['i.ytimg.com'], suffix: [] },
  vimeo: { exact: ['i.vimeocdn.com'], suffix: [] },
  tiktok: { exact: [], suffix: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com'] },
};

// What a stored reference looks like, per provider (the database checks the same shapes).
const REF = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d{6,12}$/,
  facebook: /^https:\/\/(?:www\.facebook\.com\/(?:[A-Za-z0-9.\-_]{1,80}\/videos\/\d{5,25}\/|watch\/\?v=\d{5,25}|reel\/\d{5,25})|fb\.watch\/[A-Za-z0-9_-]{4,20}\/)$/,
  x: /^\d{5,25}$/,
  tiktok: /^[A-Za-z0-9._]{1,24}\/\d{15,22}$/,
  instagram: /^(?:p|reel|tv)\/[A-Za-z0-9_-]{5,40}$/,
};
export const isProvider = (p) => typeof p === 'string' && Object.hasOwn(PROVIDERS, p);
export const isValidRef = (p, ref) => isProvider(p) && typeof ref === 'string' && ref.length <= 400 && REF[p].test(ref);
export const isVideo = (v) => Boolean(v && typeof v === 'object' && isValidRef(v.provider, v.ref));

/* ---------- Reading a link ---------- */

const HOSTS = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'],
  vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch', 'www.fb.watch'],
  x: ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'platform.twitter.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
};
// The provider a host belongs to, or null.
export function providerOfHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return PROVIDER_IDS.find((p) => HOSTS[p].includes(h)) || null;
}

// A link as a URL object: https or http (read as https), protocol-relative read as https, a bare known host given
// https. No credentials, default port only, no spaces, at most 2,048 characters. -> URL or null.
function asUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const host = s.split(/[/?#]/)[0];
    if (!providerOfHost(host)) return null;
    s = `https://${s}`;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  return u;
}
const parts = (u) => u.pathname.split('/').filter(Boolean);
const digits = (s, min, max) => (typeof s === 'string' && new RegExp(`^\\d{${min},${max}}$`).test(s) ? s : null);

function vimeoRef(u) {
  const host = u.hostname.toLowerCase(), p = parts(u);
  if (host === 'player.vimeo.com') {
    if (p.length === 2 && p[0] === 'video' && !u.searchParams.has('h')) return digits(p[1], 6, 12); // h= is an unlisted video's key
    return null;
  }
  const shapes = [[1, 0], [3, 2, 'channels'], [4, 3, 'groups', 'videos'], [4, 3, 'album', 'video'], [4, 3, 'showcase', 'video']];
  for (const [n, at, a, b] of shapes) {
    if (p.length !== n) continue;
    if (a && p[0] !== a) continue;
    if (b && p[2] !== b) continue;
    return digits(p[at], 6, 12);
  }
  return null; // vimeo.com/<id>/<hash> is unlisted: not a public video
}

function facebookRef(u, depth = 0) {
  const host = u.hostname.toLowerCase(), p = parts(u);
  if (host === 'fb.watch' || host === 'www.fb.watch') {
    return p.length === 1 && /^[A-Za-z0-9_-]{4,20}$/.test(p[0]) ? `https://fb.watch/${p[0]}/` : null;
  }
  // The plugin's own address names the video in href.
  if (p.length === 2 && p[0] === 'plugins' && p[1] === 'video.php' && depth === 0) {
    const inner = asUrl(u.searchParams.get('href'));
    return inner && providerOfHost(inner.hostname) === 'facebook' ? facebookRef(inner, 1) : null;
  }
  const v = digits(u.searchParams.get('v'), 5, 25);
  if (p.length === 1 && (p[0] === 'watch' || p[0] === 'video.php') && v) return `https://www.facebook.com/watch/?v=${v}`;
  if (p.length === 2 && p[0] === 'reel' && digits(p[1], 5, 25)) return `https://www.facebook.com/reel/${p[1]}`;
  if ((p.length === 3 || p.length === 4) && p[1] === 'videos' && /^[A-Za-z0-9.\-_]{1,80}$/.test(p[0])
    && !['groups', 'stories', 'events', 'login', 'plugins', 'share', 'sharer'].includes(p[0].toLowerCase())) {
    const id = digits(p[p.length - 1], 5, 25);
    return id ? `https://www.facebook.com/${p[0]}/videos/${id}/` : null;
  }
  return null;
}

function xRef(u) {
  const host = u.hostname.toLowerCase(), p = parts(u);
  if (host === 'platform.twitter.com') {
    // The widget's own frame: platform.twitter.com/embed/Tweet.html?id=<id>
    return p.length === 2 && p[0] === 'embed' && /^Tweet\.html$/i.test(p[1]) ? digits(u.searchParams.get('id'), 5, 25) : null;
  }
  if (p.length >= 3 && p[1] === 'status' && (p[0] === 'i' || /^[A-Za-z0-9_]{1,15}$/.test(p[0]))) return digits(p[2], 5, 25);
  if (p.length >= 4 && p[0] === 'i' && p[1] === 'web' && p[2] === 'status') return digits(p[3], 5, 25);
  return null;
}

function tiktokRef(u) {
  const p = parts(u);
  if (p.length >= 3 && /^@[A-Za-z0-9._]{1,24}$/.test(p[0]) && p[1] === 'video') {
    const id = digits(p[2], 15, 22);
    return id ? `${p[0].slice(1)}/${id}` : null;
  }
  return null; // embed and player addresses carry no account name; the console asks for the full link
}

function instagramRef(u) {
  const p = parts(u);
  const at = p.length >= 3 && /^[A-Za-z0-9._]{1,30}$/.test(p[0]) && ['p', 'reel', 'reels', 'tv'].includes(p[1]) ? 1 : 0;
  const kind = p[at], code = p[at + 1];
  if (!['p', 'reel', 'reels', 'tv'].includes(kind) || !/^[A-Za-z0-9_-]{5,40}$/.test(code || '')) return null;
  return `${kind === 'reels' ? 'reel' : kind}/${code}`;
}

// Any video link -> { provider, ref } or null. Every common form of each provider's public video address, its embed
// address, and its share address; anything else (another site, a channel, a profile, a playlist, a search, a private
// or unlisted form, a look-alike host) is null.
export function parseVideoLink(raw) {
  const u = asUrl(raw);
  if (!u) return null;
  const provider = providerOfHost(u.hostname);
  if (!provider) return null;
  let ref = null;
  if (provider === 'youtube') ref = youtubeId(u.href);
  else if (provider === 'vimeo') ref = vimeoRef(u);
  else if (provider === 'facebook') ref = facebookRef(u);
  else if (provider === 'x') ref = xRef(u);
  else if (provider === 'tiktok') ref = tiktokRef(u);
  else if (provider === 'instagram') ref = instagramRef(u);
  return ref && isValidRef(provider, ref) ? { provider, ref } : null;
}

// The console's message for a video link, or null when it is empty or readable.
export function videoLinkProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (parseVideoLink(s)) return null;
  const u = asUrl(s);
  const provider = u ? providerOfHost(u.hostname) : null;
  if (provider === 'tiktok' && /^v[mt]\.tiktok\.com$/i.test(u.hostname)) return 'That is a TikTok share link. Open it, then copy the full address (tiktok.com/@account/video/…).';
  if (provider === 'tiktok') return 'Use the TikTok video’s full address: tiktok.com/@account/video/…';
  if (provider === 'vimeo' && (u.searchParams.has('h') || /\/\d{6,12}\/[0-9a-f]{6,}/i.test(u.pathname + '/'))) return 'That Vimeo video is unlisted. Only public videos can be shown.';
  if (provider) return `That ${providerName(provider)} link is not a public video. Paste the video’s own address.`;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return 'Paste the whole video link, not just its id.';
  return `Paste a link to a video on ${PROVIDER_LIST}.`;
}

// What one pasted link is, for the console's single Media box:
//   { kind: 'video', provider, ref } | { kind: 'picture', url } | { kind: 'empty' } | { kind: 'unknown', problem }
// A link on a video provider's site that is not a public video is 'unknown' with that provider's message; any other
// https link is taken as a picture (the picture rule then checks its host).
export function classifyMediaLink(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'empty' };
  const v = parseVideoLink(s);
  if (v) return { kind: 'video', ...v };
  const u = asUrl(s);
  if (u && providerOfHost(u.hostname)) return { kind: 'unknown', problem: videoLinkProblem(s) };
  if (u && u.protocol === 'https:') return { kind: 'picture', url: u.href };
  return { kind: 'unknown', problem: 'Paste a full https:// link to a video or a picture.' };
}

/* ---------- Addresses: the post, the player, the still, oEmbed ---------- */

const tiktokParts = (ref) => { const [handle, id] = String(ref).split('/'); return { handle, id }; };

// The original post, always linked beside the video.
export function originalUrl(v) {
  if (!isVideo(v)) return null;
  const { provider: p, ref } = v;
  if (p === 'youtube') return ytWatch(ref);
  if (p === 'vimeo') return `https://vimeo.com/${ref}`;
  if (p === 'facebook') return ref;
  if (p === 'x') return `https://x.com/i/status/${ref}`;
  if (p === 'tiktok') { const t = tiktokParts(ref); return `https://www.tiktok.com/@${t.handle}/video/${t.id}`; }
  if (p === 'instagram') return `https://www.instagram.com/${ref}/`;
  return null;
}

// The provider's own player, for an iframe built after Play only. Privacy-friendly forms where the provider offers
// one (youtube-nocookie.com, Vimeo's dnt=1). X plays through its widget script (xEmbedHTML); Instagram never embeds.
export function embedSrc(v) {
  if (!isVideo(v)) return null;
  const { provider: p, ref } = v;
  if (p === 'youtube') return ytEmbed(ref);
  if (p === 'vimeo') return `https://player.vimeo.com/video/${ref}?dnt=1&autoplay=1`;
  if (p === 'facebook') return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(ref)}&show_text=false&autoplay=true`;
  if (p === 'tiktok') return `https://www.tiktok.com/player/v1/${tiktokParts(ref).id}?autoplay=1&rel=0`;
  return null;
}

// Gatecast's own address for a video's still (same origin), or null when the provider has no public still (the
// facade then shows Gatecast's poster). YouTube keeps its existing api/yt-thumb address.
export function thumbPath(v) {
  if (!isVideo(v) || PROVIDERS[v.provider].still !== 'proxy') return null;
  if (v.provider === 'youtube') return ytThumb(v.ref);
  return `api/media-thumb?p=${v.provider}&id=${encodeURIComponent(v.ref)}`;
}

// The public oEmbed endpoint the server asks, or null (Facebook and Instagram need an app token: no check).
export function oembedUrl(v) {
  if (!isVideo(v) || !PROVIDERS[v.provider].check) return null;
  const { provider: p, ref } = v;
  const q = (u) => encodeURIComponent(u);
  if (p === 'youtube') return `https://www.youtube.com/oembed?url=${q(`https://www.youtube.com/watch?v=${ref}`)}&format=json`;
  if (p === 'vimeo') return `https://vimeo.com/api/oembed.json?url=${q(`https://vimeo.com/${ref}`)}`;
  if (p === 'x') return `https://publish.twitter.com/oembed?url=${q(`https://twitter.com/i/status/${ref}`)}&omit_script=1&dnt=true`;
  if (p === 'tiktok') return `https://www.tiktok.com/oembed?url=${q(originalUrl(v))}`;
  return null;
}

// Is this address a still on the provider's own image host? https, default port, no credentials.
export function thumbHostAllowed(provider, raw) {
  const allow = THUMB_HOSTS[provider];
  if (!allow) return false;
  let u;
  try { u = new URL(String(raw ?? '')); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return allow.exact.includes(h) || allow.suffix.some((s) => h.endsWith(`.${s}`));
}

const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
// 151 (seconds) -> "2:31"; 3845 -> "1:04:05"; null when not a sensible length.
export function secondsToClock(n) {
  const t = Math.round(Number(n));
  if (!Number.isFinite(t) || t <= 0 || t >= 100 * 3600) return null;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
// "PT2M31S" -> "2:31".
export function isoToClock(raw) {
  const m = /^P(?:T(?:(\d{1,2})H)?(?:(\d{1,3})M)?(?:(\d{1,5})S)?)$/i.exec(String(raw ?? '').trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return secondsToClock((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

// One oEmbed answer -> { state: 'ok', title, author, thumbUrl, duration } | { state: 'gone' } (the provider says it is
// removed, private or not embeddable: 400, 401, 403, 404, or not a video) | { state: 'failed' } (anything else; asked
// again later). thumbUrl is kept only when it is on the provider's own image host.
export function readOembed(provider, status, json) {
  if ([400, 401, 403, 404, 410].includes(status)) return { state: 'gone' };
  if (status !== 200 || !json || typeof json !== 'object' || Array.isArray(json)) return { state: 'failed' };
  const type = String(json.type || '');
  if (provider === 'x') { if (type && type !== 'rich') return { state: 'gone' }; }
  else if (type && type !== 'video') return { state: 'gone' };
  const thumb = typeof json.thumbnail_url === 'string' && thumbHostAllowed(provider, json.thumbnail_url) ? json.thumbnail_url : null;
  return {
    state: 'ok',
    title: clip(json.title, 200),
    author: clip(json.author_name, 100),
    thumbUrl: thumb,
    duration: provider === 'vimeo' ? secondsToClock(json.duration) : null,
  };
}

// "Video: <author> on <Provider>" (or "Video on <Provider>" when no author is known). For Facebook the page's own
// handle in the address stands in for the author.
export function authorOf(v) {
  if (v?.author) return clip(v.author, 100);
  if (v?.provider === 'facebook') { const m = /facebook\.com\/([A-Za-z0-9.\-_]+)\/videos\//.exec(String(v.ref)); return m ? m[1] : ''; }
  if (v?.provider === 'tiktok') return `@${tiktokParts(v.ref).handle}`;
  return '';
}
export function creditLine(v) {
  const name = providerName(v?.provider);
  if (!name) return '';
  const who = authorOf(v);
  return who ? `Video: ${who} on ${name}` : `Video on ${name}`;
}

/* ---------- Finding a video in an article page ---------- */

const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function tagAttrs(html, re) {
  const out = [];
  for (const m of String(html).matchAll(re)) {
    const a = {};
    for (const x of m[1].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) a[x[1].toLowerCase()] = decode(x[2] ?? x[3] ?? x[4] ?? '');
    a.__inner = m[2] ?? '';
    out.push(a);
    if (out.length > 400) break;
  }
  return out;
}
const VIDEO_META = ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player'];
const MAX_LD = 100 * 1024;

// The videos an article page embeds, from any provider, in the order a reader would meet them: the page's og:video
// or twitter:player tag, JSON-LD VideoObject embedUrl, then the players in the body (iframes, Facebook's fb-video
// blocks, X's video blockquotes, TikTok's embed blockquotes). Only tag attributes and JSON-LD video objects are read,
// never the page's text. At most `max`, without repeats: -> [{ provider, ref, duration }]. Instagram is left out
// (it cannot be embedded) and so is an X post unless the page marks it as a video. Not yet checked: the server asks
// each provider (lib/videos.js) and serves the first one that may be embedded.
export function findPageVideos(html, max = 5) {
  const doc = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  const seen = new Set();
  const add = (v, duration = null) => {
    if (!v || v.provider === 'instagram' || out.length >= max) return;
    const key = `${v.provider}:${v.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...v, duration });
  };
  const head = doc.split(/<\/head\s*>/i)[0].replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const metas = tagAttrs(head, /<meta\b([^>]*)>/gi).map((a) => ({ key: String(a.property || a.name || '').trim().toLowerCase(), value: a.content }));
  for (const key of VIDEO_META) for (const m of metas) if (m.key === key) { const v = parseVideoLink(m.value); if (v && v.provider !== 'x') add(v); }
  for (const m of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(m[1]) || m[2].length > MAX_LD) continue;
    let data;
    try { data = JSON.parse(m[2].trim()); } catch { continue; }
    for (const found of videoObjects(data)) add(found.v, found.duration);
  }
  const body = doc.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  // Players in the order they appear: iframes, fb-video blocks and X / TikTok blockquotes.
  const players = [];
  for (const m of body.matchAll(/<(iframe|div|blockquote)\b([^>]*)>/gi)) {
    const [a] = tagAttrs(`<x ${m[2]}>`, /<x\b([^>]*)>/g);
    players.push({ tag: m[1].toLowerCase(), a, at: m.index });
    if (players.length > 400) break;
  }
  for (const { tag, a, at } of players) {
    const cls = ` ${String(a.class || '').toLowerCase()} `;
    if (tag === 'iframe') {
      for (const src of [a.src, a['data-src'], a['data-lazy-src']]) { const v = parseVideoLink(src); if (v && v.provider !== 'x') { add(v); break; } }
      const x = parseVideoLink(a.src || a['data-src']);
      if (x && x.provider === 'x') add(x);
    } else if (tag === 'div' && cls.includes(' fb-video ')) {
      const v = parseVideoLink(a['data-href']);
      if (v && v.provider === 'facebook') add(v);
    } else if (tag === 'blockquote' && cls.includes(' tiktok-embed ')) {
      const v = parseVideoLink(a.cite);
      if (v && v.provider === 'tiktok') add(v);
    } else if (tag === 'blockquote' && (cls.includes(' twitter-video ') || cls.includes(' twitter-tweet '))) {
      const inner = body.slice(at, at + 4000).split(/<\/blockquote\s*>/i)[0];
      const links = tagAttrs(inner, /<a\b([^>]*)>/gi).map((l) => l.href).filter(Boolean);
      const status = links.find((h) => parseVideoLink(h)?.provider === 'x');
      // A plain tweet embed counts only when it links to the post's video (…/status/<id>/video/1).
      if (status && (cls.includes(' twitter-video ') || /\/status\/\d+\/video\//.test(status))) add(parseVideoLink(status));
    }
  }
  return out;
}
function videoObjects(data) {
  const out = [];
  const stack = [[data, 0]];
  let seen = 0;
  while (stack.length && seen < 500 && out.length < 5) {
    const [node, depth] = stack.shift();
    seen++;
    if (Array.isArray(node)) { if (depth < 6) for (const x of node) stack.push([x, depth + 1]); continue; }
    if (!node || typeof node !== 'object') continue;
    const type = node['@type'];
    if ((Array.isArray(type) ? type : [type]).some((t) => String(t || '') === 'VideoObject')) {
      const v = parseVideoLink(Array.isArray(node.embedUrl) ? node.embedUrl[0] : node.embedUrl);
      if (v && v.provider !== 'x') out.push({ v, duration: isoToClock(node.duration) });
    }
    if (depth < 6) for (const val of Object.values(node)) if (val && typeof val === 'object') stack.push([val, depth + 1]);
  }
  return out;
}

/* ---------- The video as the page shows it ---------- */

// A video from /api/weird (media.video: { provider, id, title, author, duration }) as the page shows it, or null.
// The still and the post's address are rebuilt here from the provider and id: whatever else the server sent, the
// page never asks a provider for anything before Play. id and channel mirror ref and author, so the YouTube-era code
// (and its tests) read it unchanged.
export function cleanVideo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const provider = raw.provider;
  const ref = typeof raw.id === 'string' ? raw.id : typeof raw.ref === 'string' ? raw.ref : '';
  if (!isValidRef(provider, ref)) return null;
  const v = { provider, ref };
  const author = clip(raw.author ?? raw.channel, 100);
  const duration = typeof raw.duration === 'string' && /^(?:\d{1,2}:)?[0-5]?\d:[0-5]\d$/.test(raw.duration.trim()) ? raw.duration.trim() : null;
  return {
    provider, ref, id: ref, name: providerName(provider),
    title: clip(raw.title, 200), author, channel: author, duration,
    thumb: thumbPath(v), url: originalUrl(v), embeddable: PROVIDERS[provider].play !== 'link',
    aspect: PROVIDERS[provider].aspect,
  };
}
// The YouTube-only field of older answers (youtube: { id, title, channel, duration }) in the same shape.
export const fromYoutube = (y) => (y && isVideoId(y.id) ? cleanVideo({ provider: 'youtube', id: y.id, title: y.title, author: y.channel, duration: y.duration }) : null);
