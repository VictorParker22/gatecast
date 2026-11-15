# News data sources for "State politics by location" and "Both sides"

Research date: 15 Nov 2026. Method: 18 web searches plus 3 successful page fetches (GitHub only).
Most vendor sites could not be opened from this sandbox (newsfromthestates.com, newsdata.io,
docs.openstates.org and theconversation.com all failed to resolve), so most vendor facts come from
search-result snippets, often from third-party comparison sites.

Confidence tags used on every claim:

- **[fetched]** I opened the page and read it.
- **[snippet]** from a search-result summary only; not opened. Verify before signing anything.
- **[prior]** from my own background knowledge, NOT confirmed in this session. Treat as a lead.
- **[unconfirmed]** I looked and could not find or verify it.

Nothing here is legal advice. Prices change; every price below needs a check on the vendor's own page.

---

## 1. Short answer

### Section 1: State politics by location

- **Best**: a curated list of statehouse outlets per state (start with the States Newsroom outlet for
  each state, add the public-radio statehouse desk and one or two major papers), read through each
  outlet's own RSS feed, shown as headline + short summary written by us + link out. Rank by how many
  outlets cover the same story (GDELT is free for this) and by our own click data. Add Open States
  for "bills moving in your state" as the neutral, licence-free layer.
- **Runner-up**: a paid news API with a real state filter. NewsData.io has a `region` parameter
  (state or city) but only on its top "Corporate" plan [snippet]. NewsCatcher's Local News API is
  built for this (GeoNames place filtering) but is sales-quoted [snippet, price unconfirmed].
- **Gap nobody fills**: no source sells true "most-read" numbers. "Most read" has to be our own
  clicks, or a proxy such as number of outlets covering the story.

### Section 2: Both sides

- **Best**: build it from primary sources. Congressional Record through the GovInfo API (free) +
  members' official press-release feeds + party labels from the `unitedstates/congress-legislators`
  dataset (CC0). Show verbatim, dated, linked quotes per named member, e.g. "Sen. X (R-TX)". Neutral
  facts from government statistics (EIA for gas prices, BLS) and fact-checks from the Google Fact
  Check Tools API.
- **Runner-up**: license AllSides (bias ratings and balanced headline roundups). It labels outlets
  Left/Center/Right, which is not the same thing as "what Democrats said". Commercial use needs a
  written licence; no public price.

---

## 2. Candidate table

