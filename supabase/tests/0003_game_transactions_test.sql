begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create temporary table test_game_accounts (
  label text primary key,
  account_id bigint not null unique,
  player_id bigint,
  public_player_id text,
  role_id text,
  token_hash text not null unique
);

insert into test_game_accounts (label, account_id, role_id, token_hash)
select identities.label, created.account_id, identities.role_id, identities.token_hash
from (
  values
    ('host', 'role_alpha', repeat('g', 43)),
    ('guest', 'role_beta', repeat('h', 43)),
    ('third', 'role_beta', repeat('i', 43)),
    ('newcomer', null, repeat('j', 43))
) as identities(label, role_id, token_hash)
cross join lateral public.app_create_identity(
  identities.token_hash,
  'test-key'
) as created;

create temporary table test_game_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_game_accounts where label = 'host'),
  'Host',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update test_game_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = test_game_room.room_id;

select *
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'guest'),
  (select room_code from test_game_room),
  'Guest'
);

select *
from public.app_join_room(
  (select account_id from test_game_accounts where label = 'third'),
  (select room_code from test_game_room),
  'Third'
);

update test_game_accounts as accounts
set player_id = players.id,
    public_player_id = players.public_player_id
from public.players as players
where players.account_id = accounts.account_id
  and players.room_id = (select room_id from test_game_room);

create function pg_temp.start_fixture_game(
  p_phase_instance_id uuid,
  p_expected_roster_revision bigint,
  p_actions jsonb,
  p_expected_player_ids bigint[] default null
)
returns table (
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language sql
set search_path = public, pg_temp
as $$
  select started.*
  from public.app_start_game(
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room),
    p_expected_roster_revision,
    coalesce(
      p_expected_player_ids,
      (
        select pg_catalog.array_agg(accounts.player_id order by accounts.player_id)
        from test_game_accounts as accounts
        join public.players as players
          on players.id = accounts.player_id
        where players.room_id = (select room_id from test_game_room)
          and players.left_at is null
      )
    ),
    p_phase_instance_id,
    60,
    '{"role_alpha":1,"role_beta":2}'::jsonb,
    '{
      "dayMode":"ready_check",
      "dayReadyCheckSecondsPerPlayer":10,
      "daySpeechSeconds":30,
      "executionLastWordsSeconds":20,
      "firstDaySpeechRounds":1,
      "firstNightSeconds":60,
      "nightSeconds":60,
      "normalDaySpeechRounds":1,
      "roleOptions":{},
      "voteResultVisibility":"count_only",
      "votingSeconds":30
    }'::jsonb,
    '{
      "activeRoleIds":["role_alpha","role_beta"],
      "contributions":[{
        "kind":"winner_judgement",
        "judgement":{
          "id":"alpha_win",
          "priority":100,
          "sourceRoleId":"role_alpha",
          "winnerTeam":"alpha_team"
        }
      }],
      "nightConversationGroups":[{
        "groupId":"alpha_group",
        "label":{"en":"Alpha group","ja":"Alpha group"},
        "roleIds":["role_alpha"]
      }]
    }'::jsonb,
    'test-registry-v1',
    'test-engine-v1',
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'player_id',
          player_id,
          'role_id',
          role_id
        )
        order by player_id
      )
      from test_game_accounts as accounts
      join public.players as players
        on players.id = accounts.player_id
      where players.room_id = (select room_id from test_game_room)
        and players.left_at is null
    ),
    p_actions,
    '[]'::jsonb
  ) as started;
$$;

select throws_ok(
  $$
    select *
    from pg_temp.start_fixture_game(
      '11111111-1111-4111-8111-111111111111',
      3,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'room_roster_not_ready',
  'a full but unready roster cannot start a game'
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_code from test_game_room),
  true,
  3
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'guest'),
  (select room_code from test_game_room),
  true,
  3
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'third'),
  (select room_code from test_game_room),
  true,
  3
);

