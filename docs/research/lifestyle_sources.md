# Lifestyle content sources for a weather site: research notes

Date of research: 15 November 2026. Method: 18 web searches. Page fetches were blocked in this
sandbox (themealdb.com and wikihow.com both failed), so nothing below was read from a primary page.

Evidence tags used throughout:

- **[snippet]** = taken from a search-result snippet in this session (secondary; verify on the primary page before contracting).
- **[prior]** = from the researcher's background knowledge (cutoff mid-2026), NOT re-checked in this session.
- **[unconfirmed]** = sources disagree or no source found.

This is not legal advice. Licence conclusions need a lawyer's sign-off before launch.

---

## 0. Headline findings that change the brief

1. **Amadeus Self-Service APIs are gone.** Keys were disabled on 17 July 2026; only the Enterprise portal remains, with access terms unclear. Flight Inspiration Search and Cheapest Date Search are therefore not available on a self-serve basis. [snippet]
   - https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
   - https://skift.com/2026/09/03/amadeus-brings-travel-tech-into-claude/
   - https://github.com/amadeus4dev (organisation archived 17 Jul 2026)
2. **Kiwi Tequila is invitation-only** for new partners (closed to self-serve sign-up in May 2024). [snippet]
   - https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/
3. **wikiHow reportedly moved new text to a proprietary licence on 24 March 2025**; older text was CC BY-NC-SA 3.0. Source is Wikipedia's infobox and mirrors, not wikiHow's own terms. Either way it is unusable on an ad-supported site. [snippet, primary unconfirmed]
   - https://en.wikipedia.org/wiki/WikiHow
4. **American Red Cross content is licensed for personal, non-commercial use only**; reproduction needs advance written permission. Link to it, do not copy it. [snippet]
   - https://www.redcross.org/terms-of-use.html
   - https://www.redcross.org/take-a-class/terms-of-use.html

---

## 1. "Tricks worth knowing" (short how-to tips, ideally short video)

| Source | What it provides | API / feed | Price | Licence for commercial display | Quality / verdict |
|---|---|---|---|---|---|
| **AI-written original tips** grounded in US-government guidance and plain facts | Short text tips keyed to forecast (frost, heat, humidity, pollen, storm) | Own pipeline | Model cost only | Own content. Facts and methods are not copyrightable; US federal works are public domain (17 U.S.C. 105) [snippet for 105] | Best fit: fully controllable, weather-aware. Needs human review for anything safety-related. **Top pick.** |
| **YouTube Data API v3 + embedded player** | Search for short how-to videos; embed in the standard player | Yes. `search.list` costs 100 quota units; default quota 10,000 units/day [prior] | Free; quota extension requires a compliance audit [snippet] | Embedding allowed only through the YouTube player. Rules [snippet]: player at least 200x200 px; no overlays or modified player; autoplay only when more than half visible and one autoplaying player per page; must send HTTP Referer; must not block ads that YouTube would serve; no nested iframes to hide the source. Stored API data must be refreshed or deleted after 30 days [snippet, third-party]. Do not sell ads against a page that is only YouTube content [prior]. | Huge supply; quality varies, so curate channel allow-lists. No reliable "is a Short" filter in the API [prior] (use `videoDuration=short` and check duration). **Runner-up / companion to the text tips.** |
| **Pexels API** (stock video) | Free stock clips usable as B-roll for self-produced shorts | Yes. 200 requests/hour, 20,000/month; limit increases paused [snippet] | Free | Free for commercial use under Pexels licence; API requires a prominent link to Pexels; no dataset building or model training; no model/property releases guaranteed [snippet] | Not how-to content in itself; raw footage only. |
| Pixabay API | Similar stock video | Yes [prior] | Free [prior] | Pixabay Content Licence, commercial OK, no hot-linking of images long-term [prior, unconfirmed] | Same role as Pexels. |
| Storyblocks API / Shutterstock / Getty | Licensed stock video libraries | Yes, enterprise | Quote-based [unconfirmed] | Commercial licence by contract | Stock, not tips. |
| Jukin / Storyful / Newsflare | Licensed viral and user-generated clips | Feeds by contract | Quote-based [unconfirmed] | Commercial licence by contract | Only option for "licensed short how-to video" at scale; expensive. |
| wikiHow | Illustrated how-to articles | No official public API (only unofficial wrappers) [prior] | n/a | CC BY-NC-SA 3.0 for older text; reportedly proprietary since 24 Mar 2025 [snippet] | **Avoid.** Non-commercial clause conflicts with an ad-supported site. |
| Instructables | DIY projects | No official public API [prior] | n/a | Licence chosen per author; default CC BY-NC-SA [prior, unconfirmed] | **Avoid** for copying; link out only. |
| iFixit API | Repair guides | Yes, open REST API v2.0 [prior] | Free | Guides CC BY-NC-SA 3.0; commercial licensing by arrangement with iFixit [snippet for licence page, prior for detail] | **Avoid** on ad-supported pages unless a commercial licence is negotiated. Repair is also off-topic for weather. |

