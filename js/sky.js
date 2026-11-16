// Animated sky behind the weather header: a full-bleed WebGL fragment shader (see js/sky/shaders.js).
// Contract (js/weather.js calls these; keep the signatures):
//   initSky(canvas)  - called once at page start with the <canvas id="sky-canvas"> element.
//   setSky(state)    - called whenever the weather changes. state = {
//                        kind: 'day' | 'night' | 'cloud' | 'rain' | 'snow' | 'storm',
//                        day: boolean, code: WMO weather code, wind: km/h, gust: km/h,
//                        precip: mm in the wettest of the next 3 hours, temp: °C,
//                        now: ms, sunrise: ms, sunset: ms }
//
// The canvas stays invisible (opacity 0, see styles/sky.css) until a frame has been drawn, and is hidden
// again if the GPU context is lost, so the flat CSS colour of .sky is always the fallback.
// Each weather kind is a set of numbers (colours and layer strengths). Changing kind blends from the
// numbers on screen to the new ones over FADE_S seconds, which is what crossfades the picture.
//
// The sky protects the visitor's device by itself (js/sky/governor.js decides, this file measures and
// applies): it times its own frames, steps down through cheaper quality tiers (lower resolution, a lighter
// shader, 15 fps, finally one still frame with the loop stopped) when frames are slow, and remembers the
// tier that suited this device for a week. It also holds a still frame when the visitor asked to save data
// or the battery is low and discharging, and keeps the older rules: one still frame under reduced motion,
// no loop while the tab is hidden or the sky is offscreen, the flat colour if WebGL fails or is lost.
// Debugging on a real phone: open the page with ?skydebug (see the end of this file).

import { VERTEX_SHADER, fragmentShader, DRIFT_WRAP, WRAP_CELLS, PHASE_S } from './sky/shaders.js';
import { TIERS, STILL, SETTINGS, createGovernor, startTier, batteryHold, holdReason,
  MEMORY_KEY, signature, rememberTier, recallTier } from './sky/governor.js';

const FADE_S = 1;
const MAX_SCALE = 1.5;               // device pixel ratio cap (each tier scales down from here)
const MAX_PIXELS = 1.2e6;            // render at a lower resolution than this many pixels if needed
const UNIT_CSS_PX = 500;             // one shader "scene unit", in CSS pixels
// The moon, and the sun at its highest, sit this far below the top of the sky (CSS px): below the search
// bar and beside the hero text, where they compete least with reading.
const GLOW_TOP_PX = 230;
const STATIC_TIME_S = 40;            // the moment shown when motion is reduced
const NEAR_DRIFT = 1.8;              // the near cloud layer drifts this much faster than the far one
// Precipitation layers (scale: cells per scene unit; speed: scene units per second). Must match the order
// of the layers in the shader. Rain cells are 5 times taller than wide.
const RAIN_LAYERS = [{ scale: 70 * 0.2, speed: 2.6 }, { scale: 44 * 0.2, speed: 3.4 }];
const SNOW_LAYERS = [{ scale: 20, speed: 0.05 }, { scale: 11, speed: 0.08 }, { scale: 6, speed: 0.12 }];
const STABLE_SAMPLES = 300;          // about 10 s on one tier counts as settled (worth remembering)

// The look of each kind. Colours are sRGB hex near the --sky-* token for that kind, a little deeper
// so brighter details have room below the shader's legibility ceiling.
// cover: cloud amount; sun/moon/stars/rain/snow: layer strengths; storm: 1 allows lightning.
const KINDS = {
  day:   { top: '#1240a6', horizon: '#1a54c2', lit: '#a3c9f5', shade: '#86b0ec', cover: 0.2, sun: 1, moon: 0, stars: 0, rain: 0, snow: 0, storm: 0 },
  night: { top: '#090d26', horizon: '#18204a', lit: '#2c365f', shade: '#202a52', cover: 0.12, sun: 0, moon: 1, stars: 1, rain: 0, snow: 0, storm: 0 },
  cloud: { top: '#3f4d62', horizon: '#4f5f76', lit: '#76869c', shade: '#3c495d', cover: 0.75, sun: 0.35, moon: 0, stars: 0, rain: 0, snow: 0, storm: 0 },
  rain:  { top: '#232c43', horizon: '#33405b', lit: '#4c5a76', shade: '#1f273b', cover: 0.85, sun: 0.15, moon: 0, stars: 0, rain: 1, snow: 0, storm: 0 },
  snow:  { top: '#33465f', horizon: '#435a7a', lit: '#64799a', shade: '#3a4d6a', cover: 0.65, sun: 0.3, moon: 0, stars: 0, rain: 0, snow: 1, storm: 0 },
  storm: { top: '#171a2a', horizon: '#282d44', lit: '#3d4565', shade: '#121522', cover: 0.95, sun: 0, moon: 0, stars: 0, rain: 1, snow: 0, storm: 1 },
};
const NIGHT_DIM = 0.8;               // cloudy, wet or stormy kinds are a little darker at night