select throws_ok(
  $$
    select *
    from pg_temp.start_fixture_game(
      '11111111-1111-4111-8111-111111111111',
      2,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'stale_roster_revision',
  'start rejects a stale roster epoch before creating game artifacts'
);

select throws_ok(
  $$
    select *
    from pg_temp.start_fixture_game(
      '11111111-1111-4111-8111-111111111111',
      3,
      '[]'::jsonb,
      array[
        (select player_id from test_game_accounts where label = 'host'),
        (select player_id from test_game_accounts where label = 'guest'),
        9223372036854775807
      ]::bigint[]
    )
  $$,
  'P0001',
  'room_players_changed',
  'start rejects expected Player IDs that differ from the locked active roster'
);

update public.players
set disconnected_at = pg_catalog.statement_timestamp()
where id = (select player_id from test_game_accounts where label = 'guest');

select throws_ok(
  $$
    select *
    from pg_temp.start_fixture_game(
      '11111111-1111-4111-8111-111111111111',
      3,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'room_players_changed',
  'start rejects a disconnected member after locking the active roster'
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_game_accounts where label = 'guest'),
      (select room_code from test_game_room),
      'Guest'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_reconnected',
  'the disconnected start fixture reconnects without changing its roster epoch'
);

select is(
  (
    select started.notification_reason
    from pg_temp.start_fixture_game(
      '11111111-1111-4111-8111-111111111111',
      3,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'action_key', 'alpha:choose',
          'action_kind', 'choose',
          'resolver_role_id', 'role_alpha',
          'actor_player_id',
            (select player_id from test_game_accounts where label = 'host'),
          'actor_role_id', 'role_alpha',
          'actor_state_requirement', 'alive',
          'eligible_target_player_ids',
            pg_catalog.jsonb_build_array(
              (select player_id from test_game_accounts where label = 'guest'),
              (select player_id from test_game_accounts where label = 'third')
            ),
          'target_kind', 'single_player',
          'target_state_requirement', 'alive'
        )
      )
    ) as started
  ),
  'game_started',
  'a ready exact roster atomically starts a new game'
);

create temporary table first_game as
select games.id as game_id, games.sequence_number
from public.games as games
where games.room_id = (select room_id from test_game_room)
  and games.ended_at is null;

select ok(
  (
    select rooms.current_game_id = first_game.game_id
      and first_game.sequence_number = 1
    from public.rooms as rooms
    cross join first_game
    where rooms.id = (select room_id from test_game_room)
  ),
  'the room points to Game sequence 1'
);

select is(
  (
    select pg_catalog.count(*)
    from public.game_players as game_players
    where game_players.game_id = (select game_id from first_game)
  ),
  3::bigint,
  'the game snapshots an immutable three-player role roster'
);

select is(
  (
    select pg_catalog.count(*)
    from public.realtime_topics as topics
    where topics.game_id = (select game_id from first_game)
      and topics.scope = 'role_private'
  ),
  2::bigint,
  'role-private topics are provisioned per Game role'
);

select is(
  (
    select snapshot -> 'currentGame' -> 'game' ->> 'id'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_room),
      null,
      false
    )
  ),
  (select game_id::text from first_game),
  'snapshot v2 projects only rooms.current_game_id'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_join_room(%s,%L,%L)',
    (select account_id from test_game_accounts where label = 'newcomer'),
    (select room_code from test_game_room),
    'Newcomer'
  ),
  'P0001',
  'room_not_joinable',
  'an outsider cannot join while the current Game is playing'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_leave_room(%s,%L)',
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room)
  ),
  'P0001',
  'room_switch_forbidden',
  'a member cannot leave or switch while the current Game is playing'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_submit_action(%s,%L,%L::uuid,%L,%L::uuid,1,%L)',
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room),
    '99999999-9999-4999-8999-999999999999',
    'alpha:choose',
    '11111111-1111-4111-8111-111111111111',
    (select public_player_id from test_game_accounts where label = 'guest')
  ),
  'P0001',
  'stale_game_id',
  'a game mutation rejects a non-current public Game UUID'
);

