// The media slot of a weird story on the front page and in story mode (js/tvscreen.js), as markup strings: the
// publisher's picture, the click-to-play video facade, the small "Has video" control and, only after Play, the
// provider's player. Which one a story gets is storyMedia() in js/frontmodel.js; a story with neither picture nor
// video gets no slot at all (the text-led layout, built by js/front.js). No DOM and no network, so the rule that
// matters is tested with plain Node (tests/storymedia.test.mjs, tests/mediaproviders.test.mjs): before Play, nothing
// here points a visitor's browser at any video provider. The facade's still is Gatecast's own (api/yt-thumb,
// api/media-thumb) or Gatecast's own poster; the provider's player exists only in playerFor(), which js/front.js calls
// from the Play button's click handler. Instagram never embeds: its facade is a plain link to the post.
import { storyMedia, videoLabel, playLabel } from './frontmodel.js';
import { ytEmbed, isVideoId } from './storymedia.js';
import { embedSrc, isVideo, originalUrl, providerName } from './mediaproviders.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  camera: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  film: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></svg>',
};

// The picture's link: by default the story's own address; story mode and the front page pass `href` (the story's
// Gatecast address) so a click opens the story here instead of leaving the site.
function pictureHTML(x, m, { cls, w, h, eager, href, link = true }) {
  const img = `<img class="${cls}__img" src="${esc(m.image)}" alt="" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-pic="${esc(m.image)}">`;
  if (!link) return `${img}<span class="credit">${ICON.camera}${esc(m.credit)}</span>`;
  return `<a class="smedia__link" href="${esc(href || x.url)}"${href ? '' : ' rel="noopener"'} tabindex="-1" aria-hidden="true"${href ? ` data-story-id="${esc(x.id)}"` : ''}><img class="${cls}__img" src="${esc(m.image)}" alt="" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-pic="${esc(m.image)}"></a><span class="credit">${ICON.camera}${esc(m.credit)}</span>`;
}

// The provider's provider id, "youtube" for the YouTube shape of older answers.
const providerOf = (v) => v?.provider || 'youtube';
const refOf = (v) => v?.ref || v?.id;

// Gatecast's own poster for a provider without a public still (Facebook, X, Instagram): a halftone card with the
// provider's name in Gatecast's signage type. Never the provider's logo.
const posterHTML = (v) => `<span class="vplay__poster vplay__poster--${esc(providerOf(v))}" aria-hidden="true"><span class="vplay__brand">${esc(providerName(providerOf(v)) || 'Video')}</span><span class="vplay__kind">VIDEO</span></span>`;

// The facade: one real button over the still (served by Gatecast) or Gatecast's poster, a play knob, the length when
// known, and the visible label "Video: <author> on <Provider>". data-play carries the reference; js/front.js swaps in
// playerFor() on click. Instagram, which cannot be embedded, is a link to the post instead.
function facadeHTML(x, v, { eager }) {
  const still = v.thumb ? `<img class="vplay__img" src="${esc(v.thumb)}" alt="" width="480" height="360" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-still>` : posterHTML(v);
  const credit = `<span class="credit credit--video" aria-hidden="true">${ICON.film}${esc(videoLabel(v))}</span>`;
  if (v.embeddable === false) {
    return `<a class="vplay vplay--link" href="${esc(v.url)}" rel="noopener" aria-label="${esc(`Watch the video on ${v.name}${v.title ? `: ${v.title}` : ''} (opens ${v.name})`)}">
      ${still}<span class="vplay__knob vplay__knob--out" aria-hidden="true">${ICON.out}</span></a>${credit}`;
  }
  return `<button type="button" class="vplay vplay--${esc(providerOf(v))}" data-play="${esc(refOf(v))}" aria-label="${esc(playLabel(v))}">
      ${still}
      <span class="vplay__knob" aria-hidden="true">${ICON.play}</span>${v.duration ? `<span class="vplay__dur" aria-hidden="true">${esc(v.duration)}</span>` : ''}
    </button>${credit}`;
}

