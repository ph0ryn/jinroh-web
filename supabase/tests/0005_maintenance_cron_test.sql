begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select ok(
  exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_cron'
  ),
  'the maintenance schedule enables pg_cron'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'invoke_expire_rooms_maintenance'
      and procedures.pronargs = 0
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']::text[]
  ),
  'the maintenance invocation is a fixed-search-path security-definer function'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'private.invoke_expire_rooms_maintenance()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'private.invoke_expire_rooms_maintenance()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'private.invoke_expire_rooms_maintenance()',
    'execute'
  ),
  'application roles cannot invoke the maintenance request function'
);

select is(
  (
    select pg_catalog.count(*)
    from cron.job
    where jobname = 'jinroh-web-expire-rooms'
  ),
  1::bigint,
  'exactly one expire-rooms Cron job is registered'
);

select is(
  (
    select schedule
    from cron.job
    where jobname = 'jinroh-web-expire-rooms'
  ),
  '*/15 * * * *',
  'the expire-rooms job runs every fifteen minutes'
);

select is(
  (
    select command
    from cron.job
    where jobname = 'jinroh-web-expire-rooms'
  ),
  'select private.invoke_expire_rooms_maintenance();',
  'the Cron job invokes only the private maintenance request function'
);

select ok(
  (
    select active
    from cron.job
    where jobname = 'jinroh-web-expire-rooms'
  ),
  'the expire-rooms Cron job is active'
);

select is(
  (
    select pg_catalog.count(*)
    from cron.job
    where jobname = 'jinroh-web-prune-cron-history'
  ),
  1::bigint,
  'exactly one Cron history pruning job is registered'
);

select is(
  (
    select schedule
    from cron.job
    where jobname = 'jinroh-web-prune-cron-history'
  ),
  '0 3 * * *',
  'the Cron history pruning job runs daily'
);

select is(
  (
    select command
    from cron.job
    where jobname = 'jinroh-web-prune-cron-history'
  ),
  $$delete from cron.job_run_details
    where end_time < pg_catalog.now() - interval '7 days';$$,
  'the Cron history pruning job retains seven days of completed runs'
);

select ok(
  (
    select active
    from cron.job
    where jobname = 'jinroh-web-prune-cron-history'
  ),
  'the Cron history pruning job is active'
);

select throws_ok(
  $$select private.invoke_expire_rooms_maintenance()$$,
  'P0001',
  'maintenance_base_url_missing_or_invalid',
  'the job fails visibly until its Vault configuration exists'
);

select vault.create_secret(
  'https://jinroh.example',
  'jinroh_web_maintenance_base_url',
  'Jinroh Web maintenance endpoint base URL'
);

select vault.create_secret(
  '0123456789abcdef0123456789abcdef',
  'jinroh_web_maintenance_secret',
  'Jinroh Web maintenance endpoint bearer secret'
);

select ok(
  private.invoke_expire_rooms_maintenance() > 0,
  'the configured maintenance function enqueues an HTTP request'
);

select is(
  (
    select requests.url
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  'https://jinroh.example/api/maintenance/expire-rooms',
  'the request targets the expire-rooms route'
);

select is(
  (
    select requests.method
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  'POST',
  'the maintenance request uses POST'
);

select is(
  (
    select requests.headers ->> 'Authorization'
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  'Bearer 0123456789abcdef0123456789abcdef',
  'the request uses the Vault maintenance secret as its bearer credential'
);

select is(
  (
    select requests.headers ->> 'Content-Type'
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  'application/json',
  'the request declares a JSON content type'
);

select is(
  (
    select pg_catalog.convert_from(requests.body, 'UTF8')::jsonb
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  '{"limit": 50}'::jsonb,
  'the request uses the default cleanup batch size'
);

select is(
  (
    select requests.timeout_milliseconds
    from net.http_request_queue as requests
    order by requests.id desc
    limit 1
  ),
  10000,
  'the maintenance request has a bounded timeout'
);

select * from finish();

rollback;
