# Community: the Weird-o-meter, reader favourites, the guestbook, click totals and the editor's picks

These features let readers take part on the weird-news front page and let the owner curate it without editing files:

| Feature | What a visitor does | Where it lives |
|---|---|---|
| **Weird-o-meter** | Rates the lead story from 1 (mildly odd) to 5 (totally bonkers). One vote per visitor per story; voting again changes it. | `public.weird_votes`, written through the `community` Edge Function |
| **Guestbook** ("Sign the guestbook") | Sends a link to a weird story from a real outlet, with an optional one-line note. A person reads every tip. | `public.weird_tips`, written through the `community` Edge Function, read in the reviewer console |
| **Editor's picks** | Nothing: the owner adds, edits, publishes and withdraws picks in the reviewer console, each with an optional hook line under the headline. Visitors see published picks. | `public.weird_picks`, read by the site with the publishable key (`lib/picks-db.js`) |
| **Favourites row** | Nothing directly: the row under the lead is the editor's picks in the editor's order, until a story has 10+ Weird-o-meter votes in the past 7 days; such stories rank first by readers' votes. | `public.weird_favourites()`, through the `community` function |
| **Click totals** | Following a weird story's link adds one to that story's anonymous total for the day (skipped under Do Not Track or Global Privacy Control). Only the editor sees the totals; they rank nothing. | `public.weird_clicks`, written through the `community` function, read in the reviewer console |

The database migrations are `supabase/migrations/20261116160000_weird_community.sql` and `20261117090000_reader_favourites.sql` (favourites, the 140-character hook, clicks); the function is `supabase/functions/community/` (pure logic in `logic.mjs`, tested by `tests/community.test.mjs`); the browser module is `js/community.js`. Hook lines can be drafted by the reviewer assistant (`draft_hook`, `docs/assist.md`).

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
4. **Rate-limit counters** older than 2 days are deleted.

## Abuse limits

All limits are counted in the database (`private.weird_take`, fixed windows aligned to UTC), so every copy of the function shares them:

| What | Limit | Reply when over |
|---|---|---|
| Votes | 60 per voter per hour | `429 { error: "rate_limited", message, retryAfter }` and a `Retry-After` header |
| Tips from one sender | 5 per UTC day | `429 { error: "rate_limited", message, retryAfter }` |
| Tips in all | 200 per UTC day | `429 { error: "tips_full", message, retryAfter }` |
| Clicks | 120 per visitor per hour | `429 { error: "rate_limited", message, retryAfter }` (the beacon ignores it; the click is simply not counted) |

Also:

- **Honeypot.** The tip form has a hidden `website` field. If it is filled in, the function answers `{ ok: true }` as usual and stores nothing.
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
```

`/favourites` lists up to 12 stories with at least 10 votes changed in the last 7 days, ordered by the database: highest average first, then most votes. `count` is the votes inside the window; `average` stays `null` below 50 (the order still uses the true average, but only over 10+ votes, so no handful of votes can be read back). `/click` adds one to the story's total for the UTC day; the same origin and JSON rules as votes apply.

Errors are JSON: `400 bad_request` (with a `message` for the visitor), `400 no_client_address`, `403 origin_not_allowed`, `405`, `413`, `415 json_required`, `429` as above, `502 unavailable` (database unreachable, or `/favourites` and `/click` before `20261117090000_reader_favourites.sql` is applied), `503 not_configured` (secret missing).

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

Picks are curated in the reviewer console (`review.html` → Weird news → Picks): link, the outlet's own headline, outlet, the date the outlet published it, category, an optional weird rating (the editor's opinion, 1–5) and an optional **hook** (≤140 characters), shown under the headline on the front page. A pick is a **draft** until published; **withdrawn** takes it off the page without deleting it. Only reviewers can publish, edit a published pick or withdraw one (a trigger enforces this even for the service key), and a published pick must be withdrawn before it can be deleted. Every publish, withdraw, edit-while-published and delete is logged in `private.weird_picks_log` and shown in the console.

Visitors (the publishable key) can read only published picks, and only the columns a page needs. `lib/picks-db.js` reads them for the site as `{ url, title, outlet, published, category, rating, note }`, the same shape as `data/weird-picks.json`, and returns `[]` on any failure so the site can fall back to the file.

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
