create or replace function public.app_issue_realtime_grant(
  p_account_id bigint,
  p_room_code text,
  p_grant_seconds integer default 120
) returns table (
  topic text,
  scope text,
  grant_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_room_id bigint;
begin
  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id;

  if not found or v_current_room_id is null then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  perform rooms.id
  from public.rooms
  where rooms.id = v_current_room_id
    and rooms.public_room_code = p_room_code
    and (
      rooms.status in ('waiting', 'playing')
      or (rooms.status = 'ended' and rooms.started_at is not null)
    )
  for key share;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  return query
  select grants.topic, grants.scope, grants.grant_id, grants.expires_at
  from public.app_issue_realtime_grant_without_membership_check(
    p_account_id,
    p_room_code,
    p_grant_seconds
  ) as grants;
end;
$$;
