create function private.random_identifier(p_prefix text, p_byte_count integer)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_random_hex text := '';
begin
  if p_byte_count < 1 then
    raise exception 'Random identifier byte count must be positive.';
  end if;

  for v_index in 1..ceil(p_byte_count / 16.0)::integer loop
    v_random_hex := v_random_hex || replace(gen_random_uuid()::text, '-', '');
  end loop;

  return p_prefix || left(v_random_hex, p_byte_count * 2);
end;
$$;

create function private.lock_account(p_account_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform accounts.id
  from public.accounts as accounts
  where accounts.id = p_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'account_not_found';
  end if;
end;
$$;

create function private.end_waiting_room(
  p_room_id bigint,
  p_reason text,
  p_actor_player_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.players as players
  set disconnected_at = null,
      left_at = coalesce(
        players.left_at,
        greatest(players.last_seen_at, v_now)
      )
  where players.room_id = p_room_id
    and players.left_at is null;

  update public.realtime_grants as grants
  set revoked_at = coalesce(
    grants.revoked_at,
    greatest(grants.created_at, v_now)
  )
  where grants.room_id = p_room_id
    and grants.revoked_at is null;

  update public.rooms as rooms
  set ended_at = v_now,
      snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = p_room_id
    and rooms.started_at is null
    and rooms.ended_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  insert into public.room_events (
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (
    p_actor_player_id,
    'room_ended',
    jsonb_build_object('reason', p_reason),
    p_room_id
  );
end;
$$;

create function private.create_room(
  p_account_id bigint,
  p_display_name text,
  p_target_player_count integer,
  p_waiting_expires_at timestamptz,
  p_excluded_room_code text default null
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := btrim(p_display_name);
  v_player_id bigint;
  v_public_room_code text;
  v_room_id bigint;
begin
  if p_target_player_count is null
    or p_target_player_count < 3
    or p_target_player_count > 10
  then
    raise exception using errcode = 'P0001', message = 'invalid_target_player_count';
  end if;

  if v_display_name is null
    or char_length(v_display_name) < 1
    or char_length(v_display_name) > 32
  then
    raise exception using errcode = 'P0001', message = 'invalid_display_name';
  end if;

  if p_waiting_expires_at is null or p_waiting_expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'invalid_waiting_expiration';
  end if;

  if exists (
    select 1
    from public.players as players
    where players.account_id = p_account_id
      and players.left_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  for v_attempt in 1..100 loop
    v_public_room_code := lpad(floor(random() * 1000000)::integer::text, 6, '0');

    if v_public_room_code = btrim(p_excluded_room_code) then
      continue;
    end if;

    begin
      insert into public.rooms (
        host_account_id,
        public_room_code,
        target_player_count,
        waiting_expires_at
      )
      values (
        p_account_id,
        v_public_room_code,
        p_target_player_count,
        p_waiting_expires_at
      )
      returning rooms.id into v_room_id;

      exit;
    exception
      when unique_violation then
        if v_attempt = 100 then
          raise exception using errcode = 'P0001', message = 'room_code_exhausted';
        end if;
    end;
  end loop;

  insert into public.players (
    account_id,
    display_name,
    public_player_id,
    room_id
  )
  values (
    p_account_id,
    v_display_name,
    private.random_identifier('pl_', 12),
    v_room_id
  )
  returning players.id into v_player_id;

  insert into public.realtime_topics (room_id, scope, topic)
  values (
    v_room_id,
    'room',
    private.random_identifier('room:', 24)
  );

  insert into public.realtime_topics (player_id, room_id, scope, topic)
  values (
    v_player_id,
    v_room_id,
    'player_private',
    private.random_identifier('player:', 24)
  );

  insert into public.room_events (
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (v_player_id, 'room_created', '{}'::jsonb, v_room_id);

  return query
  select v_room_id, v_player_id, 'room_created'::text;
end;
$$;

create function private.join_room(
  p_account_id bigint,
  p_room_id bigint,
  p_display_name text
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_player_count integer;
  v_display_name text := btrim(p_display_name);
  v_event_kind text;
  v_now timestamptz := clock_timestamp();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  if v_display_name is null
    or char_length(v_display_name) < 1
    or char_length(v_display_name) > 32
  then
    raise exception using errcode = 'P0001', message = 'invalid_display_name';
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = p_room_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if v_room.status not in ('waiting', 'playing') then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  if exists (
    select 1
    from public.players as players
    where players.account_id = p_account_id
      and players.left_at is null
      and players.room_id <> p_room_id
  ) then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = p_room_id
    and players.account_id = p_account_id
  for update;

  if found then
    if v_player.left_at is not null and v_room.status <> 'waiting' then
      raise exception using errcode = 'P0001', message = 'room_not_joinable';
    end if;

    if v_player.left_at is not null then
      select count(*)
      into v_active_player_count
      from public.players as players
      where players.room_id = p_room_id
        and players.left_at is null;

      if v_active_player_count >= v_room.target_player_count then
        raise exception using errcode = 'P0001', message = 'room_full';
      end if;

      v_event_kind := 'player_joined';
    else
      v_event_kind := 'player_reconnected';
    end if;

    update public.players as players
    set disconnected_at = null,
        last_seen_at = greatest(players.last_seen_at, v_now),
        left_at = null
    where players.id = v_player.id;
  else
    if v_room.status <> 'waiting' then
      raise exception using errcode = 'P0001', message = 'room_not_joinable';
    end if;

    select count(*)
    into v_active_player_count
    from public.players as players
    where players.room_id = p_room_id
      and players.left_at is null;

    if v_active_player_count >= v_room.target_player_count then
      raise exception using errcode = 'P0001', message = 'room_full';
    end if;

    insert into public.players (
      account_id,
      display_name,
      public_player_id,
      room_id
    )
    values (
      p_account_id,
      v_display_name,
      private.random_identifier('pl_', 12),
      p_room_id
    )
    returning players.* into v_player;

    insert into public.realtime_topics (player_id, room_id, scope, topic)
    values (
      v_player.id,
      p_room_id,
      'player_private',
      private.random_identifier('player:', 24)
    );

    v_event_kind := 'player_joined';
  end if;

  update public.rooms as rooms
  set snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = p_room_id;

  insert into public.room_events (
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (v_player.id, v_event_kind, '{}'::jsonb, p_room_id);

  return query
  select p_room_id, v_player.id, v_event_kind;
end;
$$;

create function public.app_create_identity(
  p_token_hash text,
  p_token_hash_key_id text
)
returns table (account_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id bigint;
begin
  insert into public.accounts default values
  returning accounts.id into v_account_id;

  insert into public.account_tokens (
    account_id,
    token_hash,
    token_hash_key_id
  )
  values (v_account_id, p_token_hash, p_token_hash_key_id);

  return query select v_account_id;
end;
$$;

create function public.app_authenticate_account(p_token_hash text)
returns table (account_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id bigint;
begin
  select tokens.account_id
  into v_account_id
  from public.account_tokens as tokens
  where tokens.token_hash = p_token_hash
    and tokens.revoked_at is null
  for update;

  if not found then
    return;
  end if;

  update public.account_tokens as tokens
  set last_used_at = statement_timestamp()
  where tokens.token_hash = p_token_hash
    and (
      tokens.last_used_at is null
      or tokens.last_used_at < statement_timestamp() - interval '5 minutes'
    );

  return query select v_account_id;
end;
$$;

create function public.app_create_room(
  p_account_id bigint,
  p_display_name text,
  p_target_player_count integer,
  p_waiting_expires_at timestamptz
)
returns table (
  result_kind text,
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_settled boolean := false;
  v_now timestamptz;
  v_source_player public.players%rowtype;
  v_source_room public.rooms%rowtype;
  v_target_result record;
begin
  perform private.lock_account(p_account_id);

  select players.*
  into v_source_player
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  if found then
    select rooms.*
    into v_source_room
    from public.rooms as rooms
    where rooms.id = v_source_player.room_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'current_room_changed';
    end if;

    select players.*
    into v_source_player
    from public.players as players
    where players.id = v_source_player.id
      and players.account_id = p_account_id
      and players.room_id = v_source_room.id
      and players.left_at is null
    for update;

    v_now := clock_timestamp();

    if not found then
      if v_source_room.started_at is not null
        or v_source_room.ended_at is null
        or v_source_room.waiting_expires_at > v_now
      then
        raise exception using errcode = 'P0001', message = 'current_room_changed';
      end if;
    elsif v_source_room.status = 'waiting'
      and v_source_room.waiting_expires_at <= v_now
    then
      perform private.end_waiting_room(
        v_source_room.id,
        'waiting_room_expired',
        v_source_player.id
      );

      v_source_settled := true;
    end if;
  end if;

  select *
  into v_target_result
  from private.create_room(
    p_account_id,
    p_display_name,
    p_target_player_count,
    p_waiting_expires_at
  );

  if v_source_settled then
    return query
    select
      'source'::text,
      v_source_room.id,
      v_source_player.id,
      'waiting_room_ended'::text;
  end if;

  return query
  select
    'target'::text,
    v_target_result.room_id,
    v_target_result.actor_player_id,
    v_target_result.notification_reason;
end;
$$;

create function public.app_join_room(
  p_account_id bigint,
  p_room_code text,
  p_display_name text
)
returns table (
  result_kind text,
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_settled boolean := false;
  v_now timestamptz;
  v_source_player public.players%rowtype;
  v_source_room public.rooms%rowtype;
  v_target_result record;
  v_room public.rooms%rowtype;
  v_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select rooms.id
  into v_room_id
  from public.rooms as rooms
  where rooms.public_room_code = btrim(p_room_code)
  order by
    case when rooms.status in ('waiting', 'playing') then 0 else 1 end,
    rooms.created_at desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select players.*
  into v_source_player
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  perform rooms.id
  from public.rooms as rooms
  where rooms.id in (v_room_id, v_source_player.room_id)
  order by rooms.id
  for update;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = v_room_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_source_player.id is not null then
    select rooms.*
    into v_source_room
    from public.rooms as rooms
    where rooms.id = v_source_player.room_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'current_room_changed';
    end if;

    select players.*
    into v_source_player
    from public.players as players
    where players.id = v_source_player.id
      and players.account_id = p_account_id
      and players.room_id = v_source_room.id
      and players.left_at is null
    for update;

    v_now := clock_timestamp();

    if not found then
      if v_source_room.started_at is not null
        or v_source_room.ended_at is null
        or v_source_room.waiting_expires_at > v_now
      then
        raise exception using errcode = 'P0001', message = 'current_room_changed';
      end if;
    elsif v_source_room.status = 'waiting'
      and v_source_room.waiting_expires_at <= v_now
    then
      perform private.end_waiting_room(
        v_source_room.id,
        'waiting_room_expired',
        v_source_player.id
      );

      v_source_settled := true;
    end if;
  else
    v_now := clock_timestamp();
  end if;

  if v_room.started_at is null
    and v_room.waiting_expires_at <= v_now
  then
    if v_room.ended_at is null
      and not (v_source_settled and v_source_room.id = v_room.id)
    then
      perform private.end_waiting_room(v_room.id, 'waiting_room_expired');
    end if;

    if v_source_settled then
      return query
      select
        'source'::text,
        v_source_room.id,
        v_source_player.id,
        'waiting_room_ended'::text;
    end if;

    return query
    select
      'target'::text,
      v_room.id,
      null::bigint,
      'waiting_room_ended'::text;
    return;
  end if;

  select *
  into v_target_result
  from private.join_room(p_account_id, v_room_id, p_display_name);

  if v_source_settled then
    return query
    select
      'source'::text,
      v_source_room.id,
      v_source_player.id,
      'waiting_room_ended'::text;
  end if;

  return query
  select
    'target'::text,
    v_target_result.room_id,
    v_target_result.actor_player_id,
    v_target_result.notification_reason;
end;
$$;

create function private.leave_room(
  p_account_id bigint,
  p_room_id bigint
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_notification_reason text := 'player_left';
  v_player public.players%rowtype;
  v_remaining_account_id bigint;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = p_room_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = p_room_id
    and players.account_id = p_account_id
    and players.left_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_room.status = 'playing' then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= v_now then
    perform private.end_waiting_room(
      p_room_id,
      'waiting_room_expired',
      v_player.id
    );

    return query
    select p_room_id, v_player.id, 'waiting_room_ended'::text;
    return;
  end if;

  update public.players as players
  set disconnected_at = null,
      left_at = greatest(players.last_seen_at, v_now)
  where players.id = v_player.id;

  update public.realtime_grants as grants
  set revoked_at = coalesce(
    grants.revoked_at,
    greatest(grants.created_at, v_now)
  )
  where grants.player_id = v_player.id
    and grants.revoked_at is null;

  insert into public.room_events (
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (v_player.id, 'player_left', '{}'::jsonb, p_room_id);

  select players.account_id
  into v_remaining_account_id
  from public.players as players
  where players.room_id = p_room_id
    and players.left_at is null
  order by players.joined_at, players.id
  limit 1;

  if v_room.status = 'waiting' and v_remaining_account_id is null then
    update public.rooms as rooms
    set ended_at = v_now,
        snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = p_room_id;

    insert into public.room_events (
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      v_player.id,
      'room_ended',
      '{"reason":"last_player_left_waiting_room"}'::jsonb,
      p_room_id
    );

    v_notification_reason := 'waiting_room_ended';
  else
    update public.rooms as rooms
    set host_account_id = case
          when rooms.host_account_id = p_account_id
            and v_remaining_account_id is not null
            then v_remaining_account_id
          else rooms.host_account_id
        end,
        snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = p_room_id;
  end if;

  return query
  select p_room_id, v_player.id, v_notification_reason;
end;
$$;

create function public.app_leave_room(
  p_account_id bigint,
  p_room_code text
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select rooms.id
  into v_room_id
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
    and players.account_id = p_account_id
    and players.left_at is null
  where rooms.public_room_code = btrim(p_room_code);

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  perform rooms.id
  from public.rooms as rooms
  where rooms.id = v_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  return query
  select * from private.leave_room(p_account_id, v_room_id);
end;
$$;

create function public.app_get_current_room(p_account_id bigint)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  perform private.lock_account(p_account_id);

  select players.*
  into v_player
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  if not found then
    return;
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = v_player.room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.id = v_player.id
    and players.account_id = p_account_id
    and players.room_id = v_room.id
    and players.left_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  v_now := clock_timestamp();

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= v_now then
    perform private.end_waiting_room(
      v_room.id,
      'waiting_room_expired',
      v_player.id
    );

    return query
    select v_room.id, v_player.id, 'waiting_room_ended'::text;
    return;
  end if;

  return query
  select v_room.id, v_player.id, null::text;
end;
$$;

create function public.app_expire_waiting_room_if_needed(p_room_id bigint)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_room.status = 'waiting'
    and v_room.waiting_expires_at <= clock_timestamp()
  then
    perform private.end_waiting_room(p_room_id, 'waiting_room_expired');

    return query
    select p_room_id, null::bigint, 'waiting_room_ended'::text;
    return;
  end if;

  return query
  select p_room_id, null::bigint, null::text;
end;
$$;

create function public.app_cleanup_expired_waiting_rooms(p_limit integer default 50)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_room_id bigint;
begin
  for v_room_id in
    select rooms.id
    from public.rooms as rooms
    where rooms.started_at is null
      and rooms.ended_at is null
      and rooms.waiting_expires_at <= clock_timestamp()
    order by rooms.waiting_expires_at, rooms.id
    limit v_limit
    for update skip locked
  loop
    perform private.end_waiting_room(v_room_id, 'waiting_room_expired');

    return query
    select v_room_id, null::bigint, 'waiting_room_ended'::text;
  end loop;
end;
$$;

create function public.app_switch_room(
  p_account_id bigint,
  p_expected_current_room_code text,
  p_kind text,
  p_display_name text,
  p_target_room_code text default null,
  p_target_player_count integer default null,
  p_waiting_expires_at timestamptz default null
)
returns table (
  result_kind text,
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_source_expired boolean;
  v_source_player public.players%rowtype;
  v_source_result record;
  v_source_room public.rooms%rowtype;
  v_target_result record;
  v_target_room public.rooms%rowtype;
  v_target_room_id bigint;
begin
  if p_expected_current_room_code is null
    or btrim(p_expected_current_room_code) !~ '^[0-9]{6}$'
  then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if p_kind is null or p_kind not in ('create', 'join') then
    raise exception using errcode = 'P0001', message = 'invalid_room_switch_kind';
  end if;

  perform private.lock_account(p_account_id);

  select players.*
  into v_source_player
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select rooms.*
  into v_source_room
  from public.rooms as rooms
  where rooms.id = v_source_player.room_id;

  if not found
    or v_source_room.public_room_code <> btrim(p_expected_current_room_code)
  then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if p_kind = 'join' then
    if btrim(p_target_room_code) = v_source_room.public_room_code then
      raise exception using errcode = 'P0001', message = 'current_room_exists';
    end if;

    select rooms.id
    into v_target_room_id
    from public.rooms as rooms
    where rooms.public_room_code = btrim(p_target_room_code)
    order by
      case when rooms.status in ('waiting', 'playing') then 0 else 1 end,
      rooms.created_at desc
    limit 1;

    if not found then
      raise exception using errcode = 'P0001', message = 'room_not_found';
    end if;

    if v_target_room_id = v_source_room.id then
      raise exception using errcode = 'P0001', message = 'current_room_exists';
    end if;

    perform rooms.id
    from public.rooms as rooms
    where rooms.id in (v_source_room.id, v_target_room_id)
    order by rooms.id
    for update;

    select rooms.*
    into v_target_room
    from public.rooms as rooms
    where rooms.id = v_target_room_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'room_not_found';
    end if;

  else
    perform rooms.id
    from public.rooms as rooms
    where rooms.id = v_source_room.id
    for update;
  end if;

  select rooms.*
  into v_source_room
  from public.rooms as rooms
  where rooms.id = v_source_player.room_id
  for update;

  if not found
    or v_source_room.public_room_code <> btrim(p_expected_current_room_code)
  then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_source_player
  from public.players as players
  where players.account_id = p_account_id
    and players.room_id = v_source_room.id
    and players.left_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  v_now := clock_timestamp();

  v_source_expired := v_source_room.status = 'waiting'
    and v_source_room.waiting_expires_at <= v_now;

  if p_kind = 'join'
    and v_target_room.started_at is null
    and v_target_room.waiting_expires_at <= v_now
  then
    if v_source_expired then
      perform private.end_waiting_room(
        v_source_room.id,
        'waiting_room_expired',
        v_source_player.id
      );
    end if;

    if v_target_room.ended_at is null then
      perform private.end_waiting_room(
        v_target_room.id,
        'waiting_room_expired'
      );
    end if;

    return query
    values
      (
        'source'::text,
        v_source_room.id,
        v_source_player.id,
        case when v_source_expired then 'waiting_room_ended'::text end
      ),
      (
        'target'::text,
        v_target_room.id,
        null::bigint,
        'waiting_room_ended'::text
      );
    return;
  end if;

  if v_source_room.status = 'playing' then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  if v_source_expired then
    perform private.end_waiting_room(
      v_source_room.id,
      'waiting_room_expired',
      v_source_player.id
    );

    select
      v_source_room.id as room_id,
      v_source_player.id as actor_player_id,
      'waiting_room_ended'::text as notification_reason
    into v_source_result;
  else
    select *
    into v_source_result
    from private.leave_room(p_account_id, v_source_room.id);
  end if;

  if p_kind = 'create' then
    select *
    into v_target_result
    from private.create_room(
      p_account_id,
      p_display_name,
      p_target_player_count,
      p_waiting_expires_at,
      v_source_room.public_room_code
    );
  else
    select *
    into v_target_result
    from private.join_room(p_account_id, v_target_room_id, p_display_name);
  end if;

  return query
  values
    (
      'source'::text,
      v_source_result.room_id,
      v_source_result.actor_player_id,
      v_source_result.notification_reason
    ),
    (
      'target'::text,
      v_target_result.room_id,
      v_target_result.actor_player_id,
      v_target_result.notification_reason
    );
end;
$$;

create function public.app_heartbeat_room_player(
  p_account_id bigint,
  p_room_code text,
  p_disconnect_after_seconds integer default 45
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_disconnect_after_seconds integer := least(
    greatest(coalesce(p_disconnect_after_seconds, 45), 10),
    300
  );
  v_disconnected_count integer := 0;
  v_now timestamptz;
  v_notification_reason text;
  v_player public.players%rowtype;
  v_reconnected boolean;
  v_room public.rooms%rowtype;
  v_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select rooms.id
  into v_room_id
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
    and players.account_id = p_account_id
    and players.left_at is null
  where rooms.public_room_code = btrim(p_room_code);

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = v_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.left_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  v_now := clock_timestamp();

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= v_now then
    perform private.end_waiting_room(
      v_room.id,
      'waiting_room_expired',
      v_player.id
    );

    return query
    select v_room.id, v_player.id, 'waiting_room_ended'::text;
    return;
  end if;

  v_reconnected := v_player.disconnected_at is not null;
  v_cutoff := v_now - make_interval(secs => v_disconnect_after_seconds);

  update public.players as players
  set disconnected_at = null,
      last_seen_at = greatest(players.last_seen_at, v_now)
  where players.id = v_player.id;

  if v_room.status <> 'ended' then
    with disconnected_players as (
      update public.players as players
      set disconnected_at = v_now
      where players.room_id = v_room.id
        and players.id <> v_player.id
        and players.left_at is null
        and players.disconnected_at is null
        and players.last_seen_at < v_cutoff
      returning players.id
    ), inserted_events as (
      insert into public.room_events (
        actor_player_id,
        event_kind,
        payload,
        room_id
      )
      select
        disconnected_players.id,
        'player_disconnected',
        '{}'::jsonb,
        v_room.id
      from disconnected_players
      returning 1
    )
    select count(*) into v_disconnected_count
    from inserted_events;
  end if;

  if v_reconnected then
    insert into public.room_events (
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (v_player.id, 'player_reconnected', '{}'::jsonb, v_room.id);

    v_notification_reason := 'player_reconnected';
  elsif v_disconnected_count > 0 then
    v_notification_reason := 'player_disconnected';
  else
    v_notification_reason := null;
  end if;

  if v_notification_reason is not null then
    update public.rooms as rooms
    set snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = v_room.id;
  end if;

  return query
  select v_room.id, v_player.id, v_notification_reason;
end;
$$;

create function public.app_read_room_runtime_snapshot(
  p_account_id bigint,
  p_room_id bigint default null,
  p_room_code text default null,
  p_include_engine_history boolean default false
)
returns table (snapshot jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room_id bigint;
  v_viewer_player_id bigint;
  v_viewer_role_id text;
begin
  if p_include_engine_history is null
    or (p_room_id is null) = (p_room_code is null)
  then
    raise exception using errcode = 'P0001', message = 'invalid_room_locator';
  end if;

  if p_room_id is not null then
    select rooms.id
    into v_room_id
    from public.rooms as rooms
    where rooms.id = p_room_id;
  else
    select rooms.id
    into v_room_id
    from public.rooms as rooms
    where rooms.public_room_code = btrim(p_room_code)
    order by
      exists (
        select 1
        from public.players as players
        where players.room_id = rooms.id
          and players.account_id = p_account_id
          and players.left_at is null
      ) desc,
      case when rooms.status in ('waiting', 'playing') then 0 else 1 end,
      rooms.created_at desc,
      rooms.id desc
    limit 1;
  end if;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select players.id, assignments.role_id
  into v_viewer_player_id, v_viewer_role_id
  from public.players as players
  left join public.role_assignments as assignments
    on assignments.room_id = players.room_id
    and assignments.player_id = players.id
  where players.room_id = v_room_id
    and players.account_id = p_account_id
    and players.left_at is null;

  return query
  select jsonb_build_object(
    'version', 1,
    'room', (
      select jsonb_build_object(
        'created_at', rooms.created_at,
        'ended_at', rooms.ended_at,
        'host_account_id', rooms.host_account_id,
        'id', rooms.id,
        'public_room_code', rooms.public_room_code,
        'snapshot_revision',
        rooms.snapshot_revision
          + coalesce(
            (
              select topics.snapshot_revision
              from public.realtime_topics as topics
              where topics.room_id = rooms.id
                and topics.scope = 'player_private'
                and topics.player_id = v_viewer_player_id
            ),
            0
          )
          + coalesce(
            (
              select topics.snapshot_revision
              from public.realtime_topics as topics
              where topics.room_id = rooms.id
                and topics.scope = 'role_private'
                and topics.role_id = v_viewer_role_id
            ),
            0
          ),
        'started_at', rooms.started_at,
        'status', rooms.status,
        'target_player_count', rooms.target_player_count,
        'updated_at', rooms.updated_at,
        'waiting_expires_at', rooms.waiting_expires_at
      )
      from public.rooms as rooms
      where rooms.id = v_room_id
    ),
    'viewerPlayerId', v_viewer_player_id,
    'players', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'account_id', players.account_id,
            'disconnected_at', players.disconnected_at,
            'display_name', players.display_name,
            'id', players.id,
            'joined_at', players.joined_at,
            'last_seen_at', players.last_seen_at,
            'left_at', players.left_at,
            'public_player_id', players.public_player_id,
            'room_id', players.room_id,
            'status', players.status
          )
          order by players.joined_at, players.id
        ),
        '[]'::jsonb
      )
      from public.players as players
      where players.room_id = v_room_id
        and (
          not exists (
            select 1
            from public.game_states as states
            where states.room_id = v_room_id
          )
          or exists (
            select 1
            from public.role_assignments as assignments
            where assignments.room_id = players.room_id
              and assignments.player_id = players.id
          )
        )
    ),
    'gameState', (
      select jsonb_build_object(
        'action_revision', states.action_revision,
        'day_number', states.day_number,
        'ended_at', states.ended_at,
        'night_number', states.night_number,
        'phase', states.phase,
        'phase_ends_at', states.phase_ends_at,
        'phase_instance_id', states.phase_instance_id,
        'phase_started_at', states.phase_started_at,
        'revision', states.revision,
        'status', states.status
      )
      from public.game_states as states
      where states.room_id = v_room_id
    ),
    'ruleSet', (
      select jsonb_build_object(
        'engine_version', rule_sets.engine_version,
        'options', rule_sets.options,
        'resolved_role_setup', rule_sets.resolved_role_setup,
        'role_counts', rule_sets.role_counts,
        'role_registry_version', rule_sets.role_registry_version
      )
      from public.game_rule_sets as rule_sets
      where rule_sets.room_id = v_room_id
    ),
    'assignments', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'player_id', assignments.player_id,
            'role_id', assignments.role_id
          )
          order by assignments.player_id
        ),
        '[]'::jsonb
      )
      from public.role_assignments as assignments
      where assignments.room_id = v_room_id
    ),
    'playerStates', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'player_id', states.player_id,
            'alive', states.alive
          )
          order by states.player_id
        ),
        '[]'::jsonb
      )
      from public.game_player_states as states
      where states.room_id = v_room_id
    ),
    'currentActions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'action_key', actions.action_key,
            'action_kind', actions.action_kind,
            'actor_player_id', actions.actor_player_id,
            'actor_role_id', actions.actor_role_id,
            'actor_state_requirement', actions.actor_state_requirement,
            'closes_at', actions.closes_at,
            'created_at', actions.created_at,
            'eligible_target_player_ids', actions.eligible_target_player_ids,
            'id', actions.id,
            'phase_instance_id', actions.phase_instance_id,
            'resolver_role_id', actions.resolver_role_id,
            'target_kind', actions.target_kind,
            'target_state_requirement', actions.target_state_requirement
          )
          order by actions.id
        ),
        '[]'::jsonb
      )
      from (
        select
          actions.id,
          actions.phase_instance_id,
          actions.action_key,
          actions.action_kind,
          actions.resolver_role_id,
          actions.actor_player_id,
          actions.actor_role_id,
          actions.actor_state_requirement,
          actions.target_state_requirement,
          actions.target_kind,
          actions.closes_at,
          actions.created_at,
          coalesce(
            array_agg(eligible.player_id order by eligible.player_id)
              filter (where eligible.player_id is not null),
            '{}'::bigint[]
          ) as eligible_target_player_ids
        from public.current_actions as actions
        left join public.current_action_eligible_players as eligible
          on eligible.room_id = actions.room_id
          and eligible.current_action_id = actions.id
        where actions.room_id = v_room_id
        group by actions.id
      ) as actions
    ),
    'pendingActions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'current_action_id', actions.current_action_id,
            'submitted_at', actions.submitted_at,
            'submitter_player_id', actions.submitter_player_id,
            'target_player_id', actions.target_player_id
          )
          order by actions.current_action_id
        ),
        '[]'::jsonb
      )
      from public.pending_actions as actions
      where actions.room_id = v_room_id
    ),
    'daySpeechSlots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'slot_index', slots.slot_index,
            'speaker_player_id', slots.speaker_player_id
          )
          order by slots.slot_index
        ),
        '[]'::jsonb
      )
      from public.day_speech_slots as slots
      join public.game_states as states
        on states.room_id = slots.room_id
        and states.phase_instance_id = slots.phase_instance_id
      where slots.room_id = v_room_id
    ),
    'publicEvents', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'created_at', events.created_at,
            'event_kind', events.event_kind,
            'id', events.id,
            'payload', events.payload,
            'phase_instance_id', events.phase_instance_id,
            'visibility', events.visibility
          )
          order by events.created_at, events.id
        ),
        '[]'::jsonb
      )
      from (
        select
          events.id,
          events.event_kind,
          events.visibility,
          events.payload,
          events.phase_instance_id,
          events.created_at
        from public.game_events as events
        where events.room_id = v_room_id
          and events.visibility = 'public'
        order by events.created_at desc, events.id desc
        limit 250
      ) as events
    ),
    'privateEvents', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'created_at', events.created_at,
            'event_kind', events.event_kind,
            'id', events.id,
            'payload', events.payload,
            'phase_instance_id', events.phase_instance_id,
            'visibility', events.visibility
          )
          order by events.created_at, events.id
        ),
        '[]'::jsonb
      )
      from (
        select
          events.id,
          events.event_kind,
          events.visibility,
          events.payload,
          events.phase_instance_id,
          events.created_at
        from public.game_events as events
        where events.room_id = v_room_id
          and events.visibility = 'private'
          and v_viewer_player_id is not null
          and (
            exists (
              select 1
              from public.game_event_visible_players as visible_players
              where visible_players.room_id = events.room_id
                and visible_players.game_event_id = events.id
                and visible_players.player_id = v_viewer_player_id
            )
            or (
              v_viewer_role_id is not null
              and exists (
                select 1
                from public.game_event_visible_roles as visible_roles
                where visible_roles.room_id = events.room_id
                  and visible_roles.game_event_id = events.id
                  and visible_roles.role_id = v_viewer_role_id
              )
            )
          )
        order by events.created_at desc, events.id desc
        limit 250
      ) as events
    ),
    'nightConversationMessages', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'body', messages.body,
            'conversation_group_id', messages.conversation_group_id,
            'created_at', messages.created_at,
            'id', messages.id,
            'night_number', messages.night_number,
            'sender_player_id', messages.sender_player_id
          )
          order by messages.created_at, messages.id
        ),
        '[]'::jsonb
      )
      from (
        select
          messages.id,
          messages.night_number,
          messages.conversation_group_id,
          messages.sender_player_id,
          messages.body,
          messages.created_at
        from public.night_conversation_messages as messages
        join public.game_states as states on states.room_id = messages.room_id
        where messages.room_id = v_room_id
          and messages.night_number = states.night_number
          and v_viewer_role_id is not null
          and exists (
            select 1
            from public.game_rule_sets as rule_sets
            cross join lateral jsonb_array_elements(
              rule_sets.resolved_role_setup -> 'nightConversationGroups'
            ) as conversation_groups
            where rule_sets.room_id = messages.room_id
              and conversation_groups ->> 'groupId' = messages.conversation_group_id
              and conversation_groups -> 'roleIds' ? v_viewer_role_id
          )
        order by messages.created_at desc, messages.id desc
        limit 100
      ) as messages
    ),
    'finalOutcome', (
      select jsonb_build_object(
        'winner_team', outcomes.winner_team
      )
      from public.final_outcomes as outcomes
      where outcomes.room_id = v_room_id
    ),
    'playerResults', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'player_id', results.player_id,
            'result', results.result
          )
          order by results.player_id
        ),
        '[]'::jsonb
      )
      from public.player_results as results
      where results.room_id = v_room_id
    ),
    'realtimeTopics', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'topic', topics.topic,
            'scope', topics.scope,
            'role_id', topics.role_id,
            'player_id', topics.player_id
          )
          order by topics.scope, topics.topic
        ),
        '[]'::jsonb
      )
      from public.realtime_topics as topics
      where topics.room_id = v_room_id
        and (
          topics.scope <> 'player_private'
          or not exists (
            select 1
            from public.game_states as states
            where states.room_id = v_room_id
          )
          or exists (
            select 1
            from public.game_player_states as player_states
            where player_states.room_id = topics.room_id
              and player_states.player_id = topics.player_id
          )
        )
    ),
    'resolvedActions', case
      when p_include_engine_history then (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'action_key', actions.action_key,
              'action_kind', actions.action_kind,
              'actor_player_id', actions.actor_player_id,
              'actor_role_id', actions.actor_role_id,
              'day_number', phase_instances.day_number,
              'id', actions.id,
              'night_number', phase_instances.night_number,
              'phase', actions.phase,
              'phase_instance_id', actions.phase_instance_id,
              'resolution_status', actions.resolution_status,
              'resolved_at', actions.resolved_at,
              'resolver_role_id', actions.resolver_role_id,
              'target_player_id', actions.target_player_id
            )
            order by actions.resolved_at, actions.id
          ),
          '[]'::jsonb
        )
        from public.resolved_actions as actions
        join public.game_phase_instances as phase_instances
          on phase_instances.room_id = actions.room_id
         and phase_instances.id = actions.phase_instance_id
        where actions.room_id = v_room_id
      )
      else '[]'::jsonb
    end
  );
