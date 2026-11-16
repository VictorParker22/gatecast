-- PAUSED ADDITION (owner, 16 Nov 2026): reader favourites and the 140-character hook. Do NOT apply until the
-- owner has planned these. Kept out of migrations/ so `supabase db push` skips it; when approved, move it to
-- migrations/ with a new timestamp. Depends on 20261116160000_weird_community.sql. Safe to run twice.
--
--   public.weird_favourites()  up to 12 stories with at least 10 votes in the last 7 days, best average first,
--                              for a "Reader favourites" strip. Served by GET /functions/v1/community/favourites.
--   weird_picks.note           tightened from 200 to 140 characters (the editor's hook line). Check first that
--                              no existing note is longer: select id, char_length(note) from public.weird_picks
--                              where char_length(note) > 140;

-- Reader favourites: up to 12 stories with at least min_votes votes changed in the last `days` days, best
-- average first, then most votes. Only votes inside the window count (the archive holds no dates). The
-- ranking uses the true average, but the average itself is returned only from 50 votes, like weird_ratings,
-- so the front page's promise holds. days is kept to 1-90 and min_votes to at least 10, so the order of a
-- handful of votes can never be read back.
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

revoke all on function public.weird_favourites(integer, integer) from public, anon, authenticated, service_role;
-- Aggregates only, with the 50-vote rule applied inside: safe for anyone.
grant execute on function public.weird_favourites(integer, integer) to anon, authenticated, service_role;

alter table public.weird_picks drop constraint if exists weird_picks_note_check;
alter table public.weird_picks add constraint weird_picks_note_check check (note is null or char_length(note) <= 140);
comment on column public.weird_picks.note is
  'The editor''s hook: their own words under the headline, at most 140 characters. Never article text; the answer must be in the story.';
