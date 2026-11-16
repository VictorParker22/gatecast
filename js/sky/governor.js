// Frame-time governor for the animated sky. Pure logic: no DOM, no WebGL, no clocks of its own, so it can be
// unit-tested in plain Node (tests/sky-governor.test.mjs). js/sky.js feeds it frame-cost samples and applies
// the tier it asks for; this file only decides.
//
// The idea: the sky is decoration, and it runs on devices we have never tested. So it measures what each
// frame really costs on this device and steps down through cheaper TIERS until frames are comfortably
// within budget, down to a single still frame with the loop stopped. It steps down fast (a few slow frames
// are enough), steps up rarely and only on clear evidence, and never bounces between two tiers.
//
// Samples come from one of two sources (js/sky.js picks the best one available):
//   'gpu'   - GPU time of the sky draw from a WebGL timer query. Direct and precise, so it shows both
//             overload and headroom. Budget: gpuShare of the tier's frame interval.
//   'frame' - interval between two drawn frames (requestAnimationFrame timestamps). It only reveals cost once
//             the device can no longer keep the tier's frame rate (a healthy device reads ~1.0 whatever the
//             real cost), and it also measures main-thread stalls that have nothing to do with the sky.
// A sample becomes a "load" for its source: 1.0 means exactly at budget.
//
// Jank versus overload on 'frame' timing. Jank passes; GPU overload does not. So:
//   - the first loadWarmMs after navigation (module loading, first render, the arrival animation) are not
//     judged at all, and the caller drops samples that overlapped a long main-thread task it did not cause;
//   - a 'frame' downgrade is provisional: after a calm spell the tier it left is tried again (spaced out,
//     at most maxRetrials per session, from the still frame too). A truly slow device fails that re-trial
//     within a second or so; after two such failures the downgrade is confirmed and final; jank that has passed does not
//     come back, so the sky returns to where it was;
//   - only confirmed results are remembered (see memory()): 'gpu' measurements, or a 'frame' tier that failed
//     again during its re-trial, and never anything decided in the first persistAfterMs of the page.
// On 'frame' timing a healthy interval says nothing about spare capacity, so apart from re-trials it never
// steps up; an overloaded interval is a lower bound on the frame's cost and picks the step down.

// Quality tiers, best first. res: resolution factor on top of the base device-pixel scale (pixel count goes
// with its square); lite: compile the cheaper shader variant (3 noise octaves, one rain layer, two snow
// layers, steady stars); fps: loop rate, 0 = one still frame and no loop; cost: rough GPU cost of one frame
// relative to 'full', used to guess how far to jump when frames are far over budget.
export const TIERS = [
  { name: 'full',      res: 1,    lite: false, fps: 30, cost: 1 },
  { name: 'res-0.7',   res: 0.7,  lite: false, fps: 30, cost: 0.49 },
  { name: 'res-0.5',   res: 0.5,  lite: false, fps: 30, cost: 0.25 },
  { name: 'lite',      res: 0.5,  lite: true,  fps: 30, cost: 0.19 },
  { name: 'lite-15fps', res: 0.5, lite: true,  fps: 15, cost: 0.19 },
  // The still frame is drawn once (and again on resize or a weather change), so it can afford full features
  // at a moderate resolution; the loop never runs at this tier.
  { name: 'still',     res: 0.7,  lite: false, fps: 0,  cost: 0 },
];
export const STILL = TIERS.length - 1;