end;
$$;

revoke all on function public.app_create_identity(text, text)
  from public, anon, authenticated;
revoke all on function public.app_authenticate_account(text)
  from public, anon, authenticated;
revoke all on function public.app_create_room(bigint, text, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.app_join_room(bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.app_leave_room(bigint, text)
  from public, anon, authenticated;
revoke all on function public.app_get_current_room(bigint)
  from public, anon, authenticated;
revoke all on function public.app_expire_waiting_room_if_needed(bigint)
  from public, anon, authenticated;
revoke all on function public.app_cleanup_expired_waiting_rooms(integer)
  from public, anon, authenticated;
revoke all on function public.app_switch_room(
  bigint,
  text,
  text,
  text,
  text,
  integer,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.app_heartbeat_room_player(bigint, text, integer)
  from public, anon, authenticated;
revoke all on function public.app_read_room_runtime_snapshot(bigint, bigint, text, boolean)
  from public, anon, authenticated;

grant execute on function public.app_create_identity(text, text) to service_role;
grant execute on function public.app_authenticate_account(text) to service_role;
grant execute on function public.app_create_room(bigint, text, integer, timestamptz)
  to service_role;
grant execute on function public.app_join_room(bigint, text, text) to service_role;
grant execute on function public.app_leave_room(bigint, text) to service_role;
grant execute on function public.app_get_current_room(bigint) to service_role;
grant execute on function public.app_expire_waiting_room_if_needed(bigint)
  to service_role;
grant execute on function public.app_cleanup_expired_waiting_rooms(integer)
  to service_role;
grant execute on function public.app_switch_room(
  bigint,
  text,
  text,
  text,
  text,
  integer,
  timestamptz
) to service_role;
grant execute on function public.app_heartbeat_room_player(bigint, text, integer)
  to service_role;
grant execute on function public.app_read_room_runtime_snapshot(bigint, bigint, text, boolean)
  to service_role;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
