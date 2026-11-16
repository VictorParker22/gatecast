// Pure content logic for the weather board: the headline sentence, parts of the day,
// the daily question, tips, season checklists and the here-and-there comparison.
// No DOM and no network, so it is unit-tested with plain Node. Temperatures are °C, speeds km/h.
import { describeCode, HOUR } from './core.js';

const isSnow = (c) => c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86;
const isWet = (c) => c >= 51 && !isSnow(c);
const falls = (h) => isWet(h.code) || isSnow(h.code);
const kindOf = (h) => (isSnow(h.code) ? 'Snow' : h.code >= 95 ? 'Thunderstorms' : 'Rain');

export function dayKey(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const dayNumber = (key) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86400e3);
export function localHour(ms, tz) {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(ms);
}

export function skyOf(code, day) {
  if (code >= 95) return 'storm';
  if (isSnow(code)) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48 || code === 3) return 'cloud';
  return day ? 'day' : 'night';
}

/* ---------- Headline: what the weather is doing, when it changes, and the one thing to do ---------- */
// Voice rules live in docs/design-system.md ("Voice"). Thresholds are °C, km/h and mm; f prints every number.

const FOG = (c) => c === 45 || c === 48;
const FREEZING = (c) => c === 56 || c === 57 || c === 66 || c === 67;
const HEAVY = (h) => h.code === 65 || h.code === 82 || h.code === 75 || h.code === 86 || h.code === 67 || (h.precip ?? 0) >= 4;
// An hour counts as wet when the model shows rain or snow with at least a 30% chance (or no chance given),
// or when the chance alone is 60% or more and some precipitation is forecast.
const wetHour = (h) => (falls(h) ? h.pop == null || h.pop >= 30 : h.pop != null && h.pop >= 60 && (h.precip ?? 0) > 0);
function kindOfHour(h) {
  const c = h.code;
  if (c >= 95) return 'storm';
  if (FREEZING(c)) return 'ice';
  if (isSnow(c) || (!falls(h) && (h.snow ?? 0) > 0)) return 'snow';
  if (c >= 51 && c <= 55) return 'drizzle';
  if (c >= 80 && c <= 82) return 'showers';
  return 'rain';
}
const RANK = ['drizzle', 'showers', 'rain', 'snow', 'ice', 'storm'];
const NOUN = { storm: 'thunderstorms', ice: 'freezing rain', snow: 'snow', mix: 'rain and snow', rain: 'rain', showers: 'showers', drizzle: 'drizzle' };
const BRIEF = { storm: 'a thunderstorm', ice: 'freezing rain', snow: 'a snow shower', mix: 'a wintry shower', rain: 'a shower', showers: 'a shower', drizzle: 'a little drizzle' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// A run of wet hours from index s, allowing one dry hour inside it. Returns the facts about that run.
function spell(H, s, forced = false) {
  let e = s;
  while (e < H.length) {
    if (wetHour(H[e]) || (forced && e === s)) { e++; continue; }
    if (e + 1 < H.length && wetHour(H[e + 1])) { e += 2; continue; }
    break;
  }
  const run = H.slice(s, Math.max(e, s + 1));
  const kinds = new Set(run.filter((h) => wetHour(h) || falls(h)).map(kindOfHour));
  let kind = [...kinds].sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0] || 'rain';
  if (kind === 'snow' && (kinds.has('rain') || kinds.has('showers') || kinds.has('drizzle'))) kind = 'mix';
  const pops = run.map((h) => h.pop).filter((p) => p != null);
  const pop = pops.length ? Math.max(...pops) : null;
  const snowCm = run.reduce((a, h) => a + (h.snow ?? 0), 0);
  return {
    s, e, kind, pop, len: e - s, open: e >= H.length,
    heavy: run.some(HEAVY) || snowCm >= 5,
    sure: pop == null ? 'likely' : pop >= 70 ? 'sure' : pop >= 50 ? 'likely' : 'chance',
    gust: Math.max(0, ...run.map((h) => h.gust ?? 0)),
  };
}

