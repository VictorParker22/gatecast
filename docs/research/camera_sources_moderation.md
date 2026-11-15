# "Caught on camera" section: video sources and moderation standards

Research date: 15 November 2026. Method: 16 web searches. Page fetches were blocked in this sandbox
(developers.google.com and www.rtdna.org did not resolve), so nothing below was read on the primary page itself.

Evidence labels used throughout:

- **[S]** = taken from a search-result snippet this session (the page was not opened).
- **[PK]** = from prior knowledge, NOT verified this session. Check the linked primary page before relying on it.
- **[UNCONFIRMED]** = conflicting, low-authority or not found. Treat as a lead only.

Not legal advice. Sections B.8 and B.9 need review by a media lawyer before launch.

---

## Part A. Sources

### A.1 YouTube Data API v3 (recommended backbone)

What it offers
- `search.list` (keyword search, can be ordered by `viewCount`), `videos.list` (`statistics.viewCount`, `status.embeddable`,
  `status.madeForKids`, `contentDetails.contentRating.ytRating`, `contentDetails.regionRestriction`),
  `playlistItems.list` (a channel's uploads), `videos.list?chart=mostPopular` (regional chart, filterable by category only). [PK for field names]
- `search.list` results do not include view counts; a follow-up `videos.list` call is needed. [S]

Cost and quota
- Free. Default 10,000 units per day per project. [S]
- `search.list` = 100 units per call (up to 50 results). `videos.list` = 1 unit per call, up to 50 video IDs per call.
  `chart=mostPopular` = 1 unit. [S] `playlistItems.list` = 1 unit. [PK]
- Google's quota page in the search results describes the default allocation as "100 search.list calls, 100 videos.insert calls,
  and 10,000 units per day combined for all other endpoints". One secondary source says that since 1 June 2026 search and
  upload bill to separate daily buckets. [UNCONFIRMED: read the live quota page.]
- Higher quota is free but requires passing YouTube's API compliance audit. [PK]
- Shorts view counting changed in 2025 and the Data API was updated to match, so Shorts counts are not comparable with
  long-form counts. [S, title of Google's quota page banner; details PK]

Embedding and licence rules
- Embedding through the official YouTube player is the licensed route. Uploaders can disable embedding. [PK]
- Player must be at least 200 x 200 px; no autoplay until more than half the player is visible; do not modify, add to or block
  standard player functions (links, settings wheel); send an HTTP Referer (missing Referer causes "Error 153"); no nested-iframe
  tricks; check made-for-kids status via the API before embedding. [S]
- Do not let users download video for offline play, separate audio, or modify video. [S]
- No downloading, caching or storing copies of YouTube audiovisual content without YouTube's written approval. [PK: wording not
  retrieved this session.]
- Advertising may not be sold on a page whose only content of value is the YouTube embed or API data; there must be other
  content of sufficient independent value. [PK, UNCONFIRMED this session. This matters for an ad-funded site: every clip
  page needs original editorial text.]
- Stored API data (titles, descriptions, counts) must be refreshed or deleted after 30 calendar days. [S]
- Derived metrics: developers generally must not create new or derived metrics from API data or replace API figures with
  independently calculated ones; simple arithmetic is acceptable; aggregating API data across channels is restricted. A
  "derived metrics policy" page exists and a secondary source says it took effect 1 June 2026. [S for the rules;
  date UNCONFIRMED.] Consequence: show YouTube's own `viewCount` as returned, labelled "views on YouTube". A home-made
  "trending score" or cross-platform combined view total is risky until that page has been read.
- Age-restricted videos "can't be watched on most 3rd party websites" and redirect viewers to YouTube. [S, YouTube Help]
- `status.embeddable=true` does not guarantee playback on a given domain (owners can restrict by domain). [S, Stack Overflow]

How to measure "most viewed"
1. Keep an allowlist of channel IDs (official agencies plus vetted publishers).
2. Pull each channel's uploads with `playlistItems.list` (1 unit per 50 videos) rather than `search.list` (100 units).
3. Batch IDs through `videos.list?part=statistics,status,contentDetails` (1 unit per 50).
4. Drop anything not embeddable, age-restricted (`ytRating=ytAgeRestricted`), made for kids, private, or region-blocked.
5. Human review, then sort the approved pool by `viewCount`. Refresh daily (must be at least every 30 days).
   Rough budget: 200 channels and 10,000 tracked videos is about 400 units per day, well inside the free quota.
- `chart=mostPopular` cannot be filtered by topic, so it is not useful for this niche. Its status after YouTube retired the
  Trending page in 2025 is [UNCONFIRMED].

URLs
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/youtube/terms/derived-metrics-policy
- https://developers.google.com/youtube/terms/revision-history
- https://support.google.com/youtube/answer/171780 (embed help)
- https://til.simonwillison.net/youtube/fixing-153-embed

### A.2 Official police and sheriff channels and critical-incident pages

- Many agencies publish bodycam and "critical incident" briefings on their own YouTube channels and websites (for example
  LAPD, LVMPD, NYPD, Phoenix PD). [PK: channel list not verified this session.]
- API, cost, view counts: via YouTube Data API as above; free; real view counts.
- Public-record status varies by state [S]:
  - Bodycam video is "at least presumptively" a public record under most states' open-records laws (Reporters Committee).
  - At least 21 states and dozens of municipalities have specific rules, ranging from ordinary public record to outright bans.
  - Arizona: not public unless deadly force is involved, and the agency must consent. Missouri: not disclosable, release at
    agency discretion. Texas: largely outside public-information law. New Jersey: January 2025 Supreme Court ruling narrowed
    the "criminal investigatory record" exemption. Ohio (2025): agencies may charge up to $75 per hour of video, capped at $750.
    Arkansas, North Carolina and Texas also charge fees.
  - California AB 748 (release of critical-incident video within 45 days, with delay and privacy-redaction exceptions).
    [PK, NOT confirmed: the search returned nothing on it.]
  - Release laws often bar or require redaction of footage showing minors and victims of sex crimes or domestic violence. [S]
- Copyright: US federal works are public domain (17 USC 105); state and local works are not automatically so and it varies
  by state. Being a public record does not equal being free to republish commercially. [PK]
- Editorial caveat: agency "community briefing" videos are edited and narrated by the agency involved. Label them as such.
- Many of these videos are age-restricted on YouTube and therefore will not play embedded. [S for the rule; PK for prevalence]

URLs
- https://www.rcfp.org/resources/bodycams/
- https://www.brennancenter.org/our-work/research-reports/police-body-camera-policies-retention-and-release
- https://bja.ojp.gov/sites/g/files/xyckuh186/files/media/document/police_body_camera_footage_just_another_public_record.pdf
- https://news.bloomberglaw.com/litigation/bodycam-records-rules-relaxed-by-new-jersey-supreme-court
- https://apbweb.com/2025/02/what-ohios-new-law-means-for-accessing-body-camera-footage/
- https://www.pbs.org/newshour/nation/police-body-cameras-capture-hours-and-hours-of-footage-but-little-consensus-over-how-to-release-it

### A.3 Established bodycam channels (PoliceActivity, Law&Crime, Code Blue Cam)

- The search returned nothing specific on these channels' licensing or embedding terms. [UNCONFIRMED]
- General position [PK]: they obtain footage by public-records request and add their own editing, captions and narration,
  which they own. Embedding their YouTube upload through the official player is allowed under YouTube's terms while the
  uploader leaves embedding enabled. Downloading and re-hosting needs their licence. Law&Crime is a commercial network and
  licenses content directly.
- US embedding law is unsettled: the Ninth Circuit "server test" (Perfect 10 v. Amazon; Hunley v. Instagram, 2023) treats
  embedding as non-infringing, while New York district courts (Goldman v. Breitbart, 2018; Nicklen v. Sinclair, 2021)
  rejected it. [PK] Using only the official embed and honouring takedown requests keeps risk low.
- Editorial caveat: these channels' redaction and titling standards differ from a news standard, so each clip still needs
  review against Part B.

### A.4 Licensed viral-video agencies

Pricing is mostly by quote; the figures below are dated or second-hand. All current prices [UNCONFIRMED].

| Agency | What it offers | Pricing evidence |
|---|---|---|
| Jukin Media (Trusted Media Brands) | Large cleared UGC library; actively polices unlicensed use and blocks some embeds [S] | 2020 self-service tiers: $49 watermarked, non-monetised, one channel; $99 unwatermarked, monetised, one channel; $299 unlimited channels [S, Tubefilter 2020] |
| ViralHog | Exclusive licences from owners, lots of dashcam and doorbell clips | Mostly revenue share with publishers; about 50% of net goes to the owner [S, secondary] |
| Newsflare | Marketplace of news-style UGC, 60,000+ contributors [S] | Owners typically earn £25 to £100 per clip, occasionally over £1,000 [S, consumer guide]. Buyer price not found |
| Storyful (News Corp) | Verified and cleared social video for newsrooms, strict standards [S] | Subscription by quote; not found |
| AP Video Hub | Agency news video for digital publishers | Not found. By quote [PK] |
| Reuters Connect | Agency video incl. partner UGC; points-based subscription [PK] | Not found. By quote |

- Working assumption for budgeting [PK, rough]: $50 to $500 per clip for editorial web use; newsroom subscriptions from
  low thousands to tens of thousands of dollars per year.
- Licence gives downloadable files and legal clearance, but no public view count. "Most viewed" would have to be the
  site's own play count (first-party analytics), which is allowed and is the cleanest metric the site fully controls.

URLs
- https://tubefilter.com/2020/08/11/jukin-launches-self-service-platform-license-videos/
- https://simonowens.substack.com/p/how-newsflare-monetizes-video-from
- https://moneypantry.com/sell-videos-to-media/
- https://towcenter.gitbooks.io/amateur-footage-a-global-study-of-user-generated-/content/permissions/copyright/licensing.html

### A.5 Ring / Neighbors and doorbell footage

- No Ring media-licensing programme was found. [UNCONFIRMED]
- Ring's terms give Ring broad rights to "access, use, preserve, and/or disclose" recordings and shared content. [S, Digital Trends]
  That licence runs to Ring, not to third-party sites.
- Once shared in Neighbors a video cannot be retracted. Police cannot see recordings unless the owner posts or shares them. [S, Ring support]
- Practical routes: (1) licence from the camera owner in writing, (2) buy through an agency (ViralHog, Newsflare and Storyful
  carry many doorbell clips), or (3) embed the owner's own public YouTube/TikTok/X post. Do not scrape Neighbors. [PK]
- Doorbell clips carry the highest misidentification and defamation risk ("porch pirate" labels on unconvicted private people).

URLs
- https://ring.com/support/articles/uds27/Community-requests
- https://ring.com/neighbors-public-safety-service
- https://www.digitaltrends.com/home/ring-partners-with-405-police-agencies-to-expand-neighborhood-watch/

### A.6 State DOT traffic cameras

- Mostly live streams or stills; many DOTs do not record or archive. Arkansas: no recording, images are copyrighted by each
  camera owner, partner-station feeds need an agreement. [S]
- PennDOT: real-time streams through data feeds under a Non-Exclusive Video Sharing License Agreement; commercial vendors
  are eligible. [S] New York: 511NY Developer's Access Agreement. [S]
- Minnesota treats recordings as public records; New Mexico historically never recorded. [S, FHWA]
- England: National Highways images are Crown Copyright; real-time streams licensed separately. [S]
- "Often public" is true of viewing, not of commercial reuse. Terms differ per state. No view counts exist for live feeds,
  so they cannot feed a "most viewed" ranking. Usable route: crash and near-miss clips that DOTs post on their own
  YouTube channels, ranked through the YouTube API. [PK]

URLs
- https://site.idrivearkansas.com/index.php/policies/camera-terms-of-use/
- https://www.pa.gov/services/penndot/request-access-to-transportation-related-data-feeds
- https://511ny.org/developers/daa
- https://nationalhighways.co.uk/roads-and-travel/live-travel-updates/traffic-cameracctv-services/standard-terms-and-conditions/
- https://ops.fhwa.dot.gov/Publications/fhwahop16033/chap7.htm

### A.7 Vimeo, Dailymotion, TikTok, X

- All four have oEmbed endpoints (TikTok: developers.tiktok.com embed docs; X: publish.x.com; Vimeo: vimeo.com/api/oembed.json;
  Dailymotion: dailymotion.com/services/oembed). [S]
- View counts: not confirmed for any of them in official docs this session. [UNCONFIRMED] TikTok counts appear to need the
  Display API with user authorisation; X oEmbed returns HTML only; Vimeo exposes play counts only to some accounts;
  Dailymotion's Data API has a public views field. [PK]
- Views are defined differently on each platform, so a single cross-platform ranking is not comparable. Rank per platform
  or use YouTube only.

URLs
- https://developers.tiktok.com/docs/en/embed-videos
- https://docs.x.com/x-for-websites/oembed-api
- https://help.winnin.com/what-is-considered-a-view-for-each-platform

### A.8 Recommendation

1. Primary: YouTube Data API v3 over an allowlist of official agency channels and vetted publishers, official embeds only,
   ranked by YouTube `viewCount`. Free.
2. Runner-up or supplement: licensed agency clips (Storyful or Newsflare for news-style, ViralHog or Jukin for doorbell and
   dashcam), self-hosted, ranked by the site's own play counts. Paid, but removes embed fragility and gives clearance.
3. Avoid: scraping, Ring Neighbors, live DOT feeds, cross-platform combined view totals.

---

## Part B. Moderation standards

### B.1 YouTube violent or graphic content policy and age restriction

- Educational, documentary, scientific or artistic (EDSA) context can keep graphic footage up, but the context must be in the
  video's images or audio; title or description alone is insufficient. [S]
- Road-accident footage showing victims' injuries may be removed, or age-restricted if presented with news coverage that
  explains the situation. [S]
- Footage of violent physical sexual assault is not allowed even with context. [S]
- Age-restricted content is not viewable by under-18s or signed-out users, and does not play on most third-party sites. [S]
- Implication: if a clip is age-restricted on YouTube, the site should treat it as out of bounds, not look for another copy.

URLs: https://support.google.com/youtube/answer/2802008 ; https://support.google.com/youtube/answer/6345162 ;
https://support.google.com/youtube/answer/2801999 (child safety)

### B.2 YouTube advertiser-friendly content guidelines

- Law-enforcement content such as forcible arrests, crowd control and disputes with officers can get "limited or no ads". [S]
- Non-combative interactions with police are ad-eligible; combative ones are allowed ads in an educational or journalistic
  context. [S]
- Graphic dead bodies in a non-educational video are restricted; non-graphic tragedy aftermath and police seizures were
  made ad-eligible in a March 2023 update. [S]
- January 2026 relaxation for non-graphic sensitive topics and a September 2026 gaming-violence update. [UNCONFIRMED, secondary reports]

URLs: https://support.google.com/youtube/answer/6162278 ; https://support.google.com/youtube/answer/9725604 (update log)

### B.3 GARM Brand Safety Floor and Suitability Framework

- GARM was discontinued on 8 August 2024 (WFA). [S] Secondary sources tie this to X's antitrust suit. [S]
- No body has taken over maintaining the framework; it is still used informally and by verification vendors
  (IAS, DoubleVerify) as a taxonomy. [S, vendor and glossary sources; vendor claim not officially confirmed]
- Structure: eleven floor categories (twelve after misinformation was added in 2022 [PK]) and a low/medium/high risk
  suitability grading per category. [S]
- Relevant categories [PK: wording not retrieved, check the WFA PDF]: "Death, injury or military conflict" and "Crime and
  harmful acts to individuals and society". Floor (no ads at all): promotion or advocacy of violence, graphic depiction of
  wilful harm. High risk: depiction of death or injury. Medium: breaking-news or dramatic depiction. Low: educational,
  informative treatment.
- Reports of a July 2026 settlement barring WFA from restarting GARM and an April 2026 FTC settlement with agency holding
  companies. [UNCONFIRMED, low-authority sources]
- Use it as a vocabulary for ad buyers, not as a live standard.

URLs: https://www.wfanet.org/garm ;
https://wfanet.org/knowledge/item/2022/06/17/GARM-Brand-Safety-Floor--Suitability-Framework-3 ;
https://www.isba.org.uk/knowledge/garm-brand-safety-floor-suitability-framework

### B.4 Google Publisher Policies / AdSense "shocking content"

- Publisher restriction covers "gruesome, graphic, or disgusting accounts or imagery", with examples "blood, guts, gore ...
  crime scene or accident photos", and depictions of violence. Result is restricted ad serving on those pages. [S]
- Educational material about shocking content can run ads unrestricted. [S]
- Gameplay exception since 30 August 2023 (not relevant here). [S]
- No news or embedded-video exemption was found. [UNCONFIRMED] Assume the page is judged on what the embed shows.

URLs: https://support.google.com/publisherpolicies/answer/10437538 ; https://support.google.com/adsense/answer/10437795

### B.5 SPJ Code of Ethics, "Minimize Harm" [PK: text not retrieved this session; verify at https://www.spj.org/ethicscode.asp]

- Balance the public's need for information against potential harm or discomfort.
- Heightened sensitivity for juveniles, victims of sex crimes, and subjects who are inexperienced or unable to give consent.
- Legal access to information differs from an ethical justification to publish.
- Private people have a greater right to control information about themselves than public figures.
- Avoid pandering to lurid curiosity.
- Balance a suspect's right to a fair trial with the public's right to know; consider the implications of identifying
  suspects before they face charges.
- Consider the long-term reach and permanence of publication; update as appropriate.

### B.6 RTDNA

- RTDNA's revised crime-coverage guidelines include a section on "The Use of Mugshots and Police Released Video", plus
  suspect descriptions, non-violent crime, and updating digital crime stories. [S] The text itself could not be opened.
- RTDNA also has separate graphic-content guidance (justify the journalistic purpose, warn the audience, avoid repeated or
  looping use, consider families). [PK, NOT confirmed this session]
- Related positions: ACLU says most bodycam video should not be released for privacy reasons; NACDL warns about
  misinterpretation of video. [S]

URLs: https://www.rtdna.org/covering-crime ; https://www.rtdna.org/news/rtdna-issues-new-guidelines-for-crime-coverage

### B.7 Ofcom Broadcasting Code (reference only; it binds UK broadcasters, not websites) [PK: not retrieved this session]

- Section One: protecting under-18s. Section Two: harm and offence; offensive material including violence, distress and
  violation of human dignity must be justified by context; suicide and self-harm methods not shown without justification.
- Section Three: crime. Section Eight: privacy; any infringement must be warranted; special care with people caught up in
  emergencies, accidents or personal tragedy, with under-16s and with vulnerable people; footage of suffering and distress
  should not be shown without consent unless warranted.

URL: https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-codes/broadcast-code

### B.8 US legal basics [PK unless marked; lawyer review needed]

- Defamation: calling someone a criminal, thief or "caught" offender when they are only suspected or arrested is the main
  exposure. Private individuals generally need to show only negligence. Use "arrested on suspicion of", "charged with",
  "police allege"; attribute to the agency; state that charges are allegations; record and publish outcomes; correct fast.
  The fair-report privilege protects accurate accounts of official records, not the site's own characterisations.
- Misidentification in doorbell and dashcam clips (uploader's caption names the wrong person) is the commonest trap.
- Right of publicity: newsworthy use is generally protected; using a person's face in ads, promos, merchandise or
  sponsored thumbnails is not.
- State bodycam release laws: see A.2. Lawful release does not remove privacy or ethical limits; release statutes commonly
  require redaction of minors and of sex-crime and domestic-violence victims. [S]
- Copyright and DMCA: section 512 safe harbour covers only user-uploaded material and needs a registered designated agent,
  a repeat-infringer policy and prompt takedown. It does not cover clips the site's own editors select and host.
- COPPA: regulates collecting personal data from under-13s on child-directed services or with actual knowledge. It does not
  regulate showing minors in a video. Relevance: keep the section clearly not child-directed, do not embed made-for-kids
  videos with tracking, and comply with the amended rule (compliance date 22 April 2026 [UNCONFIRMED date]).
- Sexual-offence victims: no general US statutory ban on naming, but release laws and universal newsroom practice withhold
  identity. Treat as an absolute rule.

### B.9 EU and UK, if the site is visible there

- GDPR / UK GDPR: video of an identifiable person is personal data. Posting it on an open video site is not "household"
  use. The journalism exemption can apply to anyone doing journalism, but only where processing is solely for journalistic
  purposes and in the public interest (CJEU, Buivids, C-345/17). [S] An entertainment ranking of viral clips is a weak fit
  for that exemption [PK judgement]. Data about alleged offences has extra protection (Article 10) [PK]. Expect erasure
  requests and have a route for them.
- UK Online Safety Act: applies if the site lets users post or share content (uploads, and possibly comments) and has UK
  users. All in-scope services, regardless of size, must complete an illegal-content risk assessment; small services can
  assign it to a named senior manager. [S, Ofcom] Editor-selected content with no user uploads is largely outside the
  user-to-user duties, and comments on a publisher's own content have a limited exemption. [PK] Violent content is a
  category that children must be protected from if children are likely to access the service. [PK]
- UK also: lifetime anonymity for sexual-offence complainants is statutory, and contempt-of-court rules restrict
  prejudicial material once proceedings are active. [PK]
- EU DSA: Article 16 requires every hosting provider, whatever its size, to run an easily accessible notice-and-action
  mechanism, process notices in a timely, diligent, non-arbitrary and objective way, and publish how it works. [S]
  Statement of reasons to affected users (Art. 17), points of contact and an EU legal representative for non-EU providers
  apply too; small and micro enterprises are exempt from the extra "online platform" duties only. [PK]

URLs
- https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act
- https://www.ofcom.org.uk/online-safety/information-for-industry/guide-for-services/risk-assessments
- https://inquisitiveminds.bristows.com/post/102k11s/my-organisation-runs-a-small-online-forum-is-it-in-scope-of-the-osa
- https://www.crowell.com/en/insights/client-alerts/notice-and-action-mechanisms-in-the-dsa-balancing-the-removal-of-illegal-content-and-the-freedom-of-expression
- https://www.rpclegal.com/snapshots/data-protection/video-recordings-and-the-journalistic-exemption/
- https://panopticonblog.com/2019/02/21/youtube-videos-and-data-protection-liabilities/

### B.10 How the standards map onto the seven sensitive areas

| Area | What the standards converge on |
|---|---|
| Violent or graphic footage | Allowed only with in-video context (YouTube); ad-restricted (YouTube ads, Google Publisher, GARM high risk); needs editorial justification and warning (RTDNA, Ofcom) |
| Death and serious injury | Moment of death, bodies, visible severe injury: remove or age-restrict (YouTube); restricted ads; SPJ "lurid curiosity"; Ofcom suffering-and-distress rule |
| Minors | Release laws redact them; SPJ heightened sensitivity; Ofcom under-16 rules; YouTube child-safety policy; OSA children's duties |
| Sexual-offence victims | Never identify. Statutory in the UK, release-law redaction and universal practice in the US; sexual-assault footage banned on YouTube outright |
| Suspects not convicted | SPJ fair-trial balance; RTDNA mugshot and police-video guidance and story updating; defamation law; UK contempt |
| Mental-health crises | SPJ "unable to give consent"; Ofcom vulnerable people; release-law privacy exemptions. No public-interest case for an entertainment ranking |
| Bystander faces and plates | GDPR personal data; Ofcom privacy must be warranted; agency redaction practice. Plates are personal data in the EU/UK, weaker protection in the US |

### B.11 Rules the site's moderation policy should contain

1. Sourcing: official embeds or written licences only; no downloads, re-uploads or scraping; keep a provenance record per clip.
2. No death, bodies, severe visible injury, suicide or self-harm; anything age-restricted on YouTube is excluded.
3. No identifiable minors in any role; no victims of sexual or domestic offences, ever.
4. No mental-health crises, welfare checks, overdoses or medical emergencies involving private individuals.
5. Presumption of innocence: "arrested", "charged", "alleged"; never "criminal" or "thief" without a conviction; state the
   outcome; update or remove when charges are dropped or the person is acquitted.
6. Bystander privacy: faces, plates, addresses and home interiors must already be redacted at source, otherwise exclude;
   no doxxing in comments.
7. Context and tone: every clip carries source, date, place, what happened next; no mocking or sensational titles; label
   agency-edited videos as such.
8. Human review before a clip enters the ranked pool; view count orders only clips that have already passed review.
9. Complaints and takedowns: one visible form covering privacy, copyright (DMCA agent), legal notices (DSA Article 16) and
   erasure requests; response deadline, reasons given, appeal route.
10. Ads and audience: keep borderline clips ad-free, not child-directed, with content warnings; complete an Online Safety Act
    risk assessment and name a responsible manager if users can post anything.

---

## Open items to verify once primary pages can be opened

- YouTube Developer Policies: exact wording on storing audiovisual content, ads on embed pages, and the derived-metrics policy.
- Live YouTube quota page (possible June 2026 change) and whether `chart=mostPopular` still works.
- California AB 748 and the current Reporters Committee state map.
- RTDNA police-released-video and graphic-content text; SPJ and Ofcom wording.
- Current agency pricing (Storyful, Newsflare, ViralHog, Jukin/TMB, AP Video Hub, Reuters Connect): ask for quotes.
- Ring terms of service wording; PoliceActivity, Law&Crime and Code Blue Cam licensing terms.
- TikTok, X, Vimeo and Dailymotion view-count fields and developer terms.
- 2026 GARM-related settlements; amended COPPA rule compliance date.