export const SETTINGS = {
  gpuShare: 0.25,        // the sky may use at most a quarter of the GPU time between its frames (~8 ms at 30 fps)
  warmSamples: 3,        // after start/resize/re-show/crossfade/tier change, ignore this many samples...
  warmMs: 400,           // ...and everything in the first 400 ms (shader compile, page load, layout settle)
  window: 10,            // rolling window of recent loads
  minDecide: 6,          // a downgrade needs at least this many samples in the window...
  down: { gpu: 1.0, frame: 1.3 },   // ...with a median load above this. 'frame' allows for vsync rounding
                         //    (75 Hz or 50 Hz screens read 1.2 when healthy; a missed vsync reads 1.5).
  severe: 2.5,           // this many times over budget...
  severeRun: 3,          // ...on this many samples in a row: step down at once, without waiting for the window
  fitLoad: 0.8,          // when stepping down, go straight to the first tier whose estimated GPU load is below
                         //    this (estimated from the measured cost and the tiers' relative costs)...
  lastChance: 1.5,       // ...or, if none and timing is 'gpu', try the cheapest animated tier if its estimate is
                         //    below this: the cost model is a guess, and 'gpu' timing will check it
  up: { gpu: 0.4, frame: 1.1 },     // a step up needs every load at or below this...
  upRun: { gpu: 90, frame: Infinity },  // ...for this many samples in a row (3 s at 30 fps). Never on 'frame'
                         //    timing: a healthy frame interval says nothing about spare GPU capacity.
  upFit: 0.7,            // and the tier above must be estimated to stay below this GPU load
  maxUpgrades: 2,        // per session ('gpu' timing)
  loadWarmMs: 2500,      // 'frame' timing: nothing in the first 2.5 s after navigation is judged (page-load jank)
  retryCalmMs: 4000,     // after a provisional ('frame') downgrade, re-try the tier above after 4 s of calm...
  retryBackoff: 2,       // ...then 8 s, 16 s: each re-trial waits twice as long
  maxRetrials: 3,        // re-trials per session, so a weak device sees at most a couple of brief stutters
  probationMs: 8000,     // a re-tried tier that fails within this time counts as a failed re-trial...
  confirmTrials: 2,      // ...and two failed re-trials of the same tier confirm it too slow for the session.
                         //    One is not enough: a stall lasting several seconds can span a single re-trial,
                         //    and browsers without long-task reports (Safari) cannot tell that from overload.
  persistAfterMs: 5000,  // nothing is remembered before the page has been up this long
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Load of one sample at a tier: measured ms divided by the budget for that source.
export function loadOf(ms, source, tier, settings = SETTINGS) {
  const fps = TIERS[tier].fps || 30;
  const frameMs = 1000 / fps;
  return source === 'frame' ? ms / frameMs : ms / (frameMs * settings.gpuShare);
}

// Estimated GPU load at tier `to` for a device whose full-quality frame costs `fullMs` (cost scales with
// pixels and features, the budget with the frame interval).
function estimate(fullMs, to, settings) {
  if (TIERS[to].fps === 0) return 0;
  return (fullMs * TIERS[to].cost) / ((1000 / TIERS[to].fps) * settings.gpuShare);
}

// createGovernor({ start, bornAt, settings }) - start: first tier; bornAt: the navigation time on the same
// clock as the sample timestamps (0 for performance.now()). Returns an object with:
//   sample(ms, at, source, jank)  feed one measurement (at = timestamp in ms; jank = it overlapped a long
//                           main-thread task, so it is ignored). Returns null, or a decision
//                           { tier, from, reason, confirmed } that the caller must apply.
//   poll(at)                call about once a second while the sky could animate (visible, no hold): returns
//                           a re-trial decision when one is due, else null. Works at the still tier too.
//   memory(at)              the tier worth remembering for this device now, or null if nothing is confirmed.
//   reset(at)               start a warm-up (call after start, resize, tab re-show, a kind crossfade, and
//                           after applying a decision) and forget the rolling window.
//   tier, ceiling, upgrades, retrials, pending, lastLoad, medianMs  current state, for debugging.
export function createGovernor({ start = 0, bornAt = 0, settings = SETTINGS } = {}) {
  const S = settings;
  const g = {
    tier: Math.min(STILL, Math.max(0, start | 0)),
    ceiling: 0,            // best tier still allowed this session (a tier that failed after an upgrade is locked out)
    upgrades: 0,
    retrials: 0,
    pending: null,         // best tier left by an unconfirmed ('frame') downgrade: the next re-trial target
    confirmed: false,      // whether the current tier was reached on confirmed evidence (worth remembering)
    lastLoad: 0,
    medianMs: 0,
    source: 'frame',
  };
  let resetAt = -Infinity, seen = 0, changedAt = bornAt;
  let loads = [], msWin = [], slowRun = 0, goodRun = 0;
  let upgradedInto = -1;                            // the tier the last 'gpu' upgrade went to
  let trial = null;                                 // { tier, until }: a re-trial on probation
  const failedTrials = TIERS.map(() => 0);          // failed re-trials per tier, this session

  g.reset = (at = 0) => { resetAt = at; seen = 0; loads = []; msWin = []; slowRun = 0; goodRun = 0; };

  // A tier proved too slow: it and everything better are closed for the session.
  const close = (t) => {
    g.ceiling = Math.max(g.ceiling, t + 1);
    if (g.pending != null && g.pending < g.ceiling) g.pending = null;
  };

  function move(to, reason, at, source) {
    const from = g.tier;
    let confirmed;
    if (to > from) {
      // Down. A tier that fails again during its re-trial, or right after a headroom upgrade, is closed for
      // the session (no oscillation) once it has failed confirmTrials re-trials. Worth remembering: 'gpu' timing
      // (direct evidence) or a closed tier.
      // Any other 'frame' downgrade may be jank, so it is provisional and its tier gets re-tried later.
      const retried = trial && trial.tier === from && at <= trial.until;
      if (retried) failedTrials[from]++;
      const final = (retried && failedTrials[from] >= S.confirmTrials) || upgradedInto === from;
      confirmed = source === 'gpu' || final;
      if (final) close(from);
      else if (source !== 'gpu' && g.retrials < S.maxRetrials) g.pending = g.pending == null ? from : Math.min(g.pending, from);
      trial = null;
    } else if (reason.startsWith('re-trial')) {
      confirmed = false;
      g.retrials++;
      g.pending = null;
      trial = { tier: to, until: at + S.probationMs };
    } else {
      confirmed = true;   // 'gpu' headroom
      g.upgrades++;
      upgradedInto = to;
    }
    g.tier = to;
    g.confirmed = confirmed;
    changedAt = at;
    g.reset(-Infinity);   // the caller resets again with a real timestamp when it applies the change
    return { tier: to, from, reason, confirmed };
  }

  g.poll = (at) => {
    if (trial && at > trial.until) trial = null;   // the re-trial held: the earlier downgrade was jank
    const t = g.pending;
    if (t == null || t >= g.tier || t < g.ceiling || g.retrials >= S.maxRetrials) return null;
    if (at - changedAt < S.retryCalmMs * S.retryBackoff ** g.retrials) return null;
    return move(t, `re-trial ${g.retrials + 1}/${S.maxRetrials} of ${TIERS[t].name} after a calm spell`, at, 'frame');
  };

  g.memory = (at) => (g.confirmed && !trial && at - bornAt >= S.persistAfterMs ? g.tier : null);

  // The best tier below this one whose estimated load fits, from a measured frame cost in ms. With 'gpu'
  // timing, if nothing fits but the cheapest animated tier is not hopeless, try it (it will be measured).
  function fitBelow(ms, source) {
    const fullMs = ms / TIERS[g.tier].cost;   // for 'frame' timing, a lower bound
    for (let t = g.tier + 1; t < STILL; t++) if (estimate(fullMs, t, S) <= S.fitLoad) return t;
    const last = STILL - 1;
    return source === 'gpu' && g.tier < last && estimate(fullMs, last, S) <= S.lastChance ? last : STILL;
  }

  g.sample = (ms, at = 0, source = 'frame', jank = false) => {
    if (g.tier === STILL || !(ms >= 0) || !Number.isFinite(ms)) return null;
    g.source = source;
    if (source === 'frame' && (jank || at - bornAt < S.loadWarmMs)) return null;   // main-thread noise
    seen++;
    if (seen <= S.warmSamples || at - resetAt < S.warmMs) return null;   // warm-up: noisy, ignore

    const load = loadOf(ms, source, g.tier, S);
    g.lastLoad = load;
    loads.push(load); msWin.push(ms);
    if (loads.length > S.window) { loads.shift(); msWin.shift(); }
    g.medianMs = median(msWin);

    // Far over budget several frames running: go now, and as far as the numbers say.
    slowRun = load > S.severe ? slowRun + 1 : 0;
    if (slowRun >= S.severeRun) {
      const m = median(msWin.slice(-S.severeRun));
      return move(fitBelow(m, source), `very slow: ${source} ${m.toFixed(1)} ms, load ${median(loads.slice(-S.severeRun)).toFixed(2)}`, at, source);
    }
    // Consistently over budget: the median ignores the odd spike (GC, a big layout, a background tab).
    if (loads.length >= S.minDecide) {
      const m = median(loads);
      if (m > S.down[source]) {
        return move(fitBelow(g.medianMs, source), `slow: ${source} median ${g.medianMs.toFixed(1)} ms, load ${m.toFixed(2)}`, at, source);
      }
    }

    // Stepping up on measured headroom ('gpu' only): a long clean run, at most maxUpgrades times, never
    // past the ceiling.
    goodRun = load <= S.up[source] ? goodRun + 1 : 0;
    const up = g.tier - 1;
    if (up >= g.ceiling && g.upgrades < S.maxUpgrades && goodRun >= S.upRun[source]) {
      if (estimate(g.medianMs / TIERS[g.tier].cost, up, S) <= S.upFit) {
        return move(up, `headroom: ${source} median ${g.medianMs.toFixed(1)} ms, load ${median(loads).toFixed(2)}`, at, source);
      }
    }
    return null;
  };
  return g;
}

// --- Where to start, and when to hold still -----------------------------------------------------------

// Starting tier. A remembered tier for this device wins; otherwise core count and memory are a weak prior
// (the governor can still step up from it). saveData is handled as a hold (see holdReason), not here.
export function startTier({ remembered = null, cores = 0, memory = 0 } = {}) {
  if (remembered != null && remembered >= 0 && remembered <= STILL) return { tier: remembered, reason: 'remembered for this device' };
  if ((memory && memory <= 2) || (cores && cores <= 2)) return { tier: 2, reason: `prior: ${cores || '?'} cores, ${memory || '?'} GB` };
  if ((memory && memory <= 4) || (cores && cores <= 4)) return { tier: 1, reason: `prior: ${cores || '?'} cores, ${memory || '?'} GB` };
  return { tier: 0, reason: 'default' };
}

// Battery hold with hysteresis: hold below 20% while discharging, release once charging or back at 25%.
export function batteryHold(holding, battery) {
  if (!battery || typeof battery.level !== 'number') return false;
  if (battery.charging) return false;
  return holding ? battery.level < 0.25 : battery.level < 0.2;
}

// Why the sky must stay still regardless of measurements, or '' if it need not.
export function holdReason({ saveData = false, battery = false } = {}) {
  if (saveData) return 'save-data';
  if (battery) return 'low battery';
  return '';
}

// --- Remembering the settled tier ---------------------------------------------------------------------

export const MEMORY_KEY = 'gatecast.sky.tier';
export const MEMORY_MS = 7 * 24 * 3600e3;   // a week: after that (or a browser/GPU/screen change) re-learn

// Short, stable fingerprint of what decides performance: browser build, GPU string, pixel ratio.
// A browser update changes the user agent, so it gets a fresh measurement.
export function signature(parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

export function rememberTier(tier, now, sig) {
  return JSON.stringify({ v: 1, tier, at: now, sig });
}

// The remembered tier, or null if there is none, it is stale, from another device setup, or malformed.
export function recallTier(raw, now, sig) {
  try {
    const m = JSON.parse(raw);
    if (!m || m.v !== 1 || m.sig !== sig || !Number.isInteger(m.tier) || m.tier < 0 || m.tier > STILL) return null;
    if (!(now - m.at >= 0 && now - m.at < MEMORY_MS)) return null;
    return m.tier;
  } catch { return null; }
}