// Layout of one set of scene numbers in a flat Float32Array (so blending allocates nothing).
const P = { TOP: 0, HORIZON: 3, LIT: 6, SHADE: 9, COVER: 12, SUN: 13, SUN_X: 14, SUN_Y: 15, SUN_WARM: 16,
  MOON: 17, STARS: 18, RAIN: 19, SNOW: 20, STORM: 21, LEAN: 22, GUST_LEAN: 23, DRIFT_SPEED: 24 };
const PARAMS = 25;

const UNIFORMS = ['uRes', 'uUnit', 'uPhase', 'uDrift', 'uTop', 'uHorizon', 'uCloudLit', 'uCloudShade',
  'uCover', 'uSun', 'uMoon', 'uStars', 'uRain', 'uSnow', 'uFlash', 'uLean', 'uRainOff', 'uSnowOff'];

const from = new Float32Array(PARAMS);
const target = new Float32Array(PARAMS);
const shown = new Float32Array(PARAMS);
let fade = 1;

let canvas = null, gl = null, buffer = null;
let variants = [null, null];         // compiled programs: [full, lite]; false = failed to compile
let prog = null;                     // the variant in use: { program, loc }
let reduceQuery = null, reduce = false, onScreen = true;
let raf = 0, lastMs = 0, flashStart = -1e9, nextFlash = 0;
// Animation clock and moving offsets. Kept in double precision here and wrapped where the shader's pattern
// repeats exactly, except cloud drift, which wraps only after a day or more of on-screen animation (see the
// note on time in js/sky/shaders.js). The old 20-minute jump is gone.
let time = STATIC_TIME_S, drift = 0;
const snowX = new Float64Array(SNOW_LAYERS.length);
const snowOff = new Float32Array(2 * SNOW_LAYERS.length);
let cssW = 0, cssH = 0, pxScale = 1, sizeDirty = true;

// Governor state.
let gov = null, tier = 0, frameMs = 1000 / 30;
const holds = { saveData: false, battery: false };
let memorySig = '', samplesOnTier = 0, remembered = false, pinned = false;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const wrap = (x, period) => x - period * Math.floor(x / period);

function writeColour(out, at, hex, scale) {
  for (let i = 0; i < 3; i++) out[at + i] = toLinear(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255) * scale;
}

// Fill `out` with the scene numbers for a weather state.
function describe(out, state) {
  const look = KINDS[state.kind] || KINDS.day;
  const dim = state.kind !== 'day' && state.kind !== 'night' && !state.day ? NIGHT_DIM : 1;
  writeColour(out, P.TOP, look.top, dim);
  writeColour(out, P.HORIZON, look.horizon, dim);
  writeColour(out, P.LIT, look.lit, dim);
  writeColour(out, P.SHADE, look.shade, dim);
  out[P.COVER] = look.cover;

  // The sun travels along a low arc in the upper right as the day goes from sunrise to sunset:
  // SUN_X is a fraction of the width, SUN_Y CSS pixels below GLOW_TOP_PX (0 at noon).
  const span = state.sunset - state.sunrise;
  const t = span > 0 ? clamp01((state.now - state.sunrise) / span) : 0.5;
  const height = Math.sin(Math.PI * t);
  out[P.SUN] = state.day ? look.sun : 0;
  out[P.SUN_X] = 0.64 + 0.3 * t;
  out[P.SUN_Y] = 90 * (1 - height);
  out[P.SUN_WARM] = 1 - height;

  const precip = Math.max(0, state.precip || 0);
  out[P.MOON] = look.moon;
  out[P.STARS] = look.stars;
  out[P.RAIN] = look.rain * (0.3 + 0.7 * clamp01(precip / 5));
  out[P.SNOW] = look.snow * (0.45 + 0.55 * clamp01(precip / 3));
  out[P.STORM] = look.storm;

  // Wind: rain and snow lean further, and clouds drift faster, but only gently.
  const wind = Math.max(0, state.wind || 0), gust = Math.max(wind, state.gust || 0);
  out[P.LEAN] = 0.5 * clamp01(wind / 70);
  out[P.GUST_LEAN] = 0.5 * clamp01(gust / 70) - out[P.LEAN];
  out[P.DRIFT_SPEED] = 0.012 + 0.03 * clamp01(wind / 60);
}

