drop function if exists public.app_submit_action(bigint, text, text, uuid, text);

create or replace function public.app_submit_action(
  p_account_id bigint,
  p_room_code text,
  p_action_key text,
  p_phase_instance_id uuid,
  p_expected_revision integer,
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
    or p_expected_revision is null
    or v_state.revision <> p_expected_revision
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

revoke all on function public.app_submit_action(bigint, text, text, uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.app_submit_action(bigint, text, text, uuid, integer, text)
  to service_role;
