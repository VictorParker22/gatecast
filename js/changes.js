// "What changed since you last looked": the forecast for a place or a saved trip, and the brief's items.
// Pure (no DOM, no storage, no network): the page passes in what it stored last time and saves what comes back.
// Words follow the house rule: it is the forecast that changed, never "conditions".
//
// Weather. A snapshot holds units (a stop of a trip, or a day at a place), each with its level, the span of
// risky hours around its worst hour, and the factor behind it. A change is material when a unit's level moves,
// or its risky span moves by more than an hour, or another factor takes over. The last snapshot that said
// something different is kept as the baseline, so slow drift adds up instead of slipping through.
//
// Brief. Each kind of item (alerts, headlines, statehouse votes, Both sides topics) keeps the ids it has shown.
// NWS alerts are keyed by event and onset, not by id, so a re-issued or updated alert is not counted as new.
import { HOUR, LEVEL_LABEL, fmtTime } from './core.js';

export const KEEP_MS = 7 * 24 * HOUR;   // older than this, nothing is compared
export const SHOW_MS = 24 * HOUR;       // a change stays on screen this long after it was first seen, unless dismissed
const RANK = { low: 0, elevated: 1, high: 2 };
const LEVEL_OF = ['low', 'elevated', 'high'];

/* ---------- Risky spans ---------- */

// hours: [{ t, level }] in time order. The span from the first to the last elevated-or-high hour: [start, end).
// (Gaps inside it are kept: "gusts 08:00–12:00" is what a traveller needs, not three separate runs.)
export function riskSpan(hours) {
  const risky = hours.filter((h) => RANK[h.level] >= 1);
  return risky.length ? [risky[0].t, risky[risky.length - 1].t + HOUR] : null;
}

/* ---------- Snapshots ---------- */

// A trip: one unit per stop of assessTrip(). score(h) is core.scoreHour.
export function tripSnapshot(result, score, now) {
  return {
    at: now, level: result.level,
    units: result.stops.map((s) => {
      const hours = (s.weather.hours || []).map((h) => { const x = score(h); return { t: h.t, level: x.score >= 60 ? 'high' : x.score >= 30 ? 'elevated' : 'low' }; });
      const top = s.weather.factors[0];
      return { id: s.airport.code, tz: s.airport.tz, level: s.level, win: riskSpan(hours), top: top ? top.label.toLowerCase() : null };
    }),
  };
}

// A place: its next 48 forecast hours, one character per hour, so two looks a day apart can be compared over
// the hours they share (lv: 0 low, 1 elevated, 2 high; k: the factor behind it, '-' for none).
const KEY_CHAR = { storm: 's', ice: 'i', snow: 'n', vis: 'v', wind: 'w', rain: 'r' };
const CHAR_NOUN = { s: 'thunderstorms', i: 'freezing rain', n: 'snow', v: 'fog or poor visibility', w: 'strong gusts', r: 'heavy rain' };
export function placeSnapshot(wx, score, now) {
  const hours = (wx.hours || []).filter((h) => h.t + HOUR > now).slice(0, 48);
  if (!hours.length) return null;
  let lv = '', k = '';
  for (const h of hours) {
    const x = score(h);
    lv += x.score >= 60 ? '2' : x.score >= 30 ? '1' : '0';
    k += x.factors[0] && x.score >= 30 ? KEY_CHAR[x.factors[0].key] || '-' : '-';
  }
  return { at: now, tz: wx.tz, t0: hours[0].t, lv, k };
}

const dayOf = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

// The day units two place snapshots share: hours from the later look onwards that both cover, grouped by the
// place's local day (at least 3 shared hours a day).
export function placeUnits(a, b, now) {
  const from = Math.max(a.t0, b.t0, Math.floor(Math.max(a.at, b.at, now) / HOUR) * HOUR);
  const to = Math.min(a.t0 + a.lv.length * HOUR, b.t0 + b.lv.length * HOUR);
  const days = new Map();
  for (let t = from; t < to; t += HOUR) {
    const key = dayOf(t, b.tz);
    if (!days.has(key)) days.set(key, { a: [], b: [] });
    for (const [s, side] of [[a, 'a'], [b, 'b']]) {
      const i = Math.round((t - s.t0) / HOUR);
      days.get(key)[side].push({ t, level: LEVEL_OF[+s.lv[i]] || 'low', k: s.k[i] });
    }
  }
  const unit = (id, hours) => {
    const win = riskSpan(hours);
    const worst = hours.reduce((m, h) => ((RANK[h.level] > RANK[m.level]) ? h : m), hours[0]);
    return { id, tz: b.tz, level: worst.level, win, top: worst.level !== 'low' ? CHAR_NOUN[worst.k] || null : null };
  };
  const out = { a: [], b: [] };
  for (const [key, d] of days) {
    if (d.a.length < 3) continue;
    out.a.push(unit(key, d.a));
    out.b.push(unit(key, d.b));
  }
  return out;
}

