// Pure logic for the weird-news front page (index.html): what /api/weird returned, re-checked; the lead, the
// "also odd" list and the grid; categories and their counts; datelines in pixel type; the edition strip; the
// starburst polygon; the reader's own streak (this device only); tip checks; the Weird-o-meter needle.
// No DOM and no network, so it is unit-tested with plain Node (tests/front.test.mjs).
import { isVideoId, ytThumb, cleanDuration } from './storymedia.js';
import { cleanVideo, fromYoutube, providerName } from './mediaproviders.js';

export const CATEGORIES = [
  ['people', 'Weird people'], ['animals', 'Strange animals'], ['laws', 'Odd laws'], ['records', 'World records'],
  ['unexplained', 'Unexplained'], ['weather', 'Weird weather'], ['other', 'Other oddities'],
];
const LABEL = Object.fromEntries(CATEGORIES);
export const catLabel = (id) => LABEL[id] || LABEL.other;
export const isCategory = (id) => Object.hasOwn(LABEL, id);

// Sticker inks per category, from the decorative palette only (cobalt, sun, lime, paper, ink): never a risk colour.
const STICKER = { people: 'cobalt', animals: 'sun', laws: 'card', records: 'lime', unexplained: 'ink', weather: 'cobalt', other: 'card' };
export const stickerTone = (cat) => STICKER[cat] || 'card';

const httpsUrl = (u) => {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try { const x = new URL(u.trim()); return x.protocol === 'https:' && x.hostname.includes('.') && !x.username && !x.password ? x.href : null; } catch { return null; }
};
const text = (s, max = 400) => (typeof s === 'string' && s.trim() ? s.trim().replace(/\s+/g, ' ').slice(0, max) : null);

// One item from /api/weird as the page will show it, or null when it lacks a title, an outlet, an https link or a date.
// Everything shown comes from the item; nothing is filled in (no rating, no picture made up). summary is the editor's
// own "In our words" summary, on picks only; a feed story never has one.
// player: the story's video from any provider (media.video, else the older youtube field), cleaned by
// js/mediaproviders.js cleanVideo, which rebuilds the still and the post's address from the provider and id.
export function cleanItem(x) {
  if (!x || typeof x !== 'object') return null;
  const title = text(x.title, 300), outlet = text(x.outlet, 80), url = httpsUrl(x.url);
  const ms = Date.parse(x.published);
  if (!title || !outlet || !url || !Number.isFinite(ms)) return null;
  const rating = Number.isInteger(x.rating) && x.rating >= 1 && x.rating <= 5 ? x.rating : null;
  const image = httpsUrl(x.image);
  const youtube = cleanYoutube(x.youtube);
  const player = cleanVideo(x.media?.video) || fromYoutube(youtube);
  const pick = x.pick === true;
  return {
    id: text(x.id, 120) || url, title, url, outlet, outletUrl: httpsUrl(x.outletUrl), published: new Date(ms).toISOString(), ms,
    category: isCategory(x.category) ? x.category : 'other',
    image: image && !/\.svgz?(\?|$)/i.test(image) ? image : null,
    imageCredit: image ? (text(x.imageCredit, 80) || `Image: ${outlet}`) : null,
    video: x.video === true || Boolean(youtube) || Boolean(player), youtube, player, pick, rating, note: text(x.note, 280),
    summary: pick ? text(x.summary, 700) : null,
  };
}

// A story's YouTube video as the page shows it, or null. The still is always Gatecast's own address
// (api/yt-thumb?id=…), built here from the id: whatever else the server sent, the page never asks YouTube for anything
// before Play.
export function cleanYoutube(v) {
  if (!v || typeof v !== 'object' || !isVideoId(v.id)) return null;
  return { id: v.id, title: text(v.title, 200) || '', channel: text(v.channel, 100) || '', duration: cleanDuration(v.duration), thumb: ytThumb(v.id) };
}

// What a story shows where a picture would go, and so which layout it gets (lead, favourites, grid cards):
//   'image': the publisher's picture (with a small "Has video" play control when there is a video too);
//   'video': a click-to-play facade (the still from Gatecast, a play button, the length when known, the channel);
//   'text':  neither. The front page and story mode then show Gatecast's category illustration (artFor, below),
//            labelled as such; never an empty box.
// failed: a set of picture addresses that did not load (or were a pixel) on this page; they count as no picture.
export function storyMedia(x, failed) {
  const image = x?.image && !(failed && failed.has(x.image)) ? x.image : null;
  const video = x?.player || (x?.youtube && isVideoId(x.youtube.id) ? x.youtube : null);
  if (image) return { kind: 'image', image, credit: x.imageCredit || `Image: ${x.outlet}`, video };
  if (video) return { kind: 'video', image: null, credit: null, video };
  return { kind: 'text', image: null, credit: null, video: null };
}

