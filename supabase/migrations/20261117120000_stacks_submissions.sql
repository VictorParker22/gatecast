-- The Stacks: books put forward by their author or publisher, and the Book of the Week.
--
-- Owner decisions, 17 Nov 2026: (1) an author or their publisher puts a book forward with a form; it waits in the
-- reviewer console, and the editor approves it and writes the description, content note, caveat and tags, so every
-- word on the shelf is the editor's. Only real, published books that fit a shelf; no payment and no promised place.
-- (2) Approved books carry "Suggested by the author" (or "by the publisher"). (3) The editor picks a Book of the Week
-- (any book on the shelves) with a one-line reason; it shows within about 5 minutes, and stays up until the next pick.
--
-- Written 17 Nov 2026, not applied yet. Depends on 20261116160000_weird_community.sql (private.weird_take,
-- private.weird_rate) and 20261117090000_reader_favourites.sql (whose private.weird_retention() this replaces, keeping
-- everything it does). Safe to run twice. See docs/community.md and supabase/README.md.
--
-- What it adds or changes
--   public.stacks_submissions      books put forward through the community function's POST /community/book. Written
--                                  only by public.stacks_submit_book (service role). Reviewers read them (not the
--                                  address hash) and decide through the two functions below
--   public.stacks_books            approved books, in the shape of data/books.json. Anyone reads the visible ones;
--                                  written only by the reviewer functions below
--   public.stacks_featured         the Book of the Week, one row per week (a UTC Monday). Anyone reads it; written
--                                  only by public.stacks_set_featured
--   public.stacks_submit_book()        stores one submission, within 3 per visitor and 50 in all per UTC day
--   public.stacks_approve_submission() reviewers: the editor's text goes on the shelf, the submission is marked approved
--   public.stacks_reject_submission()  reviewers: marks a submission rejected, with a short note
--   public.stacks_set_hidden()         reviewers: takes an approved book off the shelves, or puts it back
--   public.stacks_set_featured()       reviewers: sets (or replaces) the Book of the Week for a week
--   private.isbn13_ok()            whether a text is a valid ISBN-13 (978/979 prefix and check digit)
--   private.weird_retention()      also clears submission address hashes after 7 days, contact emails 90 days after
--                                  the decision, and deletes rejected submissions 180 days after the decision
--
-- Shelf ids are checked by their shape only (a slug), never against a list here: the shelves live in data/books.json.
-- The community function and the console check a shelf against that list.
--
-- Who can do what
--   visitor (publishable key)  read visible approved books and the Book of the Week (public columns only)
--   reviewer                   read submissions (not the address hash), every approved book (hidden ones too) and
--                              the Book of the Week history; call the four reviewer functions
--   community function (service role)
--                              call stacks_submit_book; no direct access to any of the three tables
--   project owner (SQL editor) unrestricted

create schema if not exists private;

-- ───────────────────────────── helpers ─────────────────────────────

