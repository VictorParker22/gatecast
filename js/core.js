// Pure logic: time zones, flight-time estimates, weather risk scoring, trip assessment.
// No DOM and no network here so it can be unit-tested with plain Node.

export const HOUR = 3600e3;
export const LEVELS = ['low', 'elevated', 'high'];
export const LEVEL_LABEL = { low: 'Low', elevated: 'Elevated', high: 'High' };

/* ---------- Time ---------- */

// Offset (ms) of a time zone from UTC at a given instant.
export function tzOffset(tz, utcMs) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

// "2026-11-16T08:30" as wall-clock time in tz -> UTC ms.
export function localToUtc(local, tz) {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  let utc = guess - tzOffset(tz, guess);
  utc = guess - tzOffset(tz, utc); // second pass settles DST edges
  return utc;
}

export function utcToLocalInput(utcMs, tz) {
  return new Date(utcMs + tzOffset(tz, utcMs)).toISOString().slice(0, 16);
}

export function fmtTime(utcMs, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(utcMs);
}
export function fmtDay(utcMs, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(utcMs);
}
export function fmtZone(utcMs, tz) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(utcMs).find((p) => p.type === 'timeZoneName');
  return part ? part.value : tz;
}
export function fmtDuration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/* ---------- Geography ---------- */

const rad = (d) => (d * Math.PI) / 180;
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}
// Gate-to-gate estimate: cruise at ~830 km/h plus 35 min for taxi, climb and descent.
export function estimateFlightMin(a, b) {
  return Math.max(30, Math.round((distanceKm(a, b) / 830 * 60 + 35) / 5) * 5);
}
// Points along the great circle, longitudes unwrapped so the line never jumps across the map.
export function greatCircle(a, b, steps = 48) {
  const [la1, lo1, la2, lo2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  const pts = [];
  let prev = a.lon;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    let lat, lon;
    if (d < 1e-6) { lat = a.lat; lon = a.lon; } else {
      const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
      lon = (Math.atan2(y, x) * 180) / Math.PI;
    }
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    pts.push([lon, lat]);
  }
  return pts;
}

/* ---------- Weather codes (WMO, as used by Open-Meteo) ---------- */