Sources:
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/terms/revision-history (mentions a 4 May 2026 update on quota extension requests)
- https://www.pexels.com/api/documentation/
- https://help.pexels.com/hc/en-us/articles/900005851863-Do-I-have-to-pay-for-higher-limits
- https://www.ifixit.com/Info/licensing
- https://en.wikipedia.org/wiki/WikiHow

---

## 2. Food and recipes suited to the weather or season

| Source | What it provides | API / feed | Price | Licence / terms | Quality / verdict |
|---|---|---|---|---|---|
| **Spoonacular** | Large recipe database, complex search by dish type, cuisine, diet, ingredients; nutrition | Yes, points-based | Free 150 points/day; paid from about $29/month (plans: Cook, Culinarian, Chef, Enterprise) [snippet, third-party aggregator] | Free plan requires a backlink; paid plans remove it [snippet, competitor page]. All data must be deleted if access ends [snippet]. Caching limits not confirmed [unconfirmed] | Most complete self-serve option. No "season" field: map weather to tags yourself (soup, stew, grill, salad, cold drinks). **Top pick for an API.** |
| **TheMealDB** | Small crowd-sourced recipe set with images and YouTube links | Yes, simple JSON | Test key free for development; supporter key for production, reported as about GBP 10 lifetime [snippet, aggregator; unconfirmed on primary] | Credit requested; official terms page not read [unconfirmed] | Cheap and easy but small catalogue and uneven quality. **Runner-up for a prototype.** |
| Edamam | Recipe search that links out to publisher sites; nutrition and diet labels | Yes | Plans reported from $69/month up to $1,499/month enterprise; older Recipe Search tiers retired [snippet, mixed sources] | Attribution with link required on all plans; caching heavily restricted (cannot build a copy of the data or your own recipe search); Edamam does not hold recipe copyrights [snippet] | Good for a "link out to the original recipe" model; costly and restrictive. |
| Tasty / BuzzFeed | Video recipes | No official API; RapidAPI listing is unofficial [prior, unconfirmed] | n/a | No licence for reuse | **Avoid.** Embed their YouTube videos instead. |
| USDA FoodData Central | Nutrition data for foods, not recipes | Yes, free key via api.data.gov [prior] | Free | CC0 / public domain [prior] | Supporting data only. |
| Open Food Facts | Packaged-product database (barcodes, ingredients, Nutri-Score) | Yes, plus full dumps | Free | Database under ODbL, contents under DbCL, product images CC BY-SA [prior; licence tutorial URL below seen in results] | Not recipes. Share-alike applies to derived databases. |
| Wikibooks Cookbook | Community recipes | MediaWiki API and dumps | Free | CC BY-SA 4.0: attribution plus share-alike on adapted text [prior] | Uneven quality, few photos. Usable if the recipe block is labelled CC BY-SA. |
| schema.org Recipe markup on third-party sites | Structured recipes on publisher pages | Scrape JSON-LD | Free technically | See below | Legally risky as a bulk source. |
| **AI-written original recipes** | Seasonal recipes written in own words | Own pipeline | Model cost | Own content | Viable; needs own or licensed photos and a cook's sanity check. |