-- A valid ISBN-13: 13 digits starting 978 or 979, with a correct check digit (weights 1, 3, 1, 3, ...).
create or replace function private.isbn13_ok(s text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- The digits are only summed once the shape is right (CASE keeps the cast from seeing anything else).
  select case
    when s is not null and s ~ '^97[89][0-9]{10}$' then
      (select sum(substr(s, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end) from generate_series(1, 13) as g(i)) % 10 = 0
    else false
  end;
$$;
comment on function private.isbn13_ok(text) is
  'True when the text is a valid ISBN-13 (978/979, 13 digits, check digit). ISBN-10s are converted before they reach the database.';

-- ───────────────────────────── tables ─────────────────────────────

create table if not exists public.stacks_submissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  title         text not null check (char_length(title) between 1 and 200),
  authors       text not null check (char_length(authors) between 1 and 200),
  isbn13        text not null check (private.isbn13_ok(isbn13)),
  year          integer not null check (year between 1800 and 2100),
  publisher     text check (publisher is null or char_length(publisher) between 1 and 120),
  shelf         text not null check (shelf ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(shelf) <= 40),
  pitch         text not null check (char_length(pitch) between 1 and 600),
  relation      text not null check (relation in ('author', 'publisher')),
  contact_email text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.reviewers (user_id) on delete set null,
  review_note   text check (review_note is null or char_length(review_note) <= 300),
  book_id       text check (book_id is null or (book_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(book_id) <= 80)),
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);
comment on table public.stacks_submissions is
  'Books put forward for The Stacks by their author or publisher. Written only through public.stacks_submit_book; decided through stacks_approve_submission / stacks_reject_submission. The pitch is the sender''s words and is never published.';
comment on column public.stacks_submissions.authors is 'As the sender typed them, comma separated.';
comment on column public.stacks_submissions.isbn13 is 'ISBN-13, digits only. An ISBN-10 is converted before it is stored.';
comment on column public.stacks_submissions.pitch is 'The sender''s own words to the editor. Never copied onto the shelf.';
comment on column public.stacks_submissions.contact_email is
  'Optional, so the editor can reply. Cleared 90 days after the decision.';
comment on column public.stacks_submissions.ip_hash is
  'SHA-256 of the COMMUNITY_SALT secret, the sender''s network address and the UTC day. Cleared after 7 days; reviewers cannot read it.';
comment on column public.stacks_submissions.book_id is 'The public.stacks_books id it became, once approved.';

create index if not exists stacks_submissions_status_idx on public.stacks_submissions (status, created_at desc);
create index if not exists stacks_submissions_isbn_idx on public.stacks_submissions (isbn13);

create table if not exists public.stacks_books (
  id            text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 80),
  shelf         text not null check (shelf ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(shelf) <= 40),
  title         text not null check (char_length(title) between 1 and 200),
  authors       text[] not null check (cardinality(authors) between 1 and 6),
  year          integer not null check (year between 1800 and 2100),
  description   text not null check (char_length(description) between 1 and 400),
  content_note  text check (content_note is null or char_length(content_note) between 1 and 300),
  caveat        text check (caveat is null or char_length(caveat) between 1 and 400),
  tags          text[] not null check (cardinality(tags) between 1 and 6),
  isbn13        text not null unique check (private.isbn13_ok(isbn13)),
  cover_id      integer check (cover_id is null or cover_id > 0),
  origin        text not null check (origin in ('author', 'publisher')),
  submission_id uuid references public.stacks_submissions (id) on delete set null,
  approved_at   timestamptz not null default now(),
  approved_by   uuid,
  hidden        boolean not null default false
);
comment on table public.stacks_books is
  'Books on The Stacks that their author or publisher put forward, approved by the editor, who wrote every word of the description, content note, caveat and tags. Merged after data/books.json by /api/books (lib/stacks-db.js). Written only through the reviewer functions.';
comment on column public.stacks_books.cover_id is 'Open Library cover id the editor chose, or null for the plain stand-in cover.';
comment on column public.stacks_books.origin is 'Who put it forward: shown as "Suggested by the author" or "Suggested by the publisher".';
comment on column public.stacks_books.hidden is 'Taken off the shelves by a reviewer without deleting it.';

create index if not exists stacks_books_visible_idx on public.stacks_books (approved_at) where not hidden;

create table if not exists public.stacks_featured (
  id         bigint generated always as identity primary key,
  book_id    text not null check (book_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(book_id) <= 80),
  reason     text not null check (char_length(reason) between 1 and 140),
  starts_on  date not null unique check (extract(isodow from starts_on) = 1),
  created_at timestamptz not null default now(),
  created_by uuid
);
comment on table public.stacks_featured is
  'The Book of the Week, one row per week starting on a UTC Monday; picking again for the same week replaces it. The current pick is the row with the latest starts_on on or before today (UTC), so a skipped week keeps the last pick up. book_id is any book on the shelves (data/books.json or public.stacks_books).';
comment on column public.stacks_featured.reason is 'The editor''s one line, at most 140 characters.';

