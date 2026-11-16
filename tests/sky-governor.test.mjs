import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, STILL, SETTINGS, createGovernor, startTier, batteryHold, holdReason, loadOf,
  rememberTier, recallTier, signature, MEMORY_MS } from '../js/sky/governor.js';

// Drive a governor like js/sky.js does: samples at the tier's frame rate, applying every decision and
// restarting the warm-up after it. `cost(tier, i)` returns the measured ms for sample i on that tier.
function run(gov, cost, n, { source = 'frame', startAt = 0 } = {}) {
  let at = startAt;
  const changes = [];
  gov.reset(at);
  for (let i = 0; i < n && gov.tier !== STILL; i++) {
    const fps = TIERS[gov.tier].fps;
    const ms = cost(gov.tier, i);
    at += source === 'frame' ? Math.max(ms, 1000 / fps) : 1000 / fps;
    const d = gov.sample(source === 'frame' ? Math.max(ms, 1000 / fps) : ms, at, source);
    if (d) { changes.push({ i, ...d }); gov.reset(at); }
  }
  return changes;
}

// A fuller simulation of js/sky.js on a clock: samples while the tier animates (the frame interval can never
// beat the tier's frame rate), nothing at the still tier, poll() once a second, memory() written whenever
// it has something. `cost(tier, t)` gives the frame's ms at time t; `jank(t)` marks samples a long-task
// observer would flag. Returns the tier changes, what was remembered, and the final state.
function live(gov, cost, untilMs, { source = 'frame', jank = () => false } = {}) {
  let t = 0, nextPoll = 1000;
  const changes = [], remembered = [];
  gov.reset(0);
  const apply = (d) => { if (d) { changes.push({ t: Math.round(t), ...d }); gov.reset(t); } };
  while (t < untilMs) {
    if (TIERS[gov.tier].fps) {
      const ms = cost(gov.tier, t);
      const sample = source === 'frame' ? Math.max(ms, 1000 / TIERS[gov.tier].fps) : ms;
      t += source === 'frame' ? sample : 1000 / TIERS[gov.tier].fps;
      apply(gov.sample(sample, t, source, jank(t)));
    } else t += 100;
    if (t >= nextPoll) { nextPoll += 1000; apply(gov.poll(t)); }
    const m = gov.memory(t);
    if (m != null && remembered[remembered.length - 1] !== m) remembered.push(m);
  }
  return { changes, remembered, tier: gov.tier, retrials: gov.retrials };
}

// The traces from the lead's review: a capable phone on 'frame' timing (33 ms frames) with a burst of jank.
// `at` = how many good frames come first. Returns a cost function.
const burst = (at, frames, ms) => {
  let i = 0;   // counts frames, as the traces do
  return () => { i++; return i > at && i <= at + frames ? ms : 33.3; };
};
const TRACES = {
  '8 frames of 120 ms after 15 good frames': [15, 8, 120],
  'one long task: 3 frames of 250 ms after 20 good frames': [20, 3, 250],
  'mild jank: 12 frames of 50 ms after 20 good frames': [20, 12, 50],
};

// A device whose full-tier frame costs `fullMs`, scaling with each tier's relative cost.
const device = (fullMs, jitter = () => 0) => (tier, i) => fullMs * TIERS[tier].cost + jitter(i);

test('a steady fast device stays at the top tier', () => {
  for (const source of ['frame', 'gpu']) {
    const gov = createGovernor({ start: 0 });
    const changes = run(gov, source === 'gpu' ? device(3) : () => 1000 / 30, 5000, { source });
    assert.deepEqual(changes, [], source);
    assert.equal(gov.tier, 0);
  }
});

test('a steady slow device steps down to the still frame within a bounded number of samples', () => {
  // Like the software renderer here: about 3 frames a second at full quality.
  for (const source of ['frame', 'gpu']) {
    const gov = createGovernor({ start: 0 });
    const changes = run(gov, device(330), 1000, { source });
    assert.equal(gov.tier, STILL, source);
    const last = changes[changes.length - 1];
    assert.ok(last.i < 40, `${source}: reached still after ${last.i} samples`);
    assert.ok(changes.length <= 3, `${source}: ${changes.length} steps`);
    for (let k = 1; k < changes.length; k++) assert.ok(changes[k].tier > changes[k - 1].tier, 'only ever down');
    assert.match(last.reason, /slow/);
  }
  // With GPU timing, a device the cost model calls nearly hopeless still gets one measured try at the
  // cheapest animated tier, and goes still only if that is slow too.
  const tried = createGovernor({ start: 0 });
  const steps = run(tried, (tier) => 100 * TIERS[tier].cost * (tier === 4 ? 1.2 : 1), 1000, { source: 'gpu' });
  assert.deepEqual(steps.map((c) => c.tier), [4, STILL]);

  // Moderately slow (frames at 45 ms on 'frame' timing, i.e. the GPU is saturated at full quality): a big
  // step, but motion stays.
  const mid = createGovernor({ start: 0 });
  run(mid, device(45), 3000);
  assert.ok(mid.tier > 0 && mid.tier < STILL, `settled at ${TIERS[mid.tier].name}`);

  // GPU timing: 20 ms of GPU per frame at full quality (budget about 8 ms) settles where it fits.
  const g = createGovernor({ start: 0 });
  run(g, device(20), 3000, { source: 'gpu' });
  assert.ok(20 * TIERS[g.tier].cost <= (1000 / TIERS[g.tier].fps) * SETTINGS.gpuShare, TIERS[g.tier].name);
  assert.ok(g.tier < STILL);
});

