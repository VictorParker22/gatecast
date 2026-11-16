# Changelog

All notable changes to Gatecast are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Gatecast has no tagged releases yet. `package.json` has said `1.0.0` since the first commit, so that version marks the first commit; later work is grouped by the date it was merged until the next version number is chosen. Work-in-progress checkpoint commits are folded into the entry they led to.

## [Unreleased]

### Added

- GitHub Actions CI: tests and the build step on Node 18.x and 22.x for every push and pull request.
- Pull request template, bug report and feature request issue forms, and Dependabot updates for npm and GitHub Actions.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.editorconfig` and `.nvmrc`.
- `docs/redesign.md`: the design direction being explored for the next version of the site.
- `dev` and `ci` npm scripts, and description, repository, homepage and bugs fields in `package.json`.

### Changed

- Today (home) rebuilt: the trip verdict, the weather or a first-visit welcome leads over the animated sky; "what today means" cards, 10 days and radar below. The board, shelf, streaks, daily quiz, city comparison and season checklist were removed.
- Trips rebuilt: verdict first, then a journey strip with each airport's hours on the ground, then stop cards; the form folds away once a trip is shown.
- Flights rebuilt: the number you typed leads, a "Live" label, one progress line, and "Both ends look calm" when nothing is wrong.
- README reorganised with a table of contents, quick start, CI badge, screenshot, and contributing, security and licence sections.
- Redesign foundation ("a departure board for weather"): monochrome ink, concrete and paper tokens in both themes, with colour reserved for risk; Barlow Condensed replaces Space Grotesk for signage type (codes, times, big numbers, the verdict); new brand mark, favicon and wordmark; navigation renamed and reordered to Today, Trips, Flights; links and primary buttons are ink instead of cobalt.

## 2026-11-16: headline voice, animated sky and review queue

### Added

- WebGL animated sky behind the weather header for day, night, cloud, rain, snow and storm, with brightness capped for text contrast, a flat-colour fallback, a still frame under reduced motion, and pausing when off screen.
- Sky quality governor (`js/sky/governor.js`): steps down through six quality tiers to a still frame based on measured frame times, holds a still frame on data-saver or low battery, and remembers only confirmed results per device. `?skydebug` shows an on-screen readout.
- Motion layer (`js/motion.js`, `styles/motion.css`): lifted drag with boxes gliding aside, resize transitions, first-load arrival, options sheet entrance and exit, quiz and shelf reactions; all instant under reduced motion.
- 12-hour or 24-hour clock setting on every page, defaulting from the locale.
- "Both sides" review queue database (`supabase/migrations/`): topics, statements and reviewers, where visitors read published topics only, only a listed reviewer can publish, and a topic needs a statement from each side. The site does not read it yet.
- Content decision recorded in `docs/content-sources.md`: "Caught on camera" dropped from the home page, "Both sides" leads the content work, and the owner reviews before anything political is published.

### Changed

- Home headline rewritten in one consistent voice: what is happening and when it changes, then one action, with doubt in a word and everyday time words.
- Faster first load: the airport list and map outline are no longer loaded up front, modules are preloaded, and returning visitors' forecast request starts early.
- Design polish: the board introduction moved into the sky as a quiet line, a compact shelf pill, refined hour and 10-day rows, and bottom-sheet options on phones.
- Dropping a box on the shelf pins it without moving it; quiz focus moves to the result after answering.

### Fixed

- The hero detail line no longer shows a calendar-day high and low that could contradict the headline.
- Choosing a new place scrolls back to the top of the answer.
- A stall during a sky re-trial can no longer lock a healthy device into a low quality tier.
- Review queue: only a reviewer can withdraw or delete a published topic, and deletions are logged.

## 2026-11-15: weather board and flight status

### Added

- Three pages with shared navigation: Weather (`index.html`), Flights (`flights.html`) and Connections (`trip.html`). Old shared links on `/` redirect to the connection checker. (#1)
- Live flight tracking by flight number with weather at both ends, and an airport view with aircraft nearby, through new `/api/flight` and `/api/near` routes. (#1)
- Airport size ranking from OurAirports, and Leaflet for the radar map. (#1)
- Weather home rebuilt as a sky-coloured header with one headline sentence and a personal board of boxes (next 24 hours, 10 days, radar, right now, quick question, here and there, flights, get ready) that can be resized, reordered, hidden or kept on a shelf, saved per device.
- Content logic with tests: headline, parts of the day, daily question, forecast-driven tip, season checklists and city comparison.
- Content source recommendations (`docs/content-sources.md`), the "Caught on camera" moderation policy (`docs/moderation-policy.md`) and research notes in `docs/research/`.

### Changed

- New look across the site: self-hosted Inter and Space Grotesk, updated palette tokens.

## [1.0.0] - 2026-11-15

### Added

- Gatecast: weather for flight connections. A static site with a trip form, per-airport forecasts aligned to flight times, a three-level risk verdict, a route map and live airport rows.
- Zero-dependency local server, Vercel functions, a build step for the airport and map data, tests, and design and research documents.

[Unreleased]: https://github.com/VictorParker22/gatecast/compare/8517737...HEAD
[1.0.0]: https://github.com/VictorParker22/gatecast/commit/8517737