// Time words relative to now, in the place's own time zone. Clock times for the next six hours,
// the names people use for parts of the day after that.
function clockOf(wx, f) {
  const nowT = wx.now.t, tz = wx.tz;
  const nowHr = localHour(nowT, tz), today = dayNumber(dayKey(nowT, tz));
  return (ms) => {
    const ahead = (ms - nowT) / HOUR;
    if (ahead <= 1) return { soon: true, at: 'within the hour', from: 'within the hour', until: 'for a few more minutes', by: 'within the hour' };
    if (ahead <= 6) { const t = f.time(ms); return { clock: true, at: `around ${t}`, from: `from about ${t}`, after: `after ${t}`, until: `until about ${t}`, by: `by about ${t}` }; }
    const hr = localHour(ms, tz), d = dayNumber(dayKey(ms, tz)) - today;
    let part;
    if (d <= 0) part = hr < 12 ? 'this morning' : hr < 17 ? 'this afternoon' : hr < 21 ? 'this evening' : 'tonight';
    else part = hr < 5 ? 'overnight' : hr < 12 ? 'tomorrow morning' : hr < 17 ? 'tomorrow afternoon' : 'tomorrow evening';
    if (d <= 0 && nowHr < 5 && hr < 5) part = 'later tonight';
    const morning = part === 'overnight' || (part === 'tomorrow morning' && nowHr >= 12);
    return {
      part, at: part, from: part, after: part,
      until: part === 'overnight' ? 'until the early hours' : `until ${part}`,
      by: morning ? 'by morning' : part,
    };
  };
}

// The sky in words. Never "sunny" at night.
function skyClass(code) { return FOG(code) ? 'fog' : code >= 3 ? 'cloud' : code === 2 ? 'partly' : 'clear'; }
function skyWord(cls, day) {
  if (cls === 'fog') return 'foggy';
  if (cls === 'cloud') return 'cloudy';
  if (cls === 'partly') return day ? 'sun and cloud' : 'partly cloudy';
  return day ? 'sunny' : 'clear';
}

function readForecast(wx, f) {
  const now = wx.now, tz = wx.tz;
  // With no hourly forecast at all, the current hour stands in, so the sentence is about now only.
  const H = wx.hours?.length ? wx.hours.slice(0, 24) : [{ ...now }];
  const when = clockOf(wx, f);
  const hr = localHour(now.t, tz);
  const night = !now.day;
  const feels = now.feels ?? now.temp;
  const next = (n) => H.slice(1, n + 1);
  const temps12 = next(12).map((h) => h.temp).filter((t) => t != null);
  const low12 = temps12.length ? Math.min(...temps12) : now.temp;
  const lowAt = H.find((h, i) => i > 0 && i <= 12 && h.temp === low12);
  const dayHours = next(12).filter((h) => h.day ?? now.day);
  const high = dayHours.length ? Math.max(now.temp, ...dayHours.map((h) => h.temp)) : now.temp;
  const highAt = H.find((h) => (h.day ?? now.day) && h.temp === high);
  const gustPeak = Math.max(now.gust ?? 0, ...next(12).map((h) => h.gust ?? 0));
  const uv = wx.days?.[0]?.uv ?? 0;

  // Rain, snow or storms falling now, and the run they belong to.
  const wetNow = falls(now) || (now.precip ?? 0) > 0;
  let cur = null, later = null;
  if (wetNow) {
    cur = spell(H, 0, true);
    if (falls(now)) cur.kind = cur.kind === 'mix' ? 'mix' : RANK.indexOf(kindOfHour(now)) > RANK.indexOf(cur.kind) ? kindOfHour(now) : cur.kind;
    cur.sure = 'sure';
    if (HEAVY(now)) cur.heavy = true;
  }
  // The next run of rain or snow worth mentioning: a likely one within 24 hours, or a possible one within 12.
  for (let i = cur ? cur.e : 1; i < H.length; i++) {
    if (!wetHour(H[i])) continue;
    const sp = spell(H, i);
    if (sp.sure !== 'chance' || i <= 12) { later = sp; break; }
    i = sp.e;
  }

  // Ice: freezing rain in the next 12 hours, or wet ground followed by a freeze within 6 hours of it.
  let ice = next(12).some((h) => FREEZING(h.code) && wetHour(h)) || FREEZING(now.code);
  for (const sp of [cur, later]) {
    if (!sp || ice || sp.sure === 'chance' || sp.kind === 'snow') continue;
    const after = H.slice(sp.s, Math.min(H.length, sp.e + 6));
    if (after.some((h) => h.temp <= 0)) ice = true;
  }
  if ((cur?.kind === 'ice') || (later?.kind === 'ice' && later.sure !== 'chance' && later.s <= 12)) ice = true;

  // How many separate likely spells: three or more in a day reads as "on and off".
  let spells = 0;
  for (let i = 0; i < H.length; i++) {
    if (!(wetHour(H[i]) || (i === 0 && wetNow))) continue;
    const sp = spell(H, i, i === 0 && wetNow);
    if (sp.sure !== 'chance' || i === 0) spells++;
    i = sp.e;
  }
  const refreeze = ice && !next(12).some((h) => FREEZING(h.code)) && !FREEZING(now.code);

  const frostAt = now.temp > 0 ? H.find((h, i) => i > 0 && i <= 18 && h.temp <= 0) : null;
  return { spells, refreeze, now, H, when, hr, night, feels, low12, lowAt, high, highAt, gustPeak, uv, cur, later, ice, frostAt, wx, f, tz };
}

