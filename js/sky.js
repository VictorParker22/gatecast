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

import { VERTEX_SHADER, FRAGMENT_SHADER } from './sky/shaders.js';

const FADE_S = 1;
const FRAME_MS = 1000 / 30;          // the loop is throttled to about 30 frames a second
const MAX_SCALE = 1.5;               // device pixel ratio cap
const MAX_PIXELS = 1.2e6;            // render at a lower resolution than this many pixels if needed
const UNIT_CSS_PX = 500;             // one shader "scene unit", in CSS pixels
// The moon, and the sun at its highest, sit this far below the top of the sky (CSS px): below the search
// bar and beside the hero text, where they compete least with reading.
const GLOW_TOP_PX = 230;
const TIME_WRAP_S = 1200;            // keeps shader time small enough for full float precision
const DRIFT_WRAP = 1000;
const STATIC_TIME_S = 40;            // the moment shown when motion is reduced

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

const UNIFORMS = ['uRes', 'uUnit', 'uTime', 'uDrift', 'uTop', 'uHorizon', 'uCloudLit', 'uCloudShade',
  'uCover', 'uSun', 'uMoon', 'uStars', 'uRain', 'uSnow', 'uFlash', 'uWind'];

const from = new Float32Array(PARAMS);
const target = new Float32Array(PARAMS);
const shown = new Float32Array(PARAMS);
let fade = 1;

let canvas = null, gl = null, program = null, buffer = null, loc = {};
let reduceQuery = null, reduce = false, onScreen = true;
let raf = 0, lastMs = 0, time = 0, drift = 0;
let flashStart = -1e9, nextFlash = 0;
let cssW = 0, cssH = 0, pxScale = 1, sizeDirty = true;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

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

// Builds the program and the one full-screen triangle. Returns false (leaving the canvas hidden) on failure.
function setupGL() {
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); program = null; return false; }

  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  sizeDirty = true;
  return true;
}

function resize() {
  sizeDirty = false;
  let scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
  if (cssW * cssH * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (cssW * cssH));
  const w = Math.max(1, Math.round(cssW * scale)), h = Math.max(1, Math.round(cssH * scale));
  pxScale = w / Math.max(1, cssW);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform2f(loc.uRes, w, h);
  gl.uniform1f(loc.uUnit, UNIT_CSS_PX * pxScale);
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
  if (!program || gl.isContextLost()) return;
  if (sizeDirty) resize();
  const s = shown;
  gl.uniform1f(loc.uTime, time);
  gl.uniform1f(loc.uDrift, drift);
  gl.uniform3f(loc.uTop, s[P.TOP], s[P.TOP + 1], s[P.TOP + 2]);
  gl.uniform3f(loc.uHorizon, s[P.HORIZON], s[P.HORIZON + 1], s[P.HORIZON + 2]);
  gl.uniform3f(loc.uCloudLit, s[P.LIT], s[P.LIT + 1], s[P.LIT + 2]);
  gl.uniform3f(loc.uCloudShade, s[P.SHADE], s[P.SHADE + 1], s[P.SHADE + 2]);
  gl.uniform1f(loc.uCover, s[P.COVER]);
  // Sun and moon positions in device pixels, measured up from the bottom of the canvas as GL does.
  const h = canvas.height;
  gl.uniform4f(loc.uSun, s[P.SUN_X] * canvas.width, h - (GLOW_TOP_PX + s[P.SUN_Y]) * pxScale, s[P.SUN], s[P.SUN_WARM]);
  gl.uniform3f(loc.uMoon, canvas.width - Math.max(70, 0.16 * cssW) * pxScale, h - GLOW_TOP_PX * pxScale, s[P.MOON]);
  gl.uniform1f(loc.uStars, s[P.STARS]);
  gl.uniform1f(loc.uRain, s[P.RAIN]);
  gl.uniform1f(loc.uSnow, s[P.SNOW]);
  gl.uniform1f(loc.uFlash, flash);
  gl.uniform2f(loc.uWind, s[P.LEAN], s[P.GUST_LEAN]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  canvas.classList.add('is-live');
}

function blend(dt) {
  fade = Math.min(1, fade + dt / FADE_S);
  const e = fade * fade * (3 - 2 * fade);
  for (let i = 0; i < PARAMS; i++) shown[i] = from[i] + (target[i] - from[i]) * e;
}

function frame(ms) {
  raf = requestAnimationFrame(frame);
  if (ms - lastMs < FRAME_MS - 4) return;
  const dt = lastMs ? Math.min(ms - lastMs, 100) / 1000 : 0;   // no jump after a pause
  lastMs = ms;
  blend(dt);
  time = (time + dt) % TIME_WRAP_S;
  drift = (drift + dt * shown[P.DRIFT_SPEED]) % DRIFT_WRAP;
  draw(flashLevel(ms));
}

// One still frame of the target state: used under reduced motion and whenever the loop is not running.
function drawStill() {
  if (reduce) { fade = 1; shown.set(target); time = STATIC_TIME_S; }
  draw(0);
}

// Run the loop only while it can be seen and motion is welcome.
function updateLoop() {
  const run = program && !gl.isContextLost() && !reduce && onScreen && document.visibilityState === 'visible';
  if (run && !raf) { lastMs = 0; raf = requestAnimationFrame(frame); }
  if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
}

// --- Public API --------------------------------------------------------------------------------------------

export function initSky(el) {
  if (canvas || !el) return;
  canvas = el;
  const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
  gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (!gl) return;   // no WebGL: the canvas stays transparent over the flat colour

  // Until the first forecast arrives, show a clear day with the sun a little past noon.
  const hour = 3600e3, now = Date.now();
  describe(target, { kind: 'day', day: true, wind: 10, now, sunrise: now - 7 * hour, sunset: now + 5 * hour });
  shown.set(target);
  from.set(target);
  if (!setupGL()) return;

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
    if (!raf) drawStill();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; updateLoop(); }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);

  const rect = canvas.getBoundingClientRect();
  cssW = rect.width;
  cssH = rect.height;
  drawStill();
  updateLoop();
}

export function setSky(state) {
  if (!program || !state) return;
  from.set(shown);
  describe(target, state);
  fade = 0;
  if (!raf) drawStill();
}
