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
  p_next_phase_ends_at timestamp with time zone,
  p_next_day_number integer,
  p_next_night_number integer,
  p_actions jsonb,
  p_day_speech_slots jsonb,
  p_events jsonb
)
returns table(
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  waiting_expires_at timestamp with time zone,
  started_at timestamp with time zone,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
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
        v_room.waiting_expires_at,
        v_room.started_at,
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
        v_room.waiting_expires_at,
        v_room.started_at,
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
        v_room.waiting_expires_at,
        v_room.started_at,
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
        v_room.waiting_expires_at,
        v_room.started_at,
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

      perform public.app_insert_day_speech_slots(
        v_room.id,
        p_next_phase_instance_id,
        p_day_speech_slots
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
      v_room.waiting_expires_at,
      v_room.started_at,
      v_host_player.id,
      case
        when p_final_outcome is not null then 'game_ended'::text
        when p_next_phase is distinct from v_state.phase then 'phase_changed'::text
        else 'action_window_changed'::text
      end;
end;
$$;
