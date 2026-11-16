create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The bearer token below is the project's public (anon) key, the same one a browser uses.
select cron.schedule(
  'collect-state-votes',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://hfdwmzuedjcsaxgzhzmu.supabase.co/functions/v1/collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
