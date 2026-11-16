# Content sources for Gatecast

Where each content row can get its material, what it costs, and what could go wrong. This summarises three research notes in `docs/research/`, which carry the links and a confidence tag for every claim.

**How far to trust this:** the research was done from search results, not by opening the vendors' own pages (they were unreachable from the build environment). Prices and licence terms below need checking on the primary pages before any money or launch decision. Legal points need a media lawyer.

## Decision (16 November 2026)

The owner asked for the call that gives the site the best chance of success. It is:

1. **"Caught on camera" is dropped from the home page.** A feed ranked by most-viewed police footage earns clicks at the cost of trust, and trust is the only reason people return to a forecast. It also carries the highest legal and advertiser risk of any row and needs the most human review. The moderation policy in `docs/moderation-policy.md` stays on file in case it returns later as its own opt-in page.
2. **"Both sides" leads the content work.** It is the most original idea here, it fits a site whose promise is telling people the truth plainly, and its sources are free public records.
3. **Every content box must pass one test:** it can finish the sentence "because of your weather, your place or your day". Tips, checklists, food and trips qualify when they are weather-led.
4. **Review:** the owner is the first reviewer. Nothing political is published without approval. The review queue lives in a small database (Supabase).
5. **Keys needed:** an api.data.gov key (free) for the Congressional Record. A YouTube key is not needed.

## Recommendation at a glance

| Row | Use | Cost | Biggest catch |
|---|---|---|---|
| Caught on camera | YouTube embeds from an approved list of official police, sheriff and transport channels plus a few vetted publishers, ranked by YouTube's own view counts | Free | Age-restricted videos cannot play on other sites, so many serious-incident videos are unavailable (which the moderation policy excludes anyway) |
| State politics | A hand-picked list of statehouse news outlets per state, read through their own feeds, shown as the outlet's headline, its name, the time and a link (nothing copied, no AI summaries) | About $0 | Nobody sells real "most read" data; headlines are shown newest first, never ranked by clicks |
| Both sides | Built from primary records: what members of Congress said on the record and in official statements, with party from an open dataset | About $0 plus build effort | There is no equivalent record for state legislatures, and no ready-made feed of statements |
| Tricks worth knowing | Our own short tips written by an AI agent from public facts, plus curated YouTube how-to embeds | Free | Most how-to sites are licensed for non-commercial use only |
| Food | Spoonacular recipe API | About $29 a month (unconfirmed) | Must delete all its data if the subscription ends |
| Trips | Wikivoyage and Wikidata, combined with our own forecast data ("where it is warm now") | Free | Share-alike licence: copied text must stay under the same licence, with credit |
| Season checklists | Our own checklists written from US government guidance (Ready.gov, FEMA, National Weather Service, CDC) | Free | Safety content needs a human check |
| Here and there | Our own small, human-checked dataset built from official menus and price pages | Staff time | No chain publishes a menu API |

## Caught on camera

**Recommended: YouTube Data API.**

- Keep an approved list of channels: official police, sheriff and transport-department channels, plus vetted publishers such as PoliceActivity, Law&Crime and Code Blue Cam.
- Collect each channel's new uploads, read YouTube's view count for each, and drop anything that is not embeddable, is age-restricted, or is marked as made for children.
- A person reviews what is left against `docs/moderation-policy.md`. Approved videos are ordered by YouTube's own view count.
- Rules that come with it: use YouTube's own player unmodified (its ads included), never download the video, and refresh stored data at least every 30 days.
- The free quota (10,000 units a day) is ample: reading uploads and view counts costs about one unit per 50 videos. Open search is expensive (100 units a call), which is another reason to work from a fixed channel list.

**Two risks to check with YouTube's terms:** limits on showing metrics derived from its data, and whether ad-supported pages need content of their own beyond the embed (they would have it: our headline, context and outcome line).

**Runner-up: licensed clips** from agencies such as Storyful, Newsflare, ViralHog, Jukin, AP or Reuters, hosted by us and ranked by our own play counts. Prices are by quote; expect roughly $50 to $500 a clip. Worth it only once the section earns its keep.

**Not recommended:** Ring/Neighbors footage (no media licence found), state traffic cameras (live, not archived, no view counts), and TikTok or X embeds (view counts not comparable).

## State politics by location

**Recommended: a curated outlet list per state, plus free ranking signals.**