test('a single slow spike does not trigger a downgrade', () => {
  for (const source of ['frame', 'gpu']) {
    const gov = createGovernor({ start: 0 });
    const base = source === 'gpu' ? 3 : 1000 / 30;
    const changes = run(gov, (t, i) => (i === 50 || i === 400 ? 900 : base), 1000, { source });
    assert.deepEqual(changes, [], source);
    // Two spikes in a row are still not "consistently slow" either.
    const gov2 = createGovernor({ start: 0 });
    assert.deepEqual(run(gov2, (t, i) => (i === 50 || i === 51 ? 900 : base), 1000, { source }), [], source);
  }
});

test('a borderline device does not oscillate', () => {
  // Full tier sits right at the edge (frames alternate around the threshold); the next tier is fine.
  for (const source of ['frame', 'gpu']) {
    const gov = createGovernor({ start: 0 });
    const edge = source === 'gpu' ? 8.5 : 44;
    const changes = run(gov, (tier, i) => (tier === 0 ? edge + (i % 2 ? 3 : -3) : (source === 'gpu' ? 3.5 : 1000 / 30)), 20000, { source });
    assert.ok(changes.length >= 1 && changes.length <= 3, `${source}: ${changes.length} changes`);
    const tail = changes.filter((c) => c.i > 2000);
    assert.deepEqual(tail, [], `${source}: still changing late`);
    assert.ok(gov.tier > 0 && gov.tier < STILL, source);
    if (source === 'gpu') assert.equal(gov.tier, 1, 'GPU timing takes the one step that fits');
  }
  // A device the cost model misjudges: the tier above looks affordable from below but is slow when tried.
  // It is tried once, then locked out: down, up, down, and stable from then on.
  {
    const gov = createGovernor({ start: 1 });
    const cost = { 0: 20, 1: 9, 2: 2.5 };
    const changes = run(gov, (tier, i) => (cost[tier] ?? 1) * (1 + 0.1 * Math.sin(i / 7)), 30000, { source: 'gpu' });
    assert.deepEqual(changes.map((c) => c.tier), [2, 1, 2]);
    assert.equal(gov.ceiling, 2);
    assert.deepEqual(changes.filter((c) => c.i > 2000), []);
  }
});

test('warm-up samples are ignored', () => {
  const gov = createGovernor({ start: 0 });
  gov.reset(0);
  // Huge first frames (shader compile, page load) inside the warm-up never count.
  for (let i = 1; i <= SETTINGS.warmSamples; i++) assert.equal(gov.sample(2000, i * 1000, 'frame'), null);
  // Also time-based: within warmMs of a reset, even many samples are ignored.
  gov.reset(10_000);
  for (let i = 1; i <= 20; i++) assert.equal(gov.sample(2000, 10_000 + i * 10, 'frame'), null);
  assert.equal(gov.tier, 0);
  // After the warm-up, the same slowness is acted on.
  let d = null;
  for (let i = 0; i < 10 && !d; i++) d = gov.sample(2000, 11_000 + i * 2000, 'frame');
  assert.ok(d && d.tier > 0);
});

