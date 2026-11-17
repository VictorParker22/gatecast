# Community: the Weird-o-meter, reader favourites, the guestbook, click totals, the editor's picks, and books put forward for The Stacks

These features let readers take part on the weird-news front page and let the owner curate it without editing files:

| Feature | What a visitor does | Where it lives |
|---|---|---|
| **Weird-o-meter** | Rates the lead story from 1 (mildly odd) to 5 (totally bonkers). One vote per visitor per story; voting again changes it. | `public.weird_votes`, written through the `community` Edge Function |
| **Guestbook** ("Sign the guestbook") | Sends a link to a weird story from a real outlet, with an optional one-line note. A person reads every tip. | `public.weird_tips`, written through the `community` Edge Function, read in the reviewer console |
| **Editor's picks** | Nothing: the owner adds, edits, publishes and withdraws picks in the reviewer console, each with an optional hook line under the headline. Visitors see published picks. | `public.weird_picks`, read by the site with the publishable key (`lib/picks-db.js`) |
| **Favourites row** | Nothing directly: the row under the lead is the editor's picks in the editor's order, until a story has 10+ Weird-o-meter votes in the past 7 days; such stories rank first by readers' votes. | `public.weird_favourites()`, through the `community` function |
| **Books put forward** (The Stacks) | An author or their publisher puts a book forward with a form at the end of The Stacks. The editor reads every one, and approves it by writing the shelf text, or rejects it. Approved books carry "Suggested by the author" (or "by the publisher"). | `public.stacks_submissions` through the `community` function; `public.stacks_books`, read by `/api/books` |
| **Book of the Week** | Nothing: the editor picks any book on the shelves, with a one-line reason, in the console. It shows within about 5 minutes and stays until the next pick. | `public.stacks_featured`, read by `/api/books` |
| **Click totals** | Following a weird story's link adds one to that story's anonymous total for the day (skipped under Do Not Track or Global Privacy Control). Only the editor sees the totals; they rank nothing. | `public.weird_clicks`, written through the `community` function, read in the reviewer console |

The database migrations are `supabase/migrations/20261116160000_weird_community.sql`, `20261117090000_reader_favourites.sql` (favourites, the 140-character hook, clicks) and `20261117120000_stacks_submissions.sql` (books put forward, the Book of the Week; written, not applied yet); the function is `supabase/functions/community/` (pure logic in `logic.mjs`, tested by `tests/community.test.mjs`); the browser module is `js/community.js`. Hook lines can be drafted by the reviewer assistant (`draft_hook`, `docs/assist.md`).

## The 50-vote rule

The meter promises: "The readers' average shows once 50 people have voted." This is enforced in the database, not only on the page:

- `public.weird_ratings(ids)` returns each story's vote count and its average **only when the count is 50 or more**. Below that, `average` is `null`. It never returns a single vote or a voter.
- The function and the browser apply the same rule again to whatever they receive, so a bug in one layer cannot leak an early average.
- The count itself is always public ("12 votes so far"), so the page can show progress towards 50.
- The average is rounded to one decimal.

Until 50, the page shows the visitor's own vote ("Your vote: 4", remembered in their browser) and the count. Votes older than 90 days still count towards the total and average (see Retention).

## Privacy: what is stored

No account, no cookie, no raw IP address is stored anywhere.

