begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(88);

create temporary table test_game_accounts (
  label text primary key,
  account_id bigint not null unique,
  player_id bigint,
  public_player_id text,
  role_id text not null,
  token_hash text not null unique
);

insert into test_game_accounts (label, account_id, role_id, token_hash)
select identities.label, created.account_id, identities.role_id, identities.token_hash
from (
  values
    ('host', 'werewolf', repeat('i', 43)),
    ('guest', 'villager', repeat('j', 43)),
    ('third', 'villager', repeat('k', 43))
) as identities(label, role_id, token_hash)
cross join lateral public.app_create_identity(identities.token_hash, 'test-key') as created;

create temporary table test_game_calls (
  label text primary key,
  room_id bigint not null,
  actor_player_id bigint,
  notification_reason text
);

insert into test_game_calls
select 'room_create', created.room_id, created.actor_player_id, created.notification_reason
from public.app_create_room(
  (select account_id from test_game_accounts where label = 'host'),
  'Host',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

create temporary table test_departed_game_account as
select created.account_id
from public.app_create_identity(repeat('q', 43), 'test-key') as created;

insert into test_game_calls
select 'departed_join', joined.room_id, joined.actor_player_id, joined.notification_reason
from public.app_join_room(
  (select account_id from test_departed_game_account),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from test_game_calls where label = 'room_create')
  ),
  'Departed'
) as joined
where joined.result_kind = 'target';

insert into test_game_calls
select 'departed_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_departed_game_account),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from test_game_calls where label = 'room_create')
  )
) as left_room;

insert into test_game_calls
select 'guest_join', joined.room_id, joined.actor_player_id, joined.notification_reason
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'guest'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from test_game_calls where label = 'room_create')
  ),
  'Guest'
) as joined
where joined.result_kind = 'target';

insert into test_game_calls
select 'third_join', joined.room_id, joined.actor_player_id, joined.notification_reason
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'third'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from test_game_calls where label = 'room_create')
  ),
  'Third'
) as joined
where joined.result_kind = 'target';

update test_game_accounts as accounts
set player_id = players.id,
    public_player_id = players.public_player_id
from public.players as players
where players.account_id = accounts.account_id
  and players.room_id = (select room_id from test_game_calls where label = 'room_create');

alter table test_game_accounts
  alter column player_id set not null,
  alter column public_player_id set not null;

create temporary table test_game_fixture as
select
  rooms.id as room_id,
  rooms.public_room_code as room_code,
  gen_random_uuid() as night_phase_instance_id,
  gen_random_uuid() as day_phase_instance_id,
  statement_timestamp() + interval '1 hour' as night_phase_ends_at,
  statement_timestamp() + interval '2 hours' as day_phase_ends_at
from public.rooms as rooms
where rooms.id = (select room_id from test_game_calls where label = 'room_create');

create function pg_temp.test_player_ids()
returns bigint[]
language sql
stable
as $$
  select array_agg(player_id order by player_id)
  from pg_temp.test_game_accounts;
$$;

create function pg_temp.test_assignments()
returns jsonb
language sql
stable
as $$
  select jsonb_agg(
    jsonb_build_object('player_id', player_id, 'role_id', role_id)
    order by player_id
  )
  from pg_temp.test_game_accounts;
$$;

create function pg_temp.test_resolved_role_setup()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'activeRoleIds', jsonb_build_array('villager', 'werewolf'),
    'contributions', jsonb_build_array(
      jsonb_build_object(
        'kind', 'winner_judgement',
        'judgement', jsonb_build_object(
          'id', 'werewolves_eliminated',
          'priority', 100,
          'sourceRoleId', 'werewolf',
          'winnerTeam', 'village'
        )
      ),
      jsonb_build_object(
        'kind', 'winner_judgement',
        'judgement', jsonb_build_object(
          'id', 'werewolf_dominance',
          'priority', 100,
          'sourceRoleId', 'werewolf',
          'winnerTeam', 'werewolf'
        )
      )
    ),
    'nightConversationGroups', jsonb_build_array(
      jsonb_build_object(
        'groupId', 'wolves',
        'label', jsonb_build_object('en', 'Werewolf council', 'ja', '人狼の密談'),
        'roleIds', jsonb_build_array('werewolf')
      )
    )
  );
$$;

create function pg_temp.test_options()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'dayMode', 'ready_check',
    'dayReadyCheckSecondsPerPlayer', 90,
    'daySpeechSeconds', 90,
    'executionLastWordsSeconds', 60,
    'firstDaySpeechRounds', 2,
    'firstNightSeconds', 30,
    'nightSeconds', 180,
    'normalDaySpeechRounds', 1,
    'roleOptions', jsonb_build_object(
      'guard', jsonb_build_object('consecutive_target', 'deny'),
      'seer', jsonb_build_object('initial_inspection', 'enabled')
    ),
    'voteResultVisibility', 'count_only',
    'votingSeconds', 30
  );
$$;

create function pg_temp.test_night_actions()
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'action_key', 'werewolf:attack',
      'action_kind', 'attack',
      'resolver_role_id', 'werewolf',
      'actor_player_id', null,
      'actor_role_id', 'werewolf',
      'actor_state_requirement', 'alive',
      'target_state_requirement', 'alive',
      'eligible_target_player_ids', (
        select jsonb_agg(player_id order by player_id)
        from pg_temp.test_game_accounts
        where role_id = 'villager'
      ),
      'target_kind', 'single_player'
    )
  );
$$;

create function pg_temp.test_start_events()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'event_kind', 'night_started',
      'payload', '{}'::jsonb,
      'visibility', 'public',
      'visible_to_player_ids', '[]'::jsonb,
      'visible_to_role_ids', '[]'::jsonb
    ),
    jsonb_build_object(
      'event_kind', 'role_brief',
      'payload', '{"secret":true}'::jsonb,
      'visibility', 'private',
      'visible_to_player_ids', '[]'::jsonb,
      'visible_to_role_ids', jsonb_build_array('werewolf')
    )
  );
$$;

