# Changelog

All notable changes to Gatecast are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Gatecast has no tagged releases yet. `package.json` has said `1.0.0` since the first commit, so that version marks the first commit; later work is grouped by the date it was merged until the next version number is chosen. Work-in-progress checkpoint commits are folded into the entry they led to.

## [Unreleased]

### Added

- **Story mode, editor summaries and videos from any provider** (owner decisions, 17 Nov 2026; `supabase/migrations/20261117170000_pick_summary.sql`, written, not applied yet):
  - Clicking a story on the front page (the lead's headline or picture, a favourite, an Also-odd row, a grid card, a ticker item, the weather box's weird-weather line) opens it in **story mode, "Gatecast TV"** (`js/tvscreen.js`, `js/tvmodel.js`, `styles/components/tv.css`) instead of leaving the site: a full-screen native `<dialog>` that grows out of the clicked story, a burst of static and a station-ident title card (the category, rotated, with the channel number), then a zine spread: the headline with the outlet and date as a lower third, the picture or the click-to-play video in a glass screen, the hook as a pull quote, the editor's summary as "In our words", the Weird-o-meter (the lead's code path), credits, the big "Read the full story at <outlet>" button (a direct link, `rel="noopener"`, the only place a click is counted) and "Next on Gatecast". Prev / Next channel and the arrow keys move through the stories in page order. Each story has its own address (`/?story=<id>`); Back, Escape and Close return to the same spot with focus on the story. Reduced motion turns the opener into a fade. The lead's own "Read it at <outlet>" and the cards' "Read at" stay direct links. Original design: no network's logo or idents.
  - **Editor summaries**: a pick may carry `weird_picks.summary`, 2–4 sentences in the editor's own words (≤700 characters). The console's pick form has "Summary (your words, 2–4 sentences)" with a live checklist (`js/summaryrules.js`) and "Draft with Claude", the assist function's new `draft_summary` action (headline, outlet, optional notes and story page; up to 2 drafts, each re-checked on the server: sentences, length, no run of 8+ words shared with the headline, the page or the notes). A page behind a bot wall (UPI's Cloudflare challenge) is reported as `blocked`, never worked around. `/api/weird` items carry `summary` (picks only).
  - **Videos from any provider** (`js/mediaproviders.js`, shared by the server, the console and the page; `lib/videos.js`; `api/media-thumb.js`): YouTube, Vimeo, Facebook, X and TikTok play in their own players after Play, Instagram is a link-out card; stills only through Gatecast from each provider's own image host, or Gatecast's own poster; oEmbed checks where the provider offers them publicly. Article pages are searched for every provider's player. Picks store `video_provider` and `video_ref` (existing `video_id` rows are copied to YouTube; `video_id` stays readable for one release). The console's single Media box takes any video or picture link and puts it in the right field. `/api/weird` items carry `media.video`; `youtube` is kept for YouTube videos for one release.
  - The How page (`how.html#story-mode`, `#videos`), `docs/community.md`, `docs/assist.md`, `docs/content-sources.md`, `docs/design-system.md` and `supabase/README.md` say so.
