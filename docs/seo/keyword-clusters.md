# Keyword cluster report: Gatecast

17 Nov 2026. One cluster is one page: no two pages target the same search.

**Update, 18 Nov 2026: the site moved to `https://thegatecast.com`.** The pages and their paths are the same, so every cluster below still maps to the same page; only the host changed. The custom-domain decision is done. Cluster 1 (Brand) is still **taken**: the first results for "Gatecast" are still the Stargate podcast. "The Gatecast" in the address helps a little, and "thegatecast" is a search the site can own, but it does not solve the brand search; that takes links and mentions. Search Console numbers will start again under the new property, so the four weeks of data this report asks for count from the move. Steps: [`domain-move.md`](domain-move.md).

**How to read the demand column.** No keyword tool was connected for this report (the Ahrefs and Similarweb connectors failed to connect), so there are no search-volume numbers here. "Demand" and "Competition" are judgements from the earlier research (`docs/research`, the growth plan) and from who ranks today. Replace them with Search Console numbers once the site has four weeks of data.

- **Keywords:** 96, from the site's pages, the growth plan and the book list
- **Clusters:** 19 (13 have a live page, 6 need a page)
- **Orphans:** 5

## Clusters with a live page

| # | Cluster | Page | Primary keyword | Supporting keywords | Intent | Demand / competition |
|---|---|---|---|---|---|---|
| 1 | Brand | `/` | gatecast | gatecast weird news, gatecast library, the stacks gatecast | navigational | Low / **taken**: the name's first results are a Stargate podcast |
| 2 | Weird news today | `/` | weird news | odd news, weird news today, strange news stories, bizarre news, funny news today | informational | Very high / very high (UPI, HuffPost, AP, News of the Weird) |
| 3 | Weird news this week | `/weekly/` | weird news this week | weird news of the week, weirdest news this week, odd news roundup, strange news weekly | informational | Medium / medium |
| 4 | True crime books | `/stacks/crime/` | classic true crime books | best true crime books, true crime books about investigations, true crime books that respect victims | commercial | High / very high |
| 5 | Serial-killer case books | `/stacks/serial/` | serial killer books about the investigation | FBI profiler books, books about criminal profiling, victim-centred true crime books | commercial | High / very high |
| 6 | Unsolved mystery books | `/stacks/unsolved/` | unsolved mystery books | books about unsolved mysteries, dyatlov pass book, mary celeste book, voynich manuscript book | commercial | Medium / high |
| 7 | Weird history books | `/stacks/history/` | weird history books | strange history books, bizarre history books, dancing plague book, radium girls book | commercial | Medium / medium |
| 8 | Strange science books | `/stacks/science/` | books like mary roach | weird science books, popular science books about the body, sam kean books | commercial | Medium / medium |
| 9 | Cults and cons books | `/stacks/cults/` | books about cults | books about con artists, best books about scams, books about fraud | commercial | Medium-high / high |
| 10 | Fantasy classics | `/stacks/fantasy/` | classic fantasy books | fantasy classics to read, best classic fantasy novels | commercial | High / very high |
| 11 | Science fiction classics | `/stacks/scifi/` | classic science fiction books | sci-fi classics, best classic sci-fi novels | commercial | High / very high |
| 12 | **Is it true? (new page)** | `/stacks/worth-knowing/` | true story books accuracy | is in cold blood accurate, is catch me if you can a true story, devil in the white city accuracy, mindhunter accuracy, is the mothman prophecies true, tulip mania myth | informational | Medium / **low to medium** |
| 13 | **Content warnings (new page)** | `/stacks/content-notes/` | true crime book content warnings | [title] content warnings, [title] trigger warnings, is [title] graphic | informational | Low-medium / **low** |
| 14 | D. B. Cooper book | `/stacks/skyjack/` | db cooper book | skyjack book, best book about d b cooper, skyjack geoffrey gray review | informational | Medium / medium |
| 15 | Flight connection weather | `/trip.html` | will weather delay my connection | flight connection weather check, will my flight be delayed by weather | transactional | Medium / high |
| 16 | Flight status with weather | `/flights.html` | flight status and airport weather | airport weather delays today, live airport weather | transactional | High / very high |

## Clusters that need a page

| # | Cluster | Proposed page | Primary keyword | Supporting keywords | When |
|---|---|---|---|---|---|
| 17 | Weirdest news of the year | `/weird/2026/` | weirdest news stories 2026 | weird news 2026, strangest stories of the year | 21 Dec (seasonal spike) |
| 18 | One book, one question (a "take" per book) | `/stacks/<book>/` | is catch me if you can a true story; how accurate is in cold blood; killers of the flower moon book vs movie; mary celeste book; dyatlov pass book | each book's own "[title] accuracy", "[title] true story" | One a week, in the growth plan's order |
| 19 | What weather delays flights | a guide linked from `/trip.html` | what weather delays flights | will snow delay my flight, what is a ground stop | Feb (winter peak) |

Cluster 12 and cluster 18 do not compete: the guide answers the general question and links to each book; when a book gets its own take, that page owns "[title] accuracy".

## Orphans

| Keyword | Why it has no cluster |
|---|---|
| books like [title] | Needs read-alike lists the site does not have yet |
| weird animal news, weird weather news | Category hubs come later, once each has 15+ picks with the editor's words |
| true crime books made into movies | Every adaptation must be checked before it is published |
| true crime books gift | Seasonal; only worth a page if written by 3 Dec |
| nonfiction reading challenge 2027 | Seasonal; needs the reading-card feature explained |

## Roadmap

| Priority | Cluster | What to do | Why |
|---|---|---|---|
| 1 | 12, 13 | Done today: both pages live, indexed, in the sitemap. Request indexing in Search Console | The only clusters where a new site can rank soon: low competition, and the notes are original |
| 2 | 18 | Takes for *Catch Me If You Can*, *In Cold Blood*, *The Devil in the White City* next | Each has a clear "is it true?" search and an existing note to build on |
| 3 | 3 | Keep `/weekly/` filled: 5+ picks a week, each with a hook or summary | Week pages stay out of search until they have 5 picks with the editor's words |
| 4 | 17 | Publish the year's list on 21 Dec | One seasonal spike a year |
| 5 | 4–9 | Leave as they are; add links to them from each new take | Head terms are out of reach for now; they gain from the pages above |
| 6 | 2, 10, 11, 16 | No work | Dominated by large publishers; rank on the brand and long-tail instead |
