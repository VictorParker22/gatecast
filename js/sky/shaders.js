// GLSL for the animated sky. Written in GLSL ES 1.00 so the same source runs on WebGL2 and WebGL1.
//
// How the picture is built: the vertex shader draws one triangle that covers the whole canvas, and the
// fragment shader then works out the colour of every pixel on its own, in layers, back to front:
//   1. atmosphere  - a vertical gradient from a deeper colour at the top to a lighter one near the bottom
//   2. sun / moon  - soft glows (and a small moon disc) in the upper right, away from the text
//   3. stars       - tiny points scattered on a grid, each twinkling slowly
//   4. clouds      - two layers of "fractal noise" (fbm) drifting sideways at different speeds
//   5. lightning   - a brief, gentle brightening of the clouds (storm only)
//   6. rain / snow - streaks or soft flakes laid out on scrolling grids at different depths
//   7. legibility  - a ceiling on brightness so white text stays readable, then conversion to screen colour
// Every layer has a strength uniform. JavaScript blends those numbers between weather kinds, which is
// how one kind of sky crossfades into another; a layer whose strength is zero is skipped entirely.
// Colours are mixed in linear light (physically additive) and converted to sRGB only at the very end.
//
// Two variants are compiled from the same source (fragmentShader(lite)); js/sky/governor.js picks one per
// quality tier. LITE uses three noise octaves instead of four (with the missing octave's average added back
// so cloud cover is unchanged), the nearer rain layer only, the two larger snow layers, and steady stars.
// The legibility ceiling (7) is the same in both, so text contrast holds at every tier.
//
// Time without jumps: nothing here multiplies a growing clock any more. JavaScript integrates every moving
// offset in double precision and wraps each one at a period over which its layer repeats exactly:
//   - rain and snow cells are numbered modulo WRAP_CELLS, so their scroll offsets wrap at WRAP_CELLS;
//   - value noise tiles every TILE cells, and fbm's octave matrix is 0.4 x an integer matrix, so a drift of
//     125 x TILE (= 2000) maps every octave onto whole tiles: the clouds repeat exactly, and the drift wraps
//     there (each cloud layer has its own drift uniform for that reason);
//   - twinkle and sway frequencies are rounded to whole cycles per PHASE_S seconds, so they run on uPhase,
//     a 0..1 clock that wraps every PHASE_S seconds.
// So the picture never jumps, however long the page stays open, and every uniform stays small.

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Keep in step with js/sky.js, which wraps the offsets.
export const TILE = 16;            // value noise repeats every TILE cells
export const DRIFT_WRAP = 125 * TILE;
export const WRAP_CELLS = 256;     // rain and snow cells are numbered modulo this
export const PHASE_S = 600;        // uPhase wraps every PHASE_S seconds

const FRAGMENT_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;        // canvas size in device pixels
uniform float uUnit;      // device pixels per scene unit; one unit is 500 CSS pixels on every screen
uniform float uPhase;     // animation clock as a fraction of PHASE_S seconds (0..1, wraps without a jump)
uniform vec2 uDrift;      // how far the far (x) and near (y) clouds have drifted, each wrapped at DRIFT_WRAP
uniform vec3 uTop;        // atmosphere colour at the top of the canvas
uniform vec3 uHorizon;    // atmosphere colour at the bottom
uniform vec3 uCloudLit;   // colour of thin cloud
uniform vec3 uCloudShade; // colour of thick cloud
uniform float uCover;     // 0 clear, about 0.2 high wisps, 1 full overcast
uniform vec4 uSun;        // xy: position in device pixels (y up), z: strength, w: warmth (1 at sunrise/sunset)
uniform vec3 uMoon;       // xy: position in device pixels (y up), z: strength
uniform float uStars;     // star strength
uniform float uRain;      // rain density
uniform float uSnow;      // snow density
uniform float uFlash;     // lightning brightness right now (0 almost always)
uniform float uLean;      // how far rain and snow lean right now (wind plus slow gusts, worked out in JS)
uniform vec2 uRainOff;    // vertical scroll of the two rain layers, in cells, wrapped at WRAP_CELLS
uniform vec2 uSnowOff[3]; // scroll of the three snow layers, in cells, wrapped at WRAP_CELLS

const float TILE = ${TILE.toFixed(1)};
const float WRAP_CELLS = ${WRAP_CELLS.toFixed(1)};
const float PHASE_CYCLES = ${(PHASE_S / (2 * Math.PI)).toFixed(6)};  // PHASE_S / 2pi: rad/s -> cycles per PHASE_S
const float TAU = 6.2831853;