// Gatecast's own illustration for a story with neither picture nor video (owner decision, 17 Nov 2026: no text-only
// cards; readers come for pictures). One per category, drawn for Gatecast in its own zine style, never a picture of
// the story itself: the slot says "Illustration" so nobody takes it for the outlet's photo. Files: assets/art/<cat>-<w>.webp.
export const ART_CATEGORIES = ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other'];
export const ART_CREDIT = 'Illustration: Gatecast';
export function artFor(category) {
  const c = ART_CATEGORIES.includes(category) ? category : 'other';
  const at = (w) => `assets/art/${c}-${w}.webp`;
  return { category: c, src: at(480), srcset: `${at(240)} 240w, ${at(480)} 480w, ${at(960)} 960w`, credit: ART_CREDIT, width: 960, height: 645 };
}

// The facade's visible label and the play button's name, in plain words.
// Any provider: "Video: <author> on <Provider>"; a video without a provider is the YouTube shape of older answers.
const nameOf = (v) => v?.name || providerName(v?.provider) || 'YouTube';
export const videoLabel = (v) => (v?.channel ? `Video: ${v.channel} on ${nameOf(v)}` : `Video on ${nameOf(v)}`);
export function playLabel(v) {
  if (!v) return '';
  const len = v.duration ? `, ${durationWords(v.duration)}` : '';
  return `Play the video${v.title ? `: ${v.title}` : ''} (${v.channel ? `${v.channel} on ${nameOf(v)}` : nameOf(v)}${len})`;
}
// "2:31" -> "2 minutes 31 seconds"; "1:04:05" -> "1 hour 4 minutes 5 seconds".
export function durationWords(d) {
  const parts = String(d || '').split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return '';
  const [h, m, sec] = parts.length === 3 ? parts : [0, ...parts];
  const w = (n, unit) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '');
  return [w(h, 'hour'), w(m, 'minute'), w(sec, 'second')].filter(Boolean).join(' ');
}

// The response, re-checked. Order is kept as the server sent it (editor's picks first, then newest).
export function cleanWeird(json) {
  const seen = new Set();
  const items = (Array.isArray(json?.items) ? json.items : []).map(cleanItem).filter((x) => x && !seen.has(x.url) && seen.add(x.url));
  return { items, counts: catCounts(json?.categories, items), checkedAt: Number.isFinite(Date.parse(json?.checkedAt)) ? json.checkedAt : null };
}

// Counts per category for the filter chips: the server's counts when it sent them, else counted from the items.
// "all" is always the number of items the page actually has.
export function catCounts(fromApi, items) {
  const out = { all: items.length };
  for (const [id] of CATEGORIES) {
    const n = fromApi && Number.isInteger(fromApi[id]) && fromApi[id] >= 0 ? fromApi[id] : items.filter((x) => x.category === id).length;
    out[id] = n;
  }
  return out;
}

// The page's layout: the lead is the first item (the server puts the editor's picks first); "Also odd" is the next
// four that are not already in the favourites; the rest is the grid. Nothing appears twice above the grid.
export function splitFront(items, skip = []) {
  const list = Array.isArray(items) ? items : [];
  const lead = list[0] || null;
  const away = new Set(skip);
  const others = list.slice(1).filter((x) => !away.has(x.url));
  return { lead, also: others.slice(0, 4), rest: others.slice(4) };
}

// What the grid shows for a category filter. "all" skips what is already on the page above it (lead, favourites,
// Also odd); a category shows every story in it. shown = how many cards are revealed (8 at a time).
export const PAGE = 8;
export function gridFor(items, cat = 'all', shown = PAGE, skip = []) {
  const { rest } = splitFront(items, skip);
  const pool = cat === 'all' ? rest : items.filter((x) => x.category === cat);
  const n = Math.max(0, Math.min(pool.length, shown));
  return { list: pool.slice(0, n), total: pool.length, left: pool.length - n };
}