| Stored | Where | For how long |
|---|---|---|
| Story id: the first 16 hex characters of SHA-256 of the normalised story URL | `weird_votes` | until folded into totals (below) |
| Voter hash: SHA-256 of the secret `COMMUNITY_SALT`, the word `vote` and the visitor's address (an IPv6 address cut to its /64) | `weird_votes`, and the vote rate-limit counter | 90 days after the visitor's last vote on that story; counters 2 days |
| The rating (1–5) and when it was given | `weird_votes` | as above; afterwards only as part of a per-story count and sum |
| A tip's link (normalised: no tracking parameters or fragment) and optional note (≤280 characters) | `weird_tips` | deleted 90 days after it arrives, whatever its status |
| Tip hash: SHA-256 of the salt, the word `tip`, the address and the **UTC day** | `weird_tips.ip_hash`, and the tip rate-limit counter | cleared from the tip after 7 days; counters 2 days |
| Who reviewed a tip, and when | `weird_tips.reviewed_by/at` | with the tip |
| Clicks: a story id, a UTC day and a count. Nothing about who clicked: no address, hash, time of day, browser or page | `weird_clicks` | deleted 90 days after the day |
| Click hash: SHA-256 of the salt, the word `click`, the address and the **UTC day**, used only as the key of the 120-an-hour limit counter (never stored with a click, never with a story) | `private.weird_rate` | counters 2 days |
| A book put forward: title, authors as typed, ISBN-13, year, publisher (optional), shelf, the sender's pitch (≤600 characters), whether they are the author or the publisher, its status and the editor's note | `stacks_submissions` | waiting ones until decided; approved ones as the record behind the shelf entry; rejected ones deleted 180 days after the decision |
| The sender's email address (optional, so the editor can reply) | `stacks_submissions.contact_email` | cleared 90 days after the decision |
| Book hash: SHA-256 of the salt, the word `book`, the address and the **UTC day** | `stacks_submissions.ip_hash`, and the book rate-limit counter | cleared from the submission after 7 days; counters 2 days |

How it works:

- The visitor's address is read from the first hop of `x-forwarded-for` inside the Edge Function, hashed at once and dropped. It is never stored, logged or sent to the database. The function's log records error codes only.
- Without the salt the hashes cannot be matched back to addresses by trying every IPv4 address, which is why the function refuses to run without `COMMUNITY_SALT` (at least 16 characters).
- The vote hash has no day in it, so one visitor is one voter on a story for as long as the vote is kept. The tip hash changes every UTC day, so tips cannot be linked across days.
- IPv6 addresses are cut to their /64, because one home or phone usually holds a whole /64 and can rotate the rest at will. Several people behind one address (an office, a school, a mobile carrier's NAT) share one vote per story. That is the accepted cost of not having accounts.
- Reviewers can read a tip's link, note, time and status, but **not** its hash (column-level grant). Visitors' notes are never published or sent to the assistant; a pick's hook is written by a reviewer or drafted by Claude from the outlet's headline, and a reviewer checks, edits and approves every one.
- Tipped links are **never fetched** by Gatecast. The console opens them in the reviewer's own browser, in a new tab, with `rel="noopener noreferrer"`.
- **Clicks** are sent only from the front page's weird-story links (ticker, lead, favourites, Also odd, the grid), as the link opens: a keepalive `fetch` (or `sendBeacon` where that is missing) with the story's normalised address as the whole body, no credentials and no referrer. It is never waited for and never stops the link. Nothing is sent when the browser has Do Not Track (`navigator.doNotTrack`, `window.doNotTrack`, `navigator.msDoNotTrack`) or Global Privacy Control (`navigator.globalPrivacyControl`) on. Clicks on The brief's headlines are not counted, and click totals never rank anything on the site.

### Retention

A `pg_cron` job, `weird-community-retention`, runs `private.weird_retention()` daily at 04:23 UTC:

1. **Votes** untouched for 90 days are moved out of `weird_votes`: their count and rating sum are added to `private.weird_vote_archive` (one row per story, no hashes), and the rows, with their voter hashes, are deleted. The story's total and average stay the same. Trade-off: after 90 days the same visitor could vote on the same story again and be counted twice. Weird news is old news by then, so this was preferred to keeping a hash for longer.
2. **Tips** lose their hash after 7 days and are deleted after 90 days. An accepted tip lives on only as the pick the editor wrote.
3. **Click totals** older than 90 days are deleted (rows hold no personal data; old totals are no use to the editor).
4. **Books put forward** lose their hash after 7 days and their email address 90 days after the editor decides; rejected ones are deleted 180 days after the decision.
5. **Rate-limit counters** older than 2 days are deleted.

## Abuse limits

All limits are counted in the database (`private.weird_take`, fixed windows aligned to UTC), so every copy of the function shares them:

| What | Limit | Reply when over |
|---|---|---|
| Votes | 60 per voter per hour | `429 { error: "rate_limited", message, retryAfter }` and a `Retry-After` header |
| Tips from one sender | 5 per UTC day | `429 { error: "rate_limited", message, retryAfter }` |
| Tips in all | 200 per UTC day | `429 { error: "tips_full", message, retryAfter }` |
| Clicks | 120 per visitor per hour | `429 { error: "rate_limited", message, retryAfter }` (the beacon ignores it; the click is simply not counted) |
| Books from one sender | 3 per UTC day | `429 { error: "rate_limited", message, retryAfter }` |
| Books in all | 50 per UTC day | `429 { error: "books_full", message, retryAfter }` |

Also:

- **Honeypot.** The tip form and the book form have a hidden `website` field. If it is filled in, the function answers `{ ok: true }` as usual and stores nothing.
- **Book duplicates.** A book whose ISBN is already on the static shelves (`data/books.json`), already waiting, or already approved is refused with `409 { error: "duplicate", message: "That book is already with our editor or on the shelves." }`. A duplicate still uses one of the sender's 3 a day.
- **Duplicates.** A link already waiting in the queue, or already a pick, is not stored twice (the sender still gets `{ ok: true }`). Duplicates do not use up the 200-a-day total.
- **Clicks.** Only `storyUrl` is read from the body; it must be a story address on a public-looking host (as for votes). Any story address is accepted (feed stories as well as picks); the 120-an-hour limit and the 8 KB body cap bound what one visitor can add.
- **Links.** Tips must be `https`, at most 2,048 characters, with no user name, password or non-default port, to a public-looking host: a dotted name with a letter TLD. IP addresses, `localhost`, and `.local`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.example`, `.invalid`, `.onion` names are refused. Story URLs for votes must also be on a public-looking host.
- **Cross-site writes.** A page on another site could make a visitor's browser send a "simple" POST. The function refuses writes whose `Origin` is not one of Gatecast's, and requires `Content-Type: application/json`, which makes browsers ask first (CORS preflight).
- **Sizes.** Request bodies over 8 KB are refused. At most 60 story ids per ratings request.

## The function's contract

`verify_jwt` is off: visitors are anonymous. Send the publishable key as `apikey` (as `js/community.js` does).

```
POST {SUPABASE_URL}/functions/v1/community/vote     { "storyUrl": "https://…", "rating": 1-5 }
  -> 200 { "count": 12, "average": null, "yours": 4 }            (average is a number from the 50th vote)
GET  {SUPABASE_URL}/functions/v1/community/ratings?ids=<id>,<id>,…   (at most 60, each 16 hex characters)
  -> 200 { "ratings": { "<id>": { "count": 0, "average": null }, … } }   (every id asked for is present)
POST {SUPABASE_URL}/functions/v1/community/tip      { "url": "https://…", "note": "…", "website": "" }
  -> 200 { "ok": true }
GET  {SUPABASE_URL}/functions/v1/community/favourites
  -> 200 { "favourites": [ { "storyId": "<id>", "count": 12, "average": null }, … ] }   (best first, at most 12)
POST {SUPABASE_URL}/functions/v1/community/click    { "storyUrl": "https://…" }
  -> 204 (no body)
POST {SUPABASE_URL}/functions/v1/community/book     { "title", "authors", "isbn", "year", "publisher"?, "shelf", "pitch",
                                                      "relation": "author" | "publisher", "email"?, "confirm": true, "website": "" }
  -> 200 { "ok": true } | 409 { "error": "duplicate", "message" }
```

`/favourites` lists up to 12 stories with at least 10 votes changed in the last 7 days, ordered by the database: highest average first, then most votes. `count` is the votes inside the window; `average` stays `null` below 50 (the order still uses the true average, but only over 10+ votes, so no handful of votes can be read back). `/click` adds one to the story's total for the UTC day; the same origin and JSON rules as votes apply.

Errors are JSON: `400 bad_request` (with a `message` for the visitor), `400 no_client_address`, `403 origin_not_allowed`, `405`, `409 duplicate` (a book), `413`, `415 json_required`, `429` as above, `502 unavailable` (database unreachable, `/favourites` and `/click` before `20261117090000_reader_favourites.sql` is applied, or `/book` before `20261117120000_stacks_submissions.sql`), `503 not_configured` (secret missing).

`/book` checks (`validateBook()` in `logic.mjs`): title and authors 1–200 characters; the ISBN as ISBN-10 or ISBN-13 with hyphens or spaces allowed and a correct check digit, stored as ISBN-13 (an ISBN-10 becomes 978 + its first nine digits + a new check digit); a whole-number year from 1800 to next year; publisher ≤120; the shelf is one of the shelves in the site's `data/books.json` (read from `COMMUNITY_SITE_ORIGIN`, default `https://gatecast.vercel.app`, at most every 10 minutes; if it cannot be read, any shelf id of the right shape is taken and the editor checks it); the pitch 1–600; `relation` `author` or `publisher`; the email optional, ≤254 and shaped like an address; `confirm` exactly `true`. Text is folded to one line. The database checks every value again.

CORS allows `https://gatecast.vercel.app`, the gatecast project's preview deployments under the owner's Vercel scope (`https://gatecast-<hash or git-branch>-victorparkerr-4350s-projects.vercel.app`, checked with an anchored pattern), `http://localhost:<port>` and `http://127.0.0.1:<port>`, plus any origins listed, comma-separated, in the optional `COMMUNITY_ALLOWED_ORIGINS` secret (for a custom domain).

### Story ids

`story_id` = the first 16 hex characters of SHA-256 of the story URL after normalising it:

- `http` becomes `https`; the host is lowercased; the default port is dropped;
- the fragment (`#…`) is dropped;
- `utm_*`, `fbclid` and `gclid` query parameters are dropped (others are kept, in order);
- trailing slashes are removed from the path. The path keeps its case.

The same code is in `supabase/functions/community/logic.mjs` and `js/community.js`, and `tests/community.test.mjs` checks they produce the same ids. Picks are saved with their link in this normalised form, so one story is one pick.

## Browser module (`js/community.js`)

```js
import { storyId, loadRatings, rateStory, sendTip, yourVote, loadFavourites, clickAllowed, countClick } from './js/community.js';
await storyId(url);                    // '1a2b3c4d5e6f7a8b' or null
await loadRatings([url, …]);           // { [url]: { count, average|null, yours|null } }; {} on failure
await rateStory(url, 4);               // { ok: true, count, average|null, yours } | { ok: false, error, retryAfter? }
await sendTip({ url, note, website }); // { ok: true } | { ok: false, error }   (error is a sentence for the visitor)
await yourVote(url);                   // 4 or null, from localStorage
await loadFavourites();                // [{ storyId, count, average|null }] best first; [] on failure
clickAllowed();                        // false under Do Not Track or Global Privacy Control
countClick(url);                       // true if sent; fire-and-forget, never awaited, never throws
```

None of them throws. The visitor's own votes are remembered in `localStorage` (`gatecast:weird-votes`, at most 500 stories); private windows and blocked storage simply forget them.

## Editor's picks

Picks are curated in the reviewer console (`review.html` → Weird news → Picks): link, the outlet's own headline, outlet, the date the outlet published it, category, an optional weird rating (the editor's opinion, 1–5), an optional **hook** (≤140 characters), shown under the headline on the front page, and optional **media**: "Video (YouTube link)" and "Picture (link to the image)" (see Pick media below). A pick is a **draft** until published; **withdrawn** takes it off the page without deleting it. Only reviewers can publish, edit a published pick or withdraw one (a trigger enforces this even for the service key), and a published pick must be withdrawn before it can be deleted. Every publish, withdraw, edit-while-published and delete is logged in `private.weird_picks_log` and shown in the console.