// A sine that runs at about "rate" radians per second but completes a whole number of cycles every
// PHASE_S seconds, so it is seamless when uPhase wraps.
float wave(float rate, float offset) {
  return sin(TAU * fract(uPhase * floor(rate * PHASE_CYCLES + 0.5)) + offset);
}

// Brightness ceiling, in relative luminance. White text (#e6eeff, the dimmer of the two text colours)
// keeps at least 4.5:1 contrast on anything at or below CEILING. Above KNEE, brightness is eased
// toward the ceiling rather than clipped, so bright features stay soft instead of flattening out.
const float KNEE = 0.105;
const float CEILING = 0.142;

// --- Noise helpers ---------------------------------------------------------------------------------

// A repeatable pseudo-random number in 0..1 for any 2D point (no trigonometry, so it is stable on phones).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise: random values on a grid, smoothly blended between grid points. The grid repeats every
// TILE cells (see the note on time at the top of this file).
float noise(vec2 p) {
  vec2 i = mod(floor(p), TILE);
  vec2 j = mod(i + 1.0, TILE);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(vec2(j.x, i.y)), u.x),
             mix(hash(vec2(i.x, j.y)), hash(j), u.x), u.y);
}

// Fractal noise ("fbm"): four layers of noise, each twice as detailed and half as strong as the last,
// slightly rotated each time. This gives the billowy, self-similar look of cloud. LITE stops after three
// and adds the fourth layer's average (0.5 x 0.0625) so the clouds cover the same amount of sky.
const mat2 OCTAVE = mat2(1.6, 1.2, -1.2, 1.6);
#ifdef LITE
const int OCTAVES = 3;
const float OCTAVE_REST = 0.03125;
#else
const int OCTAVES = 4;
const float OCTAVE_REST = 0.0;
#endif
float fbm(vec2 p) {
  float v = OCTAVE_REST;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * noise(p);
    p = OCTAVE * p;
    a *= 0.5;
  }
  return v;
}

// --- Precipitation layers ----------------------------------------------------------------------------

// One depth of rain. Space is cut into narrow, tall cells; some cells hold a streak whose bright head
// leads and whose tail fades upward. Shearing x by y makes the streaks lean with the wind.
// "scroll" is how far the layer has fallen, in cells (from uRainOff).
float rainLayer(vec2 p, float scale, float scroll, float seed, float lean) {
  p.x += p.y * lean;
  vec2 q = p * vec2(scale, scale * 0.2);
  q.y += scroll;
  float column = floor(q.x);
  q.y += hash(vec2(column, seed)) * 7.0;          // stagger the columns so drops do not line up
  vec2 cell = vec2(column, mod(floor(q.y), WRAP_CELLS));
  if (hash(cell + seed) > uRain) return 0.0;       // denser rain fills more cells
  float x = fract(q.x) - 0.5 - (hash(cell + seed + 4.7) - 0.5) * 0.6;
  float pixel = scale / uUnit;                     // one device pixel, measured in cell widths
  float line = 1.0 - smoothstep(0.4 * pixel, 1.3 * pixel, abs(x));
  float tail = smoothstep(0.7, 0.0, fract(q.y));   // bright head at the bottom of the cell, fading up
  return line * tail;
}