| Source | What it gives | API / feed | Price | Licence for commercial display | US state coverage | Party / bias labels |
|---|---|---|---|---|---|---|
| States Newsroom (News From The States + state outlets) | Original statehouse reporting | Outlet sites; RSS [prior, unconfirmed] | Free | Republish allowed with credit + link, but "no selling ads against it", no paywall [snippet] | Outlets in most states; exact count unconfirmed | None |
| NewsData.io | Aggregated articles, title, description, image URL | REST API | Free 200 credits/day; paid about $199.99 to $1,299.99/mo [snippet] | Commercial use on free tier: sources conflict [snippet] | `region` filter (state, city) on Corporate plan only [snippet] | None |
| NewsAPI.org | Aggregated headlines | REST API | Free dev only; Business about $449/mo; Advanced about $1,749/mo [snippet] | Free tier is dev/testing only, 24h delay [snippet] | No state filter [unconfirmed] | None |
| GNews | Aggregated headlines | REST API | Free 100 req/day; paid from about EUR 49.99/mo [snippet] | Free tier non-commercial [snippet] | Country only [unconfirmed] | None |
| Mediastack | Aggregated headlines | REST API | Free; Standard about $24.99/mo [snippet] | Free tier non-commercial [snippet] | Country only [unconfirmed] | None |
| TheNewsAPI | Aggregated headlines | REST API | Basic about $19/mo [snippet] | Free-tier commercial use unclear [snippet] | Country/locale only [unconfirmed] | None |
| Event Registry / NewsAPI.ai | Articles clustered into events, entities | REST API | Not found [unconfirmed] | Not found | A competitor says no state filter [snippet, biased source] | None |
| NewsCatcher Local News API | Local news by place (GeoNames) | REST API | Sales quote [unconfirmed] | Not checked | Yes, by place [snippet] | Not checked |
| GDELT | Global news index: URL, title, domain, tone, themes | Free DOC/GEO APIs, bulk files | Free | "Unlimited and unrestricted use" incl. commercial, with citation + link [snippet] | No state selector for outlets; location mentions only [prior] | None |
| Bing News Search API | (retired) | Retired 11 Aug 2025 [snippet] | n/a | n/a | n/a | n/a |
| Google News RSS | Headline feeds | RSS | Free | Terms say personal, non-commercial display only (page may be an archived version) [snippet] | Topic/geo feeds exist [prior] | None |
| AP | Wire text, photos, statehouse coverage | AP Content API | Sales quote, no public rate card [snippet] | Licensed; includes image rights by contract | All states (AP statehouse bureaus) [prior] | None |
| Reuters | Wire text, photos, video | Reuters Connect | Quote; depends on usage type and audience size [snippet] | Licensed | Weak on statehouses [prior] | None |
| AllSides | Bias ratings for outlets; balanced headline roundups | No public API; CSV/JSON on request [snippet] | Not published | Ratings are CC BY-NC 4.0; commercial use needs a written licence [snippet] | None by state | Left / Lean Left / Center / Lean Right / Right (outlets) |
| Ground News | Story clusters with bias split, blindspots | No public API [snippet] | n/a | Only unofficial scrapers exist; ToS risk [snippet] | Has local feeds in product [prior] | Outlet bias (derived from AllSides, Ad Fontes, MBFC) [prior] |
| Ad Fontes Media | Bias + reliability scores for outlets | API, JSON [snippet] | $3,600/yr research/nonprofit licence; commercial is a custom, revenue-tiered quote [snippet] | Commercial licence required | None by state | Bias and reliability (outlets) |
| Media Bias/Fact Check | Bias + factuality for outlets | "MBFC Data API" page exists [snippet, not read] | Not checked | Not checked | None by state | Bias and factual rating (outlets) |
| ProPublica | Investigations | RSS [prior] | Free | CC BY-NC-ND 3.0; photos excluded; no wholesale/automatic republishing [snippet] | Some state/local units | None |
| The Conversation | Academic explainers | RSS [prior] | Free | CC BY-ND [prior, unconfirmed this session] | None by state | None |
| Open States / Plural | State bills, votes, legislators, committees | REST API v3, bulk data | Free key; about 30 req/min reported second-hand; paid tiers exist, price not found [snippet] | People data is CC0 [fetched] | 50 states, DC, PR [snippet] | Party on legislators [prior; field list not confirmed] |
| api.congress.gov | Bills, members, Congressional Record issues | REST API | Free key; 5,000 req/hour [fetched] | US government data | Members by state | Party on members [prior] |
| GovInfo (GPO) | Congressional Record text, per-speech "granules" | REST API | Free api.data.gov key; 36,000 req/hour [fetched] | US government publication | Federal only | Member metadata on granules [prior; see caveat] |
| congress-legislators (GitHub) | All members: bioguide ID, party, state, website, RSS URL, social handles | YAML / JSON / CSV | Free | CC0 public domain [fetched] | Federal members by state | Party [fetched] |
| Official press-release feeds | Members' own statements | `rss_url` field per member [fetched]; many sites lack RSS [prior] | Free | Official government-office statements; short quotes low risk | Federal members by state | Join on bioguide for party |
| Ballotpedia | Elections, officeholders, ballot measures | Keyed API + bulk [snippet] | Rate card by email, not public [snippet] | Paid data licence; site terms not read | Strong state/local | Party on candidates/officials [prior] |
| Vote Smart | Bios, votes, ratings, public statements archive | Keyed API [snippet] | Not found [unconfirmed] | Must follow Vote Smart terms [snippet] | State + federal | Party [prior] |
| C-SPAN | Video, transcripts | No public API; archive API key by email, research use [snippet] | n/a | Not a practical feed | Federal mostly | No |
| Google Fact Check Tools API | Fact-checks from many publishers (ClaimReview) | REST `claims:search` | Free with API key within quota [snippet, price from third party] | Google API Terms; each fact-check belongs to its publisher | Not by state | Rating text; no party |
| PolitiFact | Fact-checks | RSS pages exist [snippet] | Free | Their copyright; link + short rating is typical use | State editions [prior] | Speaker named; no party field |

