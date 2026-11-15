# Content sources for Gatecast

Where each content row can get its material, what it costs, and what could go wrong. This summarises three research notes in `docs/research/`, which carry the links and a confidence tag for every claim.

**How far to trust this:** the research was done from search results, not by opening the vendors' own pages (they were unreachable from the build environment). Prices and licence terms below need checking on the primary pages before any money or launch decision. Legal points need a media lawyer.

## Recommendation at a glance

| Row | Use | Cost | Biggest catch |
|---|---|---|---|
| Caught on camera | YouTube embeds from an approved list of official police, sheriff and transport channels plus a few vetted publishers, ranked by YouTube's own view counts | Free | Age-restricted videos cannot play on other sites, so many serious-incident videos are unavailable (which the moderation policy excludes anyway) |
| State politics | A hand-picked list of statehouse news outlets per state, read through their own feeds, shown as headline, our own one-line summary and a link | About $0 | Nobody sells real "most read" data; rank by our own clicks |
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
- Show the headline, a one-line summary we write ourselves, the outlet's name and a link. Do not copy their opening paragraph or description, and do not use their images without permission.
- For "most read", use our own click counts. As a starting signal before we have traffic, GDELT (free, commercial use allowed with credit) shows how widely a story is being covered.
- Open States (free key) adds what is actually moving in the state legislature: bills, votes and who sponsored them, with party.

**Catches**

- States Newsroom allows republishing, but not selling ads against its stories. Linking out, as above, avoids the problem.
- Bing's news API was retired in August 2025 and Google News feeds are for non-commercial use, so neither is an option.

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
3. **Draft** with an AI model: the one-line summary, the neutral headline, the question that follows a story, the tip or checklist text. The model writes from extracted facts and keeps the link to each source.
4. **Queue for a person.** Nothing reaches the page without approval for camera videos, political quotes and safety content. Low-risk items (recipes, trip ideas) can publish automatically and be spot-checked.

What it needs that the site does not have today: a database for the queue and the approved content, a login for reviewers, and a scheduled job. The existing hosting can run all three.

## Licence traps to avoid

- **Non-commercial content on an ad-supported site.** wikiHow, iFixit, Instructables, AllSides ratings, Red Cross.
- **Share-alike text mixed into our own.** Keep anything copied from Wikivoyage or Wikipedia in its own credited block.
- **Database share-alike.** A dataset built from Open Food Facts or OpenStreetMap must be shared under the same terms.
- **Images.** They carry their own rights, separate from the text. An image link in a news feed is not permission. Use licensed photos, written permission, official portraits, or no image.
- **AI-written text is probably not protected by copyright**, so competitors may copy it. The protection is the service, not the words.

## To verify before launch

1. YouTube API terms on showing ranked view counts and on ads beside embeds.
2. Spoonacular's current price and data-retention terms.
3. States Newsroom's republishing terms as they apply to headline-and-link display.
4. The display format for news and quotes, with a media lawyer.
5. Travelpayouts' affiliate terms, if flight prices are wanted.
