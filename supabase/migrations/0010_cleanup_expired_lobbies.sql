create or replace function public.app_cleanup_expired_lobbies(p_limit integer default 50)
returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  lobby_expires_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return query
    with expired_rooms as (
      select rooms.id
      from public.rooms
      where rooms.status = 'lobby'
        and rooms.lobby_expires_at <= now()
      order by rooms.lobby_expires_at asc
      limit v_limit
      for update skip locked
    ),
    updated_rooms as (
      update public.rooms
      set disbanded_at = now(),
          status = 'disbanded'
      from expired_rooms
      where rooms.id = expired_rooms.id
        and rooms.status = 'lobby'
      returning rooms.*
    ),
    inserted_events as (
      insert into public.room_events (
        actor_account_id,
        actor_player_id,
        event_kind,
        payload,
        room_id
      )
      select
        null,
        null,
        'room_disbanded',
        '{"reason":"lobby_expired_cleanup"}'::jsonb,
        updated_rooms.id
      from updated_rooms
      returning room_events.room_id
    )
    select
      updated_rooms.id,
      updated_rooms.public_room_code,
      updated_rooms.status,
      updated_rooms.host_account_id,
      updated_rooms.realtime_topic,
      updated_rooms.lobby_expires_at,
      null::bigint,
      'room_disbanded'::text
    from updated_rooms
    join inserted_events
      on inserted_events.room_id = updated_rooms.id;
end;
$$;

revoke all on function public.app_cleanup_expired_lobbies(integer)
  from public, anon, authenticated;

grant execute on function public.app_cleanup_expired_lobbies(integer)
  to service_role;