---

## 3. Notes per source, with URLs

### 3.1 News aggregator APIs

**NewsAPI.org**
- Free "Developer" plan is for development and testing only, 100 requests/day, articles delayed about
  24 hours; "Business" about $449/month (250,000 requests) is the first tier allowing production use;
  "Advanced" about $1,749/month. [snippet, third-party sites]
  https://newsapi.org/pricing , https://apicostcalc.com/newsapi.html ,
  https://thunderbit.com/nb/blog/best-news-apis-compared
- One site lists a $49 Starter and $199 Pro tier; no other source agrees. [unconfirmed]
  https://apispine.com/news-api
- No US-state filter that I could find. [unconfirmed]

**NewsData.io**
- `region` parameter accepts a city, state, region, country or continent (example value
  `nashville-tennessee`), up to 5 per call, and is "available only for Corporate users". [snippet]
  https://newsdata.io/blog/?p=3105 , https://newsdata.io/openapi.json ,
  https://learn.microsoft.com/en-us/connectors/newsdataio
- `country` filters by publisher country; `region` targets the article's location. [snippet] (same URLs)
- Pricing: free 200 credits/day; three paid plans about $199.99 to $1,299.99/month plus custom.
  One source says commercial use is allowed on the free tier, another says the free tier has a
  48-hour delay. Conflicting. [snippet] https://geekflare.com/guides/global-news-api/ ,
  https://cloro.dev/blog/news-api-free/
- A "politics" category value was not confirmed (18 categories claimed). [unconfirmed]

**GNews**: free tier 100 requests/day, 12-hour delay, non-commercial only; paid from about
EUR 49.99/month. [snippet] https://thunderbit.com/nb/blog/best-news-apis-compared

**Mediastack**: free plan non-commercial; Standard about $24.99/month. [snippet]
https://geekflare.com/guides/global-news-api/

**TheNewsAPI**: Basic about $19/month; whether the free tier allows commercial use is not stated.
[snippet] https://thunderbit.com/nb/blog/best-news-apis-compared

**Event Registry / NewsAPI.ai**: no pricing found. A NewsData.io blog post (a competitor) says it has
150,000+ publishers and no state/region filter. [snippet, biased source] https://newsdata.io/blog/?p=3105
- Event clustering and location concepts exist in the product. [prior, unconfirmed]

**NewsCatcher Local News API** (added): filters by GeoNames place, aimed at city/state news. Pricing
not found. [snippet]
https://www.newscatcherapi.com/docs/local-news-api/guides-and-concepts/geonames-filtering.md

**Perigon** (added): publishes a 2026 comparison of news APIs; I believe it offers state filters and
source bias labels, but I did not confirm either. [prior, unconfirmed]
https://perigon.io/blog/best-news-apis-in-2026

**Important for all of these**: the API licence covers the vendor's metadata service. It does not give
you copyright permission from the publishers for their text or their photos. Image URLs returned by
these APIs are just links to the publisher's image. [prior; standard position, check each vendor's terms]

### 3.2 Free indexes and search-engine options

**GDELT**
- "All datasets released by the GDELT Project are available for unlimited and unrestricted use for
  any academic, commercial, or governmental use of any kind"; redistribution allowed; must cite GDELT
  and link to its site. [snippet] https://www.gdeltproject.org/about.html
- Do not confuse with "GDELT Cloud" (gdeltcloud.com), a separate service whose terms restrict use to
  non-commercial research, teaching and journalism. [snippet] https://gdeltcloud.com/terms
- Useful for: counting how many outlets carry a story (a "top story" proxy), tone, themes. It has no
  clean "outlets from Ohio" switch; you supply the domain list yourself. [prior]

**Bing News Search API**: retired 11 Aug 2025; Microsoft points to "Grounding with Bing Search" in
Azure AI Agents, which is not a drop-in news feed. [snippet]
https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement ,
https://www.theregister.com/2025/05/15/bing_search_apis_retired/

