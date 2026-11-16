# Security policy

## Supported versions

Gatecast is deployed continuously from the `main` branch. Only the current `main` and the site deployed from it receive security fixes.

## Reporting a vulnerability

Please do not report security problems in public issues, pull requests or discussions.

Report them privately through GitHub:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** to open a private security advisory with the maintainers.

If that option is not shown, private vulnerability reporting is not switched on for the repository yet. In that case, open a short public issue that asks the maintainers for a private way to reach them, without any details of the problem, and wait for a reply before sharing more.

Please include:

- what the problem is and what someone could do with it,
- the steps or a link that reproduces it,
- the affected files, routes or pages, if you know them.

We will acknowledge a report as soon as we can, keep you informed while we work on it, and credit you in the advisory if you would like.

## Scope

Of most interest:

- the local server and serverless routes (`server.js`, `api/`, `lib/live.js`), which fetch from third-party services on the visitor's behalf;
- the "Both sides" review-queue database rules in `supabase/migrations/`, which decide who may publish;
- anything that leaks a visitor's location or other data beyond what the README describes;
- secrets or keys committed to the repository.

Out of scope: problems in the third-party services Gatecast reads from (Open-Meteo, api.weather.gov, NOAA, FAA, adsbdb, adsb.lol, RainViewer, OpenStreetMap), which should go to those providers, and findings that need a compromised device or browser.

## Handling secrets

Never commit API keys, tokens or passwords. Keys for the planned content pipeline (for example the api.data.gov key and the Supabase secret key) belong in the hosting provider's environment settings, not in the code.
