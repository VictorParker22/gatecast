# Changelog

All notable changes to Gatecast are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Gatecast has no tagged releases yet. `package.json` has said `1.0.0` since the first commit, so that version marks the first commit; later work is grouped by the date it was merged until the next version number is chosen. Work-in-progress checkpoint commits are folded into the entry they led to.

## [Unreleased]

### Security

- **Browser protection headers, and outside data re-checked before a page prints it** (owner, 19 Nov 2026, after a security check: "yes do both gaps").
  - Every response now carries a Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`. The rules are in `lib/security-headers.js`; `vercel.json` holds the values for the live site and `server.js` sends the same ones locally.
  - The policy lets scripts run only from the site's own files, the five inline scripts in the pages (each named by its hash), WebAssembly for the 3D library's decoders, and the two outside scripts loaded on request (X's embed widget, Google Books' viewer). No `unsafe-inline` and no `unsafe-eval`: an injected script, an inline handler, a `javascript:` link and text run as code are all refused. Pictures, video, frames and data may come from any https address, because stories link media from many outlets. The site cannot be framed by another site, and forms post only to the site or Buttondown.
  - After changing an inline `<script>`, run `node scripts/security-headers.cjs --write`; `tests/security-headers.test.mjs` fails until `vercel.json` matches the pages.
  - Two independent reviews went through every place a page or a function handles outside data. No way was found for a visitor to inject markup through headlines, tips, book pitches or addresses. Fixed: an airport from the flight-route service is now checked field by field (`lib/live.js`, `js/flights.js`); forecast values are made numbers or null before any page prints them, fresh or cached (`js/data.js`); a saved trip from the browser's storage is no longer trusted (`js/trip.js`); a submitter's address is encoded in the reviewer page's mail link (`js/review.js`).
  - The owner's tools on public functions (`/api/weird?debug=1`, `/api/book-covers?only=`) need the owner's key on the live site (`GATECAST_DEBUG_TOKEN` in Vercel's settings; with none set they are off there). They re-read every feed uncached and listed the moderation rules to anyone.
  - Still open, for the owner to decide: the vote and tip limits may be bypassable with a forged forwarding header (needs a controlled test on the live function); the collector function can be started by anyone with the public key; the picture relay serves any video's still, not only current stories; there is no request limit on the Vercel functions (a Vercel Firewall setting).

### Changed

- **Page addresses without ".html"** (owner, 19 Nov 2026: "the urls are showing .html in the bar that is crazy"). The library is now `/library`, and likewise `/trip`, `/flights` and `/how`; the front page is `/`.
  - The pages are the same files. `vercel.json` serves each at its clean address and redirects the old one for good (308), keeping any `?…` and `#…`, so shared links, bookmarks and search results keep working. `server.js` does the same locally, from one list (`CLEAN_PAGES` in `lib/site.js`).
  - Every link, form, canonical address, `og:url`, structured-data address, sitemap entry and `llms.txt` link uses the clean address: the hand-written pages, the 404 page, the `/stacks/` and `/weekly/` pages, and the links the front page and the flights page build in script.
  - Not a site-wide switch (`cleanUrls` stays off): Google's ownership file must keep answering at its `.html` address, and `review.html` keeps its name because the editor's sign-in link points at it.
  - Still a static site, with no framework: this changes addresses only.
  - `tests/seo.test.mjs` checks the redirects and rewrites against the list, and that nothing the site writes points at an old address.

### Added

- **A launch video for The Stacks** (owner, 18 Nov 2026: "build the launch video with motion canvas").
  - `docs/video/the-stacks-launch.mp4`: 31 seconds, 1920x1080 at 30 frames a second, silent. Six parts: a hook ("Some stories are true. Some only say they are."), the library page, a book pulled out and turned over, the "Worth knowing" note, the stamped library card, and an end card with the address.
  - Every picture is a real screenshot of `library.html` (the full 3D room, taken locally), the typefaces are the site's own, and every sentence is one the site already says or a count from `data/books.json`. The book shown has the site's stand-in cover, not a publisher's.
  - The source is in `video/launch/` (Motion Canvas 3.17.2, MIT) with its own `package.json`, outside the site build and tests. `node render.cjs` renders it again without a screen by driving the Motion Canvas editor in headless Chromium; `capture/` retakes the screenshots.
  - Not done: sound, and a vertical cut for phones.