/* ---------- Comparing ---------- */

const near = (x, y) => Math.abs(x - y) <= HOUR;
const sameWin = (p, q) => (!p && !q) || (p && q && near(p[0], q[0]) && near(p[1], q[1]));

// Changes between two lists of units, matched by id. Unknown levels are never compared.
export function diffUnits(before, after) {
  const prev = new Map(before.map((u) => [u.id, u]));
  const out = [];
  for (const u of after) {
    const p = prev.get(u.id);
    if (!p || !(p.level in RANK) || !(u.level in RANK)) continue;
    const d = RANK[u.level] - RANK[p.level];
    if (d > 0) out.push({ kind: 'worse', id: u.id, from: p.level, to: u.level, win: u.win, top: u.top, tz: u.tz });
    else if (d < 0) out.push({ kind: 'better', id: u.id, from: p.level, to: u.level, win: u.win, top: u.top, tz: u.tz });
    else if (u.level !== 'low' && u.top && p.top && u.top !== p.top) out.push({ kind: 'cause', id: u.id, to: u.level, win: u.win, top: u.top, was: p.top, tz: u.tz });
    else if (u.level !== 'low' && !sameWin(p.win, u.win)) out.push({ kind: 'moved', id: u.id, to: u.level, win: u.win, prevWin: p.win, top: u.top, tz: u.tz });
  }
  return out;
}

export const diffTrips = (a, b) => diffUnits(a.units, b.units);
export function diffPlaces(a, b, now) {
  if (!a || !b || a.tz !== b.tz) return [];
  const u = placeUnits(a, b, now);
  return diffUnits(u.a, u.b);
}

/* ---------- Remembering ---------- */

// entry: what was stored for this trip or place last time (or null). Returns the entry to store and the changes
// to show (null for none). A change is shown from the look that finds it until it is dismissed or SHOW_MS old.
export function noteForecast(entry, snap, diff, now) {
  if (!snap) return { entry, changes: null, since: null };
  if (!entry || !entry.base || !(now - entry.base.at <= KEEP_MS) || !(now - (entry.seen ?? 0) <= KEEP_MS)) {
    return { entry: { base: snap, seen: now }, changes: null, since: null };
  }
  const found = diff(entry.base, snap, now);
  if (found.length) {
    const next = { base: snap, prev: entry.base, seen: now, since: entry.seen, noticed: now };
    return { entry: next, changes: found, since: entry.seen };
  }
  const next = { ...entry, seen: now };
  if (entry.prev && !entry.dismissed && now - entry.noticed < SHOW_MS) {
    const again = diff(entry.prev, snap, now);
    if (again.length) return { entry: next, changes: again, since: entry.since };
  }
  return { entry: next, changes: null, since: null };
}

export const dismiss = (entry) => (entry ? { ...entry, dismissed: true } : entry);

// Keeps the store small: entries looked at in the last week, newest first, at most max of each kind.
export function prune(map, now, max = 8) {
  return Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {})
    .filter(([, e]) => e && now - (e.seen ?? 0) <= KEEP_MS)
    .sort((x, y) => y[1].seen - x[1].seen).slice(0, max));
}

/* ---------- Words ---------- */

// "16:00–19:00", or with a 12-hour clock "4–7 pm" (both ends share am/pm) and "11 am–1 pm".
export function fmtRange(win, tz) {
  const a = fmtTime(win[0], tz), b = fmtTime(win[1], tz);
  const m = a.match(/^(.*) (am|pm)$/), n = b.match(/^(.*) (am|pm)$/);
  return m && n && m[2] === n[2] ? `${m[1]}–${b}` : `${a}–${b}`;
}