- For each state, pick the States Newsroom outlet, the public radio newsroom and one or two newspapers, and read their feeds.
- **Shipped rule:** show the outlet's own headline, the outlet's name, the time and a link to the story, and nothing else from it. The description, opening paragraph and article text are never read, so they can never be shown, and no AI-written summary, rewritten headline or notification text is shown to readers. (An earlier draft of this note planned "our own one-line summary"; that was dropped.)
- **Preview images (owner decision, 16 November 2026):** show the publisher's own link-preview picture as a hotlinked, credited thumbnail, with an off switch per outlet. Details below.
- **Order:** newest first, from the past seven days, at most three per outlet and eight in all (`lib/news.js`). Political items are never ranked by clicks, and the site does not count clicks. If a "widely covered" signal is wanted later, GDELT (free, commercial use allowed with credit) shows how widely a story is being covered, which ranks by coverage rather than by clicks.
- Open States (free key) adds what is actually moving in the state legislature: bills, votes and who sponsored them, with party.

**Catches**

- States Newsroom allows republishing, but not selling ads against its stories. Linking out, as above, avoids the problem.
- Bing's news API was retired in August 2025 and Google News feeds are for non-commercial use, so neither is an option.

**Preview images: what we do and why**

- **What:** only the picture the publisher offers for previews of that story: the image in its feed (`media:content` or `media:thumbnail` marked as an image, an `enclosure` or Atom enclosure link with an image type), or, when the feed has none, the `og:image` (then `twitter:image`) in the `<head>` of the article page. Never an image from the article body, and never any of the page's text. `lib/news.js` reads the page only up to `</head>` (at most 256 KB, 4 s), only for the stories it is about to show, only on the outlet's own site, and caches the answer for six hours.
- **How:** hotlinked. The visitor's browser loads the picture from the publisher's address; Gatecast never downloads, stores, proxies or resizes it (no Vercel image optimisation). It is shown with a visible "Image: <outlet>" credit, links to the story like the headline, sends no referrer, and is replaced by the outlet's monogram tile if it fails to load. https only; SVGs, `data:` addresses and tiny or 1×1 images are refused.
- **Off switch:** every outlet in `data/news-sources.json` has `"images": true`. Setting it to `false` stops the picture for that outlet completely: nothing is read from its feed's image tags or its pages, and nothing is shown.
- **Why it is acceptable:** publishers put these images in their feeds and `og:image` tags precisely so that links to their stories are shown with a picture; news aggregators, search engines and social networks display them this way as a matter of course, and the picture sends readers to the publisher. It is a common practice, not a licence.
- **Residual risk:** (1) Many of these pictures are wire-service or agency photos (AP, Getty, Reuters) that the outlet licensed for its own use, and the agency may object to display elsewhere even as a thumbnail; the off switch and a prompt takedown are the answer, and a lawyer should look at it before launch. (2) A publisher can block hotlinking or rotate addresses at any time; the tile fallback covers that. (3) Privacy: loading a picture means the visitor's browser contacts the publisher's server or its image CDN (for example npr.brightspotcdn.com, i0.wp.com), which sees the visitor's IP address and browser, though not the Gatecast page (no referrer is sent). The brief's source line says pictures load from each outlet's site; the privacy note should say so too.

**Runner-up:** NewsData.io, whose state and city filter is only on its top plan (paid plans run roughly $200 to $1,300 a month). NewsAPI.org is about $449 a month and has no state filter.

## Both sides

**Recommended: build it from the record, not from news coverage.**

- **What was said:** the Congressional Record through the GovInfo API (free, public domain) and members' official press-release pages.
- **Who said it and their party:** the open `congress-legislators` dataset (public domain dedication).
- **The neutral line:** a figure from a federal statistics agency for the topic (for petrol prices, the Energy Information Administration), and any published fact-check through Google's Fact Check Tools API.
- **How it is shown:** one full, dated, linked quote from a named Democrat and one from a named Republican, on the same topic, from the same week. We do not paraphrase or grade either.

**Catches**

- The Congressional Record runs about a day behind.
- There is no maintained feed of members' press releases any more, so collecting those is ours to build.
- For state-level politics there is no equivalent record. State "both sides" would rely on statements quoted by the curated outlets above, which is weaker; start with national topics that matter locally.

**Where it is stored: the review queue**

The database is a Supabase project. Its definition is in `supabase/migrations/` and its functions in `supabase/functions/`; `supabase/README.md` explains each piece. The Today page reads published topics through the public key (`js/civic.js`), and reviewers work the queue in the reviewer console, `review.html`.

