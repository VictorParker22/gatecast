# Gatecast

Local weather with flight status. Three pages:

- **Weather** (`index.html`): asks for your location (or a city) and shows current conditions, the next 24 hours, 10 days, rain radar, air quality and the weather risk at nearby airports.
- **Flights** (`flights.html`): track a flight live by number, with weather at both ends, or look up any airport's current weather risk and the aircraft around it.
- **Connections** (`trip.html`): enter your airports, departure time and layover and get a plain-language verdict on whether weather threatens the connection.

## Run it

```bash
node server.js
```

Then open http://localhost:4173. Node 18 or newer, no dependencies, no build step.

The weather page and connection checker also work as plain static files. Flight tracking, "Right now" airport observations and FAA delay programmes need the `/api` routes (`server.js` locally, the `api/` functions on Vercel), because those sources do not allow direct browser calls.

## Tests

```bash
node --test tests/*.mjs tests/*.cjs
```

## How it is put together

| Path | What it does |
|---|---|
| `index.html`, `js/weather.js` | Weather home: location, current conditions, hourly, 10 days, radar, nearby airports |
| `flights.html`, `js/flights.js` | Flight tracking and airport view |
| `trip.html`, `js/trip.js` | Connection checker |
| `js/shell.js` | Shared storage, unit and theme preferences, settings popover |
| `js/core.js` | Time zones, flight-time estimates, risk scoring, trip verdict (pure, unit-tested) |
| `js/data.js` | Airport and city search, forecasts, alerts, flight and live-data clients |
| `js/view.js` | Icons, units, route map, hourly strip |
| `styles/tokens.css`, `styles/app.css` | Design tokens and components |
| `lib/live.js` | Server-side lookups: airport observations, FAA status, flight route and position, nearby aircraft |
| `api/*.js` | Vercel functions wrapping `lib/live.js` |
| `server.js` | Local static server exposing the same `/api` routes |
| `scripts/build-data.cjs` | Build step: airport list with size ranking, map outline, assembles `public/` |
| `vendor/leaflet/` | Leaflet 1.9.4 (BSD-2-Clause), used only for the radar map |
| `data/airports.json` | 7,769 airports with IATA codes, time zones and a size rank |
| `docs/` | Design system, user research plan, research report |

## Data sources and limits

- **Forecast:** Open-Meteo, called from the visitor's browser, up to 16 days ahead. The free tier is for non-commercial use and is limited per network address; a commercial launch needs their paid plan. Attribution (CC BY 4.0) is in the page.
- **US alerts:** api.weather.gov, from the browser.
- **Airport observations:** NOAA Aviation Weather Center METAR, through `server.js`.
- **US airport delay programmes:** FAA NAS Status, through `server.js`.
- **Flight tracking:** route (origin and destination) from adsbdb and live position from adsb.lol, both keyless, through `/api/flight`. There is no free source of scheduled times, gates, delays or cancellations, so those are not shown, and the landing time is an estimate from distance and speed.
- **City search and air quality:** Open-Meteo geocoding and air-quality services, from the browser.
- **Radar:** RainViewer past-radar tiles (free for personal and small-scale use) over OpenStreetMap tiles, loaded only when the radar panel scrolls into view.
- **Location:** the browser's geolocation, requested only after the visitor presses "Use my location". Coordinates are rounded to about a kilometre, kept in the browser, and sent only to the forecast service. The place name comes from the nearest airport in the bundled list, not from a lookup service.

## The risk level

Each forecast hour is scored for thunderstorms, freezing rain, snowfall rate, fog and visibility, gusts and rain rate (`scoreHour` in `js/core.js`). The worst hour during the visitor's time at an airport sets its level: below 30 is Low, 30 to 59 Elevated, 60 and above High. For a connection, weather where the inbound flight departs counts at half weight, and the layover length adds or removes points. The thresholds are judgement calls, not calibrated against delay records; `docs/user-research.md` lists the back-test that should tune them.