test('upgrades are capped and a failed upgrade is not retried', () => {
  // A device that alternates long fast and slow phases (thermal throttling, a background job, ...).
  const gov = createGovernor({ start: 0 });
  const phase = 2000;
  const changes = run(gov, (tier, i) => (Math.floor(i / phase) % 2 ? 2 : 12) * TIERS[tier].cost, 40000, { source: 'gpu' });
  const ups = changes.filter((c) => c.tier < c.from);
  assert.ok(ups.length >= 1 && ups.length <= SETTINGS.maxUpgrades, `${ups.length} upgrades`);
  assert.equal(gov.upgrades, ups.length);
  // An upgrade that was followed by a step down from the same tier locks that tier out.
  changes.forEach((c, k) => {
    if (c.tier < c.from && changes[k + 1]?.from === c.tier) {
      assert.ok(!changes.slice(k + 1).some((later) => later.tier < later.from && later.tier <= c.tier), 'retried a failed tier');
      assert.ok(gov.ceiling > c.tier);
    }
  });

  // Started low (a remembered or prior tier) on a device that is in fact fast: climbs, but at most twice.
  const low = createGovernor({ start: 4 });
  const climbed = run(low, () => 0.5, 20000, { source: 'gpu' });
  assert.equal(climbed.length, SETTINGS.maxUpgrades);
  assert.equal(low.tier, 4 - SETTINGS.maxUpgrades);
  // Climbing is cautious: the first step up needs a long clean run.
  assert.ok(climbed[0].i >= SETTINGS.upRun.gpu, `first upgrade after ${climbed[0].i} samples`);
  // Frame-interval timing cannot see spare capacity, so it never climbs.
  const blind = createGovernor({ start: 4 });
  assert.deepEqual(run(blind, (tier) => 1000 / TIERS[tier].fps, 20000), []);
});

test('the still tier takes no samples and the frame rate tier budgets per frame', () => {
  const gov = createGovernor({ start: STILL });
  for (let i = 0; i < 100; i++) assert.equal(gov.sample(1000, i * 1000, 'frame'), null);
  assert.equal(gov.tier, STILL);
  assert.ok(Math.abs(loadOf(66.7, 'frame', 4) - 1) < 0.01);
  assert.ok(Math.abs(loadOf(33.3, 'frame', 0) - 1) < 0.01);
  assert.ok(loadOf(8, 'gpu', 0) < 1.0001);
  for (const bad of [NaN, -1, Infinity]) assert.equal(createGovernor().sample(bad, 1e6, 'frame'), null);
});

test('starting tier: remembered wins, cores and memory are only a weak prior', () => {
  assert.equal(startTier({ remembered: 3, cores: 16, memory: 8 }).tier, 3);
  assert.equal(startTier({ remembered: STILL }).tier, STILL);
  assert.equal(startTier({ cores: 8, memory: 8 }).tier, 0);
  assert.equal(startTier({}).tier, 0);
  assert.equal(startTier({ cores: 4 }).tier, 1);
  assert.equal(startTier({ cores: 2, memory: 4 }).tier, 2);
  assert.equal(startTier({ cores: 8, memory: 1 }).tier, 2);
  // Never a hard rule: a prior start can still climb.
  const gov = createGovernor({ start: startTier({ cores: 2 }).tier });
  run(gov, () => 0.5, 5000, { source: 'gpu' });
  assert.ok(gov.tier < 2);
});

test('battery and save-data holds', () => {
  assert.equal(batteryHold(false, { charging: false, level: 0.15 }), true);
  assert.equal(batteryHold(false, { charging: true, level: 0.15 }), false);
  assert.equal(batteryHold(false, { charging: false, level: 0.5 }), false);
  assert.equal(batteryHold(true, { charging: false, level: 0.22 }), true, 'hysteresis');
  assert.equal(batteryHold(true, { charging: false, level: 0.3 }), false);
  assert.equal(batteryHold(false, null), false);
  assert.equal(holdReason({ saveData: true }), 'save-data');
  assert.equal(holdReason({ battery: true }), 'low battery');
  assert.equal(holdReason({}), '');
});

test('remembered tier round-trips, expires and is tied to the device', () => {
  const sig = signature(['Mozilla/5.0 Test/1', 'GPU X', '200']);
  assert.equal(sig, signature(['Mozilla/5.0 Test/1', 'GPU X', '200']));
  assert.notEqual(sig, signature(['Mozilla/5.0 Test/2', 'GPU X', '200']));
  const raw = rememberTier(3, 1_000_000, sig);
  assert.equal(recallTier(raw, 1_000_000 + 3600e3, sig), 3);
  assert.equal(recallTier(raw, 1_000_000 + MEMORY_MS + 1, sig), null, 'expired');
  assert.equal(recallTier(raw, 1_000_000 + 3600e3, 'other'), null, 'other device or browser build');
  assert.equal(recallTier(raw, 0, sig), null, 'clock went backwards');
  for (const junk of [null, '', '{', '{"v":1,"tier":99,"at":0,"sig":"x"}', '42']) assert.equal(recallTier(junk, 1, 'x'), null);
});

