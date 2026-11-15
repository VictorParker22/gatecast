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

/* ---------- Headline: one or two short sentences that answer "what is it doing, and when does it change?" ---------- */

// f: { time(ms) -> "14:00", temp(c) -> "8°", speed(kmh) -> "40 km/h" }
export function headline(wx, f) {
  const hours = wx.hours.slice(0, 24), now = wx.now;
  const wetNow = (now.precip ?? 0) > 0 || falls(now);
  let first;
  if (wetNow) {
    const dry = hours.slice(1).find((h) => !falls(h) && (h.precip ?? 0) === 0);
    first = dry ? `${kindOf(now)} until about ${f.time(dry.t)}.` : `${kindOf(now)} on and off for the next 24 hours.`;
  } else {
    const wet = hours.slice(1).find((h) => falls(h) && (h.pop ?? 0) >= 40);
    if (wet) first = `Dry until about ${f.time(wet.t)}, then ${kindOf(wet).toLowerCase()}.`;
    else if (now.code === 45 || now.code === 48) first = 'Foggy for now, and dry.';
    else if (now.code === 3) first = 'Cloudy but dry for the next 24 hours.';
    else first = now.day ? 'Bright and dry all day.' : 'Clear and dry tonight.';
  }
  const temps = hours.map((h) => h.temp), min = Math.min(...temps), max = Math.max(...temps);
  const gust = Math.max(...hours.map((h) => h.gust ?? 0));
  let second = '';
  if (gust >= 55) second = `Gusts up to ${f.speed(gust)}.`;
  else if (min <= 0 && now.temp > 0) second = `Frost by ${f.time(hours.find((h) => h.temp <= 0).t)}.`;
  else if (now.temp - min >= 8) second = `Much cooler later, down to ${f.temp(min)}.`;
  else if (max - now.temp >= 6) second = `Warming up to ${f.temp(max)}.`;
  return second ? `${first} ${second}` : first;
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
      explain: wet ? `${kindOf(wet)} is likely around ${f.time(wet.t)} (${wet.pop}% chance that hour).` : 'No hour in the next 24 has more than an even chance of rain or snow.',
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

// One practical tip chosen by what the forecast is about to do.
export function tipFor(wx, f) {
  const hours = wx.hours.slice(0, 24);
  const first = (test) => hours.find(test);
  const snow = first((h) => isSnow(h.code) && (h.pop ?? 0) >= 40);
  if (snow) return { title: 'Snow is on the way', text: `Snow is likely around ${f.time(snow.t)}. Charge your phone, top up the washer fluid, and put a blanket and a scraper in the car before it starts.`, source: READY };
  const storm = first((h) => h.code >= 95);
  if (storm) return { title: 'Thunderstorms later', text: `Storms are possible around ${f.time(storm.t)}. When you hear thunder, go indoors and stay there until 30 minutes after the last rumble.`, source: NWS };
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
