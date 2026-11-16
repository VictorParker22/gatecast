-- Both sides: the review queue.
--
-- A topic is one neutral fact with statements from each side attached.
-- Nothing is visible to visitors until a reviewer publishes it.
--
-- Who can do what
--   visitor (publishable key)  read published topics and their statements
--   reviewer (signed in, listed in public.reviewers)
--                              read everything, write drafts, publish
--   pipeline (secret key)      read and write drafts; cannot publish and
--                              cannot name reviewers
--   project owner (SQL editor) unrestricted; this is how reviewers are added
--
-- Two rules are enforced by triggers, because the secret key skips row rules:
--   1. Through the API, only a reviewer can publish a topic or change a
--      published one.
--   2. A topic needs a statement from each side to be published, and its
--      statements are frozen while it is published.

create schema if not exists private;

-- ───────────────────────────── tables ─────────────────────────────

create table public.reviewers (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
comment on table public.reviewers is
  'People allowed to publish. Rows are added by the project owner in the SQL editor, never through the API.';

create table public.topics (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(title) between 1 and 200),
  place               text not null default 'US' check (place ~ '^[A-Z]{2}$'),
  neutral_fact        text not null check (char_length(neutral_fact) between 1 and 600),
  neutral_fact_source text not null check (neutral_fact_source ~ '^https://'),
  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'rejected')),
  created_at          timestamptz not null default now(),
  published_at        timestamptz
);
comment on column public.topics.place is
  'US for national, otherwise a two-letter state code.';

create table public.statements (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.topics (id) on delete cascade,
  side       text not null check (side in ('D', 'R', 'other')),
  speaker    text not null check (char_length(speaker) between 1 and 120),
  role       text check (char_length(role) <= 160),
  quote      text not null check (char_length(quote) between 1 and 1200),
  said_on    date,
  source_url text not null check (source_url ~ '^https://'),
  created_at timestamptz not null default now()
);

create index statements_topic_id_idx on public.statements (topic_id);
create index topics_published_idx on public.topics (place, published_at desc)
  where status = 'published';

-- Who published or withdrew what, and when. Not reachable through the API.
create table private.review_log (
  id       bigint generated always as identity primary key,
  topic_id uuid not null,
  title    text not null,
  action   text not null check (action in ('published', 'withdrawn')),
  actor    uuid,
  at       timestamptz not null default now()
);
alter table private.review_log enable row level security;

-- ───────────────────────────── helpers ─────────────────────────────

create function private.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reviewers r where r.user_id = (select auth.uid())
  );
$$;

-- True for a reviewer, and for a direct database session (no API request).
-- A request made with the secret key carries API claims but no reviewer, so
-- it gets false.
create function private.may_publish()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
      or private.is_reviewer();
$$;

create function private.topics_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' then
    if not private.may_publish() then
      raise exception 'Only a reviewer can publish a topic or change a published one'
        using errcode = '42501';
    end if;

    if tg_op = 'INSERT' or old.status <> 'published' then
      if not exists (select 1 from public.statements s
                     where s.topic_id = new.id and s.side = 'D')
         or not exists (select 1 from public.statements s
                        where s.topic_id = new.id and s.side = 'R') then
        raise exception 'A topic needs a statement from each side before it can be published'
          using errcode = '23514';
      end if;
      new.published_at := now();
      insert into private.review_log (topic_id, title, action, actor)
      values (new.id, new.title, 'published', (select auth.uid()));
    end if;

  elsif tg_op = 'UPDATE' and old.status = 'published' then
    new.published_at := null;
    insert into private.review_log (topic_id, title, action, actor)
    values (new.id, new.title, 'withdrawn', (select auth.uid()));
  end if;

  return new;
end;
$$;

create trigger topics_guard
  before insert or update on public.topics
  for each row execute function private.topics_guard();

create function private.statements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.topics t
    where t.status = 'published'
      and t.id in (
        case when tg_op <> 'INSERT' then old.topic_id end,
        case when tg_op <> 'DELETE' then new.topic_id end
      )
  ) then
    raise exception 'Statements are frozen while their topic is published; set the topic back to draft first'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger statements_guard
  before insert or update or delete on public.statements
  for each row execute function private.statements_guard();

revoke all on function private.is_reviewer()      from public;
revoke all on function private.may_publish()      from public;
revoke all on function private.topics_guard()     from public;
revoke all on function private.statements_guard() from public;
grant execute on function private.is_reviewer() to anon, authenticated;

-- ───────────────────────── access: grants ─────────────────────────

revoke all on public.reviewers, public.topics, public.statements
  from public, anon, authenticated, service_role;

grant select on public.topics, public.statements to anon;
grant select, insert, update, delete on public.topics, public.statements
  to authenticated, service_role;
grant select on public.reviewers to authenticated;
-- service_role gets nothing on public.reviewers: the pipeline's key must not
-- be able to name a reviewer.

-- ────────────────────────── access: rows ──────────────────────────

alter table public.reviewers  enable row level security;
alter table public.topics     enable row level security;
alter table public.statements enable row level security;

create policy "See your own reviewer row"
  on public.reviewers for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Published topics are public; reviewers see all"
  on public.topics for select to anon, authenticated
  using (status = 'published' or (select private.is_reviewer()));

create policy "Reviewers add topics"
  on public.topics for insert to authenticated
  with check ((select private.is_reviewer()));

create policy "Reviewers change topics"
  on public.topics for update to authenticated
  using ((select private.is_reviewer()))
  with check ((select private.is_reviewer()));

create policy "Reviewers delete topics"
  on public.topics for delete to authenticated
  using ((select private.is_reviewer()));

create policy "Statements of published topics are public; reviewers see all"
  on public.statements for select to anon, authenticated
  using (
    exists (select 1 from public.topics t
            where t.id = topic_id and t.status = 'published')
    or (select private.is_reviewer())
  );

create policy "Reviewers add statements"
  on public.statements for insert to authenticated
  with check ((select private.is_reviewer()));

create policy "Reviewers change statements"
  on public.statements for update to authenticated
  using ((select private.is_reviewer()))
  with check ((select private.is_reviewer()));

create policy "Reviewers delete statements"
  on public.statements for delete to authenticated
  using ((select private.is_reviewer()));