- **The weird-news pivot** (owner decision, 16 Nov 2026): Gatecast leads with odd news from real outlets, keeps the weather on top, adds a library, and keeps flights and trips as a small utility.
  - Late-90s newsprint look across the whole site (`--np-*` tokens, Alfa Slab One and VT323 self-hosted, beveled tabs and buttons, square corners; risk colours stay reserved for rounded risk chips). See `docs/design-system.md`.
  - Front page (`index.html`, `js/front.js`, `js/frontmodel.js`): edition strip, masthead, the live WebGL sky in a "Weather box", a pausable ticker, the lead story, "Also odd", the "Believe it or not. It's all sourced." grid with category filters, The brief, a small "Flying?" box, the library teaser, the guestbook and "How we pick".
  - `/api/weird`: stories from nine odd-news outlets (`data/weird-sources.json`), moderated by `lib/moderation.js` (the strangeness must be in the situation, not in someone's misfortune), gated and ordered by a weirdness score, with editor's picks first.
  - The Stacks (`library.html`): 58 real books on six shelves, our own descriptions, content notes and caveats, search, Surprise me, and a 3D book that leaves the shelf and turns over. 46 covers from Open Library are checked and baked into `data/books.json`; the rest, including every cover likely to show a killer, use a designed stand-in.
  - Community backend in Supabase: the Weird-o-meter (one vote per visitor per story, readers' average from 50 votes), the guestbook (tips reviewed by a person), and editor's picks curated in the review console. Visitors are identified only by a salted hash of their network address. See `docs/community.md`.
  - Review console: Tips and Picks.
  - **Reader favourites, hook lines and click totals** (owner decisions, 17 Nov 2026; `supabase/migrations/20261117090000_reader_favourites.sql`, applied to the live project on 17 Nov 2026; it replaces `supabase/paused/`, which is gone):
    - The favourites row under the lead is on: the editor's picks in the editor's order, until a story has 10 or more Weird-o-meter votes in the past 7 days; such stories rank first by readers' votes (`weird_favourites()`, `GET /community/favourites`). The heading says which it is: "Editor's favourites" or "Reader favourites — ranked by Weird-o-meter votes".
    - Hook lines: a pick's note is now its hook, at most 140 characters (database check), shown under the headline. In the console, "Hook (your words, shown under the headline)" has a live checklist and "Draft with Claude", the assist function's new `draft_hook` action: up to 3 hooks from the headline (or the story page, when asked), re-checked against the house rules on the server; the reviewer clicks one in, edits and saves.
    - Anonymous click totals per weird story per day (`weird_clicks`, `POST /community/click`, `countClick()` in `js/community.js`): a keepalive request with the story's address only, never blocking the link, skipped under Do Not Track or Global Privacy Control, 120 per visitor per hour, kept 90 days. The console shows each published pick's clicks over 7 days (`weird_click_totals()`) and a preview of the favourites row. Clicks rank nothing.
    - The How page, `docs/community.md`, `docs/assist.md`, `docs/content-sources.md` and `supabase/README.md` say so.
  - **Book previews in The Stacks**: 35 books have a Preview the editor approved: an official video (15 on YouTube, played from youtube-nocookie.com only after Play; 17 C-SPAN, 1 PBS and 1 Criterion links that open on their own sites) and, for Mackay's *Extraordinary Popular Delusions*, the pages on the Internet Archive. Nothing loads from those services until the reader opens Preview (the YouTube still) or presses Play / opens the pages. Durations are optional and shown when known.
  - **The Stacks as plain pages** (`/stacks/`): an index, 6 shelf pages and 58 book pages built from `data/books.json`, with no JavaScript, Book/ItemList/Breadcrumb structured data and links out only. Book pages stay `noindex` until the editor writes a `take` of 150+ words for that book. `robots.txt` now allows `/stacks/` and the public APIs, and the sitemap carries real last-modified dates.
- **Books put forward by authors, and the Book of the Week** (owner decisions, 17 Nov 2026; `supabase/migrations/20261117120000_stacks_submissions.sql`, written, not applied yet):
  - `POST /community/book`: an author or their publisher puts a book forward (title, authors, ISBN-10 or ISBN-13 with a valid check digit, stored as ISBN-13, year, publisher, shelf, a pitch of up to 600 characters, an optional email, a confirmation and the honeypot). 3 per sender and 50 in all per UTC day; a book already on the shelves or waiting answers `409 duplicate`. The address hash goes after 7 days, the email 90 days after the decision, and rejected submissions 180 days after it.
  - Reviewer console, The Stacks → Books (with the number waiting): the queue with the sender's pitch as a quote, an approve form where the editor writes the description, content note, caveat and tags (live checklist: one or two sentences, at most 400 characters, no run of 8 words or more from the pitch), "Look up cover" from Open Library on click, reject with a note, hide or show approved books, and the Book of the Week (any book on the shelves, a reason of up to 140 characters, a week, and the history).
  - `GET /api/books` (`api/books.js`, `lib/stacks-db.js`): `data/books.json` plus the approved books (`origin: 'author' | 'publisher'`) and `featured: { bookId, reason, since } | null`; 4 minutes in memory and 5 at the CDN, so decisions show within about 5 minutes without a deploy; the static data on any database failure. `validate()` in `js/librarymodel.js` accepts `origin`, books without Open Library keys, and next year's books.
- **Videos and editor-supplied media for weird stories; no more empty picture frames** (owner request, 17 Nov 2026):
  - A story with neither picture nor video is shown text-led everywhere: the lead (`.lead--text`: the burst beside the headline, the hook as a pull quote beside the Weird-o-meter under a double rule), favourites (`.fav--text`), the grid (`.card--text`: sticker and slab headline in the picture's place) and The brief's headlines. The monogram tile and "Picture at the source" are gone; a picture that fails to load is dropped and the story drawn again.
  - Click-to-play video facade (`js/frontmedia.js`, `storyMedia()` in `js/frontmodel.js`): the still served by Gatecast from the new `/api/yt-thumb?id=<11 characters>` (`api/yt-thumb.js`, `lib/youtube.js`: i.ytimg.com only, no redirects, 256 KB cap, cached a day), a play button, the length when known and "Video: <channel> on YouTube". Play inserts the youtube-nocookie.com player and moves focus into it; nothing contacts YouTube before that. A picture with a video gets a "Has video" control.
  - `/api/weird` items gain `youtube: { id, title, channel, duration, from } | null`. Feed stories get the YouTube video their article embeds (`pageMedia` in `lib/news.js`: og:video, a JSON-LD VideoObject or the first YouTube iframe, same guards and caps as the og:image read); every video is checked with YouTube's oEmbed first (`verifyVideo`: 6 hours, failures 10 minutes, a failure never drops a verified video).
  - Picks: "Video (YouTube link)" and "Picture (link to the image)" in the console's pick form, with live previews and checks (any common YouTube link form; a picture on the story's own site or the outlet's `imageHosts` in `data/weird-sources.json`). Stored in `weird_picks.video_id` and `image_url` (`supabase/migrations/20261117150000_pick_media.sql`, written, not applied yet); `lib/picks-db.js` reads them and falls back to the old columns until the migration is applied.
  - The How page (`#videos`), `docs/content-sources.md`, `docs/community.md`, `docs/design-system.md` and `supabase/README.md` say so. Tests: `tests/storymedia.test.mjs`.
- GitHub Actions CI: tests and the build step on Node 18.x and 22.x for every push and pull request.
- Pull request template, bug report and feature request issue forms, and Dependabot updates for npm and GitHub Actions.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.editorconfig` and `.nvmrc`.
- `docs/redesign.md`: the design direction being explored for the next version of the site.
- `dev` and `ci` npm scripts, and description, repository, homepage and bugs fields in `package.json`.
- Preview images in "The brief" headlines (owner decision, 16 Nov 2026): each story shows the publisher's own link-preview picture, from its feed (`media:content`, `media:thumbnail`, image enclosures) or else the article page's `og:image` / `twitter:image`, read from the page's `<head>` only (256 KB, 4 s, the outlet's own site, cached six hours). Pictures are hotlinked from the publisher, credited "Image: <outlet>", linked to the story, sent without a referrer, and replaced by the outlet's monogram tile if they fail. `/api/news` items carry `image: { url, width?, height? } | null`.
- A per-outlet `"images"` switch in `data/news-sources.json` (all `true`); `false` turns pictures off for that outlet, and its pages are never fetched.
- FAA "planned for today": `/api/faa-plans?airports=JFK,LGA` (Vercel function and `server.js` route, five-minute cache, US airports only) reads FAA NAS Status's operations plan and airport events and returns `{ airport, kind, text, summary, start, end, status, link, source: "FAA NAS Status" }` items for ground stops, delay programs, de-icing and other planned items; plan times are Zulu, returned as ISO. `loadFaaPlans(codes)` in `js/data.js`. The Flights page shows them as a quiet "FAA plan: …" line linked to the FAA advisory. Parser tests in `tests/faaplans.test.mjs`, from the FAA's 16 Nov 2026 responses.
- Search and share basics: canonical links, Open Graph and Twitter card tags, `theme-color` and a 1200×630 share image (`vendor/og/gatecast-og.png`) on Today, Trips, Flights and the new how page; `WebSite` and `Organization` JSON-LD on Today; `robots.txt` (review console and API disallowed; OAI-SearchBot and PerplexityBot allowed by name) and a `sitemap.xml` written by the build. `X-Robots-Tag: noindex` on `/review.html` and `/api/`.
- `how.html`, "How Gatecast works": how The brief is chosen, how a weather verdict is worked out (and that its thresholds are not yet back-tested), every data source and its limits, what Gatecast never does, and "Report an error" through GitHub issues.
- A terms register for the 20 newsrooms in `docs/content-sources.md`, with unknowns marked.

### Changed

- **A healthier weird-news mix** (owner request, 17 Nov 2026: "not only UPI"). On 17 Nov UPI had 11 of the 21 stories, 8 of them stacked at the top of the feed stories.
  - Order (`lib/weird.js` `mixOutlets`, `LIMITS.bandsMs` and `LIMITS.mix`): after the editor's picks, which stay on top and untouched, feed stories are interleaved by outlet within freshness bands (under 2 days, 2–7, 7–14, older), each outlet's strangest story first, without the same outlet twice in a row when another fresh story fits; no outlet may take more than 3 of the first 12 feed stories or 10 of the first 30 while other outlets have stories. The category filter and limits work as before on the mixed order.
  - Per-source windows (`maxAgeDays`, default 14, at most 90): Atlas Obscura 60 days, Smithsonian and Mental Floss 45, ScienceDaily 30, Live Science 21 (its tag feeds 45). A story older than 14 days always sorts after the fresher ones.
  - Caps raised where quality allows: Smithsonian 3 → 5, ScienceDaily 4 → 6, Live Science 3 → 4 (shared by its three feeds). Live Science's section filter now also lets Space and Astronomy through (Health stays out). Mental Floss's listicle filter and SoraNews24's weirdness minimum were reviewed and kept. Atlas Obscura's pictures are off: its feed has none and its article pages answer automated reads with a Cloudflare challenge.
  - New feeds: Smithsonian Science & Nature, Live Science's Animals and Archaeology tag feeds, and The Conversation's US Science + Tech feed (Creative Commons articles; pictures off, since its images are licensed separately). IFLScience, Futurity, Phys.org and Popular Science are listed but disabled (read for `?debug=1` only) until a preview deploy confirms their feeds, robots.txt and terms; the build sandbox could not reach them. Candidates looked at and not added are under `evaluated` in `data/weird-sources.json`.
  - Every source in `data/weird-sources.json` now records `maxAgeDays`, a `terms` note (robots.txt, terms, page reads and preview images, and how they were checked) and a `comment` justifying its settings; `?debug=1` rows carry each feed's `id`. Tests: `tests/weird-mix.test.mjs`, with an Atom fixture shaped like The Conversation's feed. `docs/content-sources.md` and the How page say so.
- "Headlines in <state>" on Today is now a news module instead of a grid of text tiles: a lead story with a 16:9 picture, three compact rows beside it and cards below; one column with small left pictures on a phone. Weather news keeps its risk-coloured text cards.
- `docs/content-sources.md`: the image rule now records the owner's exception for hotlinked, credited preview images, its reasons and its residual risks.
- `docs/content-sources.md`: the planned "our own one-line summary" for headlines is replaced by the shipped rule (headline, outlet, time and link; nothing copied; no AI summaries for readers), and "rank by our own clicks" by newest-first ordering.
- Today's title and description now describe Gatecast as weather and the news worth knowing, with flight and trip checks.
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