for (const [name, [at, frames, ms]] of Object.entries(TRACES)) {
  test(`jank at page load leaves a capable 'frame' device animated: ${name}`, () => {
    const r = live(createGovernor({ start: 0 }), burst(at, frames, ms), 60_000);
    assert.equal(r.tier, 0);
    assert.deepEqual(r.remembered, [], 'nothing learned from jank is remembered');
  });

  test(`the same jank later in the session is undone by a re-trial: ${name}`, () => {
    // Shifted to after the page-load warm-up (frame 200 is about 6.7 s in), so the governor does react.
    const r = live(createGovernor({ start: 0 }), burst(at + 200, frames, ms), 60_000);
    assert.equal(r.tier, 0, JSON.stringify(r.changes));
    assert.ok(r.changes.length >= 2 && r.retrials === 1, JSON.stringify(r.changes));
    const back = r.changes[r.changes.length - 1];
    assert.match(back.reason, /re-trial/);
    assert.ok(back.t - r.changes[0].t <= SETTINGS.retryCalmMs + 1100, `back after ${back.t - r.changes[0].t} ms`);
    assert.deepEqual(r.remembered, [], 'a provisional downgrade is never remembered');
  });
}

test('samples overlapping a long main-thread task are ignored', () => {
  const r = live(createGovernor({ start: 0 }), burst(220, 3, 250), 30_000, { jank: (t) => t > 7300 && t < 8100 });
  assert.deepEqual(r.changes, []);
});

test('a persistently slow frame-timed device ends on the still frame after two brief re-trials, and remembers it', () => {
  // Like the software renderer: ~330 ms frames at full quality, scaling with tier cost.
  const r = live(createGovernor({ start: 1 }), (tier) => 330 * TIERS[tier].cost, 120_000);
  assert.equal(r.tier, STILL);
  // One failed re-trial is not proof (a long stall can span it), so the tier is tried twice before it is final.
  assert.equal(r.retrials, SETTINGS.confirmTrials, `${r.retrials} re-trials`);
  const last = r.changes[r.changes.length - 1];
  assert.ok(last.t < 25_000, `final still at ${last.t} ms`);
  assert.equal(last.confirmed, true);
  // Each re-trial was short: from re-trial to giving up again within about a second and a half.
  const trials = r.changes.map((c, i) => [c, r.changes[i + 1]]).filter(([c]) => /re-trial/.test(c.reason));
  assert.equal(trials.length, SETTINGS.confirmTrials);
  for (const [start, end] of trials) assert.ok(end.t - start.t < 1500, `re-trial lasted ${end.t - start.t} ms`);
  // The first failed re-trial is not remembered; only the confirmed result is.
  assert.equal(r.changes.filter((c) => c.confirmed).length, 1);
  assert.deepEqual(r.remembered, [STILL]);
});

test('a device that janks every time it loads never persists a downgrade', () => {
  // Five visits; each has jank at load and a second burst later (the map library arriving, say).
  for (let visit = 0; visit < 5; visit++) {
    const jank = (tier, t) => (t < 2000 || (t > 9000 && t < 9500) ? 150 : 33.3);
    const r = live(createGovernor({ start: 0 }), jank, 40_000);
    assert.deepEqual(r.remembered, [], `visit ${visit}`);
    assert.equal(r.tier, 0);
  }
});

test('re-trials are capped and a tier that fails two re-trials is final', () => {
  // Jank keeps coming back every 12 s: the governor re-tries at most maxRetrials times.
  const r = live(createGovernor({ start: 0 }), (tier, t) => (t > 5000 && t % 12_000 < 600 ? 200 : 33.3), 200_000);
  assert.ok(r.retrials <= SETTINGS.maxRetrials, `${r.retrials} re-trials`);
  assert.ok(r.changes.length <= 2 * SETTINGS.maxRetrials + 2, `${r.changes.length} changes`);
  // A tier closed after failing its re-trials is never entered again: one entry per re-trial, then no more.
  const gov = createGovernor({ start: 1 });
  const slow = live(gov, (tier) => (tier <= 1 ? 90 : 33.3), 120_000);
  const intoOne = slow.changes.filter((c) => c.tier === 1);
  assert.equal(intoOne.length, SETTINGS.confirmTrials, JSON.stringify(slow.changes));
  assert.ok(gov.ceiling >= 2);
});

test('a confirmed GPU-timed result is remembered, but not before the page has settled', () => {
  const gov = createGovernor({ start: 0 });
  const r = live(gov, (tier) => 20 * TIERS[tier].cost, 3000, { source: 'gpu' });
  assert.ok(r.changes.length >= 1 && r.changes[0].t < SETTINGS.persistAfterMs);
  assert.deepEqual(r.remembered, [], 'too early');
  assert.equal(gov.memory(SETTINGS.persistAfterMs + 1), gov.tier);
});

test('a stall that spans one re-trial does not confirm a downgrade', () => {
  // A healthy device hit by six seconds of main-thread stall mid-session, with no long-task reports (Safari).
  const r = live(createGovernor({ start: 0 }), (tier, t) => (t > 20_000 && t < 26_000 ? 200 : 33.3), 90_000);
  assert.equal(r.tier, 0, JSON.stringify(r.changes));
  assert.deepEqual(r.remembered, []);
});