- **A rubber stamp on the empty library card, and the toolkit written down** (owner, 18 Nov 2026: "check all of these libraries for motion graphic ... save all of them and pick what we can use from those libraries to update our library in every way possible").
  - All eleven tools were installed and measured, and their licences read: `docs/motion-toolkit.md` records what each does, its licence, its real size, and why it is or is not used.
  - Zdog 1.1.3 (MIT, 8 kB gzipped) draws a small rubber stamp beside the sentence on an empty library card, in the room's leather, brass and red-ink tokens. It turns once when it appears, and once again each time the card is opened or the pointer comes onto it, then rests; with reduced motion it is drawn still. It loads when the browser is idle, and without it the card is as it was.
  - Vendored in `vendor/zdog/` as one ES module (the package ships CommonJS only; the README there gives the command), named in the import map and the bundler. `stampTurn` in `js/librarymodel.js` has a test.
  - Two findings that rule tools out: Hydra is AGPL, which would put its terms on the whole site, and LYGIA is free for non-commercial use only.

- **Hand-inked stamps on the library card** (owner, 18 Nov 2026, with a list of free graphics tools: "be creative with them and maybe use it for the library section to enhance"). Of the eleven tools, Rough.js fits the room best: the design the owner drew has ink stamps the page lacked.
  - Each date stamp on the library card now has a hand-inked outline instead of a straight border, turned a little differently for each book, and the same on every visit (the wobble and tilt come from the book and the time it was stamped). The "Worth knowing." label on a book's back cover gets a pencil line under it.
  - Rough.js 4.6.6 (MIT) is vendored in `vendor/roughjs/`, loads only after the page is up and in its own 28 kB file, and draws in the ink colours the page already had. Without it the stamps keep their plain border. The drawings are decoration: hidden from screen readers, and the stamp's text and label are unchanged.
  - `js/librarymodel.js` has the seed and tilt rules (`inkSeed`, `stampTilt`) with tests; the import-map test knows the new entry.
  - Not used, and why: LYGIA's licence does not allow free commercial use; Theatre.js, tsParticles and Lottie would add far more code than what they would draw here; Hydra and WebGL Fluid have no place in the room; Remotion and Motion Canvas make videos, not pages.

- **Who makes Gatecast** (owner, 18 Nov 2026: "the mother company is oryntlabs.co"). The site now names its maker, ORYNTLabs LLC, an independent product studio in New Jersey, USA, with details taken from the studio's own site.
  - `how.html` has a "Who makes Gatecast" section (in its list of contents) and, for the first time, an email address for corrections, security reports and newsrooms: `contact@oryntlabs.co`. GitHub stays as the public route.
  - Every hand-written page's footer says "Made by ORYNTLabs LLC", linked to that section. The structured data on the front page and the How page keeps Gatecast as the brand and names the company as its parent; `llms.txt` says who makes it.
  - `tests/seo.test.mjs` checks the name is spelt one way everywhere and the address is the same in each place.

- **The Stacks: the bookcases fill the first screen** (owner request, 17 Nov 2026: "the shelves are completely hidden"):
  - The top of the room is one compact bar: the title, search, Surprise me, the sound and simple-shelves toggles and the library card (now a button at every width; the card opens under it, over the room), with the shelf chips in one scrolling row under it. The bookcases start about 250px down on a laptop (was 570px) and 300px on a phone (was 670px); on a wide, short window the frame narrows so four bookcases still fit.
  - The introduction moved under the room ("About the shelves", with links to the list, Worth knowing and Content notes), beside "Put your book forward", so that row is no longer half empty.