export function describeCode(code) {
  if (code == null) return { text: 'No forecast', icon: 'cloud' };
  if (code === 0) return { text: 'Clear', icon: 'clear' };
  if (code === 1) return { text: 'Mostly clear', icon: 'clear' };
  if (code === 2) return { text: 'Partly cloudy', icon: 'partly' };
  if (code === 3) return { text: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { text: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 55) return { text: 'Drizzle', icon: 'drizzle' };
  if (code === 56 || code === 57) return { text: 'Freezing drizzle', icon: 'sleet' };
  if (code === 61) return { text: 'Light rain', icon: 'rain' };
  if (code === 63) return { text: 'Rain', icon: 'rain' };
  if (code === 65) return { text: 'Heavy rain', icon: 'rain' };
  if (code === 66 || code === 67) return { text: 'Freezing rain', icon: 'sleet' };
  if (code === 71) return { text: 'Light snow', icon: 'snow' };
  if (code === 73) return { text: 'Snow', icon: 'snow' };
  if (code === 75) return { text: 'Heavy snow', icon: 'snow' };
  if (code === 77) return { text: 'Snow grains', icon: 'snow' };
  if (code === 80 || code === 81) return { text: 'Rain showers', icon: 'rain' };
  if (code === 82) return { text: 'Violent showers', icon: 'rain' };
  if (code === 85 || code === 86) return { text: 'Snow showers', icon: 'snow' };
  if (code === 95) return { text: 'Thunderstorm', icon: 'storm' };
  if (code === 96 || code === 99) return { text: 'Thunderstorm with hail', icon: 'storm' };
  return { text: 'Cloudy', icon: 'cloud' };
}

/* ---------- Risk scoring ---------- */

export const levelOf = (score) => (score >= 60 ? 'high' : score >= 30 ? 'elevated' : 'low');

// One forecast hour -> { score 0-100, factors: [{ key, label, points }] }.
// h: { code, gust (km/h), wind (km/h), vis (m), precip (mm), snow (cm), pop (%) }
export function scoreHour(h) {
  const f = [];
  const add = (key, label, points) => f.push({ key, label, points });
  const c = h.code;
  if (c === 96 || c === 99) add('storm', 'Thunderstorms with hail', 85);
  else if (c === 95) add('storm', 'Thunderstorms', 70);
  if (c === 56 || c === 57 || c === 66 || c === 67) add('ice', 'Freezing rain', 75);

  const snow = h.snow ?? 0;
  if (snow >= 2 || c === 75 || c === 86) add('snow', 'Heavy snow', 75);
  else if (snow >= 0.5 || c === 73) add('snow', 'Steady snow', 50);
  else if (snow > 0 || c === 71 || c === 77 || c === 85) add('snow', 'Light snow', 30);

  const vis = h.vis;
  if (vis != null && vis < 400) add('vis', 'Dense fog', 70);
  else if ((vis != null && vis < 1000) || c === 45 || c === 48) add('vis', 'Fog', 50);
  else if (vis != null && vis < 3000) add('vis', 'Poor visibility', 25);

  const g = h.gust ?? h.wind ?? 0;
  if (g >= 90) add('wind', 'Severe gusts', 85);
  else if (g >= 70) add('wind', 'Very strong gusts', 65);
  else if (g >= 55) add('wind', 'Strong gusts', 40);
  else if (g >= 40) add('wind', 'Gusty wind', 15);

  const p = h.precip ?? 0;
  if (!f.some((x) => x.key === 'snow' || x.key === 'ice')) {
    if (p >= 10 || c === 82) add('rain', 'Very heavy rain', 40);
    else if (p >= 4 || c === 65) add('rain', 'Heavy rain', 20);
  }

  f.sort((a, b) => b.points - a.points);
  // Worst factor dominates; each further factor adds a third of its points.
  const score = f.length ? Math.min(100, f[0].points + f.slice(1).reduce((s, x) => s + x.points * 0.3, 0)) : 0;
  return { score: Math.round(score), factors: f };
}

// Worst hour between two instants. hours: [{ t (UTC ms), ...fields }] sorted by t.
export function assessWindow(hours, fromMs, toMs) {
  const inWin = hours.filter((h) => h.t + HOUR > fromMs && h.t <= toMs);
  if (!inWin.length) return { score: 0, level: 'unknown', factors: [], worst: null, hours: [] };
  let worst = null;
  const byKey = new Map();
  for (const h of inWin) {
    const s = scoreHour(h);
    if (!worst || s.score > worst.score) worst = { ...s, hour: h };
    for (const x of s.factors) if (!byKey.has(x.key) || byKey.get(x.key).points < x.points) byKey.set(x.key, x);
  }
  const factors = [...byKey.values()].sort((a, b) => b.points - a.points);
  return { score: worst.score, level: levelOf(worst.score), factors, worst: worst.hour, hours: inWin };
}

export function confidence(leadMs) {
  const d = leadMs / (24 * HOUR);
  if (d <= 3) return { key: 'good', text: 'Forecast confidence is good at this range.' };
  if (d <= 7) return { key: 'fair', text: `This is ${Math.round(d)} days out, so timing and intensity can still shift. Check again closer to the day.` };
  return { key: 'outlook', text: `This is ${Math.round(d)} days out. Treat it as an outlook, not a forecast, and check again within a week of travel.` };
}

/* ---------- Trip ---------- */

// airports: [{ code, lat, lon, tz, ... }], depLocal: wall-clock at first airport,
// layovers: minutes per connection, durations: optional minutes per leg.
export function planTrip(airports, depLocal, layovers = [], durations = []) {
  const legs = [];
  let t = localToUtc(depLocal, airports[0].tz);
  for (let i = 0; i < airports.length - 1; i++) {
    const estimated = !durations[i];
    const dur = durations[i] || estimateFlightMin(airports[i], airports[i + 1]);
    const dep = t, arr = t + dur * 60e3;
    legs.push({ from: airports[i], to: airports[i + 1], dep, arr, dur, estimated });
    t = arr + (layovers[i] ?? 90) * 60e3;
  }
  const stops = airports.map((a, i) => {
    const arr = i > 0 ? legs[i - 1].arr : null;
    const dep = i < legs.length ? legs[i].dep : null;
    const role = arr == null ? 'origin' : dep == null ? 'destination' : 'connection';
    return {
      airport: a, role, arr, dep,
      layover: role === 'connection' ? Math.round((dep - arr) / 60e3) : null,
      from: (arr ?? dep) - HOUR, to: (dep ?? arr) + HOUR,
    };
  });
  return { legs, stops, start: legs[0].dep, end: legs[legs.length - 1].arr };
}

const bufferPoints = (min) => (min < 45 ? 35 : min < 60 ? 25 : min < 90 ? 12 : min < 120 ? 5 : min >= 180 ? -10 : 0);

// forecasts: Map(code -> hours[]). Returns per-stop weather risk plus an overall verdict.
export function assessTrip(plan, forecasts, now = Date.now()) {
  const stops = plan.stops.map((s) => {
    const hours = forecasts.get(s.airport.code) || [];
    const w = assessWindow(hours, s.from, s.to);
    const at = (ms) => hours.find((h) => h.t <= ms && ms < h.t + HOUR) || null;
    return { ...s, weather: w, atArr: s.arr ? at(s.arr) : null, atDep: s.dep ? at(s.dep) : null };
  });
  stops.forEach((s, i) => {
    if (s.role !== 'connection') { s.score = s.weather.score; s.level = s.weather.level; return; }
    // A late inbound flight is what breaks a connection: count weather where it departs at half weight.
    const upstream = stops[i - 1].weather.score * 0.5;
    const base = Math.max(s.weather.score, upstream);
    let score = Math.max(0, Math.min(100, base + bufferPoints(s.layover)));
    if (base < 15) score = Math.min(score, 29); // a short layover alone is flagged in words, not as weather risk
    s.score = Math.round(score);
    s.level = s.weather.level === 'unknown' ? 'unknown' : levelOf(score);
    s.buffer = s.layover < 60 ? 'tight' : s.layover < 120 ? 'normal' : 'generous';
  });
  const known = stops.filter((s) => s.level !== 'unknown');
  const worst = known.reduce((a, b) => (b.score > (a?.score ?? -1) ? b : a), null);
  return {
    stops, worst,
    level: worst ? worst.level : 'unknown',
    partial: known.length !== stops.length,
    confidence: confidence(plan.start - now),
    headline: headline(stops, worst),
  };
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
export function factorPhrase(factors) {
  const l = factors.slice(0, 2).map((f) => lower(f.label));
  return l.length === 2 ? `${l[0]} and ${l[1]}` : l[0] || '';
}

function headline(stops, worst) {
  if (!worst) return { title: 'No forecast yet for these dates', body: 'Forecasts reach about 16 days ahead. Check back closer to your trip.' };
  const city = (s) => s.airport.city || s.airport.code;
  const conn = stops.filter((s) => s.role === 'connection');
  const why = factorPhrase(worst.weather.factors);
  if (worst.level === 'low') {
    const tight = conn.find((s) => s.buffer === 'tight');
    return tight
      ? { title: 'Weather looks fine, but your layover is short', body: `Nothing in the forecast should slow these airports, though ${fmtDuration(tight.layover)} in ${city(tight)} leaves little room if anything else runs late.` }
      : { title: 'Weather looks clear along your route', body: 'Nothing in the forecast that usually slows these airports down while you are there.' };
  }
  const word = worst.level === 'high' ? 'High' : 'Elevated';
  if (worst.role === 'connection') {
    const local = worst.weather.level !== 'low';
    const title = worst.level === 'high' ? `Your connection in ${city(worst)} is at risk` : `Keep an eye on your connection in ${city(worst)}`;
    const cause = local && why
      ? `The forecast shows ${why} in ${city(worst)} while you are there`
      : `Weather where your inbound flight departs could make you late into ${city(worst)}`;
    const buf = worst.buffer === 'tight' ? `, and a ${fmtDuration(worst.layover)} layover leaves almost no buffer`
      : worst.buffer === 'generous' ? `, though your ${fmtDuration(worst.layover)} layover gives you room` : `, with a ${fmtDuration(worst.layover)} layover`;
    return { title, body: `${cause}${buf}.` };
  }
  const what = worst.role === 'origin' ? 'departure from' : 'arrival into';
  return { title: `${word} weather risk for your ${what} ${city(worst)}`, body: `The forecast shows ${why} around the time of your flight.` };
}
