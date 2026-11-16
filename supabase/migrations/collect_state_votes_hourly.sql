-- Run the collector once an hour. Each run does at most 8 Open States
-- requests, so a day stays under 200. To stop it:
--   select cron.unschedule('collect-state-votes');

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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZHdtenVlZGpjc2F4Z3poem11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3OTcxMTgsImV4cCI6MjExMDM3MzExOH0.15ytOrCQwzdK_dVV0WN_osXHmti45IKF6DUahD3h76g'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
