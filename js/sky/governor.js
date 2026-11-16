// Frame-time governor for the animated sky. Pure logic: no DOM, no WebGL, no clocks of its own, so it can be
// unit-tested in plain Node (tests/sky-governor.test.mjs). js/sky.js feeds it frame-cost samples and applies
// the tier it asks for; this file only decides.
//
// The idea: the sky is decoration, and it runs on devices we have never tested. So it measures what each
// frame really costs on this device and steps down through cheaper TIERS until frames are comfortably
// within budget, down to a single still frame with the loop stopped. It steps down fast (a few slow frames
// are enough), steps up rarely and only on clear evidence, and never bounces between two tiers.
//
// Samples come from one of three sources (js/sky.js picks the best one available):
//   'gpu'   - GPU time of the sky draw from a WebGL timer query. Direct and precise, so it shows both
//             overload and headroom. Budget: gpuShare of the tier's frame interval.
//   'fence' - time from submitting the draw until a WebGL2 fence after it reports done, polled without
//             blocking. An upper bound on GPU time (it includes queueing and a few ms of polling slack),
//             so it is judged against the same budget with a little more allowance.
//   'frame' - interval between two drawn frames (requestAnimationFrame timestamps). It only reveals cost once
//             the device can no longer keep the tier's frame rate (a healthy device reads ~1.0 whatever the
//             real cost), so it is good for stepping down and weak evidence for stepping up.
// Either way a sample becomes a "load": 1.0 means exactly at budget.

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
  down: { gpu: 1.0, fence: 1.3, frame: 1.3 },   // ...with a median load above this. 'frame' allows for vsync
                         //    rounding (75 Hz or 50 Hz screens read 1.2 when healthy; a missed vsync reads 1.5).
                         //    'fence' allows ~2.5 ms of polling and queueing slack.
  severe: 2.5,           // this many times over budget...
  severeRun: 3,          // ...on this many samples in a row: step down at once, without waiting for the window
  fitLoad: 0.8,          // when stepping down, go straight to the first tier whose estimated load is below this
  lastChance: 1.5,       // ...or, if none, still try the cheapest animated tier if its estimate is below this
  up: { gpu: 0.4, fence: 0.5, frame: 1.1 },      // a step up needs every load at or below this...
  upRun: { gpu: 90, fence: 150, frame: 450 },    // ...for this many samples in a row (3 s / 5 s / 15 s at 30 fps)
  upFit: 0.7,            // and (not 'frame') the tier above must be estimated to stay below this load
  maxUpgrades: 2,        // per session
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

// Estimated load if the same work ran at tier `to` instead of `from` (cost scales with pixels and features,
// the budget with the frame interval).
function estimate(load, from, to) {
  if (TIERS[to].fps === 0) return 0;
  return load * (TIERS[to].cost / TIERS[from].cost) * (TIERS[to].fps / TIERS[from].fps);
}

// createGovernor({ start, floor }) - start: first tier. Returns an object with:
//   sample(ms, at, source)  feed one measurement (at = timestamp in ms). Returns null, or a decision
//                           { tier, from, reason, measured: true } that the caller must apply.
//   reset(at, why)          start a warm-up (call after start, resize, tab re-show, a kind crossfade, and
//                           after applying a decision) and forget the rolling window.
//   tier, ceiling, upgrades, lastLoad, medianMs  current state, for debugging.
export function createGovernor({ start = 0, settings = SETTINGS } = {}) {
  const S = settings;
  const g = {
    tier: Math.min(STILL, Math.max(0, start | 0)),
    ceiling: 0,            // best tier still allowed this session (a tier that failed after an upgrade is locked out)
    upgrades: 0,
    lastLoad: 0,
    medianMs: 0,
    source: 'frame',
  };
  let resetAt = -Infinity, seen = 0;
  let loads = [], msWin = [], slowRun = 0, goodRun = 0;
  const failed = new Array(TIERS.length).fill(0);   // how often each tier has been stepped down from
  let upgradedInto = -1;                            // the tier the last upgrade went to

  g.reset = (at = 0) => { resetAt = at; seen = 0; loads = []; msWin = []; slowRun = 0; goodRun = 0; };

  function move(to, reason) {
    const from = g.tier;
    if (to > from) {
      failed[from]++;
      // An upgrade that did not hold is not tried again this session: no oscillation.
      if (upgradedInto === from) g.ceiling = Math.max(g.ceiling, from + 1);
    } else {
      g.upgrades++;
      upgradedInto = to;
    }
    g.tier = to;
    g.reset(-Infinity);   // the caller resets again with a real timestamp when it applies the change
    return { tier: to, from, reason, measured: true };
  }

  // The cheapest step that should fit: the first tier below this one whose estimated load is under
  // fitLoad. If none fits but the cheapest animated tier is not hopeless, try that before giving up on
  // motion: the cost model is a guess, and that tier will be measured like any other.
  function fitBelow(load) {
    for (let t = g.tier + 1; t < STILL; t++) if (estimate(load, g.tier, t) <= S.fitLoad) return t;
    const last = STILL - 1;
    return g.tier < last && estimate(load, g.tier, last) <= S.lastChance ? last : STILL;
  }

  g.sample = (ms, at = 0, source = 'frame') => {
    if (g.tier === STILL || !(ms >= 0) || !Number.isFinite(ms)) return null;
    g.source = source;
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
      const m = median(loads.slice(-S.severeRun));
      return move(fitBelow(m), `very slow: ${source} ${g.medianMs.toFixed(1)} ms, load ${m.toFixed(2)}`);
    }
    // Consistently over budget: the median ignores the odd spike (GC, a big layout, a background tab).
    if (loads.length >= S.minDecide) {
      const m = median(loads);
      if (m > S.down[source]) {
        return move(fitBelow(m), `slow: ${source} median ${g.medianMs.toFixed(1)} ms, load ${m.toFixed(2)}`);
      }
    }

    // Stepping up: only with a long clean run, at most maxUpgrades times, never past the ceiling, never into
    // a tier that has already failed twice.
    goodRun = load <= S.up[source] ? goodRun + 1 : 0;
    const up = g.tier - 1;
    if (up >= g.ceiling && g.upgrades < S.maxUpgrades && failed[up] < 2 && goodRun >= S.upRun[source]) {
      const m = median(loads);
      if (source === 'frame' || estimate(m, g.tier, up) <= S.upFit) {
        return move(up, `headroom: ${source} median ${g.medianMs.toFixed(1)} ms, load ${m.toFixed(2)}`);
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