- **The notes in one place, and a guide for AI assistants** (owner request, 17 Nov 2026: keyword clustering and AI visibility; reports in `docs/seo/`):
  - `/stacks/worth-knowing/`: every "Worth knowing" note of the true-story shelves on one indexed page, word for word; `/stacks/content-notes/`: every content note. Both are generated by `scripts/build-stacks-pages.cjs` (`GUIDES`), listed in the sitemap and linked from `/stacks/` and How Gatecast works. Their ids are reserved: no shelf or book may use them.
  - `/llms.txt`: a short plain-text guide to the site for AI assistants, written by the build from `data/books.json` (`llmsTxt()` in `scripts/build-data.cjs`) and served by `server.js` locally; `robots.txt` points to it.
- **Pictures on every story, and the news first on phones** (owner request, 17 Nov 2026: "text-filled websites don't go far"):
  - A story with no picture and no video now shows Gatecast's own illustration for its category (seven, in `assets/art/`, 240/480/960 px WebP), labelled "Illustration" on the picture and "Illustration: Gatecast (not a picture of this story)" in story mode. Also used when an outlet's picture fails to load. `artFor()` in `js/frontmodel.js`; `mediaSlot(..., { art: false })` keeps the old text-only slot.
  - Also odd shows a small square picture beside each story (the outlet's picture or the illustration).
  - The weather box folds to its title bar (with the temperature once a place is set) and opens with one tap, on phones and, since the same day, on laptops and tablets too, so the lead story is on the first screen; on phones the reading streak shrinks to one line.
- **The editor's picks, week by week, as a feed and by email; visit counts** (owner decisions, 17 Nov 2026):
  - `/weekly/` lists every ISO week with picks, newest first; `/weekly/<YYYY>-W<ww>/` shows that week's picks (the outlet's headline, outlet, date, the editor's hook and "In our words" summary when there is one, the editor's rating when given, "Read it at <outlet>", and "Open it on Gatecast" while the story is still on the front page), with the weeks either side. No outlet pictures. `/feed.xml` is RSS 2.0 with the latest 30 picks, linking to story mode (`/?story=<id>`, the front page's own id) with only the editor's words and a link to the original. All rendered on request by `lib/weekly.js` through the existing `/api/weird` function (`vercel.json` rewrites; no new function), cached five minutes at the edge; `server.js` serves the same routes. `/weekly/` is in the sitemap; the public pages carry an RSS `<link rel="alternate">`, and their footers and the front page link the archive.
  - Newsletter signup (Buttondown, `js/newsletter.js`): a plain form posting to Buttondown's embed endpoint, on the weekly pages and in the front page's footer, rendered only when `data/site.json` names a username (null for now).
  - Vercel Web Analytics (`js/analytics.js`): cookieless page-view totals, loaded only without Do Not Track or Global Privacy Control, on the front page, How, Trips, Flights and the weekly pages. How Gatecast works has a new "Counting visits" section. Owner steps are in the README ("Weekly archive, RSS, newsletter and visit counts").
- **Story mode, editor summaries and videos from any provider** (owner decisions, 17 Nov 2026; `supabase/migrations/20261117170000_pick_summary.sql`, applied 17 Nov 2026):
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
- **Books put forward by authors, and the Book of the Week** (owner decisions, 17 Nov 2026; `supabase/migrations/20261117120000_stacks_submissions.sql`, applied 17 Nov 2026):
  - `POST /community/book`: an author or their publisher puts a book forward (title, authors, ISBN-10 or ISBN-13 with a valid check digit, stored as ISBN-13, year, publisher, shelf, a pitch of up to 600 characters, an optional email, a confirmation and the honeypot). 3 per sender and 50 in all per UTC day; a book already on the shelves or waiting answers `409 duplicate`. The address hash goes after 7 days, the email 90 days after the decision, and rejected submissions 180 days after it.
  - Reviewer console, The Stacks → Books (with the number waiting): the queue with the sender's pitch as a quote, an approve form where the editor writes the description, content note, caveat and tags (live checklist: one or two sentences, at most 400 characters, no run of 8 words or more from the pitch), "Look up cover" from Open Library on click, reject with a note, hide or show approved books, and the Book of the Week (any book on the shelves, a reason of up to 140 characters, a week, and the history).
  - `GET /api/books` (`api/books.js`, `lib/stacks-db.js`): `data/books.json` plus the approved books (`origin: 'author' | 'publisher'`) and `featured: { bookId, reason, since } | null`; 4 minutes in memory and 5 at the CDN, so decisions show within about 5 minutes without a deploy; the static data on any database failure. `validate()` in `js/librarymodel.js` accepts `origin`, books without Open Library keys, and next year's books.
- **Videos and editor-supplied media for weird stories; no more empty picture frames** (owner request, 17 Nov 2026):
  - A story with neither picture nor video is shown text-led everywhere: the lead (`.lead--text`: the burst beside the headline, the hook as a pull quote beside the Weird-o-meter under a double rule), favourites (`.fav--text`), the grid (`.card--text`: sticker and slab headline in the picture's place) and The brief's headlines. The monogram tile and "Picture at the source" are gone; a picture that fails to load is dropped and the story drawn again.
  - Click-to-play video facade (`js/frontmedia.js`, `storyMedia()` in `js/frontmodel.js`): the still served by Gatecast from the new `/api/yt-thumb?id=<11 characters>` (`api/yt-thumb.js`, `lib/youtube.js`: i.ytimg.com only, no redirects, 256 KB cap, cached a day), a play button, the length when known and "Video: <channel> on YouTube". Play inserts the youtube-nocookie.com player and moves focus into it; nothing contacts YouTube before that. A picture with a video gets a "Has video" control.
  - `/api/weird` items gain `youtube: { id, title, channel, duration, from } | null`. Feed stories get the YouTube video their article embeds (`pageMedia` in `lib/news.js`: og:video, a JSON-LD VideoObject or the first YouTube iframe, same guards and caps as the og:image read); every video is checked with YouTube's oEmbed first (`verifyVideo`: 6 hours, failures 10 minutes, a failure never drops a verified video).
  - Picks: "Video (YouTube link)" and "Picture (link to the image)" in the console's pick form, with live previews and checks (any common YouTube link form; a picture on the story's own site or the outlet's `imageHosts` in `data/weird-sources.json`). Stored in `weird_picks.video_id` and `image_url` (`supabase/migrations/20261117150000_pick_media.sql`, applied 17 Nov 2026); `lib/picks-db.js` reads them and falls back to the old columns until the migration is applied.
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

- **The site's address is now `https://www.thegatecast.com`** (owner decision, 18 Nov 2026; it was `https://gatecast.vercel.app`). The www form, because that is the address Vercel serves: `thegatecast.com` redirects to it. The old address forwards to it for good (308, the first block of `redirects` in `vercel.json`, added once the owner had listed the new address in Supabase Auth); `docs/seo/domain-move.md` has what is left for the owner.
  - One definition: `lib/site.js` (`SITE_ORIGIN`). `scripts/build-stacks-pages.cjs` (the `/stacks/` pages: canonicals, share tags, JSON-LD, breadcrumbs), `scripts/build-data.cjs` (`sitemap.xml`, `llms.txt`), `lib/weekly.js` (the weekly pages and `/feed.xml`), `lib/books.js` (the address in the Open Library request header) and `scripts/indexnow.cjs` (host and key location) read it.
  - Spelt out, and checked against it by `tests/seo.test.mjs`: the canonical link, `og:url`, `og:image`, `twitter:image` and JSON-LD of `index.html`, `library.html`, `how.html`, `trip.html` and `flights.html`; `robots.txt` (sitemap and `llms.txt` lines); the share address of story mode (`js/tvmodel.js`).
  - Supabase functions (deployed with this change): `community` and `assist` allow `https://thegatecast.com` and `https://www.thegatecast.com` as browser origins and keep `https://gatecast.vercel.app`; `community` reads `data/books.json` from the new address by default. The tip box refuses links to the site's own pages at either address (`tipUrl()` in `js/frontmodel.js`).
  - `docs/seo/domain-move.md` is the owner's checklist (Vercel, Supabase, Search Console, Bing, IndexNow, the links elsewhere, what to watch for two weeks). The two SEO reports carry a dated note; `verify/README.md`, `supabase/README.md`, `docs/assist.md` and `docs/community.md` name the new address.
- **The Stacks on a desktop follows the owner's design** (owner request, 18 Nov 2026: "copy the same exact design and sizes"). From 1100px:
  - The hero is back: the torn label and the slab title (81px at 1100 to 147px at 2000) with the introduction under them, and the library card pinned open at the top right. Below 1100px the compact bar of 17 Nov stays, with the introduction under the room.
  - The search has the shelf chips beside it, Surprise me and the count under it. Chips are dark plates with a steel edge, the later shelves red leather, the chosen one dark with gold; Surprise me is an antique brass plate.
  - Three large bookcases across the room instead of four (`.s3d .lib-cases` is `2.24 / 1.33` from 940px; the four-bay frame is gone). The frame's headroom overlaps the controls, so the cornices start about 5rem under the count.
  - Sizes are the design's, as a share of its 2000px width, in the unit `--spacing-lib-u` (`min(1vw, 1.55svh)`): on a 16:9 laptop the room is a little narrower, so the first screen still shows the whole first row of books.
  - The bookcases look older: grey, weathered boards (the wood photo with most of its red-brown taken out), a lighter back panel, neutral-warm lamps instead of orange, and brass plates whose names read in both 3D tiers.
  - Second pass, after a separate check against the design (18 Nov 2026):
    - Books and shelf rows are as tall as the design's: a 0.5 m opening (was 0.34) and books of 0.31 to 0.41 m (`BOOK_TALL` in `js/stacks3d/model.js`), with covers kept at a book's usual shape. The frame is `2.24 / 1.65`. The Book of the Week keeps its everyday size.
    - Only the page of bookcases in the frame is drawn; the next page's first case no longer shows as a slice at the right (two clipping planes that travel with the view).
    - The Book of the Week can be clicked anywhere on its cover: the empty parts of the controls' boxes, which overlap the frame's headroom, let the click through.
    - The search field's example fits; the library card is no taller than the hero text; the title is mottled pewter instead of pinstripes; Surprise me is a duller brass plate with notched corners; the boards are straighter and greyer and the plate lettering darker.
    - The design's unit is `min(1vw, 1.5svh)`, so a 965px-high laptop window shows the whole first row of books.
  - The room picture is new (owner request, 18 Nov 2026: "generate the new background to match the design"): the arched window high in the middle of the back wall with its shafts of light, the brick wall and ivy at the left with two lamps on the sideboard, the spiral staircase between them, ferns at the top right. Generated for Gatecast, in the four sizes the page already loads (`assets/stacks/room-desktop-{1600,2560}.webp`, `room-phone-{720,1080}.webp`, the same dimensions and about the same weight). The 3D moonlight now comes from that window.

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

### Fixed

- **The Stacks: the first four bookcases were blank on real graphics cards** (owner report, 17 Nov 2026, Chrome on three computers; `?stacks=low` was fine). The Book of the Week's light beam (`BEAM` in `js/stacks3d/index.js`) took `pow()` of a value that anti-aliasing can push just below zero at the beam's edge. That gave a pixel that is not a number; in the high tier's half-float buffer the bloom blur spread it into a transparent rectangle about 1,400px wide, centred on the Book of the Week, so the room's CSS photo showed through where the bookcases should be. Software rendering (the test browser) returns a finite value there, which is why it only showed on real hardware.
  - The beam clamps before `pow()`; the dust, light-ray and vignette shaders keep their `smoothstep` edges in order.
  - Two guards so one bad pixel can never blank the room again: the bloom's bright pass (`SAFE_BRIGHT`) reads only finite colour, and the last pass writes a finite, opaque pixel.
  - `tests/stacks3d.test.mjs` reads the shader source for an unclamped `pow()`, a reversed `smoothstep` and the two guards.

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