// Rain and snow lean with the wind; gusts sway the lean a little, slowly.
const leanNow = () => shown[P.LEAN] + shown[P.GUST_LEAN] * (0.5 + 0.5 * Math.sin(time * 0.6));

// --- GL setup ------------------------------------------------------------------------------------------

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.warn('Sky shader did not compile; showing the flat sky colour.', gl.getShaderInfoLog(shader));
  }
  return shader;
}

function buildProgram(lite) {
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentShader(lite));
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return false; }
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  return { program, loc };
}

// Switch to the full or lite shader, compiling it the first time it is needed. If the lite one will not
// build, the full one carries on.
function useVariant(lite) {
  const i = lite ? 1 : 0;
  if (variants[i] === null) variants[i] = buildProgram(lite);
  const next = variants[i] || variants[0] || null;
  if (next && next !== prog) { prog = next; gl.useProgram(prog.program); sizeDirty = true; }
  return !!prog;
}

// Builds the full-screen triangle and the shader for the current tier. Returns false (leaving the canvas
// hidden) on failure.
function setupGL() {
  variants = [null, null];
  prog = null;
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  if (!useVariant(false) || !useVariant(TIERS[tier].lite)) return false;
  setupTimer();
  sizeDirty = true;
  return true;
}

function resize() {
  sizeDirty = false;
  let scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
  if (cssW * cssH * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (cssW * cssH));
  scale *= TIERS[tier].res;
  const w = Math.max(1, Math.round(cssW * scale)), h = Math.max(1, Math.round(cssH * scale));
  pxScale = w / Math.max(1, cssW);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform2f(prog.loc.uRes, w, h);
  gl.uniform1f(prog.loc.uUnit, UNIT_CSS_PX * pxScale);
}

// --- Timing ----------------------------------------------------------------------------------------------
// Which clock feeds the governor, best first:
//  1. GPU timer queries (EXT_disjoint_timer_query_webgl2, or EXT_disjoint_timer_query on WebGL1). They time
//     the sky's own draw on the GPU, so they show headroom as well as overload and are not fooled by other
//     work on the page. Results arrive a frame or more later, and a "disjoint" event (GPU clock change,
//     context switch) makes in-flight results meaningless, so those are thrown away. Several browsers hide
//     this extension (Safari, Firefox by default, many phones), so it is a bonus, not a need.
//  2. Otherwise, the interval between drawn frames from requestAnimationFrame timestamps. This only shows
//     overload once the browser actually delivers frames late (the governor uses that late interval as a
//     lower bound on the frame's cost), and cannot see headroom, so the governor treats it cautiously.
//     WebGL2 fences looked like a middle option, but Chrome only reports them done at frame boundaries plus a
//     deliberate delay (a trivial clear reads ~66 ms when polled per frame, ~290 ms from timers), so they
//     would make every device look slow.
// We deliberately never time draws with gl.finish() or readPixels(): both stall the main thread until the
// GPU is idle, which is exactly the jank this is meant to prevent.
const timer = { ext: null, gl2: false, on: false, pending: [], issued: 0, results: 0, name: 'none' };

function setupTimer() {
  timer.pending = []; timer.issued = 0; timer.results = 0; timer.on = false; timer.ext = null; timer.name = 'none';
  timer.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  try {
    const name = timer.gl2 ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query';
    timer.ext = gl.getExtension(name);
    if (timer.ext) { timer.on = true; timer.name = name; }
  } catch { timer.on = false; }
}

function timerBegin() {
  if (!timer.on || timer.pending.length >= 3) return null;
  const E = timer.ext;
  const q = timer.gl2 ? gl.createQuery() : E.createQueryEXT();
  if (!q) return null;
  if (timer.gl2) gl.beginQuery(E.TIME_ELAPSED_EXT, q); else E.beginQueryEXT(E.TIME_ELAPSED_EXT, q);
  return q;
}

function timerEnd(q) {
  const E = timer.ext;
  if (timer.gl2) gl.endQuery(E.TIME_ELAPSED_EXT); else E.endQueryEXT(E.TIME_ELAPSED_EXT);
  timer.pending.push(q);
  timer.issued++;
}