create function pg_temp.test_start_game(
  p_account_id bigint,
  p_expected_player_ids bigint[],
  p_events jsonb,
  p_resolved_role_setup jsonb default pg_temp.test_resolved_role_setup(),
  p_options jsonb default pg_temp.test_options(),
  p_actions jsonb default pg_temp.test_night_actions()
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language sql
as $$
  select started.*
  from pg_temp.test_game_fixture as fixture
  cross join lateral public.app_start_room(
    p_account_id,
    fixture.room_code,
    p_expected_player_ids,
    fixture.night_phase_instance_id,
    fixture.night_phase_ends_at,
    '{"villager":2,"werewolf":1}'::jsonb,
    p_options,
    p_resolved_role_setup,
    'test-roles-v1',
    'test-engine-v1',
    pg_temp.test_assignments(),
    p_actions,
    p_events
  ) as started;
$$;

select is(
  (
    select count(*)
    from test_game_accounts
    where player_id is not null
      and public_player_id is not null
  ),
  3::bigint,
  'the game fixture uses three stable joined players'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'guest'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events()
    )
  $$,
  'P0001',
  'host_required',
  'only the joined host can start the room'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      (pg_temp.test_player_ids())[1:2],
      pg_temp.test_start_events()
    )
  $$,
  'P0001',
  'room_players_changed',
  'game start requires an exact current roster'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      jsonb_build_array(
        jsonb_build_object(
          'event_kind', 'invalid_public_event',
          'payload', '{}'::jsonb,
          'visibility', 'public',
          'visible_to_player_ids', jsonb_build_array(
            (select player_id from test_game_accounts where label = 'host')
          ),
          'visible_to_role_ids', '[]'::jsonb
        )
      )
    )
  $$,
  'P0001',
  'invalid_events',
  'strict event validation rejects a public event with private recipients'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      jsonb_set(
        pg_temp.test_resolved_role_setup(),
        '{nightConversationGroups}',
        jsonb_build_array(
          jsonb_build_object(
            'groupId', 'wolves_primary',
            'label', jsonb_build_object('en', 'Primary', 'ja', '第一'),
            'roleIds', jsonb_build_array('werewolf')
          ),
          jsonb_build_object(
            'groupId', 'wolves_secondary',
            'label', jsonb_build_object('en', 'Secondary', 'ja', '第二'),
            'roleIds', jsonb_build_array('werewolf')
          )
        )
      )
    )
  $$,
  'P0001',
  'invalid_resolved_role_setup',
  'a role cannot belong to more than one night conversation group'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      jsonb_set(
        pg_temp.test_resolved_role_setup(),
        '{contributions,0,judgement,sourceRoleId}',
        '"unknown_role"'::jsonb
      )
    )
  $$,
  'P0001',
  'invalid_resolved_role_setup',
  'winner judgements must be owned by an active role'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      jsonb_set(
        pg_temp.test_resolved_role_setup(),
        '{contributions}',
        (pg_temp.test_resolved_role_setup() -> 'contributions')
          || (pg_temp.test_resolved_role_setup() -> 'contributions' -> 0)
      )
    )
  $$,
  'P0001',
  'invalid_resolved_role_setup',
  'winner judgement identifiers are unique within one source role'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      jsonb_build_array(
        jsonb_build_object(
          'event_kind', 'invalid_public_event',
          'payload', '{}'::jsonb,
          'visibility', 'public',
          'visible_to_player_ids', jsonb_build_array(
            (select player_id from test_game_accounts where label = 'host')
          ),
          'visible_to_role_ids', '[]'::jsonb
        )
      ),
      jsonb_set(
        jsonb_set(
          pg_temp.test_resolved_role_setup(),
          '{contributions,1,judgement,id}',
          '"werewolves_eliminated"'::jsonb
        ),
        '{contributions,1,judgement,sourceRoleId}',
        '"villager"'::jsonb
      )
    )
  $$,
  'P0001',
  'invalid_events',
  'different source roles may contribute the same judgement identifier'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      jsonb_build_array(
        jsonb_build_object(
          'event_kind', 'departed_private_event',
          'payload', '{}'::jsonb,
          'visibility', 'private',
          'visible_to_player_ids', jsonb_build_array(
            (
              select players.id
              from public.players as players
              where players.room_id = (select room_id from test_game_fixture)
                and players.account_id = (select account_id from test_departed_game_account)
            )
          ),
          'visible_to_role_ids', '[]'::jsonb
        )
      )
    )
  $$,
  'P0001',
  'invalid_events',
  'private event audiences must belong to the fixed game roster'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      pg_temp.test_resolved_role_setup(),
      pg_temp.test_options(),
      jsonb_set(
        pg_temp.test_night_actions(),
        '{0,eligible_target_player_ids}',
        (pg_temp.test_night_actions() -> 0 -> 'eligible_target_player_ids')
          || jsonb_build_array(
            (
              select players.id
              from public.players as players
              where players.room_id = (select room_id from test_game_fixture)
                and players.account_id = (select account_id from test_departed_game_account)
            )
          )
      )
    )
  $$,
  'P0001',
  'invalid_actions',
  'action targets must belong to the fixed game roster'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      pg_temp.test_resolved_role_setup(),
      jsonb_set(pg_temp.test_options(), '{nightSeconds}', '601'::jsonb)
    )
  $$,
  'P0001',
  'invalid_options',
  'game start rejects core options outside the shared supported range'
);

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events(),
      pg_temp.test_resolved_role_setup(),
      jsonb_set(
        pg_temp.test_options(),
        '{roleOptions,seer,initial_inspection}',
        '123'::jsonb
      )
    )
  $$,
  'P0001',
  'invalid_options',
  'game start rejects malformed opaque role option values'
);

select is(
  (
    select row(
      rooms.status,
      (select count(*) from public.game_states where room_id = rooms.id),
      (select count(*) from public.role_assignments where room_id = rooms.id),
      (select count(*) from public.current_actions where room_id = rooms.id)
    )::text
    from public.rooms as rooms
    where rooms.id = (select room_id from test_game_fixture)
  ),
  '(waiting,0,0,0)',
  'a rejected game start rolls back every partial write'
);

insert into test_game_calls
select 'game_start', started.*
from pg_temp.test_start_game(
  (select account_id from test_game_accounts where label = 'host'),
  pg_temp.test_player_ids(),
  pg_temp.test_start_events()
) as started;

select is(
  (select notification_reason from test_game_calls where label = 'game_start'),
  'game_started',
  'valid game start reports game_started'
);

select is(
  (
    select row(
      rooms.status,
      states.status,
      states.phase,
      states.day_number,
      states.night_number,
      states.revision,
      states.action_revision
    )::text
    from public.rooms as rooms
    join public.game_states as states on states.room_id = rooms.id
    where rooms.id = (select room_id from test_game_fixture)
  ),
  '(playing,playing,night,0,1,1,0)',
  'game start persists one coherent initial game state'
);

select ok(
  exists (
    select 1
    from public.game_rule_sets
    where room_id = (select room_id from test_game_fixture)
      and role_registry_version = 'test-roles-v1'
      and engine_version = 'test-engine-v1'
      and role_counts = '{"villager":2,"werewolf":1}'::jsonb
  ),
  'game start snapshots the engine, registry, and role counts'
);

select is(
  (
    select row(
      (select count(*) from public.role_assignments where room_id = fixture.room_id),
      (select count(*) from public.game_player_states where room_id = fixture.room_id),
      (
        select count(*)
        from public.game_player_states
        where room_id = fixture.room_id and alive
      )
    )::text
    from test_game_fixture as fixture
  ),
  '(3,3,3)',
  'assignments and alive state cover the exact game roster'
);

select is(
  (
    select row(
      jsonb_array_length(snapshots.snapshot -> 'players'),
      (
        select count(*)
        from public.players
        where room_id = (select room_id from test_game_fixture)
      )
    )::text
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_fixture),
      null
    ) as snapshots
  ),
  '(3,4)',
  'a started-game snapshot excludes players who left before the fixed roster'
);

select is(
  (
    select count(*)
    from public.realtime_topics
    where room_id = (select room_id from test_game_fixture)
      and scope = 'role_private'
  ),
  2::bigint,
  'game start provisions one private topic per assigned role'
);

select is(
  (
    select row(
      actions.action_key,
      actions.resolver_role_id,
      actions.actor_role_id,
      actions.target_kind,
      count(eligible.player_id)
    )::text
    from public.current_actions as actions
    left join public.current_action_eligible_players as eligible
      on eligible.room_id = actions.room_id
     and eligible.current_action_id = actions.id
    where actions.room_id = (select room_id from test_game_fixture)
    group by actions.id
  ),
  '(werewolf:attack,werewolf,werewolf,single_player,2)',
  'the initial action window persists its resolver, actor, and eligible targets'
);