Visitors (the publishable key) can read only published picks, and only the columns a page needs. `lib/picks-db.js` reads them for the site as `{ url, title, outlet, published, category, rating, note, videoId, imageUrl }`, the same shape as `data/weird-picks.json`, and returns `[]` on any failure so the site can fall back to the file. Until the pick-media migration is applied the database refuses the two media columns; the picks are then read again without them.

### Pick media

`supabase/migrations/20261117150000_pick_media.sql` (written 17 Nov 2026, not applied yet) adds `weird_picks.video_id` (a YouTube id, `^[A-Za-z0-9_-]{11}$`) and `weird_picks.image_url` (https, at most 2,048 characters), lets visitors read both on published picks, and makes a change to either on a published pick an edit (reviewers only, logged). The console writes them with its ordinary table writes; no new function.

In the pick form (`js/review.js`, rules in `js/storymedia.js` and `js/reviewmodel.js`):

- **Video (YouTube link)** takes any common form (`watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `youtube-nocookie.com/embed/`) and stores the 11-character id. The preview shows the still through Gatecast's own `/api/yt-thumb` and a "Watch it on YouTube" link; a still YouTube does not have says the video may be private or removed. The site checks the video with YouTube's oEmbed before serving it and leaves it out if it is gone or may not be embedded (`docs/content-sources.md`, Weird news).
- **Picture (link to the image)** must be https, on the story's own site (the same registrable domain as the story link) or a host listed for the outlet in `data/weird-sources.json` (`imageHosts`), and never for an outlet shown without pictures. The preview loads it from the publisher in the reviewer's browser (no referrer) and gives its size, with a note when it is small or does not load.
- Problems show on the field's own line as you type, and again on Save. Before the migration is applied, a pick without media still saves; with media, the console says the migration is needed.
- The front page shows the picture (with a small "Has video" control when there is a video too), else the video's click-to-play still, else the story text-led.

Tips feed picks: **Accept** on a tip starts a new pick draft with the tip's link. The headline, outlet and date are then copied from the story itself, and the hook is the reviewer's (see Hook lines).

## Hook lines

The owner's rule (17 Nov 2026): **hook lines are drafted by Claude, and a person edits and approves every one.** In the pick form, the field "Hook (your words, shown under the headline)" has:

- a live checklist (`hookChecks()` in `js/reviewmodel.js`): at most 140 characters is a hard rule (the database enforces it too); clickbait phrases, all-caps words over 3 letters and more than one `?`/`!` are warnings the reviewer may overrule;
- **Draft with Claude**, which calls the assist function's `draft_hook` with the headline and outlet (and the story link only when "Let Claude read the story page" is ticked) and shows up to 3 suggestions. Every suggestion has already passed the house rules again on the server (length, clickbait, capitals, marks, no number the headline or page does not give; see `docs/assist.md`). Clicking one puts it in the field; nothing is saved until the reviewer presses Save, and a hook is public only on a published pick.

## Reader favourites

The row under the lead (`renderFavs()` in `js/front.js`, `favourites()` in `js/frontmodel.js`, owner decision 17 Nov 2026):

1. Stories with **10 or more Weird-o-meter votes in the past 7 days** (`GET /community/favourites`, `loadFavourites()`) come first, in the database's order (average, then votes). Any weird story on the page can qualify, not only picks.
2. The rest of the row is the **editor's published picks in the editor's order**: the order `/api/weird` sends them (highest editor's rating first, then a story with a picture, then the strangest, then the newest; `lib/weird.js`).
3. The lead is never repeated in the row; the row holds 3 stories and is hidden when there is nothing to show.
4. The heading says who ranked it: **"Editor's favourites"** while no story has 10 votes this week; **"Reader favourites — ranked by Weird-o-meter votes"** once one does (the kicker adds "then the editor's picks" when picks fill the rest). A reader-ranked entry shows its vote count this week, and the readers' average only from 50 votes.

Until `20261117090000_reader_favourites.sql` is applied, `/favourites` answers 502, `loadFavourites()` returns `[]`, and the row is the editor's.

The console's **Reader favourites** panel (above the Picks list) builds the same row from the same sources, so the editor sees exactly what visitors see.

## Click totals

So the editor can see which stories land (owner decision, 17 Nov 2026). Counting and privacy are described above (Privacy, Retention, Abuse limits). In the console, each published pick shows its clicks over the last 7 days (`public.weird_click_totals(ids, days)`, reviewers only), as a badge in the Picks list and a line in the pick. Clicks rank nothing: not the favourites row, not the weird stories, not political items or The brief.

## Books put forward for The Stacks

Owner decisions (17 Nov 2026): an author, or their publisher, puts a book forward with the form at the end of The Stacks. It waits in the reviewer console. Only real, published books that fit a shelf; no payment and no promised place. **The editor writes every word on the shelf**: approving means writing the description (one or two sentences), the content note, the caveat and the tags. The sender's pitch is shown to the editor as their words and is never copied: the console's checklist refuses a run of 8 words or more taken from it, in the description, content note or caveat. Approved books carry a small "Suggested by the author" (or "Suggested by the publisher") note.

Tables and functions (`supabase/migrations/20261117120000_stacks_submissions.sql`; every function is `security definer` with `search_path = ''`):

| Table or function | Visitors (publishable key) | Reviewers | `community` function (service role) |
|---|---|---|---|
| `stacks_submissions` | nothing | read everything but the address hash | nothing directly: only through `stacks_submit_book` |
| `stacks_submit_book(p jsonb, p_ip_hash text)` | no | no | call it: 3 per sender and 50 in all per UTC day; `{ ok }` or `{ ok: false, error: 'rate_limited' \| 'books_full' \| 'duplicate', retry_after? }` |
| `stacks_books` | read visible books, shelf columns only (not who approved it) | read every book, hidden ones too | nothing |
| `stacks_approve_submission(p_submission uuid, p_book jsonb)` | no | call it: checks every field, puts the book on the shelves and marks the submission approved; errors `not_found`, `not_pending`, `bad_field` (with `field`), `id_taken`, `duplicate` | no |
| `stacks_reject_submission(p_submission uuid, p_note text)` | no | call it: a note ≤300 characters, for reviewers only (nothing is sent to the sender) | no |
| `stacks_set_hidden(p_book text, p_hidden boolean)` | no | call it: takes a book off the shelves or puts it back; nothing is deleted | no |
| `stacks_featured` | read the picks (not who made them) | read everything | nothing |
| `stacks_set_featured(p_book_id text, p_reason text, p_starts_on date default null)` | no | call it: the week holding `p_starts_on` (its UTC Monday; default this week); picking again for the same week replaces it | no |

`p_book` is `{ id, shelf, title, authors: [..], year, description, content_note, caveat, tags: [..], cover_id }`; the ISBN and who put it forward come from the submission. Limits: id a slug ≤80 characters (not already in `stacks_books`); shelf a slug ≤40; title 1–200; 1–6 authors of ≤120; year 1800 to next year; description 1–400; content note ≤300; caveat ≤400; 1–6 tags of ≤30; `cover_id` a positive Open Library cover id or `null` (the stand-in). Shelf ids are checked by shape only in SQL; the shelves themselves live in `data/books.json`, and the function and console check against them.

### `GET /api/books`

A Vercel function (`api/books.js`, logic in `lib/stacks-db.js`; `server.js` serves the same locally). It answers the `data/books.json` object with:

- `books`: the static books, then the visible approved books in the same shape, oldest approval first. An approved book whose id is already a static id, or whose shelf is not in `shelves`, is left out. Approved books add `origin: 'author' | 'publisher'`, have `olWork: null`, `olEdition: null`, `olVerified: false`, and `cover: { id, olKey: null, checked: '<approval day>' }` only when the editor chose a cover. Static books never carry `origin`.
- `featured`: `{ bookId, reason, since }` for the week's pick (the latest `starts_on` on or before today, UTC), or `null` when there is none or its book is not in `books`.

The database is read with the publishable key (env `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, defaulting to the project's, as `lib/weird.js` does). Answers are kept in memory for 4 minutes and sent with `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=300`, so a decision shows within about 5 minutes without a deploy. On any database failure the answer is still `200`: the static data with `featured: null`, kept in memory 30 seconds and at the CDN 60 seconds (`s-maxage=60`), so it recovers quickly. `loadStacksExtras()` and `mergeBooks()` are also what the build uses to give approved books their `/stacks/<id>/` pages at the next deploy.

### In the reviewer console

`review.html` → The Stacks → **Books** (the number is how many are waiting): the Book of the Week first, then books waiting (newest first), then approved books.

- A waiting book shows everything the sender gave, their pitch as a quote, and the approve form: id (from the title, editable), shelf, title, authors (one per line), year, description, content note, caveat and tags, with a live checklist (length, one or two sentences, nothing copied from the pitch, a full stop, no selling words). The ISBN is read-only. **Look up cover** asks `https://openlibrary.org/isbn/<isbn>.json` from the reviewer's browser, only on that click, and previews the edition's first cover; **Show cover** is unticked by default on the true crime and case-file shelves. **Reject** takes a short note.
- An approved book can be hidden from the shelves and shown again, or made the Book of the Week.
- **Book of the week** shows the pick on now and the history, and sets a pick: any book on the shelves (from `/api/books`, plus approvals the 5-minute cache may not show yet), a reason (≤140 characters, with a counter) and the week (this Monday by default).