/* The lead: what the weather is doing and when that changes. */
function leadOf(r) {
  const { now, H, when, f, cur, later } = r;
  const noun = (sp) => (sp.heavy && (sp.kind === 'rain' || sp.kind === 'showers' || sp.kind === 'snow') ? `heavy ${NOUN[sp.kind]}` : NOUN[sp.kind]);

  if (cur) {
    const N = cap(noun(cur));
    if (cur.open || r.spells >= 3) {
      const steady = H.every((h, i) => i === 0 || wetHour(h));
      const span = r.hr >= 5 && r.hr < 15 ? (steady ? 'all day and into tonight' : 'all day') : r.hr >= 15 && r.hr < 21 ? 'through tonight' : 'through the night and into tomorrow';
      return steady ? `${N} ${span}.` : `${N} on and off ${span}.`;
    }
    const end = when(H[cur.e].t);
    const next = later && later.sure !== 'chance' ? later : null;
    const again = next && (next.kind === cur.kind ? `again ${when(H[next.s].t).at}` : `${noun(next)} ${when(H[next.s].t).at}`);
    if (end.soon) return next ? `${N} stopping within the hour, ${next.kind === cur.kind ? 'more' : noun(next)} ${when(H[next.s].t).at}.` : `${N} stopping within the hour.`;
    if (next) return `${N} ${end.until}, then ${again}.`;
    const after = r.refreeze ? ', then freezing' : '';
    if ((H[cur.e].t - now.t) / HOUR <= 3) return `${N} easing off ${end.by}${after}.`;
    return `${N} ${end.until}, then ${r.refreeze ? 'freezing' : 'dry'}.`;
  }

  if (later && r.spells >= 3) {
    const w = when(H[later.s].t);
    return `Dry ${w.until}, then ${NOUN[later.kind === 'rain' ? 'showers' : later.kind]} on and off.`;
  }
  if (later) {
    const w = when(H[later.s].t), n = noun(later);
    if (w.soon) {
      if (later.sure === 'sure') return `${cap(later.len <= 2 ? BRIEF[later.kind] : n)} starting within the hour.`;
      if (later.sure === 'likely') return `${cap(later.len <= 2 ? BRIEF[later.kind] : n)} likely within the hour.`;
      return `A chance of ${later.len <= 2 ? BRIEF[later.kind] : n} within the hour.`;
    }
    if (later.len <= 2) {
      return later.sure === 'chance' ? `Dry, with a chance of ${BRIEF[later.kind]} ${w.at}.` : `Dry, apart from ${BRIEF[later.kind]} ${w.at}.`;
    }
    if (later.sure === 'chance') return `Dry, with a chance of ${n} ${w.after}.`;
    const steady = later.len >= 6 && (later.kind === 'rain' || later.kind === 'snow') && !later.heavy ? `steady ${n}` : n;
    return later.sure === 'sure' ? `Dry ${w.until}, then ${steady}.` : `Dry ${w.until}, then ${steady} likely.`;
  }

  // Dry for the next day. Fog first, then extremes, then wind, frost and big swings, then the plain sky.
  const day = !r.night;
  if (FOG(now.code)) {
    const k = H.findIndex((h, i) => i > 0 && !FOG(h.code) && !(H[i + 1] && FOG(H[i + 1].code)));
    if (k < 0) return r.hr >= 17 || r.hr < 5 ? 'Foggy through the night.' : 'Foggy all day.';
    const w = when(H[k].t);
    return w.soon ? 'Fog lifting within the hour.' : `Fog lifting ${w.by}.`;
  }
  const sky = cap(skyWord(skyClass(now.code), day));
  if (day && r.high >= 35) return `${sky} and very hot, up to ${f.temp(r.high)}.`;
  if (r.feels <= -15) return now.feels != null ? `${sky} and bitterly cold, feels like ${f.temp(now.feels)}.` : `${sky} and bitterly cold.`;
  if (r.gustPeak >= 60) return `${sky} and ${r.gustPeak >= 80 ? 'very windy' : 'windy'}, gusts to ${f.speed(r.gustPeak)}.`;
  if (day && r.high >= 30) return `${sky} and hot, up to ${f.temp(r.high)}.`;
  if (r.frostAt) {
    const w = when(r.frostAt.t);
    return r.hr >= 17 || r.hr < 5 ? `${sky} and cold tonight, frost ${w.by}.` : `${sky} today, frost ${w.by}.`;
  }
  const span = r.hr < 5 ? (day ? 'through the night' : 'for the rest of the night') : r.hr < 12 ? 'all day' : r.hr < 17 ? 'this afternoon' : r.hr < 21 ? 'this evening' : 'tonight';
  if (r.feels <= -5) return now.feels != null && now.feels < now.temp - 2 ? `${sky} and cold, feels like ${f.temp(now.feels)}.` : `${sky} and cold ${span}.`;
  if (now.temp - r.low12 >= 8 && r.lowAt) return `${sky} for now, much colder ${when(r.lowAt.t).at}.`;
  if (day && r.high - now.temp >= 6 && r.highAt) return `${sky}, warming to ${f.temp(r.high)} ${when(r.highAt.t).at}.`;

  // The sky changing: clear turning cloudy, or cloud breaking up, for at least three hours in a row.
  const cls = skyClass(now.code);
  for (let i = 2; i <= 12 && i + 2 < H.length; i++) {
    const run = H.slice(i, i + 3).map((h) => skyClass(h.code));
    if (run.some((c) => c !== run[0]) || run[0] === cls || run[0] === 'partly' || cls === 'partly') continue;
    const w = when(H[i].t);
    if (run[0] === 'cloud') return `${sky}, clouding over ${w.at}.`;
    if (run[0] === 'clear') return `${sky}, clearing ${w.at}.`;
  }

  if (r.night || r.hr >= 18) {
    // Evening and night visits: tonight's sky and tomorrow's, read from tomorrow's daylight hours.
    const today = dayNumber(dayKey(now.t, r.tz));
    const tmr = H.filter((h) => dayNumber(dayKey(h.t, r.tz)) === today + (r.hr < 5 ? 0 : 1) && localHour(h.t, r.tz) >= 9 && localHour(h.t, r.tz) <= 15);
    const nightSky = skyWord(cls, false);
    if (tmr.length) {
      const counts = {};
      for (const h of tmr) counts[skyClass(h.code)] = (counts[skyClass(h.code)] || 0) + 1;
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const tw = skyWord(top, true);
      if (r.hr < 5) return `${cap(nightSky)} until dawn, then ${tw}.`;
      return tw === nightSky ? `${cap(nightSky)} tonight and tomorrow.` : `${cap(nightSky)} tonight, ${tw} tomorrow.`;
    }
    return r.hr < 5 ? `${cap(nightSky)} and dry for the rest of the night.` : `${cap(nightSky)} and dry tonight.`;
  }
  if (day && now.temp <= 0 && r.hr < 11) return `${sky} and frosty this morning.`;
  return cls === 'clear' ? `${sky} ${span}.` : `${sky} but dry ${span}.`;
}