select is(
  (
    select array_agg(action_keys.key order by action_keys.key)
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_fixture),
      null
    ) as snapshots
    cross join lateral jsonb_object_keys(
      snapshots.snapshot -> 'currentActions' -> 0
    ) as action_keys(key)
  ),
  array[
    'action_key',
    'action_kind',
    'actor_player_id',
    'actor_role_id',
    'actor_state_requirement',
    'closes_at',
    'created_at',
    'eligible_target_player_ids',
    'id',
    'phase_instance_id',
    'resolver_role_id',
    'target_kind',
    'target_state_requirement'
  ]::text[],
  'room snapshots expose the exact current action key set'
);

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        (pg_temp.test_night_actions() -> 0) - 'resolver_role_id'
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an action must include its resolver role key even when the value is null'
);

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        (pg_temp.test_night_actions() -> 0)
          || jsonb_build_object('unexpected_key', true)
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an action rejects keys outside its exact nine-key contract'
);

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_set(
          pg_temp.test_night_actions() -> 0,
          '{resolver_role_id}',
          to_jsonb('Invalid Role'::text)
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an action rejects a malformed resolver role identifier'
);

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_set(
          pg_temp.test_night_actions() -> 0,
          '{resolver_role_id}',
          to_jsonb('unknown_role'::text)
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an action rejects an unassigned resolver role'
);

update public.role_assignments as assignments
set role_id = 'inactive_role'
where assignments.room_id = (select room_id from test_game_fixture)
  and assignments.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_set(
          pg_temp.test_night_actions() -> 0,
          '{resolver_role_id}',
          to_jsonb('inactive_role'::text)
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an action rejects an assigned resolver excluded from the active role setup'
);

update public.role_assignments as assignments
set role_id = 'villager'
where assignments.room_id = (select room_id from test_game_fixture)
  and assignments.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

select lives_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_build_object(
          'action_key', 'synthetic:cross-role',
          'action_kind', 'synthetic_action',
          'resolver_role_id', 'werewolf',
          'actor_player_id', (
            select player_id
            from test_game_accounts
            where label = 'guest'
          ),
          'actor_role_id', 'villager',
          'actor_state_requirement', 'alive',
          'target_state_requirement', 'assigned',
          'eligible_target_player_ids', '[]'::jsonb,
          'target_kind', 'none'
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'an assigned active resolver may differ from the action actor role'
);

delete from public.current_actions
where room_id = (select room_id from test_game_fixture)
  and action_key = 'synthetic:cross-role';

update public.game_player_states as player_states
set alive = false
where player_states.room_id = (select room_id from test_game_fixture)
  and player_states.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

select throws_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_build_object(
          'action_key', 'synthetic:dead-target',
          'action_kind', 'synthetic_action',
          'resolver_role_id', 'werewolf',
          'actor_player_id', (
            select player_id
            from test_game_accounts
            where label = 'host'
          ),
          'actor_role_id', 'werewolf',
          'actor_state_requirement', 'alive',
          'target_state_requirement', 'alive',
          'eligible_target_player_ids', jsonb_build_array(
            (
              select player_id
              from test_game_accounts
              where label = 'third'
            )
          ),
          'target_kind', 'single_player'
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'P0001',
  'invalid_actions',
  'an alive-target action cannot open with a dead eligible player'
);

select lives_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_build_object(
          'action_key', 'synthetic:assigned-target',
          'action_kind', 'synthetic_action',
          'resolver_role_id', 'werewolf',
          'actor_player_id', (
            select player_id
            from test_game_accounts
            where label = 'host'
          ),
          'actor_role_id', 'werewolf',
          'actor_state_requirement', 'alive',
          'target_state_requirement', 'assigned',
          'eligible_target_player_ids', jsonb_build_array(
            (
              select player_id
              from test_game_accounts
              where label = 'third'
            )
          ),
          'target_kind', 'single_player'
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'an assigned-target action may retain a dead player in its eligibility set'
);

update public.game_player_states as player_states
set alive = true
where player_states.room_id = (select room_id from test_game_fixture)
  and player_states.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

select lives_ok(
  $$
    select private.insert_current_actions(
      fixture.room_id,
      fixture.night_phase_instance_id,
      fixture.night_phase_ends_at,
      jsonb_build_array(
        jsonb_build_object(
          'action_key', 'synthetic:alive-race',
          'action_kind', 'synthetic_action',
          'resolver_role_id', 'werewolf',
          'actor_player_id', (
            select player_id
            from test_game_accounts
            where label = 'host'
          ),
          'actor_role_id', 'werewolf',
          'actor_state_requirement', 'alive',
          'target_state_requirement', 'alive',
          'eligible_target_player_ids', jsonb_build_array(
            (
              select player_id
              from test_game_accounts
              where label = 'third'
            )
          ),
          'target_kind', 'single_player'
        )
      )
    )
    from test_game_fixture as fixture
  $$,
  'an alive-target action opens while its eligible target is alive'
);

update public.game_player_states as player_states
set alive = false
where player_states.room_id = (select room_id from test_game_fixture)
  and player_states.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

select throws_ok(
  $$
    select *
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_game_fixture),
      'synthetic:alive-race',
      (select night_phase_instance_id from test_game_fixture),
      1,
      (select public_player_id from test_game_accounts where label = 'third')
    )
  $$,
  'P0001',
  'invalid_action_target',
  'an alive-target action rechecks target liveness when submitted'
);

update public.game_player_states as player_states
set alive = true
where player_states.room_id = (select room_id from test_game_fixture)
  and player_states.player_id = (
    select player_id
    from test_game_accounts
    where label = 'third'
  );

delete from public.current_actions
where room_id = (select room_id from test_game_fixture)
  and action_key in (
    'synthetic:dead-target',
    'synthetic:assigned-target',
    'synthetic:alive-race'
  );

select is(
  (
    select row(
      count(*) filter (where events.visibility = 'public'),
      count(*) filter (where events.visibility = 'private'),
      count(visible_roles.role_id)
    )::text
    from public.game_events as events
    left join public.game_event_visible_roles as visible_roles
      on visible_roles.room_id = events.room_id
     and visible_roles.game_event_id = events.id
    where events.room_id = (select room_id from test_game_fixture)
  ),
  '(1,1,1)',
  'initial public and role-private events retain explicit visibility'
);

insert into public.resolved_actions (
  room_id,
  phase_instance_id,
  phase,
  action_key,
  action_kind,
  resolver_role_id,
  actor_player_id,
  resolution_status,
  target_player_id,
  resolved_at
)
select
  fixture.room_id,
  fixture.night_phase_instance_id,
  'night',
  'history-probe:' || sequence_number,
  'history_probe',
  'villager',
  (select player_id from test_game_accounts where label = 'guest'),
  'submitted',
  null,
  statement_timestamp()
from test_game_fixture as fixture
cross join generate_series(1, 252) as sequences(sequence_number)
order by sequence_number;

select is(
  (
    select jsonb_array_length(snapshots.snapshot -> 'resolvedActions')
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_fixture),
      null,
      false
    ) as snapshots
  ),
  0,
  'ordinary runtime snapshots omit engine-only action history'
);

