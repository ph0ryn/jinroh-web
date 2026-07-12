begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

select hasnt_column(
  'public',
  'accounts',
  'current_room_id',
  'active room membership is derived from players'
);

select hasnt_column(
  'public',
  'rooms',
  'view_revision',
  'the trigger-maintained view revision is absent'
);

select has_column(
  'public',
  'rooms',
  'snapshot_revision',
  'rooms expose an explicit transaction-owned snapshot revision'
);

select has_column(
  'public',
  'realtime_topics',
  'snapshot_revision',
  'realtime topics expose transaction-owned private snapshot revisions'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'realtime_topics_snapshot_revision_check'
      and pg_get_constraintdef(oid) like '%snapshot_revision >= 0%'
  ),
  'realtime topic snapshot revisions cannot become negative'
);

select ok(
  to_regprocedure('public.bump_room_view_revision()') is null
    and to_regprocedure('public.bump_room_view_revision_on_room_update()') is null,
  'legacy revision trigger functions are absent'
);

select ok(
  not exists (
    select 1
    from pg_trigger
    where tgname like '%bump_room_view_revision%'
  ),
  'legacy revision triggers are absent'
);

select ok(
  not exists (
    select 1
    from pg_trigger
    where tgname in (
      'accounts_validate_current_room',
      'players_sync_account_current_room',
      'players_validate_account_current_room',
      'rooms_release_current_room_on_waiting_end',
      'rooms_validate_account_current_room'
    )
  ),
  'legacy current-room synchronization triggers are absent'
);

select ok(
  position(
    'to_jsonb(' in lower(
      pg_get_functiondef(
        'public.app_read_room_runtime_snapshot(bigint,bigint,text,boolean)'::regprocedure
      )
    )
  ) = 0,
  'the versioned runtime snapshot projects record fields explicitly'
);

select is(
  (
    select columns.is_generated
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.table_name = 'rooms'
      and columns.column_name = 'status'
  ),
  'ALWAYS',
  'room status is generated from lifecycle timestamps'
);

select is(
  (
    select columns.is_generated
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.table_name = 'players'
      and columns.column_name = 'status'
  ),
  'ALWAYS',
  'player status is generated from membership timestamps'
);

select is(
  (
    select columns.is_generated
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.table_name = 'game_states'
      and columns.column_name = 'status'
  ),
  'ALWAYS',
  'game status is generated from its end timestamp'
);

select has_table(
  'public',
  'game_phase_instances',
  'phase instances preserve the immutable game phase history'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'game_phase_instances_one_open_per_room_idx'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%ended_at IS NULL%'
  ),
  'each room has at most one open persisted phase instance'
);

select hasnt_column(
  'public',
  'final_outcomes',
  'reason',
  'role-owned end reasons are not duplicated in the common outcome table'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'rooms_host_player_fk'
      and condeferrable
      and condeferred
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (id, host_account_id) REFERENCES players(room_id, account_id)%'
  ),
  'room hosts must be players in the same room and may be inserted atomically'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'room_events_actor_player_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, actor_player_id) REFERENCES players(room_id, id)%'
  ),
  'room event actors cannot reference another room'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'current_actions_game_phase_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, phase_instance_id) REFERENCES game_phase_instances(room_id, id)%'
  ),
  'current actions cannot reference another room phase'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'game_states_phase_instance_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, phase_instance_id, phase, day_number, night_number, phase_started_at, phase_ends_at) REFERENCES game_phase_instances(room_id, id, phase, day_number, night_number, started_at, ends_at) DEFERRABLE INITIALLY DEFERRED%'
  ),
  'the current game state references a persisted phase instance'
);