Is aggregating schema.org Recipe data permitted?
- Copyright: a bare ingredient list and functional method steps are generally not protected in the US; headnotes, descriptive prose and photos are. [snippet: NYC Bar, Copyright Alliance]
- That does not make aggregation safe: site terms of service (contract), the EU sui generis database right, and photo copyright still apply. No source found that addresses these for recipe scraping. [unconfirmed]
- Safe pattern: show title, own short summary and a link to the publisher; never copy prose or photos; honour robots.txt and terms.

Sources:
- https://apis.io/plans/spoonacular/spoonacular-plans-pricing/
- https://marketplace.apilayer.com/spoonacular-api
- https://themealdb.com/documentation
- https://rapidapi.com/uk/thecocktaildb/api/themealdb/pricing
- https://developer.edamam.com/recipe-content-management-api
- https://developer.edamam.com/meal-planner-api
- https://developer.edamam.com/api/faq
- https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side
- https://www.nycbar.org/?p=4816
- https://copyrightalliance.org/?p=5875

---

## 3. Trips and vacation suggestions (weekend trips nearby, where it is warm now)

| Source | What it provides | API / feed | Price | Licence / terms | Quality / verdict |
|---|---|---|---|---|---|
| **Wikivoyage** | Destination guides, listings with coordinates, "understand / see / do" text | MediaWiki API and full database dumps | Free | Text CC BY-SA 4.0: attribute (link to the article is sufficient), state the licence, and release adapted text under CC BY-SA. Images licensed individually. [snippet] | Best open travel text. **Top pick**, combined with the site's own climate and forecast data to answer "where is it warm now". |
| **Wikidata / Wikipedia** | Coordinates, population, images, summaries | SPARQL, REST, dumps | Free | Wikidata CC0; Wikipedia text CC BY-SA 4.0 [prior] | Use Wikidata for the destination gazetteer. |
| **US National Park Service API** | Parks, alerts, campgrounds, things to do, images | Yes, free key; over-limit keys blocked for one hour (HTTP 429) [snippet]. Numeric limit not confirmed (1,000 requests/hour [prior]) | Free | US government data; see NPS disclaimer page; third-party images may carry credits [snippet, partial] | Excellent for US weekend trips. **Runner-up (US).** |
| Recreation.gov RIDB | Federal recreation sites, campgrounds, permits | Yes, free key and bulk download [prior] | Free | US government data [prior; not confirmed this session] | Good complement to NPS. |
| Geoapify Places | OSM-based points of interest, isolines for "within 2 hours' drive" | Yes | Free 3,000 credits/day, up to 5 requests/second, no card [snippet]; paid tiers [not confirmed] | OSM attribution (ODbL); commercial use on free tier not confirmed [unconfirmed] | Cheapest POI and drive-time option. |
| Foursquare Places | Commercial POIs with categories and ratings | Yes | Official page: Pro endpoints $18.75 per 1,000 calls (0 to 100k), $15.00 (100k to 500k), $11.25 above. Free allowance disputed: 10,000 free Pro calls/month vs $200 credit vs non-commercial only [unconfirmed]. Pricing changed 1 June 2026 [snippet] | Contract terms | Good data; verify the free tier. |
| Google Places API (New) | Best POI coverage, photos, ratings | Yes | Pay per SKU with monthly free caps [prior] | No caching beyond place IDs; Google attribution required; restrictions on showing content with non-Google maps [prior] | Expensive and restrictive for editorial listings. |
| OpenTripMap | Tourist POIs from OSM and Wikidata | Yes [prior] | Free tier [prior] | ODbL [prior] | No results found this session; service status and terms unconfirmed. |
| Travelpayouts (Aviasales) Data API | Cached flight prices, cheapest and popular destinations from an origin | Yes | Free with affiliate registration; cached data [snippet, third-party] | Affiliate terms not read [unconfirmed] | Only practical self-serve replacement for "flight inspiration". Earns affiliate revenue. |
| Amadeus Self-Service | Flight Inspiration, Cheapest Dates | **Shut down 17 July 2026** [snippet] | n/a | Enterprise contract only | Not available. |
| Kiwi Tequila | Flight search | Invitation-only since May 2024 [snippet] | n/a | Partner contract | Not available to a new site. |
| Skyscanner Travel API | Flight prices | Partner-only, approval about two weeks [snippet] | Partner | Partner contract | Possible later, once traffic exists. |
| National / state tourism boards | Editorial guides, events, images | Mostly none; a few open-data portals [prior] | Varies | Copyright reserved by default; ask for permission or a content partnership | Case by case; good for partnerships, not for automated ingestion. |

