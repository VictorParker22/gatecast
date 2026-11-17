# AI visibility report: Gatecast

17 Nov 2026.

**What this is based on.** ChatGPT, Gemini and Perplexity could not be queried from the build environment, so no assistant's answer was observed. The findings come from three web searches run today (the brand name and two target questions) and from reading the site. Treat the score as an estimate until someone runs the prompts below by hand.

## Current visibility: about 10 / 100

The site is days old and nothing links to it, so assistants have nothing to draw on yet. That is normal for a new site and not a fault in it.

| Dimension | Score (0–10) | Why |
|---|---|---|
| Presence | 0 | A search for "Gatecast" returns none of the site's pages |
| Accuracy | 1 | Asked about "Gatecast", an assistant would most likely describe the Stargate fan podcast of that name |
| Sentiment | 5 | Nothing negative exists; nothing exists |
| Position | 0 | Not in any list of weird-news sites or true-crime book lists |
| Completeness | 2 | The site itself explains what it is very well (How page); no third party repeats it |
| Consistency | 0 | Absent everywhere |

## Two findings that matter most

1. **The name is taken in search.** The first results for "Gatecast" are a long-running Stargate podcast, plus a "Gate Cast" feature of a Stargate app. An assistant asked "what is Gatecast?" will answer about those. Until the site has its own links and mentions, write the name with what it is ("Gatecast, the weird-news site") in every post and pitch, and consider a custom domain before the Show HN launch.
2. **The site's best answers were invisible.** The "Worth knowing" notes (what is disputed about *In Cold Blood*, *Catch Me If You Can* and 18 more) are exactly what people ask assistants. They sat on 77 book pages that search engines are told not to index, and inside the 3D library, which crawlers cannot read. Fixed today (below).

## Prompt check

"Today" is a prediction from the search results, not an observed answer.

| Prompt | Gatecast mentioned today? | Who is cited instead | What would get Gatecast cited |
|---|---|---|---|
| What is Gatecast? | No (the podcast) | Stargate podcast listings | Links and mentions; `llms.txt`; a custom domain |
| Best weird news websites | No | News of the Weird, HuffPost Weird News, UPI Odd News, The Week | Mentions in round-ups (the six newsletter pitches) |
| How accurate is In Cold Blood? | No | Christian Science Monitor, Salon, WSJ coverage, personal blogs | `/stacks/worth-knowing/`, then a full take with sources |
| Is Catch Me If You Can a true story? | No | News coverage of Alan C. Logan's book | Same; the note already names the source |
| True crime books that respect victims | No | Book Riot, CrimeReads, Goodreads lists | The serial-killer shelf intro; the Book Riot pitch |
| Does [book] have content warnings? | No | Crowd-sourced warning sites | `/stacks/content-notes/` |
| Weird news this week | No | UPI, HuffPost | `/weekly/` with 5+ picks a week |

## Compared with who is cited now

No scores are given for others: none was measured.

| Site | Why assistants cite it | What Gatecast has that it lacks |
|---|---|---|
| News of the Weird, UPI Odd News, HuffPost Weird News | Decades of archives, thousands of links | A stated rule against stories built on someone's misfortune; no ads |
| Book Riot, CrimeReads, Goodreads | Volume, authority, reviews | An editor's accuracy note and content note on every relevant book, in one place |
| Wikipedia | The default source for "is it true?" | Short, plain answers gathered by shelf |

## Done today

- **`/stacks/worth-knowing/`**: the 20 "Worth knowing" notes from the true-story shelves on one indexed page, word for word as the book pages show them.
- **`/stacks/content-notes/`**: all 41 content notes on one indexed page.
- Both are in the sitemap, linked from the library's list page and the How page, and carry structured data listing the books.
- **`/llms.txt`**: a short plain-text guide to the site for AI assistants (what Gatecast is, that it is not the other projects of the same name, and where the books, notes, weekly picks and rules are). `robots.txt` points to it. Every AI crawler was already allowed.

## Action plan

| # | Action | Who | Impact |
|---|---|---|---|
| 1 | Verify the site in Bing Webmaster Tools and run `node scripts/indexnow.cjs`. ChatGPT search and Copilot read Bing's index | Owner, 15 min | High |
| 2 | Verify in Google Search Console and request indexing for the two new pages | Owner, 15 min | High |
| 3 | Decide on a custom domain before 8 Dec, or commit to "Gatecast, the weird-news site" everywhere | Owner | High |
| 4 | Add a source link to each "Worth knowing" note (the report, book or study it rests on). Assistants prefer answers they can check, and so do readers | Editor checks each; Claude can propose links | High |
| 5 | Write takes for the three most-asked books: *Catch Me If You Can*, *In Cold Blood*, *The Devil in the White City* | Claude drafts, editor approves | Medium-high |
| 6 | Send the launch posts and pitches. A mention on Hacker News, Reddit or one newsletter is worth more to assistants than any on-page change | Owner | High |
| 7 | Add an "About the editor" section to the How page: a name or a declared pen name | Owner | Medium |
| 8 | Run the seven prompts above in ChatGPT, Gemini and Perplexity once a month and note the answers here | Owner, 10 min | Tracking |

## What will not help

- Stuffing pages with questions nobody asked, or FAQ markup for its own sake.
- A Wikipedia page: the site is not notable enough yet, and one would be deleted.
- Paid "AI visibility" placements.