/* The action: the single most useful thing to do, danger first. */
function actionOf(r) {
  const { now, H, cur, later } = r;
  const vary = (list) => list[dayNumber(dayKey(now.t, r.tz)) % list.length];
  const soonest = cur || (later && later.s <= 12 ? later : null);
  const storm = [cur, later].find((sp) => sp && sp.kind === 'storm' && sp.s <= 12);
  if (storm) {
    if (storm === cur) return 'Stay indoors until it passes.';
    return storm.sure === 'chance' ? 'Have an indoor backup plan.' : 'Plan to be indoors by then.';
  }
  if (r.ice) return 'Watch for ice on paths and roads.';
  const snow = [cur, later].find((sp) => sp && (sp.kind === 'snow' || sp.kind === 'mix') && sp.s <= 12);
  if (snow) {
    if (snow.sure === 'chance') return 'Allow extra time, just in case.';
    return snow.heavy ? 'Travel only if you need to.' : 'Leave extra time for travel.';
  }
  if (r.gustPeak >= 80) return 'Tie down anything loose outside.';
  if (!r.night && r.high >= 35) return 'Keep to the shade and drink water often.';
  if (r.feels <= -15) return 'Cover your face and hands outside.';

  if (cur && r.spells < 3) {
    const left = (H[Math.min(cur.e, H.length - 1)].t - now.t) / HOUR;
    if (!cur.open && left <= 1) return 'Give it a few minutes.';
    if (!cur.open && left <= 2) return 'Wait it out if you can.';
  }
  if (soonest) {
    const startT = H[soonest.s].t;
    const lateOnly = soonest !== cur && H.slice(soonest.s, soonest.e).every((h) => localHour(h.t, r.tz) < 5);
    if (soonest.sure === 'chance') return 'Pack an umbrella, just in case.';
    if (lateOnly) return "Take an umbrella if you're out late.";
    if (soonest.gust >= 50) return 'Wear a hood: too windy for an umbrella.';
    if (soonest.heavy) return 'Take a proper raincoat.';
    if (soonest.kind === 'drizzle') return 'A hood or light jacket will do.';
    if (soonest !== cur && dayKey(startT, r.tz) !== dayKey(now.t, r.tz) && (r.night || r.hr >= 18)) return 'Pack an umbrella for tomorrow.';
    return 'Take an umbrella.';
  }
  if (later) return dayKey(H[later.s].t, r.tz) === dayKey(now.t, r.tz) ? 'Pack an umbrella for later.' : 'Pack an umbrella for tomorrow.';

  if (r.frostAt) {
    const fh = localHour(r.frostAt.t, r.tz);
    if (fh >= 9 && fh < 17) return 'Watch for icy patches later.';
    return r.night || r.hr >= 17 ? 'Cover the windshield before bed.' : 'Cover the windshield this evening.';
  }
  if (now.temp <= 0 && !r.night && r.hr >= 5 && r.hr < 10) return 'Leave time to clear the windshield.';
  if (now.temp - r.low12 >= 8) return 'Bring a warm layer for later.';
  if (r.feels <= -5) return 'Wear a hat and gloves.';
  if (!r.night && r.high >= 30) return 'Drink water and find shade at midday.';
  if (!r.night && r.hr < 16 && r.uv >= 8) return 'Wear sunscreen and find shade at midday.';
  if (!r.night && r.hr < 16 && r.uv >= 6) return "Wear sunscreen if you're out at midday.";
  if (r.gustPeak >= 55) return 'A windproof layer will help.';
  if (FOG(now.code)) return 'If you drive, use low beams.';

  const calm = r.gustPeak < 40;
  const fine = skyClass(now.code) === 'clear' || skyClass(now.code) === 'partly';
  if (!r.night && calm && fine && r.high >= 16 && r.high <= 28 && r.hr < 17) return vary(['A good day to be outside.', 'A good day for a long walk.', 'Worth getting outside today.']);
  if (r.hr >= 17 && r.hr < 22 && calm && now.temp >= 15 && now.temp <= 26) return 'A good evening to sit outside.';
  if (r.feels <= 5) return r.night ? 'Wear a warm coat if you go out.' : 'Wear a warm coat.';
  if (r.feels <= 12) return r.night ? 'Take a jacket if you go out.' : 'Bring a jacket.';
  return r.night ? 'Nothing to plan around tonight.' : 'Nothing to plan around today.';
}

