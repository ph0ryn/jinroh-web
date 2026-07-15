begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_column(
  'public',
  'rooms',
  'current_game_id',
  'rooms point to exactly one current game'
);

select has_column(
  'public',
  'rooms',
  'closed_at',
  'room closure is independent from game completion'
);

select has_column(
  'public',
  'rooms',
  'roster_revision',
  'rooms own a roster readiness epoch'
);

select has_column(
  'public',
  'rooms',
  'lobby_expires_at',
  'room lobbies have an expiry shared by waiting and result states'
);

select hasnt_column(
  'public',
  'rooms',
  'waiting_expires_at',
  'the obsolete waiting-only expiry name is absent'
);

select hasnt_column(
  'public',
  'rooms',
  'started_at',
  'game start timestamps do not live on rooms'
);

select hasnt_column(
  'public',
  'rooms',
  'ended_at',
  'game end timestamps do not live on rooms'
);

select hasnt_column(
  'public',
  'rooms',
  'status',
  'room status is projected from closure and current game state'
);

select has_column(
  'public',
  'players',
  'ready_roster_revision',
  'players record roster-scoped lobby readiness'
);

select has_column(
  'public',
  'players',
  'private_snapshot_revision',
  'players own monotonic private snapshot revisions'
);

select has_table('public', 'games', 'games are first-class persisted playthroughs');

select col_type_is(
  'public',
  'games',
  'id',
  'uuid',
  'game IDs are browser-safe UUIDs'
);

select has_column(
  'public',
  'games',
  'sequence_number',
  'games have a room-local sequence'
);

select has_column(
  'public',
  'games',
  'winner_team',
  'the game owns its opaque winning team'
);

select hasnt_table(
  'public',
  'game_states',
  'the one-state-row-per-room table is removed'
);

select hasnt_table(
  'public',
  'role_assignments',
  'role assignments are folded into game players'
);

select hasnt_table(
  'public',
  'game_player_states',
  'mutable player state is folded into game players'
);

select hasnt_table(
  'public',
  'final_outcomes',
  'the redundant final outcome table is removed'
);

select hasnt_table(
  'public',
  'player_results',
  'player results are folded into game players'
);

select has_column(
  'public',
  'game_players',
  'role_id',
  'game players own immutable role assignment'
);

select has_column(
  'public',
  'game_players',
  'alive',
  'game players own mutable alive state'
);

select has_column(
  'public',
  'game_players',
  'result',
  'game players own their final result'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'rooms_current_game_fk'
      and condeferrable
      and condeferred
      and pg_catalog.pg_get_constraintdef(oid) like
        'FOREIGN KEY (id, current_game_id) REFERENCES games(room_id, id)%'
  ),
  'the current game pointer is a deferred same-room foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index
    join pg_catalog.pg_class as indexes
      on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'rooms_open_code_unique'
      and pg_index.indisunique
      and pg_catalog.pg_get_expr(pg_index.indpred, pg_index.indrelid)
        like '%closed_at IS NULL%'
  ),
  'room codes stay reserved until room closure'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index
    join pg_catalog.pg_class as indexes
      on indexes.oid = pg_index.indexrelid
    where indexes.relname = 'games_one_open_per_room_idx'
      and pg_index.indisunique
      and pg_catalog.pg_get_expr(pg_index.indpred, pg_index.indrelid)
        like '%ended_at IS NULL%'
  ),
  'a room can have at most one open game'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'game_rule_sets',
        'game_phase_instances',
        'current_actions',
        'pending_actions',
        'resolved_actions',
        'game_events',
        'night_conversation_messages',
        'day_speech_slots'
      )
      and column_name = 'room_id'
  ),
  'game artifacts are scoped through game_id instead of room_id'
);

select has_column(
  'public',
  'realtime_topics',
  'game_id',
  'realtime role topics carry game identity'
);

select hasnt_column(
  'public',
  'realtime_topics',
  'snapshot_revision',
  'topic-local revision counters are removed'
);

select has_column(
  'public',
  'realtime_grants',
  'game_id',
  'realtime grants record the current game when issued'
);

select ok(
  to_regprocedure(
    'public.app_set_room_player_ready(bigint,text,boolean,bigint)'
  ) is not null,
  'the roster-CAS readiness RPC exists'
);

select ok(
  to_regprocedure('public.app_expire_room_if_needed(bigint)') is not null
    and to_regprocedure('public.app_cleanup_expired_rooms(integer)') is not null,
  'expiry RPC names describe reusable room lobbies'
);

select ok(
  to_regprocedure(
    'public.app_expire_waiting_room_if_needed(bigint)'
  ) is null
    and to_regprocedure(
      'public.app_cleanup_expired_waiting_rooms(integer)'
    ) is null,
  'obsolete waiting-room-only RPC aliases are absent'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'public.app_read_room_runtime_snapshot(bigint,bigint,text,boolean)'::regprocedure
      )
    ),
    'to_jsonb('
  ) = 0,
  'runtime snapshots explicitly project every record field'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'public.app_read_room_runtime_snapshot(bigint,bigint,text,boolean)'::regprocedure
      )
    ),
    '''version'', 2'
  ) > 0,
  'runtime snapshots use the nested version 2 contract'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname in ('public', 'private')
      and procedures.prokind = 'f'
      and (
        pg_catalog.pg_get_functiondef(procedures.oid) ~
          E'''(werewolf|villager|seer|hunter)'''
      )
  ),
  'database functions do not enumerate concrete role identifiers'
);

select ok(
  (
    select pg_catalog.bool_and(classes.relrowsecurity and classes.relforcerowsecurity)
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    where namespaces.nspname in ('public', 'private')
      and classes.relkind = 'r'
      and classes.relname <> 'spatial_ref_sys'
  ),
  'all application tables have forced row-level security'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.rooms', 'select')
    and not pg_catalog.has_table_privilege('authenticated', 'public.rooms', 'select')
    and not pg_catalog.has_table_privilege('service_role', 'public.rooms', 'select'),
  'browser and service roles cannot read base room tables directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.app_start_game(bigint,text,bigint,bigint[],uuid,integer,jsonb,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)',
    'execute'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.app_start_game(bigint,text,bigint,bigint[],uuid,integer,jsonb,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)',
      'execute'
    ),
  'game mutations are executable only through the service role'
);

select * from finish();
rollback;