select is(
  (
    select row(
      jsonb_array_length(snapshots.snapshot -> 'resolvedActions'),
      snapshots.snapshot -> 'resolvedActions' -> 0 ->> 'action_key',
      snapshots.snapshot -> 'resolvedActions' -> 251 ->> 'action_key',
      snapshots.snapshot -> 'resolvedActions' -> 0 ->> 'day_number',
      snapshots.snapshot -> 'resolvedActions' -> 0 ->> 'night_number',
      (
        select bool_and(
          split_part(events.value ->> 'action_key', ':', 2)::integer
            = events.ordinality
        )
        from jsonb_array_elements(
          snapshots.snapshot -> 'resolvedActions'
        ) with ordinality as events(value, ordinality)
      )
    )::text
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_fixture),
      null,
      true
    ) as snapshots
  ),
  '(252,history-probe:1,history-probe:252,0,1,t)',
  'resolved action snapshots retain complete history, phase counters, and deterministic order'
);

delete from public.resolved_actions
where room_id = (select room_id from test_game_fixture)
  and action_kind = 'history_probe';

select throws_ok(
  $$
    select *
    from pg_temp.test_start_game(
      (select account_id from test_game_accounts where label = 'host'),
      pg_temp.test_player_ids(),
      pg_temp.test_start_events()
    )
  $$,
  'P0001',
  'room_not_joinable',
  'a playing room cannot be started again'
);

select throws_ok(
  $$
    select *
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'guest'),
      (select room_code from test_game_fixture),
      'werewolf:attack',
      (select night_phase_instance_id from test_game_fixture),
      1,
      (select public_player_id from test_game_accounts where label = 'third')
    )
  $$,
  'P0001',
  'action_not_allowed',
  'an action is limited to its declared role actor'
);

select throws_ok(
  $$
    select *
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_game_fixture),
      'werewolf:attack',
      gen_random_uuid(),
      1,
      (select public_player_id from test_game_accounts where label = 'guest')
    )
  $$,
  'P0001',
  'stale_phase',
  'an action cannot submit against a stale phase identity'
);

select throws_ok(
  $$
    select *
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_game_fixture),
      'werewolf:attack',
      (select night_phase_instance_id from test_game_fixture),
      1,
      (select public_player_id from test_game_accounts where label = 'host')
    )
  $$,
  'P0001',
  'invalid_action_target',
  'an action target must be in the persisted eligibility set'
);

insert into test_game_calls
select 'night_action', submitted.*
from public.app_submit_action(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_code from test_game_fixture),
  'werewolf:attack',
  (select night_phase_instance_id from test_game_fixture),
  1,
  (select public_player_id from test_game_accounts where label = 'guest')
) as submitted;

select is(
  (select notification_reason from test_game_calls where label = 'night_action'),
  'action_window_changed',
  'the first valid action submission mutates the action window'
);

select is(
  (
    select row(pending.submitter_player_id, pending.target_player_id)::text
    from public.pending_actions as pending
    where pending.room_id = (select room_id from test_game_fixture)
  ),
  (
    select row(
      (select player_id from test_game_accounts where label = 'host'),
      (select player_id from test_game_accounts where label = 'guest')
    )::text
  ),
  'accepted action persists its submitter and target'
);

select is(
  (
    select row(states.action_revision, rooms.snapshot_revision)::text
    from public.game_states as states
    join public.rooms as rooms on rooms.id = states.room_id
    where states.room_id = (select room_id from test_game_fixture)
  ),
  '(1,6)',
  'accepted action increments action and snapshot revisions once'
);

select is(
  (
    select events.payload
    from public.game_events as events
    join public.game_event_visible_players as visible
      on visible.room_id = events.room_id
     and visible.game_event_id = events.id
    where events.room_id = (select room_id from test_game_fixture)
      and events.event_kind = 'action_submitted'
      and events.visibility = 'private'
      and visible.player_id = (select player_id from test_game_accounts where label = 'host')
  ),
  jsonb_build_object(
    'actionKey', 'werewolf:attack',
    'kind', 'attack'
  ),
  'accepted action creates a submitter-private receipt with its opaque kind'
);

select is(
  (
    select notification_reason
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_game_fixture),
      'werewolf:attack',
      (select night_phase_instance_id from test_game_fixture),
      1,
      (select public_player_id from test_game_accounts where label = 'guest')
    )
  ),
  null::text,
  'replaying an already accepted action is an idempotent no-op'
);

select is(
  (
    select row(
      states.action_revision,
      rooms.snapshot_revision,
      count(pending.current_action_id)
    )::text
    from public.game_states as states
    join public.rooms as rooms on rooms.id = states.room_id
    left join public.pending_actions as pending on pending.room_id = states.room_id
    where states.room_id = (select room_id from test_game_fixture)
    group by states.room_id, states.action_revision, rooms.snapshot_revision
  ),
  '(1,6,1)',
  'idempotent replay does not advance revisions or duplicate pending state'
);

select throws_ok(
  $$
    select *
    from public.app_send_night_conversation_message(
      (select account_id from test_game_accounts where label = 'guest'),
      (select room_code from test_game_fixture),
      (select night_phase_instance_id from test_game_fixture),
      1,
      'wolves',
      'not allowed'
    )
  $$,
  'P0001',
  'night_message_not_allowed',
  'a role outside the conversation group cannot send messages'
);

insert into test_game_calls
select 'night_message', sent.*
from public.app_send_night_conversation_message(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_code from test_game_fixture),
  (select night_phase_instance_id from test_game_fixture),
  1,
  'wolves',
  '  hunt tonight  '
) as sent;

select is(
  (select notification_reason from test_game_calls where label = 'night_message'),
  'private_view_changed',
  'an eligible night message reports a private view change'
);

select is(
  (
    select body
    from public.night_conversation_messages
    where room_id = (select room_id from test_game_fixture)
  ),
  'hunt tonight',
  'night messages are trimmed before persistence'
);

select is(
  (
    select jsonb_array_length(snapshots.snapshot -> 'nightConversationMessages')
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_fixture),
      null
    ) as snapshots
  ),
  1,
  'an eligible viewer snapshot includes its night conversation'
);

select is(
  (
    select row(
      jsonb_array_length(snapshots.snapshot -> 'privateEvents'),
      jsonb_array_length(snapshots.snapshot -> 'nightConversationMessages')
    )::text
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'guest'),
      (select room_id from test_game_fixture),
      null
    ) as snapshots
  ),
  '(0,0)',
  'a different role snapshot cannot read private receipts or conversation'
);

select is(
  (
    select notification_reason
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select night_phase_instance_id from test_game_fixture),
      1,
      0,
      jsonb_build_array(
        jsonb_build_object(
          'player_id', (select player_id from test_game_accounts where label = 'host'),
          'reason', 'rule_effect'
        )
      ),
      null,
      '[]'::jsonb,
      'day',
      (select day_phase_instance_id from test_game_fixture),
      (select day_phase_ends_at from test_game_fixture),
      1,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'event_kind', 'stale_resolution_attempt',
          'payload', '{}'::jsonb,
          'visibility', 'public',
          'visible_to_player_ids', '[]'::jsonb,
          'visible_to_role_ids', '[]'::jsonb
        )
      )
    )
  ),
  null::text,
  'a stale action revision makes phase resolution an idempotent no-op'
);

select throws_ok(
  $$
    select *
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select night_phase_instance_id from test_game_fixture),
      1,
      1,
      '[]'::jsonb,
      null,
      '[]'::jsonb,
      'day',
      gen_random_uuid(),
      (select day_phase_ends_at from test_game_fixture),
      99,
      99,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'invalid_next_phase',
  'phase resolution cannot jump counters or skip the transition graph'
);