// f: { time(ms) -> "14:00" or "2 pm", temp(c) -> "8°", speed(kmh) -> "40 km/h" }
export function headlineParts(wx, f) {
  const r = readForecast(wx, f);
  let lead = leadOf(r);
  const action = actionOf(r);
  // A danger-level action must be explained by the lead it follows: add the reason to the lead,
  // or, when that would make the sentence too long, let the danger be the lead.
  const words = (x) => x.split(/\s+/).length;
  const sky = cap(skyWord(skyClass(wx.now.code), !!wx.now.day));
  const reason = action === 'Tie down anything loose outside.' && !lead.includes('gust') ? [`gusts to ${f.speed(r.gustPeak)}`, `${sky} and very windy, gusts to ${f.speed(r.gustPeak)}.`]
    : action === 'Cover your face and hands outside.' && !lead.includes('cold') ? [wx.now.feels != null ? `feels like ${f.temp(wx.now.feels)}` : 'bitterly cold', wx.now.feels != null ? `Bitterly cold, feels like ${f.temp(wx.now.feels)}.` : 'Bitterly cold.']
      : action === 'Keep to the shade and drink water often.' && !lead.includes('hot') ? [`very hot, up to ${f.temp(r.high)}`, `${sky} and very hot, up to ${f.temp(r.high)}.`]
        : action === 'Watch for ice on paths and roads.' && !/freez|frost|then/.test(lead) ? ['then freezing', lead]
          : null;
  if (reason) {
    const joined = lead.replace(/\.$/, `, ${reason[0]}.`);
    lead = words(`${joined} ${action}`) <= 16 ? joined : reason[1];
  }
  return { lead, action };
}