-- ───────────────────────────── submissions ─────────────────────────────

-- Stores one submission from the community function, within 3 per sender per UTC day and 50 in all per UTC day.
-- p: { title, authors, isbn13, year, publisher, shelf, pitch, relation, contact_email } already checked and cleaned by
-- the community function (supabase/functions/community/logic.mjs validateBook); checked again here.
-- Returns { ok } or { ok: false, error: 'rate_limited' | 'books_full' | 'duplicate', retry_after? }.
create or replace function public.stacks_submit_book(p jsonb, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wait integer;
  v_title text := btrim(coalesce(p->>'title', ''));
  v_authors text := btrim(coalesce(p->>'authors', ''));
  v_isbn text := btrim(coalesce(p->>'isbn13', ''));
  v_year text := btrim(coalesce(p->>'year', ''));
  v_publisher text := nullif(btrim(coalesce(p->>'publisher', '')), '');
  v_shelf text := btrim(coalesce(p->>'shelf', ''));
  v_pitch text := btrim(coalesce(p->>'pitch', ''));
  v_relation text := btrim(coalesce(p->>'relation', ''));
  v_email text := nullif(btrim(coalesce(p->>'contact_email', '')), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'p must be a JSON object' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip hash must be 64 hex characters' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 200 then raise exception 'title must be 1 to 200 characters' using errcode = '22023'; end if;
  if char_length(v_authors) not between 1 and 200 then raise exception 'authors must be 1 to 200 characters' using errcode = '22023'; end if;
  if not private.isbn13_ok(v_isbn) then raise exception 'isbn13 must be a valid ISBN-13' using errcode = '22023'; end if;
  -- Checked in two steps: a cast inside the same condition could be tried before the shape check.
  if v_year !~ '^[0-9]{4}$' then raise exception 'year must be a four-digit year' using errcode = '22023'; end if;
  if v_year::integer not between 1800 and extract(year from now() at time zone 'utc')::integer + 1 then
    raise exception 'year must be 1800 to next year' using errcode = '22023';
  end if;
  if v_publisher is not null and char_length(v_publisher) > 120 then raise exception 'publisher must be at most 120 characters' using errcode = '22023'; end if;
  if v_shelf !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_shelf) > 40 then raise exception 'shelf must be a shelf id' using errcode = '22023'; end if;
  if char_length(v_pitch) not between 1 and 600 then raise exception 'pitch must be 1 to 600 characters' using errcode = '22023'; end if;
  if v_relation not in ('author', 'publisher') then raise exception 'relation must be author or publisher' using errcode = '22023'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'contact_email must be an email address' using errcode = '22023';
  end if;

  wait := private.weird_take('book:' || p_ip_hash, interval '1 day', 3);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', wait);
  end if;

  if exists (select 1 from public.stacks_submissions s where s.isbn13 = v_isbn and s.status in ('pending', 'approved'))
     or exists (select 1 from public.stacks_books b where b.isbn13 = v_isbn) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  wait := private.weird_take('book:all', interval '1 day', 50);
  if wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'books_full', 'retry_after', wait);
  end if;

  insert into public.stacks_submissions (title, authors, isbn13, year, publisher, shelf, pitch, relation, contact_email, ip_hash)
  values (v_title, v_authors, v_isbn, v_year::integer, v_publisher, v_shelf, v_pitch, v_relation, v_email, p_ip_hash);
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.stacks_submit_book(jsonb, text) is
  'A book put forward from the community function: at most 3 per sender per UTC day and 50 per UTC day in all; an ISBN already pending or on the shelves is refused as a duplicate.';

