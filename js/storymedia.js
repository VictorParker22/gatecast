// Story media rules shared by the front page (js/front.js, js/frontmodel.js, js/frontmedia.js) and the reviewer
// console's pick form (js/review.js, js/reviewmodel.js): reading a YouTube link, the editor's picture rule, and the
// same-origin addresses the page uses for a video. No DOM and no network, so it is unit-tested with plain Node
// (tests/storymedia.test.mjs). The server keeps its own copy of the two parsing rules in lib/youtube.js (CommonJS);
// tests/storymedia.test.mjs checks that both copies agree.

export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id) => typeof id === 'string' && YT_ID.test(id);

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

// A YouTube link in any common form -> its 11-character video id, or null:
//   youtube.com/watch?v=ID, m.youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID,
//   youtube.com/live/ID, youtube.com/v/ID, youtube-nocookie.com/embed/ID. http or https, with or without the scheme,
//   extra parameters (t=, si=, list=) ignored. Anything else (another site, a channel, a playlist, a search, a
//   look-alike host such as youtube.com.evil.example) is null. A bare id is not a link and is null too.
export function youtubeId(raw) {
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

/* ---------- Same-origin addresses for a video ---------- */

// The video still, served by Gatecast (api/yt-thumb.js), so nothing contacts YouTube until Play. Relative to the page.
export const ytThumb = (id) => (isVideoId(id) ? `api/yt-thumb?id=${id}` : null);
// The player, only ever built after Play: YouTube's privacy-enhanced domain.
export const ytEmbed = (id) => (isVideoId(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null);
// The video on YouTube itself (a link out, e.g. in the console's preview).
export const ytWatch = (id) => (isVideoId(id) ? `https://www.youtube.com/watch?v=${id}` : null);

// "2:31" or "1:04:05", the way a video's length is shown on the facade; null when it is not one.
export const DURATION = /^(?:\d{1,2}:)?[0-5]?\d:[0-5]\d$/;
export const cleanDuration = (d) => (typeof d === 'string' && DURATION.test(d.trim()) ? d.trim() : null);

/* ---------- The editor's picture rule ---------- */

// Public suffixes with more than one label that a news outlet or its image CDN is likely to sit under. Not the whole
// Public Suffix List: for any other name the last two labels are the registrable domain.
const MULTI = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'co.za', 'org.za', 'gov.za', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.mx', 'com.ar', 'com.tr', 'com.sg', 'com.hk', 'com.tw', 'co.kr', 'or.kr', 'com.my', 'co.id', 'co.il',
  'com.ph', 'com.pk', 'com.ng', 'co.ke', 'com.eg', 'com.sa', 'com.ua', 'co.th',
  // Shared hosting where every customer has their own subdomain.
  'blogspot.com', 'wordpress.com', 'github.io', 'substack.com', 'netlify.app', 'vercel.app', 'pages.dev', 'herokuapp.com', 'appspot.com',
]);

// A dotted public host name by its shape (no address literal, no local name), lower-case, or null.
export function publicHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.([a-z]{2,63}|xn--[a-z0-9-]+)$/.test(h) || h.includes('..')) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|invalid|test|example)$/.test(h)) return null;
  return h;
}

// "cdnph.upi.com" -> "upi.com"; "news.bbc.co.uk" -> "bbc.co.uk". null for a name that is not a public host.
export function registrableDomain(host) {
  const h = publicHost(host);
  if (!h) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  const two = labels.slice(-2).join('.');
  if (MULTI.has(two)) return labels.length >= 3 ? labels.slice(-3).join('.') : null;
  return two;
}

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

// The outlet in data/weird-sources.json a story belongs to: by its name, or by the story address's registrable domain
// matching the outlet's home page or feed. null when it is none of them.
export function sourceFor(storyUrl, outlet, sources) {
  const list = Array.isArray(sources) ? sources : [];
  const name = String(outlet ?? '').trim().toLowerCase();
  const byName = name ? list.find((s) => String(s?.name ?? '').toLowerCase() === name) : null;
  const dom = registrableDomain(hostOf(storyUrl));
  const byDomain = dom ? list.find((s) => [s?.home, s?.homepage, s?.feed].some((u) => u && registrableDomain(hostOf(u)) === dom)) : null;
  // The address decides when both match different outlets: a picture rule follows the site the story is on.
  return byDomain || byName || null;
}

// Hosts listed for an outlet's pictures (its image CDN), lower-case.
const listedHosts = (src) => (Array.isArray(src?.imageHosts) ? src.imageHosts.filter((h) => typeof h === 'string').map((h) => h.toLowerCase()) : []);

// Why the editor's picture cannot be used for this story, or null when it can (an empty field is fine):
// an https address, no credentials or port, a public host, not an SVG, and on the story's own site (the same
// registrable domain as the story's address) or on a host listed for that outlet in data/weird-sources.json
// (imageHosts, or a subdomain of one). An outlet whose pictures are switched off ("images": false) takes none.
export function pickImageProblem(imageUrl, storyUrl, { outlet = '', sources = [] } = {}) {
  const s = String(imageUrl ?? '').trim();
  if (!s) return null;
  if (s.length > 2048) return 'That picture link is too long.';
  let u;
  try { u = new URL(s); } catch { return 'Use the picture’s full link, starting https://'; }
  if (u.protocol !== 'https:') return 'Use the picture’s https:// link.';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'Use the picture’s plain https:// link.';
  const host = publicHost(u.hostname);
  if (!host) return 'Link to a picture on a public website.';
  if (/\.svgz?$/i.test(u.pathname)) return 'SVG pictures are not shown. Use the story’s photo.';
  const src = sourceFor(storyUrl, outlet, sources);
  if (src && src.images === false) return `${src.name} is shown without pictures. Leave this empty.`;
  const storyDom = registrableDomain(hostOf(storyUrl));
  if (!storyDom) return 'Add the story link first: the picture must come from the story’s own site.';
  if (registrableDomain(host) === storyDom) return null;
  if (listedHosts(src).some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return `Use a picture from the story’s own site (${storyDom})${listedHosts(src).length ? ` or ${listedHosts(src).join(', ')}` : ''}.`;
}

// The YouTube field: null when empty or a usable link; otherwise one sentence.
export function pickVideoProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (isVideoId(s)) return 'Paste the whole YouTube link, not just the code.';
  return youtubeId(s) ? null : 'Use a YouTube video link, like https://www.youtube.com/watch?v=… or https://youtu.be/…';
}
