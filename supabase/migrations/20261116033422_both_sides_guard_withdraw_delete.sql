-- Both sides: close two gaps in the first migration.
--
-- The publish check only ran when a topic was becoming or staying published,
-- so a request made with the secret key could still withdraw a published
-- topic (which also unfroze its statements) or delete it, and a delete was
-- not logged. Now, through the API, only a reviewer can withdraw or delete a
-- published topic, and deletions are logged.

alter table private.review_log drop constraint review_log_action_check;
alter table private.review_log add constraint review_log_action_check
  check (action in ('published', 'withdrawn', 'deleted'));

create or replace function private.topics_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_published boolean := tg_op = 'UPDATE' and old.status = 'published';
begin
  if (new.status = 'published' or was_published) and not private.may_publish() then
    raise exception 'Only a reviewer can publish, change or withdraw a published topic'
      using errcode = '42501';
  end if;

  if new.status = 'published' and not was_published then
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

  elsif was_published and new.status <> 'published' then
    new.published_at := null;
    insert into private.review_log (topic_id, title, action, actor)
    values (new.id, new.title, 'withdrawn', (select auth.uid()));
  end if;

  return new;
end;
$$;

create function private.topics_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    if not private.may_publish() then
      raise exception 'Only a reviewer can delete a published topic'
        using errcode = '42501';
    end if;
    insert into private.review_log (topic_id, title, action, actor)
    values (old.id, old.title, 'deleted', (select auth.uid()));
  end if;
  return old;
end;
$$;

create trigger topics_delete_guard
  before delete on public.topics
  for each row execute function private.topics_delete_guard();

revoke all on function private.topics_delete_guard() from public;