// GPU milliseconds of finished draws, oldest first. Gives up on the extension if it never answers.
function timerPoll(out) {
  const E = timer.ext;
  const disjoint = gl.getParameter(E.GPU_DISJOINT_EXT);
  while (timer.pending.length) {
    const q = timer.pending[0];
    const ready = timer.gl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) : E.getQueryObjectEXT(q, E.QUERY_RESULT_AVAILABLE_EXT);
    if (!ready && !disjoint) break;
    timer.pending.shift();
    if (ready && !disjoint) {
      const ns = timer.gl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT) : E.getQueryObjectEXT(q, E.QUERY_RESULT_EXT);
      if (ns > 0) { out.push(ns / 1e6); timer.results++; }
    }
    if (timer.gl2) gl.deleteQuery(q); else E.deleteQueryEXT(q);
  }
  if (timer.issued >= 60 && timer.results < 5) {   // never (or hardly ever) answers: use frame intervals
    for (const q of timer.pending) { if (timer.gl2) gl.deleteQuery(q); else E.deleteQueryEXT(q); }
    timer.pending = [];
    timer.on = false;
    timer.name = 'none';
    gov.reset(performance.now());
  }
}

// --- Governing ---------------------------------------------------------------------------------------------

const motionAllowed = () => !reduce && TIERS[tier].fps > 0;

function remember() {
  try { localStorage.setItem(MEMORY_KEY, rememberTier(gov.tier, Date.now(), memorySig)); } catch { /* private mode, quota */ }
}

// Apply what the governor and the holds ask for now.
function applyTier(reason) {
  const hold = holdReason(holds);
  const want = hold ? STILL : gov.tier;
  debugNote(want, hold ? `hold: ${hold}` : reason);
  if (want === tier) return;
  tier = want;
  frameMs = TIERS[tier].fps ? 1000 / TIERS[tier].fps : frameMs;
  sizeDirty = true;
  samplesOnTier = 0;
  if (gl && !gl.isContextLost() && prog) useVariant(TIERS[tier].lite);
  gov.reset(performance.now());
  updateLoop();
  if (!raf) drawStill();
}

const gpuMs = [];
function measure(ms, interval) {
  gpuMs.length = 0;
  if (timer.on) timerPoll(gpuMs);   // always collect, so finished queries are freed
  if (fade < 1) return;             // crossfades are noisy (both kinds' layers are drawn): do not judge them
  let decision = null;
  if (timer.on) {
    for (const g of gpuMs) decision = decision || gov.sample(g, ms, 'gpu');
  } else if (interval > 0) {
    decision = gov.sample(interval, ms, 'frame');
  }
  if (debug) debugSample();
  if (pinned) return;
  if (decision) {
    remember();
    remembered = true;
    applyTier(decision.reason);
  } else if (!remembered && ++samplesOnTier >= STABLE_SAMPLES) {
    remember();
    remembered = true;
  }
}

// --- Drawing ---------------------------------------------------------------------------------------------

function flashLevel(ms) {
  // One soft pulse: about 80 ms up, 600 ms down. Pulses are at least 5 s apart (so at most 2 per 10 s).
  if (reduce || shown[P.STORM] < 0.5) return 0;
  if (ms >= nextFlash) { flashStart = ms; nextFlash = ms + 5000 + Math.random() * 7000; }
  const age = ms - flashStart;
  if (age < 0 || age > 700) return 0;
  return (age < 80 ? age / 80 : Math.exp(-(age - 80) / 200)) * shown[P.STORM];
}

