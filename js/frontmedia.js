// The media slot of a weird story on the front page, as markup strings: the publisher's picture, the click-to-play
// video facade, the small "Has video" control and, only after Play, the player. Which one a story gets is
// storyMedia() in js/frontmodel.js; a story with neither picture nor video gets no slot at all (the text-led layout,
// built by js/front.js). No DOM and no network, so the rule that matters is tested with plain Node
// (tests/storymedia.test.mjs): before Play, nothing here points a visitor's browser at YouTube. The facade's still
// is Gatecast's own api/yt-thumb; the youtube-nocookie.com player exists only in playerHTML(), which js/front.js
// calls from the Play button's click handler.
import { storyMedia, videoLabel, playLabel } from './frontmodel.js';
import { ytEmbed, isVideoId } from './storymedia.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  camera: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  film: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
};

// The publisher's picture: hotlinked, lazy (eager for the lead), no referrer, credited. The picture repeats the
// headline's link for mouse and touch only (out of the tab order, hidden from assistive tech, so alt is empty).
function pictureHTML(x, m, { cls, w, h, eager }) {
  return `<a class="smedia__link" href="${esc(x.url)}" rel="noopener" tabindex="-1" aria-hidden="true"><img class="${cls}__img" src="${esc(m.image)}" alt="" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-pic="${esc(m.image)}"></a><span class="credit">${ICON.camera}${esc(m.credit)}</span>`;
}

// The facade: one real button over the still (served by Gatecast), a play knob, the length when known, and the
// visible label "Video: <channel> on YouTube". data-play carries the id; js/front.js swaps in playerHTML on click.
function facadeHTML(x, v, { eager }) {
  return `<button type="button" class="vplay" data-play="${esc(v.id)}" aria-label="${esc(playLabel(v))}">
      <img class="vplay__img" src="${esc(v.thumb)}" alt="" width="480" height="360" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-still>
      <span class="vplay__knob" aria-hidden="true">${ICON.play}</span>${v.duration ? `<span class="vplay__dur" aria-hidden="true">${esc(v.duration)}</span>` : ''}
    </button><span class="credit credit--video" aria-hidden="true">${ICON.film}${esc(videoLabel(v))}</span>`;
}

// The small control on a picture when the story also has a video.
// Its accessible name starts with its visible words ("Has video"), then says what Play does.
const chipHTML = (v) => `<button type="button" class="vchip" data-play="${esc(v.id)}" aria-label="${esc(`Has video. ${playLabel(v)}`)}"><span class="vchip__knob" aria-hidden="true">${ICON.play}</span>Has video</button>`;

// The media slot's inner markup for a story, or '' for the text-led layout. opts: { cls: 'lead' | 'fav' | 'card',
// w, h, eager, failed (pictures that did not load), extra (markup placed inside the slot, e.g. card stickers) }.
//   -> { kind, html }
export function mediaSlot(x, { cls, w = 640, h = 400, eager = false, failed, extra = '' } = {}) {
  const m = storyMedia(x, failed);
  if (m.kind === 'text') return { kind: 'text', html: '' };
  const inner = m.kind === 'image'
    ? pictureHTML(x, m, { cls, w, h, eager }) + (m.video ? chipHTML(m.video) : '')
    : facadeHTML(x, m.video, { eager });
  return { kind: m.kind, html: `<div class="${cls}__media smedia smedia--${m.kind}" data-story="${esc(x.url)}">${extra}${inner}</div>` };
}

// The player, built only from the Play button's click handler: YouTube's privacy-enhanced embed, autoplaying, no
// related videos from other channels. title names it for screen readers.
export function playerHTML(id, title = '') {
  const src = ytEmbed(id);
  if (!src || !isVideoId(id)) return '';
  return `<iframe class="smedia__player" src="${esc(src)}" title="${esc(title ? `Video: ${title}` : 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