- `topics`: one neutral fact with its source link, a place (`US` or a state code) and a status of draft, published or rejected.
- `statements`: the quotes attached to a topic, each with a side, speaker, date and source link.
- `reviewers`: who may publish. The owner creates the account (Authentication → Users → Invite user), then adds a row in the Supabase SQL editor; it cannot be changed through the API.

Rules the database enforces, whichever key is used:

- Visitors can read published topics and their statements, and nothing else.
- Only a reviewer can publish a topic, or change, withdraw or delete a published one. The collection pipeline's secret key can write, edit and delete drafts but cannot touch anything published and cannot name a reviewer.
- A topic cannot be published without a statement from each side, and its statements cannot be added to, edited or removed while it is published. To correct one, set the topic back to draft, edit, and publish again.
- Every publish, withdrawal and deletion of a published topic is logged with who did it.

Tested on 16 Nov 2026 with placeholder rows, since deleted: as an anonymous visitor over the public API, and inside the database as a signed-in non-reviewer, a reviewer and a pipeline-style request. Not yet tested with a real signed-in reviewer account or the real secret key.

**The reviewer console (`review.html`)**

A small help desk for the queue, not linked from the site's navigation and marked `noindex`. Reviewers sign in with an emailed link (Supabase Auth; accounts must already exist, there is no sign-up). It lists drafts oldest first, shows each topic with its statements grouped by side, and offers Publish (blocked with a reason until a Democrat and a Republican statement are attached), Reject, Withdraw to draft and Delete; the database's own error is shown whenever it refuses. An assistant panel (Claude, through the `assist` Edge Function, see `docs/assist.md`) can check a topic, verify a quote against its source and draft candidate quotes from a page. It only fills forms; nothing is saved until the reviewer saves it.

Internal notes, a topic's publish history, hiding a single vote and the collector's health need `supabase/migrations/20261116090000_reviewer_console.sql`, which is written but not applied. Until then the console says so and works without them.

**Statehouse votes**

Separate from the queue, a collector copies passage votes from the public record:

- `state_votes`: one row per floor vote on a bill's passage, from Open States: the bill identifier and official title exactly as recorded, chamber, date, motion, result, totals and the split by party, with links to the official record and to Open States. Committee-sized votes, procedural motions, ceremonial resolutions and votes older than 120 days are left out. Gatecast adds nothing of its own.
- The `collect` Edge Function runs every hour at :07 (`pg_cron` job `collect-state-votes`), four states at a time, within 8 Open States requests a run and 400 a day. The Open States key is a Supabase secret.
- **The switch:** visitors see votes only while `private.switches` key `state_votes` is on. The owner turns it on or off in the SQL editor (`update private.switches set enabled = true where key = 'state_votes';`). One vote can be hidden with its `hidden` column.
- The Today page shows the visitor's state's six latest votes under "Your statehouse", and nothing at all when there are none or the switch is off.

**Runner-up:** licensing AllSides or Ad Fontes. Both rate news outlets as left, centre or right, which is a different thing from showing what each party said. AllSides needs a written licence for commercial use and publishes no price; Ad Fontes lists $3,600 a year for research use and quotes commercial use. Ground News has no public API.

## Tricks, food, trips, checklists, comparisons

**Tricks worth knowing.** Write our own. Facts and methods cannot be copyrighted, so an AI agent can write a short tip from several sources' facts, a person checks it, and we link what it was checked against. Pair with YouTube how-to embeds from a curated channel list. Do not use wikiHow, iFixit or Instructables text: they are non-commercial licences, and rewriting them with AI does not cure that.

**Food.** Spoonacular for recipes matched to the weather and season. TheMealDB is a cheaper fallback with a small catalogue. Ingredient lists are free to use anywhere; recipe prose and photos are not.

**Trips.** Wikivoyage and Wikidata for places, the US National Park Service API and Recreation.gov for outdoor trips, Geoapify for points of interest (3,000 free credits a day), and our own forecast data to answer "where is it warm this weekend". For flight prices, the options have narrowed: Amadeus closed its self-service API in July 2026 and Kiwi's is invitation-only, leaving Travelpayouts, whose affiliate terms still need reading.

**Season checklists.** Written by the agent from Ready.gov, FEMA, National Weather Service and CDC guidance, which are US government works and free to reuse. No agency logos and no implied endorsement. Red Cross material is for personal use only: link to it, never copy it.

**Here and there.** A small dataset we keep ourselves, checked by a person against each chain's official menu page for each country. Wikipedia's lists of regional menu items are a useful starting list (share-alike licence applies if text is copied).