select throws_ok(
  $$
    select *
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select night_phase_instance_id from test_game_fixture),
      1,
      1,
      '[]'::jsonb,
      null,
      '[]'::jsonb,
      'night',
      gen_random_uuid(),
      (select night_phase_ends_at from test_game_fixture),
      0,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'invalid_next_phase',
  'a same-phase continuation must persist at least one action'
);

insert into test_game_calls
select 'night_resolve', resolved.*
from public.app_resolve_phase(
  (select room_id from test_game_fixture),
  (select night_phase_instance_id from test_game_fixture),
  1,
  1,
  jsonb_build_array(
    jsonb_build_object(
      'player_id', (select player_id from test_game_accounts where label = 'third'),
      'reason', 'future_collapse'
    )
  ),
  null,
  '[]'::jsonb,
  'day',
  (select day_phase_instance_id from test_game_fixture),
  (select day_phase_ends_at from test_game_fixture),
  1,
  1,
  jsonb_build_array(
    jsonb_build_object(
      'action_key', 'day:ready',
      'action_kind', 'ready',
      'resolver_role_id', null,
      'actor_player_id', (select player_id from test_game_accounts where label = 'guest'),
      'actor_role_id', null,
      'actor_state_requirement', 'alive',
      'target_state_requirement', 'assigned',
      'eligible_target_player_ids', '[]'::jsonb,
      'target_kind', 'none'
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'slot_index', 0,
      'speaker_player_id', (select player_id from test_game_accounts where label = 'host')
    ),
    jsonb_build_object(
      'slot_index', 1,
      'speaker_player_id', (select player_id from test_game_accounts where label = 'guest')
    ),
    jsonb_build_object(
      'slot_index', 2,
      'speaker_player_id', (select player_id from test_game_accounts where label = 'third')
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'event_kind', 'night_resolved',
      'payload', '{}'::jsonb,
      'visibility', 'public',
      'visible_to_player_ids', '[]'::jsonb,
      'visible_to_role_ids', '[]'::jsonb
    )
  )
) as resolved;

select is(
  (select notification_reason from test_game_calls where label = 'night_resolve'),
  'phase_changed',
  'valid night resolution advances to the next phase'
);

select is(
  (
    select row(phase, day_number, night_number, revision, action_revision)::text
    from public.game_states
    where room_id = (select room_id from test_game_fixture)
  ),
  '(day,1,1,2,0)',
  'phase resolution atomically installs the next phase revision'
);

select is(
  (
    select pg_catalog.array_agg(
      row(phase, ended_at is null)::text
      order by started_at, id
    )::text
    from public.game_phase_instances
    where room_id = (select room_id from test_game_fixture)
  ),
  '{"(night,f)","(day,t)"}',
  'phase resolution closes the old phase and preserves the open replacement'
);

select is(
  (
    select alive
    from public.game_player_states
    where room_id = (select room_id from test_game_fixture)
      and player_id = (select player_id from test_game_accounts where label = 'third')
  ),
  false,
  'phase resolution applies each declared death once'
);

select is(
  (
    select row(
      actions.phase,
      actions.action_key,
      actions.action_kind,
      actions.resolver_role_id,
      actions.resolution_status,
      actions.actor_player_id,
      actions.target_player_id
    )::text
    from public.resolved_actions as actions
    where actions.room_id = (select room_id from test_game_fixture)
  ),
  (
    select row(
      'night',
      'werewolf:attack',
      'attack',
      'werewolf',
      'submitted',
      (select player_id from test_game_accounts where label = 'host'),
      (select player_id from test_game_accounts where label = 'guest')
    )::text
  ),
  'phase resolution derives typed role action history from accepted pending state'
);

select is(
  (
    select row(
      (select count(*) from public.current_actions where room_id = fixture.room_id),
      (select count(*) from public.pending_actions where room_id = fixture.room_id),
      (select count(*) from public.day_speech_slots where room_id = fixture.room_id)
    )::text
    from test_game_fixture as fixture
  ),
  '(1,0,3)',
  'phase resolution preserves the complete speech order, including dead future slots'
);

insert into test_game_calls
select 'day_action', submitted.*
from public.app_submit_action(
  (select account_id from test_game_accounts where label = 'guest'),
  (select room_code from test_game_fixture),
  'day:ready',
  (select day_phase_instance_id from test_game_fixture),
  2,
  null
) as submitted;

select is(
  (select notification_reason from test_game_calls where label = 'day_action'),
  'action_window_changed',
  'the replacement action window accepts its declared player actor'
);

select throws_ok(
  $$
    select *
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select day_phase_instance_id from test_game_fixture),
      2,
      1,
      '[]'::jsonb,
      '{"winner_team":"unregistered_future_team"}'::jsonb,
      (
        select jsonb_agg(
          jsonb_build_object(
            'player_id', player_id,
            'result', 'special'
          )
        )
        from test_game_accounts
      ),
      null,
      null,
      null,
      1,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'invalid_final_outcome',
  'final outcomes must use a team declared by a persisted winner judgement'
);

select throws_ok(
  $$
    select *
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select day_phase_instance_id from test_game_fixture),
      2,
      1,
      jsonb_build_array(
        jsonb_build_object(
          'player_id', (select player_id from test_game_accounts where label = 'host'),
          'reason', 'rule_effect'
        )
      ),
      '{"winner_team":"village"}'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'player_id', (select player_id from test_game_accounts where label = 'host'),
          'result', 'lose'
        )
      ),
      null,
      null,
      null,
      1,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'event_kind', 'invalid_results_attempt',
          'payload', '{}'::jsonb,
          'visibility', 'public',
          'visible_to_player_ids', '[]'::jsonb,
          'visible_to_role_ids', '[]'::jsonb
        )
      )
    )
  $$,
  'P0001',
  'invalid_player_results',
  'final resolution requires results for the exact game roster'
);

select is(
  (
    select row(
      states.status,
      states.action_revision,
      (
        select alive
        from public.game_player_states
        where room_id = states.room_id
          and player_id = (select player_id from test_game_accounts where label = 'host')
      ),
      (select count(*) from public.final_outcomes where room_id = states.room_id),
      (select count(*) from public.pending_actions where room_id = states.room_id),
      (
        select count(*)
        from public.game_events
        where room_id = states.room_id
          and event_kind = 'invalid_results_attempt'
      )
    )::text
    from public.game_states as states
    where states.room_id = (select room_id from test_game_fixture)
  ),
  '(playing,1,t,0,1,0)',
  'a rejected final resolution rolls back events and game mutations'
);

insert into test_game_calls
select 'game_end', resolved.*
from public.app_resolve_phase(
  (select room_id from test_game_fixture),
  (select day_phase_instance_id from test_game_fixture),
  2,
  1,
  '[]'::jsonb,
  '{"winner_team":"village"}'::jsonb,
  (
    select jsonb_agg(
      jsonb_build_object(
        'player_id', player_id,
        'result', case when role_id = 'werewolf' then 'lose' else 'win' end
      )
    )
    from test_game_accounts
  ),
  null,
  null,
  null,
  1,
  1,
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'event_kind', 'game_finished',
      'payload', '{}'::jsonb,
      'visibility', 'public',
      'visible_to_player_ids', '[]'::jsonb,
      'visible_to_role_ids', '[]'::jsonb
    )
  )
) as resolved;

select is(
  (select notification_reason from test_game_calls where label = 'game_end'),
  'game_ended',
  'valid final resolution reports game end'
);

