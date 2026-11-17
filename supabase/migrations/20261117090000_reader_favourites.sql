-- Reader favourites, the 140-character hook line and anonymous click totals for weird stories.
--
-- Owner decisions, 17 Nov 2026: (1) hook lines are drafted by the reviewer assistant (Claude) and a person edits and
-- approves every one; (2) clicks on weird stories are counted as anonymous totals per story per day, disclosed on
-- the How page and shown to the editor in the reviewer console; (3) the favourites row keeps the editor's order
-- until a story has 10 or more Weird-o-meter votes in the last 7 days, then readers' votes rank it.
--
-- Applied to the live project on 17 Nov 2026. Depends on 20261116160000_weird_community.sql. Safe to run twice.
-- Replaces supabase/paused/weird_favourites.sql (merged here). See docs/community.md and supabase/README.md.
--
-- What it adds or changes
--   public.weird_favourites()    up to 12 stories with at least 10 votes in the last 7 days, best average first,
--                                then most votes. Served by GET /functions/v1/community/favourites
--   weird_picks.note             tightened from 200 to 140 characters: the hook line under the headline
--   public.weird_clicks          one row per story per UTC day: the number of clicks on that story's link. No address,
--                                hash, time of day or anything else about the reader. No API role can read or write it
--   public.weird_count_click()   adds one click, at most 120 per visitor per hour (service role only: the community
--                                function calls it from POST /community/click)
--   public.weird_click_totals()  clicks per story over the last 1-90 days (default 7), for reviewers only
--   private.weird_retention()    also deletes click rows older than 90 days
--
-- Who can do what
--   visitor (publishable key)  call weird_favourites (aggregates only, the 50-vote rule applied inside)
--   reviewer                   call weird_click_totals
--   community function (service role)
--                              call weird_count_click; no direct access to weird_clicks
--   project owner (SQL editor) unrestricted

-- ───────────────────────────── the hook line ─────────────────────────────

-- Notes are the editor's hook from now on: at most 140 characters. Stop here, without changing anything, if an
-- existing note is longer, so no editor's words are cut silently. (All notes were empty on 17 Nov 2026.)
do $$
declare
  n integer;
begin
  select count(*) into n from public.weird_picks where char_length(note) > 140;
  if n > 0 then
    raise exception '% pick note(s) are longer than 140 characters. Shorten them first: select id, char_length(note), note from public.weird_picks where char_length(note) > 140;', n
      using errcode = '23514';
  end if;
end;
$$;

alter table public.weird_picks drop constraint if exists weird_picks_note_check;
alter table public.weird_picks add constraint weird_picks_note_check check (note is null or char_length(note) <= 140);
comment on column public.weird_picks.note is
  'The hook line shown under the headline, at most 140 characters. May be drafted by the reviewer assistant (Claude) from the headline; a reviewer edits and saves every one. Never article text; the answer must be in the story.';

-- ───────────────────────────── reader favourites ─────────────────────────────

-- Up to 12 stories with at least min_votes votes changed in the last `days` days, best average first, then most
-- votes. Only votes inside the window count (the archive holds no dates). The ranking uses the true average, but the
-- average itself is returned only from 50 votes, like weird_ratings, so the front page's promise holds. days is kept
-- to 1-90 and min_votes to at least 10, so the order of a handful of votes can never be read back.
create or replace function public.weird_favourites(days integer default 7, min_votes integer default 10)
returns table (story_id text, votes integer, average numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select v.story_id, count(*)::integer as n, avg(v.rating) as a
    from public.weird_votes v
    where v.updated_at >= now() - make_interval(days => least(greatest(coalesce(weird_favourites.days, 7), 1), 90))
    group by v.story_id
    having count(*) >= greatest(coalesce(weird_favourites.min_votes, 10), 10)
  )
  select w.story_id, w.n, case when w.n >= 50 then round(w.a, 1) end
  from win w
  order by w.a desc, w.n desc, w.story_id
  limit 12;
$$;
comment on function public.weird_favourites(integer, integer) is
  'Reader favourites for the front page: up to 12 stories ranked by average then votes, within a 1-90 day window and at least 10 votes. Average shown only from 50 votes.';

-- ───────────────────────────── clicks ─────────────────────────────

-- One row per story per UTC day. Nothing about who clicked: the community function checks a salted, daily-changing
-- hash of the visitor's address against the rate limit (private.weird_rate, purged after 2 days) and passes no
-- hash here.
create table if not exists public.weird_clicks (
  story_id text not null check (story_id ~ '^[0-9a-f]{16}$'),
  day      date not null,
  clicks   integer not null default 0 check (clicks >= 0),
  primary key (story_id, day)
);
comment on table public.weird_clicks is
  'Anonymous click totals per weird story per UTC day, so the editor can see which stories land. No address, hash or time of day. Written only through public.weird_count_click; read by reviewers through public.weird_click_totals; rows deleted after 90 days.';
