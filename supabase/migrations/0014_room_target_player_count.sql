alter table public.rooms
  add column if not exists target_player_count integer not null default 6;

alter table public.rooms
  drop constraint if exists rooms_target_player_count_check;

alter table public.rooms
  add constraint rooms_target_player_count_check
  check (target_player_count between 3 and 10);

drop function if exists public.app_create_room(
  bigint,
  text,
  text,
  timestamptz,
  text,
  text
);

create or replace function public.app_create_room(
  p_account_id bigint,
  p_public_room_code text,
  p_realtime_topic text,
  p_lobby_expires_at timestamptz,
  p_public_player_id text,
  p_display_name text,
  p_target_player_count integer
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
  v_player_id bigint;
  v_room public.rooms%rowtype;
begin
  if p_target_player_count is null
    or p_target_player_count < 3
    or p_target_player_count > 10
  then
    raise exception 'Target player count must be between 3 and 10.';
  end if;

  insert into public.rooms (
    host_account_id,
    lobby_expires_at,
    public_room_code,
    realtime_topic,
    status,
    target_player_count
  )
  values (
    p_account_id,
    p_lobby_expires_at,
    p_public_room_code,
    p_realtime_topic,
    'lobby',
    p_target_player_count
  )
  returning * into v_room;

  insert into public.players (
    account_id,
    display_name,
    public_player_id,
    room_id,
    status
  )
  values (
    p_account_id,
    p_display_name,
    p_public_player_id,
    v_room.id,
    'joined'
  )
  returning players.id into v_player_id;

  insert into public.game_states (room_id, status)
  values (v_room.id, 'waiting');

  insert into public.realtime_topics (room_id, scope, topic)
  values (v_room.id, 'room', p_realtime_topic);

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player_id, 'room_created', '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player_id,
      'room_created'::text;
end;
$$;

create or replace function public.app_join_room(
  p_account_id bigint,
  p_room_code text,
  p_public_player_id text,
  p_display_name text
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
  v_event_kind text;
  v_joined_player_count bigint;
  v_player public.players%rowtype;
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
  end if;

  if v_room.status not in ('lobby', 'playing') then
    raise exception 'Room is not joinable.';
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if found then
    v_event_kind := case
      when v_player.status = 'left' then 'player_joined'
      else 'player_reconnected'
    end;

    if v_player.status <> 'joined' then
      select count(*)
      into v_joined_player_count
      from public.players
      where players.room_id = v_room.id
        and players.status = 'joined';

      if v_joined_player_count >= v_room.target_player_count then
        raise exception 'Room is full.';
      end if;
    end if;

    update public.players
    set last_seen_at = now(),
        status = 'joined'
    where players.id = v_player.id
    returning * into v_player;
  else
    if v_room.status <> 'lobby' then
      raise exception 'New players can only join during lobby.';
    end if;

    select count(*)
    into v_joined_player_count
    from public.players
    where players.room_id = v_room.id
      and players.status = 'joined';

    if v_joined_player_count >= v_room.target_player_count then
      raise exception 'Room is full.';
    end if;

    v_event_kind := 'player_joined';

    insert into public.players (
      account_id,
      display_name,
      public_player_id,
      room_id,
      status
    )
    values (
      p_account_id,
      p_display_name,
      p_public_player_id,
      v_room.id,
      'joined'
    )
    returning * into v_player;
  end if;

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player.id, v_event_kind, '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      v_event_kind;
end;
$$;

revoke all on function public.app_create_room(
  bigint,
  text,
  text,
  timestamptz,
  text,
  text,
  integer
) from public, anon, authenticated;

revoke all on function public.app_join_room(bigint, text, text, text)
  from public, anon, authenticated;

grant execute on function public.app_create_room(
  bigint,
  text,
  text,
  timestamptz,
  text,
  text,
  integer
) to service_role;

grant execute on function public.app_join_room(bigint, text, text, text) to service_role;