export function headline(wx, f) {
  const { lead, action } = headlineParts(wx, f);
  return action ? `${lead} ${action}` : lead;
}

/* ---------- Parts of the day ---------- */

const PARTS = [['Overnight', 0, 6], ['Morning', 6, 12], ['Afternoon', 12, 18], ['Evening', 18, 24]];
// The next four parts of the day, starting with the one we are in.
export function dayparts(wx) {
  const groups = [];
  for (const h of wx.hours.slice(0, 26)) {
    const hr = localHour(h.t, wx.tz);
    const part = PARTS.find((p) => hr >= p[1] && hr < p[2]);
    const last = groups[groups.length - 1];
    if (last && last.name === part[0]) last.hours.push(h); else groups.push({ name: part[0], hours: [h] });
  }
  return groups.slice(0, 4).map((g) => {
    const worst = g.hours.reduce((a, b) => (b.code > a.code ? b : a));
    const warm = g.name === 'Morning' || g.name === 'Afternoon';
    const temps = g.hours.map((h) => h.temp);
    return { name: g.name, temp: warm ? Math.max(...temps) : Math.min(...temps), code: worst.code, day: g.hours[Math.floor(g.hours.length / 2)].day, text: describeCode(worst.code).text };
  });
}

/* ---------- The daily question, made from the forecast on the page ---------- */

export function makeQuiz(wx, placeName, f) {
  const key = dayKey(wx.now.t, wx.tz);
  const hours = wx.hours.slice(0, 24);
  const kinds = ['high', 'day', 'rain', 'sunset'];
  let kind = kinds[dayNumber(key) % kinds.length];
  if (kind === 'day' && wx.days.length < 4) kind = 'high';

  if (kind === 'high') {
    const iMax = hours.reduce((best, h, i) => (h.temp > hours[best].temp ? i : best), 0);
    const picks = new Set([iMax]);
    for (const off of [6, -6, 9, -9, 4, -4]) { const j = iMax + off; if (j >= 0 && j < hours.length && picks.size < 3) picks.add(j); }
    const idx = [...picks].sort((a, b) => a - b);
    return {
      key, kind, question: `When is ${placeName} warmest in the next 24 hours?`,
      options: idx.map((i) => `Around ${f.time(hours[i].t)}`), correct: idx.indexOf(iMax),
      explain: `It peaks at ${f.temp(hours[iMax].temp)} around ${f.time(hours[iMax].t)}.`,
    };
  }
  if (kind === 'day') {
    const next = wx.days.slice(1, 4);
    const best = next.reduce((b, d, i) => (d.max > next[b].max ? i : b), 0);
    return {
      key, kind, question: `Which of the next three days is warmest in ${placeName}?`,
      options: next.map((d) => f.weekday(d.t)), correct: best,
      explain: `${f.weekday(next[best].t)} reaches ${f.temp(next[best].max)}.`,
    };
  }
  if (kind === 'rain') {
    const wet = hours.find((h) => falls(h) && (h.pop ?? 0) >= 50);
    return {
      key, kind, question: `Will ${placeName} get rain or snow in the next 24 hours?`,
      options: ['Yes, it is likely', 'No, it stays dry'], correct: wet ? 0 : 1,
      explain: wet ? `${kindOf(wet)} ${kindOf(wet) === 'Thunderstorms' ? 'are' : 'is'} likely around ${f.time(wet.t)} (${wet.pop}% chance that hour).` : 'Every hour in the next 24 has less than an even chance of rain or snow.',
    };
  }
  const sunset = wx.days[0].sunset;
  const shifts = [[-50, -25, 0], [-25, 0, 25], [0, 25, 50]][dayNumber(key) % 3];
  return {
    key, kind: 'sunset', question: `What time is sunset in ${placeName} today?`,
    options: shifts.map((m) => f.time(sunset + m * 60e3)), correct: shifts.indexOf(0),
    explain: `The sun sets at ${f.time(sunset)}.`,
  };
}