comment on column public.weird_clicks.story_id is
  'First 16 hex characters of SHA-256 of the normalised story URL (the same id as weird_votes; see docs/community.md).';

create index if not exists weird_clicks_day_idx on public.weird_clicks (day);

-- Adds one click to a story's count for today (UTC), within 120 clicks per visitor per hour. p_ip_hash is used only
-- for the limit (as a key in private.weird_rate) and is not stored with the click.
-- Returns { ok } or { ok: false, error: 'rate_limited', retry_after }.
create or replace function public.weird_count_click(p_story_id text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wait integer;
begin
  if p_story_id is null or p_story_id !~ '^[0-9a-f]{16}$' then
    raise exception 'story id must be 16 hex characters' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip hash must be 64 hex characters' using errcode = '22023';
  end if;

  wait := private.weird_take('click:' || p_ip_hash, interval '1 hour', 120);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', wait);
  end if;

  insert into public.weird_clicks as c (story_id, day, clicks)
  values (p_story_id, (now() at time zone 'utc')::date, 1)
  on conflict (story_id, day) do update set clicks = c.clicks + 1;

  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.weird_count_click(text, text) is
  'One click on a weird story from the community function: adds to today''s total, at most 120 per visitor per hour. Stores no hash with the click.';

-- Total clicks per story over the last `days` UTC days, today included (1-90, default 7), for up to 500 story ids.
-- Stories without clicks are left out. Reviewers only.
create or replace function public.weird_click_totals(ids text[], days integer default 7)
returns table (story_id text, clicks integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can read click totals' using errcode = '42501';
  end if;

  return query
    select c.story_id, sum(c.clicks)::integer
    from public.weird_clicks c
    where c.story_id = any (weird_click_totals.ids[1:500])
      and c.day > (now() at time zone 'utc')::date - least(greatest(coalesce(weird_click_totals.days, 7), 1), 90)
    group by c.story_id;
end;
$$;
comment on function public.weird_click_totals(text[], integer) is
  'Clicks per weird story over the last 1-90 UTC days (default 7). Reviewers only.';

-- ───────────────────────────── retention ─────────────────────────────

-- The daily clean-up from 20261116160000_weird_community.sql, plus click rows older than 90 days. Click rows hold no
-- personal data, but the How page promises 90 days, and old totals are no use to the editor.
create or replace function private.weird_retention()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  with old as (
    delete from public.weird_votes v
    where v.updated_at < now() - interval '90 days'
    returning v.story_id, v.rating
  )
  insert into private.weird_vote_archive as a (story_id, votes, rating_sum)
  select o.story_id, count(*)::integer, sum(o.rating)::integer
  from old o
  group by o.story_id
  on conflict (story_id) do update
    set votes = a.votes + excluded.votes, rating_sum = a.rating_sum + excluded.rating_sum;

  update public.weird_tips set ip_hash = null
  where ip_hash is not null and created_at < now() - interval '7 days';

  delete from public.weird_tips where created_at < now() - interval '90 days';

  delete from public.weird_clicks where day < (now() at time zone 'utc')::date - 90;

  delete from private.weird_rate where window_start < now() - interval '2 days';
end;
$$;
comment on function private.weird_retention() is
  'Daily clean-up for weird votes, tips, click totals and limit counters. Scheduled as the weird-community-retention cron job.';

-- ───────────────────────── access ─────────────────────────

-- Functions are executable by everyone unless revoked.
revoke all on function public.weird_favourites(integer, integer)  from public, anon, authenticated, service_role;
revoke all on function public.weird_count_click(text, text)       from public, anon, authenticated, service_role;
revoke all on function public.weird_click_totals(text[], integer) from public, anon, authenticated, service_role;
revoke all on function private.weird_retention()                  from public, anon, authenticated, service_role;

-- Aggregates only, with the 50-vote rule applied inside: safe for anyone.
grant execute on function public.weird_favourites(integer, integer) to anon, authenticated, service_role;
-- Clicks go in through the community function, which holds the service role key and the salt.
grant execute on function public.weird_count_click(text, text) to service_role;
-- The function itself checks for a reviewer.
grant execute on function public.weird_click_totals(text[], integer) to authenticated;

-- weird_clicks: no grants at all, and row-level security on with no policies, so the API sees nothing. Reads and
-- writes happen inside the definer functions above.
revoke all on public.weird_clicks from public, anon, authenticated, service_role;
alter table public.weird_clicks enable row level security;
