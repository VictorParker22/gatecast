-- Weird news: reader votes (the Weird-o-meter), guestbook tips, and the editor's picks.
--
-- Applied to the gatecast project on 16 Nov 2026. Safe to run twice. See docs/community.md and
-- supabase/README.md. Needs the `community` Edge Function (supabase/functions/community) and its
-- COMMUNITY_SALT secret for votes and tips; picks work through the API on their own.
--
-- What it adds
--   public.weird_votes          one 1-5 rating per visitor per story. No API role can read or write the
--                               table: votes go in through public.weird_cast_vote (service role only)
--   public.weird_ratings()      per-story vote count and average, the average only once 50 people have
--                               voted. Anyone may call it; it never returns a single vote or a voter
--   public.weird_tips           links visitors send through the guestbook. Written only through
--                               public.weird_submit_tip (service role); reviewers read them and set status
--   public.weird_picks          the editor's picks, curated in the reviewer console. Visitors read the
--                               published ones; reviewers manage all of them
--   public.weird_pick_activity() a pick's publish / withdraw / edit / delete history, for reviewers
--   private.weird_rate          fixed-window counters behind the vote and tip limits
--   private.weird_vote_archive  per-story totals of votes older than 90 days, kept without any voter hash
--   private.weird_picks_log     who published, withdrew, edited or deleted which pick
--   cron job weird-community-retention   daily clean-up (90-day retention, see docs/community.md)
--
-- Who can do what
--   visitor (publishable key)  read published picks; call weird_ratings (aggregates only)
--   reviewer (signed in, listed in public.reviewers)
--                              read tips (not their address hash) and accept or reject them;
--                              read, write, publish, withdraw and delete picks; read pick history
--   community function (service role)
--                              cast votes and store tips through the two functions, which enforce the limits.
--                              It gets no direct access to any of these tables
--   project owner (SQL editor) unrestricted
--
-- Limits, enforced here so that several function instances share them
--   votes  60 per visitor per hour
--   tips   5 per visitor per UTC day, 200 in all per UTC day

create schema if not exists private;
create extension if not exists pg_cron with schema pg_catalog;

-- ───────────────────────────── tables ─────────────────────────────

create table if not exists public.weird_votes (
  story_id   text not null check (story_id ~ '^[0-9a-f]{16}$'),
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  rating     smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (story_id, voter_hash)
);
comment on table public.weird_votes is
  'Weird-o-meter votes: one 1-5 rating per visitor per story; a second vote replaces the first. Written only through public.weird_cast_vote. Rows are folded into private.weird_vote_archive 90 days after their last change.';
comment on column public.weird_votes.story_id is
  'First 16 hex characters of SHA-256 of the normalised story URL (see docs/community.md).';
comment on column public.weird_votes.voter_hash is
  'SHA-256 of the COMMUNITY_SALT secret and the visitor''s network address (IPv6: its /64). Never the address itself.';

create index if not exists weird_votes_updated_idx on public.weird_votes (updated_at);

create table if not exists public.weird_tips (
  id          uuid primary key default gen_random_uuid(),
  url         text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048),
  note        text check (note is null or char_length(note) <= 280),
  created_at  timestamptz not null default now(),
  ip_hash     text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  reviewed_by uuid references public.reviewers (user_id) on delete set null,
  reviewed_at timestamptz
);
comment on table public.weird_tips is
  'Guestbook tips: a link to a weird story and an optional note. Written only through public.weird_submit_tip; the link is never fetched. Deleted 90 days after they arrive.';
comment on column public.weird_tips.ip_hash is
  'SHA-256 of the COMMUNITY_SALT secret, the sender''s network address and the UTC day, so it cannot link tips across days. Cleared after 7 days; reviewers cannot read it.';
comment on column public.weird_tips.reviewed_by is
  'The reviewer who last set the status. Set by a trigger, never by the request.';

create index if not exists weird_tips_status_idx on public.weird_tips (status, created_at);
create index if not exists weird_tips_url_idx on public.weird_tips (url);

create table if not exists public.weird_picks (
  id           uuid primary key default gen_random_uuid(),
  url          text not null unique check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048),
  title        text not null check (char_length(title) between 1 and 300),
  outlet       text not null check (char_length(outlet) between 1 and 120),
  published    date,
  category     text not null default 'other'
                 check (category in ('people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other')),
  rating       smallint check (rating is null or rating between 1 and 5),
  note         text check (note is null or char_length(note) <= 200),
  status       text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
comment on table public.weird_picks is
  'The editor''s picks on the weird-news front page. Visitors see published picks only. Replaces data/weird-picks.json once the site reads it (lib/picks-db.js).';