## The agent that runs this

One small service, not five. It runs on a schedule and does the same four steps for every row:

1. **Collect** from the approved sources above (channel uploads, outlet feeds, the Congressional Record, government guidance).
2. **Filter** by fixed rules (source on the approved list, not age-restricted, has a date and place, matches the visitor's state or forecast).
3. **Draft** with an AI model, for the rows that are our own writing (the tip or checklist text). The model writes from extracted facts and keeps the link to each source. **Never for news:** headlines are shown as the outlet wrote them, Both sides quotes are full and verbatim, and no AI-written summary, headline or notification reaches readers. For Both sides the model only assists the reviewer (`docs/assist.md`).
4. **Queue for a person.** Nothing reaches the page without approval for camera videos, political quotes and safety content. Low-risk items (recipes, trip ideas) can publish automatically and be spot-checked.

What it needs that the site does not have today: a database for the queue and the approved content, a login for reviewers, and a scheduled job. The existing hosting can run all three.

## Licence traps to avoid

- **Non-commercial content on an ad-supported site.** wikiHow, iFixit, Instructables, AllSides ratings, Red Cross.
- **Share-alike text mixed into our own.** Keep anything copied from Wikivoyage or Wikipedia in its own credited block.
- **Database share-alike.** A dataset built from Open Food Facts or OpenStreetMap must be shared under the same terms.
- **Images.** They carry their own rights, separate from the text. An image link in a news feed is not permission. Use licensed photos, written permission, official portraits, or no image. **Exception decided by the owner on 16 November 2026:** in the brief's headlines, the publisher's own link-preview image (feed image or `og:image`) is shown as a hotlinked, credited thumbnail linking to the story, never copied or re-hosted, with a per-outlet off switch in `data/news-sources.json`. This follows common aggregator practice; the residual risks are wire-service photos inside those previews, publishers blocking hotlinking, and visitors' browsers contacting publisher image servers (see "State politics by location").
- **AI-written text is probably not protected by copyright**, so competitors may copy it. The protection is the service, not the words.

## Terms register for the brief's newsrooms

One row per outlet in `data/news-sources.json` (20, checked 16 November 2026). Gatecast shows only the headline, the outlet's name, the time, a link and the hotlinked preview image, so it does not republish any story; the register is for the day ads or sponsorship arrive, and for takedowns. "Images" is the outlet's `"images"` switch in `data/news-sources.json` (all on today).

**How far to trust this:** terms pages were looked for from this environment on 16 November 2026. Where a page was found and read, the row says what it says; where it was found but not read, or not found, the row says **unknown**. Nothing here is legal advice. Before any ads, read each page, and for "unknown" rows ask the outlet.

| Outlet | State | Terms or republishing page | Commercial use of the feed | Images | Notes |
|---|---|---|---|---|---|
| New York Focus | NY | Not found (site refused automated requests) | Unknown | On | Nonprofit newsroom; ask before ads |
| City & State New York | NY | `cityandstateny.com/about/terms-of-use/` (found, not read) | Unknown | On | Commercial publisher |
| WAMC | NY | Not found | Unknown | On | Public radio. Some public-media feeds are licensed for personal, non-commercial use only (NPR's archived permissions page, WNYC's terms); check WAMC's |
| New Jersey Monitor | NJ | Not read (site refused automated requests) | Unknown for the feed; **no ads against republished stories** | On | States Newsroom outlet. States Newsroom's republishing guidelines (as published by Maryland Matters) forbid selling ads against its stories. Linking out is not republishing, but keep sponsor lines away from these headlines until confirmed |
| NJ Spotlight News | NJ | Not found | Unknown | On | Public media (NJ PBS) |
| CalMatters | CA | `calmatters.org/about/republish/` (read) | Unknown for the feed | On | Republishing page says not to edit the article, "including the headline": we show headlines unedited |
| KQED | CA | Not found (site did not answer) | Unknown | On | Public radio; see the WAMC note |
| Ohio Capital Journal | OH | Not read (site refused automated requests) | Unknown for the feed; **no ads against republished stories** | On | States Newsroom outlet; see the New Jersey Monitor note |
| Statehouse News Bureau | OH | `ideastream.org/terms-of-use` (found, not read) | Unknown | On | Public radio (Ideastream); see the WAMC note |
| The Texas Tribune | TX | `texastribune.org/republishing-guidelines/` and `/terms-of-service/` (found, not read in full) | Unknown | On | Nonprofit newsroom |
| KUT News | TX | `kut.org/privacy-terms-of-use` (read; nothing on feeds found) | Unknown | On | Public radio; see the WAMC note |
| Florida Phoenix | FL | Not read (site refused automated requests) | Unknown for the feed; **no ads against republished stories** | On | States Newsroom outlet; see the New Jersey Monitor note |
| WFSU News | FL | Not found | Unknown | On | Public radio; see the WAMC note |
| Capitol News Illinois | IL | `capitolnewsillinois.com/media-center/republish-guidelines/` and `/about-us/terms/` (read) | Unknown for the feed | On | News organisations may republish in full under CC BY-ND 4.0 |
| NPR Illinois | IL | Not found | Unknown | On | Public radio; see the WAMC note |
| Pennsylvania Capital-Star | PA | Not read (site refused automated requests) | Unknown for the feed; **no ads against republished stories** | On | States Newsroom outlet; see the New Jersey Monitor note |
| Spotlight PA | PA | Not found | Unknown | On | Nonprofit newsroom |
| Yale Climate Connections | national | `yaleclimateconnections.org/use-policy/` (read) | **Non-commercial** licence for republishing (CC BY-NC-ND 4.0); images excluded | On | Headline-and-link is not republishing, but the licence is non-commercial: confirm before ads. Its use policy says images are not covered, which is a reason to consider switching its pictures off |
| NOAA | national | Not read (site refused automated requests) | US government work, generally public domain | On | Some NOAA images are credited to third parties and keep their own rights |
| Simple Flying | national | `valnetinc.com/en/terms-of-use` (found, not read) | Unknown | On | Commercial publisher (Valnet) |

## To verify before launch

1. YouTube API terms on showing ranked view counts and on ads beside embeds.
2. Spoonacular's current price and data-retention terms.
3. States Newsroom's republishing terms as they apply to headline-and-link display, and every "unknown" row in the terms register above.
4. The display format for news and quotes, with a media lawyer, including the hotlinked preview images and what to do when a wire service objects.
5. Travelpayouts' affiliate terms, if flight prices are wanted.

## Weird news

The front page's weird news (`/api/weird`, `lib/weird.js`). Same display rule as the brief: the outlet's own headline, its name, the time, a link to the story and the outlet's own preview picture, never its description or article text. Headlines are shown as written; the only change is that UPI's "Watch:" and "Look:" labels are taken off the front, and "Watch:" turns on the video label.

**Sources** (`data/weird-sources.json`, from the scout's research of 16 November 2026). The build environment could not reach any of them; the lead checked each on a Vercel preview with `/api/weird?debug=1` on 16 November 2026, which lists each feed's HTTP status, error class, items read, the feed's own category labels, and how many stories were too old, filtered, listicles, held by moderation, too ordinary (below the weirdness minimum), kept and shown. Each entry's `checked` note records the result.

| Outlet | Feed | Pictures | Terms for commercial use | Notes |
|---|---|---|---|---|
| UPI (Odd News) | `rss.upi.com/news/odd_news.rss` | On | Unknown | Wire odd-news desk; previews are often agency photos |
| Sky News (Offbeat) | `feeds.skynews.com/feeds/rss/strange.xml` | On | Unknown | Works, but nothing from the past 14 days on 16 Nov (marked stale; kept) |
| Smithsonian Magazine (Smart News) | `smithsonianmag.com/rss/smart-news/` | On | Unknown | Archaeology stories with human remains are held |
| Atlas Obscura (Articles) | `atlasobscura.com/feeds/articles` | On | Unknown | |
| ScienceDaily (Strange & Offbeat) | `sciencedaily.com/rss/strange_offbeat.xml` | Off | **Allowed with credit** (terms of 7 Jan 2026) | Ask whether headline-and-link meets its "do not alter or fail to display content" clause |
| Mental Floss | `mentalfloss.com/feed` | On | Unknown | Shopping posts, listicles, quizzes and evergreen explainers are filtered out; at most 3 |
| Live Science | `livescience.com/feeds.xml` | On | Unknown | General feed, filtered to its animal, archaeology, planet and strange-news sections; at most 3 |
| SoraNews24 | `soranews24.com/feed/` | On | Unknown | General feed; only stories with a weirdness signal; at most 2 |
| Oddity Central | `odditycentral.com/feed` | Off | Unknown | Review outlet: high risk. Nothing from the past 14 days on 16 Nov (marked stale; kept) |
| NDTV (Offbeat) | `feeds.feedburner.com/ndtvnews-offbeat-news` | Off | Unknown | Review outlet: high risk. **Disabled**: the old address was not a feed; this one, listed by a third-party reader, is unconfirmed. Read for `?debug=1` only until it shows ok |

Left out on purpose: the Guardian and NPR (their feed terms are personal, non-commercial use only), Google News (same), AP and Reuters (no public feeds; licensed only), and tabloid "WTF" sections without feeds.

**What we show and in what order.** Up to 60 stories (30 by default): the editor's picks first, newest first; then the regular outlets' stories from the past 14 days, newest day first and, within a day, the strangest first; then the review outlets' stories the same way, at most 3 of them. At most 8 feed stories per outlet, fewer for general outlets (Smithsonian, Atlas Obscura, Mental Floss and Live Science 3, SoraNews24 2, ScienceDaily 4). The same address or a near-identical headline appears once, and tracking parameters (`utm_*` and the like) are removed from links. Nothing is ranked by clicks or popularity, and nothing is counted.

**Weirdness.** UPI's Odd News desk runs as published. Every other outlet's story must show a sign of strangeness, scored the same way every time from its headline, address and the outlet's own labels (`weirdness()` in `lib/weird.js`): a record, mystery or oddity words, the outlet's own "weird" label or section, an animal loose or somewhere it shouldn't be (a bus, a soccer game, an airport), a quoted phrase, an unusual number ("3,000 tarantulas"), or a twist ("turns out to be"). Offbeat sections need a score of 1, general feeds 2. The same score orders each day's stories. It is a heuristic, not a judgment of quality, and it only ever leaves stories out or reorders them within a day. Each story gets one category (Weird People, Strange Animals, Odd Laws, World Records, Unexplained, Weird Weather or Other) from the feed's own label when the outlet's entry maps it, else from words in the headline and address. Pictures follow the brief's rules: the feed's preview image or the article page's `og:image`, hotlinked and credited "Image: <outlet>", per-outlet off switch.

**Moderation** (`lib/moderation.js`, adapted from `docs/moderation-policy.md`). The test: is the strangeness in the situation, or in a person's misfortune? Only the first runs. The rules read the headline, the words of the story's address and the feed's category labels, and nothing else. Rules H1 to H11 hold deaths, injuries, illness, outbreaks and medical treatments, animal cruelty and rescues, mental illness, children, mocking disabled, poor, fat or old people, private people gone viral, crime and court, disasters, and witchcraft or curses aimed at people. Sexual content and any child with a crime word are dropped outright. There is no review queue yet, so a held story is simply not shown; nothing is published by the rules, they only remove. A clip of an animal or the sky "caught on camera" passes when no person is named. `?debug=1` shows how many stories each rule held, never which ones.

**Review outlets** (Oddity Central, NDTV): their stories appear only when they pass every rule, always below the regular outlets, at most 3 at a time, and without pictures. The scout recommended holding every item from them for a person; until a queue exists this is the compromise, and either can be removed from the list at any time.

**Editor's picks** (the reviewer database's `weird_picks` table, read with the public key through `lib/picks-db.js`, plus `data/weird-picks.json`). Stories the owner chooses, shown first for 21 days from their date. Picks published in the database were approved by a reviewer and count as reviewed; on the same address the database's version wins over the file's. If the database is unreachable or the table does not exist yet, the file's picks are shown alone. A database pick without a date cannot be placed in the 21-day window and is not shown. A pick may carry the owner's rating (1 to 5) and one-line note; nobody else writes those, and the seeded picks have neither. The 13 seeded picks are real UPI stories found by the designer, marked `"seeded": true`: they go through every moderation rule, and two of them are held for now ("Sheep on the lam ... roped by 13-year-old cowgirl", rule H5 children; "Runaway parakeet rescued from storm drain", rule H3 rescues). When the owner has looked at a pick, they set `"seeded": false`; the hold rules then defer to that decision, while the drop rules still apply. A pick has a picture only when the outlet's feed carries the same story with one. Its date is shown as noon UTC so it reads as the right day everywhere.

**To verify before launch:** the NDTV address, and Live Science's labels against its filter, on a preview (`/api/weird?debug=1`); the terms of every "unknown" outlet before ads; ScienceDaily's answer on headline-and-link; and a week of held counts, to see whether rules such as H3 "rescued from" and H10 "missing" hold too much.

---

Reviewer console: [`review.html`](../review.html) (not linked from the site's navigation).