select is(
  (
    select submitted.notification_reason
    from public.app_submit_action(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_code from test_game_room),
      (select game_id from first_game),
      'alpha:choose',
      '11111111-1111-4111-8111-111111111111',
      1,
      (select public_player_id from test_game_accounts where label = 'guest')
    ) as submitted
  ),
  'action_window_changed',
  'a first-night action records one public progress mutation'
);

select is(
  (
    select row(
      games.action_revision,
      (
        select pg_catalog.count(*)
        from public.pending_actions as pending
        where pending.game_id = games.id
      )
    )::text
    from public.games as games
    where games.id = (select game_id from first_game)
  ),
  '(1,1)'::text,
  'accepted actions advance Game action revision and persist once'
);

select is(
  (
    select resolved.notification_reason
    from public.app_resolve_phase(
      (select game_id from first_game),
      '11111111-1111-4111-8111-111111111111',
      1,
      1,
      '[]'::jsonb,
      '{"winner_team":"alpha_team"}'::jsonb,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'player_id',
            player_id,
            'result',
            case when label = 'host' then 'win' else 'lose' end
          )
          order by player_id
        )
        from test_game_accounts
        where label in ('host', 'guest', 'third')
      ),
      null,
      null,
      null,
      0,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ) as resolved
  ),
  'game_ended',
  'phase resolution completes the Game without closing its Room'
);

select ok(
  (
    select games.ended_at is not null
      and games.winner_team = 'alpha_team'
      and rooms.current_game_id = games.id
      and rooms.closed_at is null
      and rooms.roster_revision = 4
      and rooms.lobby_expires_at
        > pg_catalog.statement_timestamp() + interval '29 minutes'
    from public.games as games
    join public.rooms as rooms
      on rooms.id = games.room_id
    where games.id = (select game_id from first_game)
  ),
  'completion retains the result pointer, invalidates readiness, and refreshes lobby expiry'
);

select is(
  (
    select pg_catalog.array_agg(
      game_players.result
      order by game_players.player_id
    )
    from public.game_players as game_players
    where game_players.game_id = (select game_id from first_game)
  ),
  array['win', 'lose', 'lose']::text[],
  'completion fixes every Game-player result in the Game aggregate'
);

select is(
  (
    select snapshot -> 'currentGame' -> 'game' ->> 'status'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'host'),
      (select room_id from test_game_room),
      null,
      false
    )
  ),
  'ended',
  'active Game-roster members retain the completed result snapshot'
);

select is(
  (
    select snapshot -> 'currentGame'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'newcomer'),
      null,
      (select room_code from test_game_room),
      false
    )
  ),
  'null'::jsonb,
  'a non-member lookup cannot see a completed Game'
);

select throws_ok(
  $$
    select *
    from pg_temp.start_fixture_game(
      '22222222-2222-4222-8222-222222222222',
      4,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'room_roster_not_ready',
  'Game completion invalidates all prior readiness'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_leave_room(%s,%L)',
    (select account_id from test_game_accounts where label = 'third'),
    (select room_code from test_game_room)
  ),
  'a completed-Game member may leave the result lobby'
);

update public.rooms
set lobby_expires_at = pg_catalog.statement_timestamp() + interval '5 minutes'
where id = (select room_id from test_game_room);

create temporary table member_revision_trace (
  stage integer primary key,
  revision bigint not null
);

insert into member_revision_trace (stage, revision)
select
  1,
  (snapshot -> 'room' ->> 'snapshot_revision')::bigint
from public.app_read_room_runtime_snapshot(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_id from test_game_room),
  null,
  false
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_game_accounts where label = 'newcomer'),
      (select room_code from test_game_room),
      'Newcomer'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_joined',
  'a non-roster participant may join a completed result lobby with capacity'
);

update test_game_accounts as accounts
set player_id = players.id,
    public_player_id = players.public_player_id,
    role_id = 'role_beta'
from public.players as players
where accounts.label = 'newcomer'
  and players.account_id = accounts.account_id
  and players.room_id = (select room_id from test_game_room);

select ok(
  (
    select rooms.current_game_id is null
      and rooms.roster_revision = 6
      and rooms.lobby_expires_at
        > pg_catalog.statement_timestamp() + interval '29 minutes'
    from public.rooms as rooms
    where rooms.id = (select room_id from test_game_room)
  ),
  'a non-roster join detaches the result and refreshes the replay lobby expiry'
);