Sources:
- https://en.wikivoyage.org/wiki/Wikivoyage:How_to_re-use_Wikivoyage_guides
- https://www.nps.gov/subjects/developer/guides.htm
- https://geoapify.com/pricing
- https://foursquare.com/pricing/
- https://support.travelpayouts.com/hc/en-us/articles/203956163
- https://zuplo.com/learning-center/travelpayouts-api
- https://airlabs.co/amadeus-self-service-api-shutdown
- https://ignav.com/docs/kiwi-tequila-alternative (vendor page, biased)

---

## 4. Seasonal preparation checklists (winter, hurricane, heat, wildfire, storm)

| Source | What it provides | API / feed | Price | Licence / terms | Quality / verdict |
|---|---|---|---|---|---|
| **Ready.gov / FEMA** | Hazard-by-hazard preparedness guidance, kits, plans | Web pages and PDFs; OpenFEMA API for data, not prose [prior] | Free | US government works, not subject to US copyright (17 U.S.C. 105). The Ready word-mark and logos are US-government trademarks. Current reuse page not retrieved; only 2008-2009 archive seen. [snippet + prior] | Authoritative. **Top pick as the grounding source.** |
| **National Weather Service safety pages** (weather.gov/safety) | Hazard safety tips; alerts via api.weather.gov | Free alerts API [prior] | Free | Not copyrighted, but: no implied NOAA/NWS endorsement; if a page consists mostly of NWS material, 17 U.S.C. 403 requires a notice that it is NWS material; third-party files on NWS sites may be copyrighted [snippet] | Authoritative and already tied to alert types. **Runner-up / co-source.** |
| CDC | Extreme heat, cold, smoke, post-storm health guidance | Content syndication service [prior] | Free | Agency materials generally free to use; CDC asks that substance not be altered and that no endorsement is implied [snippet] | Best for health angles. |
| NOAA | Climate, hurricane and drought education | Various | Free | NOAA-created media not copyrighted; no endorsement; third-party media excluded [snippet] | Supporting source. |
| American Red Cross | Checklists, first-aid guidance | None | n/a | Personal, non-commercial use only; no reproduction without advance written permission; emblem and name are trademarks [snippet] | **Do not copy. Link out only.** |
| Non-US governments | Local guidance | Web | Free | UK: Open Government Licence v3 permits commercial reuse with attribution. Canada and Australia: Crown copyright, commercial reuse may need permission. [prior, unconfirmed] | Needed if visitors are outside the US. |

Caveats:
- US state and local government works are not automatically public domain. [prior]
- Contractor-made or third-party images on .gov pages may be copyrighted. Prefer text; use own illustrations.

Sources:
- https://www.weather.gov/disclaimer
- https://www.cdc.gov/other/agencymaterials.html
- https://sos.noaa.gov/copyright
- https://resources.data.gov/open-licenses/
- https://www.redcross.org/terms-of-use.html
- https://webarchive.library.unt.edu/web/20081107060549/http:/www.ready.gov/america/other/notices.html (archived Ready.gov terms)

