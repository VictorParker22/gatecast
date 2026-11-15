# Gatecast

A weather site built around flight connections. Enter your airports, departure time and layover; Gatecast lines up the forecast at every airport with the hour you are there and gives a plain-language verdict on the trip and the connection.

## Run it

```bash
node server.js
```

Then open http://localhost:4173. Node 18 or newer, no dependencies, no build step.

The site also works as plain static files (any static host): the trip checker, forecasts, map and US weather alerts all run in the browser. `server.js` adds the "Right now" airport observations and FAA delay programmes, which come from sources that do not allow direct browser calls.

## Tests

```bash
node --test tests/*.mjs tests/*.cjs
```

## How it is put together

| Path | What it does |
|---|---|
| `index.html` | Page shell, form, legend and method note |
| `styles/tokens.css` | Design tokens (colour, type, spacing, motion), light and dark |
| `styles/app.css` | Components, using tokens only |
| `js/core.js` | Time zones, flight-time estimates, risk scoring, trip verdict (pure, unit-tested) |
| `js/data.js` | Airport search, forecast and alert requests, live proxy client |
| `js/view.js` | Icons, units, route map, hourly strip |
| `js/app.js` | Form, airport picker, results, settings, shareable links |
| `js/world.js` | Land outline for the map (Natural Earth, public domain) |
| `data/airports.json` | 7,769 airports with IATA codes and time zones (from mwgg/Airports, MIT) |
| `server.js` | Static server plus `/api/metar` and `/api/faa` proxies with short caches |
| `docs/` | Design system and user research plan |

## Data sources and limits

- **Forecast:** Open-Meteo, called from the visitor's browser, up to 16 days ahead. The free tier is for non-commercial use and is limited per network address; a commercial launch needs their paid plan. Attribution (CC BY 4.0) is in the page.
- **US alerts:** api.weather.gov, from the browser.
- **Airport observations:** NOAA Aviation Weather Center METAR, through `server.js`.
- **US airport delay programmes:** FAA NAS Status, through `server.js`.
- **Flights:** there is no free, keyless source of flight schedules or status, so the itinerary is entered by hand and flight times are estimated from distance unless the visitor types the scheduled duration.

## The risk level

Each forecast hour is scored for thunderstorms, freezing rain, snowfall rate, fog and visibility, gusts and rain rate (`scoreHour` in `js/core.js`). The worst hour during the visitor's time at an airport sets its level: below 30 is Low, 30 to 59 Elevated, 60 and above High. For a connection, weather where the inbound flight departs counts at half weight, and the layover length adds or removes points. The thresholds are judgement calls, not calibrated against delay records; `docs/user-research.md` lists the back-test that should tune them.
