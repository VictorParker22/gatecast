-- The editor's summary of a pick, and a pick's video from any provider with an official embed player.
-- Owner decisions, 17 Nov 2026: a story opens in "story mode" on Gatecast (the TV) instead of sending the reader away;
-- a pick may carry a 2-4 sentence summary in the editor's own words ("In our words"; Claude may draft it, the editor
-- edits and approves it, like the hook); and a pick's video may come from YouTube, Vimeo, Facebook, X, TikTok or
-- Instagram (Instagram as a link-out card only). Written, not applied: the lead applies it, after
-- 20261117150000_pick_media.sql.
--
-- Safe to run twice: columns are added only if missing, the checks are dropped and added again, the backfill only
-- touches rows it has not filled yet, and the guard function is replaced whole.
--
--   public.weird_picks.summary         the editor's summary, 1-700 characters, or null. Never the outlet's text: the
--                                      console and the assistant refuse a run of 8+ words from the headline or page.
--   public.weird_picks.video_provider  'youtube' | 'vimeo' | 'facebook' | 'x' | 'tiktok' | 'instagram', or null.
--   public.weird_picks.video_ref       the provider's reference for the video, in the shape js/mediaproviders.js
--                                      writes (isValidRef): a YouTube id, a Vimeo number, a public Facebook video
--                                      address, an X post number, "account/number" for TikTok, "reel/<code>" (or
--                                      p/, tv/) for Instagram. Set together with video_provider, or both null.
--
-- video_id (from 20261117150000_pick_media.sql) is kept for one release and stays readable: existing YouTube videos
-- are copied into video_provider/video_ref here, the console keeps writing video_id for a YouTube video, and the site
-- reads video_provider/video_ref first. A later migration can drop it once nothing reads it.
--
-- Who can do what does not change: visitors (the publishable key) read the new columns of published picks; reviewers
-- write them through the console's ordinary table writes (table-level grants and the existing row rules). Changing
-- any of them on a published pick is an edit: only a reviewer may make it, and it is logged.

alter table public.weird_picks add column if not exists summary text;
alter table public.weird_picks add column if not exists video_provider text;
alter table public.weird_picks add column if not exists video_ref text;

alter table public.weird_picks drop constraint if exists weird_picks_summary_check;
alter table public.weird_picks add constraint weird_picks_summary_check
  check (summary is null or char_length(summary) between 1 and 700);

alter table public.weird_picks drop constraint if exists weird_picks_video_provider_check;
alter table public.weird_picks add constraint weird_picks_video_provider_check
  check (video_provider is null or video_provider in ('youtube', 'vimeo', 'facebook', 'x', 'tiktok', 'instagram'));

alter table public.weird_picks drop constraint if exists weird_picks_video_ref_check;
alter table public.weird_picks add constraint weird_picks_video_ref_check
  check (
    (video_provider is null and video_ref is null)
    or (video_provider is not null and video_ref is not null and char_length(video_ref) <= 400 and (
         (video_provider = 'youtube'   and video_ref ~ '^[A-Za-z0-9_-]{11}$')
      or (video_provider = 'vimeo'     and video_ref ~ '^[0-9]{6,12}$')
      or (video_provider = 'facebook'  and video_ref ~ '^https://(www\.facebook\.com/([A-Za-z0-9._-]{1,80}/videos/[0-9]{5,25}/|watch/\?v=[0-9]{5,25}|reel/[0-9]{5,25})|fb\.watch/[A-Za-z0-9_-]{4,20}/)$')
      or (video_provider = 'x'         and video_ref ~ '^[0-9]{5,25}$')
      or (video_provider = 'tiktok'    and video_ref ~ '^[A-Za-z0-9._]{1,24}/[0-9]{15,22}$')
      or (video_provider = 'instagram' and video_ref ~ '^(p|reel|tv)/[A-Za-z0-9_-]{5,40}$')
    ))
  );

comment on column public.weird_picks.summary is
  'The editor''s own 2-4 sentence summary ("In our words"), 1-700 characters, or null. Drafted by Claude or written by a reviewer, approved by a reviewer. Never the outlet''s text.';
comment on column public.weird_picks.video_provider is
  'Where the pick''s video plays: youtube, vimeo, facebook, x, tiktok or instagram (a link-out card), or null. Played only after the reader presses Play.';
comment on column public.weird_picks.video_ref is
  'The provider''s reference for the video (js/mediaproviders.js isValidRef), set with video_provider.';
comment on column public.weird_picks.video_id is
  'Deprecated (kept for one release): the YouTube id. video_provider/video_ref are read first.';

-- Existing YouTube videos move to the provider-agnostic columns. The guard is switched off for this one copy so the
-- rows' updated_at and the edit log do not change (nothing a reader sees changes); it is switched on again at once.
alter table public.weird_picks disable trigger weird_picks_guard;
update public.weird_picks
   set video_provider = 'youtube', video_ref = video_id
 where video_id is not null and video_provider is null and video_ref is null;
alter table public.weird_picks enable trigger weird_picks_guard;

-- Visitors read the published picks' public columns, now including the summary and the video's provider and reference.
grant select (summary, video_provider, video_ref) on public.weird_picks to anon;

-- The guard from 20261117150000_pick_media.sql, unchanged except that a change to the summary or to the video's
-- provider or reference of a published pick is an edit too (reviewers only, logged).
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
  elsif was_published and (new.url, new.title, new.outlet, new.published, new.category, new.rating, new.note, new.video_id, new.image_url, new.summary, new.video_provider, new.video_ref)
                     is distinct from (old.url, old.title, old.outlet, old.published, old.category, old.rating, old.note, old.video_id, old.image_url, old.summary, old.video_provider, old.video_ref) then
    insert into private.weird_picks_log (pick_id, url, title, action, actor)
    values (new.id, new.url, new.title, 'edited', (select auth.uid()));
  end if;

  return new;
end;
$$;

revoke all on function private.weird_picks_guard() from public, anon, authenticated, service_role;
