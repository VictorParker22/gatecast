-- Reviewer console (review.html): what the console needs beyond the review queue.
--
-- Written for the owner to apply; not applied yet. Safe to run twice.
--
-- What it adds
--   public.topic_notes          internal notes on a topic, for reviewers only (never shown to visitors)
--   public.review_activity()    a topic's publish / withdraw / delete history from private.review_log,
--                               for reviewers only
--   state_votes, for reviewers  read every vote, hidden ones included, whether or not the state_votes
--                               switch is on, and set the hidden flag (that column only)
--   collector health            reviewers can read collector_states and collector_runs
--
-- Who can do what afterwards
--   visitor (publishable key)  unchanged: published topics, and votes that are not hidden while the switch is on
--   reviewer (signed in, listed in public.reviewers)
--                              the above, plus notes, activity, hiding a vote, collector health
--   pipeline (secret key)      unchanged; it gets nothing on topic_notes
--   signed in, not a reviewer  nothing new: every rule below checks private.is_reviewer()

-- ───────────────────────────── notes ─────────────────────────────

create table if not exists public.topic_notes (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.topics (id) on delete cascade,
  author     uuid default auth.uid() references auth.users (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
comment on table public.topic_notes is
  'Reviewers'' internal notes on a topic, such as why it was rejected. Never shown to visitors.';

create index if not exists topic_notes_topic_id_idx on public.topic_notes (topic_id, created_at);

revoke all on public.topic_notes from public, anon, authenticated, service_role;
grant select, insert, delete on public.topic_notes to authenticated;

alter table public.topic_notes enable row level security;

drop policy if exists "Reviewers read notes" on public.topic_notes;
create policy "Reviewers read notes"
  on public.topic_notes for select to authenticated
  using ((select private.is_reviewer()));

-- A note is always signed by whoever writes it.
drop policy if exists "Reviewers add notes as themselves" on public.topic_notes;
create policy "Reviewers add notes as themselves"
  on public.topic_notes for insert to authenticated
  with check ((select private.is_reviewer()) and author = (select auth.uid()));

drop policy if exists "Reviewers delete their own notes" on public.topic_notes;
create policy "Reviewers delete their own notes"
  on public.topic_notes for delete to authenticated
  using ((select private.is_reviewer()) and author = (select auth.uid()));

-- ───────────────────────────── activity ─────────────────────────────

-- private.review_log is not reachable through the API. This hands one topic's rows to a reviewer, with the
-- email of whoever acted (null for a direct database session).
create or replace function public.review_activity(topic uuid)
returns table (action text, actor uuid, actor_email text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can read review activity'
      using errcode = '42501';
  end if;

  return query
    select l.action, l.actor, u.email::text, l.at
    from private.review_log l
    left join auth.users u on u.id = l.actor
    where l.topic_id = review_activity.topic
    order by l.at;
end;
$$;

-- Functions in public are executable by everyone unless revoked.
revoke all on function public.review_activity(uuid) from public, anon, service_role;
grant execute on function public.review_activity(uuid) to authenticated;

-- ─────────────────────────── state votes ───────────────────────────

-- Reviewers see every vote, so they can check what visitors would see before the switch is turned on.
drop policy if exists "Reviewers read every vote, whatever the switch" on public.state_votes;
create policy "Reviewers read every vote, whatever the switch"
  on public.state_votes for select to authenticated
  using ((select private.is_reviewer()));

-- Reviewers may hide or show a vote. The column grant keeps everything else read-only: the counts, title and
-- links stay exactly as the collector copied them from the record.
revoke update on public.state_votes from authenticated;
grant update (hidden) on public.state_votes to authenticated;

drop policy if exists "Reviewers hide or show votes" on public.state_votes;
create policy "Reviewers hide or show votes"
  on public.state_votes for update to authenticated
  using ((select private.is_reviewer()))
  with check ((select private.is_reviewer()));

-- ───────────────────────── collector health ─────────────────────────

grant select on public.collector_states, public.collector_runs to authenticated;

drop policy if exists "Reviewers read collector states" on public.collector_states;
create policy "Reviewers read collector states"
  on public.collector_states for select to authenticated
  using ((select private.is_reviewer()));

drop policy if exists "Reviewers read collector runs" on public.collector_runs;
create policy "Reviewers read collector runs"
  on public.collector_runs for select to authenticated
  using ((select private.is_reviewer()));
