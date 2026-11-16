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

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;        // canvas size in device pixels
uniform float uUnit;      // device pixels per scene unit; one unit is 500 CSS pixels on every screen
uniform float uTime;      // seconds of animation (wraps every 20 minutes)
uniform float uDrift;     // how far the clouds have drifted; grows faster when it is windy
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
uniform vec2 uWind;       // x: how far rain and snow lean, y: extra lean during gusts

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

// Value noise: random values on a grid, smoothly blended between grid points.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Fractal noise ("fbm"): four layers of noise, each twice as detailed and half as strong as the last,
// slightly rotated each time. This gives the billowy, self-similar look of cloud.
const mat2 OCTAVE = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = OCTAVE * p;
    a *= 0.5;
  }
  return v;
}

// --- Precipitation layers ----------------------------------------------------------------------------

// One depth of rain. Space is cut into narrow, tall cells; some cells hold a streak whose bright head
// leads and whose tail fades upward. Shearing x by y makes the streaks lean with the wind.
float rainLayer(vec2 p, float scale, float speed, float seed, float lean) {
  p.x += p.y * lean;
  p.y += uTime * speed;
  vec2 q = p * vec2(scale, scale * 0.2);
  float column = floor(q.x);
  q.y += hash(vec2(column, seed)) * 7.0;          // stagger the columns so drops do not line up
  vec2 cell = vec2(column, floor(q.y));
  if (hash(cell + seed) > uRain) return 0.0;       // denser rain fills more cells
  float x = fract(q.x) - 0.5 - (hash(cell + seed + 4.7) - 0.5) * 0.6;
  float pixel = scale / uUnit;                     // one device pixel, measured in cell widths
  float line = 1.0 - smoothstep(0.4 * pixel, 1.3 * pixel, abs(x));
  float tail = smoothstep(0.7, 0.0, fract(q.y));   // bright head at the bottom of the cell, fading up
  return line * tail;
}

// One depth of snow: at most one soft flake per square cell, swaying from side to side as it falls.
float snowLayer(vec2 p, float scale, float speed, float radius, float seed, float lean) {
  p.y += uTime * speed;
  p.x += uTime * speed * lean;
  vec2 q = p * scale;
  vec2 cell = floor(q);
  float r = hash(cell + seed);
  if (r > uSnow) return 0.0;
  vec2 centre = vec2(hash(cell + seed + 3.1), hash(cell + seed + 7.7)) * 0.4 - 0.2;
  centre.x += 0.15 * sin(uTime * (0.5 + r) + r * 6.283);
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
    float disc = smoothstep(0.04, 0.035, d) * (0.8 + 0.2 * noise(m * 90.0));
    col += uMoon.z * (vec3(0.5, 0.55, 0.68) * disc + vec3(0.03, 0.04, 0.08) * exp(-d * 7.0));
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
      float twinkle = 0.65 + 0.35 * sin(uTime * (0.8 + r * 30.0) + r * 400.0);
      float bright = pow(hash(cell + 5.1), 2.0) * 0.35 + 0.05;
      col += uStars * bright * twinkle * smoothstep(1.6, 0.4, distPx) * smoothstep(0.1, 0.6, uv.y);
    }
  }

  // 4. Clouds: a broad, slow far layer and a smaller, faster near layer. The cover value lowers the
  //    noise threshold, so more of the noise counts as cloud. Thicker parts take the shade colour.
  float cloud = 0.0;
  if (uCover > 0.001) {
    float lo = 0.7 - 0.5 * uCover;
    float far = fbm(p * vec2(1.1, 3.4) + vec2(uDrift, 0.0));
    float near = fbm(p * vec2(2.0, 4.8) + vec2(uDrift * 1.8 + 17.0, 5.0));
    float a1 = smoothstep(lo, lo + 0.3, far);
    float a2 = smoothstep(lo + 0.08, lo + 0.36, near);
    float alpha = mix(0.35, 0.95, uCover);
    col = mix(col, mix(uCloudLit, uCloudShade, smoothstep(0.35, 0.85, far)), a1 * alpha);
    col = mix(col, mix(uCloudLit, uCloudShade, smoothstep(0.3, 0.75, near)), a2 * alpha * 0.8);
    cloud = max(a1, a2);

    // 5. Lightning lights the clouds from within, more so higher up. Kept faint on purpose.
    col += uFlash * vec3(0.025, 0.028, 0.04) * (0.4 + cloud) * (0.4 + uv.y);
  }

  // 6. Precipitation. Gusts make the lean sway a little, slowly.
  float lean = uWind.x + uWind.y * (0.5 + 0.5 * sin(uTime * 0.6));
  if (uRain > 0.001) {
    float streaks = rainLayer(p, 70.0, 2.6, 0.0, lean) * 0.5
                  + rainLayer(p, 44.0, 3.4, 11.0, lean) * 0.8;
    col += vec3(0.07, 0.08, 0.1) * streaks;
  }
  if (uSnow > 0.001) {
    float flakes = snowLayer(p, 20.0, 0.05, 2.0, 0.0, lean) * 0.45
                 + snowLayer(p, 11.0, 0.08, 3.2, 21.0, lean) * 0.7
                 + snowLayer(p, 6.0, 0.12, 5.0, 42.0, lean);
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