// The small control on a picture when the story also has a video. Its accessible name starts with its visible words
// ("Has video"), then says what Play does. For Instagram it is a link to the post.
const chipHTML = (v) => (v.embeddable === false
  ? `<a class="vchip" href="${esc(v.url)}" rel="noopener" aria-label="${esc(`Has video. Watch it on ${v.name} (opens ${v.name})`)}"><span class="vchip__knob" aria-hidden="true">${ICON.out}</span>Has video</a>`
  : `<button type="button" class="vchip" data-play="${esc(refOf(v))}" aria-label="${esc(`Has video. ${playLabel(v)}`)}"><span class="vchip__knob" aria-hidden="true">${ICON.play}</span>Has video</button>`);

// The media slot's inner markup for a story, or '' for the text-led layout. opts: { cls: 'lead' | 'fav' | 'card' |
// 'stv', w, h, eager, failed (pictures that did not load), extra (markup placed inside the slot, e.g. card stickers),
// href (where the picture links: the story's Gatecast address), link: false (the picture links nowhere: story mode) }.
//   -> { kind, html }
export function mediaSlot(x, { cls, w = 640, h = 400, eager = false, failed, extra = '', href = '', link = true } = {}) {
  const m = storyMedia(x, failed);
  if (m.kind === 'text') return { kind: 'text', html: '' };
  const inner = m.kind === 'image'
    ? pictureHTML(x, m, { cls, w, h, eager, href, link }) + (m.video ? chipHTML(m.video) : '')
    : facadeHTML(x, m.video, { eager });
  const aspect = m.kind === 'video' && m.video.provider && m.video.provider !== 'youtube' ? ` data-provider="${esc(m.video.provider)}"` : '';
  return { kind: m.kind, html: `<div class="${cls}__media smedia smedia--${m.kind}" data-story="${esc(x.url)}"${aspect}>${extra}${inner}</div>` };
}

// The YouTube player, as before (kept for callers that have only an id).
export function playerHTML(id, title = '') {
  const src = ytEmbed(id);
  if (!src || !isVideoId(id)) return '';
  return `<iframe class="smedia__player" src="${esc(src)}" title="${esc(title ? `Video: ${title}` : 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

// The player for any provider, built only from the Play button's click handler:
// - YouTube, Vimeo, Facebook, TikTok: the provider's own embed player in an iframe (embedSrc: youtube-nocookie.com,
//   Vimeo with dnt=1, Facebook's video plugin, TikTok's player), autoplaying because the reader pressed Play.
//   Facebook's plugin cannot be checked beforehand, so a link to the post sits beside it in case it will not play.
// - X: the post as X's own embed (a blockquote that X's widgets.js, loaded by js/front.js after Play, turns into the
//   player). Instagram: never (its facade is a link).
// v: a cleaned video (js/mediaproviders.js cleanVideo) or the YouTube shape { id, title }.
export function playerFor(v) {
  const video = { provider: providerOf(v), ref: refOf(v) };
  if (!isVideo(video)) return '';
  const title = v.title ? `Video: ${v.title}` : `Video on ${providerName(video.provider)}`;
  if (video.provider === 'x') {
    return `<div class="smedia__x"><blockquote class="twitter-tweet" data-dnt="true" data-conversation="none"><a href="${esc(`https://twitter.com/i/status/${video.ref}`)}">${esc(title)}</a></blockquote></div>`;
  }
  const src = embedSrc(video);
  if (!src) return '';
  const frame = `<iframe class="smedia__player smedia__player--${esc(video.provider)}" src="${esc(src)}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return video.provider === 'facebook'
    ? `${frame}<a class="smedia__orig" href="${esc(originalUrl(video))}" rel="noopener">Not playing? Open it on Facebook</a>`
    : frame;
}