// When the last look was, in the viewer's zone: "07:15 today", "yesterday 18:40", "Mon 18:40".
export function sinceLabel(at, now, tz) {
  const t = fmtTime(at, tz);
  const days = Math.round((Date.parse(dayOf(now, tz)) - Date.parse(dayOf(at, tz))) / (24 * HOUR));
  if (days <= 0) return `${t} today`;
  if (days === 1) return `yesterday ${t}`;
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(at)} ${t}`;
}

// A place's day as a name: "Later today", "Tomorrow", "Wednesday".
export function dayName(key, now, tz) {
  const days = Math.round((Date.parse(key) - Date.parse(dayOf(now, tz))) / (24 * HOUR));
  if (days <= 0) return 'Later today';
  if (days === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(Date.parse(key) + 12 * HOUR);
}

// One line per changed unit. name(id) gives the unit's name ("ORD", "Tomorrow").
export function changeLine(c, name = (id) => id) {
  const L = (l) => LEVEL_LABEL[l];
  const range = c.win ? fmtRange(c.win, c.tz) : '';
  const detail = c.top ? `, ${c.top}${range ? ` now ${range}` : ''}` : '';
  const who = name(c.id);
  if (c.kind === 'worse') return `${who} went ${L(c.from)} → ${L(c.to)}${detail}`;
  if (c.kind === 'better') return `${who} improved: ${L(c.from)} → ${L(c.to)}${c.to === 'low' ? '' : detail}`;
  if (c.kind === 'cause') return `${who} still ${L(c.to)}, now for ${c.top} rather than ${c.was}${range ? `, ${range}` : ''}`;
  return `${who} still ${L(c.to)}, ${c.top || 'the risky hours'} now ${range || 'over'}${c.prevWin ? ` (was ${fmtRange(c.prevWin, c.tz)})` : ''}`;
}
export const changeLead = (since, now, tz) => `Since ${sinceLabel(since, now, tz)}, the forecast changed`;

/* ---------- The brief: new items since the last look ---------- */

export const BRIEF_KINDS = ['alerts', 'headlines', 'votes', 'topics'];
const NOUNS = { alerts: ['alert', 'alerts'], headlines: ['headline', 'headlines'], votes: ['statehouse vote', 'statehouse votes'], topics: ['Both sides topic', 'Both sides topics'] };

// An NWS alert's identity across re-issues: event and onset (the id changes when the office updates it).
export const alertKey = (a) => `${String(a?.event || '').trim().toLowerCase()}|${a?.onset ?? a?.from ?? ''}`;

// Starts one page load's look at a place's brief: remembers when the previous look was.
export function startLook(entry, now) {
  const fresh = !entry || !(now - (entry.seen ?? 0) <= KEEP_MS);
  return { seen: now, prevSeen: fresh ? null : entry.seen, kinds: fresh ? {} : { ...(entry.kinds || {}) }, dismissed: fresh ? null : entry.dismissed ?? null };
}

// Records the ids of one kind as shown on this look. A kind seen for the first time counts nothing as new.
export function noteKind(look, kind, ids, now) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const k = look.kinds[kind];
  if (!k) { look.kinds[kind] = { ids: list.slice(0, 100) }; return look; }
  const known = new Set(k.ids);
  const added = list.filter((id) => !known.has(id));
  const next = { ids: [...new Set([...list, ...k.ids])].slice(0, 100) };
  if (added.length && look.prevSeen != null) Object.assign(next, { fresh: added, noticed: now, since: look.prevSeen });
  else if (k.fresh && now - k.noticed < SHOW_MS) Object.assign(next, { fresh: k.fresh.filter((id) => list.includes(id)), noticed: k.noticed, since: k.since });
  look.kinds[kind] = next;
  return look;
}

// What to say: { line, since } or null. Dismissing hides everything noticed up to that moment.
export function briefNews(look, now) {
  const parts = [];
  let since = null;
  for (const kind of BRIEF_KINDS) {
    const k = look.kinds[kind];
    if (!k?.fresh?.length || !(now - k.noticed < SHOW_MS) || (look.dismissed != null && k.noticed <= look.dismissed)) continue;
    const n = k.fresh.length;
    parts.push(`${n} ${NOUNS[kind][n === 1 ? 0 : 1]}`);
    since = since == null ? k.since : Math.min(since, k.since);
  }
  return parts.length ? { line: `New since you last looked: ${parts.join(', ')}`, since } : null;
}
export const dismissLook = (look, now) => ({ ...look, dismissed: now });
export const lookEntry = (look) => ({ seen: look.seen, kinds: look.kinds, dismissed: look.dismissed });
