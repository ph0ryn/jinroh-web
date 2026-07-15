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
  p_game_id uuid,
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
  v_actor_player_id bigint;
  v_actor_role_id text;
  v_actor_state_requirement text;
  v_distinct_target_count integer;
  v_eligible_player_ids bigint[];
  v_expected_created_at timestamptz;
  v_expected_closes_at timestamptz;
  v_resolver_role_id text;
  v_target_count integer;
  v_target_kind text;
  v_target_state_requirement text;
  v_valid_target_count integer;
begin
  if p_game_id is null
    or p_phase_instance_id is null
    or p_actions is null
    or pg_catalog.jsonb_typeof(p_actions) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'invalid_actions';
  end if;

  select games.phase_started_at, games.phase_ends_at
  into v_expected_created_at, v_expected_closes_at
  from public.games as games
  where games.id = p_game_id
    and games.phase_instance_id = p_phase_instance_id
    and games.ended_at is null;

  if not found or p_closes_at is distinct from v_expected_closes_at then
    raise exception using errcode = 'P0001', message = 'invalid_actions';
  end if;

  for v_action in
    select items.value
    from pg_catalog.jsonb_array_elements(p_actions) as items(value)
  loop
    if pg_catalog.jsonb_typeof(v_action) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_action)
      ) <> 9
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
      or v_action_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
      or pg_catalog.jsonb_typeof(v_action -> 'action_kind') <> 'string'
      or v_action_kind !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(v_action -> 'resolver_role_id') not in ('string', 'null')
      or (
        v_resolver_role_id is not null
        and v_resolver_role_id !~ '^[a-z][a-z0-9_]{0,63}$'
      )
      or pg_catalog.jsonb_typeof(v_action -> 'actor_player_id') not in ('number', 'null')
      or pg_catalog.jsonb_typeof(v_action -> 'actor_role_id') not in ('string', 'null')
      or (
        v_actor_role_id is not null
        and v_actor_role_id !~ '^[a-z][a-z0-9_]{0,63}$'
      )
      or pg_catalog.jsonb_typeof(v_action -> 'actor_state_requirement') <> 'string'
      or v_actor_state_requirement not in ('alive', 'assigned')
      or pg_catalog.jsonb_typeof(v_action -> 'eligible_target_player_ids') <> 'array'
      or pg_catalog.jsonb_typeof(v_action -> 'target_kind') <> 'string'
      or v_target_kind not in ('none', 'single_player')
      or pg_catalog.jsonb_typeof(v_action -> 'target_state_requirement') <> 'string'
      or v_target_state_requirement not in ('alive', 'assigned')
      or v_action_key = any(v_action_keys)
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    v_action_keys := pg_catalog.array_append(v_action_keys, v_action_key);

    if pg_catalog.jsonb_typeof(v_action -> 'actor_player_id') = 'null' then
      v_actor_player_id := null;
    elsif private.jsonb_integer_between(
      v_action -> 'actor_player_id',
      1,
      9223372036854775807
    ) then
      v_actor_player_id := (v_action ->> 'actor_player_id')::bigint;
    else
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_player_id is null and v_actor_role_id is null then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_resolver_role_id is not null
      and not exists (
        select 1
        from public.game_players as game_players
        join public.game_rule_sets as rule_sets
          on rule_sets.game_id = game_players.game_id
        where game_players.game_id = p_game_id
          and game_players.role_id = v_resolver_role_id
          and rule_sets.resolved_role_setup -> 'activeRoleIds' ? v_resolver_role_id
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_player_id is not null
      and not exists (
        select 1
        from public.game_players as game_players
        where game_players.game_id = p_game_id
          and game_players.player_id = v_actor_player_id
          and (
            v_actor_role_id is null
            or game_players.role_id = v_actor_role_id
          )
          and (
            v_actor_state_requirement = 'assigned'
            or game_players.alive
          )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    if v_actor_player_id is null
      and v_actor_role_id is not null
      and not exists (
        select 1
        from public.game_players as game_players
        where game_players.game_id = p_game_id
          and game_players.role_id = v_actor_role_id
          and (
            v_actor_state_requirement = 'assigned'
            or game_players.alive
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

    select pg_catalog.count(distinct target_id)
    into v_distinct_target_count
    from pg_catalog.unnest(v_eligible_player_ids) as target_ids(target_id);

    select pg_catalog.count(*)
    into v_valid_target_count
    from public.game_players as game_players
    where game_players.game_id = p_game_id
      and game_players.player_id = any(v_eligible_player_ids)
      and (
        v_target_state_requirement = 'assigned'
        or game_players.alive
      );

    if v_distinct_target_count <> v_target_count
      or v_valid_target_count <> v_target_count
      or (v_target_kind = 'none' and v_target_count <> 0)
      or (v_target_kind = 'single_player' and v_target_count = 0)
    then
      raise exception using errcode = 'P0001', message = 'invalid_actions';
    end if;

    insert into public.current_actions (
      game_id,
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
      p_game_id,
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
      game_id,
      current_action_id,
      player_id
    )
    select p_game_id, v_action_id, targets.player_id
    from pg_catalog.unnest(v_eligible_player_ids) as targets(player_id);
  end loop;
end;
$$;

create function private.insert_game_events(
  p_game_id uuid,
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
  v_event jsonb;
  v_event_id bigint;
  v_event_kind text;
  v_key_count integer;
  v_payload jsonb;
  v_player_ids bigint[];
  v_role_ids text[];
  v_visibility text;
begin
  if p_game_id is null
    or p_phase_instance_id is null
    or p_created_at is null
    or p_created_at > pg_catalog.clock_timestamp()
    or p_events is null
    or pg_catalog.jsonb_typeof(p_events) <> 'array'
    or not exists (
      select 1
      from public.games as games
      where games.id = p_game_id
        and games.phase_instance_id = p_phase_instance_id
        and games.ended_at is null
        and p_created_at >= games.phase_started_at
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

    select pg_catalog.count(*)
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
      or pg_catalog.jsonb_typeof(v_event -> 'event_kind') <> 'string'
      or v_event ->> 'event_kind' !~ '^[a-z][a-z0-9_]{0,63}$'
      or pg_catalog.jsonb_typeof(v_event -> 'payload') <> 'object'
      or pg_catalog.jsonb_typeof(v_event -> 'visibility') <> 'string'
      or v_event ->> 'visibility' not in ('public', 'private', 'internal')
      or pg_catalog.jsonb_typeof(v_event -> 'visible_to_player_ids') <> 'array'
      or pg_catalog.jsonb_typeof(v_event -> 'visible_to_role_ids') <> 'array'
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_event -> 'visible_to_player_ids') as ids(value)
        where not private.jsonb_integer_between(ids.value, 1, 9223372036854775807)
      )
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_event -> 'visible_to_role_ids') as ids(value)
        where pg_catalog.jsonb_typeof(ids.value) <> 'string'
          or ids.value #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    v_event_kind := v_event ->> 'event_kind';
    v_payload := v_event -> 'payload';
    v_visibility := v_event ->> 'visibility';

    select coalesce(
      pg_catalog.array_agg(ids.value::bigint),
      array[]::bigint[]
    )
    into v_player_ids
    from pg_catalog.jsonb_array_elements_text(
      v_event -> 'visible_to_player_ids'
    ) as ids(value);

    select coalesce(
      pg_catalog.array_agg(ids.value),
      array[]::text[]
    )
    into v_role_ids
    from pg_catalog.jsonb_array_elements_text(
      v_event -> 'visible_to_role_ids'
    ) as ids(value);

    if pg_catalog.cardinality(v_player_ids) <> (
      select pg_catalog.count(distinct id)
      from pg_catalog.unnest(v_player_ids) as player_ids(id)
    )
      or pg_catalog.cardinality(v_role_ids) <> (
        select pg_catalog.count(distinct id)
        from pg_catalog.unnest(v_role_ids) as role_ids(id)
      )
      or exists (
        select 1
        from pg_catalog.unnest(v_player_ids) as player_ids(id)
        where not exists (
          select 1
          from public.game_players as game_players
          where game_players.game_id = p_game_id
            and game_players.player_id = player_ids.id
        )
      )
      or exists (
        select 1
        from pg_catalog.unnest(v_role_ids) as role_ids(id)
        where not exists (
          select 1
          from public.game_players as game_players
          where game_players.game_id = p_game_id
            and game_players.role_id = role_ids.id
        )
      )
      or (
        v_visibility = 'public'
        and (
          pg_catalog.cardinality(v_player_ids) <> 0
          or pg_catalog.cardinality(v_role_ids) <> 0
        )
      )
      or (
        v_visibility = 'private'
        and pg_catalog.cardinality(v_player_ids) = 0
        and pg_catalog.cardinality(v_role_ids) = 0
      )
      or (
        v_visibility = 'internal'
        and (
          pg_catalog.cardinality(v_player_ids) <> 0
          or pg_catalog.cardinality(v_role_ids) <> 0
        )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_events';
    end if;

    insert into public.game_events (
      game_id,
      phase_instance_id,
      event_kind,
      visibility,
      payload,
      created_at
    )
    values (
      p_game_id,
      p_phase_instance_id,
      v_event_kind,
      v_visibility,
      v_payload,
      p_created_at
    )
    returning game_events.id into v_event_id;

    insert into public.game_event_visible_players (
      game_id,
      game_event_id,
      player_id
    )
    select p_game_id, v_event_id, ids.id
    from pg_catalog.unnest(v_player_ids) as ids(id);

    insert into public.game_event_visible_roles (
      game_id,
      game_event_id,
      role_id
    )
    select p_game_id, v_event_id, ids.id
    from pg_catalog.unnest(v_role_ids) as ids(id);
  end loop;
end;
$$;

create function private.insert_day_speech_slots(
  p_game_id uuid,
  p_phase_instance_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_index integer := 0;
  v_slot jsonb;
  v_slot_index integer;
  v_speaker_player_id bigint;
begin
  if p_game_id is null
    or p_phase_instance_id is null
    or p_slots is null
    or pg_catalog.jsonb_typeof(p_slots) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
  end if;

  for v_slot in
    select items.value
    from pg_catalog.jsonb_array_elements(p_slots) as items(value)
  loop
    if pg_catalog.jsonb_typeof(v_slot) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_slot)
      ) <> 2
      or not (v_slot ? 'slot_index' and v_slot ? 'speaker_player_id')
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

    if v_slot_index <> v_expected_index
      or not exists (
        select 1
        from public.game_players as game_players
        where game_players.game_id = p_game_id
          and game_players.player_id = v_speaker_player_id
          and game_players.alive
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_day_speech_slots';
    end if;

    insert into public.day_speech_slots (
      game_id,
      phase_instance_id,
      slot_index,
      speaker_player_id
    )
    values (
      p_game_id,
      p_phase_instance_id,
      v_slot_index,
      v_speaker_player_id
    );

    v_expected_index := v_expected_index + 1;
  end loop;
end;
$$;

create function public.app_start_game(
  p_account_id bigint,
  p_room_code text,
  p_expected_roster_revision bigint,
  p_expected_player_ids bigint[],
  p_phase_instance_id uuid,
  p_phase_duration_seconds integer,
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
  v_active_player_ids bigint[];
  v_active_role_ids text[];
  v_assignment jsonb;
  v_assignment_player_ids bigint[] := array[]::bigint[];
  v_assignment_role_id text;
  v_assignment_player_id bigint;
  v_connected_player_ids bigint[];
  v_current_game public.games%rowtype;
  v_distinct_expected_player_count integer;
  v_expected_player_ids bigint[];
  v_game_id uuid := pg_catalog.gen_random_uuid();
  v_group jsonb;
  v_group_ids text[] := array[]::text[];
  v_group_role_ids text[];
  v_host_player public.players%rowtype;
  v_key_count integer;
  v_now timestamptz;
  v_phase_ends_at timestamptz;
  v_positive_role_ids text[];
  v_role_count_total numeric;
  v_room public.rooms%rowtype;
  v_sequence_number bigint;
begin
  if p_account_id is null
    or p_expected_roster_revision is null
    or p_expected_roster_revision < 0
    or p_phase_instance_id is null
    or p_phase_duration_seconds is null
    or p_phase_duration_seconds not between 1 and 3000
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

  select coalesce(
    pg_catalog.sum((roles.role_count #>> '{}')::numeric),
    0
  )
  into v_role_count_total
  from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count);

  select pg_catalog.count(*)
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
    or p_phase_duration_seconds <> (p_options ->> 'firstNightSeconds')::integer
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

  select pg_catalog.count(*)
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_resolved_role_setup);

  if v_key_count <> 3
    or not (
      p_resolved_role_setup ? 'activeRoleIds'
      and p_resolved_role_setup ? 'contributions'
      and p_resolved_role_setup ? 'nightConversationGroups'
    )
    or pg_catalog.jsonb_typeof(p_resolved_role_setup -> 'activeRoleIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolved_role_setup -> 'contributions') <> 'array'
    or pg_catalog.jsonb_typeof(
      p_resolved_role_setup -> 'nightConversationGroups'
    ) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        p_resolved_role_setup -> 'activeRoleIds'
      ) as roles(value)
      where pg_catalog.jsonb_typeof(roles.value) <> 'string'
        or roles.value #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
    )
  then
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

  select coalesce(
    pg_catalog.array_agg(roles.role_id order by roles.role_id),
    array[]::text[]
  )
  into v_positive_role_ids
  from pg_catalog.jsonb_each(p_role_counts) as roles(role_id, role_count)
  where (roles.role_count #>> '{}')::integer > 0;

  if v_active_role_ids <> v_positive_role_ids
    or pg_catalog.cardinality(v_active_role_ids) <> (
      select pg_catalog.count(distinct role_id)
      from pg_catalog.unnest(v_active_role_ids) as roles(role_id)
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
  end if;

  for v_group in
    select groups.value
    from pg_catalog.jsonb_array_elements(
      p_resolved_role_setup -> 'nightConversationGroups'
    ) as groups(value)
  loop
    if pg_catalog.jsonb_typeof(v_group) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_group)
      ) <> 3
      or not (
        v_group ? 'groupId'
        and v_group ? 'label'
        and v_group ? 'roleIds'
      )
      or pg_catalog.jsonb_typeof(v_group -> 'groupId') <> 'string'
      or v_group ->> 'groupId' !~ '^[a-z][a-z0-9_:-]{0,63}$'
      or pg_catalog.jsonb_typeof(v_group -> 'label') <> 'object'
      or pg_catalog.jsonb_typeof(v_group -> 'roleIds') <> 'array'
      or v_group ->> 'groupId' = any(v_group_ids)
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_group -> 'roleIds') as roles(value)
        where pg_catalog.jsonb_typeof(roles.value) <> 'string'
          or not (roles.value #>> '{}' = any(v_active_role_ids))
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    select coalesce(
      pg_catalog.array_agg(roles.value),
      array[]::text[]
    )
    into v_group_role_ids
    from pg_catalog.jsonb_array_elements_text(v_group -> 'roleIds') as roles(value);

    if pg_catalog.cardinality(v_group_role_ids) = 0
      or pg_catalog.cardinality(v_group_role_ids) <> (
        select pg_catalog.count(distinct role_id)
        from pg_catalog.unnest(v_group_role_ids) as roles(role_id)
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_resolved_role_setup';
    end if;

    v_group_ids := pg_catalog.array_append(v_group_ids, v_group ->> 'groupId');
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

  if not found or v_room.closed_at is not null then
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

  if v_room.current_game_id is not null then
    select games.*
    into v_current_game
    from public.games as games
    where games.id = v_room.current_game_id
    for update;
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_phase_ends_at := v_now + pg_catalog.make_interval(secs => p_phase_duration_seconds);

  if v_room.lobby_expires_at <= v_now
    and (v_current_game.id is null or v_current_game.ended_at is not null)
  then
    perform private.expire_open_room(v_room.id, v_now);
    return query select v_room.id, v_host_player.id, 'room_closed'::text;
    return;
  end if;

  if v_current_game.id is not null and v_current_game.ended_at is null then
    raise exception using errcode = 'P0001', message = 'room_in_progress';
  end if;

  if exists (
    select 1
    from public.games as games
    where games.room_id = v_room.id
      and games.ended_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'room_in_progress';
  end if;

  if v_room.roster_revision <> p_expected_roster_revision then
    raise exception using errcode = 'P0001', message = 'stale_roster_revision';
  end if;

  perform players.id
  from public.players as players
  where players.room_id = v_room.id
    and players.left_at is null
  order by players.id
  for update;

  select coalesce(
    pg_catalog.array_agg(players.id order by players.id),
    array[]::bigint[]
  )
  into v_active_player_ids
  from public.players as players
  where players.room_id = v_room.id
    and players.left_at is null;

  select coalesce(
    pg_catalog.array_agg(players.id order by players.id),
    array[]::bigint[]
  )
  into v_connected_player_ids
  from public.players as players
  where players.room_id = v_room.id
    and players.status = 'joined';

  if exists (
    select 1
    from pg_catalog.unnest(p_expected_player_ids) as expected(player_id)
    where expected.player_id is null or expected.player_id < 1
  ) then
    raise exception using errcode = 'P0001', message = 'room_players_changed';
  end if;

  select
    coalesce(
      pg_catalog.array_agg(expected.player_id order by expected.player_id),
      array[]::bigint[]
    ),
    pg_catalog.count(distinct expected.player_id)
  into v_expected_player_ids, v_distinct_expected_player_count
  from pg_catalog.unnest(p_expected_player_ids) as expected(player_id);

  if pg_catalog.cardinality(v_active_player_ids) <> v_room.target_player_count
    or v_active_player_ids <> v_connected_player_ids
    or v_expected_player_ids <> v_active_player_ids
    or v_distinct_expected_player_count <> v_room.target_player_count
  then
    raise exception using errcode = 'P0001', message = 'room_players_changed';
  end if;

  if exists (
    select 1
    from public.players as players
    where players.room_id = v_room.id
      and players.left_at is null
      and players.ready_roster_revision is distinct from p_expected_roster_revision
  ) then
    raise exception using errcode = 'P0001', message = 'room_roster_not_ready';
  end if;

  if v_role_count_total <> v_room.target_player_count
    or pg_catalog.jsonb_array_length(p_assignments) <> v_room.target_player_count
  then
    raise exception using errcode = 'P0001', message = 'invalid_assignments';
  end if;

  for v_assignment in
    select assignments.value
    from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value)
  loop
    if pg_catalog.jsonb_typeof(v_assignment) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_assignment)
      ) <> 2
      or not (v_assignment ? 'player_id' and v_assignment ? 'role_id')
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
      or not (v_assignment_player_id = any(v_active_player_ids))
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
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value)
      where assignments.value ->> 'role_id' = roles.role_id
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_assignments';
  end if;

  select coalesce(pg_catalog.max(games.sequence_number), 0) + 1
  into v_sequence_number
  from public.games as games
  where games.room_id = v_room.id;

  insert into public.games (
    id,
    room_id,
    sequence_number,
    phase,
    phase_instance_id,
    phase_started_at,
    phase_ends_at,
    day_number,
    night_number,
    revision,
    action_revision,
    started_at,
    updated_at
  )
  values (
    v_game_id,
    v_room.id,
    v_sequence_number,
    'night',
    p_phase_instance_id,
    v_now,
    v_phase_ends_at,
    0,
    1,
    1,
    0,
    v_now,
    v_now
  );

  insert into public.game_phase_instances (
    game_id,
    id,
    phase,
    day_number,
    night_number,
    started_at,
    ends_at
  )
  values (
    v_game_id,
    p_phase_instance_id,
    'night',
    0,
    1,
    v_now,
    v_phase_ends_at
  );

  insert into public.game_rule_sets (
    game_id,
    role_counts,
    options,
    resolved_role_setup,
    role_registry_version,
    engine_version,
    created_at
  )
  values (
    v_game_id,
    p_role_counts,
    p_options,
    p_resolved_role_setup,
    p_role_registry_version,
    p_engine_version,
    v_now
  );

  insert into public.game_players (
    game_id,
    room_id,
    player_id,
    role_id,
    alive,
    created_at,
    updated_at
  )
  select
    v_game_id,
    v_room.id,
    (assignments.value ->> 'player_id')::bigint,
    assignments.value ->> 'role_id',
    true,
    v_now,
    v_now
  from pg_catalog.jsonb_array_elements(p_assignments) as assignments(value);

  insert into public.realtime_topics (
    topic,
    room_id,
    scope,
    game_id,
    role_id,
    created_at
  )
  select
    private.random_identifier('role:', 24),
    v_room.id,
    'role_private',
    v_game_id,
    assigned_roles.role_id,
    v_now
  from (
    select distinct game_players.role_id
    from public.game_players as game_players
    where game_players.game_id = v_game_id
  ) as assigned_roles;

  perform private.insert_current_actions(
    v_game_id,
    p_phase_instance_id,
    v_phase_ends_at,
    p_actions
  );

  perform private.insert_game_events(
    v_game_id,
    p_phase_instance_id,
    v_now,
    p_events
  );

  update public.rooms as rooms
  set current_game_id = v_game_id,
      snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id
    and rooms.closed_at is null
    and rooms.roster_revision = p_expected_roster_revision
    and rooms.current_game_id is not distinct from v_room.current_game_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'stale_roster_revision';
  end if;

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
    'game_started',
    v_host_player.id,
    v_game_id,
    pg_catalog.jsonb_build_object('sequenceNumber', v_sequence_number),
    v_now
  );

  return query select v_room.id, v_host_player.id, 'game_started'::text;
end;
$$;

create function public.app_submit_action(
  p_account_id bigint,
  p_room_code text,
  p_game_id uuid,
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
  v_game public.games%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_target_player_id bigint;
  v_updated_count integer;
begin
  if p_account_id is null
    or p_game_id is null
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

  if v_room.current_game_id is distinct from p_game_id then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
  end if;

  select games.*
  into v_game
  from public.games as games
  where games.id = p_game_id
    and games.room_id = v_room.id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
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

  if v_game.ended_at is not null
    or v_game.phase_instance_id is distinct from p_phase_instance_id
    or v_game.revision <> p_expected_revision
  then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  select game_players.role_id, game_players.alive
  into v_submitter_role_id, v_submitter_alive
  from public.game_players as game_players
  where game_players.game_id = p_game_id
    and game_players.player_id = v_player.id;

  if not found then
    raise exception using errcode = 'P0001', message = 'action_not_allowed';
  end if;

  if p_target_public_player_id is not null then
    select players.id
    into v_target_player_id
    from public.players as players
    join public.game_players as game_players
      on game_players.game_id = p_game_id
     and game_players.player_id = players.id
    where players.room_id = v_room.id
      and players.public_player_id = p_target_public_player_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'invalid_action_target';
    end if;
  end if;

  select actions.*
  into v_action
  from public.current_actions as actions
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id
    and actions.action_key = p_action_key
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'action_not_available';
  end if;

  if v_action.closes_at is not null and v_action.closes_at <= v_now then
    raise exception using errcode = 'P0001', message = 'action_window_closed';
  end if;

  if (v_action.actor_player_id is not null and v_action.actor_player_id <> v_player.id)
    or (
      v_action.actor_role_id is not null
      and v_action.actor_role_id <> v_submitter_role_id
    )
    or (
      v_action.actor_state_requirement = 'alive'
      and not v_submitter_alive
    )
  then
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
          where eligible.game_id = p_game_id
            and eligible.current_action_id = v_action.id
            and eligible.player_id = v_target_player_id
        )
      )
    )
    or (
      v_target_player_id is not null
      and v_action.target_state_requirement = 'alive'
      and not exists (
        select 1
        from public.game_players as game_players
        where game_players.game_id = p_game_id
          and game_players.player_id = v_target_player_id
          and game_players.alive
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_action_target';
  end if;

  insert into public.pending_actions (
    current_action_id,
    game_id,
    submitter_player_id,
    target_player_id,
    submitted_at
  )
  values (
    v_action.id,
    p_game_id,
    v_player.id,
    v_target_player_id,
    v_now
  )
  on conflict (current_action_id) do nothing
  returning pending_actions.current_action_id into v_accepted_action_id;

  if v_accepted_action_id is null then
    return query select v_room.id, v_player.id, null::text;
    return;
  end if;

  perform private.insert_game_events(
    p_game_id,
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

  update public.games as games
  set action_revision = games.action_revision + 1,
      updated_at = v_now
  where games.id = p_game_id
    and games.phase_instance_id = p_phase_instance_id
    and games.revision = p_expected_revision
    and games.ended_at is null;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  if v_game.phase = 'night' and v_game.night_number > 1 then
    update public.players as players
    set private_snapshot_revision = players.private_snapshot_revision + 1
    where players.room_id = v_room.id
      and players.left_at is null
      and (
        players.id = v_player.id
        or (
          v_action.actor_player_id is null
          and v_action.actor_role_id is not null
          and exists (
            select 1
            from public.game_players as recipients
            where recipients.game_id = p_game_id
              and recipients.player_id = players.id
              and recipients.role_id = v_action.actor_role_id
          )
        )
      );

    return query select v_room.id, v_player.id, 'private_view_changed'::text;
  else
    update public.rooms as rooms
    set snapshot_revision = rooms.snapshot_revision + 1,
        updated_at = v_now
    where rooms.id = v_room.id;

    return query select v_room.id, v_player.id, 'action_window_changed'::text;
  end if;
end;
$$;

create function public.app_send_night_conversation_message(
  p_account_id bigint,
  p_room_code text,
  p_game_id uuid,
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
  v_game public.games%rowtype;
  v_group jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
begin
  if p_account_id is null
    or p_game_id is null
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

  if v_room.current_game_id is distinct from p_game_id then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
  end if;

  select games.*
  into v_game
  from public.games as games
  where games.id = p_game_id
    and games.room_id = v_room.id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
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

  if v_game.ended_at is not null
    or v_game.phase <> 'night'
    or v_game.phase_instance_id is distinct from p_phase_instance_id
    or v_game.night_number <> p_night_number
  then
    raise exception using errcode = 'P0001', message = 'stale_phase';
  end if;

  select game_players.role_id, game_players.alive
  into v_submitter_role_id, v_submitter_alive
  from public.game_players as game_players
  where game_players.game_id = p_game_id
    and game_players.player_id = v_player.id;

  if not found or not v_submitter_alive then
    raise exception using errcode = 'P0001', message = 'night_message_not_allowed';
  end if;

  select groups.value
  into v_group
  from public.game_rule_sets as rule_sets
  cross join lateral pg_catalog.jsonb_array_elements(
    rule_sets.resolved_role_setup -> 'nightConversationGroups'
  ) as groups(value)
  where rule_sets.game_id = p_game_id
    and groups.value ->> 'groupId' = p_conversation_group_id
  limit 1;

  if not found
    or pg_catalog.jsonb_typeof(v_group) <> 'object'
    or pg_catalog.jsonb_typeof(v_group -> 'roleIds') <> 'array'
    or not (
      v_group -> 'roleIds' ? v_submitter_role_id
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(v_group -> 'roleIds') as roles(role_id)
      where not exists (
        select 1
        from public.realtime_topics as topics
        where topics.room_id = v_room.id
          and topics.game_id = p_game_id
          and topics.scope = 'role_private'
          and topics.role_id = roles.role_id
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'night_message_not_allowed';
  end if;

  insert into public.night_conversation_messages (
    game_id,
    night_number,
    conversation_group_id,
    sender_player_id,
    body,
    created_at
  )
  values (
    p_game_id,
    p_night_number,
    p_conversation_group_id,
    v_player.id,
    v_body,
    v_now
  );

  update public.players as players
  set private_snapshot_revision = players.private_snapshot_revision + 1
  where players.room_id = v_room.id
    and players.left_at is null
    and exists (
      select 1
      from public.game_players as recipients
      where recipients.game_id = p_game_id
        and recipients.player_id = players.id
        and v_group -> 'roleIds' ? recipients.role_id
    );

  return query select v_room.id, v_player.id, 'private_view_changed'::text;
end;
$$;

create function public.app_resolve_phase(
  p_game_id uuid,
  p_phase_instance_id uuid,
  p_expected_revision bigint,
  p_expected_action_revision bigint,
  p_deaths jsonb,
  p_final_outcome jsonb,
  p_player_results jsonb,
  p_next_phase text,
  p_next_phase_instance_id uuid,
  p_next_phase_duration_seconds integer,
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
  v_game public.games%rowtype;
  v_key_count integer;
  v_next_phase_ends_at timestamptz;
  v_now timestamptz;
  v_pending_action_count integer;
  v_phase_timed_out boolean;
  v_player_ids bigint[];
  v_result jsonb;
  v_result_player_id bigint;
  v_result_player_ids bigint[] := array[]::bigint[];
  v_result_player_ids_sorted bigint[];
  v_room public.rooms%rowtype;
  v_updated_count integer;
begin
  if p_game_id is null
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
    or (
      p_next_phase_duration_seconds is not null
      and p_next_phase_duration_seconds not between 1 and 3000
    )
  then
    raise exception using errcode = 'P0001', message = 'invalid_phase_resolution';
  end if;

  select games.*
  into v_game
  from public.games as games
  where games.id = p_game_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
  end if;

  select rooms.*
  into v_room
  from public.rooms as rooms
  where rooms.id = v_game.room_id
  for update;

  if v_room.current_game_id is distinct from p_game_id then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
  end if;

  select games.*
  into v_game
  from public.games as games
  where games.id = p_game_id
  for update;

  if v_game.ended_at is not null
    or v_game.phase_instance_id is distinct from p_phase_instance_id
    or v_game.revision <> p_expected_revision
    or v_game.action_revision <> p_expected_action_revision
  then
    return query select v_room.id, null::bigint, null::text;
    return;
  end if;

  perform actions.id
  from public.current_actions as actions
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id
  order by actions.id
  for update;

  perform pending.current_action_id
  from public.pending_actions as pending
  join public.current_actions as actions
    on actions.game_id = pending.game_id
   and actions.id = pending.current_action_id
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id
  order by pending.current_action_id
  for update of pending;

  v_now := pg_catalog.clock_timestamp();
  v_next_phase_ends_at := case
    when p_next_phase_duration_seconds is null then null
    else v_now + pg_catalog.make_interval(secs => p_next_phase_duration_seconds)
  end;

  select pg_catalog.count(*)
  into v_action_count
  from public.current_actions as actions
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id;

  select pg_catalog.count(*)
  into v_pending_action_count
  from public.pending_actions as pending
  join public.current_actions as actions
    on actions.game_id = pending.game_id
   and actions.id = pending.current_action_id
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id;

  v_all_actions_submitted :=
    v_action_count > 0 and v_pending_action_count = v_action_count;
  v_phase_timed_out :=
    v_game.phase_ends_at is not null and v_game.phase_ends_at <= v_now;

  if not (
    v_phase_timed_out
    or (
      (v_game.phase <> 'night' or v_game.night_number = 1)
      and v_all_actions_submitted
    )
  ) then
    return query select v_room.id, null::bigint, null::text;
    return;
  end if;

  for v_death in
    select deaths.value
    from pg_catalog.jsonb_array_elements(p_deaths) as deaths(value)
  loop
    if pg_catalog.jsonb_typeof(v_death) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_death)
      ) <> 2
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

    update public.game_players as game_players
    set alive = false,
        updated_at = v_now
    where game_players.game_id = p_game_id
      and game_players.player_id = v_death_player_id
      and game_players.alive;

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'invalid_deaths';
    end if;
  end loop;

  insert into public.resolved_actions (
    game_id,
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
    actions.game_id,
    actions.phase_instance_id,
    v_game.phase,
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
    on pending.game_id = actions.game_id
   and pending.current_action_id = actions.id
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id
  order by actions.id;

  perform private.insert_game_events(
    p_game_id,
    p_phase_instance_id,
    v_now,
    p_events
  );

  if p_final_outcome is not null then
    select pg_catalog.count(*)
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
        where rule_sets.game_id = p_game_id
          and contributions.value ->> 'kind' = 'winner_judgement'
          and contributions.value -> 'judgement' ->> 'winnerTeam'
            = v_final_winner_team
      )
      or p_next_phase is not null
      or p_next_phase_instance_id is not null
      or p_next_phase_duration_seconds is not null
      or p_next_day_number is distinct from v_game.day_number
      or p_next_night_number is distinct from v_game.night_number
      or pg_catalog.jsonb_array_length(p_actions) <> 0
      or pg_catalog.jsonb_array_length(p_day_speech_slots) <> 0
    then
      raise exception using errcode = 'P0001', message = 'invalid_final_outcome';
    end if;

    for v_result in
      select results.value
      from pg_catalog.jsonb_array_elements(p_player_results) as results(value)
    loop
      if pg_catalog.jsonb_typeof(v_result) <> 'object'
        or (
          select pg_catalog.count(*)
          from pg_catalog.jsonb_object_keys(v_result)
        ) <> 2
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
      if v_result_player_id = any(v_result_player_ids) then
        raise exception using errcode = 'P0001', message = 'invalid_player_results';
      end if;

      v_result_player_ids := pg_catalog.array_append(
        v_result_player_ids,
        v_result_player_id
      );
    end loop;

    select coalesce(
      pg_catalog.array_agg(game_players.player_id order by game_players.player_id),
      array[]::bigint[]
    )
    into v_player_ids
    from public.game_players as game_players
    where game_players.game_id = p_game_id;

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
      or p_next_phase_duration_seconds is null
      or p_next_day_number is null
      or p_next_day_number < 0
      or p_next_night_number is null
      or p_next_night_number < 1
      or (
        p_next_phase = v_game.phase
        and pg_catalog.jsonb_array_length(p_actions) = 0
      )
      or not (
        (
          p_next_phase = v_game.phase
          and p_next_day_number = v_game.day_number
          and p_next_night_number = v_game.night_number
        )
        or (
          v_game.phase = 'night'
          and p_next_phase = 'day'
          and p_next_day_number = v_game.day_number + 1
          and p_next_night_number = v_game.night_number
        )
        or (
          v_game.phase = 'day'
          and p_next_phase = 'voting'
          and p_next_day_number = v_game.day_number
          and p_next_night_number = v_game.night_number
        )
        or (
          v_game.phase = 'voting'
          and p_next_phase = 'execution'
          and p_next_day_number = v_game.day_number
          and p_next_night_number = v_game.night_number
        )
        or (
          v_game.phase in ('voting', 'execution')
          and p_next_phase = 'night'
          and p_next_day_number = v_game.day_number
          and p_next_night_number = v_game.night_number + 1
        )
      )
    then
      raise exception using errcode = 'P0001', message = 'invalid_next_phase';
    end if;
  end if;

  delete from public.day_speech_slots as slots
  where slots.game_id = p_game_id
    and slots.phase_instance_id = p_phase_instance_id;

  delete from public.current_actions as actions
  where actions.game_id = p_game_id
    and actions.phase_instance_id = p_phase_instance_id;

  get diagnostics v_deleted_action_count = row_count;

  if v_deleted_action_count <> v_action_count then
    raise exception using errcode = 'P0001', message = 'action_window_changed';
  end if;

  update public.game_phase_instances as phase_instances
  set ended_at = v_now
  where phase_instances.game_id = p_game_id
    and phase_instances.id = p_phase_instance_id
    and phase_instances.ended_at is null;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'phase_changed';
  end if;

  if p_final_outcome is not null then
    for v_result in
      select results.value
      from pg_catalog.jsonb_array_elements(p_player_results) as results(value)
    loop
      update public.game_players as game_players
      set result = v_result ->> 'result',
          updated_at = v_now
      where game_players.game_id = p_game_id
        and game_players.player_id = (v_result ->> 'player_id')::bigint;
    end loop;

    update public.games as games
    set phase = null,
        phase_instance_id = null,
        phase_started_at = null,
        phase_ends_at = null,
        revision = games.revision + 1,
        action_revision = 0,
        winner_team = v_final_winner_team,
        updated_at = v_now,
        ended_at = v_now
    where games.id = p_game_id
      and games.phase_instance_id = p_phase_instance_id
      and games.revision = p_expected_revision
      and games.action_revision = p_expected_action_revision
      and games.ended_at is null;

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'phase_changed';
    end if;

    update public.rooms as rooms
    set roster_revision = rooms.roster_revision + 1,
        snapshot_revision = rooms.snapshot_revision + 1,
        lobby_expires_at = v_now + interval '30 minutes',
        updated_at = v_now
    where rooms.id = v_room.id
      and rooms.closed_at is null
      and rooms.current_game_id = p_game_id;

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> 1 then
      raise exception using errcode = 'P0001', message = 'stale_game_id';
    end if;

    insert into public.room_events (
      room_id,
      event_kind,
      game_id,
      payload,
      created_at
    )
    values (
      v_room.id,
      'game_ended',
      p_game_id,
      pg_catalog.jsonb_build_object('winnerTeam', v_final_winner_team),
      v_now
    );

    return query select v_room.id, null::bigint, 'game_ended'::text;
    return;
  end if;

  insert into public.game_phase_instances (
    game_id,
    id,
    phase,
    day_number,
    night_number,
    started_at,
    ends_at
  )
  values (
    p_game_id,
    p_next_phase_instance_id,
    p_next_phase,
    p_next_day_number,
    p_next_night_number,
    v_now,
    v_next_phase_ends_at
  );

  update public.games as games
  set phase = p_next_phase,
      phase_instance_id = p_next_phase_instance_id,
      phase_started_at = v_now,
      phase_ends_at = v_next_phase_ends_at,
      day_number = p_next_day_number,
      night_number = p_next_night_number,
      revision = games.revision + 1,
      action_revision = 0,
      updated_at = v_now
  where games.id = p_game_id
    and games.phase_instance_id = p_phase_instance_id
    and games.revision = p_expected_revision
    and games.action_revision = p_expected_action_revision
    and games.ended_at is null;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'phase_changed';
  end if;

  perform private.insert_current_actions(
    p_game_id,
    p_next_phase_instance_id,
    v_next_phase_ends_at,
    p_actions
  );

  perform private.insert_day_speech_slots(
    p_game_id,
    p_next_phase_instance_id,
    p_day_speech_slots
  );

  update public.rooms as rooms
  set snapshot_revision = rooms.snapshot_revision + 1,
      updated_at = v_now
  where rooms.id = v_room.id
    and rooms.closed_at is null
    and rooms.current_game_id = p_game_id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'stale_game_id';
  end if;

  return query
  select
    v_room.id,
    null::bigint,
    case
      when p_next_phase is distinct from v_game.phase then 'phase_changed'::text
      else 'action_window_changed'::text
    end;
end;
$$;

revoke all on function public.app_start_game(
  bigint,
  text,
  bigint,
  bigint[],
  uuid,
  integer,
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
  uuid,
  text,
  uuid,
  bigint,
  text
) from public, anon, authenticated;
revoke all on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.app_resolve_phase(
  uuid,
  uuid,
  bigint,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  integer,
  integer,
  integer,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.app_start_game(
  bigint,
  text,
  bigint,
  bigint[],
  uuid,
  integer,
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
  uuid,
  text,
  uuid,
  bigint,
  text
) to service_role;
grant execute on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  uuid,
  integer,
  text,
  text
) to service_role;
grant execute on function public.app_resolve_phase(
  uuid,
  uuid,
  bigint,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  text,
  uuid,
  integer,
  integer,
  integer,
  jsonb,
  jsonb,
  jsonb
) to service_role;
