# Contributing to Gatecast

Thanks for helping. Gatecast is weird news from real outlets, each story linked to the original, with the weather where you are told in plain words, The Stacks (a library of strange true stories and classic fiction) and small weather checks for flights and connections. Every change should make the page more honest, clearer or faster to read: real sources, plain words, nothing made up.

## Set up

You need Node 20 or newer (`.nvmrc` pins 22 for local work; CI runs 20.x and 22.x). Tailwind CSS v4's engine needs Node 20.

```bash
git clone https://github.com/VictorParker22/gatecast.git
cd gatecast
npm ci
```

`npm ci` installs the build step's packages (`topojson-client`, `world-atlas`) and the styling toolchain (Tailwind CSS 4, its CLI and daisyUI, dev dependencies). The pages link the compiled `styles/site.css`, so run `npm run dev` (or `npm run css`) before opening them.

## Run

```bash
npm run dev        # node server.js plus Tailwind in watch mode (styles/site.css, styles/console.css)
```

Open http://localhost:4173 (set `PORT` to change it). `server.js` serves the static pages and the same `/api` routes that run as Vercel functions in `api/`. Flight tracking, "Right now" airport observations and FAA delay programmes need those routes; the weather page and connection checker also work as plain static files.

## Test and build

```bash
npm test           # node --test tests/*.mjs tests/*.cjs
npm run build      # node scripts/build-data.cjs: downloads the airport list, compiles the CSS, assembles public/
npm run ci         # both, as CI runs them
```

The build needs network access (it downloads the airport list from GitHub). `public/` is generated and ignored by git; Vercel deploys it.

Pure logic lives in modules with no DOM and no network so it can be tested with plain Node: `js/core.js` (time zones, risk scoring, trip verdict), `js/boardcontent.js` (headline and board content) and `js/sky/governor.js` (sky quality). Changes there need tests in `tests/`.

## Code style

- Plain JavaScript modules and CSS, no framework and no bundler.
- Two-space indentation, single quotes in JavaScript, LF line endings, a final newline. `.editorconfig` sets this up in most editors.
- Keep comments short and about why, not what.
- Do not edit `vendor/`; those are third-party files with their own licences.

## Branches and commits

- Branch from `main` with a short descriptive name, for example `weather-home-flight-status` or `fix-layover-rounding`.
- Write commit subjects in the imperative and sentence case, without a trailing full stop: "Add weather home page and flight status", "Scroll to the top when a new place is chosen".
- Use the body to say what changed and why, wrapped at about 72 characters. Note the test count when it changes.
- Open a pull request into `main` and fill in the template. CI must pass before merging.

## Design principles

The full system is in [`docs/design-system.md`](docs/design-system.md). In short:

1. **Verdict first, evidence second.** Every screen answers "will weather disrupt my trip?" in one sentence before any numbers.
2. **Never colour alone.** A risk level is always a word, a shape and a colour together (teal tick, amber triangle, rose octagon).
3. **Local time, always labelled.** Each airport shows its own clock with the zone, and a written date when the day changes.
4. **Plain words.** No METAR, IFR or ATC terms in the main view; raw data sits one tap deeper. No exclamation marks, emoji or "expect".
5. **Tokens only.** Components never contain a colour value; they take it from a theme token in `styles/main.css` (or the `@theme` block at the top of a component file).

Also: 44px minimum tap targets, every motion removed under `prefers-reduced-motion`, and copy that is deterministic (the same forecast always gives the same words).

## Content and honesty

The rules are in [`docs/content-sources.md`](docs/content-sources.md) and [`docs/moderation-policy.md`](docs/moderation-policy.md). In short:

- **Only say what the data says.** No causes, fronts or systems we cannot see, and never round a maybe up to a certainty. Gatecast is a planning aid, not an official source.
- **State the limits.** If a source cannot provide something (for example scheduled times, gates or cancellations), say so on the page rather than guess.
- **Every content box must earn its place** by finishing the sentence "because of your weather, your place or your day".
- **Respect licences.** No non-commercial content (wikiHow, iFixit, Instructables, Red Cross text) on a site that may carry ads; keep share-alike text (Wikivoyage, Wikipedia) in its own credited block; an image link is not permission to use the image.
- **A person approves sensitive content.** Political quotes, safety guidance and any camera footage are reviewed by a person before publishing. Nothing political is published without the owner's approval.
- **Accused is not guilty, and minimise harm.** If camera content ever returns, the moderation policy decides what runs; view counts only rank what has already passed review.

New data sources need their terms checked (commercial use, attribution, rate limits) and a line in the README's "Data sources and limits".

## Reporting bugs and security issues

Use the issue forms for bugs and ideas. Do not open a public issue for a security problem; follow [`SECURITY.md`](SECURITY.md).

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
