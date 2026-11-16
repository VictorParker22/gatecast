create table private.switches (
  key     text primary key,
  enabled boolean not null default true,
  note    text
);
alter table private.switches enable row level security;
insert into private.switches (key, enabled, note)
values ('state_votes', true, 'Show statehouse votes to visitors');

create function private.switch_on(k text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled from private.switches s where s.key = k), false);
$$;
revoke all on function private.switch_on(text) from public;
grant execute on function private.switch_on(text) to anon, authenticated;

create table public.state_votes (
  id              uuid primary key default gen_random_uuid(),
  vote_key        text not null unique,
  state           text not null check (state ~ '^[A-Z]{2}$'),
  bill_identifier text not null,
  bill_title      text not null,
  bill_kind       text not null default 'bill',
  session         text,
  chamber         text not null check (chamber in ('upper', 'lower', 'legislature')),
  chamber_name    text not null,
  motion          text not null,
  voted_at        timestamptz not null,
  voted_on        date not null,
  passed          boolean not null,
  yes             integer not null check (yes >= 0),
  no              integer not null check (no >= 0),
  other           integer not null default 0 check (other >= 0),
  dem_yes         integer not null default 0,
  dem_no          integer not null default 0,
  dem_other       integer not null default 0,
  rep_yes         integer not null default 0,
  rep_no          integer not null default 0,
  rep_other       integer not null default 0,
  oth_yes         integer not null default 0,
  oth_no          integer not null default 0,
  oth_other       integer not null default 0,
  party_unknown   integer not null default 0,
  seats           integer not null,
  record_url      text check (record_url ~ '^https?://'),
  openstates_url  text not null check (openstates_url ~ '^https://'),
  hidden          boolean not null default false,
  collected_at    timestamptz not null default now()
);
comment on column public.state_votes.party_unknown is
  'Voters the source could not match to a legislator, so their party is not in the split.';
comment on column public.state_votes.seats is
  'Members of the chamber when collected. Only votes cast by most of the chamber are kept, which leaves out committee votes.';

create index state_votes_state_day_idx on public.state_votes (state, voted_on desc)
  where not hidden;

create table public.collector_states (
  state       text primary key check (state ~ '^[A-Z]{2}$'),
  upper_seats integer,
  lower_seats integer,
  seats_at    timestamptz,
  last_run_at timestamptz,
  last_result jsonb
);

create table public.collector_runs (
  id         bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  requests   integer not null default 0,
  detail     jsonb
);
create index collector_runs_started_idx on public.collector_runs (started_at desc);

revoke all on public.state_votes, public.collector_states, public.collector_runs
  from public, anon, authenticated, service_role;

grant select on public.state_votes to anon, authenticated;
grant select, insert, update, delete on public.state_votes to service_role;
grant select, insert, update on public.collector_states, public.collector_runs to service_role;

alter table public.state_votes      enable row level security;
alter table public.collector_states enable row level security;
alter table public.collector_runs   enable row level security;

create policy "Visitors read votes that are not hidden while the switch is on"
  on public.state_votes for select to anon, authenticated
  using (not hidden and (select private.switch_on('state_votes')));

insert into public.collector_states (state)
select unnest(array[
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
]);