-- Approves a pending submission with the editor's own text. p_book: { id, shelf, title, authors: [..], year,
-- description, content_note, caveat, tags: [..], cover_id }. The ISBN and who put it forward come from the
-- submission. Every field is checked here. Reviewers only.
-- Returns { ok, id } or { ok: false, error: 'not_found' | 'not_pending' | 'bad_field' (with field) | 'id_taken' | 'duplicate' }.
create or replace function public.stacks_approve_submission(p_submission uuid, p_book jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  sub public.stacks_submissions%rowtype;
  v_id text := btrim(coalesce(p_book->>'id', ''));
  v_shelf text := btrim(coalesce(p_book->>'shelf', ''));
  v_title text := btrim(coalesce(p_book->>'title', ''));
  v_year text := btrim(coalesce(p_book->>'year', ''));
  v_description text := btrim(coalesce(p_book->>'description', ''));
  v_note text := nullif(btrim(coalesce(p_book->>'content_note', '')), '');
  v_caveat text := nullif(btrim(coalesce(p_book->>'caveat', '')), '');
  v_cover text := p_book->>'cover_id';
  v_authors text[];
  v_tags text[];
  bad jsonb := jsonb_build_object('ok', false, 'error', 'bad_field');
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can approve a book' using errcode = '42501';
  end if;
  if p_book is null or jsonb_typeof(p_book) <> 'object' then return bad || jsonb_build_object('field', 'book'); end if;

  select * into sub from public.stacks_submissions s where s.id = p_submission for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if sub.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;

  if v_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_id) > 80 then return bad || jsonb_build_object('field', 'id'); end if;
  if v_shelf !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_shelf) > 40 then return bad || jsonb_build_object('field', 'shelf'); end if;
  if char_length(v_title) not between 1 and 200 then return bad || jsonb_build_object('field', 'title'); end if;

  -- Each check its own step, so a list is only unpacked once it is known to be a list.
  if coalesce(jsonb_typeof(p_book->'authors'), '') <> 'array' then return bad || jsonb_build_object('field', 'authors'); end if;
  if exists (select 1 from jsonb_array_elements(p_book->'authors') e where jsonb_typeof(e) <> 'string') then
    return bad || jsonb_build_object('field', 'authors');
  end if;
  select coalesce(array_agg(btrim(a) order by o), '{}') into v_authors
  from jsonb_array_elements_text(p_book->'authors') with ordinality as x(a, o) where btrim(a) <> '';
  if cardinality(v_authors) not between 1 and 6 or exists (select 1 from unnest(v_authors) a where char_length(a) > 120) then
    return bad || jsonb_build_object('field', 'authors');
  end if;

  if v_year !~ '^[0-9]{4}$' then return bad || jsonb_build_object('field', 'year'); end if;
  if v_year::integer not between 1800 and extract(year from now() at time zone 'utc')::integer + 1 then
    return bad || jsonb_build_object('field', 'year');
  end if;
  if char_length(v_description) not between 1 and 400 then return bad || jsonb_build_object('field', 'description'); end if;
  if v_note is not null and char_length(v_note) > 300 then return bad || jsonb_build_object('field', 'content_note'); end if;
  if v_caveat is not null and char_length(v_caveat) > 400 then return bad || jsonb_build_object('field', 'caveat'); end if;

  if coalesce(jsonb_typeof(p_book->'tags'), '') <> 'array' then return bad || jsonb_build_object('field', 'tags'); end if;
  if exists (select 1 from jsonb_array_elements(p_book->'tags') e where jsonb_typeof(e) <> 'string') then
    return bad || jsonb_build_object('field', 'tags');
  end if;
  select coalesce(array_agg(btrim(t) order by o), '{}') into v_tags
  from jsonb_array_elements_text(p_book->'tags') with ordinality as x(t, o) where btrim(t) <> '';
  if cardinality(v_tags) not between 1 and 6 or exists (select 1 from unnest(v_tags) t where char_length(t) > 30) then
    return bad || jsonb_build_object('field', 'tags');
  end if;

  if v_cover is not null and v_cover !~ '^[1-9][0-9]{0,9}$' then return bad || jsonb_build_object('field', 'cover_id'); end if;
  if v_cover is not null and v_cover::bigint > 2147483647 then return bad || jsonb_build_object('field', 'cover_id'); end if;

  if exists (select 1 from public.stacks_books b where b.id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'id_taken');
  end if;
  if exists (select 1 from public.stacks_books b where b.isbn13 = sub.isbn13) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  begin
    insert into public.stacks_books (id, shelf, title, authors, year, description, content_note, caveat, tags, isbn13, cover_id,
                                     origin, submission_id, approved_by)
    values (v_id, v_shelf, v_title, v_authors, v_year::integer, v_description, v_note, v_caveat, v_tags, sub.isbn13,
            v_cover::integer, sub.relation, sub.id, (select auth.uid()));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'id_taken');
  end;

  update public.stacks_submissions s
  set status = 'approved', reviewed_at = now(), reviewed_by = (select auth.uid()), book_id = v_id
  where s.id = sub.id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