function draw(flash) {
  if (!prog || gl.isContextLost()) return;
  if (sizeDirty) resize();
  const s = shown, L = prog.loc;
  gl.uniform1f(L.uPhase, wrap(time, PHASE_S) / PHASE_S);
  gl.uniform2f(L.uDrift, wrap(drift, DRIFT_WRAP), wrap(drift * NEAR_DRIFT, DRIFT_WRAP));
  gl.uniform3f(L.uTop, s[P.TOP], s[P.TOP + 1], s[P.TOP + 2]);
  gl.uniform3f(L.uHorizon, s[P.HORIZON], s[P.HORIZON + 1], s[P.HORIZON + 2]);
  gl.uniform3f(L.uCloudLit, s[P.LIT], s[P.LIT + 1], s[P.LIT + 2]);
  gl.uniform3f(L.uCloudShade, s[P.SHADE], s[P.SHADE + 1], s[P.SHADE + 2]);
  gl.uniform1f(L.uCover, s[P.COVER]);
  // Sun and moon positions in device pixels, measured up from the bottom of the canvas as GL does.
  const h = canvas.height;
  gl.uniform4f(L.uSun, s[P.SUN_X] * canvas.width, h - (GLOW_TOP_PX + s[P.SUN_Y]) * pxScale, s[P.SUN], s[P.SUN_WARM]);
  gl.uniform3f(L.uMoon, canvas.width - Math.max(70, 0.16 * cssW) * pxScale, h - GLOW_TOP_PX * pxScale, s[P.MOON]);
  gl.uniform1f(L.uStars, s[P.STARS]);
  gl.uniform1f(L.uRain, s[P.RAIN]);
  gl.uniform1f(L.uSnow, s[P.SNOW]);
  gl.uniform1f(L.uFlash, flash);
  gl.uniform1f(L.uLean, leanNow());
  gl.uniform2f(L.uRainOff, wrap(time * RAIN_LAYERS[0].speed * RAIN_LAYERS[0].scale, WRAP_CELLS),
    wrap(time * RAIN_LAYERS[1].speed * RAIN_LAYERS[1].scale, WRAP_CELLS));
  for (let i = 0; i < SNOW_LAYERS.length; i++) {
    snowOff[2 * i] = snowX[i];
    snowOff[2 * i + 1] = wrap(time * SNOW_LAYERS[i].speed * SNOW_LAYERS[i].scale, WRAP_CELLS);
  }
  gl.uniform2fv(L.uSnowOff, snowOff);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  canvas.classList.add('is-live');
}

function blend(dt) {
  fade = Math.min(1, fade + dt / FADE_S);
  const e = fade * fade * (3 - 2 * fade);
  for (let i = 0; i < PARAMS; i++) shown[i] = from[i] + (target[i] - from[i]) * e;
}

function advance(dt) {
  time += dt;
  drift += dt * shown[P.DRIFT_SPEED];
  const lean = leanNow();
  for (let i = 0; i < SNOW_LAYERS.length; i++) {
    snowX[i] = wrap(snowX[i] + dt * SNOW_LAYERS[i].speed * SNOW_LAYERS[i].scale * lean, WRAP_CELLS);
  }
}

function frame(ms) {
  raf = requestAnimationFrame(frame);
  if (ms - lastMs < frameMs - 4) return;
  const interval = lastMs ? ms - lastMs : 0;
  const dt = Math.min(interval, 100) / 1000;   // no jump after a pause
  lastMs = ms;
  blend(dt);
  advance(dt);
  const query = timerBegin();
  draw(flashLevel(ms));
  if (query) timerEnd(query);
  measure(ms, interval);
}

// One still frame: used under reduced motion, at the still tier, and whenever the loop is not running.
// When there will be no animation to finish a crossfade, it shows the target state straight away.
function drawStill() {
  if (reduce) time = STATIC_TIME_S;
  if (!motionAllowed()) { fade = 1; shown.set(target); }
  draw(0);
}

// Run the loop only while it can be seen and motion is welcome.
function updateLoop() {
  const run = prog && !gl.isContextLost() && motionAllowed() && onScreen && document.visibilityState === 'visible';
  if (run && !raf) { lastMs = 0; gov.reset(performance.now()); raf = requestAnimationFrame(frame); }
  if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
}

// --- Device and person ---------------------------------------------------------------------------------

function watchBattery() {
  try {
    if (typeof navigator.getBattery !== 'function') return;
    navigator.getBattery().then((battery) => {
      const check = () => {
        const next = batteryHold(holds.battery, battery);
        if (next !== holds.battery) { holds.battery = next; applyTier(next ? 'battery low' : 'battery ok'); }
      };
      check();
      battery.addEventListener('chargingchange', check);
      battery.addEventListener('levelchange', check);
    }, () => {});
  } catch { /* not allowed here (permissions policy) or not supported */ }
}