select is(
  (
    select row(
      rooms.status,
      states.status,
      states.phase,
      states.revision,
      states.action_revision
    )::text
    from public.rooms as rooms
    join public.game_states as states on states.room_id = rooms.id
    where rooms.id = (select room_id from test_game_fixture)
  ),
  '(ended,ended,,3,0)',
  'game end settles room and game lifecycle in one transaction'
);

select is(
  (
    select count(*)
    from public.game_phase_instances
    where room_id = (select room_id from test_game_fixture)
      and ended_at is null
  ),
  0::bigint,
  'game end closes the last persisted phase instance'
);

select is(
  (
    select row(
      outcomes.winner_team,
      count(results.player_id)
    )::text
    from public.final_outcomes as outcomes
    join public.player_results as results on results.room_id = outcomes.room_id
    where outcomes.room_id = (select room_id from test_game_fixture)
    group by outcomes.room_id, outcomes.winner_team
  ),
  '(village,3)',
  'final outcome and exact player results persist together'
);

select is(
  (
    select row(
      (select count(*) from public.current_actions where room_id = fixture.room_id),
      (select count(*) from public.pending_actions where room_id = fixture.room_id),
      (select count(*) from public.day_speech_slots where room_id = fixture.room_id)
    )::text
    from test_game_fixture as fixture
  ),
  '(0,0,0)',
  'game end removes every transient action and speech row'
);

select is(
  (
    select notification_reason
    from public.app_resolve_phase(
      (select room_id from test_game_fixture),
      (select day_phase_instance_id from test_game_fixture),
      2,
      1,
      '[]'::jsonb,
      '{"winner_team":"village"}'::jsonb,
      (
        select jsonb_agg(
          jsonb_build_object(
            'player_id', player_id,
            'result', case when role_id = 'werewolf' then 'lose' else 'win' end
          )
        )
        from test_game_accounts
      ),
      null,
      null,
      null,
      1,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
  ),
  null::text,
  'replaying resolution after game end is an idempotent no-op'
);

create temporary table test_collision_account as
select created.account_id
from public.app_create_identity(repeat('p', 43), 'test-key') as created;

create temporary table test_collision_room (
  room_id bigint primary key,
  room_code text not null
);

with created_room as (
  insert into public.rooms (
    public_room_code,
    host_account_id,
    target_player_count,
    waiting_expires_at
  )
  values (
    (select room_code from test_game_fixture),
    (select account_id from test_collision_account),
    3,
    statement_timestamp() + interval '1 hour'
  )
  returning id, public_room_code
)
insert into test_collision_room
select id, public_room_code
from created_room;

insert into public.players (
  room_id,
  account_id,
  public_player_id,
  display_name
)
select
  room_id,
  (select account_id from test_collision_account),
  'pl_' || repeat('t', 24),
  'New game host'
from test_collision_room;

select throws_ok(
  $$
    select *
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_collision_room),
      'day:ready',
      (select day_phase_instance_id from test_game_fixture),
      2,
      (select public_player_id from test_game_accounts where label = 'guest')
    )
  $$,
  'P0001',
  'stale_phase',
  'account-bound game RPCs prefer the caller ended-room membership over a reused active code'
);

select is(
  (
    select host_account_id
    from public.rooms
    where id = (select room_id from test_game_fixture)
  ),
  (select account_id from test_game_accounts where label = 'host'),
  'the ended game initially retains its original host'
);

insert into test_game_calls
select 'ended_host_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_code from test_game_fixture)
) as left_room;

select is(
  (
    select host_account_id
    from public.rooms
    where id = (select room_id from test_game_fixture)
  ),
  (select account_id from test_game_accounts where label = 'guest'),
  'an ended-room host transfers ownership to the oldest remaining player'
);

insert into test_game_calls
select 'ended_guest_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_game_accounts where label = 'guest'),
  (select room_code from test_game_fixture)
) as left_room;

select is(
  (
    select host_account_id
    from public.rooms
    where id = (select room_id from test_game_fixture)
  ),
  (select account_id from test_game_accounts where label = 'third'),
  'subsequent ended-room host departure transfers ownership again'
);

insert into test_game_calls
select 'ended_third_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_game_accounts where label = 'third'),
  (select room_code from test_game_fixture)
) as left_room;

select is(
  (
    select host_account_id
    from public.rooms
    where id = (select room_id from test_game_fixture)
  ),
  (select account_id from test_game_accounts where label = 'third'),
  'the last ended-room departure retains the final host reference'
);

create temporary table test_post_death_room_create as
select created.*
from public.app_create_room(
  (select account_id from test_game_accounts where label = 'host'),
  'Post-death host',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_game_calls
select
  'post_death_guest_join',
  joined.room_id,
  joined.actor_player_id,
  joined.notification_reason
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'guest'),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (select room_id from test_post_death_room_create)
  ),
  'Post-death guest'
) as joined
where joined.result_kind = 'target';

insert into test_game_calls
select
  'post_death_third_join',
  joined.room_id,
  joined.actor_player_id,
  joined.notification_reason
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'third'),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (select room_id from test_post_death_room_create)
  ),
  'Post-death third'
) as joined
where joined.result_kind = 'target';

create temporary table test_post_death_fixture as
select
  rooms.id as room_id,
  rooms.public_room_code as room_code,
  gen_random_uuid() as night_phase_instance_id,
  gen_random_uuid() as follow_up_phase_instance_id,
  statement_timestamp() + interval '1 hour' as night_phase_ends_at,
  statement_timestamp() + interval '2 hours' as follow_up_phase_ends_at
from public.rooms as rooms
where rooms.id = (select room_id from test_post_death_room_create);

insert into test_game_calls
select 'post_death_start', started.*
from test_post_death_fixture as fixture
cross join lateral public.app_start_room(
  (select account_id from test_game_accounts where label = 'host'),
  fixture.room_code,
  (
    select array_agg(players.id order by players.id)
    from public.players as players
    where players.room_id = fixture.room_id
      and players.left_at is null
  ),
  fixture.night_phase_instance_id,
  fixture.night_phase_ends_at,
  '{"avenger":1,"villager":1,"werewolf":1}'::jsonb,
  pg_temp.test_options(),
  jsonb_build_object(
    'activeRoleIds', jsonb_build_array('avenger', 'villager', 'werewolf'),
    'contributions', jsonb_build_array(
      jsonb_build_object(
        'kind', 'winner_judgement',
        'judgement', jsonb_build_object(
          'id', 'fixture_outcome',
          'priority', 0,
          'sourceRoleId', 'avenger',
          'winnerTeam', 'village'
        )
      )
    ),
    'nightConversationGroups', '[]'::jsonb
  ),
  'test-roles-v1',
  'test-engine-v1',
  (
    select jsonb_agg(
      jsonb_build_object(
        'player_id', players.id,
        'role_id', case accounts.label
          when 'host' then 'avenger'
          when 'guest' then 'villager'
          else 'werewolf'
        end
      )
      order by players.id
    )
    from public.players as players
    join test_game_accounts as accounts on accounts.account_id = players.account_id
    where players.room_id = fixture.room_id
      and players.left_at is null
  ),
  jsonb_build_array(
    jsonb_build_object(
      'action_key', 'missing-role-action:test',
      'action_kind', 'missing_role_action',
      'resolver_role_id', 'villager',
      'actor_player_id', null,
      'actor_role_id', 'villager',
      'actor_state_requirement', 'alive',
      'target_state_requirement', 'assigned',
      'eligible_target_player_ids', '[]'::jsonb,
      'target_kind', 'none'
    )
  ),
  '[]'::jsonb
) as started;