/* ---------- Seasons, tips and checklists ---------- */

// Meteorological season for a latitude and date, and the days until the next one starts.
export function season(lat, date = new Date()) {
  if (Math.abs(lat) < 23.5) return { name: 'tropics', next: null, days: null };
  const m = date.getUTCMonth();
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const flip = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
  const order = ['winter', 'spring', 'summer', 'autumn'];
  const nowN = north[m];
  const startMonth = { winter: 11, spring: 2, summer: 5, autumn: 8 };
  const nextN = order[(order.indexOf(nowN) + 1) % 4];
  let start = Date.UTC(date.getUTCFullYear(), startMonth[nextN], 1);
  if (start <= date.getTime()) start = Date.UTC(date.getUTCFullYear() + 1, startMonth[nextN], 1);
  const days = Math.ceil((start - date.getTime()) / 86400e3);
  return lat >= 0 ? { name: nowN, next: nextN, days } : { name: flip[nowN], next: flip[nextN], days };
}

const NWS = { label: 'National Weather Service', url: 'https://www.weather.gov/safety/' };
const READY = { label: 'Ready.gov', url: 'https://www.ready.gov/' };

// The same honest-doubt words the headline uses: a 70% hour is "very likely", 50% "likely", less "possible".
const odds = (pop) => (pop >= 70 ? 'very likely' : pop >= 50 ? 'likely' : 'possible');

// One practical tip chosen by what the forecast is about to do.
export function tipFor(wx, f) {
  const hours = wx.hours.slice(0, 24);
  const first = (test) => hours.find(test);
  const snow = first((h) => isSnow(h.code) && (h.pop ?? 0) >= 40);
  if (snow) return { title: 'Snow is on the way', text: `Snow is ${odds(snow.pop)} around ${f.time(snow.t)}. Charge your phone, top up the washer fluid, and put a blanket and a scraper in the car before it starts.`, source: READY };
  const storm = first((h) => h.code >= 95);
  if (storm) return { title: 'Thunderstorms later', text: `Thunderstorms are ${storm.pop == null ? 'possible' : odds(storm.pop)} around ${f.time(storm.t)}. When you hear thunder, go indoors and stay there until 30 minutes after the last rumble.`, source: NWS };
  const frost = first((h) => h.temp <= 0);
  if (frost) return { title: 'Frost tonight', text: `It reaches freezing around ${f.time(frost.t)}. Lay a towel or a sheet of cardboard over the windshield this evening and lift it off in the morning. Never pour hot water on frozen glass: it can crack.`, source: NWS };
  const gusty = hours.reduce((a, b) => ((b.gust ?? 0) > (a.gust ?? 0) ? b : a));
  if ((gusty.gust ?? 0) >= 55) return { title: 'Strong gusts ahead', text: `Gusts peak near ${f.speed(gusty.gust)} around ${f.time(gusty.t)}. Bring in or tie down bins, garden furniture and anything else that can blow about.`, source: NWS };
  const hot = hours.reduce((a, b) => (b.temp > a.temp ? b : a));
  if (hot.temp >= 32) return { title: 'A hot one', text: `It reaches ${f.temp(hot.temp)} around ${f.time(hot.t)}. Close blinds on sunny windows before noon, drink water before you feel thirsty, and open up the house after sunset.`, source: READY };
  const rain = first((h) => isWet(h.code) && (h.pop ?? 0) >= 50);
  if (rain) return { title: 'Rain on the way', text: `Rain is likely around ${f.time(rain.t)}. Leave a little earlier: stopping distances roughly double on a wet road, and the first half hour of rain is the slickest.`, source: NWS };
  if ((wx.days[0].uv ?? 0) >= 6) return { title: 'Strong sun at midday', text: 'The UV index is high today. Put sunscreen on 15 minutes before you go out, reapply every two hours, and find shade around midday.', source: NWS };
  if (first((h) => h.code === 45 || h.code === 48)) return { title: 'Fog about', text: 'In fog, drive on low beams, not high beams, which bounce back off the mist. Leave extra room in front.', source: NWS };
  return { title: 'A quiet day', text: 'Nothing in the forecast needs planning around. A good day to open the windows for ten minutes and air the house.', source: NWS };
}