function chooseStart() {
  let renderer = '';
  try { renderer = String(gl.getParameter(gl.RENDERER)); } catch { /* ignore */ }
  memorySig = signature([navigator.userAgent, renderer, String(Math.round((window.devicePixelRatio || 1) * 100))]);
  let stored = null;
  try {
    if (debugMode === 'reset') localStorage.removeItem(MEMORY_KEY);
    stored = recallTier(localStorage.getItem(MEMORY_KEY), Date.now(), memorySig);
  } catch { /* storage blocked */ }
  remembered = stored != null;
  let start = startTier({ remembered: stored, cores: navigator.hardwareConcurrency || 0, memory: navigator.deviceMemory || 0 });
  const pin = /^tier([0-9])$/.exec(debugMode);
  if (pin && +pin[1] <= STILL) { pinned = true; start = { tier: +pin[1], reason: 'pinned by ?skydebug' }; }
  holds.saveData = !!(navigator.connection && navigator.connection.saveData);
  // A pinned tier still measures (for __sky.frameMs) but never decides anything.
  gov = createGovernor({ start: start.tier, settings: pinned
    ? { ...SETTINGS, down: { gpu: Infinity, frame: Infinity }, severe: Infinity, maxUpgrades: 0 } : SETTINGS });
  const hold = holdReason(holds);
  tier = hold ? STILL : gov.tier;
  frameMs = 1000 / (TIERS[tier].fps || 30);
  debugNote(tier, hold ? `hold: ${hold}` : `start: ${start.reason}`);
}

// --- Debug hook ----------------------------------------------------------------------------------------
// Add ?skydebug to the page URL to get window.__sky (current tier, frame timing, the reason for the last
// change and a short history) and a console line on every tier change. ?skydebug=reset also forgets the
// remembered tier first; ?skydebug=tier0 ... tier5 pins a tier (measured, never changed or remembered), to
// compare how the tiers look and cost. Without the parameter none of this runs.
let debugMode = '';
try {
  const query = new URLSearchParams(location.search);
  if (query.has('skydebug')) debugMode = query.get('skydebug') || 'on';
} catch { /* no location (tests) */ }
const debug = !!debugMode;

function debugNote(to, reason) {
  if (!debug) return;
  const d = window.__sky || (window.__sky = { history: [] });
  const changed = d.tier !== to;
  Object.assign(d, { tier: to, tierName: TIERS[to].name, reason, fps: TIERS[to].fps, res: TIERS[to].res,
    lite: TIERS[to].lite, governed: gov ? gov.tier : null, hold: holdReason(holds) || null });
  if (changed) {
    const at = Math.round(performance.now());
    d.history.push({ at, tier: to, name: TIERS[to].name, reason });
    console.info(`[sky] ${at} ms: tier ${to} (${TIERS[to].name}) - ${reason}`);
  }
}

function debugSample() {
  const d = window.__sky;
  if (!d) return;
  d.frameMs = +gov.medianMs.toFixed(2);
  d.load = +gov.lastLoad.toFixed(2);
  d.source = timer.on ? `gpu (${timer.name})` : 'frame interval';
  d.upgrades = gov.upgrades;
  d.ceiling = gov.ceiling;
  d.canvas = canvas ? `${canvas.width}x${canvas.height}` : '';
  d.samples = (d.samples || 0) + 1;
}

// --- Public API --------------------------------------------------------------------------------------------

export function initSky(el) {
  if (canvas || !el) return;
  canvas = el;
  const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
  gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (!gl) { debugNote(STILL, 'no WebGL: flat colour'); return; }   // the canvas stays transparent over the flat colour

  // Until the first forecast arrives, show a clear day with the sun a little past noon.
  const hour = 3600e3, now = Date.now();
  describe(target, { kind: 'day', day: true, wind: 10, now, sunrise: now - 7 * hour, sunset: now + 5 * hour });
  shown.set(target);
  from.set(target);
  chooseStart();
  if (!setupGL()) { debugNote(STILL, 'shader failed: flat colour'); return; }

  reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  reduce = reduceQuery.matches;
  reduceQuery.addEventListener('change', () => { reduce = reduceQuery.matches; updateLoop(); drawStill(); });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();   // asks the browser to offer the context back later
    canvas.classList.remove('is-live');
    updateLoop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (setupGL()) { drawStill(); updateLoop(); }
  });

  new ResizeObserver(([entry]) => {
    cssW = entry.contentRect.width;
    cssH = entry.contentRect.height;
    sizeDirty = true;
    gov.reset(performance.now());
    if (!raf) drawStill();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; updateLoop(); }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);
  watchBattery();

  const rect = canvas.getBoundingClientRect();
  cssW = rect.width;
  cssH = rect.height;
  drawStill();
  updateLoop();
}

export function setSky(state) {
  if (!prog || !state) return;
  from.set(shown);
  describe(target, state);
  fade = 0;
  gov.reset(performance.now());
  if (!raf) drawStill();
}