---

## 5. "Here vs there" comparisons (fast-food menus by country)

| Source | What it provides | API / feed | Price | Licence / terms | Quality / verdict |
|---|---|---|---|---|---|
| **Own curated dataset**, drafted by an AI agent from official country menu pages and checked by a human | Item name, country, short original description, source link, date checked | Own | Staff and model time | Menu facts (that an item exists, its price) are not copyrightable. Use brand names descriptively; no logos or official product photos. [prior] | Only reliable route. **Top pick.** |
| **Wikipedia lists of regional menu items** | Regional items by chain and country | MediaWiki API, dumps | Free | CC BY-SA 4.0. Reusing the facts is free; copying or adapting the text or tables requires attribution and share-alike for that block. [prior] | Good seed list, often outdated; verify against official sites. **Runner-up / seed source.** |
| Official chain menus | Current items and prices per country | McDonald's has no public API [per brief; not re-checked]; country sites and apps only | n/a | Site terms usually prohibit scraping; photos and logos protected | Use as a fact-check reference and link target, by hand. |
| Nutritionix | US restaurant and branded-food nutrition | Yes | Described as freemium by directories; real pricing and restaurant-data access not confirmed [unconfirmed] | Commercial terms by plan | US-centric, so weak for cross-country comparison. |
| Open Food Facts | Packaged groceries worldwide | Yes, dumps | Free | ODbL / DbCL / images CC BY-SA [prior] | Good for "same snack, different country" comparisons, not restaurant menus. |
| The Economist Big Mac Index data | Big Mac price by country | GitHub CSV | Free | Data reported as CC BY 4.0 [prior, unconfirmed] | Nice add-on for a price comparison. |

Sources:
- https://apis.io/providers/nutritionix/
- https://publicapis.io/alternatives/nutritionix-api

---

## 6. Is AI-written content grounded in public-domain and open sources viable and lawful?

Short answer: yes, and it is the recommended backbone for sections 1, 4 and 5, with conditions.

Why it is lawful in principle:
- Facts, ideas, procedures and methods are not protected by copyright; only the expression is. An agent that writes new wording from facts does not copy protected expression.
- US federal government works are not subject to copyright in the US (17 U.S.C. 105), so they may even be quoted directly. [snippet: resources.data.gov]

Conditions and risks:
1. **Do not paraphrase closely.** A near-sentence-by-sentence rewrite of a copyrighted or CC-licensed page can still be an adaptation. Instruct the agent to work from extracted facts, and store the source URL per tip.
2. **Safety accuracy.** Checklists for hurricanes, heat and wildfire are life-safety content. Keep the substance identical to the government source (CDC explicitly asks for this), have a human approve, date-stamp, and link to the source.
3. **No implied endorsement.** Do not use FEMA, Ready, NWS, NOAA or Red Cross logos or phrasing such as "official". [snippet]
4. **17 U.S.C. 403.** If a page is mostly US-government material, add a notice identifying it as such. [snippet]
5. **AI output is probably not copyrightable** in the US without meaningful human authorship (US Copyright Office report, January 2025; Thaler v. Perlmutter, D.C. Circuit 2025). Lawful to publish, but competitors may copy it. [prior, not re-checked]
6. **AI disclosure.** The EU AI Act has transparency duties for AI-generated public-interest text unless a human holds editorial responsibility. [prior, unconfirmed; check current timing]
7. **Attribution line** per item, for example: "Based on guidance from Ready.gov and the National Weather Service. Not affiliated with or endorsed by either."

## 7. Licence traps to avoid