// Favourites, right after the lead (owner decision, 17 Nov 2026): the editor's order until a story has real votes,
// then readers' votes rank the row. A story ranks by readers' votes once it has at least 10 Weird-o-meter votes in
// the last 7 days: `favs` is loadFavourites() from js/community.js, already in the database's order (best average,
// then most votes; the average itself is only shown from 50 votes). Those stories come first, in that order; the
// rest of the row is the editor's picks in the editor's order (the order /api/weird sent them). `ids` maps each
// item's url to its story id (storyId(url) in js/community.js). The lead is never repeated here. Never invents
// reader data: a story without 10 votes this week is never shown as a reader favourite.
//   -> { mode: 'readers' | 'editor' | 'none', list: [{ ...item, by: 'readers' | 'editor', votes?, average? }] }
export const FAV_MIN_VOTES = 10;
export const FAV_COUNT = 3;
export function favourites(items, favs = [], ids = {}, n = FAV_COUNT) {
  const list = (Array.isArray(items) ? items : []).slice(1);
  const byId = new Map();
  for (const x of list) { const id = ids && ids[x.url]; if (typeof id === 'string' && !byId.has(id)) byId.set(id, x); }
  const out = [];
  const taken = new Set();
  for (const f of Array.isArray(favs) ? favs : []) {
    const x = f && byId.get(f.storyId);
    if (!x || taken.has(x.url) || !Number.isInteger(f.count) || f.count < FAV_MIN_VOTES) continue;
    taken.add(x.url);
    out.push({ ...x, by: 'readers', votes: f.count, average: Number.isFinite(f.average) && f.count >= 50 ? f.average : null });
  }
  const voted = out.length;
  for (const x of list) if (x.pick && !taken.has(x.url)) { taken.add(x.url); out.push({ ...x, by: 'editor' }); }
  const row = out.slice(0, n);
  return { mode: voted ? 'readers' : row.length ? 'editor' : 'none', list: row };
}

// The section's heading and kicker, honest about who ranked the row: "Editor's favourites" while no story has 10
// votes this week, "Reader favourites — ranked by Weird-o-meter votes" once one does (and, when the editor's
// picks fill the rest of the row, the kicker says so).
export function favCaption(f) {
  if (f?.mode === 'readers') {
    const mixed = f.list.some((x) => x.by === 'editor');
    return {
      title: 'Reader favourites', how: 'ranked by Weird-o-meter votes',
      kicker: mixed ? "10+ READER VOTES THIS WEEK RANK FIRST · THEN THE EDITOR'S PICKS" : '10+ READER VOTES IN THE PAST 7 DAYS · BEST AVERAGE FIRST',
    };
  }
  return { title: 'Editor’s favourites', how: '', kicker: "THE EDITOR'S ORDER · READERS' VOTES RANK IT FROM 10 IN A WEEK" };
}

// One reader-ranked entry's vote line: "12 VOTES THIS WEEK", with the average from 50 votes.
export function favVotes(x) {
  if (x?.by !== 'readers' || !Number.isInteger(x.votes)) return '';
  const avg = Number.isFinite(x.average) ? ` · AVERAGE ${x.average.toFixed(1)} OF 5` : '';
  return `${x.votes} ${x.votes === 1 ? 'VOTE' : 'VOTES'} THIS WEEK${avg}`;
}

// The story a clicked link leads to, when it is one of the page's weird stories (and only then is a click counted):
// the link's address must be exactly a story's address. Anything else (the outlet's home page, a tab, a filter)
// gives null.
export function storyFor(href, urls) {
  if (typeof href !== 'string' || !href || !urls || typeof urls.has !== 'function') return null;
  return urls.has(href) ? href : null;
}

// Datelines in pixel type, in the visitor's locale: "UPI ODD NEWS · FRI 13 NOV 2026" and "13 NOV".
export function longDate(ms, locale = 'en-GB', timeZone) {
  try { return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(ms).replace(/,/g, '').replace(/\.(?=\s|$)/g, '').toUpperCase(); } catch { return ''; }
}
export function shortDate(ms, locale = 'en-GB', timeZone) {
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(ms).replace(/,/g, '').replace(/\.(?=\s|$)/g, '').toUpperCase(); } catch { return ''; }
}
export const metaLine = (item, locale, tz) => `${item.outlet.toUpperCase()} · ${longDate(item.ms, locale, tz)}`;
export const shortMeta = (item, locale, tz) => `${item.outlet.toUpperCase()} · ${shortDate(item.ms, locale, tz)}`;

// The editor's own rating, only when there is one. Never a reader score, never invented.
export const ratingLabel = (rating) => (Number.isInteger(rating) && rating >= 1 && rating <= 5 ? `Editor's weird rating: ${rating} out of 5` : null);

