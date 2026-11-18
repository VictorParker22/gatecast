// Story mode ("Gatecast TV", js/tvscreen.js): the pure part. Which story is on which channel, the shareable address of
// a story, what the screen shows for a pick and for a feed story, and the "Next on Gatecast" strip. No DOM and no
// network, so it is unit-tested with plain Node (tests/tv.test.mjs).
//
// What the screen shows (owner decisions, 17 Nov 2026): the outlet's headline, its preview picture or the video
// facade (the provider loads only after Play), the editor's hook and, on a pick, the editor's own 2-4 sentence summary
// labelled "In our words", the Weird-o-meter, credits, and the big "Read the full story at <outlet>" button, which
// always links to the original. Never the outlet's article text, and never the outlet's page in a frame.
import { catLabel, longDate, shortDate, storyMedia, videoLabel } from './frontmodel.js';

export const STORY_PARAM = 'story';
export const SITE = 'https://www.thegatecast.com/'; // the same address as lib/site.js SITE_ORIGIN (tested)
export const SUMMARY_LABEL = 'In our words';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isStoryId = (id) => typeof id === 'string' && ID.test(id);

/* ---------- Shareable addresses: /?story=<id> ---------- */

// The link on the page for a story: relative, so it works on any deployment (and opens story mode on load).
export const storyHref = (id) => (isStoryId(id) ? `?${STORY_PARAM}=${id}` : null);
// The address to share: the site's front page with ?story=<id>.
export function shareUrl(id, base = SITE) {
  if (!isStoryId(id)) return null;
  try { const u = new URL(base); u.search = `?${STORY_PARAM}=${id}`; u.hash = ''; return u.href; } catch { return null; }
}
// The story an address asks for (?story=<id>), or null. Accepts a full address, a search string or a URL.
export function storyFromUrl(href) {
  let params;
  try {
    const s = String(href ?? '');
    params = s.startsWith('?') || !s.includes(':') ? new URLSearchParams(s.split('#')[0].replace(/^[^?]*\?/, '')) : new URL(s).searchParams;
  } catch { return null; }
  const id = params.get(STORY_PARAM);
  return isStoryId(id) ? id : null;
}
// The same address with ?story=<id> set (or removed when id is null), every other part kept.
export function urlWithStory(href, id) {
  let u;
  try { u = new URL(String(href)); } catch { return null; }
  if (isStoryId(id)) u.searchParams.set(STORY_PARAM, id);
  else u.searchParams.delete(STORY_PARAM);
  return u.href;
}

/* ---------- Channels ---------- */

// The stories in the order a reader meets them on the page: the lead, the favourites row, then everything else in the
// server's order (Also odd, then the grid). Each story once. favUrls: the favourites row's stories (js/front.js
// view.skip).
export function channelOrder(items, favUrls = []) {
  const list = Array.isArray(items) ? items.filter((x) => x && isStoryId(x.id)) : [];
  if (!list.length) return [];
  const favs = new Set(favUrls);
  const [lead, ...rest] = list;
  const inFavs = favUrls.map((u) => rest.find((x) => x.url === u)).filter(Boolean);
  return [lead, ...inFavs, ...rest.filter((x) => !favs.has(x.url))];
}

export const channelLabel = (n) => `CH ${String(Math.max(0, n | 0)).padStart(2, '0')}`;

// Where a story sits: { story, index, number, total, prev, next } (prev and next wrap around), or null.
export function channelOf(order, id) {
  const list = Array.isArray(order) ? order : [];
  const index = list.findIndex((x) => x.id === id);
  if (index < 0) return null;
  const total = list.length;
  return {
    story: list[index], index, number: index + 1, total,
    prev: total > 1 ? list[(index - 1 + total) % total] : null,
    next: total > 1 ? list[(index + 1) % total] : null,
  };
}

// "Next on Gatecast": up to n other stories, the same category first, each group in channel order starting after the
// current story (so the strip moves on as the reader does).
export function relatedStories(order, id, n = 4) {
  const at = channelOf(order, id);
  if (!at) return [];
  const after = [...order.slice(at.index + 1), ...order.slice(0, at.index)];
  const same = after.filter((x) => x.category === at.story.category);
  const other = after.filter((x) => x.category !== at.story.category);
  return [...same, ...other].slice(0, n);
}

/* ---------- What the screen shows ---------- */

// One story as the screen shows it. Feed stories: headline, picture or video, credits and the read-more button.
// Picks add the editor's hook and, when written, the summary ("In our words").
export function tvView(x, { locale = 'en-GB', timeZone, failed } = {}) {
  if (!x) return null;
  const media = storyMedia(x, failed);
  const credits = [];
  if (media.kind === 'image') credits.push(`Picture: ${x.outlet}`);
  if (media.video) credits.push(videoLabel(media.video));
  return {
    id: x.id, url: x.url, title: x.title, outlet: x.outlet, pick: Boolean(x.pick), category: x.category,
    kicker: catLabel(x.category).toUpperCase(),
    date: longDate(x.ms, locale, timeZone), dateShort: shortDate(x.ms, locale, timeZone),
    media: media.kind, video: media.video || null,
    hook: x.pick && x.note ? x.note : null,
    summary: x.pick && x.summary ? x.summary : null,
    summaryLabel: SUMMARY_LABEL,
    readMore: { href: x.url, label: `Read the full story at ${x.outlet}` },
    credits,
    // What the screen says it is showing, in plain words, when there is no summary.
    only: x.pick && x.summary ? '' : `We show ${media.kind === 'image' ? 'the headline and the outlet’s own preview picture' : media.kind === 'video' ? 'the headline and the video' : 'the headline'} here. The full story is at ${x.outlet}.`,
  };
}
