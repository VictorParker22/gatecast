-- The collect function could be started by anyone holding the site's public key: its guards (one run every five
-- minutes, 400 Open States requests a day) were a read followed by an insert, so several requests at once all
-- passed, and one stray call before :07 made the hourly job refuse. Now only the hourly job can start it.
--
-- 1. A token made in the database and kept in Vault. Nobody needs to read it or copy it anywhere: the hourly job
--    sends it, and the function asks the database whether it matches. To replace it, update the Vault secret; the
--    job reads it at each run.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'collect_run_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'collect_run_token',
      'Sent by the hourly job (collect-state-votes) so that only it can start the collect function'
    );
  end if;
end $$;

-- 2. The claim: check the token, then take the run, in one step. An advisory lock makes requests that arrive
--    together queue here, so the gap and the daily budget are judged on what is already written. The numbers match
--    the function's (8 requests a run, 400 a day, 5 minutes apart). A crashed run still counts as a full one.
create or replace function public.collect_claim(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want  text;
  v_last  timestamptz;
  v_today integer;
  v_run   bigint;
begin
  select decrypted_secret into v_want from vault.decrypted_secrets where name = 'collect_run_token';
  if v_want is null or p_token is null or p_token <> v_want then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  perform pg_advisory_xact_lock(hashtext('gatecast.collect_claim'));
  select max(started_at) into v_last from public.collector_runs;
  if v_last is not null and now() - v_last < interval '5 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;
  select coalesce(sum(requests), 0) into v_today from public.collector_runs where started_at >= now() - interval '24 hours';
  if v_today + 8 > 400 then
    return jsonb_build_object('ok', false, 'reason', 'day_budget');
  end if;
  insert into public.collector_runs (requests) values (8) returning id into v_run;
  return jsonb_build_object('ok', true, 'run', v_run);
end $$;

revoke all on function public.collect_claim(text) from public, anon, authenticated;
grant execute on function public.collect_claim(text) to service_role;

-- 3. The hourly job sends the token, read from Vault when it runs. Its other headers stay as they are.
select cron.alter_job(
  jobid,
  command := replace(
    command,
    $a$'Content-Type', 'application/json',$a$,
    $b$'Content-Type', 'application/json',
      'X-Collect-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'collect_run_token'),$b$
  )
)
from cron.job
where jobname = 'collect-state-votes' and position('X-Collect-Token' in command) = 0;
