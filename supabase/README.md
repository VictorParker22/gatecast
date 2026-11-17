# Supabase

Gatecast's database lives in the Supabase project `gatecast` (`hfdwmzuedjcsaxgzhzmu`). This folder mirrors what runs there, so the repository can be read without opening the dashboard. Apply changes in Supabase first (migrations, function deploys), then copy them here.

## What each piece does

| Path | What it does |
|---|---|
| `migrations/20261116032935_both_sides_review_queue.sql` | The "Both sides" review queue: `topics`, `statements`, `reviewers`, and the row rules and triggers that decide who may publish |
| `migrations/20261116033422_both_sides_guard_withdraw_delete.sql` | Only a reviewer can withdraw or delete a published topic; deletions are logged |
| `migrations/20261116040853_state_votes.sql` | `state_votes` (statehouse floor votes copied from Open States), the collector's bookkeeping tables, and the `state_votes` switch |
| `migrations/20261116041156_collect_state_votes_hourly.sql` | A `pg_cron` job, `collect-state-votes`, that calls the `collect` function at 7 minutes past every hour. The repository copy has the project's anon key replaced by `<SUPABASE_ANON_KEY>` |
| `migrations/20261116090000_reviewer_console.sql` | **Written, not applied yet.** What the reviewer console needs beyond the queue: internal notes, a topic's review history, hiding a vote, collector health (see below) |
| `functions/collect/index.ts` | Edge Function that reads up to four states per run from Open States and writes passage votes into `state_votes`. Copies the public record only: official title, counts, party split, date and links |
| `functions/assist/` | Edge Function behind the reviewer console's assistant (Claude). See `docs/assist.md` |
| `migrations/20261116160000_weird_community.sql` | **Applied** (16 Nov 2026). Weird news: reader votes (`weird_votes`, the Weird-o-meter), guestbook tips (`weird_tips`), the editor's picks (`weird_picks`), their limits, history and a daily retention job. See `docs/community.md` |
| `migrations/20261117090000_reader_favourites.sql` | **Applied** (17 Nov 2026). Reader favourites (`weird_favourites()`), the 140-character hook line on `weird_picks.note`, anonymous click totals (`weird_clicks`, `weird_count_click()`, `weird_click_totals()`) and 90-day click retention in `private.weird_retention()`. Replaces the old `paused/weird_favourites.sql`. See `docs/community.md` |
| `migrations/20261117120000_stacks_submissions.sql` | **Applied** (17 Nov 2026). The Stacks: books put forward by their author or publisher (`stacks_submissions`, `stacks_submit_book()`), approved books (`stacks_books`, `stacks_approve_submission()`, `stacks_reject_submission()`, `stacks_set_hidden()`), the Book of the Week (`stacks_featured`, `stacks_set_featured()`), and their retention in `private.weird_retention()`. See `docs/community.md` |
| `migrations/20261117150000_pick_media.sql` | **Applied** (17 Nov 2026). The editor's media for a pick: `weird_picks.video_id` (a YouTube id, `^[A-Za-z0-9_-]{11}$`) and `weird_picks.image_url` (https, ≤2,048 characters), readable by visitors on published picks; `private.weird_picks_guard()` counts a change to either on a published pick as a logged edit. See `docs/community.md`, "Pick media" |
| `functions/community/` | Edge Function for anonymous visitors: `POST /vote`, `GET /ratings`, `GET /favourites`, `POST /tip`, `POST /click`, `POST /book`. Hashes the visitor's address with a secret salt; never stores it. See `docs/community.md` |

Which pages read it:

- **Today page** (`js/civic.js`): "Your statehouse" (the visitor's state's latest votes) and "Both sides" (published topics), with the publishable key in `js/config.js`.
- **Reviewer console** (`review.html`, `js/review.js`): reviewers sign in with an emailed link and work the queue, the guestbook tips and the editor's picks (with hook lines, Claude's hook drafts, each published pick's clicks over 7 days and a preview of the favourites row).
- **Weird news front page** (`js/community.js`): the Weird-o-meter, reader favourites, the guestbook and click counting, through the `community` function. The editor's picks are read server-side by `lib/picks-db.js` with the publishable key.
- **The Stacks** (`library.html`, `/stacks/`): approved author books and the Book of the Week, read server-side by `lib/stacks-db.js` (`GET /api/books`, and the build) with the publishable key; the book form posts to the `community` function's `/book`. The reviewer console's Books view approves, rejects and hides books and sets the Book of the Week.

## Who can read and write what

The publishable key in `js/config.js` is public by design. Row-level security in the migrations decides what each request may do:

- **Visitors** read published topics and their statements, and votes that are not hidden while the switch is on. Nothing else.
- **Reviewers** (signed in and listed in `public.reviewers`) read everything in the queue, write drafts, publish, withdraw and reject.
- **The collector** runs inside Supabase with the service role key. It writes votes; like any request with that key it could write queue drafts, but the triggers stop it publishing or changing anything published, and it cannot name a reviewer.
- **The project owner** (SQL editor) is unrestricted. This is the only way to add a reviewer or flip a switch.

Weird news (once `20261116160000_weird_community.sql` is applied):

| Table or function | Visitors (publishable key) | Reviewers | `community` function (service role) |
|---|---|---|---|
| `weird_votes` | nothing | nothing | nothing directly: only through `weird_cast_vote` |
| `weird_ratings(ids)` | call it: counts, and averages from 50 votes | same | same |
| `weird_cast_vote(...)` | no | no | call it (one vote per voter per story, 60 per voter per hour) |
| `weird_tips` | nothing | read (not the address hash); set status only, signed by a trigger | nothing directly: only through `weird_submit_tip` |
| `weird_submit_tip(...)` | no | no | call it (5 per sender per UTC day, 200 per day in all) |
| `weird_picks` | read published picks (public columns only, including `video_id` and `image_url` once `20261117150000_pick_media.sql` is applied) | read all, add, edit, publish, withdraw; delete when not published | nothing |
| `weird_pick_activity(pick)` | no | read a pick's history | no |
| `weird_favourites(days, min_votes)` | call it: up to 12 stories with 10+ votes in the window, averages from 50 votes | same | same |
| `weird_clicks` | nothing | nothing directly: only through `weird_click_totals` | nothing directly: only through `weird_count_click` |
| `weird_count_click(...)` | no | no | call it (120 per visitor per hour; stores no hash with the click) |
| `weird_click_totals(ids, days)` | no | call it: clicks per story over the last 1–90 days | no |

The Stacks (once `20261117120000_stacks_submissions.sql` is applied):

| Table or function | Visitors (publishable key) | Reviewers | `community` function (service role) |
|---|---|---|---|
| `stacks_submissions` | nothing | read (not the address hash) | nothing directly: only through `stacks_submit_book` |
| `stacks_submit_book(p, p_ip_hash)` | no | no | call it (3 per sender per UTC day, 50 per day in all; duplicates refused) |
| `stacks_books` | read visible books (shelf columns only) | read all, hidden ones too | nothing |
| `stacks_approve_submission(p_submission, p_book)`, `stacks_reject_submission(p_submission, p_note)`, `stacks_set_hidden(p_book, p_hidden)` | no | call them | no |
| `stacks_featured` | read (not who picked) | read | nothing |
| `stacks_set_featured(p_book_id, p_reason, p_starts_on)` | no | call it | no |

Votes, tips and clicks are only ever written by the definer functions, which check every value again and enforce the limits in the database; no API role has a direct grant on `weird_votes` or `weird_clicks`, and the service role has none on any of the four tables. Every definer function sets `search_path = ''` and names every object with its schema. Rate counters, vote totals kept after 90 days and the picks' history live in `private`, which the API cannot reach.

## The `state_votes` switch