**Google News RSS**: the Google News terms page found says content may be displayed only for
"personal use (i.e., non-commercial use)". The copy found may be an archived regional version.
Do not build a commercial product on Google News RSS. [snippet]
https://www.google.com/intl/en_us/terms_google_news.html

### 3.3 Wire services

**AP**: AP Content API sold through commercial plans; no public rate card; price set by sales based on
intended use. [snippet] https://apispine.com/associated-press/pricing
- In *AP v. Meltwater* an AP licence defined permitted "snippets" as headlines and the leading
  140 characters of AP content, which shows AP treats even short excerpts as licensable. [snippet]
  https://www.dwt.com/insights/2013/03/ap-wins-key-copyright-action-reselling-news-excerp
- AP has statehouse reporters in every state, so an AP licence is the one single contract that covers
  state politics text and photos nationwide. [prior, unconfirmed]

**Reuters**: Reuters Connect is a subscription B2B marketplace using points; editorial licence price
depends on usage type and audience size; commercial use needs a quote. [snippet]
https://thomsonreuters.com/en/press-releases/2017/may/reuters-launches-reuters-connect.html
(Reuters agency FAQ, archived copy seen in results)

### 3.4 Creative Commons / free-republish newsrooms

**States Newsroom**
- Republishing guidelines: credit the original newsroom (or News From The States) with web address
  and author; keep the story's links and link back to the original; do not sell the story or sell ads
  against it; do not put it behind a paywall; photos and graphics credited to a States Newsroom
  outlet may run with the story they came with; anything else needs permission. [snippet]
  https://www.newsfromthestates.com/node/314438 , https://www.marylandmatters.org/republishing-guidelines/
- Poynter (2021): stories are free to republish "under a Creative Commons license with proper credit".
  The exact variant was not in the results. [snippet] https://www.poynter.org/?p=874243
- I recall outlet footers stating CC BY-NC-ND 4.0. Two searches failed to confirm this. [prior, unconfirmed]
- RSS: outlets are WordPress sites and I expect `/feed/` to work on each. Not confirmed. [prior, unconfirmed]
- **Consequence for a commercial site**: the "no ads against it" and non-commercial conditions make
  full-text republishing risky on an ad-supported or paid site. Showing the headline, our own short
  summary and a link does not rely on that licence at all. If full text is wanted, ask States Newsroom
  for written permission first.

**ProPublica**: CC BY-NC-ND 3.0; credit and link; canonical tag to ProPublica; no editing beyond time,
place and style; photos and illustrations excluded; stories must be picked one by one, not
republished automatically or wholesale (that last point is from a page adapted from ProPublica's
terms). [snippet] https://www.propublica.org/steal-our-stories , https://www.stcroix360.com/reprints

**The Conversation**: CC BY-ND, images usually not included. Site could not be opened and the search
returned nothing. [prior, unconfirmed] https://theconversation.com/us/republishing-guidelines

### 3.5 Bias-rating providers

**AllSides**
- Ratings are free for research or non-commercial use with attribution, under CC BY-NC 4.0.
  Commercial use needs a licence agreement / prior written consent; data offered as CSV or JSON on
  request. No published price. [snippet] https://www.allsides.com/media-bias ,
  https://allsides.com/terms-of-use
- No public developer API; listings on parse.bot and oanor.com are unofficial resellers/scrapers.
  [snippet] https://parse.bot/marketplace/afa2d3ba-3225-432e-92ec-1724ee2661a0/allsides-com-api
- Trademark rules apply to the AllSides name and rating graphics. [snippet]
  https://allsides.com/trademark-guidelines

**Ground News**: no public API, portal or docs. What exists are third-party scrapers (Apify actor
from $0.03 per 1,000 story clusters, ScrapingBee, anysite.io). Using them means scraping against
Ground News's terms. Not recommended. [snippet]
https://providers.apievangelist.com/providers/ground/ ,
https://apify.com/automation-lab/ground-news-bias-coverage-scraper

