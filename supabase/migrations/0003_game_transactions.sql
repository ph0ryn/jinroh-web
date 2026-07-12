create function private.jsonb_integer_between(
  p_value jsonb,
  p_minimum numeric,
  p_maximum numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null
      or pg_catalog.jsonb_typeof(p_value) <> 'number'
      or p_value #>> '{}' !~ '^-?(0|[1-9][0-9]*)$'
    then false
    else (p_value #>> '{}')::numeric between p_minimum and p_maximum
  end;
$$;

create function private.insert_current_actions(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_closes_at timestamptz,
  p_actions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
  v_action_id bigint;
  v_action_key text;
  v_action_keys text[] := array[]::text[];
  v_action_kind text;
  v_resolver_role_id text;
  v_actor_player_id bigint;
  v_actor_role_id text;
  v_actor_state_requirement text;
  v_distinct_target_count integer;
  v_eligible_player_ids bigint[];
  v_expected_created_at timestamptz;
  v_expected_closes_at timestamptz;
  v_key_count integer;
  v_target_count integer;
  v_target_kind text;
  v_target_state_requirement text;
  v_valid_target_count integer;
begin
  if p_phase_instance_id is null
    or p_actions is null
    or pg_catalog.jsonb_typeof(p_actions) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'invalid_actions';
  end if;

  select states.phase_started_at, states.phase_ends_at
  into v_expected_created_at, v_expected_closes_at
  from public.game_states as states
  where states.room_id = p_room_id
    and states.phase_instance_id = p_phase_instance_id
    and states.status = 'playing';

  if not found
    or p_closes_at is distinct from v_expected_closes_at
  then
    raise exception using errcode = 'P0001', message = 'invalid_actions';
  end if;

  for v_action in
    select items.value
    from pg_catalog.jsonb_array_elements(p_actions) as items(value)
  loop
    if pg_catalog.jsonb_typeof(v_action) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_action);

    if v_key_count <> 9
      or not (
        v_action ? 'action_key'
        and v_action ? 'action_kind'
        and v_action ? 'resolver_role_id'
        and v_action ? 'actor_player_id'
        and v_action ? 'actor_role_id'
        and v_action ? 'actor_state_requirement'
        and v_action ? 'eligible_target_player_ids'
        and v_action ? 'target_kind'
        and v_action ? 'target_state_requirement'
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    v_action_key := v_action ->> 'action_key';
    v_action_kind := v_action ->> 'action_kind';
    v_resolver_role_id := v_action ->> 'resolver_role_id';
    v_actor_role_id := v_action ->> 'actor_role_id';
    v_actor_state_requirement := v_action ->> 'actor_state_requirement';
    v_target_kind := v_action ->> 'target_kind';
    v_target_state_requirement := v_action ->> 'target_state_requirement';

    if pg_catalog.jsonb_typeof(v_action -> 'action_key') <> 'string'
      or v_action_key is null
      or v_action_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
      or pg_catalog.jsonb_typeof(v_action -> 'action_kind') <> 'string'
      or v_action_kind is null
      or v_action_kind !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(v_action -> 'resolver_role_id') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_action -> 'target_kind') <> 'string'
      or v_target_kind is null
      or v_target_kind not in ('none', 'single_player')
      or pg_catalog.jsonb_typeof(v_action -> 'target_state_requirement') <> 'string'
      or v_target_state_requirement not in ('alive', 'assigned')
      or pg_catalog.jsonb_typeof(v_action -> 'eligible_target_player_ids') <> 'array'
      or pg_catalog.jsonb_typeof(v_action -> 'actor_player_id') not in ('number', 'null')
      or pg_catalog.jsonb_typeof(v_action -> 'actor_role_id') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_action -> 'actor_state_requirement') <> 'string'
      or v_actor_state_requirement not in ('alive', 'assigned')
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_action_key = any(v_action_keys) then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    v_action_keys := pg_catalog.array_append(v_action_keys, v_action_key);

    if pg_catalog.jsonb_typeof(v_action -> 'actor_player_id') = 'null' then
      v_actor_player_id := null;
    elsif not private.jsonb_integer_between(
      v_action -> 'actor_player_id',
      1,
      9223372036854775807
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    else
      v_actor_player_id := (v_action ->> 'actor_player_id')::bigint;
    end if;

    if v_actor_role_id is not null
      and v_actor_role_id !~ '^[a-z][a-z0-9_]{0,63}$'
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_resolver_role_id is not null
      and v_resolver_role_id !~ '^[a-z][a-z0-9_]{0,63}$'
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_resolver_role_id is not null
      and not exists (
        select 1
        from public.role_assignments as resolver_assignments
        join public.game_rule_sets as rule_sets
          on rule_sets.room_id = resolver_assignments.room_id
        where resolver_assignments.room_id = p_room_id
          and resolver_assignments.role_id = v_resolver_role_id
          and rule_sets.resolved_role_setup -> 'activeRoleIds'
            ? v_resolver_role_id
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_player_id is null and v_actor_role_id is null then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_player_id is not null
      and not exists (
        select 1
        from public.role_assignments as assignments
        join public.game_player_states as player_states
          on player_states.room_id = assignments.room_id
         and player_states.player_id = assignments.player_id
        where assignments.room_id = p_room_id
          and assignments.player_id = v_actor_player_id
          and (
            v_actor_role_id is null
            or assignments.role_id = v_actor_role_id
          )
          and (
            v_actor_state_requirement = 'assigned'
            or player_states.alive
          )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_role_id is not null
      and v_actor_player_id is null
      and not exists (
        select 1
        from public.role_assignments as assignments
        join public.game_player_states as player_states
          on player_states.room_id = assignments.room_id
         and player_states.player_id = assignments.player_id
        where assignments.room_id = p_room_id
          and assignments.role_id = v_actor_role_id
          and (
            v_actor_state_requirement = 'assigned'
            or player_states.alive
          )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_action -> 'eligible_target_player_ids'
      ) as targets(value)
      where not private.jsonb_integer_between(
        targets.value,
        1,
        9223372036854775807
      )
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    select coalesce(
      pg_catalog.array_agg(targets.value::bigint),
      array[]::bigint[]
    )
    into v_eligible_player_ids
    from pg_catalog.jsonb_array_elements_text(
      v_action -> 'eligible_target_player_ids'
    ) as targets(value);

    v_target_count := pg_catalog.cardinality(v_eligible_player_ids);

    select count(distinct target_id)
    into v_distinct_target_count
    from pg_catalog.unnest(v_eligible_player_ids) as target_ids(target_id);

    if v_distinct_target_count <> v_target_count
      or (v_target_kind = 'none' and v_target_count <> 0)
      or (v_target_kind = 'single_player' and v_target_count = 0)
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    select count(*)
    into v_valid_target_count
    from public.game_player_states as player_states
    where player_states.room_id = p_room_id
      and player_states.player_id = any(v_eligible_player_ids)
      and (
        v_target_state_requirement = 'assigned'
        or player_states.alive
      );

    if v_valid_target_count <> v_target_count then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    insert into public.current_actions (
      room_id,
      phase_instance_id,
      action_key,
      action_kind,
      resolver_role_id,
      actor_player_id,
      actor_role_id,
      actor_state_requirement,
      target_state_requirement,
      target_kind,
      closes_at,
      created_at
    )
    values (
      p_room_id,
      p_phase_instance_id,
      v_action_key,
      v_action_kind,
      v_resolver_role_id,
      v_actor_player_id,
      v_actor_role_id,
      v_actor_state_requirement,
      v_target_state_requirement,
      v_target_kind,
      p_closes_at,
      v_expected_created_at
    )
    returning current_actions.id into v_action_id;

    insert into public.current_action_eligible_players (
      room_id,
      current_action_id,
      player_id
    )
    select p_room_id, v_action_id, targets.player_id
    from pg_catalog.unnest(v_eligible_player_ids) as targets(player_id);
  end loop;
end;
$$;

create function private.insert_game_events(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_created_at timestamptz,
  p_events jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct_player_count integer;
  v_distinct_role_count integer;
  v_event jsonb;
  v_event_id bigint;
  v_event_kind text;
  v_key_count integer;
  v_payload jsonb;
  v_player_count integer;
  v_player_ids bigint[];
  v_role_count integer;
  v_role_ids text[];
  v_valid_player_count integer;
  v_valid_role_count integer;
  v_visibility text;
begin
  if p_phase_instance_id is null
    or p_created_at is null
    or p_created_at > pg_catalog.clock_timestamp()
    or p_events is null
    or pg_catalog.jsonb_typeof(p_events) <> 'array'
    or not exists (
      select 1
      from public.game_states as states
      where states.room_id = p_room_id
        and states.phase_instance_id = p_phase_instance_id
        and states.status = 'playing'
        and p_created_at >= states.phase_started_at
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_events';
  end if;

  for v_event in
    select items.value
    from pg_catalog.jsonb_array_elements(p_events) as items(value)
  loop
    if pg_catalog.jsonb_typeof(v_event) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_event);

    if v_key_count <> 5
      or not (
        v_event ? 'event_kind'
        and v_event ? 'payload'
        and v_event ? 'visibility'
        and v_event ? 'visible_to_player_ids'
        and v_event ? 'visible_to_role_ids'
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    v_event_kind := v_event ->> 'event_kind';
    v_payload := v_event -> 'payload';
    v_visibility := v_event ->> 'visibility';

    if pg_catalog.jsonb_typeof(v_event -> 'event_kind') <> 'string'
      or v_event_kind is null
      or v_event_kind !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(v_payload) <> 'object'
      or pg_catalog.jsonb_typeof(v_event -> 'visibility') <> 'string'
      or v_visibility is null
      or v_visibility not in ('public', 'private', 'internal')
      or pg_catalog.jsonb_typeof(v_event -> 'visible_to_player_ids') <> 'array'
      or pg_catalog.jsonb_typeof(v_event -> 'visible_to_role_ids') <> 'array'
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_event -> 'visible_to_player_ids'
      ) as players(value)
      where not private.jsonb_integer_between(
        players.value,
        1,
        9223372036854775807
      )
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_event -> 'visible_to_role_ids'
      ) as roles(value)
      where pg_catalog.jsonb_typeof(roles.value) <> 'string'
        or roles.value #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    select coalesce(
      pg_catalog.array_agg(players.value::bigint),
      array[]::bigint[]
    )
    into v_player_ids
    from pg_catalog.jsonb_array_elements_text(
      v_event -> 'visible_to_player_ids'
    ) as players(value);

    select coalesce(
      pg_catalog.array_agg(roles.value),
      array[]::text[]
    )
    into v_role_ids
    from pg_catalog.jsonb_array_elements_text(
      v_event -> 'visible_to_role_ids'
    ) as roles(value);

    v_player_count := pg_catalog.cardinality(v_player_ids);
    v_role_count := pg_catalog.cardinality(v_role_ids);

    select count(distinct player_id)
    into v_distinct_player_count
    from pg_catalog.unnest(v_player_ids) as players(player_id);

    select count(distinct role_id)
    into v_distinct_role_count
    from pg_catalog.unnest(v_role_ids) as roles(role_id);

    if v_distinct_player_count <> v_player_count
      or v_distinct_role_count <> v_role_count
      or (
        v_visibility = 'private'
        and v_player_count + v_role_count = 0
      )
      or (
        v_visibility in ('public', 'internal')
        and v_player_count + v_role_count <> 0
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    select count(*)
    into v_valid_player_count
    from public.game_player_states as player_states
    where player_states.room_id = p_room_id
      and player_states.player_id = any(v_player_ids);

    select count(distinct assignments.role_id)
    into v_valid_role_count
    from public.role_assignments as assignments
    where assignments.room_id = p_room_id
      and assignments.role_id = any(v_role_ids);

    if v_valid_player_count <> v_player_count
      or v_valid_role_count <> v_role_count
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    insert into public.game_events (
      room_id,
      phase_instance_id,
      event_kind,
      visibility,
      payload,
      created_at
    )
    values (
      p_room_id,
      p_phase_instance_id,
      v_event_kind,
      v_visibility,
      v_payload,
      p_created_at
    )
    returning game_events.id into v_event_id;

    insert into public.game_event_visible_players (
      room_id,
      game_event_id,
      player_id
    )
    select p_room_id, v_event_id, players.player_id
    from pg_catalog.unnest(v_player_ids) as players(player_id);

    insert into public.game_event_visible_roles (
      room_id,
      game_event_id,
      role_id
    )
    select p_room_id, v_event_id, roles.role_id
    from pg_catalog.unnest(v_role_ids) as roles(role_id);
  end loop;
end;
$$;

create function private.insert_day_speech_slots(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct_slot_count integer;
  v_key_count integer;
  v_max_slot_index integer;
  v_slot jsonb;
  v_slot_count integer;
  v_slot_index integer;
  v_slot_indices integer[] := array[]::integer[];
  v_speaker_player_id bigint;
begin
  if p_phase_instance_id is null
    or p_slots is null
    or pg_catalog.jsonb_typeof(p_slots) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
  end if;

  v_slot_count := pg_catalog.jsonb_array_length(p_slots);

  if v_slot_count = 0 then
    return;
  end if;

  if not exists (
    select 1
    from public.game_states as states
    where states.room_id = p_room_id
      and states.phase_instance_id = p_phase_instance_id
      and states.phase = 'day'
      and states.status = 'playing'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
  end if;

  for v_slot in
    select items.value
    from pg_catalog.jsonb_array_elements(p_slots) as items(value)
  loop
    if pg_catalog.jsonb_typeof(v_slot) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_slot);

    if v_key_count <> 2
      or not (
        v_slot ? 'slot_index'
        and v_slot ? 'speaker_player_id'
      )
      or not private.jsonb_integer_between(v_slot -> 'slot_index', 0, 2147483647)
      or not private.jsonb_integer_between(
        v_slot -> 'speaker_player_id',
        1,
        9223372036854775807
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
    end if;

    v_slot_index := (v_slot ->> 'slot_index')::integer;
    v_speaker_player_id := (v_slot ->> 'speaker_player_id')::bigint;

    if v_slot_index = any(v_slot_indices)
      or not exists (
        select 1
        from public.game_player_states as player_states
        where player_states.room_id = p_room_id
          and player_states.player_id = v_speaker_player_id
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
    end if;

    v_slot_indices := pg_catalog.array_append(v_slot_indices, v_slot_index);

    insert into public.day_speech_slots (
      room_id,
      phase_instance_id,
      slot_index,
      speaker_player_id
    )
    values (
      p_room_id,
      p_phase_instance_id,
      v_slot_index,
      v_speaker_player_id
    );
  end loop;

  select count(distinct slot_index), max(slot_index)
  into v_distinct_slot_count, v_max_slot_index
  from pg_catalog.unnest(v_slot_indices) as slots(slot_index);

  if v_distinct_slot_count <> v_slot_count
    or v_max_slot_index <> v_slot_count - 1
    or not (0 = any(v_slot_indices))
  then
    raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
  end if;
end;
$$;

create function public.app_start_room(
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
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_role_ids text[];
  v_assignment jsonb;
  v_assignment_player_ids bigint[] := array[]::bigint[];
  v_assignment_role_id text;
  v_assignment_player_id bigint;
  v_contribution jsonb;
  v_distinct_expected_player_count integer;
  v_expected_player_ids bigint[];
  v_group jsonb;
  v_group_ids text[] := array[]::text[];
  v_group_role_count integer;
  v_group_role_ids text[];
  v_group_role_ids_seen text[] := array[]::text[];
  v_host_player public.players%rowtype;
  v_judgement jsonb;
  v_judgement_keys text[] := array[]::text[];
  v_joined_player_ids bigint[];
  v_key_count integer;
  v_now timestamptz;
  v_positive_role_ids text[];
  v_role_count_total numeric;
  v_room public.rooms%rowtype;
begin
  if p_account_id is null
    or p_phase_instance_id is null
    or p_phase_ends_at is null
    or p_phase_ends_at <= pg_catalog.clock_timestamp()
    or p_expected_player_ids is null
    or p_role_counts is null
    or pg_catalog.jsonb_typeof(p_role_counts) <> 'object'
    or p_options is null
    or pg_catalog.jsonb_typeof(p_options) <> 'object'
    or p_resolved_role_setup is null
    or pg_catalog.jsonb_typeof(p_resolved_role_setup) <> 'object'
    or p_assignments is null
    or pg_catalog.jsonb_typeof(p_assignments) <> 'array'
    or p_actions is null
    or pg_catalog.jsonb_typeof(p_actions) <> 'array'
    or p_events is null
    or pg_catalog.jsonb_typeof(p_events) <> 'array'
    or p_role_registry_version is null
    or p_role_registry_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    or p_engine_version is null
    or p_engine_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  then
    raise exception using errcode = 'P0001', message = 'invalid_game_start';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count)
    where roles.role_id !~ '^[a-z][a-z0-9_]{0,63}$'
      or not private.jsonb_integer_between(roles.role_count, 0, 10)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role_counts';
  end if;

  select coalesce(sum((roles.role_count #>> '{}')::numeric), 0)
  into v_role_count_total
  from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count);

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_options);

  if v_key_count <> 11
    or not (
      p_options ? 'dayMode'
      and p_options ? 'dayReadyCheckSecondsPerPlayer'
      and p_options ? 'daySpeechSeconds'
      and p_options ? 'executionLastWordsSeconds'
      and p_options ? 'firstDaySpeechRounds'
      and p_options ? 'firstNightSeconds'
      and p_options ? 'nightSeconds'
      and p_options ? 'normalDaySpeechRounds'
      and p_options ? 'roleOptions'
      and p_options ? 'voteResultVisibility'
      and p_options ? 'votingSeconds'
    )
    or pg_catalog.jsonb_typeof(p_options -> 'dayMode') <> 'string'
    or p_options ->> 'dayMode' not in ('ready_check', 'ordered_speech')
    or pg_catalog.jsonb_typeof(p_options -> 'voteResultVisibility') <> 'string'
    or p_options ->> 'voteResultVisibility' not in ('count_only', 'voter_to_target')
    or pg_catalog.jsonb_typeof(p_options -> 'roleOptions') <> 'object'
    or not private.jsonb_integer_between(
      p_options -> 'dayReadyCheckSecondsPerPlayer',
      1,
      300
    )
    or not private.jsonb_integer_between(p_options -> 'daySpeechSeconds', 1, 300)
    or not private.jsonb_integer_between(
      p_options -> 'executionLastWordsSeconds',
      1,
      300
    )
    or not private.jsonb_integer_between(p_options -> 'firstDaySpeechRounds', 1, 5)
    or not private.jsonb_integer_between(p_options -> 'firstNightSeconds', 1, 300)
    or not private.jsonb_integer_between(p_options -> 'nightSeconds', 1, 600)
    or not private.jsonb_integer_between(p_options -> 'normalDaySpeechRounds', 1, 5)
    or not private.jsonb_integer_between(p_options -> 'votingSeconds', 1, 300)
  then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_options -> 'roleOptions') as roles(role_id, role_options)
    where roles.role_id !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(roles.role_options) <> 'object'
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_options -> 'roleOptions') as roles(role_id, role_options)
    cross join lateral pg_catalog.jsonb_each(roles.role_options) as options(option_key, option_value)
    where options.option_key !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(options.option_value) <> 'string'
      or pg_catalog.char_length(options.option_value #>> '{}') not between 1 and 64
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_options';
  end if;

  select count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_resolved_role_setup);

  if v_key_count <> 3
    or not (
      p_resolved_role_setup ? 'activeRoleIds'
      and p_resolved_role_setup ? 'contributions'
      and p_resolved_role_setup ? 'nightConversationGroups'
    )
    or pg_catalog.jsonb_typeof(
      p_resolved_role_setup -> 'activeRoleIds'
    ) <> 'array'
    or pg_catalog.jsonb_typeof(
      p_resolved_role_setup -> 'contributions'
    ) <> 'array'
    or pg_catalog.jsonb_typeof(
      p_resolved_role_setup -> 'nightConversationGroups'
    ) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      p_resolved_role_setup -> 'activeRoleIds'
    ) as roles(value)
    where pg_catalog.jsonb_typeof(roles.value) <> 'string'
      or roles.value #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  select coalesce(
    pg_catalog.array_agg(roles.value order by roles.value),
    array[]::text[]
  )
  into v_active_role_ids
  from pg_catalog.jsonb_array_elements_text(
    p_resolved_role_setup -> 'activeRoleIds'
  ) as roles(value);

  if pg_catalog.cardinality(v_active_role_ids) <> (
    select count(distinct role_id)
    from pg_catalog.unnest(v_active_role_ids) as roles(role_id)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  select coalesce(
    pg_catalog.array_agg(roles.role_id order by roles.role_id),
    array[]::text[]
  )
  into v_positive_role_ids
  from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count)
  where (roles.role_count #>> '{}')::integer > 0;

  if v_active_role_ids <> v_positive_role_ids then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  for v_contribution in
    select contributions.value
    from pg_catalog.jsonb_array_elements(
      p_resolved_role_setup -> 'contributions'
    ) as contributions(value)
  loop
    if pg_catalog.jsonb_typeof(v_contribution) <> 'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(v_contribution)) <> 2
      or not (v_contribution ? 'kind' and v_contribution ? 'judgement')
      or pg_catalog.jsonb_typeof(v_contribution -> 'kind') <> 'string'
      or v_contribution ->> 'kind' <> 'winner_judgement'
      or pg_catalog.jsonb_typeof(v_contribution -> 'judgement') <> 'object'
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    v_judgement := v_contribution -> 'judgement';

    if (select count(*) from pg_catalog.jsonb_object_keys(v_judgement)) <> 4
      or not (
        v_judgement ? 'id'
        and v_judgement ? 'priority'
        and v_judgement ? 'sourceRoleId'
        and v_judgement ? 'winnerTeam'
      )
      or pg_catalog.jsonb_typeof(v_judgement -> 'id') <> 'string'
      or v_judgement ->> 'id' !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
      or not private.jsonb_integer_between(
        v_judgement -> 'priority',
        -2147483648,
        2147483647
      )
      or pg_catalog.jsonb_typeof(v_judgement -> 'sourceRoleId') <> 'string'
      or not (v_judgement ->> 'sourceRoleId' = any(v_active_role_ids))
      or pg_catalog.jsonb_typeof(v_judgement -> 'winnerTeam') <> 'string'
      or v_judgement ->> 'winnerTeam' !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.concat(
        v_judgement ->> 'sourceRoleId',
        '/',
        v_judgement ->> 'id'
      ) = any(v_judgement_keys)
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    v_judgement_keys := pg_catalog.array_append(
      v_judgement_keys,
      pg_catalog.concat(
        v_judgement ->> 'sourceRoleId',
        '/',
        v_judgement ->> 'id'
      )
    );
  end loop;

  if pg_catalog.cardinality(v_judgement_keys) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  for v_group in
    select groups.value
    from pg_catalog.jsonb_array_elements(
      p_resolved_role_setup -> 'nightConversationGroups'
    ) as groups(value)
  loop
    if pg_catalog.jsonb_typeof(v_group) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_group);

    if v_key_count <> 3
      or not (
        v_group ? 'groupId'
        and v_group ? 'label'
        and v_group ? 'roleIds'
      )
      or pg_catalog.jsonb_typeof(v_group -> 'groupId') <> 'string'
      or v_group ->> 'groupId' !~ '^[a-z][a-z0-9_:-]{0,63}$'
      or pg_catalog.jsonb_typeof(v_group -> 'label') <> 'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(v_group -> 'label')) <> 2
      or pg_catalog.jsonb_typeof(v_group -> 'label' -> 'en') <> 'string'
      or pg_catalog.char_length(v_group -> 'label' ->> 'en') not between 1 and 128
      or pg_catalog.jsonb_typeof(v_group -> 'label' -> 'ja') <> 'string'
      or pg_catalog.char_length(v_group -> 'label' ->> 'ja') not between 1 and 128
      or pg_catalog.jsonb_typeof(v_group -> 'roleIds') <> 'array'
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    if v_group ->> 'groupId' = any(v_group_ids)
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_group -> 'roleIds') as roles(value)
        where pg_catalog.jsonb_typeof(roles.value) <> 'string'
          or roles.value #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    select coalesce(
      pg_catalog.array_agg(roles.value),
      array[]::text[]
    )
    into v_group_role_ids
    from pg_catalog.jsonb_array_elements_text(
      v_group -> 'roleIds'
    ) as roles(value);

    select count(distinct role_id)
    into v_group_role_count
    from pg_catalog.unnest(v_group_role_ids) as roles(role_id);

    if pg_catalog.cardinality(v_group_role_ids) = 0
      or v_group_role_count <> pg_catalog.cardinality(v_group_role_ids)
      or exists (
        select 1
        from pg_catalog.unnest(v_group_role_ids) as roles(role_id)
        where not (roles.role_id = any(v_active_role_ids))
      )
      or exists (
        select 1
        from pg_catalog.unnest(v_group_role_ids) as roles(role_id)
        where roles.role_id = any(v_group_role_ids_seen)
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    v_group_role_ids_seen := pg_catalog.array_cat(
      v_group_role_ids_seen,
      v_group_role_ids
    );

    v_group_ids := pg_catalog.array_append(
      v_group_ids,
      v_group ->> 'groupId'
    );
  end loop;

  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.players as membership
  join public.rooms as rooms
    on rooms.id = membership.room_id
  where membership.account_id = p_account_id
    and membership.left_at is null
    and rooms.public_room_code = pg_catalog.btrim(p_room_code)
  for update of rooms;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_host_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found or v_room.host_account_id <> p_account_id then
    raise exception using errcode = 'P0001', message = 'host_required';
  end if;

  v_now := pg_catalog.clock_timestamp();

  if p_phase_ends_at <= v_now then
    raise exception using errcode = 'P0001', message = 'invalid_game_start';
  end if;

  if v_room.status = 'waiting' and v_room.waiting_expires_at <= v_now then
    perform private.end_waiting_room(
      v_room.id,
      'waiting_room_expired',
      v_host_player.id
    );

    return query
    select v_room.id, v_host_player.id, 'waiting_room_ended'::text;
    return;
  end if;

  if v_room.status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  if exists (
    select 1
    from public.game_states as states
    where states.room_id = v_room.id
  ) then
    raise exception using errcode = 'P0001', message = 'game_already_started';
  end if;

  select coalesce(
    pg_catalog.array_agg(players.id order by players.id),
    array[]::bigint[]
  )
  into v_joined_player_ids
  from public.players as players
  where players.room_id = v_room.id
    and players.status = 'joined';

  if pg_catalog.cardinality(v_joined_player_ids) <> v_room.target_player_count
    or pg_catalog.cardinality(p_expected_player_ids) <> v_room.target_player_count
    or v_role_count_total <> v_room.target_player_count
    or exists (
      select 1
      from pg_catalog.unnest(p_expected_player_ids) as expected(player_id)
      where expected.player_id is null or expected.player_id < 1
    )
  then
    raise exception using errcode = 'P0001', message = 'room_players_changed';
  end if;

  select
    coalesce(
      pg_catalog.array_agg(expected.player_id order by expected.player_id),
      array[]::bigint[]
    ),
    count(distinct expected.player_id)
  into v_expected_player_ids, v_distinct_expected_player_count
  from pg_catalog.unnest(p_expected_player_ids) as expected(player_id);

  if v_distinct_expected_player_count <> v_room.target_player_count
    or v_expected_player_ids <> v_joined_player_ids
    or pg_catalog.jsonb_array_length(p_assignments) <> v_room.target_player_count
  then
    raise exception using errcode = 'P0001', message = 'room_players_changed';
  end if;

  for v_assignment in
    select assignments.value
    from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value)
  loop
    if pg_catalog.jsonb_typeof(v_assignment) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_assignments';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_assignment);

    if v_key_count <> 2
      or not (
        v_assignment ? 'player_id'
        and v_assignment ? 'role_id'
      )
      or not private.jsonb_integer_between(
        v_assignment -> 'player_id',
        1,
        9223372036854775807
      )
      or pg_catalog.jsonb_typeof(v_assignment -> 'role_id') <> 'string'
      or v_assignment ->> 'role_id' !~ '^[a-z][a-z0-9_]{0,63}$'
    then
      raise exception using errcode = 'P0001', message = 'invalid_assignments';
    end if;

    v_assignment_player_id := (v_assignment ->> 'player_id')::bigint;
    v_assignment_role_id := v_assignment ->> 'role_id';

    if v_assignment_player_id = any(v_assignment_player_ids)
      or not (v_assignment_player_id = any(v_joined_player_ids))
      or not (p_role_counts ? v_assignment_role_id)
      or (p_role_counts ->> v_assignment_role_id)::integer < 1
    then
      raise exception using errcode = 'P0001', message = 'invalid_assignments';
    end if;

    v_assignment_player_ids := pg_catalog.array_append(
      v_assignment_player_ids,
      v_assignment_player_id
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count)
    where (roles.role_count #>> '{}')::integer <> (
      select count(*)
      from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value)
      where assignments.value ->> 'role_id' = roles.role_id
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_assignments';
  end if;

  select coalesce(
    pg_catalog.array_agg(player_id order by player_id),
    array[]::bigint[]
  )
  into v_assignment_player_ids
  from pg_catalog.unnest(v_assignment_player_ids) as assignments(player_id);

  if v_assignment_player_ids <> v_joined_player_ids then
    raise exception using errcode = 'P0001', message = 'invalid_assignments';
  end if;

  update public.rooms as rooms
  set started_at = v_now,
      snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id
    and rooms.status = 'waiting';

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  insert into public.game_rule_sets (
    room_id,
    role_counts,
    options,
    resolved_role_setup,
    role_registry_version,
    engine_version
  )
  values (
    v_room.id,
    p_role_counts,
    p_options,
    p_resolved_role_setup,
    p_role_registry_version,
    p_engine_version
  );

  insert into public.game_phase_instances (
    room_id,
    id,
    phase,
    day_number,
    night_number,
    started_at,
    ends_at
  )
  values (
    v_room.id,
    p_phase_instance_id,
    'night',
    0,
    1,
    v_now,
    p_phase_ends_at
  );

  insert into public.game_states (
    room_id,
    phase,
    phase_instance_id,
    phase_started_at,
    phase_ends_at,
    day_number,
    night_number,
    revision,
    action_revision,
    created_at,
    updated_at
  )
  values (
    v_room.id,
    'night',
    p_phase_instance_id,
    v_now,
    p_phase_ends_at,
    0,
    1,
    1,
    0,
    v_now,
    v_now
  );

  insert into public.role_assignments (room_id, player_id, role_id)
  select
    v_room.id,
    (assignments.value ->> 'player_id')::bigint,
    assignments.value ->> 'role_id'
  from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value);

  insert into public.game_player_states (room_id, player_id, alive)
  select v_room.id, players.id, true
  from pg_catalog.unnest(v_joined_player_ids) as players(id);

  delete from public.realtime_topics as topics
  where topics.room_id = v_room.id
    and topics.scope = 'player_private'
    and not (topics.player_id = any(v_joined_player_ids));

  update public.realtime_grants as grants
  set revoked_at = v_now
  where grants.room_id = v_room.id
    and not (grants.player_id = any(v_joined_player_ids))
    and grants.revoked_at is null;

  insert into public.realtime_topics (
    topic,
    room_id,
    scope,
    role_id,
    created_at
  )
  select
    private.random_identifier('role:', 24),
    v_room.id,
    'role_private',
    assigned_roles.role_id,
    v_now
  from (
    select distinct assignments.role_id
    from public.role_assignments as assignments
    where assignments.room_id = v_room.id
  ) as assigned_roles;

  perform private.insert_current_actions(
    v_room.id,
    p_phase_instance_id,
    p_phase_ends_at,
    p_actions
  );

  perform private.insert_game_events(
    v_room.id,
    p_phase_instance_id,
    v_now,
    p_events
  );

  insert into public.room_events (
    room_id,
    event_kind,
    actor_player_id,
    payload
  )
  values (
    v_room.id,
    'game_started',
    v_host_player.id,
    '{}'::jsonb
  );

  return query
  select v_room.id, v_host_player.id, 'game_started'::text;
end;
$$;

create function public.app_submit_action(
  p_account_id bigint,
  p_room_code text,
  p_action_key text,
  p_phase_instance_id uuid,
  p_expected_revision bigint,
  p_target_public_player_id text
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
  v_accepted_action_id bigint;
  v_action public.current_actions%rowtype;
  v_now timestamptz;
  v_notification_reason text;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_state_update_count integer;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_target_player_id bigint;
  v_topic_update_count integer;
begin
  if p_account_id is null
    or p_action_key is null
    or p_action_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    or p_phase_instance_id is null
    or p_expected_revision is null
    or p_expected_revision < 0
  then
    raise exception using errcode = 'P0001', message = 'invalid_action_submission';
  end if;

  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.players as membership
  join public.rooms as rooms
    on rooms.id = membership.room_id
  where membership.account_id = p_account_id
    and membership.left_at is null
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
    and players.status = 'joined'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select states.*
  into v_state
  from public.game_states as states
  where states.room_id = v_room.id
  for update;

  if not found
    or v_room.status <> 'playing'
    or v_state.status <> 'playing'
    or v_state.phase_instance_id is distinct from p_phase_instance_id
    or v_state.revision <> p_expected_revision
  then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  select assignments.role_id, player_states.alive
  into v_submitter_role_id, v_submitter_alive
  from public.role_assignments as assignments
  join public.game_player_states as player_states
    on player_states.room_id = assignments.room_id
   and player_states.player_id = assignments.player_id
  where assignments.room_id = v_room.id
    and assignments.player_id = v_player.id;

  if not found then
    raise exception using errcode = 'P0001', message = 'action_not_allowed';
  end if;

  if p_target_public_player_id is not null then
    select players.id
    into v_target_player_id
    from public.players as players
    where players.room_id = v_room.id
      and players.public_player_id = p_target_public_player_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'invalid_action_target';
    end if;
  end if;

  select actions.*
  into v_action
  from public.current_actions as actions
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id
    and actions.action_key = p_action_key
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'action_not_available';
  end if;

  v_now := pg_catalog.clock_timestamp();

  if v_action.closes_at is not null and v_action.closes_at <= v_now then
    raise exception using errcode = 'P0001', message = 'action_window_closed';
  end if;

  if (v_action.actor_player_id is not null
      and v_action.actor_player_id <> v_player.id)
    or (v_action.actor_role_id is not null
      and v_action.actor_role_id <> v_submitter_role_id)
  then
    raise exception using errcode = 'P0001', message = 'action_not_allowed';
  end if;

  if v_action.actor_state_requirement = 'alive' and not v_submitter_alive then
    raise exception using errcode = 'P0001', message = 'action_not_allowed';
  end if;

  if (v_action.target_kind = 'none' and v_target_player_id is not null)
    or (
      v_action.target_kind = 'single_player'
      and (
        v_target_player_id is null
        or not exists (
          select 1
          from public.current_action_eligible_players as eligible
          where eligible.room_id = v_room.id
            and eligible.current_action_id = v_action.id
            and eligible.player_id = v_target_player_id
        )
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_action_target';
  end if;

  if v_target_player_id is not null
    and v_action.target_state_requirement = 'alive'
    and not exists (
      select 1
      from public.game_player_states as player_states
      where player_states.room_id = v_room.id
        and player_states.player_id = v_target_player_id
        and player_states.alive
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_action_target';
  end if;

  insert into public.pending_actions (
    current_action_id,
    room_id,
    submitter_player_id,
    target_player_id,
    submitted_at
  )
  values (
    v_action.id,
    v_room.id,
    v_player.id,
    v_target_player_id,
    v_now
  )
  on conflict (current_action_id) do nothing
  returning pending_actions.current_action_id into v_accepted_action_id;

  if v_accepted_action_id is null then
    return query
    select v_room.id, v_player.id, null::text;
    return;
  end if;

  perform private.insert_game_events(
    v_room.id,
    p_phase_instance_id,
    v_now,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'event_kind', 'action_submitted',
        'payload', pg_catalog.jsonb_build_object(
          'actionKey', v_action.action_key,
          'kind', v_action.action_kind
        ),
        'visibility', 'private',
        'visible_to_player_ids', pg_catalog.jsonb_build_array(v_player.id),
        'visible_to_role_ids', '[]'::jsonb
      )
    )
  );

  update public.game_states as states
  set action_revision = states.action_revision + 1,
      updated_at = v_now
  where states.room_id = v_room.id
    and states.phase_instance_id = p_phase_instance_id
    and states.revision = p_expected_revision;

  get diagnostics v_state_update_count = row_count;

  if v_state_update_count <> 1 then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  if v_state.phase = 'night' and v_state.night_number > 1 then
    update public.realtime_topics as topics
    set snapshot_revision = topics.snapshot_revision + 1
    where topics.room_id = v_room.id
      and topics.scope = 'player_private'
      and topics.player_id = v_player.id;

    get diagnostics v_topic_update_count = row_count;

    if v_topic_update_count <> 1 then
      raise exception using errcode = 'P0001', message = 'realtime_topic_missing';
    end if;

    if v_action.actor_player_id is null
      and v_action.actor_role_id is not null
    then
      update public.realtime_topics as topics
      set snapshot_revision = topics.snapshot_revision + 1
      where topics.room_id = v_room.id
        and topics.scope = 'role_private'
        and topics.role_id = v_action.actor_role_id;

      get diagnostics v_topic_update_count = row_count;

      if v_topic_update_count <> 1 then
        raise exception using errcode = 'P0001', message = 'realtime_topic_missing';
      end if;
    end if;

    v_notification_reason := 'private_view_changed';
  else
    update public.rooms as rooms
    set snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = v_room.id;

    v_notification_reason := 'action_window_changed';
  end if;

  return query
  select v_room.id, v_player.id, v_notification_reason;
end;
$$;

create function public.app_send_night_conversation_message(
  p_account_id bigint,
  p_room_code text,
  p_phase_instance_id uuid,
  p_night_number integer,
  p_conversation_group_id text,
  p_body text
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
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_expected_topic_count integer;
  v_group jsonb;
  v_now timestamptz;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_topic_update_count integer;
begin
  if p_account_id is null
    or p_phase_instance_id is null
    or p_night_number is null
    or p_night_number < 1
    or p_conversation_group_id is null
    or p_conversation_group_id !~ '^[a-z][a-z0-9_:-]{0,63}$'
    or pg_catalog.char_length(v_body) not between 1 and 100
  then
    raise exception using errcode = 'P0001', message = 'invalid_night_message';
  end if;

  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.players as membership
  join public.rooms as rooms
    on rooms.id = membership.room_id
  where membership.account_id = p_account_id
    and membership.left_at is null
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
    and players.status = 'joined'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select states.*
  into v_state
  from public.game_states as states
  where states.room_id = v_room.id
  for update;

  if not found
    or v_room.status <> 'playing'
    or v_state.status <> 'playing'
    or v_state.phase <> 'night'
    or v_state.phase_instance_id is distinct from p_phase_instance_id
    or v_state.night_number <> p_night_number
  then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  select assignments.role_id, player_states.alive
  into v_submitter_role_id, v_submitter_alive
  from public.role_assignments as assignments
  join public.game_player_states as player_states
    on player_states.room_id = assignments.room_id
   and player_states.player_id = assignments.player_id
  where assignments.room_id = v_room.id
    and assignments.player_id = v_player.id;

  if not found or not v_submitter_alive then
    raise exception using errcode = 'P0001', message = 'night_message_not_allowed';
  end if;

  select groups.value
  into v_group
  from public.game_rule_sets as rule_sets
  cross join lateral pg_catalog.jsonb_array_elements(
    rule_sets.resolved_role_setup -> 'nightConversationGroups'
  ) as groups(value)
  where rule_sets.room_id = v_room.id
    and groups.value ->> 'groupId' = p_conversation_group_id
  limit 1;

  if not found
    or pg_catalog.jsonb_typeof(v_group) <> 'object'
    or pg_catalog.jsonb_typeof(v_group -> 'roleIds') <> 'array'
    or not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(v_group -> 'roleIds') as roles(role_id)
      where roles.role_id = v_submitter_role_id
    )
  then
    raise exception using errcode = 'P0001', message = 'night_message_not_allowed';
  end if;

  v_now := pg_catalog.clock_timestamp();

  insert into public.night_conversation_messages (
    room_id,
    night_number,
    conversation_group_id,
    sender_player_id,
    body,
    created_at
  )
  values (
    v_room.id,
    p_night_number,
    p_conversation_group_id,
    v_player.id,
    v_body,
    v_now
  );

  select count(*)
  into v_expected_topic_count
  from pg_catalog.jsonb_array_elements_text(
    v_group -> 'roleIds'
  ) as roles(role_id);

  update public.realtime_topics as topics
  set snapshot_revision = topics.snapshot_revision + 1
  where topics.room_id = v_room.id
    and topics.scope = 'role_private'
    and topics.role_id in (
      select roles.role_id
      from pg_catalog.jsonb_array_elements_text(
        v_group -> 'roleIds'
      ) as roles(role_id)
    );

  get diagnostics v_topic_update_count = row_count;

  if v_topic_update_count <> v_expected_topic_count then
    raise exception using errcode = 'P0001', message = 'realtime_topic_missing';
  end if;

  return query
  select v_room.id, v_player.id, 'private_view_changed'::text;
end;
$$;

create function public.app_resolve_phase(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_expected_revision bigint,
  p_expected_action_revision bigint,
  p_deaths jsonb,
  p_final_outcome jsonb,
  p_player_results jsonb,
  p_next_phase text,
  p_next_phase_instance_id uuid,
  p_next_phase_ends_at timestamptz,
  p_next_day_number integer,
  p_next_night_number integer,
  p_actions jsonb,
  p_day_speech_slots jsonb,
  p_events jsonb
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
  v_action_count integer;
  v_all_actions_submitted boolean;
  v_death jsonb;
  v_death_player_id bigint;
  v_death_player_ids bigint[] := array[]::bigint[];
  v_deleted_action_count integer;
  v_final_winner_team text;
  v_key_count integer;
  v_now timestamptz;
  v_pending_action_count integer;
  v_phase_timed_out boolean;
  v_player_ids bigint[];
  v_result jsonb;
  v_result_player_id bigint;
  v_result_player_ids bigint[] := array[]::bigint[];
  v_result_player_ids_sorted bigint[];
  v_result_value text;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_updated_count integer;
begin
  if p_room_id is null
    or p_room_id < 1
    or p_phase_instance_id is null
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_expected_action_revision is null
    or p_expected_action_revision < 0
    or p_deaths is null
    or pg_catalog.jsonb_typeof(p_deaths) <> 'array'
    or p_player_results is null
    or pg_catalog.jsonb_typeof(p_player_results) <> 'array'
    or p_actions is null
    or pg_catalog.jsonb_typeof(p_actions) <> 'array'
    or p_day_speech_slots is null
    or pg_catalog.jsonb_typeof(p_day_speech_slots) <> 'array'
    or p_events is null
    or pg_catalog.jsonb_typeof(p_events) <> 'array'
    or (
      p_final_outcome is not null
      and pg_catalog.jsonb_typeof(p_final_outcome) <> 'object'
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_phase_resolution';
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if v_room.status <> 'playing' then
    return query
    select v_room.id, null::bigint, null::text;
    return;
  end if;

  select states.*
  into v_state
  from public.game_states as states
  where states.room_id = v_room.id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'game_state_not_found';
  end if;

  if v_state.status <> 'playing'
    or v_state.phase_instance_id is distinct from p_phase_instance_id
    or v_state.revision <> p_expected_revision
    or v_state.action_revision <> p_expected_action_revision
  then
    return query
    select v_room.id, null::bigint, null::text;
    return;
  end if;

  perform 1
  from public.current_actions as actions
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id
  order by actions.id
  for update;

  perform 1
  from public.pending_actions as pending
  join public.current_actions as actions
    on actions.room_id = pending.room_id
   and actions.id = pending.current_action_id
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id
  order by pending.current_action_id
  for update of pending;

  v_now := pg_catalog.clock_timestamp();

  select count(*)
  into v_action_count
  from public.current_actions as actions
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id;

  select count(*)
  into v_pending_action_count
  from public.pending_actions as pending
  join public.current_actions as actions
    on actions.room_id = pending.room_id
   and actions.id = pending.current_action_id
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id;

  v_all_actions_submitted := v_action_count > 0
    and v_pending_action_count = v_action_count;
  v_phase_timed_out := v_state.phase_ends_at is not null
    and v_state.phase_ends_at <= v_now;

  if not (
    v_phase_timed_out
    or (
      (v_state.phase <> 'night' or v_state.night_number = 1)
      and v_all_actions_submitted
    )
  ) then
    return query
    select v_room.id, null::bigint, null::text;
    return;
  end if;

  for v_death in
    select deaths.value
    from pg_catalog.jsonb_array_elements(p_deaths) as deaths(value)
  loop
    if pg_catalog.jsonb_typeof(v_death) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_deaths';
    end if;

    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_death);

    if v_key_count <> 2
      or not (v_death ? 'player_id' and v_death ? 'reason')
      or not private.jsonb_integer_between(
        v_death -> 'player_id',
        1,
        9223372036854775807
      )
      or pg_catalog.jsonb_typeof(v_death -> 'reason') <> 'string'
      or v_death ->> 'reason' !~ '^[a-z][a-z0-9_]{0,63}$'
    then
      raise exception using errcode = 'P0001', message = 'invalid_deaths';
    end if;

    v_death_player_id := (v_death ->> 'player_id')::bigint;

    if v_death_player_id = any(v_death_player_ids) then
      raise exception using errcode = 'P0001', message = 'invalid_deaths';
    end if;

    v_death_player_ids := pg_catalog.array_append(
      v_death_player_ids,
      v_death_player_id
    );

    update public.game_player_states as player_states
    set alive = false
    where player_states.room_id = v_room.id
      and player_states.player_id = v_death_player_id
      and player_states.alive;

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'invalid_deaths';
    end if;
  end loop;

  insert into public.resolved_actions (
    room_id,
    phase_instance_id,
    phase,
    action_key,
    action_kind,
    resolver_role_id,
    actor_player_id,
    actor_role_id,
    resolution_status,
    target_player_id,
    resolved_at
  )
  select
    actions.room_id,
    actions.phase_instance_id,
    v_state.phase,
    actions.action_key,
    actions.action_kind,
    actions.resolver_role_id,
    coalesce(pending.submitter_player_id, actions.actor_player_id),
    actions.actor_role_id,
    case
      when pending.current_action_id is null then 'missing'
      else 'submitted'
    end,
    pending.target_player_id,
    v_now
  from public.current_actions as actions
  left join public.pending_actions as pending
    on pending.room_id = actions.room_id
   and pending.current_action_id = actions.id
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id
  order by actions.id;

  perform private.insert_game_events(
    v_room.id,
    p_phase_instance_id,
    v_now,
    p_events
  );

  if p_final_outcome is not null then
    select count(*)
    into v_key_count
    from pg_catalog.jsonb_object_keys(p_final_outcome);

    v_final_winner_team := p_final_outcome ->> 'winner_team';

    if v_key_count <> 1
      or not (p_final_outcome ? 'winner_team')
      or pg_catalog.jsonb_typeof(p_final_outcome -> 'winner_team') <> 'string'
      or v_final_winner_team !~ '^[a-z][a-z0-9_]{0,63}$'
      or not exists (
        select 1
        from public.game_rule_sets as rule_sets
        cross join lateral pg_catalog.jsonb_array_elements(
          rule_sets.resolved_role_setup -> 'contributions'
        ) as contributions(value)
        where rule_sets.room_id = v_room.id
          and contributions.value ->> 'kind' = 'winner_judgement'
          and contributions.value -> 'judgement' ->> 'winnerTeam'
            = v_final_winner_team
      )
      or p_next_phase is not null
      or p_next_phase_instance_id is not null
      or p_next_phase_ends_at is not null
      or p_next_day_number is distinct from v_state.day_number
      or p_next_night_number is distinct from v_state.night_number
      or pg_catalog.jsonb_array_length(p_actions) <> 0
      or pg_catalog.jsonb_array_length(p_day_speech_slots) <> 0
    then
      raise exception using errcode = 'P0001', message = 'invalid_final_outcome';
    end if;

    for v_result in
      select results.value
      from pg_catalog.jsonb_array_elements(p_player_results) as results(value)
    loop
      if pg_catalog.jsonb_typeof(v_result) <> 'object' then
        raise exception using errcode = 'P0001', message = 'invalid_player_results';
      end if;

      select count(*)
      into v_key_count
      from pg_catalog.jsonb_object_keys(v_result);

      if v_key_count <> 2
        or not (v_result ? 'player_id' and v_result ? 'result')
        or not private.jsonb_integer_between(
          v_result -> 'player_id',
          1,
          9223372036854775807
        )
        or pg_catalog.jsonb_typeof(v_result -> 'result') <> 'string'
        or v_result ->> 'result' not in ('win', 'lose', 'draw', 'special')
      then
        raise exception using errcode = 'P0001', message = 'invalid_player_results';
      end if;

      v_result_player_id := (v_result ->> 'player_id')::bigint;
      v_result_value := v_result ->> 'result';

      if v_result_player_id = any(v_result_player_ids) then
        raise exception using errcode = 'P0001', message = 'invalid_player_results';
      end if;

      v_result_player_ids := pg_catalog.array_append(
        v_result_player_ids,
        v_result_player_id
      );
    end loop;

    select coalesce(
      pg_catalog.array_agg(player_states.player_id order by player_states.player_id),
      array[]::bigint[]
    )
    into v_player_ids
    from public.game_player_states as player_states
    where player_states.room_id = v_room.id;

    select coalesce(
      pg_catalog.array_agg(results.player_id order by results.player_id),
      array[]::bigint[]
    )
    into v_result_player_ids_sorted
    from pg_catalog.unnest(v_result_player_ids) as results(player_id);

    if v_result_player_ids_sorted <> v_player_ids then
      raise exception using errcode = 'P0001', message = 'invalid_player_results';
    end if;
  else
    if pg_catalog.jsonb_array_length(p_player_results) <> 0
      or p_next_phase is null
      or p_next_phase not in ('night', 'day', 'voting', 'execution')
      or p_next_phase_instance_id is null
      or p_next_phase_instance_id = p_phase_instance_id
      or p_next_phase_ends_at is null
      or p_next_phase_ends_at <= v_now
      or p_next_day_number is null
      or p_next_day_number < 0
      or p_next_night_number is null
      or p_next_night_number < 1
      or (
        p_next_phase = v_state.phase
        and pg_catalog.jsonb_array_length(p_actions) = 0
      )
      or not (
        (
          p_next_phase = v_state.phase
          and p_next_day_number = v_state.day_number
          and p_next_night_number = v_state.night_number
        )
        or (
          v_state.phase = 'night'
          and p_next_phase = 'day'
          and p_next_day_number = v_state.day_number + 1
          and p_next_night_number = v_state.night_number
        )
        or (
          v_state.phase = 'day'
          and p_next_phase = 'voting'
          and p_next_day_number = v_state.day_number
          and p_next_night_number = v_state.night_number
        )
        or (
          v_state.phase = 'voting'
          and p_next_phase = 'execution'
          and p_next_day_number = v_state.day_number
          and p_next_night_number = v_state.night_number
        )
        or (
          v_state.phase in ('voting', 'execution')
          and p_next_phase = 'night'
          and p_next_day_number = v_state.day_number
          and p_next_night_number = v_state.night_number + 1
        )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_next_phase';
    end if;
  end if;

  delete from public.day_speech_slots as slots
  where slots.room_id = v_room.id
    and slots.phase_instance_id = p_phase_instance_id;

  delete from public.current_actions as actions
  where actions.room_id = v_room.id
    and actions.phase_instance_id = p_phase_instance_id;

  get diagnostics v_deleted_action_count = row_count;

  if v_deleted_action_count <> v_action_count then
    raise exception using errcode = 'P0001', message = 'action_window_changed';
  end if;

  if p_final_outcome is not null then
    update public.game_phase_instances as phase_instances
    set ended_at = v_now
    where phase_instances.room_id = v_room.id
      and phase_instances.id = p_phase_instance_id
      and phase_instances.ended_at is null;

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'phase_changed';
    end if;

    insert into public.final_outcomes (
      room_id,
      winner_team,
      created_at
    )
    values (
      v_room.id,
      v_final_winner_team,
      v_now
    );

    for v_result in
      select results.value
      from pg_catalog.jsonb_array_elements(p_player_results) as results(value)
    loop
      v_result_player_id := (v_result ->> 'player_id')::bigint;
      v_result_value := v_result ->> 'result';

      insert into public.player_results (
        room_id,
        player_id,
        result,
        created_at
      )
      values (
        v_room.id,
        v_result_player_id,
        v_result_value,
        v_now
      );
    end loop;

    update public.game_states as states
    set phase = null,
        phase_instance_id = null,
        phase_started_at = null,
        phase_ends_at = null,
        revision = states.revision + 1,
        action_revision = 0,
        updated_at = v_now,
        ended_at = v_now
    where states.room_id = v_room.id
      and states.phase_instance_id = p_phase_instance_id
      and states.revision = p_expected_revision
      and states.action_revision = p_expected_action_revision
      and states.status = 'playing';

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'phase_changed';
    end if;

    update public.rooms as rooms
    set ended_at = v_now,
        snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = v_room.id
      and rooms.status = 'playing';

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'room_state_changed';
    end if;

    insert into public.room_events (
      room_id,
      event_kind,
      actor_player_id,
      payload,
      created_at
    )
    values (
      v_room.id,
      'room_ended',
      null,
      '{"reason":"game_finished"}'::jsonb,
      v_now
    );

    return query
    select v_room.id, null::bigint, 'game_ended'::text;
    return;
  end if;

  update public.game_phase_instances as phase_instances
  set ended_at = v_now
  where phase_instances.room_id = v_room.id
    and phase_instances.id = p_phase_instance_id
    and phase_instances.ended_at is null;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'phase_changed';
  end if;

  insert into public.game_phase_instances (
    room_id,
    id,
    phase,
    day_number,
    night_number,
    started_at,
    ends_at
  )
  values (
    v_room.id,
    p_next_phase_instance_id,
    p_next_phase,
    p_next_day_number,
    p_next_night_number,
    v_now,
    p_next_phase_ends_at
  );

  update public.game_states as states
  set phase = p_next_phase,
      phase_instance_id = p_next_phase_instance_id,
      phase_started_at = v_now,
      phase_ends_at = p_next_phase_ends_at,
      day_number = p_next_day_number,
      night_number = p_next_night_number,
      revision = states.revision + 1,
      action_revision = 0,
      updated_at = v_now
  where states.room_id = v_room.id
    and states.phase_instance_id = p_phase_instance_id
    and states.revision = p_expected_revision
    and states.action_revision = p_expected_action_revision
    and states.status = 'playing';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'phase_changed';
  end if;

  perform private.insert_current_actions(
    v_room.id,
    p_next_phase_instance_id,
    p_next_phase_ends_at,
    p_actions
  );

  perform private.insert_day_speech_slots(
    v_room.id,
    p_next_phase_instance_id,
    p_day_speech_slots
  );

  update public.rooms as rooms
  set snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id
    and rooms.status = 'playing';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'room_state_changed';
  end if;

  return query
  select
    v_room.id,
    null::bigint,
    case
      when p_next_phase is distinct from v_state.phase then 'phase_changed'::text
      else 'action_window_changed'::text
    end;
end;
$$;

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
revoke all on function public.app_submit_action(
  bigint,
  text,
  text,
  uuid,
  bigint,
  text
) from public, anon, authenticated;
revoke all on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.app_resolve_phase(
  bigint,
  uuid,
  bigint,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  timestamptz,
  integer,
  integer,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

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
grant execute on function public.app_submit_action(
  bigint,
  text,
  text,
  uuid,
  bigint,
  text
) to service_role;
grant execute on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  integer,
  text,
  text
) to service_role;
grant execute on function public.app_resolve_phase(
  bigint,
  uuid,
  bigint,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  timestamptz,
  integer,
  integer,
  jsonb,
  jsonb,
  jsonb
) to service_role;

revoke all on all functions in schema private
  from public, anon, authenticated, service_role;