Visitors only see votes while the switch is on. It is a row in `private.switches`, which the API cannot reach. In the SQL editor:

```sql
-- show statehouse votes to visitors
update private.switches set enabled = true where key = 'state_votes';
-- hide them again (the collector keeps collecting)
update private.switches set enabled = false where key = 'state_votes';
```

To hide one vote rather than all of them: `update public.state_votes set hidden = true where id = '<id>';` (or "Hide vote" in the reviewer console once the reviewer-console migration is applied).

## Adding a reviewer

1. Create the account: Supabase dashboard → Authentication → Users → **Invite user** (or **Add user**) with their email. The console only sends sign-in links to accounts that already exist.
2. In the SQL editor:

   ```sql
   insert into public.reviewers (user_id) select id from auth.users where email = 'name@example.org';
   ```

3. They open `/review.html`, enter their email and follow the link. The console shows this same SQL to anyone who signs in but is not a reviewer yet.

For the link to come back to the console, its address must be allowed under Authentication → URL Configuration → Redirect URLs, for example `https://gatecast.vercel.app/review.html` and, for local work, `http://localhost:4173/review.html`. Otherwise Supabase sends people to the project's Site URL instead.

## The reviewer-console migration (not applied)

`migrations/20261116090000_reviewer_console.sql` is for the owner to apply when ready (SQL editor, or `supabase db push`). It is safe to run twice. It grants:

- `public.topic_notes`: internal notes on a topic. Reviewers read and add them (always signed as themselves) and delete their own. Visitors and the collector's key get nothing.
- `public.review_activity(topic)`: a topic's publish, withdraw and delete history from `private.review_log`, with who acted. Raises an error for anyone who is not a reviewer; not executable by the anon or service roles.
- `state_votes` for reviewers: read every vote, hidden ones included, whatever the switch says (so a reviewer can check votes before the switch goes on), and change the `hidden` column only. Every other column stays read-only through the API.
- `collector_states` and `collector_runs`: read-only for reviewers, for the console's Collector view.

Until it is applied, the console works without these: notes and vote hiding say they arrive with the migration, the activity list shows only what the topic itself records, and the Collector view is hidden.

## Secrets

Secrets live in Supabase (Project → Edge Functions → Secrets), never in this repository or in front-end code:

- `Open-States`: the Open States API key, read by `collect`.
- `ANTHROPIC_API_KEY`: the Anthropic key, read by `assist`.
- `COMMUNITY_SALT`: a long random secret, read by `community`, which hashes visitors' addresses with it. **The function refuses to run without it** (at least 16 characters; use 32+ random characters, e.g. `openssl rand -hex 32`). Set it once and leave it: changing it makes every visitor a new voter, so they could vote again on stories they already rated, and the per-day tip hashes stop matching for the rest of that day.
- `COMMUNITY_ALLOWED_ORIGINS` (optional): extra browser origins for `community`, comma-separated, for a custom domain.
- `COMMUNITY_SITE_ORIGIN` (optional): where `community` reads `data/books.json` to check a book's shelf and the ISBNs already on the shelves. Default `https://gatecast.vercel.app`.
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`: provided by Supabase to every function.

The cron job authenticates with the project's anon key, which is public; the repository copy still leaves it out.


## Weird news: going live

1. Apply `migrations/20261116160000_weird_community.sql` (SQL editor or `supabase db push`). It is safe to run twice. It creates the tables, functions, policies and the `weird-community-retention` cron job (daily, 04:23 UTC).
2. Set the secret: `supabase secrets set COMMUNITY_SALT=$(openssl rand -hex 32) --project-ref hfdwmzuedjcsaxgzhzmu` (or Project → Edge Functions → Secrets).
3. Deploy the function with JWT checks off, because visitors are not signed in:

   ```sh
   supabase functions deploy community --no-verify-jwt --project-ref hfdwmzuedjcsaxgzhzmu
   ```

4. Check it: `curl "https://hfdwmzuedjcsaxgzhzmu.supabase.co/functions/v1/community/ratings?ids=0123456789abcdef" -H "apikey: <publishable key>"` should answer `{"ratings":{"0123456789abcdef":{"count":0,"average":null}}}`. A `503 not_configured` means the salt is missing or too short.

Until step 1, the console's Tips and Picks views say they arrive with the migration, and the site falls back to `data/weird-picks.json`.

## Reader favourites, hook lines and clicks: going live

1. Apply `migrations/20261117090000_reader_favourites.sql` (after `20261116160000_weird_community.sql`). It is safe to run twice. It stops, changing nothing, if any existing pick note is longer than 140 characters (none were on 17 Nov 2026); shorten those first. It replaces `private.weird_retention()` (the existing cron job keeps calling it).
2. Redeploy `community` with JWT checks off (the same command as above): `supabase functions deploy community --no-verify-jwt --project-ref hfdwmzuedjcsaxgzhzmu`. Until then `/favourites` and `/click` do not exist (the front page shows the editor's favourites and counts nothing).
3. Deploy `assist` with JWT checks on (see `docs/assist.md`) for "Draft with Claude".
4. Check: `curl "https://hfdwmzuedjcsaxgzhzmu.supabase.co/functions/v1/community/favourites" -H "apikey: <publishable key>"` should answer `{"favourites":[]}` until a story has 10 votes in a week. In the SQL editor, `select * from public.weird_clicks order by day desc limit 5;` shows the first clicks.

Before step 1, the console shows no click badges, the favourites preview shows the editor's row, and the hook field still saves (the 200-character database limit allows the console's 140).

## Books put forward and the Book of the Week: going live

1. Apply `migrations/20261117120000_stacks_submissions.sql` (after the two weird-news migrations). It is safe to run twice. It replaces `private.weird_retention()` with the same clean-up plus the submissions' (the existing cron job keeps calling it).
2. Redeploy `community` with JWT checks off: `supabase functions deploy community --no-verify-jwt --project-ref hfdwmzuedjcsaxgzhzmu`. Until then `/book` does not exist (404), and before step 1 it answers 502.
3. Deploy the site (Vercel) for `GET /api/books`. Nothing to configure: it reads with the publishable key; `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` override the defaults if set.
4. Check: `curl -s https://gatecast.vercel.app/api/books | head -c 300` answers the books with `"featured":null` until a pick is set. In the console, The Stacks → Books shows the queue and Book of the week.

Before step 1, the console's Books view says it arrives with the migration, and `/api/books` serves the static books with `featured: null`.

## Pick media: going live

1. Apply `migrations/20261117150000_pick_media.sql` (after `20261116160000_weird_community.sql`). It is safe to run twice. It adds two nullable columns, so no existing pick changes.
2. Deploy the site (Vercel): `/api/yt-thumb` (the video still, served by Gatecast) and the new `/api/weird` fields. Nothing to configure: no YouTube key is needed (oEmbed and the still are public).
3. Check: `select id, video_id, image_url from public.weird_picks where status = 'published';` in the SQL editor; `curl -s "https://gatecast.vercel.app/api/weird?limit=3"` shows `"youtube": {...}` for a pick with a working video; `curl -sI "https://gatecast.vercel.app/api/yt-thumb?id=<id>"` answers `200 image/jpeg` with `Cache-Control: public, max-age=86400, s-maxage=86400, …`.

Before step 1, the site reads picks without the two columns (one extra request when the first is refused), and the console saves picks without media and says the migration is needed when media is given.

To remove a vote or tip by hand (for example after abuse), use the SQL editor: `delete from public.weird_tips where id = '<id>';`. To see today's tip volume: `select hits from private.weird_rate where key = 'tip:all' order by window_start desc limit 1;`.

---

Reviewer console: [`review.html`](../review.html) (not linked from the site's navigation).
