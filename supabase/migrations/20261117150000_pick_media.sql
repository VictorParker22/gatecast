-- The editor's own media for a pick: a YouTube video and a picture, so a story whose outlet offers neither in its feed
-- (UPI's Odd News feed has no pictures, and its pages refuse automated reads) can still lead with something to look
-- at. Owner request, 17 Nov 2026. Written, not applied: the lead applies it.
--
-- Safe to run twice: columns are added only if missing, the checks are dropped and added again, and the guard
-- function is replaced whole.
--
--   public.weird_picks.video_id   a YouTube video id (11 characters). The site checks it with YouTube's oEmbed
--                                 before it is served (lib/youtube.js) and shows it as a click-to-play still served
--                                 by Gatecast (api/yt-thumb.js); YouTube's player loads only after Play.
--   public.weird_picks.image_url  a picture on the story's own site or the outlet's image server (the console and
--                                 lib/weird.js check the host; the database checks https and length). Hotlinked and
--                                 credited like a feed picture.
--
-- Who can do what does not change: visitors (the publishable key) read the two columns of published picks; reviewers
-- write them through the console's ordinary table writes (the existing row rules). Changing either on a published
-- pick is an edit: only a reviewer may make it, and it is logged in private.weird_picks_log.

alter table public.weird_picks add column if not exists video_id text;
alter table public.weird_picks add column if not exists image_url text;

alter table public.weird_picks drop constraint if exists weird_picks_video_id_check;
alter table public.weird_picks add constraint weird_picks_video_id_check
  check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');

alter table public.weird_picks drop constraint if exists weird_picks_image_url_check;
alter table public.weird_picks add constraint weird_picks_image_url_check
  check (image_url is null or (image_url ~ '^https://[^[:space:]]+$' and char_length(image_url) <= 2048));

comment on column public.weird_picks.video_id is
  'The editor''s YouTube video for the story (11-character id), or null. Checked with YouTube oEmbed before it is served; played from youtube-nocookie.com only after the reader presses Play.';
comment on column public.weird_picks.image_url is
  'The editor''s picture for the story: an https address on the story''s own site or the outlet''s image server (data/weird-sources.json imageHosts), or null. Hotlinked and credited to the outlet.';

-- Visitors read the published picks' public columns, now including the media.
grant select (video_id, image_url) on public.weird_picks to anon;

-- The guard from 20261116160000_weird_community.sql, unchanged except that a change to the video or the picture of a
-- published pick is an edit too (reviewers only, logged).
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
  elsif was_published and (new.url, new.title, new.outlet, new.published, new.category, new.rating, new.note, new.video_id, new.image_url)
                     is distinct from (old.url, old.title, old.outlet, old.published, old.category, old.rating, old.note, old.video_id, old.image_url) then
    insert into private.weird_picks_log (pick_id, url, title, action, actor)
    values (new.id, new.url, new.title, 'edited', (select auth.uid()));
  end if;

  return new;
end;
$$;

revoke all on function private.weird_picks_guard() from public, anon, authenticated, service_role;
