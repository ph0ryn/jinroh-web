create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create function private.invoke_expire_rooms_maintenance()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_url text;
  v_maintenance_secret text;
begin
  select secrets.decrypted_secret
  into v_application_url
  from vault.decrypted_secrets as secrets
  where secrets.name = 'jinroh_web_maintenance_base_url';

  select secrets.decrypted_secret
  into v_maintenance_secret
  from vault.decrypted_secrets as secrets
  where secrets.name = 'jinroh_web_maintenance_secret';

  if v_application_url is null
    or v_application_url !~ '^https://[^/]+/?$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'maintenance_base_url_missing_or_invalid';
  end if;

  if v_maintenance_secret is null
    or pg_catalog.octet_length(v_maintenance_secret) < 32
  then
    raise exception using
      errcode = 'P0001',
      message = 'maintenance_secret_missing_or_invalid';
  end if;

  return net.http_post(
    url := pg_catalog.rtrim(v_application_url, '/') || '/api/maintenance/expire-rooms',
    headers := pg_catalog.jsonb_build_object(
      'Authorization',
      'Bearer ' || v_maintenance_secret,
      'Content-Type',
      'application/json'
    ),
    body := pg_catalog.jsonb_build_object('limit', 50),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function private.invoke_expire_rooms_maintenance()
  from public, anon, authenticated, service_role;

select cron.schedule(
  'jinroh-web-expire-rooms',
  '*/5 * * * *',
  'select private.invoke_expire_rooms_maintenance();'
);
