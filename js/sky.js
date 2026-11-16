// Animated sky behind the weather header. Stub: the real WebGL implementation replaces this file.
// Contract (do not change the signatures; js/weather.js calls them):
//   initSky(canvas)  - called once at page start with the <canvas id="sky-canvas"> element.
//   setSky(state)    - called whenever the weather changes. state = {
//                        kind: 'day' | 'night' | 'cloud' | 'rain' | 'snow' | 'storm',
//                        day: boolean, code: WMO weather code, wind: km/h, gust: km/h,
//                        precip: mm in the wettest of the next 3 hours, temp: °C,
//                        now: ms, sunrise: ms, sunset: ms }
export function initSky() {}
export function setSky() {}