// One depth of snow: at most one soft flake per square cell, swaying from side to side as it falls.
// "offset" is how far the layer has moved (down, and sideways with the wind), in cells (from uSnowOff).
float snowLayer(vec2 p, float scale, vec2 offset, float radius, float seed) {
  vec2 q = p * scale + offset;
  vec2 cell = mod(floor(q), WRAP_CELLS);
  float r = hash(cell + seed);
  if (r > uSnow) return 0.0;
  vec2 centre = vec2(hash(cell + seed + 3.1), hash(cell + seed + 7.7)) * 0.4 - 0.2;
  centre.x += 0.15 * wave(0.5 + r, r * 6.283);
  float distPx = length(fract(q) - 0.5 - centre) / scale * uUnit;
  float size = radius * uUnit / 500.0;             // radius is given in CSS pixels
  return smoothstep(size, 0.0, distPx);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;   // 0..1 across the canvas, y pointing up
  vec2 p = gl_FragCoord.xy / uUnit;   // scene units, so features keep their size on every screen

  // 1. Atmosphere.
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 1.0, uv.y));

  // 2a. Sun: a wide, faint warm haze plus a tighter glow. Low suns are warmer and more orange.
  if (uSun.z > 0.001) {
    float d = length(gl_FragCoord.xy - uSun.xy) / uUnit;
    vec3 tint = mix(vec3(0.42, 0.74, 1.0), vec3(1.0, 0.62, 0.36), uSun.w);
    col += tint * uSun.z * (0.025 * exp(-d * 3.0) + 0.055 * exp(-d * d * 9.0));
  }

  // 2b. Moon: a pale, faintly mottled disc with a soft edge inside a wide, dim halo.
  if (uMoon.z > 0.001) {
    vec2 m = (gl_FragCoord.xy - uMoon.xy) / uUnit;
    float d = length(m);
    vec3 moon = vec3(0.03, 0.04, 0.08) * exp(-d * 7.0);
    if (d < 0.04) {   // the mottling noise is only needed on the disc itself
      moon += vec3(0.5, 0.55, 0.68) * smoothstep(0.04, 0.035, d) * (0.8 + 0.2 * noise(m * 90.0));
    }
    col += uMoon.z * moon;
  }

  // 3. Stars: one cell in fifteen holds a star; most are faint, a few brighter. They thin out
  //    toward the bottom of the sky and near the moon.
  if (uStars > 0.001) {
    vec2 q = p * 46.0;
    vec2 cell = floor(q);
    float r = hash(cell);
    if (r < 0.065) {
      vec2 at = vec2(hash(cell + 1.3), hash(cell + 2.9)) * 0.6 + 0.2;
      float distPx = length(fract(q) - at) / 46.0 * uUnit;
#ifdef LITE
      const float twinkle = 0.65;   // the average of the twinkle below
#else
      float twinkle = 0.65 + 0.35 * wave(0.8 + r * 30.0, r * 400.0);
#endif
      float bright = pow(hash(cell + 5.1), 2.0) * 0.35 + 0.05;
      col += uStars * bright * twinkle * smoothstep(1.6, 0.4, distPx) * smoothstep(0.1, 0.6, uv.y);
    }
  }

  // 4. Clouds: a broad, slow far layer and a smaller, faster near layer. The cover value lowers the
  //    noise threshold, so more of the noise counts as cloud. Thicker parts take the shade colour.
  float cloud = 0.0;
  if (uCover > 0.001) {
    float lo = 0.7 - 0.5 * uCover;
    float far = fbm(p * vec2(1.1, 3.4) + vec2(uDrift.x, 0.0));
    float near = fbm(p * vec2(2.0, 4.8) + vec2(uDrift.y + 17.0, 5.0));
    float a1 = smoothstep(lo, lo + 0.3, far);
    float a2 = smoothstep(lo + 0.08, lo + 0.36, near);
    float alpha = mix(0.35, 0.95, uCover);
    col = mix(col, mix(uCloudLit, uCloudShade, smoothstep(0.35, 0.85, far)), a1 * alpha);
    col = mix(col, mix(uCloudLit, uCloudShade, smoothstep(0.3, 0.75, near)), a2 * alpha * 0.8);
    cloud = max(a1, a2);

    // 5. Lightning lights the clouds from within, more so higher up. Kept faint on purpose.
    col += uFlash * vec3(0.025, 0.028, 0.04) * (0.4 + cloud) * (0.4 + uv.y);
  }

  // 6. Precipitation (layer speeds live in js/sky.js, which scrolls uRainOff and uSnowOff).
  if (uRain > 0.001) {
#ifdef LITE
    float streaks = rainLayer(p, 44.0, uRainOff.y, 11.0, uLean) * 0.8;
#else
    float streaks = rainLayer(p, 70.0, uRainOff.x, 0.0, uLean) * 0.5
                  + rainLayer(p, 44.0, uRainOff.y, 11.0, uLean) * 0.8;
#endif
    col += vec3(0.07, 0.08, 0.1) * streaks;
  }
  if (uSnow > 0.001) {
    float flakes = snowLayer(p, 11.0, uSnowOff[1], 3.2, 21.0) * 0.7
                 + snowLayer(p, 6.0, uSnowOff[2], 5.0, 42.0);
#ifndef LITE
    flakes += snowLayer(p, 20.0, uSnowOff[0], 2.0, 0.0) * 0.45;
#endif
    col = mix(col, vec3(0.6, 0.68, 0.86), flakes * 0.75);
  }

  // 7. Legibility ceiling, then linear light to sRGB, plus a tiny random dither that hides banding in
  //    the slow, dark gradients.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (lum > KNEE) {
    float eased = KNEE + (CEILING - KNEE) * (1.0 - exp(-(lum - KNEE) / (CEILING - KNEE)));
    col *= eased / lum;
  }
  vec3 srgb = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  srgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(srgb, 1.0);
}
`;

// The fragment shader source: the full look, or (lite = true) the cheaper variant.
export function fragmentShader(lite = false) {
  return (lite ? '#define LITE\n' : '') + FRAGMENT_SOURCE;
}
export const FRAGMENT_SHADER = fragmentShader(false);
