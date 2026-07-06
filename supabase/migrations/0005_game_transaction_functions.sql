create or replace function public.app_insert_current_actions(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_closes_at timestamptz,
  p_actions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action jsonb;
begin
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Actions payload must be an array.';
  end if;

  for v_action in
    select value
    from jsonb_array_elements(p_actions) as action(value)
  loop
    insert into public.current_actions (
      action_key,
      action_kind,
      actor_player_id,
      actor_role_id,
      closes_at,
      eligible_target_player_ids,
      phase_instance_id,
      room_id,
      target_kind
    )
    values (
      v_action ->> 'action_key',
      v_action ->> 'action_kind',
      nullif(v_action ->> 'actor_player_id', '')::bigint,
      v_action ->> 'actor_role_id',
      p_closes_at,
      array(
        select target.value::bigint
        from jsonb_array_elements_text(
          coalesce(v_action -> 'eligible_target_player_ids', '[]'::jsonb)
        ) as target(value)
      ),
      p_phase_instance_id,
      p_room_id,
      v_action ->> 'target_kind'
    );
  end loop;
end;
$$;

create or replace function public.app_insert_game_events(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_events jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event jsonb;
  v_event_id bigint;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Events payload must be an array.';
  end if;

  for v_event in
    select value
    from jsonb_array_elements(p_events) as event(value)
  loop
    insert into public.game_events (
      event_kind,
      payload,
      phase_instance_id,
      public_message,
      room_id,
      visibility
    )
    values (
      v_event ->> 'event_kind',
      coalesce(v_event -> 'payload', '{}'::jsonb),
      p_phase_instance_id,
      v_event ->> 'public_message',
      p_room_id,
      v_event ->> 'visibility'
    )
    returning game_events.id into v_event_id;

    insert into public.game_event_visible_players (game_event_id, player_id)
    select v_event_id, player_id.value::bigint
    from jsonb_array_elements_text(
      coalesce(v_event -> 'visible_to_player_ids', '[]'::jsonb)
    ) as player_id(value);

    insert into public.game_event_visible_roles (game_event_id, role_id)
    select v_event_id, role_id.value
    from jsonb_array_elements_text(
      coalesce(v_event -> 'visible_to_role_ids', '[]'::jsonb)
    ) as role_id(value);
  end loop;
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

    update public.players
    set last_seen_at = now(),
        status = 'joined'
    where players.id = v_player.id
    returning * into v_player;
  else
    if v_room.status <> 'lobby' then
      raise exception 'New players can only join during lobby.';
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

create or replace function public.app_start_room(
  p_account_id bigint,
  p_room_code text,
  p_expected_player_ids bigint[],
  p_phase_instance_id uuid,
  p_phase_ends_at timestamptz,
  p_role_counts jsonb,
  p_options jsonb,
  p_resolved_role_setup jsonb,
  p_role_registry_version text,
  p_engine_version text,
  p_assignments jsonb,
  p_actions jsonb,
  p_events jsonb
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
  v_host_player public.players%rowtype;
  v_joined_player_ids bigint[];
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
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

  if v_room.host_account_id <> p_account_id then
    raise exception 'Only the host can start the game.';
  end if;

  select *
  into v_host_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'Room must be in lobby.';
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found or v_state.status <> 'waiting' then
    raise exception 'Room must be waiting for start.';
  end if;

  select coalesce(array_agg(player_id order by joined_at, player_id), '{}'::bigint[])
  into v_joined_player_ids
  from (
    select players.id as player_id, players.joined_at
    from public.players
    where players.room_id = v_room.id
      and players.status = 'joined'
  ) as joined_players;

  if v_joined_player_ids <> coalesce(p_expected_player_ids, '{}'::bigint[]) then
    raise exception 'Room players changed. Retry game start.';
  end if;

  if jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) <> coalesce(array_length(p_expected_player_ids, 1), 0)
  then
    raise exception 'Role assignments do not match joined players.';
  end if;

  update public.rooms
  set started_at = now(),
      status = 'playing'
  where rooms.id = v_room.id
    and rooms.status = 'lobby'
  returning * into v_room;

  insert into public.game_rule_sets (
    engine_version,
    options,
    role_counts,
    role_registry_version,
    room_id
  )
  values (
    p_engine_version,
    p_options,
    p_role_counts,
    p_role_registry_version,
    v_room.id
  );

  update public.game_states
  set night_number = 1,
      phase = 'night',
      phase_ends_at = p_phase_ends_at,
      phase_instance_id = p_phase_instance_id,
      phase_started_at = now(),
      resolved_role_setup = p_resolved_role_setup,
      revision = 1,
      status = 'playing'
  where game_states.id = v_state.id
    and game_states.status = 'waiting';

  insert into public.role_assignments (player_id, role_id, room_id)
  select assignment.player_id, assignment.role_id, v_room.id
  from jsonb_to_recordset(p_assignments) as assignment(player_id bigint, role_id text);

  insert into public.game_player_states (alive, player_id, room_id)
  select true, player_id, v_room.id
  from unnest(p_expected_player_ids) as player_id;

  perform public.app_insert_current_actions(
    v_room.id,
    p_phase_instance_id,
    p_phase_ends_at,
    p_actions
  );
  perform public.app_insert_game_events(v_room.id, p_phase_instance_id, p_events);

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, null, 'game_started', '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_host_player.id,
      'game_started'::text;
end;
$$;

create or replace function public.app_submit_action(
  p_account_id bigint,
  p_room_code text,
  p_action_key text,
  p_phase_instance_id uuid,
  p_target_public_player_id text
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
  v_action public.current_actions%rowtype;
  v_pending_action_id bigint;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_target_player_id bigint;
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

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found
    or v_room.status <> 'playing'
    or v_state.status <> 'playing'
    or v_state.phase_instance_id <> p_phase_instance_id
  then
    raise exception 'Action belongs to a stale phase.';
  end if;

  select role_assignments.role_id
  into v_submitter_role_id
  from public.role_assignments
  where role_assignments.room_id = v_room.id
    and role_assignments.player_id = v_player.id;

  select game_player_states.alive
  into v_submitter_alive
  from public.game_player_states
  where game_player_states.room_id = v_room.id
    and game_player_states.player_id = v_player.id;

  if coalesce(v_submitter_alive, false) = false then
    raise exception 'Action is not allowed.';
  end if;

  if p_target_public_player_id is not null then
    select players.id
    into v_target_player_id
    from public.players
    where players.room_id = v_room.id
      and players.public_player_id = p_target_public_player_id;

    if not found then
      raise exception 'Target player not found.';
    end if;
  end if;

  select *
  into v_action
  from public.current_actions
  where current_actions.room_id = v_room.id
    and current_actions.action_key = p_action_key
    and current_actions.phase_instance_id = p_phase_instance_id
  for update;

  if not found then
    raise exception 'Action is not available.';
  end if;

  if v_action.closes_at is not null and v_action.closes_at <= now() then
    raise exception 'Action window is closed.';
  end if;

  if v_action.actor_player_id is not null and v_action.actor_player_id <> v_player.id then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.actor_player_id is null
    and v_action.actor_role_id is distinct from v_submitter_role_id
  then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.target_kind = 'none' and v_target_player_id is not null then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.target_kind = 'single_player'
    and (
      v_target_player_id is null
      or not (v_target_player_id = any(v_action.eligible_target_player_ids))
    )
  then
    raise exception 'Action is not allowed.';
  end if;

  insert into public.pending_actions (
    current_action_id,
    room_id,
    submitter_player_id,
    target_player_id
  )
  values (
    v_action.id,
    v_room.id,
    v_player.id,
    v_target_player_id
  )
  on conflict (current_action_id) do nothing
  returning pending_actions.id into v_pending_action_id;

  if v_pending_action_id is null then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_player.id,
        null::text;
    return;
  end if;

  insert into public.game_events (
    event_kind,
    payload,
    phase_instance_id,
    room_id,
    visibility
  )
  values (
    'action_submitted',
    jsonb_build_object('actionKind', v_action.action_kind),
    p_phase_instance_id,
    v_room.id,
    'internal'
  );

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      'action_window_changed'::text;
end;
$$;

create or replace function public.app_resolve_phase(
  p_account_id bigint,
  p_room_code text,
  p_phase_instance_id uuid,
  p_expected_revision integer,
  p_expected_current_action_ids bigint[],
  p_expected_pending_action_ids bigint[],
  p_deaths jsonb,
  p_final_outcome jsonb,
  p_player_results jsonb,
  p_next_phase text,
  p_next_phase_instance_id uuid,
  p_next_phase_ends_at timestamptz,
  p_next_day_number integer,
  p_next_night_number integer,
  p_actions jsonb,
  p_events jsonb
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
  v_all_actions_submitted boolean;
  v_current_action_count integer;
  v_current_action_ids bigint[];
  v_death jsonb;
  v_final_outcome_id bigint;
  v_host_player public.players%rowtype;
  v_pending_action_count integer;
  v_pending_action_ids bigint[];
  v_phase_timed_out boolean;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
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

  if v_room.host_account_id <> p_account_id then
    raise exception 'Only the host can advance the phase.';
  end if;

  select *
  into v_host_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  if v_room.status <> 'playing' then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found
    or v_state.status <> 'playing'
    or v_state.phase_instance_id <> p_phase_instance_id
    or v_state.revision <> p_expected_revision
  then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  select coalesce(array_agg(action_id order by action_id), '{}'::bigint[])
  into v_current_action_ids
  from (
    select current_actions.id as action_id
    from public.current_actions
    where current_actions.room_id = v_room.id
      and current_actions.phase_instance_id = p_phase_instance_id
    for update
  ) as locked_actions;

  select coalesce(array_agg(pending_action_id order by pending_action_id), '{}'::bigint[])
  into v_pending_action_ids
  from (
    select pending_actions.id as pending_action_id
    from public.pending_actions
    join public.current_actions
      on current_actions.id = pending_actions.current_action_id
    where current_actions.room_id = v_room.id
      and current_actions.phase_instance_id = p_phase_instance_id
    for update of pending_actions
  ) as locked_pending_actions;

  if v_current_action_ids <> coalesce(p_expected_current_action_ids, '{}'::bigint[])
    or v_pending_action_ids <> coalesce(p_expected_pending_action_ids, '{}'::bigint[])
  then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  v_current_action_count := coalesce(array_length(v_current_action_ids, 1), 0);
  v_pending_action_count := coalesce(array_length(v_pending_action_ids, 1), 0);
  v_all_actions_submitted := v_current_action_count > 0
    and v_current_action_count = v_pending_action_count;
  v_phase_timed_out := v_state.phase_ends_at is not null and v_state.phase_ends_at <= now();

  if not (
    v_phase_timed_out
    or (
      (v_state.phase <> 'night' or v_state.night_number = 1)
      and v_all_actions_submitted
    )
  ) then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  if p_deaths is null or jsonb_typeof(p_deaths) <> 'array' then
    raise exception 'Deaths payload must be an array.';
  end if;

  for v_death in
    select value
    from jsonb_array_elements(p_deaths) as death(value)
  loop
    update public.game_player_states
    set alive = false,
        death_reason = v_death ->> 'reason',
        died_at = now()
    where game_player_states.room_id = v_room.id
      and game_player_states.player_id = (v_death ->> 'player_id')::bigint;
  end loop;

  delete from public.pending_actions
  where pending_actions.id = any(v_pending_action_ids);

  delete from public.current_actions
  where current_actions.id = any(v_current_action_ids);

  if p_final_outcome is not null then
    insert into public.final_outcomes (
      payload,
      reason,
      room_id,
      winner_team
    )
    values (
      '{}'::jsonb,
      p_final_outcome ->> 'reason',
      v_room.id,
      p_final_outcome ->> 'winner_team'
    )
    returning final_outcomes.id into v_final_outcome_id;

    if p_player_results is null or jsonb_typeof(p_player_results) <> 'array' then
      raise exception 'Player results payload must be an array.';
    end if;

    insert into public.player_results (player_id, result, room_id)
    select player_result.player_id, player_result.result, v_room.id
    from jsonb_to_recordset(p_player_results) as player_result(player_id bigint, result text);

    update public.game_states
    set final_outcome_id = v_final_outcome_id,
        phase = null,
        phase_ends_at = null,
        phase_instance_id = null,
        revision = v_state.revision + 1,
        status = 'ended'
    where game_states.id = v_state.id
      and game_states.revision = v_state.revision;

    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
    returning * into v_room;
  else
    update public.game_states
    set day_number = p_next_day_number,
        night_number = p_next_night_number,
        phase = p_next_phase,
        phase_ends_at = p_next_phase_ends_at,
        phase_instance_id = p_next_phase_instance_id,
        phase_started_at = now(),
        revision = v_state.revision + 1,
        status = 'playing'
    where game_states.id = v_state.id
      and game_states.revision = v_state.revision;

    if p_next_phase_instance_id is not null and p_next_phase_ends_at is not null then
      perform public.app_insert_current_actions(
        v_room.id,
        p_next_phase_instance_id,
        p_next_phase_ends_at,
        p_actions
      );
    end if;
  end if;

  perform public.app_insert_game_events(v_room.id, p_next_phase_instance_id, p_events);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_host_player.id,
      case
        when p_final_outcome is null then 'phase_changed'::text
        else 'game_ended'::text
      end;
end;
$$;

revoke all on function public.app_insert_current_actions(bigint, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.app_insert_game_events(bigint, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.app_join_room(bigint, text, text, text)
  from public, anon, authenticated;
revoke all on function public.app_start_room(
  bigint,
  text,
  bigint[],
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function public.app_submit_action(bigint, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.app_resolve_phase(
  bigint,
  text,
  uuid,
  integer,
  bigint[],
  bigint[],
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  timestamptz,
  integer,
  integer,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.app_insert_current_actions(bigint, uuid, timestamptz, jsonb)
  to service_role;
grant execute on function public.app_insert_game_events(bigint, uuid, jsonb)
  to service_role;
grant execute on function public.app_join_room(bigint, text, text, text) to service_role;
grant execute on function public.app_start_room(
  bigint,
  text,
  bigint[],
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;
grant execute on function public.app_submit_action(bigint, text, text, uuid, text)
  to service_role;
grant execute on function public.app_resolve_phase(
  bigint,
  text,
  uuid,
  integer,
  bigint[],
  bigint[],
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  timestamptz,
  integer,
  integer,
  jsonb,
  jsonb
) to service_role;
