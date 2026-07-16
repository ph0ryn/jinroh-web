create function private.random_identifier(p_prefix text, p_byte_count integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_random_hex text := '';
begin
  if p_prefix is null or p_byte_count is null or p_byte_count < 8 or p_byte_count > 48 then
    raise exception using errcode = '22023', message = 'invalid_identifier_request';
  end if;

  for v_index in 1..pg_catalog.ceil(p_byte_count / 16.0)::integer loop
    v_random_hex := v_random_hex
      || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  end loop;

  return p_prefix || pg_catalog.left(v_random_hex, p_byte_count * 2);
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

create function private.expire_open_room(
  p_room_id bigint,
  p_now timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = p_room_id
  for update;

  if not found
    or v_room.closed_at is not null
    or v_room.lobby_expires_at > p_now
    or exists (
      select 1
      from public.games as games
      where games.id = v_room.current_game_id
        and games.ended_at is null
    )
  then
    return false;
  end if;

  select pg_catalog.count(*)::integer
  into v_active_count
  from public.players as players
  where players.room_id = v_room.id
    and players.left_at is null;

  update public.players as players
  set left_at = p_now,
      disconnected_at = null
  where players.room_id = v_room.id
    and players.left_at is null;

  update public.realtime_grants as grants
  set revoked_at = p_now
  where grants.room_id = v_room.id
    and grants.revoked_at is null;

  update public.rooms as rooms
  set closed_at = p_now,
      roster_revision = rooms.roster_revision + case when v_active_count > 0 then 1 else 0 end,
      snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = p_now
  where rooms.id = v_room.id;

  insert into public.room_events (room_id, event_kind, payload, created_at)
  values (
    v_room.id,
    'room_closed',
    pg_catalog.jsonb_build_object('reason', 'expired'),
    p_now
  );

  return true;
end;
$$;

create function private.expire_current_room_before_membership_change(
  p_account_id bigint,
  p_target_room_code text,
  p_now timestamptz default pg_catalog.clock_timestamp()
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
  v_current_room_id bigint;
  v_player_id bigint;
  v_target_room_id bigint;
begin
  select players.room_id, players.id
  into v_current_room_id, v_player_id
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  if not found then
    return;
  end if;

  if p_target_room_code is not null then
    select rooms.id
    into v_target_room_id
    from public.rooms as rooms
    where rooms.public_room_code = pg_catalog.btrim(p_target_room_code)
      and rooms.closed_at is null
    order by rooms.created_at desc, rooms.id desc
    limit 1;
  end if;

  -- Every multi-Room membership path locks Room rows in ascending ID order.
  perform rooms.id
  from public.rooms as rooms
  where rooms.id = v_current_room_id
    or rooms.id = v_target_room_id
  order by rooms.id
  for update;

  select players.room_id, players.id
  into v_current_room_id, v_player_id
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null;

  if found
    and v_current_room_id is distinct from v_target_room_id
    and private.expire_open_room(v_current_room_id, p_now)
  then
    return query select v_current_room_id, v_player_id, 'room_closed'::text;
  end if;
end;
$$;

create function private.create_room(
  p_account_id bigint,
  p_display_name text,
  p_target_player_count integer,
  p_lobby_expires_at timestamptz
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player_id bigint;
  v_public_room_code text;
  v_room_id bigint;
begin
  if p_display_name is null
    or p_display_name <> pg_catalog.btrim(p_display_name)
    or pg_catalog.char_length(p_display_name) not between 1 and 8
    or p_display_name !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$'
    or p_target_player_count not between 3 and 10
    or p_lobby_expires_at is null
    or p_lobby_expires_at <= v_now
  then
    raise exception using errcode = 'P0001', message = 'invalid_room_request';
  end if;

  if exists (
    select 1
    from public.players as players
    where players.account_id = p_account_id
      and players.left_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  for v_attempt in 1..64 loop
    v_public_room_code := pg_catalog.lpad(
      pg_catalog.floor(pg_catalog.random() * 1000000)::integer::text,
      6,
      '0'
    );

    begin
      insert into public.rooms (
        public_room_code,
        host_account_id,
        target_player_count,
        lobby_expires_at,
        roster_revision,
        snapshot_revision,
        created_at,
        updated_at
      )
      values (
        v_public_room_code,
        p_account_id,
        p_target_player_count,
        p_lobby_expires_at,
        1,
        1,
        v_now,
        v_now
      )
      returning rooms.id into v_room_id;

      exit;
    exception
      when unique_violation then
        v_room_id := null;
    end;
  end loop;

  if v_room_id is null then
    raise exception using errcode = 'P0001', message = 'room_code_exhausted';
  end if;

  insert into public.players (
    room_id,
    account_id,
    public_player_id,
    display_name,
    joined_at,
    last_seen_at
  )
  values (
    v_room_id,
    p_account_id,
    private.random_identifier('pl_', 18),
    p_display_name,
    v_now,
    v_now
  )
  returning players.id into v_player_id;

  insert into public.realtime_topics (topic, room_id, scope)
  values (private.random_identifier('room:', 24), v_room_id, 'room');

  insert into public.realtime_topics (topic, room_id, scope, player_id)
  values (
    private.random_identifier('player:', 24),
    v_room_id,
    'player_private',
    v_player_id
  );

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    payload,
    created_at
  )
  values (
    v_room_id,
    'room_created',
    v_player_id,
    pg_catalog.jsonb_build_object('targetPlayerCount', p_target_player_count),
    v_now
  );

  return query select v_room_id, v_player_id, 'room_created'::text;
end;
$$;

create function private.join_room(
  p_account_id bigint,
  p_room_code text,
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
  v_active_count integer;
  v_current_game public.games%rowtype;
  v_detach_game boolean := false;
  v_effective_change boolean := false;
  v_event_kind text;
  v_in_current_game_roster boolean := false;
  v_membership public.players%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_room public.rooms%rowtype;
begin
  if p_room_code is null
    or p_display_name is null
    or p_display_name <> pg_catalog.btrim(p_display_name)
    or pg_catalog.char_length(p_display_name) not between 1 and 8
    or p_display_name !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$'
  then
    raise exception using errcode = 'P0001', message = 'invalid_room_request';
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.public_room_code = pg_catalog.btrim(p_room_code)
    and rooms.closed_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_room.lobby_expires_at <= v_now
    and not exists (
      select 1
      from public.games as games
      where games.id = v_room.current_game_id
        and games.ended_at is null
    )
  then
    perform private.expire_open_room(v_room.id, v_now);
    return query select v_room.id, null::bigint, 'room_closed'::text;
    return;
  end if;

  if exists (
    select 1
    from public.players as players
    where players.account_id = p_account_id
      and players.left_at is null
      and players.room_id <> v_room.id
  ) then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  if v_room.current_game_id is not null then
    select games.*
    into v_current_game
    from public.games as games
    where games.id = v_room.current_game_id
    for update;
  end if;

  select players.*
  into v_membership
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if found and v_membership.left_at is null then
    v_effective_change := v_membership.disconnected_at is not null;
    v_event_kind := case
      when v_membership.disconnected_at is not null then 'player_reconnected'
      else null
    end;

    update public.players as players
    set disconnected_at = null,
        last_seen_at = v_now
    where players.id = v_membership.id;

    if v_effective_change then
      update public.rooms as rooms
      set snapshot_revision = rooms.snapshot_revision + 1,
          updated_at = v_now
      where rooms.id = v_room.id;
    end if;

    if v_event_kind is not null then
      insert into public.room_events (
        room_id,
        event_kind,
        actor_player_id,
        created_at
      )
      values (v_room.id, v_event_kind, v_membership.id, v_now);
    end if;

    return query
    select
      v_room.id,
      v_membership.id,
      case when v_effective_change then coalesce(v_event_kind, 'room_state_changed') end;
    return;
  end if;

  if v_current_game.id is not null and v_current_game.ended_at is null then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  select pg_catalog.count(*)::integer
  into v_active_count
  from public.players as players
  where players.room_id = v_room.id
    and players.left_at is null;

  if v_active_count >= v_room.target_player_count then
    raise exception using errcode = 'P0001', message = 'room_full';
  end if;

  if v_membership.id is not null and v_current_game.id is not null then
    select exists (
      select 1
      from public.game_players as game_players
      where game_players.game_id = v_current_game.id
        and game_players.player_id = v_membership.id
    )
    into v_in_current_game_roster;
  end if;

  v_detach_game := v_current_game.id is not null and not v_in_current_game_roster;

  if v_membership.id is null then
    insert into public.players (
      room_id,
      account_id,
      public_player_id,
      display_name,
      joined_at,
      last_seen_at
    )
    values (
      v_room.id,
      p_account_id,
      private.random_identifier('pl_', 18),
      p_display_name,
      v_now,
      v_now
    )
    returning players.* into v_membership;

    insert into public.realtime_topics (topic, room_id, scope, player_id)
    values (
      private.random_identifier('player:', 24),
      v_room.id,
      'player_private',
      v_membership.id
    );

    v_event_kind := 'player_joined';
  else
    update public.players as players
    set ready_roster_revision = null,
        left_at = null,
        disconnected_at = null,
        last_seen_at = v_now
    where players.id = v_membership.id
    returning players.* into v_membership;

    v_event_kind := 'player_rejoined';
  end if;

  update public.rooms as rooms
  set current_game_id = case when v_detach_game then null else rooms.current_game_id end,
      lobby_expires_at = case
        when v_detach_game then v_now + interval '30 minutes'
        else rooms.lobby_expires_at
      end,
      roster_revision = rooms.roster_revision + 1,
      snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id;

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    game_id,
    payload,
    created_at
  )
  values (
    v_room.id,
    v_event_kind,
    v_membership.id,
    case when v_detach_game then v_current_game.id end,
    pg_catalog.jsonb_build_object('detachedCompletedGame', v_detach_game),
    v_now
  );

  return query select v_room.id, v_membership.id, v_event_kind;
end;
$$;

create function private.leave_room(
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
  v_next_host_account_id bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
  where players.account_id = p_account_id
    and players.left_at is null
    and rooms.public_room_code = pg_catalog.btrim(p_room_code)
  for update of rooms;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.left_at is null
  for update;

  if private.expire_open_room(v_room.id, v_now) then
    return query select v_room.id, v_player.id, 'room_closed'::text;
    return;
  end if;

  if exists (
    select 1
    from public.games as games
    where games.id = v_room.current_game_id
      and games.ended_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  update public.players as players
  set ready_roster_revision = null,
      left_at = v_now,
      disconnected_at = null
  where players.id = v_player.id;

  update public.realtime_grants as grants
  set revoked_at = v_now
  where grants.room_id = v_room.id
    and grants.player_id = v_player.id
    and grants.revoked_at is null;

  select players.account_id
  into v_next_host_account_id
  from public.players as players
  where players.room_id = v_room.id
    and players.left_at is null
  order by players.joined_at, players.id
  limit 1
  for update;

  update public.rooms as rooms
  set host_account_id = coalesce(v_next_host_account_id, rooms.host_account_id),
      roster_revision = rooms.roster_revision + 1,
      snapshot_revision = rooms.snapshot_revision + 1,
      closed_at = case when v_next_host_account_id is null then v_now else rooms.closed_at end,
      updated_at = v_now
  where rooms.id = v_room.id;

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    payload,
    created_at
  )
  values (
    v_room.id,
    'player_left',
    v_player.id,
    pg_catalog.jsonb_build_object(
      'roomClosed',
      v_next_host_account_id is null
    ),
    v_now
  );

  if v_next_host_account_id is null then
    insert into public.room_events (room_id, event_kind, payload, created_at)
    values (
      v_room.id,
      'room_closed',
      pg_catalog.jsonb_build_object('reason', 'empty'),
      v_now
    );
  end if;

  return query select v_room.id, v_player.id, 'player_left'::text;
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

  insert into public.account_tokens (token_hash, account_id, token_hash_key_id)
  values (p_token_hash, v_account_id, p_token_hash_key_id);

  return query select v_account_id;
end;
$$;

create function public.app_consume_rate_limits(p_rules jsonb)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean := true;
  v_available_tokens numeric;
  v_cleanup_now timestamptz := pg_catalog.clock_timestamp();
  v_now timestamptz;
  v_retry_after_seconds integer := 0;
  v_rule record;
begin
  if p_rules is null
    or pg_catalog.jsonb_typeof(p_rules) <> 'array'
    or pg_catalog.jsonb_array_length(p_rules) < 1
    or pg_catalog.jsonb_array_length(p_rules) > 12
  then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_rules';
  end if;

  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct rules.value ->> 'key')
    from pg_catalog.jsonb_array_elements(p_rules) as rules(value)
  ) then
    raise exception using errcode = '22023', message = 'duplicate_rate_limit_rule';
  end if;

  delete from private.rate_limit_buckets as buckets
  using (
    select expired.ctid
    from private.rate_limit_buckets as expired
    where expired.expires_at <= v_cleanup_now
    order by expired.expires_at, expired.bucket_key
    limit 50
    for update skip locked
  ) as cleanup_candidates
  where buckets.ctid = cleanup_candidates.ctid;

  for v_rule in
    select
      rules.value ->> 'key' as bucket_key,
      (rules.value ->> 'capacity')::integer as capacity,
      (rules.value ->> 'refillSeconds')::integer as refill_seconds
    from pg_catalog.jsonb_array_elements(p_rules) as rules(value)
    order by rules.value ->> 'key'
  loop
    if v_rule.bucket_key is null
      or v_rule.bucket_key !~ '^[A-Za-z0-9_-]{43}$'
      or v_rule.capacity is null
      or v_rule.capacity < 1
      or v_rule.capacity > 10000
      or v_rule.refill_seconds is null
      or v_rule.refill_seconds < 1
      or v_rule.refill_seconds > 604800
    then
      raise exception using errcode = '22023', message = 'invalid_rate_limit_rule';
    end if;

    insert into private.rate_limit_buckets (
      bucket_key,
      tokens,
      updated_at,
      expires_at
    )
    values (
      v_rule.bucket_key,
      v_rule.capacity,
      v_cleanup_now,
      v_cleanup_now + pg_catalog.make_interval(secs => v_rule.refill_seconds * 2)
    )
    on conflict (bucket_key) do nothing;

    perform buckets.bucket_key
    from private.rate_limit_buckets as buckets
    where buckets.bucket_key = v_rule.bucket_key
    for update;
  end loop;

  v_now := pg_catalog.clock_timestamp();

  for v_rule in
    select
      rules.value ->> 'key' as bucket_key,
      (rules.value ->> 'capacity')::integer as capacity,
      (rules.value ->> 'refillSeconds')::integer as refill_seconds
    from pg_catalog.jsonb_array_elements(p_rules) as rules(value)
    order by rules.value ->> 'key'
  loop
    select least(
      v_rule.capacity::numeric,
      buckets.tokens
        + greatest(extract(epoch from (v_now - buckets.updated_at)), 0)
          * v_rule.capacity::numeric
          / v_rule.refill_seconds::numeric
    )
    into v_available_tokens
    from private.rate_limit_buckets as buckets
    where buckets.bucket_key = v_rule.bucket_key;

    if v_available_tokens < 1 then
      v_allowed := false;
      v_retry_after_seconds := greatest(
        v_retry_after_seconds,
        pg_catalog.ceil(
          (1 - v_available_tokens)
          * v_rule.refill_seconds::numeric
          / v_rule.capacity::numeric
        )::integer,
        1
      );
    end if;
  end loop;

  for v_rule in
    select
      rules.value ->> 'key' as bucket_key,
      (rules.value ->> 'capacity')::integer as capacity,
      (rules.value ->> 'refillSeconds')::integer as refill_seconds
    from pg_catalog.jsonb_array_elements(p_rules) as rules(value)
    order by rules.value ->> 'key'
  loop
    update private.rate_limit_buckets as buckets
    set tokens = least(
          v_rule.capacity::numeric,
          buckets.tokens
            + greatest(extract(epoch from (v_now - buckets.updated_at)), 0)
              * v_rule.capacity::numeric
              / v_rule.refill_seconds::numeric
        ) - case when v_allowed then 1 else 0 end,
        updated_at = v_now,
        expires_at = v_now
          + pg_catalog.make_interval(secs => v_rule.refill_seconds * 2)
    where buckets.bucket_key = v_rule.bucket_key;
  end loop;

  return query select v_allowed, v_retry_after_seconds;
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
  set last_used_at = pg_catalog.statement_timestamp()
  where tokens.token_hash = p_token_hash
    and (
      tokens.last_used_at is null
      or tokens.last_used_at < pg_catalog.statement_timestamp() - interval '5 minutes'
    );

  return query select v_account_id;
end;
$$;

create function public.app_classify_room_lookup(
  p_account_id bigint,
  p_room_code text
)
returns table (access_kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room_id bigint;
begin
  select rooms.id
  into v_room_id
  from public.rooms as rooms
  where rooms.public_room_code = pg_catalog.btrim(p_room_code)
    and rooms.closed_at is null
  order by rooms.created_at desc, rooms.id desc
  limit 1;

  if not found then
    return query select 'not_found'::text;
  elsif exists (
    select 1
    from public.players as players
    where players.room_id = v_room_id
      and players.account_id = p_account_id
      and players.left_at is null
  ) then
    return query select 'member'::text;
  else
    return query select 'outsider'::text;
  end if;
end;
$$;

create function public.app_create_room(
  p_account_id bigint,
  p_display_name text,
  p_target_player_count integer,
  p_lobby_expires_at timestamptz
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
  v_source_actor_player_id bigint;
  v_source_notification_reason text;
  v_source_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select expired.room_id, expired.actor_player_id, expired.notification_reason
  into v_source_room_id, v_source_actor_player_id, v_source_notification_reason
  from private.expire_current_room_before_membership_change(
    p_account_id,
    null
  ) as expired;

  if found then
    return query
    select
      'source'::text,
      v_source_room_id,
      v_source_actor_player_id,
      v_source_notification_reason;
  end if;

  return query
  select
    'target'::text,
    created.room_id,
    created.actor_player_id,
    created.notification_reason
  from private.create_room(
    p_account_id,
    p_display_name,
    p_target_player_count,
    p_lobby_expires_at
  ) as created;
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
  v_source_actor_player_id bigint;
  v_source_notification_reason text;
  v_source_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select expired.room_id, expired.actor_player_id, expired.notification_reason
  into v_source_room_id, v_source_actor_player_id, v_source_notification_reason
  from private.expire_current_room_before_membership_change(
    p_account_id,
    p_room_code
  ) as expired;

  if found then
    return query
    select
      'source'::text,
      v_source_room_id,
      v_source_actor_player_id,
      v_source_notification_reason;
  end if;

  return query
  select
    'target'::text,
    joined.room_id,
    joined.actor_player_id,
    joined.notification_reason
  from private.join_room(p_account_id, p_room_code, p_display_name) as joined;
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
begin
  perform private.lock_account(p_account_id);

  return query
  select left_room.room_id, left_room.actor_player_id, left_room.notification_reason
  from private.leave_room(p_account_id, p_room_code) as left_room;
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
  v_player_id bigint;
  v_room_id bigint;
begin
  perform private.lock_account(p_account_id);

  select players.room_id, players.id
  into v_room_id, v_player_id
  from public.players as players
  where players.account_id = p_account_id
    and players.left_at is null
  for update;

  if not found then
    return;
  end if;

  if private.expire_open_room(v_room_id) then
    return query select v_room_id, v_player_id, 'room_closed'::text;
  else
    return query select v_room_id, v_player_id, null::text;
  end if;
end;
$$;

create function public.app_expire_room_if_needed(p_room_id bigint)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_room_id is null then
    raise exception using errcode = '22023', message = 'invalid_room_id';
  end if;

  if private.expire_open_room(p_room_id) then
    return query select p_room_id, null::bigint, 'room_closed'::text;
  else
    return query select p_room_id, null::bigint, null::text;
  end if;
end;
$$;

create function public.app_cleanup_expired_rooms(p_limit integer default 50)
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
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_limit';
  end if;

  for v_room_id in
    select rooms.id
    from public.rooms as rooms
    left join public.games as games
      on games.id = rooms.current_game_id
    where rooms.closed_at is null
      and rooms.lobby_expires_at <= pg_catalog.clock_timestamp()
      and (games.id is null or games.ended_at is not null)
    order by rooms.lobby_expires_at, rooms.id
    limit p_limit
    for update of rooms skip locked
  loop
    if private.expire_open_room(v_room_id) then
      return query select v_room_id, null::bigint, 'room_closed'::text;
    end if;
  end loop;
end;
$$;

create function public.app_switch_room(
  p_account_id bigint,
  p_expected_current_room_code text,
  p_kind text,
  p_display_name text,
  p_target_room_code text,
  p_target_player_count integer,
  p_lobby_expires_at timestamptz
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
  v_source_room_id bigint;
  v_source_result record;
  v_target_room_id bigint;
  v_target_result record;
begin
  if p_kind not in ('create', 'join')
    or p_expected_current_room_code is null
    or (p_kind = 'create' and (
      p_target_room_code is not null
      or p_target_player_count is null
      or p_lobby_expires_at is null
    ))
    or (p_kind = 'join' and (
      p_target_room_code is null
      or p_target_player_count is not null
      or p_lobby_expires_at is not null
    ))
  then
    raise exception using errcode = '22023', message = 'invalid_room_switch';
  end if;

  perform private.lock_account(p_account_id);

  select players.room_id
  into v_source_room_id
  from public.players as players
  join public.rooms as rooms
    on rooms.id = players.room_id
  where players.account_id = p_account_id
    and players.left_at is null
    and rooms.public_room_code = pg_catalog.btrim(p_expected_current_room_code)
  for update of players;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if p_kind = 'join' then
    select rooms.id
    into v_target_room_id
    from public.rooms as rooms
    where rooms.public_room_code = pg_catalog.btrim(p_target_room_code)
      and rooms.closed_at is null;

    if not found then
      raise exception using errcode = 'P0001', message = 'room_not_found';
    end if;

    if v_target_room_id = v_source_room_id then
      raise exception using errcode = 'P0001', message = 'current_room_changed';
    end if;

    perform rooms.id
    from public.rooms as rooms
    where rooms.id in (v_source_room_id, v_target_room_id)
    order by rooms.id
    for update;
  else
    perform rooms.id
    from public.rooms as rooms
    where rooms.id = v_source_room_id
    for update;
  end if;

  select *
  into v_source_result
  from private.leave_room(p_account_id, p_expected_current_room_code);

  if p_kind = 'create' then
    select *
    into v_target_result
    from private.create_room(
      p_account_id,
      p_display_name,
      p_target_player_count,
      p_lobby_expires_at
    );
  else
    select *
    into v_target_result
    from private.join_room(p_account_id, p_target_room_code, p_display_name);

    if v_target_result.notification_reason = 'room_closed' then
      raise exception using errcode = 'P0001', message = 'room_closed';
    end if;
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
  p_disconnect_after_seconds integer
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
  v_changed_count integer := 0;
  v_disconnected_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_reconnected boolean;
  v_room public.rooms%rowtype;
begin
  if p_disconnect_after_seconds is null
    or p_disconnect_after_seconds not between 10 and 600
  then
    raise exception using errcode = '22023', message = 'invalid_heartbeat_request';
  end if;

  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
  where players.account_id = p_account_id
    and players.left_at is null
    and rooms.public_room_code = pg_catalog.btrim(p_room_code)
  for update of rooms;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if private.expire_open_room(v_room.id, v_now) then
    return query select v_room.id, null::bigint, 'room_closed'::text;
    return;
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.left_at is null
  for update;

  v_reconnected := v_player.disconnected_at is not null;

  update public.players as players
  set last_seen_at = v_now,
      disconnected_at = null
  where players.id = v_player.id;

  update public.players as players
  set disconnected_at = v_now
  where players.room_id = v_room.id
    and players.id <> v_player.id
    and players.left_at is null
    and players.disconnected_at is null
    and players.last_seen_at
      <= v_now - pg_catalog.make_interval(secs => p_disconnect_after_seconds);

  get diagnostics v_disconnected_count = row_count;
  v_changed_count := v_disconnected_count + case when v_reconnected then 1 else 0 end;

  if v_changed_count > 0 then
    update public.rooms as rooms
    set snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = v_room.id;
  end if;

  if v_reconnected then
    insert into public.room_events (
      room_id,
      event_kind,
      actor_player_id,
      created_at
    )
    values (v_room.id, 'player_reconnected', v_player.id, v_now);
  end if;

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    created_at
  )
  select v_room.id, 'player_disconnected', players.id, v_now
  from public.players as players
  where players.room_id = v_room.id
    and players.disconnected_at = v_now
    and players.id <> v_player.id;

  return query
  select
    v_room.id,
    v_player.id,
    case when v_changed_count > 0 then 'presence_changed'::text end;
end;
$$;

create function public.app_set_room_player_ready(
  p_account_id bigint,
  p_room_code text,
  p_is_ready boolean,
  p_expected_roster_revision bigint
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
  v_currently_ready boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  if p_is_ready is null
    or p_expected_roster_revision is null
    or p_expected_roster_revision < 0
  then
    raise exception using errcode = '22023', message = 'invalid_readiness_request';
  end if;

  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
  where players.account_id = p_account_id
    and players.left_at is null
    and players.disconnected_at is null
    and rooms.public_room_code = pg_catalog.btrim(p_room_code)
  for update of rooms;

  if not found or v_room.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if private.expire_open_room(v_room.id, v_now) then
    return query select v_room.id, v_player.id, 'room_closed'::text;
    return;
  end if;

  if exists (
    select 1
    from public.games as games
    where games.id = v_room.current_game_id
      and games.ended_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'room_in_progress';
  end if;

  if v_room.roster_revision <> p_expected_roster_revision then
    raise exception using errcode = 'P0001', message = 'stale_roster_revision';
  end if;

  v_currently_ready :=
    v_player.ready_roster_revision is not distinct from p_expected_roster_revision;

  if v_currently_ready = p_is_ready then
    return query select v_room.id, v_player.id, null::text;
    return;
  end if;

  update public.players as players
  set ready_roster_revision = case
        when p_is_ready then p_expected_roster_revision
        else null
      end
  where players.id = v_player.id;

  update public.rooms as rooms
  set snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id;

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    payload,
    created_at
  )
  values (
    v_room.id,
    'player_ready_changed',
    v_player.id,
    pg_catalog.jsonb_build_object(
      'isReady',
      p_is_ready,
      'rosterRevision',
      p_expected_roster_revision
    ),
    v_now
  );

  return query select v_room.id, v_player.id, 'player_ready_changed'::text;
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
  v_current_game_id uuid;
  v_project_current_game boolean := false;
  v_room public.rooms%rowtype;
  v_viewer_player_id bigint;
  v_viewer_private_revision bigint := 0;
  v_viewer_role_id text;
begin
  if p_include_engine_history is null
    or (p_room_id is null) = (p_room_code is null)
  then
    raise exception using errcode = 'P0001', message = 'invalid_room_locator';
  end if;

  if p_room_id is not null then
    select rooms.*
    into v_room
    from public.rooms as rooms
    where rooms.id = p_room_id;
  else
    select rooms.*
    into v_room
    from public.rooms as rooms
    where rooms.public_room_code = pg_catalog.btrim(p_room_code)
      and rooms.closed_at is null
    order by rooms.created_at desc, rooms.id desc
    limit 1;
  end if;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  v_current_game_id := v_room.current_game_id;

  if p_account_id is not null then
    select players.id, players.private_snapshot_revision
    into v_viewer_player_id, v_viewer_private_revision
    from public.players as players
    where players.room_id = v_room.id
      and players.account_id = p_account_id
      and players.left_at is null;
  end if;

  if v_current_game_id is not null and (
    p_account_id is null
    or (
      v_viewer_player_id is not null
      and exists (
        select 1
        from public.game_players as game_players
        where game_players.game_id = v_current_game_id
          and game_players.player_id = v_viewer_player_id
      )
    )
  ) then
    v_project_current_game := true;
  end if;

  if v_project_current_game and v_viewer_player_id is not null then
    select game_players.role_id
    into v_viewer_role_id
    from public.game_players as game_players
    where game_players.game_id = v_current_game_id
      and game_players.player_id = v_viewer_player_id;
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'version', 2,
    'room', pg_catalog.jsonb_build_object(
      'closed_at', v_room.closed_at,
      'created_at', v_room.created_at,
      'current_game_id', v_room.current_game_id,
      'host_account_id', v_room.host_account_id,
      'id', v_room.id,
      'public_room_code', v_room.public_room_code,
      'roster_revision', v_room.roster_revision,
      'snapshot_revision',
        v_room.snapshot_revision + coalesce(v_viewer_private_revision, 0),
      'status', case
        when v_room.closed_at is not null then 'closed'
        when v_room.current_game_id is null then 'waiting'
        when exists (
          select 1
          from public.games as games
          where games.id = v_room.current_game_id
            and games.ended_at is null
        ) then 'playing'
        else 'ended'
      end,
      'target_player_count', v_room.target_player_count,
      'updated_at', v_room.updated_at,
      'lobby_expires_at', v_room.lobby_expires_at
    ),
    'viewerPlayerId', v_viewer_player_id,
    'lobbyPlayers', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'account_id', players.account_id,
            'disconnected_at', players.disconnected_at,
            'display_name', players.display_name,
            'id', players.id,
            'joined_at', players.joined_at,
            'last_seen_at', players.last_seen_at,
            'left_at', players.left_at,
            'private_snapshot_revision', players.private_snapshot_revision,
            'public_player_id', players.public_player_id,
            'ready_roster_revision', players.ready_roster_revision,
            'room_id', players.room_id,
            'status', players.status
          )
          order by players.joined_at, players.id
        ),
        '[]'::jsonb
      )
      from public.players as players
      where players.room_id = v_room.id
    ),
    'currentGame', case
      when not v_project_current_game then null
      else pg_catalog.jsonb_build_object(
        'game', (
          select pg_catalog.jsonb_build_object(
            'action_revision', games.action_revision,
            'day_number', games.day_number,
            'ended_at', games.ended_at,
            'id', games.id,
            'night_number', games.night_number,
            'phase', games.phase,
            'phase_ends_at', games.phase_ends_at,
            'phase_instance_id', games.phase_instance_id,
            'phase_started_at', games.phase_started_at,
            'revision', games.revision,
            'started_at', games.started_at,
            'status', games.status,
            'winner_team', games.winner_team
          )
          from public.games as games
          where games.id = v_current_game_id
        ),
        'ruleSet', (
          select pg_catalog.jsonb_build_object(
            'engine_version', rule_sets.engine_version,
            'options', rule_sets.options,
            'resolved_role_setup', rule_sets.resolved_role_setup,
            'role_counts', rule_sets.role_counts,
            'role_registry_version', rule_sets.role_registry_version
          )
          from public.game_rule_sets as rule_sets
          where rule_sets.game_id = v_current_game_id
        ),
        'gamePlayers', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'alive', game_players.alive,
                'player_id', game_players.player_id,
                'result', game_players.result,
                'role_id', game_players.role_id
              )
              order by game_players.player_id
            ),
            '[]'::jsonb
          )
          from public.game_players as game_players
          where game_players.game_id = v_current_game_id
        ),
        'currentActions', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
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
                pg_catalog.array_agg(eligible.player_id order by eligible.player_id)
                  filter (where eligible.player_id is not null),
                '{}'::bigint[]
              ) as eligible_target_player_ids
            from public.current_actions as actions
            left join public.current_action_eligible_players as eligible
              on eligible.game_id = actions.game_id
             and eligible.current_action_id = actions.id
            where actions.game_id = v_current_game_id
            group by actions.id
          ) as actions
        ),
        'pendingActions', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
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
          where actions.game_id = v_current_game_id
        ),
        'resolvedActions', case
          when p_include_engine_history then (
            select coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
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
              on phase_instances.game_id = actions.game_id
             and phase_instances.id = actions.phase_instance_id
            where actions.game_id = v_current_game_id
          )
          else '[]'::jsonb
        end,
        'daySpeechSlots', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'slot_index', slots.slot_index,
                'speaker_player_id', slots.speaker_player_id
              )
              order by slots.slot_index
            ),
            '[]'::jsonb
          )
          from public.day_speech_slots as slots
          join public.games as games
            on games.id = slots.game_id
           and games.phase_instance_id = slots.phase_instance_id
          where slots.game_id = v_current_game_id
        ),
        'publicEvents', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
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
            select events.*
            from public.game_events as events
            where events.game_id = v_current_game_id
              and events.visibility = 'public'
            order by events.created_at desc, events.id desc
            limit 250
          ) as events
        ),
        'privateEvents', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
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
            select events.*
            from public.game_events as events
            where events.game_id = v_current_game_id
              and events.visibility = 'private'
              and v_viewer_player_id is not null
              and (
                exists (
                  select 1
                  from public.game_event_visible_players as visible_players
                  where visible_players.game_id = events.game_id
                    and visible_players.game_event_id = events.id
                    and visible_players.player_id = v_viewer_player_id
                )
                or (
                  v_viewer_role_id is not null
                  and exists (
                    select 1
                    from public.game_event_visible_roles as visible_roles
                    where visible_roles.game_id = events.game_id
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
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
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
            select messages.*
            from public.night_conversation_messages as messages
            join public.games as games
              on games.id = messages.game_id
            where messages.game_id = v_current_game_id
              and messages.night_number = games.night_number
              and v_viewer_role_id is not null
              and exists (
                select 1
                from public.game_rule_sets as rule_sets
                cross join lateral pg_catalog.jsonb_array_elements(
                  rule_sets.resolved_role_setup -> 'nightConversationGroups'
                ) as conversation_groups
                where rule_sets.game_id = messages.game_id
                  and conversation_groups ->> 'groupId' = messages.conversation_group_id
                  and conversation_groups -> 'roleIds' ? v_viewer_role_id
              )
            order by messages.created_at desc, messages.id desc
            limit 100
          ) as messages
        )
      )
    end,
    'realtimeTopics', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'game_id', topics.game_id,
            'player_id', topics.player_id,
            'role_id', topics.role_id,
            'scope', topics.scope,
            'topic', topics.topic
          )
          order by topics.scope, topics.topic
        ),
        '[]'::jsonb
      )
      from public.realtime_topics as topics
      where topics.room_id = v_room.id
        and (
          topics.scope <> 'role_private'
          or (
            v_project_current_game
            and topics.game_id = v_current_game_id
          )
        )
    )
  );
