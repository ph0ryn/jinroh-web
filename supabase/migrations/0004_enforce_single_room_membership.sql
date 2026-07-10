alter table public.accounts
  add column current_room_id bigint;

alter table public.accounts
  add constraint accounts_current_room_id_fkey
  foreign key (current_room_id)
  references public.rooms(id)
  on delete set null
  deferrable initially deferred;

create index accounts_current_room_id_idx
  on public.accounts (current_room_id)
  where current_room_id is not null;

do $$
begin
  if exists (
    select players.account_id
    from public.players
    join public.rooms
      on rooms.id = players.room_id
    where players.status in ('joined', 'disconnected')
      and (
        rooms.status in ('waiting', 'playing')
        or (rooms.status = 'ended' and rooms.started_at is not null)
      )
    group by players.account_id
    having count(distinct players.room_id) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'single_room_membership_backfill_conflict';
  end if;
end;
$$;

update public.accounts
set current_room_id = active_memberships.room_id
from (
  select players.account_id, min(players.room_id) as room_id
  from public.players
  join public.rooms
    on rooms.id = players.room_id
  where players.status in ('joined', 'disconnected')
    and (
      rooms.status in ('waiting', 'playing')
      or (rooms.status = 'ended' and rooms.started_at is not null)
    )
  group by players.account_id
) as active_memberships
where accounts.id = active_memberships.account_id;

create function public.app_assert_account_current_room(p_account_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_room_count integer;
  v_current_room_id bigint;
  v_current_room_started_at timestamptz;
  v_current_room_status text;
  v_has_current_player boolean;
begin
  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id;

  if not found then
    return;
  end if;

  select count(distinct players.room_id)
  into v_active_room_count
  from public.players
  join public.rooms
    on rooms.id = players.room_id
  where players.account_id = p_account_id
    and players.status in ('joined', 'disconnected')
    and (
      rooms.status in ('waiting', 'playing')
      or (rooms.status = 'ended' and rooms.started_at is not null)
    );

  if v_current_room_id is null then
    if v_active_room_count <> 0 then
      raise exception using
        errcode = '23514',
        message = 'single_room_membership_invariant';
    end if;

    return;
  end if;

  select rooms.started_at, rooms.status
  into v_current_room_started_at, v_current_room_status
  from public.rooms
  where rooms.id = v_current_room_id;

  select exists (
    select 1
    from public.players
    where players.account_id = p_account_id
      and players.room_id = v_current_room_id
      and players.status in ('joined', 'disconnected')
  )
  into v_has_current_player;

  if not (
      v_current_room_status in ('waiting', 'playing')
      or (v_current_room_status = 'ended' and v_current_room_started_at is not null)
    )
    or not coalesce(v_has_current_player, false)
    or v_active_room_count <> 1
  then
    raise exception using
      errcode = '23514',
      message = 'single_room_membership_invariant';
  end if;
end;
$$;

create function public.app_validate_account_current_room()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id bigint;
  v_room_id bigint;
begin
  if tg_table_name = 'accounts' then
    if tg_op <> 'DELETE' then
      perform public.app_assert_account_current_room(new.id);
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_table_name = 'players' then
    if tg_op = 'DELETE' then
      perform public.app_assert_account_current_room(old.account_id);
      return old;
    end if;

    if tg_op = 'INSERT' then
      perform public.app_assert_account_current_room(new.account_id);
      return new;
    end if;

    perform public.app_assert_account_current_room(old.account_id);

    if new.account_id is distinct from old.account_id then
      perform public.app_assert_account_current_room(new.account_id);
    end if;

    return new;
  end if;

  if tg_table_name = 'rooms' then
    if tg_op = 'DELETE' then
      v_room_id := old.id;
    else
      v_room_id := new.id;
    end if;

    for v_account_id in
      select account_ids.account_id
      from (
        select accounts.id as account_id
        from public.accounts
        where accounts.current_room_id = v_room_id
        union
        select players.account_id
        from public.players
        where players.room_id = v_room_id
      ) as account_ids
      order by account_ids.account_id
    loop
      perform public.app_assert_account_current_room(v_account_id);
    end loop;

    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  raise exception 'Unsupported membership validation table: %.', tg_table_name;
end;
$$;

create constraint trigger accounts_validate_current_room
  after insert or update or delete on public.accounts
  deferrable initially deferred
  for each row execute function public.app_validate_account_current_room();

create constraint trigger players_validate_account_current_room
  after insert or update or delete on public.players
  deferrable initially deferred
  for each row execute function public.app_validate_account_current_room();

create constraint trigger rooms_validate_account_current_room
  after insert or update or delete on public.rooms
  deferrable initially deferred
  for each row execute function public.app_validate_account_current_room();

create function public.app_release_current_room_on_waiting_end()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status <> 'waiting'
    or new.status <> 'ended'
    or new.started_at is not null
  then
    return new;
  end if;

  perform accounts.id
  from public.accounts
  where accounts.current_room_id = new.id
  order by accounts.id
  for update;

  update public.accounts
  set current_room_id = null
  where accounts.current_room_id = new.id;

  update public.realtime_grants
  set revoked_at = now()
  where realtime_grants.revoked_at is null
    and exists (
      select 1
      from public.players
      where players.id = realtime_grants.player_id
        and players.room_id = new.id
    );

  return new;
end;
$$;

create trigger rooms_release_current_room_on_waiting_end
  after update of status on public.rooms
  for each row
  when (
    old.status = 'waiting'
    and new.status = 'ended'
    and new.started_at is null
  )
  execute function public.app_release_current_room_on_waiting_end();

create function public.app_sync_current_room_from_player()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_new_room_started_at timestamptz;
  v_new_room_status text;
begin
  if tg_op = 'DELETE' then
    perform accounts.id
    from public.accounts
    where accounts.id = old.account_id
    for update;

    update public.accounts
    set current_room_id = null
    where accounts.id = old.account_id
      and accounts.current_room_id = old.room_id
      and old.status in ('joined', 'disconnected');

    return old;
  end if;

  if tg_op = 'INSERT' then
    perform accounts.id
    from public.accounts
    where accounts.id = new.account_id
    for update;
  else
    perform accounts.id
    from public.accounts
    where accounts.id in (old.account_id, new.account_id)
    order by accounts.id
    for update;

    if old.status in ('joined', 'disconnected')
      and (
        new.status = 'left'
        or new.account_id is distinct from old.account_id
        or new.room_id is distinct from old.room_id
      )
    then
      update public.accounts
      set current_room_id = null
      where accounts.id = old.account_id
        and accounts.current_room_id = old.room_id;
    end if;
  end if;

  if new.status in ('joined', 'disconnected') then
    select rooms.started_at, rooms.status
    into v_new_room_started_at, v_new_room_status
    from public.rooms
    where rooms.id = new.room_id;

    if v_new_room_status in ('waiting', 'playing')
      or (v_new_room_status = 'ended' and v_new_room_started_at is not null)
    then
      select accounts.current_room_id
      into v_current_room_id
      from public.accounts
      where accounts.id = new.account_id;

      if v_current_room_id is not null and v_current_room_id <> new.room_id then
        raise exception using errcode = 'P0001', message = 'current_room_exists';
      end if;

      update public.accounts
      set current_room_id = new.room_id
      where accounts.id = new.account_id
        and accounts.current_room_id is distinct from new.room_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger players_sync_account_current_room
  after insert or delete or update of account_id, room_id, status
  on public.players
  for each row execute function public.app_sync_current_room_from_player();

revoke all on function public.app_assert_account_current_room(bigint)
  from public, anon, authenticated;
revoke all on function public.app_validate_account_current_room()
  from public, anon, authenticated;
revoke all on function public.app_release_current_room_on_waiting_end()
  from public, anon, authenticated;
revoke all on function public.app_sync_current_room_from_player()
  from public, anon, authenticated;

grant execute on function public.app_assert_account_current_room(bigint) to service_role;
grant execute on function public.app_validate_account_current_room() to service_role;
grant execute on function public.app_release_current_room_on_waiting_end() to service_role;
grant execute on function public.app_sync_current_room_from_player() to service_role;

create or replace function public.app_create_room(
  p_account_id bigint,
  p_public_room_code text,
  p_realtime_topic text,
  p_waiting_expires_at timestamptz,
  p_public_player_id text,
  p_display_name text,
  p_target_player_count integer
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_player_id bigint;
  v_room public.rooms%rowtype;
begin
  if p_target_player_count is null
    or p_target_player_count < 3
    or p_target_player_count > 10
  then
    raise exception 'Target player count must be between 3 and 10.';
  end if;

  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if not found then
    raise exception 'Account not found.';
  end if;

  if v_current_room_id is not null then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  insert into public.rooms (
    host_account_id,
    waiting_expires_at,
    public_room_code,
    realtime_topic,
    status,
    target_player_count
  )
  values (
    p_account_id,
    p_waiting_expires_at,
    p_public_room_code,
    p_realtime_topic,
    'waiting',
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

  update public.accounts
  set current_room_id = v_room.id
  where accounts.id = p_account_id;

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
    v_room.waiting_expires_at,
    v_room.started_at,
    v_player_id,
    'room_created'::text;
end;
$$;

create or replace function public.app_join_room(
  p_account_id bigint,
  p_room_code text,
  p_public_player_id text,
  p_display_name text
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
set search_path = public
as $$
declare
  v_active_player_count bigint;
  v_current_room_id bigint;
  v_event_kind text;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by
    case when rooms.status in ('waiting', 'playing') then 0 else 1 end,
    rooms.created_at desc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if v_room.status not in ('waiting', 'playing') then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if not found then
    raise exception 'Account not found.';
  end if;

  if v_current_room_id is not null and v_current_room_id <> v_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_exists';
  end if;

  select players.*
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if found then
    if v_room.status = 'playing'
      and (v_current_room_id is distinct from v_room.id or v_player.status = 'left')
    then
      raise exception using errcode = 'P0001', message = 'room_not_joinable';
    end if;

    v_event_kind := case
      when v_player.status = 'left' then 'player_joined'
      else 'player_reconnected'
    end;

    if v_player.status = 'left' then
      select count(*)
      into v_active_player_count
      from public.players
      where players.room_id = v_room.id
        and players.status in ('joined', 'disconnected');

      if v_active_player_count >= v_room.target_player_count then
        raise exception using errcode = 'P0001', message = 'room_full';
      end if;
    end if;

    update public.players
    set disconnected_at = null,
        last_seen_at = now(),
        left_at = null,
        status = 'joined'
    where players.id = v_player.id
    returning * into v_player;
  else
    if v_room.status <> 'waiting' then
      raise exception using errcode = 'P0001', message = 'room_not_joinable';
    end if;

    select count(*)
    into v_active_player_count
    from public.players
    where players.room_id = v_room.id
      and players.status in ('joined', 'disconnected');

    if v_active_player_count >= v_room.target_player_count then
      raise exception using errcode = 'P0001', message = 'room_full';
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

  update public.accounts
  set current_room_id = v_room.id
  where accounts.id = p_account_id;

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
    v_room.waiting_expires_at,
    v_room.started_at,
    v_player.id,
    v_event_kind;
end;
$$;

create function public.app_leave_current_room_locked(
  p_account_id bigint,
  p_room_id bigint
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_notification_reason text := 'player_left';
  v_player public.players%rowtype;
  v_remaining_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms
  where rooms.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if not found or v_current_room_id is distinct from v_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_room.status = 'playing' then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= now() then
    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
      and rooms.status = 'waiting'
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
      'room_ended',
      '{"reason":"waiting_room_expired"}'::jsonb,
      v_room.id
    );

    return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.waiting_expires_at,
      v_room.started_at,
      null::bigint,
      'waiting_room_ended'::text;
    return;
  end if;

  if v_room.status not in ('waiting', 'ended') then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if not found or v_player.status = 'left' then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  update public.players
  set disconnected_at = null,
      left_at = now(),
      status = 'left'
  where players.id = v_player.id
  returning * into v_player;

  update public.accounts
  set current_room_id = null
  where accounts.id = p_account_id
    and accounts.current_room_id = v_room.id;

  update public.realtime_grants
  set revoked_at = now()
  where realtime_grants.player_id = v_player.id
    and realtime_grants.revoked_at is null;

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player.id, 'player_left', '{}'::jsonb, v_room.id);

  perform players.id
  from public.players
  where players.room_id = v_room.id
    and players.status in ('joined', 'disconnected')
  order by players.id
  for update;

  select players.*
  into v_remaining_player
  from public.players
  where players.room_id = v_room.id
    and players.status in ('joined', 'disconnected')
  order by players.joined_at asc, players.id asc
  limit 1;

  if not found and v_room.status = 'waiting' then
    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
      and rooms.status = 'waiting'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      p_account_id,
      v_player.id,
      'room_ended',
      '{"reason":"last_player_left_waiting_room"}'::jsonb,
      v_room.id
    );

    v_notification_reason := 'waiting_room_ended';
  elsif found and v_room.host_account_id = p_account_id then
    update public.rooms
    set host_account_id = v_remaining_player.account_id
    where rooms.id = v_room.id
      and rooms.status in ('waiting', 'ended')
    returning * into v_room;
  end if;

  return query
  select
    v_room.id,
    v_room.public_room_code,
    v_room.status,
    v_room.host_account_id,
    v_room.realtime_topic,
    v_room.waiting_expires_at,
    v_room.started_at,
    v_player.id,
    v_notification_reason;
end;
$$;

create or replace function public.app_leave_room(
  p_account_id bigint,
  p_room_code text
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
set search_path = public
as $$
declare
  v_room_id bigint;
begin
  select rooms.id
  into v_room_id
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  return query
  select *
  from public.app_leave_current_room_locked(p_account_id, v_room_id);
end;
$$;

create or replace function public.app_heartbeat_room_player(
  p_account_id bigint,
  p_room_code text,
  p_disconnect_after_seconds integer default 45
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_disconnect_after_seconds integer := least(
    greatest(coalesce(p_disconnect_after_seconds, 45), 10),
    300
  );
  v_disconnected_count integer := 0;
  v_notification_reason text := null;
  v_player public.players%rowtype;
  v_reconnected boolean := false;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if not found or v_current_room_id is distinct from v_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= now() then
    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
      and rooms.status = 'waiting'
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
      'room_ended',
      '{"reason":"waiting_room_expired"}'::jsonb,
      v_room.id
    );

    return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.waiting_expires_at,
      v_room.started_at,
      null::bigint,
      'waiting_room_ended'::text;
    return;
  end if;

  if v_room.status not in ('waiting', 'playing') then
    return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.waiting_expires_at,
      v_room.started_at,
      null::bigint,
      null::text;
    return;
  end if;

  select players.*
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status <> 'left'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
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

  perform players.id
  from public.players
  where players.room_id = v_room.id
    and players.account_id <> p_account_id
    and players.status = 'joined'
    and players.last_seen_at <= now() - make_interval(secs => v_disconnect_after_seconds)
  order by players.id
  for update;

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
    v_room.waiting_expires_at,
    v_room.started_at,
    v_player.id,
    v_notification_reason;
end;
$$;

create function public.app_get_current_room(
  p_account_id bigint
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_locked_current_room_id bigint;
  v_player_id bigint;
  v_room public.rooms%rowtype;
begin
  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id;

  if not found then
    raise exception 'Account not found.';
  end if;

  if v_current_room_id is null then
    return;
  end if;

  select rooms.*
  into v_room
  from public.rooms
  where rooms.id = v_current_room_id
  for update;

  if not found then
    return;
  end if;

  select accounts.current_room_id
  into v_locked_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if v_locked_current_room_id is distinct from v_room.id then
    return;
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= now() then
    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
      and rooms.status = 'waiting'
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
      'room_ended',
      '{"reason":"waiting_room_expired"}'::jsonb,
      v_room.id
    );

    return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.waiting_expires_at,
      v_room.started_at,
      null::bigint,
      'waiting_room_ended'::text;
    return;
  end if;

  select players.id
  into v_player_id
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status in ('joined', 'disconnected');

  return query
  select
    v_room.id,
    v_room.public_room_code,
    v_room.status,
    v_room.host_account_id,
    v_room.realtime_topic,
    v_room.waiting_expires_at,
    v_room.started_at,
    v_player_id,
    null::text;
end;
$$;

create function public.app_switch_create_room(
  p_account_id bigint,
  p_expected_current_room_code text,
  p_public_room_code text,
  p_realtime_topic text,
  p_waiting_expires_at timestamptz,
  p_public_player_id text,
  p_display_name text,
  p_target_player_count integer
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text,
  source_id bigint,
  source_public_room_code text,
  source_status text,
  source_host_account_id bigint,
  source_realtime_topic text,
  source_waiting_expires_at timestamptz,
  source_started_at timestamptz,
  source_actor_player_id bigint,
  source_notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_locked_current_room_id bigint;
  v_source_result record;
  v_source_room public.rooms%rowtype;
  v_target_result record;
begin
  if p_target_player_count is null
    or p_target_player_count < 3
    or p_target_player_count > 10
  then
    raise exception 'Target player count must be between 3 and 10.';
  end if;

  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id;

  if not found or v_current_room_id is null then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select rooms.*
  into v_source_room
  from public.rooms
  where rooms.id = v_current_room_id
  for update;

  if not found or v_source_room.public_room_code <> p_expected_current_room_code then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select accounts.current_room_id
  into v_locked_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if v_locked_current_room_id is distinct from v_source_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_source_room.status = 'playing' then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  select *
  into v_source_result
  from public.app_leave_current_room_locked(p_account_id, v_source_room.id);

  select *
  into v_target_result
  from public.app_create_room(
    p_account_id,
    p_public_room_code,
    p_realtime_topic,
    p_waiting_expires_at,
    p_public_player_id,
    p_display_name,
    p_target_player_count
  );

  return query
  select
    v_target_result.id,
    v_target_result.public_room_code,
    v_target_result.status,
    v_target_result.host_account_id,
    v_target_result.realtime_topic,
    v_target_result.waiting_expires_at,
    v_target_result.started_at,
    v_target_result.actor_player_id,
    v_target_result.notification_reason,
    v_source_result.id,
    v_source_result.public_room_code,
    v_source_result.status,
    v_source_result.host_account_id,
    v_source_result.realtime_topic,
    v_source_result.waiting_expires_at,
    v_source_result.started_at,
    v_source_result.actor_player_id,
    v_source_result.notification_reason;
end;
$$;

create function public.app_switch_join_room(
  p_account_id bigint,
  p_expected_current_room_code text,
  p_target_room_code text,
  p_public_player_id text,
  p_display_name text
) returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamptz,
  started_at timestamptz,
  actor_player_id bigint,
  notification_reason text,
  source_id bigint,
  source_public_room_code text,
  source_status text,
  source_host_account_id bigint,
  source_realtime_topic text,
  source_waiting_expires_at timestamptz,
  source_started_at timestamptz,
  source_actor_player_id bigint,
  source_notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_room_id bigint;
  v_locked_current_room_id bigint;
  v_source_result record;
  v_source_room public.rooms%rowtype;
  v_target_result record;
  v_target_room public.rooms%rowtype;
  v_target_room_id bigint;
begin
  select accounts.current_room_id
  into v_current_room_id
  from public.accounts
  where accounts.id = p_account_id;

  if not found or v_current_room_id is null then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select rooms.*
  into v_target_room
  from public.rooms
  where rooms.public_room_code = p_target_room_code
  order by
    case when rooms.status in ('waiting', 'playing') then 0 else 1 end,
    rooms.created_at desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  v_target_room_id := v_target_room.id;

  perform rooms.id
  from public.rooms
  where rooms.id in (v_current_room_id, v_target_room_id)
  order by rooms.id
  for update;

  select rooms.*
  into v_source_room
  from public.rooms
  where rooms.id = v_current_room_id;

  select rooms.*
  into v_target_room
  from public.rooms
  where rooms.id = v_target_room_id;

  if v_source_room.id is null
    or v_source_room.public_room_code <> p_expected_current_room_code
  then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select accounts.current_room_id
  into v_locked_current_room_id
  from public.accounts
  where accounts.id = p_account_id
  for update;

  if v_locked_current_room_id is distinct from v_source_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_source_room.status = 'playing' then
    raise exception using errcode = 'P0001', message = 'room_switch_forbidden';
  end if;

  if v_target_room.id = v_source_room.id then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  if v_target_room.status = 'waiting' and v_target_room.waiting_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if v_target_room.status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  select *
  into v_source_result
  from public.app_leave_current_room_locked(p_account_id, v_source_room.id);

  select *
  into v_target_result
  from public.app_join_room(
    p_account_id,
    v_target_room.public_room_code,
    p_public_player_id,
    p_display_name
  );

  return query
  select
    v_target_result.id,
    v_target_result.public_room_code,
    v_target_result.status,
    v_target_result.host_account_id,
    v_target_result.realtime_topic,
    v_target_result.waiting_expires_at,
    v_target_result.started_at,
    v_target_result.actor_player_id,
    v_target_result.notification_reason,
    v_source_result.id,
    v_source_result.public_room_code,
    v_source_result.status,
    v_source_result.host_account_id,
    v_source_result.realtime_topic,
    v_source_result.waiting_expires_at,
    v_source_result.started_at,
    v_source_result.actor_player_id,
    v_source_result.notification_reason;
end;
$$;

alter function public.app_issue_realtime_grant(bigint, text, integer)
  rename to app_issue_realtime_grant_without_membership_check;

create function public.app_issue_realtime_grant(
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
    );

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

create or replace function public.can_receive_realtime_topic(
  p_grant_id text,
  p_topic text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.realtime_grants
    join public.players
      on players.id = realtime_grants.player_id
    join public.accounts
      on accounts.id = players.account_id
     and accounts.current_room_id = players.room_id
    join public.rooms
      on rooms.id = players.room_id
     and (
       rooms.status in ('waiting', 'playing')
       or (rooms.status = 'ended' and rooms.started_at is not null)
     )
    join public.realtime_grant_topics
      on realtime_grant_topics.grant_id = realtime_grants.id
    join public.realtime_topics
      on realtime_topics.id = realtime_grant_topics.topic_id
    where realtime_grants.grant_id::text = p_grant_id
      and realtime_grants.expires_at > now()
      and realtime_grants.revoked_at is null
      and players.status <> 'left'
      and realtime_topics.topic = p_topic
  );
$$;

revoke all on function public.app_leave_current_room_locked(bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.app_get_current_room(bigint)
  from public, anon, authenticated;
revoke all on function public.app_switch_create_room(
  bigint,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  integer
) from public, anon, authenticated;
revoke all on function public.app_switch_join_room(bigint, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.app_issue_realtime_grant(bigint, text, integer)
  from public, anon, authenticated;
revoke all on function public.app_issue_realtime_grant_without_membership_check(
  bigint,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.app_leave_current_room_locked(bigint, bigint)
  to service_role;
grant execute on function public.app_get_current_room(bigint) to service_role;
grant execute on function public.app_switch_create_room(
  bigint,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  integer
) to service_role;
grant execute on function public.app_switch_join_room(bigint, text, text, text, text)
  to service_role;
grant execute on function public.app_issue_realtime_grant(bigint, text, integer)
  to service_role;
grant execute on function public.app_issue_realtime_grant_without_membership_check(
  bigint,
  text,
  integer
) to service_role;