update public.game_phase_instances
set started_at = statement_timestamp() - interval '2 hours',
    ends_at = statement_timestamp() - interval '1 hour'
where room_id = (select room_id from test_post_death_fixture);

update public.game_states
set created_at = statement_timestamp() - interval '2 hours',
    phase_started_at = statement_timestamp() - interval '2 hours',
    phase_ends_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where room_id = (select room_id from test_post_death_fixture);

create temporary table test_post_death_resolution as
select resolved.*
from test_post_death_fixture as fixture
cross join lateral public.app_resolve_phase(
  fixture.room_id,
  fixture.night_phase_instance_id,
  1,
  0,
  jsonb_build_array(
    jsonb_build_object(
      'player_id', (
        select players.id
        from public.players as players
        where players.room_id = fixture.room_id
          and players.account_id = (select account_id from test_game_accounts where label = 'host')
      ),
      'reason', 'execution'
    )
  ),
  null,
  '[]'::jsonb,
  'night',
  fixture.follow_up_phase_instance_id,
  fixture.follow_up_phase_ends_at,
  0,
  1,
  jsonb_build_array(
    jsonb_build_object(
      'action_key', 'avenger-counterstrike:test',
      'action_kind', 'avenger_counterstrike',
      'resolver_role_id', 'avenger',
      'actor_player_id', (
        select players.id
        from public.players as players
        where players.room_id = fixture.room_id
          and players.account_id = (select account_id from test_game_accounts where label = 'host')
      ),
      'actor_role_id', 'avenger',
      'actor_state_requirement', 'assigned',
      'target_state_requirement', 'alive',
      'eligible_target_player_ids', (
        select jsonb_agg(players.id order by players.id)
        from public.players as players
        where players.room_id = fixture.room_id
          and players.account_id <> (select account_id from test_game_accounts where label = 'host')
          and players.left_at is null
      ),
      'target_kind', 'single_player'
    )
  ),
  '[]'::jsonb,
  '[]'::jsonb
) as resolved;

select is(
  (select notification_reason from test_post_death_resolution),
  'action_window_changed',
  'phase resolution persists a generic post-death action window'
);

select is(
  (
    select row(
      action_key,
      resolver_role_id,
      actor_player_id,
      actor_role_id,
      resolution_status,
      target_player_id
    )::text
    from public.resolved_actions
    where room_id = (select room_id from test_post_death_fixture)
  ),
  '(missing-role-action:test,villager,,villager,missing,)',
  'timed-out role actions persist as typed missing history'
);

select is(
  (
    select row(
      actions.resolver_role_id,
      actions.actor_role_id,
      actions.actor_state_requirement,
      states.alive
    )::text
    from public.current_actions as actions
    join public.game_player_states as states
      on states.room_id = actions.room_id
     and states.player_id = actions.actor_player_id
    where actions.room_id = (select room_id from test_post_death_fixture)
  ),
  '(avenger,avenger,assigned,f)',
  'the post-death action retains its resolver and assigned dead actor ownership'
);

create temporary table test_post_death_submission as
select submitted.*
from test_post_death_fixture as fixture
cross join lateral public.app_submit_action(
  (select account_id from test_game_accounts where label = 'host'),
  fixture.room_code,
  'avenger-counterstrike:test',
  fixture.follow_up_phase_instance_id,
  2,
  (
    select players.public_player_id
    from public.players as players
    where players.room_id = fixture.room_id
      and players.account_id = (select account_id from test_game_accounts where label = 'third')
  )
) as submitted;

select is(
  (select notification_reason from test_post_death_submission),
  'action_window_changed',
  'the assigned dead actor can submit its post-death action'
);

select is(
  (
    select row(
      pending.submitter_player_id,
      pending.target_player_id,
      states.action_revision
    )::text
    from public.pending_actions as pending
    join public.game_states as states on states.room_id = pending.room_id
    where pending.room_id = (select room_id from test_post_death_fixture)
  ),
  (
    select row(
      actor.id,
      target.id,
      1::bigint
    )::text
    from public.players as actor
    cross join public.players as target
    where actor.room_id = (select room_id from test_post_death_fixture)
      and actor.account_id = (select account_id from test_game_accounts where label = 'host')
      and target.room_id = actor.room_id
      and target.account_id = (select account_id from test_game_accounts where label = 'third')
  ),
  'the post-death submission persists its exact actor, target, and revision'
);

create temporary table test_private_revision_accounts (
  label text primary key,
  account_id bigint not null unique,
  player_id bigint,
  role_id text not null
);

insert into test_private_revision_accounts (label, account_id, role_id)
select identities.label, created.account_id, identities.role_id
from (
  values
    ('madman', 'madman', repeat('1', 43)),
    ('villager', 'villager', repeat('2', 43)),
    ('wolf_host', 'werewolf', repeat('3', 43)),
    ('wolf_peer', 'werewolf', repeat('4', 43))
) as identities(label, role_id, token_hash)
cross join lateral public.app_create_identity(
  identities.token_hash,
  'test-key'
) as created;

create temporary table test_private_revision_room_create as
select created.*
from public.app_create_room(
  (
    select account_id
    from test_private_revision_accounts
    where label = 'wolf_host'
  ),
  'Private revision host',
  4,
  statement_timestamp() + interval '1 hour'
) as created;

create temporary table test_private_revision_join_calls as
select accounts.label, joined.*
from test_private_revision_accounts as accounts
cross join lateral public.app_join_room(
  accounts.account_id,
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_private_revision_room_create
      where result_kind = 'target'
    )
  ),
  initcap(replace(accounts.label, '_', ' '))
) as joined
where accounts.label <> 'wolf_host';

update test_private_revision_accounts as accounts
set player_id = players.id
from public.players as players
where players.account_id = accounts.account_id
  and players.room_id = (
    select room_id
    from test_private_revision_room_create
    where result_kind = 'target'
  );

alter table test_private_revision_accounts
  alter column player_id set not null;

create temporary table test_private_revision_fixture as
select
  rooms.id as room_id,
  rooms.public_room_code as room_code,
  gen_random_uuid() as phase_instance_id,
  statement_timestamp() + interval '1 hour' as phase_ends_at
from public.rooms as rooms
where rooms.id = (
  select room_id
  from test_private_revision_room_create
  where result_kind = 'target'
);

create function pg_temp.test_private_resolved_role_setup()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'activeRoleIds', jsonb_build_array('madman', 'villager', 'werewolf'),
    'contributions', jsonb_build_array(
      jsonb_build_object(
        'kind', 'winner_judgement',
        'judgement', jsonb_build_object(
          'id', 'fixture_outcome',
          'priority', 0,
          'sourceRoleId', 'werewolf',
          'winnerTeam', 'werewolf'
        )
      )
    ),
    'nightConversationGroups', jsonb_build_array(
      jsonb_build_object(
        'groupId', 'allies',
        'label', jsonb_build_object('en', 'Allies', 'ja', '同盟'),
        'roleIds', jsonb_build_array('werewolf', 'madman')
      )
    )
  );
$$;