// The outlet's monogram for the lead's starburst, "Straight from UPI" ("UPI Odd News" -> "UPI", "Guinness World Records" -> "GWR").
export function monogram(name) {
  const words = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '?';
  if (/^[A-Z0-9]{2,5}$/.test(words[0])) return words[0];
  return words.filter((w) => !/^(the|of|and|a|an)$/i.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 4) || words[0][0].toUpperCase();
}

/* ---------- The edition strip ---------- */

// Day of the year (1 Jan = 1) in the visitor's own calendar.
export function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 864e5) + 1;
}
// "NEW YORK EDITION · MONDAY 16 NOVEMBER 2026 · VOL. 1 · NO. 320" (No. is the day of the year), and the short form
// for phones, "MON 16 NOV 2026 · NEW YORK". Without a place it is simply "TODAY'S EDITION".
export function editionLine(placeName, date = new Date(), locale = 'en-GB') {
  const fmt = (o) => { try { return new Intl.DateTimeFormat(locale, o).format(date); } catch { return new Intl.DateTimeFormat('en-GB', o).format(date); } };
  const clean = (s) => s.replace(/,/g, '').replace(/\.(?=\s|$)/g, '').toUpperCase();
  const where = placeName ? `${String(placeName).toUpperCase()} EDITION` : "TODAY'S EDITION";
  const long = clean(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const short = clean(fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  return { long: `${where} · ${long} · VOL. 1 · NO. ${dayOfYear(date)}`, short: placeName ? `${short} · ${String(placeName).toUpperCase()}` : short };
}

/* ---------- Shapes and motion ---------- */

// A starburst as a clip-path polygon: n points, inner radius in % of the half-size (outer is 50).
export function starPolygon(n = 16, inner = 38) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : 50, a = (i * Math.PI) / n - Math.PI / 2;
    pts.push(`${+(50 + r * Math.cos(a)).toFixed(1)}% ${+(50 + r * Math.sin(a)).toFixed(1)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}
// Seconds for one loop of the ticker at a steady reading speed (px per second), never faster than 20 s.
export const tickerSeconds = (loopWidth, pxPerSecond = 60) => Math.max(20, Math.round((Number(loopWidth) || 0) / pxPerSecond));

/* ---------- The reader's own streak (localStorage, this device only) ---------- */

const dayStamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// prev: { last: 'YYYY-MM-DD', days } or anything else. A visit on the next calendar day adds one; a gap starts again at 1.
export function nextStreak(prev, now = new Date()) {
  const today = dayStamp(now);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const ok = prev && typeof prev.last === 'string' && Number.isInteger(prev.days) && prev.days > 0;
  if (ok && prev.last === today) return { last: today, days: prev.days };
  if (ok && prev.last === dayStamp(y)) return { last: today, days: Math.min(prev.days + 1, 9999) };
  return { last: today, days: 1 };
}
export const streakDigits = (days) => String(Math.max(0, Math.min(9999, days | 0))).padStart(4, '0').split('');

/* ---------- Weird-o-meter and tips ---------- */

export const METER_WORDS = ['', 'Mildly odd', 'Pretty strange', 'Properly weird', 'Very weird', 'Totally bonkers'];
// Needle angle in degrees for a 1–5 value (-90 = far left, +90 = far right); resting at the far left with no value.
export const meterAngle = (v) => (Number.isFinite(v) && v >= 1 ? -90 + (Math.min(5, v) - 1) * 45 : -90);
// The note under the meter: the visitor's own vote, then the readers' count and (from 50 votes) their average.
export function meterNote({ yours = 0, count = 0, average = null } = {}) {
  const parts = [];
  if (yours) parts.push(`You said: ${METER_WORDS[yours].toLowerCase()} (${yours} of 5).`);
  else parts.push('How weird is it, really? Tap a number.');
  if (count > 0) {
    const votes = `${count} ${count === 1 ? 'vote' : 'votes'}`;
    parts.push(average != null && count >= 50 ? `Readers' average: ${(Math.round(average * 10) / 10).toFixed(1)} of 5 from ${votes}.` : `${votes} so far. Readers' average shows after 50 votes.`);
  } else parts.push("Readers' average shows after 50 votes.");
  return parts.join(' ');
}

// A tip must be a plain https link to somewhere (not this site's own pages). Returns the cleaned URL or null.
export function tipUrl(raw) {
  const u = httpsUrl(String(raw || '').trim());
  if (!u) return null;
  return /^https:\/\/(www\.)?gatecast\.vercel\.app\//i.test(u) ? null : u;
}