insert into member_revision_trace (stage, revision)
select
  2,
  (snapshot -> 'room' ->> 'snapshot_revision')::bigint
from public.app_read_room_runtime_snapshot(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_id from test_game_room),
  null,
  false
);

select is(
  (
    select snapshot -> 'currentGame'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_game_accounts where label = 'newcomer'),
      (select room_id from test_game_room),
      null,
      false
    )
  ),
  'null'::jsonb,
  'the joining participant receives a clean pre-game snapshot'
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_code from test_game_room),
  true,
  6
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'guest'),
  (select room_code from test_game_room),
  true,
  6
);

select *
from public.app_set_room_player_ready(
  (select account_id from test_game_accounts where label = 'newcomer'),
  (select room_code from test_game_room),
  true,
  6
);

select is(
  (
    select started.notification_reason
    from pg_temp.start_fixture_game(
      '22222222-2222-4222-8222-222222222222',
      6,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'action_key', 'alpha:wait',
          'action_kind', 'wait',
          'resolver_role_id', 'role_alpha',
          'actor_player_id',
            (select player_id from test_game_accounts where label = 'host'),
          'actor_role_id', 'role_alpha',
          'actor_state_requirement', 'alive',
          'eligible_target_player_ids', '[]'::jsonb,
          'target_kind', 'none',
          'target_state_requirement', 'assigned'
        )
      )
    ) as started
  ),
  'game_started',
  'the changed ready roster can start a replacement Game'
);

insert into member_revision_trace (stage, revision)
select
  3,
  (snapshot -> 'room' ->> 'snapshot_revision')::bigint
from public.app_read_room_runtime_snapshot(
  (select account_id from test_game_accounts where label = 'host'),
  (select room_id from test_game_room),
  null,
  false
);

select ok(
  not exists (
    select 1
    from (
      select
        revision,
        pg_catalog.lag(revision) over (order by stage) as previous_revision
      from member_revision_trace
    ) as revisions
    where revisions.previous_revision is not null
      and revisions.revision <= revisions.previous_revision
  ),
  'member snapshot revisions increase across result detach and replacement start'
);

create temporary table second_game as
select games.id as game_id, games.sequence_number
from public.games as games
where games.room_id = (select room_id from test_game_room)
  and games.ended_at is null;

select is(
  (
    select pg_catalog.array_agg(games.sequence_number order by games.sequence_number)
    from public.games as games
    where games.room_id = (select room_id from test_game_room)
  ),
  array[1, 2]::bigint[],
  'replacement creates Game sequence 2 while retaining Game sequence 1'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_submit_action(%s,%L,%L::uuid,%L,%L::uuid,2,null)',
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room),
    (select game_id from first_game),
    'alpha:wait',
    '22222222-2222-4222-8222-222222222222'
  ),
  'P0001',
  'stale_game_id',
  'an old Game action can never mutate the replacement Game'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_send_night_conversation_message(%s,%L,%L::uuid,%L::uuid,1,%L,%L)',
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room),
    (select game_id from first_game),
    '11111111-1111-4111-8111-111111111111',
    'alpha_group',
    'Old Game message'
  ),
  'P0001',
  'stale_game_id',
  'an old Game night message cannot mutate the replacement Game'
);

select throws_ok(
  $$
    select *
    from public.app_resolve_phase(
      (select game_id from first_game),
      '11111111-1111-4111-8111-111111111111',
      1,
      1,
      '[]'::jsonb,
      null::jsonb,
      '[]'::jsonb,
      null,
      null,
      null,
      0,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'stale_game_id',
  'an old Game phase resolution cannot mutate the replacement Game'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_submit_action(%s,%L,%L::uuid,%L,%L::uuid,1,null)',
    (select account_id from test_game_accounts where label = 'host'),
    (select room_code from test_game_room),
    (select game_id from second_game),
    'alpha:wait',
    '22222222-2222-4222-8222-222222222222'
  ),
  'the replacement Game accepts its own UUID'
);