| Trap | Why it matters | Affected sources |
|---|---|---|
| **NonCommercial (NC) content on an ad-supported site** | NC means not primarily intended for commercial advantage or monetary compensation; ad-supported use is widely treated as commercial (CC's own 2009 study: about 83 to 85 of 100 rated it commercial). [snippet] | wikiHow (older text), iFixit, most Instructables, Red Cross (its own non-commercial terms) |
| **Feeding NC content to the AI agent to rewrite** | A rewrite is an adaptation and inherits NC and SA. | Same as above |
| **ShareAlike (SA)** | Text copied or adapted from CC BY-SA must itself be offered under CC BY-SA with attribution. It covers that block, not the whole site, provided the block stays separable (a collection, not a merged work). You cannot put extra restrictions on it in your terms of use. | Wikivoyage, Wikipedia, Wikibooks, Open Food Facts images |
| **Mixing BY-SA with BY-NC** | The two cannot be remixed into one work. [snippet: CC wiki] | Any combined article |
| **ODbL share-alike on databases** | A derived database that mixes ODbL data with your own must be offered under ODbL; produced works (pages, maps) only need attribution. | Open Food Facts, OpenStreetMap-based POIs (Geoapify, OpenTripMap) |
| **Per-image licences** | Text licence does not cover images. | Wikivoyage, Wikipedia, NWS and NPS pages with third-party photos |
| **API terms on caching and deletion** | Storing results to build your own copy is often forbidden; data must be deleted on termination. | Edamam, Spoonacular, Google Places, YouTube (30-day refresh) |
| **Embedding is not licensing** | YouTube embeds are allowed only in the unmodified player, with YouTube's ads intact. | YouTube |
| **Trademarks and endorsement** | Logos and names of agencies and restaurant chains may be used descriptively only. | FEMA, NWS, Red Cross, McDonald's and other chains |
| **Scraped recipe prose and photos** | Ingredient lists are free; headnotes and photos are not; site terms may forbid scraping. | schema.org Recipe aggregation, Tasty |

Sources:
- https://wiki.creativecommons.org/wiki/4.0/NonCommercial
- https://wiki.creativecommons.org/NonCommercial_interpretation
- https://www.boingboing.net/2009/09/14/results-of-creative.html

---

## 8. Recommended stack and rough cost

| Section | Primary | Runner-up | Approximate cost |
|---|---|---|---|
| 1 Tricks | AI-written tips from public-domain guidance, plus curated YouTube embeds | Self-produced shorts using Pexels B-roll; licensed clip libraries by quote | Free apart from model and review time |
| 2 Recipes | Spoonacular paid plan | TheMealDB supporter key, or AI-written original recipes with own photos | About $29/month and up [snippet]; TheMealDB about GBP 10 one-off [unconfirmed] |
| 3 Trips | Wikivoyage + Wikidata + own climate and forecast data | NPS API and RIDB (US); Geoapify for POIs and drive-time; Travelpayouts for prices | Free; Geoapify free up to 3,000 credits/day |
| 4 Checklists | AI-written from Ready.gov, FEMA, NWS, CDC | Direct quotation of the same public-domain pages | Free |
| 5 Here vs there | Own curated dataset, human-checked | Wikipedia regional-menu lists as a seed (CC BY-SA) | Staff time |

## 9. Items still to verify on primary pages before launch

- wikiHow current Terms of Use (licence change of 24 March 2025).
- Spoonacular terms: caching period, backlink rule, current plan prices.
- TheMealDB terms of use and supporter-key price.
- Foursquare free allowance after the 1 June 2026 pricing change.
- Geoapify free-tier commercial-use conditions and paid-tier prices.
- OpenTripMap service status and terms.
- Travelpayouts Data API affiliate terms and rate limits.
- Current Ready.gov reuse statement; NPS API disclaimer and numeric rate limit; RIDB terms.
- Nutritionix pricing and restaurant-data access.
- YouTube: current wording on advertising around embedded players and on data-storage limits.
- Instructables default licence; iFixit commercial licence route.
- US Copyright Office position on AI output and EU AI Act transparency timing.
