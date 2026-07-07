create or replace function public.app_heartbeat_room_player(
  p_account_id bigint,
  p_room_code text,
  p_disconnect_after_seconds integer default 45
)
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
  v_disconnect_after_seconds integer := least(greatest(coalesce(p_disconnect_after_seconds, 45), 10), 300);
  v_disconnected_count integer := 0;
  v_notification_reason text := null;
  v_player public.players%rowtype;
  v_reconnected boolean := false;
  v_room public.rooms%rowtype;
begin
  select *
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Room not found.';
  end if;

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );

    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        null::bigint,
        'room_disbanded'::text;
    return;
  end if;

  if v_room.status not in ('lobby', 'playing') then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        null::bigint,
        null::text;
    return;
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status <> 'left'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  v_reconnected := v_player.status = 'disconnected';

  update public.players
  set disconnected_at = null,
      last_seen_at = now(),
      status = 'joined'
  where players.id = v_player.id
  returning * into v_player;

  if v_reconnected then
    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (p_account_id, v_player.id, 'player_reconnected', '{}'::jsonb, v_room.id);
  end if;

  with stale_players as (
    update public.players
    set disconnected_at = now(),
        status = 'disconnected'
    where players.room_id = v_room.id
      and players.account_id <> p_account_id
      and players.status = 'joined'
      and players.last_seen_at <= now() - make_interval(secs => v_disconnect_after_seconds)
    returning players.id
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
      stale_players.id,
      'player_disconnected',
      '{}'::jsonb,
      v_room.id
    from stale_players
    returning room_events.id
  )
  select count(*)
  into v_disconnected_count
  from inserted_events;

  v_notification_reason := case
    when v_reconnected then 'player_reconnected'
    when v_disconnected_count > 0 then 'player_disconnected'
    else null
  end;

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      v_notification_reason;
end;
$$;

revoke all on function public.app_heartbeat_room_player(bigint, text, integer)
  from public, anon, authenticated;

grant execute on function public.app_heartbeat_room_player(bigint, text, integer)
  to service_role;