comment on column public.weird_picks.title is 'The outlet''s own headline, as published.';
comment on column public.weird_picks.published is 'The day the outlet published the story.';
comment on column public.weird_picks.rating is 'The editor''s own weird rating, 1-5. Not a reader vote.';
comment on column public.weird_picks.note is 'The editor''s own one line, at most 200 characters. Never article text.';

create index if not exists weird_picks_published_idx on public.weird_picks (published desc)
  where status = 'published';

-- Fixed-window counters for the limits. Rows older than two days are deleted daily.
create table if not exists private.weird_rate (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
alter table private.weird_rate enable row level security;
comment on table private.weird_rate is
  'Vote and tip counters per voter hash, per tip hash and in total. Not reachable through the API; purged after two days.';

-- Totals of votes older than 90 days. No voter hash survives the move.
create table if not exists private.weird_vote_archive (
  story_id   text primary key check (story_id ~ '^[0-9a-f]{16}$'),
  votes      integer not null default 0 check (votes >= 0),
  rating_sum integer not null default 0 check (rating_sum >= 0)
);
alter table private.weird_vote_archive enable row level security;
comment on table private.weird_vote_archive is
  'Per-story vote totals folded in from public.weird_votes after 90 days, so the average survives without the voter hashes.';

create table if not exists private.weird_picks_log (
  id      bigint generated always as identity primary key,
  pick_id uuid not null,
  url     text not null,
  title   text not null,
  action  text not null check (action in ('published', 'withdrawn', 'edited', 'deleted')),
  actor   uuid,
  at      timestamptz not null default now()
);
alter table private.weird_picks_log enable row level security;
comment on table private.weird_picks_log is
  'Who published, withdrew, edited (while published) or deleted which pick. Read through public.weird_pick_activity.';

-- ───────────────────────────── limits ─────────────────────────────

-- Counts one use of key in the current window. Returns 0 when it is within max, otherwise the seconds until the
-- window ends. Windows are aligned to UTC (a one-day window is a UTC calendar day).
create or replace function private.weird_take(p_key text, p_window interval, p_max integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w_start timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00');
  n integer;
begin
  insert into private.weird_rate as r (key, window_start, hits)
  values (p_key, w_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  if n > p_max then
    return greatest(1, ceil(extract(epoch from (w_start + p_window - now())))::integer);
  end if;
  return 0;
end;
$$;
comment on function private.weird_take(text, interval, integer) is
  'One use of a fixed-window limit: 0 when allowed, otherwise seconds until the window resets.';

-- ───────────────────────────── votes ─────────────────────────────

-- Count and average per story, live votes plus the archive. The average is null until 50 people have voted:
-- the front page promises "the readers' average shows once 50 people have voted". At most 60 ids per call;
-- anything that is not a story id is ignored. Every id asked for gets a row, with 0 votes when it has none.
create or replace function public.weird_ratings(ids text[])
returns table (story_id text, votes integer, average numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select distinct w.id
    from unnest(ids[1:60]) as w(id)
    where w.id ~ '^[0-9a-f]{16}$'
  ),
  live as (
    select v.story_id, count(*)::integer as n, sum(v.rating)::integer as s
    from public.weird_votes v
    where v.story_id in (select id from wanted)
    group by v.story_id
  ),
  total as (
    select w.id,
           coalesce(l.n, 0) + coalesce(a.votes, 0) as n,
           coalesce(l.s, 0) + coalesce(a.rating_sum, 0) as s
    from wanted w
    left join live l on l.story_id = w.id
    left join private.weird_vote_archive a on a.story_id = w.id
  )
  select t.id, t.n::integer,
         case when t.n >= 50 then round(t.s::numeric / t.n, 1) end
  from total t;
$$;
comment on function public.weird_ratings(text[]) is
  'Weird-o-meter totals for up to 60 story ids: votes and, once there are 50 or more, the average rounded to one decimal. Never returns a single vote or voter.';

-- Records or replaces one visitor's vote on one story, within 60 votes per visitor per hour.
-- Returns { ok, votes, average, yours } or { ok: false, error: 'rate_limited', retry_after }.
create or replace function public.weird_cast_vote(p_story_id text, p_voter_hash text, p_rating integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wait integer;
  r record;
begin
  if p_story_id is null or p_story_id !~ '^[0-9a-f]{16}$' then
    raise exception 'story id must be 16 hex characters' using errcode = '22023';
  end if;
  if p_voter_hash is null or p_voter_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'voter hash must be 64 hex characters' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be 1 to 5' using errcode = '22023';
  end if;

  wait := private.weird_take('vote:' || p_voter_hash, interval '1 hour', 60);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', wait);
  end if;

  insert into public.weird_votes as v (story_id, voter_hash, rating)
  values (p_story_id, p_voter_hash, p_rating)
  on conflict (story_id, voter_hash) do update set rating = excluded.rating, updated_at = now();

  select * into r from public.weird_ratings(array[p_story_id]);
  return jsonb_build_object('ok', true, 'votes', r.votes, 'average', r.average, 'yours', p_rating);
end;
$$;
comment on function public.weird_cast_vote(text, text, integer) is
  'Weird-o-meter vote from the community function: insert or replace, at most 60 per voter per hour.';

-- ───────────────────────────── tips ─────────────────────────────

-- Stores one tip, within 5 per sender per UTC day and 200 in all per UTC day. A link already waiting in the
-- queue, or already a pick, is not stored twice (the sender still gets ok). The function checks the shape
-- again; the community function has already checked that the link is https to a public host.
-- Returns { ok } or { ok: false, error: 'rate_limited' | 'tips_full', retry_after }.
create or replace function public.weird_submit_tip(p_url text, p_note text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wait integer;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' or char_length(p_url) > 2048 then
    raise exception 'url must be an https link of at most 2048 characters' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 280 then
    raise exception 'note must be at most 280 characters' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip hash must be 64 hex characters' using errcode = '22023';
  end if;

  wait := private.weird_take('tip:' || p_ip_hash, interval '1 day', 5);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', wait);
  end if;

  if exists (select 1 from public.weird_tips t where t.url = p_url and t.status = 'new')
     or exists (select 1 from public.weird_picks p where p.url = p_url) then
    return jsonb_build_object('ok', true);
  end if;

  wait := private.weird_take('tip:all', interval '1 day', 200);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'tips_full', 'retry_after', wait);
  end if;

  insert into public.weird_tips (url, note, ip_hash) values (p_url, clean_note, p_ip_hash);
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.weird_submit_tip(text, text, text) is
  'Guestbook tip from the community function: at most 5 per sender per UTC day and 200 per UTC day in all.';

-- A reviewer may change a tip's status and nothing else; the trigger signs the change.
create or replace function private.weird_tips_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;
  new.url := old.url;
  new.note := old.note;
  new.created_at := old.created_at;
  new.ip_hash := case when new.ip_hash is null then null else old.ip_hash end; -- may only be cleared
  if new.status is distinct from old.status then
    if new.status = 'new' then
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    end if;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists weird_tips_guard on public.weird_tips;
create trigger weird_tips_guard
  before update on public.weird_tips
  for each row execute function private.weird_tips_guard();

-- ───────────────────────────── picks ─────────────────────────────

-- Through the API only a reviewer can publish, withdraw or change a published pick (private.may_publish:
-- a reviewer, or a direct database session). Keeps created_by, created_at, updated_at and published_at
-- honest, and writes publish, withdraw and edits of a published pick to private.weird_picks_log.
create or replace function private.weird_picks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_published boolean := tg_op = 'UPDATE' and old.status = 'published';
begin
  if (new.status = 'published' or was_published) and not private.may_publish() then
    raise exception 'Only a reviewer can publish, change or withdraw a published pick'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    new.published_at := null;
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.published_at := old.published_at;
  end if;
  new.updated_at := now();

  if new.status = 'published' and not was_published then
    new.published_at := now();
    insert into private.weird_picks_log (pick_id, url, title, action, actor)
    values (new.id, new.url, new.title, 'published', (select auth.uid()));
  elsif was_published and new.status <> 'published' then
    new.published_at := null;
    insert into private.weird_picks_log (pick_id, url, title, action, actor)
    values (new.id, new.url, new.title, 'withdrawn', (select auth.uid()));
  elsif was_published and (new.url, new.title, new.outlet, new.published, new.category, new.rating, new.note)
                     is distinct from (old.url, old.title, old.outlet, old.published, old.category, old.rating, old.note) then
    insert into private.weird_picks_log (pick_id, url, title, action, actor)
    values (new.id, new.url, new.title, 'edited', (select auth.uid()));
  end if;

  return new;
end;
$$;

drop trigger if exists weird_picks_guard on public.weird_picks;
create trigger weird_picks_guard
  before insert or update on public.weird_picks
  for each row execute function private.weird_picks_guard();

create or replace function private.weird_picks_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' and not private.may_publish() then
    raise exception 'Only a reviewer can delete a published pick' using errcode = '42501';
  end if;
  insert into private.weird_picks_log (pick_id, url, title, action, actor)
  values (old.id, old.url, old.title, 'deleted', (select auth.uid()));
  return old;
end;
$$;

drop trigger if exists weird_picks_delete_guard on public.weird_picks;
create trigger weird_picks_delete_guard
  before delete on public.weird_picks
  for each row execute function private.weird_picks_delete_guard();

-- A pick's history for the reviewer console, with the email of whoever acted.
create or replace function public.weird_pick_activity(pick uuid)
returns table (action text, actor uuid, actor_email text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can read pick activity' using errcode = '42501';
  end if;

  return query
    select l.action, l.actor, u.email::text, l.at
    from private.weird_picks_log l
    left join auth.users u on u.id = l.actor
    where l.pick_id = weird_pick_activity.pick
    order by l.at;
end;
$$;
comment on function public.weird_pick_activity(uuid) is
  'A pick''s publish, withdraw, edit and delete history. Reviewers only.';

-- ───────────────────────────── retention ─────────────────────────────

-- Daily: votes untouched for 90 days are folded into per-story totals and their rows (with the voter hash)
-- deleted; tips lose their address hash after 7 days and are deleted after 90; limit counters go after 2 days.
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

  delete from private.weird_rate where window_start < now() - interval '2 days';
end;
$$;
comment on function private.weird_retention() is
  'Daily clean-up for weird votes, tips and limit counters. Scheduled as the weird-community-retention cron job.';

-- cron.schedule replaces a job of the same name, so this stays safe to run twice.
select cron.schedule('weird-community-retention', '23 4 * * *', 'select private.weird_retention();');

-- ───────────────────────── access: functions ─────────────────────────

-- Functions are executable by everyone unless revoked.
revoke all on function private.weird_take(text, interval, integer)    from public, anon, authenticated, service_role;
revoke all on function private.weird_tips_guard()                      from public, anon, authenticated, service_role;
revoke all on function private.weird_picks_guard()                     from public, anon, authenticated, service_role;
revoke all on function private.weird_picks_delete_guard()              from public, anon, authenticated, service_role;
revoke all on function private.weird_retention()                       from public, anon, authenticated, service_role;
revoke all on function public.weird_ratings(text[])                    from public, anon, authenticated, service_role;
revoke all on function public.weird_cast_vote(text, text, integer)     from public, anon, authenticated, service_role;
revoke all on function public.weird_submit_tip(text, text, text)       from public, anon, authenticated, service_role;
revoke all on function public.weird_pick_activity(uuid)                from public, anon, authenticated, service_role;

-- Aggregates only, with the 50-vote rule applied inside: safe for anyone.
grant execute on function public.weird_ratings(text[]) to anon, authenticated, service_role;
-- Writes go through the community function, which holds the service role key and the salt.
grant execute on function public.weird_cast_vote(text, text, integer) to service_role;
grant execute on function public.weird_submit_tip(text, text, text)   to service_role;
-- The function itself checks for a reviewer.
grant execute on function public.weird_pick_activity(uuid) to authenticated;

-- ─────────────────────────── access: tables ───────────────────────────

revoke all on public.weird_votes, public.weird_tips, public.weird_picks
  from public, anon, authenticated, service_role;

-- weird_votes: no grants at all. Reads and writes happen inside the definer functions above.

-- weird_tips: reviewers read everything but the address hash, and change the status only.
grant select (id, url, note, created_at, status, reviewed_by, reviewed_at) on public.weird_tips to authenticated;
grant update (status) on public.weird_tips to authenticated;

-- weird_picks: visitors read the published columns; reviewers (checked by the row rules) do the rest.
grant select (id, url, title, outlet, published, category, rating, note, status, published_at, updated_at)
  on public.weird_picks to anon;
grant select, insert, update, delete on public.weird_picks to authenticated;

-- ────────────────────────── access: rows ──────────────────────────

alter table public.weird_votes enable row level security;
alter table public.weird_tips  enable row level security;
alter table public.weird_picks enable row level security;

-- weird_votes deliberately has no policies: with row-level security on and no policy, the API sees nothing.

drop policy if exists "Reviewers read tips" on public.weird_tips;
create policy "Reviewers read tips"
  on public.weird_tips for select to authenticated
  using ((select private.is_reviewer()));

drop policy if exists "Reviewers set tip status" on public.weird_tips;
create policy "Reviewers set tip status"
  on public.weird_tips for update to authenticated
  using ((select private.is_reviewer()))
  with check ((select private.is_reviewer()));

drop policy if exists "Published picks are public; reviewers see all" on public.weird_picks;
create policy "Published picks are public; reviewers see all"
  on public.weird_picks for select to anon, authenticated
  using (status = 'published' or (select private.is_reviewer()));

drop policy if exists "Reviewers add picks" on public.weird_picks;
create policy "Reviewers add picks"
  on public.weird_picks for insert to authenticated
  with check ((select private.is_reviewer()));

drop policy if exists "Reviewers change picks" on public.weird_picks;
create policy "Reviewers change picks"
  on public.weird_picks for update to authenticated
  using ((select private.is_reviewer()))
  with check ((select private.is_reviewer()));

drop policy if exists "Reviewers delete picks that are not published" on public.weird_picks;
create policy "Reviewers delete picks that are not published"
  on public.weird_picks for delete to authenticated
  using ((select private.is_reviewer()) and status <> 'published');