select is(
  (
    select resolved.notification_reason
    from public.app_resolve_phase(
      (select game_id from second_game),
      '22222222-2222-4222-8222-222222222222',
      1,
      1,
      '[]'::jsonb,
      '{"winner_team":"alpha_team"}'::jsonb,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'player_id',
            accounts.player_id,
            'result',
            case when accounts.label = 'host' then 'win' else 'lose' end
          )
          order by accounts.player_id
        )
        from test_game_accounts as accounts
        join public.game_players as game_players
          on game_players.player_id = accounts.player_id
        where game_players.game_id = (select game_id from second_game)
      ),
      null,
      null,
      null,
      0,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ) as resolved
  ),
  'game_ended',
  'the replacement Game can complete independently'
);

create function pg_temp.verify_result_lobby_expiry()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_access_kind text;
  v_notification_reason text;
begin
  update public.rooms as rooms
  set created_at = rooms.created_at - interval '1 hour',
      lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
  where rooms.id = (select room_id from test_game_room);

  select expired.notification_reason
  into v_notification_reason
  from public.app_expire_room_if_needed(
    (select room_id from test_game_room)
  ) as expired;

  select lookup.access_kind
  into v_access_kind
  from public.app_classify_room_lookup(
    (select account_id from test_game_accounts where label = 'third'),
    (select room_code from test_game_room)
  ) as lookup;

  if v_notification_reason is distinct from 'room_closed'
    or v_access_kind is distinct from 'not_found'
    or not exists (
      select 1
      from public.rooms as rooms
      where rooms.id = (select room_id from test_game_room)
        and rooms.closed_at is not null
        and rooms.current_game_id = (select game_id from second_game)
    )
  then
    raise exception using errcode = 'P0001', message = 'result_expiry_failed';
  end if;

  raise exception using errcode = 'P0001', message = 'result_expiry_verified';
end;
$$;

select throws_ok(
  $$select pg_temp.verify_result_lobby_expiry()$$,
  'P0001',
  'result_expiry_verified',
  'an expired completed-result lobby closes and releases its Room code'
);

select *
from public.app_leave_room(
  (select account_id from test_game_accounts where label = 'newcomer'),
  (select room_code from test_game_room)
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_game_accounts where label = 'newcomer'),
      (select room_code from test_game_room),
      'NewName'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_rejoined',
  'a completed-Game roster member may rejoin'
);

select ok(
  (
    select rooms.current_game_id = (select game_id from second_game)
      and game_players.result = 'lose'
    from public.rooms as rooms
    join public.game_players as game_players
      on game_players.game_id = rooms.current_game_id
    where rooms.id = (select room_id from test_game_room)
      and game_players.player_id = (
        select player_id from test_game_accounts where label = 'newcomer'
      )
  ),
  'rejoining a current completed-Game roster member retains its result pointer'
);

select *
from public.app_leave_room(
  (select account_id from test_game_accounts where label = 'newcomer'),
  (select room_code from test_game_room)
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_game_accounts where label = 'third'),
      (select room_code from test_game_room),
      'ThirdNew'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_rejoined',
  'an older-Game Player may reactivate in the result lobby'
);

select ok(
  (
    select rooms.current_game_id is null
      and exists (
        select 1
        from public.game_players as older_roster
        where older_roster.game_id = (select game_id from first_game)
          and older_roster.player_id = (
            select player_id from test_game_accounts where label = 'third'
          )
      )
      and not exists (
        select 1
        from public.game_players as current_roster
        where current_roster.game_id = (select game_id from second_game)
          and current_roster.player_id = (
            select player_id from test_game_accounts where label = 'third'
          )
      )
    from public.rooms as rooms
    where rooms.id = (select room_id from test_game_room)
  ),
  'reactivating an older-Game Player outside the current roster detaches the result'
);

select is(
  (
    select pg_catalog.count(*)
    from public.games as games
    where games.room_id = (select room_id from test_game_room)
  ),
  2::bigint,
  'detach and replacement transitions never delete historical Games'
);

select * from finish();
rollback;
