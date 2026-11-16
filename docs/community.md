# Community: the Weird-o-meter, the guestbook and the editor's picks

Three features let readers take part on the weird-news front page and let the owner curate it without editing files:

| Feature | What a visitor does | Where it lives |
|---|---|---|
| **Weird-o-meter** | Rates the lead story from 1 (mildly odd) to 5 (totally bonkers). One vote per visitor per story; voting again changes it. | `public.weird_votes`, written through the `community` Edge Function |
| **Guestbook** ("Sign the guestbook") | Sends a link to a weird story from a real outlet, with an optional one-line note. A person reads every tip. | `public.weird_tips`, written through the `community` Edge Function, read in the reviewer console |
| **Editor's picks** | Nothing: the owner adds, edits, publishes and withdraws picks in the reviewer console. Visitors see published picks. | `public.weird_picks`, read by the site with the publishable key (`lib/picks-db.js`) |

The database migration is `supabase/migrations/20261116160000_weird_community.sql`; the function is `supabase/functions/community/` (pure logic in `logic.mjs`, tested by `tests/community.test.mjs`); the browser module is `js/community.js`.

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

How it works:

- The visitor's address is read from the first hop of `x-forwarded-for` inside the Edge Function, hashed at once and dropped. It is never stored, logged or sent to the database. The function's log records error codes only.
- Without the salt the hashes cannot be matched back to addresses by trying every IPv4 address, which is why the function refuses to run without `COMMUNITY_SALT` (at least 16 characters).
- The vote hash has no day in it, so one visitor is one voter on a story for as long as the vote is kept. The tip hash changes every UTC day, so tips cannot be linked across days.
- IPv6 addresses are cut to their /64, because one home or phone usually holds a whole /64 and can rotate the rest at will. Several people behind one address (an office, a school, a mobile carrier's NAT) share one vote per story. That is the accepted cost of not having accounts.
- Reviewers can read a tip's link, note, time and status, but **not** its hash (column-level grant). Visitors' notes are never published; a pick's note is always the editor's own words.
- Tipped links are **never fetched** by Gatecast. The console opens them in the reviewer's own browser, in a new tab, with `rel="noopener noreferrer"`.

### Retention

A `pg_cron` job, `weird-community-retention`, runs `private.weird_retention()` daily at 04:23 UTC:

1. **Votes** untouched for 90 days are moved out of `weird_votes`: their count and rating sum are added to `private.weird_vote_archive` (one row per story, no hashes), and the rows, with their voter hashes, are deleted. The story's total and average stay the same. Trade-off: after 90 days the same visitor could vote on the same story again and be counted twice. Weird news is old news by then, so this was preferred to keeping a hash for longer.
2. **Tips** lose their hash after 7 days and are deleted after 90 days. An accepted tip lives on only as the pick the editor wrote.
3. **Rate-limit counters** older than 2 days are deleted.

## Abuse limits

All limits are counted in the database (`private.weird_take`, fixed windows aligned to UTC), so every copy of the function shares them:

| What | Limit | Reply when over |
|---|---|---|
| Votes | 60 per voter per hour | `429 { error: "rate_limited", message, retryAfter }` and a `Retry-After` header |
| Tips from one sender | 5 per UTC day | `429 { error: "rate_limited", message, retryAfter }` |
| Tips in all | 200 per UTC day | `429 { error: "tips_full", message, retryAfter }` |

Also:

- **Honeypot.** The tip form has a hidden `website` field. If it is filled in, the function answers `{ ok: true }` as usual and stores nothing.
- **Duplicates.** A link already waiting in the queue, or already a pick, is not stored twice (the sender still gets `{ ok: true }`). Duplicates do not use up the 200-a-day total.
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
```

Errors are JSON: `400 bad_request` (with a `message` for the visitor), `400 no_client_address`, `403 origin_not_allowed`, `405`, `413`, `415 json_required`, `429` as above, `502 unavailable` (database unreachable), `503 not_configured` (secret missing).

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
import { storyId, loadRatings, rateStory, sendTip, yourVote } from './js/community.js';
await storyId(url);                    // '1a2b3c4d5e6f7a8b' or null
await loadRatings([url, …]);           // { [url]: { count, average|null, yours|null } }; {} on failure
await rateStory(url, 4);               // { ok: true, count, average|null, yours } | { ok: false, error, retryAfter? }
await sendTip({ url, note, website }); // { ok: true } | { ok: false, error }   (error is a sentence for the visitor)
await yourVote(url);                   // 4 or null, from localStorage
```

None of them throws. The visitor's own votes are remembered in `localStorage` (`gatecast:weird-votes`, at most 500 stories); private windows and blocked storage simply forget them.

## Editor's picks

Picks are curated in the reviewer console (`review.html` → Weird news → Picks): link, the outlet's own headline, outlet, the date the outlet published it, category, an optional weird rating (the editor's opinion, 1–5) and an optional note in the editor's own words (≤200 characters). A pick is a **draft** until published; **withdrawn** takes it off the page without deleting it. Only reviewers can publish, edit a published pick or withdraw one (a trigger enforces this even for the service key), and a published pick must be withdrawn before it can be deleted. Every publish, withdraw, edit-while-published and delete is logged in `private.weird_picks_log` and shown in the console.

Visitors (the publishable key) can read only published picks, and only the columns a page needs. `lib/picks-db.js` reads them for the site as `{ url, title, outlet, published, category, rating, note }`, the same shape as `data/weird-picks.json`, and returns `[]` on any failure so the site can fall back to the file.

Tips feed picks: **Accept** on a tip starts a new pick draft with the tip's link. The headline, outlet and date are then copied from the story itself, and the note is the editor's.

## Paused additions

Two additions the owner asked for are built but **paused** until they are planned. Neither is used by any page:

- **Reader favourites**: `public.weird_favourites()` (up to 12 stories with at least 10 votes in the last 7 days, best average first; the average is still hidden below 50), `GET /community/favourites`, and `loadFavourites()` in `js/community.js`. The SQL is in `supabase/paused/weird_favourites.sql`, outside `migrations/`. Until it is applied the route answers 502 and `loadFavourites()` returns `[]`.
- **Hook line**: the same paused SQL file tightens a pick's note to 140 characters. `hookChecks()` in `js/reviewmodel.js` is the checklist (length as a hard rule; clickbait phrases, all-caps words and more than one `?`/`!` as warnings), tested but not shown in the console yet.