**Ad Fontes Media**: "value-based, revenue-tiered" licensing; research/nonprofit annual data licence
$3,600/yr; real-time API priced per organisation; data platform delivers JSON by API; commercial
price by enquiry (info@adfontesmedia.com). Whether $3,600 is open to a commercial site is unclear.
[snippet] https://adfontesmedia.com/?p=91858 , https://adfontesmedia.com/static-mbc/

**Media Bias/Fact Check** (added): a "MBFC's Data API" page exists; terms and price not read.
[snippet] https://mediabiasfactcheck.com/mbfcs-data-api

**Note**: all four rate *outlets*, not *statements by parties*. They answer "left-leaning and
right-leaning outlets covered it this way", which is the Ground News / AllSides model, not
"Democrats said X, Republicans said Y".

### 3.6 Government and civic data (the backbone for "Both sides")

**GovInfo API (GPO), Congressional Record collection `CREC`**
- Needs a free api.data.gov key (DEMO_KEY works with a lower limit). Default limits 36,000
  requests/hour, 1,200/minute, 40/second. [fetched] https://github.com/usgpo/api
- Endpoints: collection updates since a date, package summary (one day's Record), granules list
  (each granule is a single speech or item), granule summary with links to all formats; `docClass`
  filter for HOUSE, SENATE, DIGEST, EXTENSIONS. [fetched] https://github.com/usgpo/api
- Speaker metadata: granule metadata (MODS) carries member entries with bioguide ID, party and state.
  [prior] An open issue reports member data missing from some 2024 granule summaries, so do not rely
  on it alone; resolve the speaker name against the legislators dataset as a fallback. [snippet]
  https://www.github.com/usgpo/api/issues/149
- Copyright: works of the US government are not protected by copyright (17 U.S.C. 105). [prior]
- Lag: the daily Record usually appears the next morning. [prior]

**api.congress.gov (Library of Congress)**
- Free key, 5,000 requests/hour. [fetched] https://github.com/LibraryOfCongress/api.congress.gov
- Has `/v3/daily-congressional-record` (by volume and issue), JSON, page size up to 250. [snippet]
  https://apis.io/apis/congress-gov/congress-gov-daily-congressional-record-api/
- Member endpoint includes party and state. [prior, not confirmed on the page fetched]

**unitedstates/congress-legislators**
- CC0 public-domain dedication. Fields per term: `party` (Democrat / Republican / Independent),
  `state`, `url` (official site), `rss_url` (official site's feed). Bioguide ID is the primary key.
  Social handles in a separate file. YAML on main, JSON and CSV on gh-pages. [fetched]
  https://github.com/unitedstates/congress-legislators

**Official press-release feeds of members**
- Use `rss_url` from the dataset above. Coverage is patchy (many Senate sites have no feed), so some
  offices need a page scraper. [prior]
- ProPublica's Congress API used to collect House and Senate press releases; its docs page now says
  the API "is no longer available". [snippet] https://projects.propublica.org/api-docs/congress-api/ ,
  https://www.propublica.org/nerds/new-in-the-congress-api-congressional-statements-and-more
- GovTrack also ended its bulk data and API. [snippet]
  https://congressionaldata.org/ending-govtracks-bulk-data-and-api/
- So there is no maintained free aggregated press-release feed that I could find; it has to be built.

**Open States / Plural**
- API v3 covers bills, legislators, committees, events, jurisdictions for 50 states, DC and Puerto
  Rico; free key via signup; `X-API-KEY` header. [snippet] https://docs.openstates.org/api-v3/
- Free tier about 30 requests/minute (second-hand, unverified); higher volume needs a paid plan;
  no price found. [snippet] https://jentic.com/apis/openstates.org/openstates
- `openstates/people` repo: CC0; "all state legislators & governors" plus some municipal leaders;
  YAML per state. Party field expected but schema file not read. [fetched]
  https://github.com/openstates/people
- LegiScan (added) is the usual alternative for state bills. [snippet, not researched]
  https://legiscan.com/About

**Ballotpedia**: keyed API (geographic APIs, bulk data portal refreshed every 24h); plan-based quotas;
rates by email to data@ballotpedia.org; reuse terms not read. [snippet]
https://developer.ballotpedia.org/ , https://ballotpedia.org/Ballotpedia:Buy_Political_Data

**Vote Smart**: API with personal key; public-statements archive (about 900,000 statements per a
2014-era post); must follow Vote Smart terms. Current price and terms not found. [snippet]
https://votesmart.org/ , https://rdrr.io/cran/votesmart/f/README.md

**C-SPAN**: no documented public developer API; the archives API (api.c-spanarchives.org) issues keys
by email and was tied to research use. Not a practical production feed. [snippet]
https://docs.lib.purdue.edu/ccse/about.html

### 3.7 Fact-checks and neutral facts

**Google Fact Check Tools API**: `GET /v1alpha1/claims:search` returns the same results as Fact Check
Explorer; needs an API key; subject to Google API Terms. A third party says it is free within quota.
[snippet] https://developers.google.com/fact-check/tools/api
- Each result is another publisher's fact-check: show claim, claimant, rating, publisher, link.

**PolitiFact**: RSS pages exist; article pages carry ClaimReview markup; whether RSS items carry it
is unknown. [snippet] https://politifact.com/truth-o-meter/rss
- Data Commons hosts a ClaimReview feed download. Licence not read. [snippet]
  https://datacommons.org/factcheck/download

**Neutral numbers** (added): for a topic such as gas prices use the federal statistical source
directly (EIA for fuel prices, BLS for inflation and jobs, CBO for budget scores). These are US
government works and have free APIs. [prior, not researched this session]

---

## 4. Most defensible build for "Democrats said X / Republicans said Y on topic Z"

1. **Who**: load `congress-legislators` (CC0). It gives bioguide ID, party, state, chamber, official
   site and feed. For state officials use `openstates/people` (CC0).
2. **What they said, source A**: pull the Congressional Record daily through GovInfo `CREC` granules.
   Each granule is one speech with a date and a stable URL. Search granule text for the topic terms.
3. **What they said, source B**: official press releases from each office (feed or scraper), plus
   leadership and caucus pages. These are faster than the Record (same day) and are written to be quoted.
4. **Join**: speaker to bioguide ID to party. Never infer party from the text.
5. **Quote rule**: store and show only verbatim text, checked by exact string match against the
   stored source document. Any model-written paraphrase must be visibly marked as a summary and never
   placed in quotation marks.
6. **Label rule**: attribute to the person, "Rep. Jane Doe (D-CA), House floor, 12 Nov 2026", with a
   link to the source. Avoid a bare "Democrats said" unless it is a leadership or caucus statement.
7. **Balance rule**: fixed, published selection method (for example: most recent statement from party
   leadership and from the relevant committee chair and ranking member on each side). Show the method
   on the page. Handle independents by the caucus they sit with and say so.
8. **Neutral facts**: a small block of numbers from the statistical agency, with date and link, and
   any matching fact-checks from the Fact Check Tools API.
9. **State level**: there is no state equivalent of the Congressional Record with an API. Use governor
   and legislative-caucus press releases plus Open States bill sponsors and votes by party.

Why this is defensible: the Record is a government publication, quotes are verbatim and linked,
party labels come from a public-domain dataset, and nothing depends on a news publisher's copyright
or on a bias-rating vendor's opinion. Accurate quotation of official proceedings is also the
safest ground for defamation purposes. [prior; legal points not researched this session]

Weak points: the Record lags by about a day; members can "revise and extend" remarks, so the Record
is not always what was spoken; press-release collection needs per-office maintenance; floor speeches
skew toward members who talk a lot.

---

## 5. Legal basics for headlines, snippets and thumbnails

**Headlines and links**
- US copyright does not protect titles and short phrases, and facts are free for anyone to report.
  Linking is not copying. Showing a headline with a link and source name is the lowest-risk pattern.
  [prior; Copyright Office position, not researched this session]
- A UK appeal ruling reversed an earlier finding that newspaper headlines could be copyright works,
  which shows the question has been litigated. [snippet]
  https://www.imediaethics.org/uk-court-headline-aggregator-its-users-could-be-violating-copyright/

**Snippets**
- *Associated Press v. Meltwater* (S.D.N.Y. 2013): a paid clipping service that copied AP ledes and
  excerpts was not fair use. The court called it "a classic news clipping service", found the use not
  transformative, and held that copying the lede weighed strongly against fair use. Meltwater's
  comparison to search-engine cases was rejected. [snippet]
  https://www.dwt.com/insights/2013/03/ap-wins-key-copyright-action-reselling-news-excerp ,
  https://app.midpage.ai/case/associated-press-v-meltwater-u-8706839
- Practical rule: do not copy the publisher's first paragraph or description. Write a short summary
  of the facts in our own words (one or two sentences), keep it short enough that the reader still
  needs the article, and always link out.

**Hot news misappropriation**
- A state-law claim from *INS v. AP* (1918), narrowed by the five-part test in *NBA v. Motorola*.
  In *Barclays v. Theflyonthewall* (2d Cir. 2011) the appeals court reversed an injunction against a
  headline/snippet aggregator and held the claim pre-empted by the Copyright Act. The doctrine
  survives only narrowly: free-riding on time-sensitive information gathered at cost, in direct
  competition, in a way that threatens the incentive to gather it. [snippet]
  https://en.wikipedia.org/wiki/Barclays_Capital_Inc._v._Theflyonthewall.com,_Inc. ,
  https://fairuse.stanford.edu/case/barclays-capital-inc-et-al-v-theflyonthewall-com-inc
- Practical rule: attribute, link, and do not systematically republish one outlet's scoops within
  minutes as a substitute for it.

**Thumbnails and images**
- The thumbnail fair-use cases (*Kelly v. Arriba Soft*, *Perfect 10 v. Amazon*) were about search
  engines helping users find content. *Meltwater* refused to extend that reasoning to a news
  clipping product. [snippet]
  https://www.dwt.com/insights/2013/03/ap-wins-key-copyright-action-reselling-news-excerp
- News photos are usually owned by a photographer or agency (AP, Getty, Reuters), not only by the
  outlet, and photo owners sue more readily than text publishers. Copying an article's image to our
  own servers needs a licence. Hot-linking the publisher's image is treated differently by different
  courts (accepted in the Ninth Circuit under the "server test", rejected by New York federal
  judges), so it is not a safe nationwide answer. [prior, not researched this session]
- Safe image sources: (a) images covered by a licence we hold (AP, Reuters, Getty); (b) written
  permission from the outlet; (c) official portraits of members of Congress and other federal
  government images; (d) our own graphics, or no image.
- ProPublica excludes photos from its CC licence; States Newsroom allows only its own credited photos
  with the story they came with. [snippet] (URLs in section 3.4)

**Other basics** [prior, not researched this session]
- Vendor API terms do not replace publisher permission.
- Use outlet names in text; do not use logos in a way that suggests partnership.
- Honour robots.txt and feed terms; some publishers' terms forbid commercial reuse of their RSS.
- Register a DMCA agent and run a takedown process, though safe harbour is weak for content we pick
  ourselves.
- Have a media lawyer review the final display format before launch.

---

## 6. Things I could not confirm

- Exact Creative Commons variant on States Newsroom stories and whether every outlet exposes RSS.
- How many states have a States Newsroom outlet.
- The Conversation's current republishing terms.
- Current vendor prices from the vendors' own pages (all prices above are third-party snippets).
- Which NewsData.io plan is "Corporate" and its price.
- Event Registry / NewsAPI.ai pricing and location filters.
- Open States paid tiers and official rate limits; presence of `party` in the people schema.
- Whether CREC granule summaries reliably carry member party (issue #149 suggests gaps).
- Vote Smart current API terms and price; Ballotpedia rates and reuse terms.
- AP and Reuters prices for a small consumer site.
- Whether the Google News terms page found is the current one.
- MBFC Data API terms; Perigon and NewsCatcher pricing and bias labels.

Hosts that failed to resolve from this sandbox and would need to be allowed for direct checks:
www.newsfromthestates.com, newsdata.io, docs.openstates.org, theconversation.com.