comment on function public.stacks_approve_submission(uuid, jsonb) is
  'Puts a pending submission on the shelves with the editor''s own description, notes and tags, and marks it approved. Reviewers only.';

-- Rejects a pending submission, with an optional short note (at most 300 characters) for the reviewers. Reviewers only.
-- Returns { ok } or { ok: false, error: 'not_found' | 'not_pending' | 'bad_field' (field 'note') }.
create or replace function public.stacks_reject_submission(p_submission uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  cur text;
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can reject a book' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'bad_field', 'field', 'note');
  end if;
  select s.status into cur from public.stacks_submissions s where s.id = p_submission for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if cur <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;

  update public.stacks_submissions s
  set status = 'rejected', reviewed_at = now(), reviewed_by = (select auth.uid()), review_note = v_note
  where s.id = p_submission;
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.stacks_reject_submission(uuid, text) is
  'Marks a pending submission rejected, with an optional note of at most 300 characters. Reviewers only.';

-- Takes an approved book off the shelves (p_hidden true) or puts it back. Nothing is deleted. Reviewers only.
-- Returns { ok, hidden } or { ok: false, error: 'not_found' }.
create or replace function public.stacks_set_hidden(p_book text, p_hidden boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can hide a book' using errcode = '42501';
  end if;
  update public.stacks_books b set hidden = coalesce(p_hidden, true) where b.id = p_book;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'hidden', coalesce(p_hidden, true));
end;
$$;
comment on function public.stacks_set_hidden(text, boolean) is
  'Hides an approved author book from the shelves, or shows it again. Reviewers only.';

-- ───────────────────────────── Book of the Week ─────────────────────────────

-- Sets the Book of the Week for the week that holds p_starts_on (snapped to its UTC Monday; default: this week).
-- Picking again for the same week replaces it. The book id is checked by shape only: the shelves are not in the
-- database, so the console offers only books that are on them. Reviewers only.
-- Returns { ok, starts_on } or { ok: false, error: 'bad_field', field: 'book_id' | 'reason' }.
create or replace function public.stacks_set_featured(p_book_id text, p_reason text, p_starts_on date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_book text := btrim(coalesce(p_book_id, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_week date := date_trunc('week', coalesce(p_starts_on, (now() at time zone 'utc')::date)::timestamp)::date;
begin
  if not private.is_reviewer() then
    raise exception 'Only a reviewer can set the book of the week' using errcode = '42501';
  end if;
  if v_book !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_book) > 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_field', 'field', 'book_id');
  end if;
  if char_length(v_reason) not between 1 and 140 then
    return jsonb_build_object('ok', false, 'error', 'bad_field', 'field', 'reason');
  end if;

  insert into public.stacks_featured as f (book_id, reason, starts_on, created_by)
  values (v_book, v_reason, v_week, (select auth.uid()))
  on conflict (starts_on) do update
    set book_id = excluded.book_id, reason = excluded.reason, created_at = now(), created_by = excluded.created_by;

  return jsonb_build_object('ok', true, 'starts_on', v_week);
end;
$$;
comment on function public.stacks_set_featured(text, text, date) is
  'Sets or replaces the Book of the Week for the week holding p_starts_on (its UTC Monday; default this week). Reviewers only.';

-- ───────────────────────────── retention ─────────────────────────────

-- The daily clean-up from 20261117090000_reader_favourites.sql, unchanged, plus the submissions: the address hash
-- goes after 7 days, the contact email 90 days after the decision, and rejected submissions 180 days after it.
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

  update public.stacks_submissions set ip_hash = null
  where ip_hash is not null and created_at < now() - interval '7 days';

  update public.stacks_submissions set contact_email = null
  where contact_email is not null and reviewed_at is not null and reviewed_at < now() - interval '90 days';

  delete from public.stacks_submissions
  where status = 'rejected' and coalesce(reviewed_at, created_at) < now() - interval '180 days';

  delete from private.weird_rate where window_start < now() - interval '2 days';
end;
$$;
comment on function private.weird_retention() is
  'Daily clean-up for weird votes, tips, click totals, Stacks submissions and limit counters. Scheduled as the weird-community-retention cron job.';

-- ───────────────────────── access: functions ─────────────────────────

-- Functions are executable by everyone unless revoked.
revoke all on function private.isbn13_ok(text)                           from public, anon, authenticated, service_role;
revoke all on function public.stacks_submit_book(jsonb, text)            from public, anon, authenticated, service_role;
revoke all on function public.stacks_approve_submission(uuid, jsonb)     from public, anon, authenticated, service_role;
revoke all on function public.stacks_reject_submission(uuid, text)       from public, anon, authenticated, service_role;
revoke all on function public.stacks_set_hidden(text, boolean)           from public, anon, authenticated, service_role;
revoke all on function public.stacks_set_featured(text, text, date)      from public, anon, authenticated, service_role;
revoke all on function private.weird_retention()                         from public, anon, authenticated, service_role;

-- Submissions go in through the community function, which holds the service role key and the salt.
grant execute on function public.stacks_submit_book(jsonb, text) to service_role;
-- The functions themselves check for a reviewer.
grant execute on function public.stacks_approve_submission(uuid, jsonb) to authenticated;
grant execute on function public.stacks_reject_submission(uuid, text)   to authenticated;
grant execute on function public.stacks_set_hidden(text, boolean)       to authenticated;
grant execute on function public.stacks_set_featured(text, text, date)  to authenticated;

-- ─────────────────────────── access: tables ───────────────────────────

revoke all on public.stacks_submissions, public.stacks_books, public.stacks_featured
  from public, anon, authenticated, service_role;

-- stacks_submissions: reviewers read everything but the address hash. No writes through the API.
grant select (id, created_at, title, authors, isbn13, year, publisher, shelf, pitch, relation, contact_email, status,
              reviewed_at, reviewed_by, review_note, book_id)
  on public.stacks_submissions to authenticated;

-- stacks_books: visitors read the shelf columns of visible books; reviewers read every column of every book.
grant select (id, shelf, title, authors, year, description, content_note, caveat, tags, isbn13, cover_id, origin,
              approved_at, hidden)
  on public.stacks_books to anon;
grant select on public.stacks_books to authenticated;

-- stacks_featured: visitors read the picks (not who made them); reviewers read everything.
grant select (id, book_id, reason, starts_on, created_at) on public.stacks_featured to anon;
grant select on public.stacks_featured to authenticated;

-- ────────────────────────── access: rows ──────────────────────────

alter table public.stacks_submissions enable row level security;
alter table public.stacks_books       enable row level security;
alter table public.stacks_featured    enable row level security;

drop policy if exists "Reviewers read submissions" on public.stacks_submissions;
create policy "Reviewers read submissions"
  on public.stacks_submissions for select to authenticated
  using ((select private.is_reviewer()));

drop policy if exists "Visible books are public; reviewers see all" on public.stacks_books;
create policy "Visible books are public; reviewers see all"
  on public.stacks_books for select to anon, authenticated
  using (not hidden or (select private.is_reviewer()));

drop policy if exists "The book of the week is public" on public.stacks_featured;
create policy "The book of the week is public"
  on public.stacks_featured for select to anon, authenticated
  using (true);