select ok(
  (
    select count(*)
    from pg_constraint
    where conname in (
      'day_speech_slots_game_phase_fk',
      'game_events_phase_instance_fk'
    )
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, phase_instance_id) REFERENCES game_phase_instances(room_id, id)%'
  ) = 2,
  'phase-scoped history and speech records reference persisted phase instances'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'resolved_actions_phase_instance_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, phase_instance_id, phase) REFERENCES game_phase_instances(room_id, id, phase)%'
  ),
  'resolved action phase labels must match their persisted phase instance'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'game_states_lifecycle_check'
      and pg_get_constraintdef(oid) like '%phase_ends_at IS NOT NULL%'
  ),
  'an active game state cannot bypass its phase reference with a null end time'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'current_action_eligible_players_action_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, current_action_id) REFERENCES current_actions(room_id, id) ON DELETE CASCADE%'
  ),
  'action eligibility is room-bound and follows action deletion'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'pending_actions_target_eligibility_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, current_action_id, target_player_id) REFERENCES current_action_eligible_players(room_id, current_action_id, player_id)%'
  ),
  'pending action targets must be eligible in the same room and action'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'realtime_grants_player_fk'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, id)%'
  ),
  'realtime grants cannot reference a player from another room'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'rooms_active_code_unique'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%ended_at IS NULL%'
  ),
  'room codes are unique only while a room is active'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'players_one_active_room_per_account_idx'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%left_at IS NULL%'
  ),
  'an account has at most one active room membership'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'realtime_topics_room_unique'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%scope = %room%'
  ),
  'each room has at most one room-scoped realtime topic'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'realtime_topics_player_unique'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%scope = %player_private%'
  ),
  'each player has at most one private realtime topic per room'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'realtime_topics_role_unique'
      and pg_index.indisunique
      and pg_get_expr(pg_index.indpred, pg_index.indrelid) like '%scope = %role_private%'
  ),
  'each role has at most one private realtime topic per room'
);

select ok(
  exists (
    select 1
    from pg_index
    join pg_class as indexes on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'resolved_actions_room_history_idx'
  ),
  'resolved action history has a dedicated index'
);

select ok(
  not exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relkind in ('r', 'p')
      and (not pg_class.relrowsecurity or not pg_class.relforcerowsecurity)
  ),
  'every public table enables and forces row-level security'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
  ),
  'public base tables have no browser-facing RLS policies'
);

select ok(
  not exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    cross join unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
    where pg_namespace.nspname = 'public'
      and pg_class.relkind in ('r', 'p')
      and (
        has_table_privilege(roles.role_name, pg_class.oid, 'SELECT')
        or has_table_privilege(roles.role_name, pg_class.oid, 'INSERT')
        or has_table_privilege(roles.role_name, pg_class.oid, 'UPDATE')
        or has_table_privilege(roles.role_name, pg_class.oid, 'DELETE')
        or has_table_privilege(roles.role_name, pg_class.oid, 'TRUNCATE')
        or has_table_privilege(roles.role_name, pg_class.oid, 'REFERENCES')
        or has_table_privilege(roles.role_name, pg_class.oid, 'TRIGGER')
      )
  ),
  'API roles have no direct privileges on public tables'
);

select ok(
  not exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    cross join unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
    where pg_namespace.nspname = 'public'
      and pg_class.relkind = 'S'
      and (
        has_sequence_privilege(roles.role_name, pg_class.oid, 'USAGE')
        or has_sequence_privilege(roles.role_name, pg_class.oid, 'SELECT')
        or has_sequence_privilege(roles.role_name, pg_class.oid, 'UPDATE')
      )
  ),
  'API roles have no direct privileges on public sequences'
);

select ok(
  not has_schema_privilege('anon', 'public', 'CREATE')
    and not has_schema_privilege('authenticated', 'public', 'CREATE')
    and not has_schema_privilege('service_role', 'public', 'CREATE'),
  'API roles cannot create public objects'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE')
    and not has_schema_privilege('service_role', 'private', 'USAGE'),
  'API roles cannot access the private schema'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname like 'app\_%' escape '\'
      and (
        has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
        or has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
        or not has_function_privilege('service_role', pg_proc.oid, 'EXECUTE')
      )
  ),
  'public application RPCs are executable only by the service role'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and (
        has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
        or has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
        or has_function_privilege('service_role', pg_proc.oid, 'EXECUTE')
      )
  ),
  'private helpers are not executable by API roles'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname in ('public', 'private')
      and pg_proc.prosecdef
      and not coalesce(pg_proc.proconfig, array[]::text[]) @> array['search_path=""']
  ),
  'every security-definer function pins an empty search path'
);

select * from finish();
rollback;