export const CHECKLISTS = {
  winter: { title: 'Your winter checklist', items: ['Test smoke and carbon monoxide alarms', 'Swap the furnace filter', 'Put a blanket, scraper and phone charger in the car', 'Disconnect and drain outdoor hoses', 'Clear gutters and the drains near your door', 'Know where your water shut-off is'] },
  spring: { title: 'Your spring checklist', items: ['Turn on weather alerts on your phone', 'Pick the safest room for a storm warning', 'Clear gutters and downspouts', 'Check flashlight and radio batteries', 'Test the sump pump if you have one', 'Photograph valuables for insurance'] },
  summer: { title: 'Your summer checklist', items: ['Clean or replace the air-conditioner filter', 'Find your nearest cool public place', 'Keep water in the car', 'Check on an older neighbour on hot days', 'Never leave children or pets in a parked car', 'Restock sunscreen'] },
  autumn: { title: 'Your autumn checklist', items: ['Have the heating checked before the first cold night', 'Clear leaves from gutters and drains', 'Test smoke and carbon monoxide alarms', 'Check tire tread and pressure', 'Restock flashlight batteries', 'Seal draughts around doors and windows'] },
  tropics: { title: 'Your storm-season checklist', items: ['Turn on weather alerts on your phone', 'Keep three days of water and food that needs no cooking', 'Know your evacuation route', 'Keep a charged power bank', 'Store documents in a waterproof bag', 'Trim branches near the house'] },
};
export const CHECKLIST_SOURCE = READY;

/* ---------- Here and there ---------- */

export const WORLD = [
  { name: 'Tokyo', lat: 35.69, lon: 139.69 }, { name: 'Sydney', lat: -33.87, lon: 151.21 }, { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'New York', lat: 40.71, lon: -74.01 }, { name: 'Dubai', lat: 25.08, lon: 55.31 }, { name: 'São Paulo', lat: -23.55, lon: -46.64 },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94 }, { name: 'Singapore', lat: 1.35, lon: 103.82 }, { name: 'Cape Town', lat: -33.92, lon: 18.42 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13 }, { name: 'Mumbai', lat: 19.08, lon: 72.88 }, { name: 'Anchorage', lat: 61.22, lon: -149.9 },
];
const kmApart = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  return 12742 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2));
};
// Three far-away cities, rotating daily so the box is different tomorrow.
export function pickCities(here, day) {
  const far = WORLD.filter((c) => kmApart(here, c) > 1500);
  return [0, 1, 2].map((i) => far[(day * 3 + i * 5) % far.length]).filter((c, i, a) => a.indexOf(c) === i);
}
// "Tokyo is 12° warmer than Chicago, and it is already Monday there."
export function compareLine(hereName, hereTemp, there, f) {
  const diff = f.tempNumber(there.temp) - f.tempNumber(hereTemp);
  const size = Math.abs(diff);
  let s = size < 1 ? `${there.name} is the same temperature as ${hereName} right now`
    : `${there.name} is ${size}° ${diff > 0 ? 'warmer' : 'colder'} than ${hereName} right now`;
  if (there.dayLabel !== there.hereDayLabel) s += `, and it is ${there.ahead ? 'already' : 'still'} ${there.dayLabel} there`;
  return s + '.';
}

export { HOUR };