end;
$$;

revoke all on function public.app_create_identity(text, text)
  from public, anon, authenticated;
revoke all on function public.app_consume_rate_limits(jsonb)
  from public, anon, authenticated;
revoke all on function public.app_authenticate_account(text)
  from public, anon, authenticated;
revoke all on function public.app_classify_room_lookup(bigint, text)
  from public, anon, authenticated;
revoke all on function public.app_create_room(bigint, text, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.app_join_room(bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.app_leave_room(bigint, text)
  from public, anon, authenticated;
revoke all on function public.app_get_current_room(bigint)
  from public, anon, authenticated;
revoke all on function public.app_expire_room_if_needed(bigint)
  from public, anon, authenticated;
revoke all on function public.app_cleanup_expired_rooms(integer)
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
revoke all on function public.app_set_room_player_ready(bigint, text, boolean, bigint)
  from public, anon, authenticated;
revoke all on function public.app_read_room_runtime_snapshot(bigint, bigint, text, boolean)
  from public, anon, authenticated;

grant execute on function public.app_create_identity(text, text) to service_role;
grant execute on function public.app_consume_rate_limits(jsonb) to service_role;
grant execute on function public.app_authenticate_account(text) to service_role;
grant execute on function public.app_classify_room_lookup(bigint, text) to service_role;
grant execute on function public.app_create_room(bigint, text, integer, timestamptz)
  to service_role;
grant execute on function public.app_join_room(bigint, text, text) to service_role;
grant execute on function public.app_leave_room(bigint, text) to service_role;
grant execute on function public.app_get_current_room(bigint) to service_role;
grant execute on function public.app_expire_room_if_needed(bigint)
  to service_role;
grant execute on function public.app_cleanup_expired_rooms(integer)
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
grant execute on function public.app_set_room_player_ready(bigint, text, boolean, bigint)
  to service_role;
grant execute on function public.app_read_room_runtime_snapshot(bigint, bigint, text, boolean)
  to service_role;
