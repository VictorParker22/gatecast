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

Which pages read it:

- **Today page** (`js/civic.js`): "Your statehouse" (the visitor's state's latest votes) and "Both sides" (published topics), with the publishable key in `js/config.js`.
- **Reviewer console** (`review.html`, `js/review.js`): reviewers sign in with an emailed link and work the queue.

## Who can read and write what

The publishable key in `js/config.js` is public by design. Row-level security in the migrations decides what each request may do:

- **Visitors** read published topics and their statements, and votes that are not hidden while the switch is on. Nothing else.
- **Reviewers** (signed in and listed in `public.reviewers`) read everything in the queue, write drafts, publish, withdraw and reject.
- **The collector** runs inside Supabase with the service role key. It writes votes; like any request with that key it could write queue drafts, but the triggers stop it publishing or changing anything published, and it cannot name a reviewer.
- **The project owner** (SQL editor) is unrestricted. This is the only way to add a reviewer or flip a switch.

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
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`: provided by Supabase to every function.

The cron job authenticates with the project's anon key, which is public; the repository copy still leaves it out.

---

Reviewer console: [`review.html`](../review.html) (not linked from the site's navigation).