create function pg_temp.test_private_actions()
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'action_key', 'shared:vote',
      'action_kind', 'consensus',
      'resolver_role_id', 'werewolf',
      'actor_player_id', null,
      'actor_role_id', 'werewolf',
      'actor_state_requirement', 'alive',
      'target_state_requirement', 'assigned',
      'eligible_target_player_ids', '[]'::jsonb,
      'target_kind', 'none'
    ),
    jsonb_build_object(
      'action_key', 'personal:observe',
      'action_kind', 'observe',
      'resolver_role_id', 'madman',
      'actor_player_id', (
        select player_id
        from test_private_revision_accounts
        where label = 'madman'
      ),
      'actor_role_id', 'madman',
      'actor_state_requirement', 'alive',
      'target_state_requirement', 'assigned',
      'eligible_target_player_ids', '[]'::jsonb,
      'target_kind', 'none'
    )
  );
$$;

create temporary table test_private_revision_start as
select started.*
from test_private_revision_fixture as fixture
cross join lateral public.app_start_room(
  (
    select account_id
    from test_private_revision_accounts
    where label = 'wolf_host'
  ),
  fixture.room_code,
  (
    select array_agg(player_id order by player_id)
    from test_private_revision_accounts
  ),
  fixture.phase_instance_id,
  fixture.phase_ends_at,
  '{"madman":1,"villager":1,"werewolf":2}'::jsonb,
  pg_temp.test_options(),
  pg_temp.test_private_resolved_role_setup(),
  'test-roles-v1',
  'test-engine-v1',
  (
    select jsonb_agg(
      jsonb_build_object('player_id', player_id, 'role_id', role_id)
      order by player_id
    )
    from test_private_revision_accounts
  ),
  pg_temp.test_private_actions(),
  '[]'::jsonb
) as started;

update public.game_phase_instances
set day_number = 1,
    night_number = 2
where room_id = (select room_id from test_private_revision_fixture);

update public.game_states
set day_number = 1,
    night_number = 2,
    revision = 2,
    updated_at = statement_timestamp()
where room_id = (select room_id from test_private_revision_fixture);

create function pg_temp.test_private_snapshot_revision(p_label text)
returns bigint
language sql
stable
as $$
  select (snapshots.snapshot #>> '{room,snapshot_revision}')::bigint
  from test_private_revision_accounts as accounts
  cross join lateral public.app_read_room_runtime_snapshot(
    accounts.account_id,
    (select room_id from test_private_revision_fixture),
    null
  ) as snapshots
  where accounts.label = p_label;
$$;

create temporary table test_private_revision_baseline as
select label, pg_temp.test_private_snapshot_revision(label) as snapshot_revision
from test_private_revision_accounts;

create temporary table test_private_public_revision_baseline as
select snapshot_revision
from public.rooms
where id = (select room_id from test_private_revision_fixture);

create temporary table test_shared_private_submission as
select submitted.*
from test_private_revision_fixture as fixture
cross join lateral public.app_submit_action(
  (
    select account_id
    from test_private_revision_accounts
    where label = 'wolf_host'
  ),
  fixture.room_code,
  'shared:vote',
  fixture.phase_instance_id,
  2,
  null
) as submitted;

select is(
  (select notification_reason from test_shared_private_submission),
  'private_view_changed',
  'later-night shared action submission reports a private view change'
);

select results_eq(
  $$
    select
      baseline.label,
      pg_temp.test_private_snapshot_revision(baseline.label)
        - baseline.snapshot_revision as revision_delta
    from test_private_revision_baseline as baseline
    order by baseline.label
  $$,
  $$
    values
      ('madman'::text, 0::bigint),
      ('villager'::text, 0::bigint),
      ('wolf_host'::text, 2::bigint),
      ('wolf_peer'::text, 1::bigint)
  $$,
  'shared action revisions reach only the submitter and the shared role viewers'
);

select is(
  (
    select row(
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'player_private'
          and topics.player_id = (
            select player_id
            from test_private_revision_accounts
            where label = 'wolf_host'
          )
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'werewolf'
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'player_private'
          and topics.player_id = (
            select player_id
            from test_private_revision_accounts
            where label = 'wolf_peer'
          )
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'madman'
      )
    )::text
    from test_private_revision_fixture as fixture
  ),
  '(1,1,0,0)',
  'shared action increments the submitter player topic and its shared role topic once'
);

update test_private_revision_baseline as baseline
set snapshot_revision = pg_temp.test_private_snapshot_revision(baseline.label);

create temporary table test_personal_private_submission as
select submitted.*
from test_private_revision_fixture as fixture
cross join lateral public.app_submit_action(
  (
    select account_id
    from test_private_revision_accounts
    where label = 'madman'
  ),
  fixture.room_code,
  'personal:observe',
  fixture.phase_instance_id,
  2,
  null
) as submitted;

select is(
  (select notification_reason from test_personal_private_submission),
  'private_view_changed',
  'later-night personal action submission reports a private view change'
);

select results_eq(
  $$
    select
      baseline.label,
      pg_temp.test_private_snapshot_revision(baseline.label)
        - baseline.snapshot_revision as revision_delta
    from test_private_revision_baseline as baseline
    order by baseline.label
  $$,
  $$
    values
      ('madman'::text, 1::bigint),
      ('villager'::text, 0::bigint),
      ('wolf_host'::text, 0::bigint),
      ('wolf_peer'::text, 0::bigint)
  $$,
  'personal action revisions reach only the submitting viewer'
);

select is(
  (
    select row(
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'player_private'
          and topics.player_id = (
            select player_id
            from test_private_revision_accounts
            where label = 'madman'
          )
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'madman'
      )
    )::text
    from test_private_revision_fixture as fixture
  ),
  '(1,0)',
  'personal action increments no role-private topic'
);

update test_private_revision_baseline as baseline
set snapshot_revision = pg_temp.test_private_snapshot_revision(baseline.label);

create temporary table test_private_conversation_submission as
select sent.*
from test_private_revision_fixture as fixture
cross join lateral public.app_send_night_conversation_message(
  (
    select account_id
    from test_private_revision_accounts
    where label = 'wolf_host'
  ),
  fixture.room_code,
  fixture.phase_instance_id,
  2,
  'allies',
  'Coordinate privately'
) as sent;

select is(
  (select notification_reason from test_private_conversation_submission),
  'private_view_changed',
  'night conversation reports a private view change'
);

select results_eq(
  $$
    select
      baseline.label,
      pg_temp.test_private_snapshot_revision(baseline.label)
        - baseline.snapshot_revision as revision_delta
    from test_private_revision_baseline as baseline
    order by baseline.label
  $$,
  $$
    values
      ('madman'::text, 1::bigint),
      ('villager'::text, 0::bigint),
      ('wolf_host'::text, 1::bigint),
      ('wolf_peer'::text, 1::bigint)
  $$,
  'night conversation revisions reach every role in the group and no other viewer'
);

select is(
  (
    select row(
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'werewolf'
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'madman'
      ),
      (
        select topics.snapshot_revision
        from public.realtime_topics as topics
        where topics.room_id = fixture.room_id
          and topics.scope = 'role_private'
          and topics.role_id = 'villager'
      )
    )::text
    from test_private_revision_fixture as fixture
  ),
  '(2,1,0)',
  'night conversation increments all and only its group role topics'
);

select is(
  (
    select rooms.snapshot_revision
    from public.rooms as rooms
    where rooms.id = (select room_id from test_private_revision_fixture)
  ),
  (select snapshot_revision from test_private_public_revision_baseline),
  'private actions and conversation leave the public room revision unchanged'
);

select * from finish();
rollback;
