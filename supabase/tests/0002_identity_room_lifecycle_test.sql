begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create temporary table test_accounts (
  label text primary key,
  account_id bigint not null unique,
  token_hash text not null unique
);

insert into test_accounts (label, account_id, token_hash)
select identities.label, created.account_id, identities.token_hash
from (
  values
    ('host', repeat('a', 43)),
    ('guest', repeat('b', 43)),
    ('third', repeat('c', 43)),
    ('newcomer', repeat('d', 43)),
    ('expiring', repeat('e', 43)),
    ('revoked', repeat('f', 43)),
    ('readiness-expiring', repeat('g', 43)),
    ('leave-expiring', repeat('h', 43)),
    ('expired-create', repeat('i', 43)),
    ('expired-join', repeat('j', 43))
) as identities(label, token_hash)
cross join lateral public.app_create_identity(
  identities.token_hash,
  'test-key'
) as created;

select is(
  (select pg_catalog.count(*) from test_accounts),
  10::bigint,
  'identity creation returns distinct accounts'
);

select is(
  (
    select authenticated.account_id
    from public.app_authenticate_account(repeat('a', 43)) as authenticated
  ),
  (select account_id from test_accounts where label = 'host'),
  'an active identity token authenticates'
);

update public.account_tokens
set revoked_at = pg_catalog.statement_timestamp()
where token_hash = repeat('f', 43);

select is(
  (
    select pg_catalog.count(*)
    from public.app_authenticate_account(repeat('f', 43))
  ),
  0::bigint,
  'a revoked identity token does not authenticate'
);

create temporary table primary_room as
select
  created.room_id,
  created.actor_player_id as host_player_id,
  null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'host'),
  'Host',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update primary_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = primary_room.room_id;

create temporary table membership_target_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'newcomer'),
  'Newcomer',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update membership_target_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = membership_target_room.room_id;

select is(
  (
    select row(
      rooms.roster_revision,
      rooms.snapshot_revision,
      rooms.current_game_id,
      rooms.closed_at
    )::text
    from public.rooms as rooms
    where rooms.id = (select room_id from primary_room)
  ),
  '(1,1,,)'::text,
  'room creation establishes the first roster epoch and no game state'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_create_room(%s, %L, 3, pg_catalog.statement_timestamp() + interval ''30 minutes'')',
    (select account_id from test_accounts where label = 'host'),
    'Host'
  ),
  'P0001',
  'current_room_exists',
  'direct room creation rejects an account with an active Room using the canonical marker'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_join_room(%s, %L, %L)',
    (select account_id from test_accounts where label = 'host'),
    (select room_code from membership_target_room),
    'Host'
  ),
  'P0001',
  'current_room_exists',
  'joining another Room rejects an active membership using the canonical marker'
);

select is(
  (
    select pg_catalog.array_agg(topics.scope order by topics.scope)
    from public.realtime_topics as topics
    where topics.room_id = (select room_id from primary_room)
  ),
  array['player_private', 'room']::text[],
  'room creation provisions room and host-private topics'
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_accounts where label = 'guest'),
      (select room_code from primary_room),
      'Guest'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_joined',
  'a new account joins the lobby'
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_accounts where label = 'third'),
      (select room_code from primary_room),
      'Third'
    ) as joined
    where joined.result_kind = 'target'
  ),
  'player_joined',
  'the target roster can be filled'
);

select is(
  (
    select row(rooms.roster_revision, rooms.snapshot_revision)::text
    from public.rooms as rooms
    where rooms.id = (select room_id from primary_room)
  ),
  '(3,3)'::text,
  'every effective join advances both roster and public snapshot revisions once'
);

select is(
  (
    select snapshot ->> 'version'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    )
  ),
  '2',
  'room runtime snapshots use version 2'
);

select is(
  (
    select pg_catalog.array_agg(keys.key order by keys.key)
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    ) as snapshots
    cross join lateral pg_catalog.jsonb_object_keys(snapshots.snapshot) as keys(key)
  ),
  array[
    'currentGame',
    'lobbyPlayers',
    'realtimeTopics',
    'room',
    'version',
    'viewerPlayerId'
  ]::text[],
  'snapshot v2 has only the nested Room/Game boundary keys'
);

select is(
  (
    select snapshot -> 'room' ->> 'status'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    )
  ),
  'waiting',
  'a room without a current game projects a waiting lobby'
);

select is(
  (
    select snapshot -> 'currentGame'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    )
  ),
  'null'::jsonb,
  'a waiting snapshot cannot contain game residue'
);

select is(
  (
    select ready.notification_reason
    from public.app_set_room_player_ready(
      (select account_id from test_accounts where label = 'host'),
      (select room_code from primary_room),
      false,
      3
    ) as ready
  ),
  null,
  'setting an initially false readiness state to false is idempotent'
);

select is(
  (
    select rooms.snapshot_revision
    from public.rooms as rooms
    where rooms.id = (select room_id from primary_room)
  ),
  3::bigint,
  'false-to-false readiness does not advance the public revision'
);

select is(
  (
    select ready.notification_reason
    from public.app_set_room_player_ready(
      (select account_id from test_accounts where label = 'host'),
      (select room_code from primary_room),
      true,
      3
    ) as ready
  ),
  'player_ready_changed',
  'the host can become ready for the current roster'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_set_room_player_ready(%s, %L, true, 3)',
    (select account_id from test_accounts where label = 'guest'),
    (select room_code from primary_room)
  ),
  'independent players can ready concurrently against one roster epoch'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_set_room_player_ready(%s, %L, true, 3)',
    (select account_id from test_accounts where label = 'third'),
    (select room_code from primary_room)
  ),
  'the final participant can ready against the same roster epoch'
);

select is(
  (
    select pg_catalog.count(*)
    from public.players as players
    where players.room_id = (select room_id from primary_room)
      and players.left_at is null
      and players.ready_roster_revision = 3
  ),
  3::bigint,
  'all active participants are ready only for the accepted roster revision'
);

select is(
  (
    select ready.notification_reason
    from public.app_set_room_player_ready(
      (select account_id from test_accounts where label = 'host'),
      (select room_code from primary_room),
      true,
      3
    ) as ready
  ),
  null,
  'setting an already-effective readiness state is idempotent'
);

select is(
  (
    select rooms.snapshot_revision
    from public.rooms as rooms
    where rooms.id = (select room_id from primary_room)
  ),
  6::bigint,
  'only effective readiness changes increment the public revision'
);

select throws_ok(
  pg_catalog.format(
    'select * from public.app_set_room_player_ready(%s, %L, false, 2)',
    (select account_id from test_accounts where label = 'host'),
    (select room_code from primary_room)
  ),
  'P0001',
  'stale_roster_revision',
  'a stale readiness click cannot alter a newer roster'
);

update public.players
set joined_at = joined_at - interval '3 minutes',
    last_seen_at = pg_catalog.statement_timestamp() - interval '2 minutes'
where room_id = (select room_id from primary_room)
  and account_id = (select account_id from test_accounts where label = 'guest');

select is(
  (
    select heartbeat.notification_reason
    from public.app_heartbeat_room_player(
      (select account_id from test_accounts where label = 'host'),
      (select room_code from primary_room),
      45
    ) as heartbeat
  ),
  'presence_changed',
  'heartbeat marks stale participants disconnected'
);

select is(
  (
    select row(
      rooms.roster_revision,
      players.status,
      players.ready_roster_revision
    )::text
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from primary_room)
      and players.account_id = (select account_id from test_accounts where label = 'guest')
  ),
  '(3,disconnected,3)'::text,
  'disconnect preserves both roster epoch and readiness'
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_accounts where label = 'guest'),
      (select room_code from primary_room),
      'Renamed Guest'
    ) as joined
  ),
  'player_reconnected',
  'an active disconnected member reconnects without a roster mutation'
);

select is(
  (
    select row(
      rooms.roster_revision,
      players.display_name,
      players.ready_roster_revision
    )::text
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from primary_room)
      and players.account_id = (select account_id from test_accounts where label = 'guest')
  ),
  '(3,Guest,3)'::text,
  'reconnect preserves the stable Player name and readiness'
);

select is(
  (
    select left_room.notification_reason
    from public.app_leave_room(
      (select account_id from test_accounts where label = 'guest'),
      (select room_code from primary_room)
    ) as left_room
  ),
  'player_left',
  'leaving a lobby is an effective roster mutation'
);

select is(
  (
    select joined.notification_reason
    from public.app_join_room(
      (select account_id from test_accounts where label = 'guest'),
      (select room_code from primary_room),
      'Changed Name'
    ) as joined
  ),
  'player_rejoined',
  'reactivating a left membership uses the distinct rejoin event'
);

select is(
  (
    select row(
      rooms.roster_revision,
      players.display_name,
      players.ready_roster_revision
    )::text
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from primary_room)
      and players.account_id = (select account_id from test_accounts where label = 'guest')
  ),
  '(5,Guest,)'::text,
  'rejoin preserves stable identity and invalidates old readiness'
);

select ok(
  exists (
    select 1
    from public.room_events as events
    where events.room_id = (select room_id from primary_room)
      and events.event_kind = 'player_rejoined'
      and events.actor_player_id = (
        select players.id
        from public.players as players
        where players.room_id = (select room_id from primary_room)
          and players.account_id = (select account_id from test_accounts where label = 'guest')
      )
  ),
  'the audit log distinguishes rejoin from transport reconnect'
);

update public.players
set private_snapshot_revision = private_snapshot_revision + 4
where room_id = (select room_id from primary_room)
  and account_id = (select account_id from test_accounts where label = 'host');

select is(
  (
    select (snapshot -> 'room' ->> 'snapshot_revision')::bigint
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    )
  ),
  (
    select rooms.snapshot_revision + players.private_snapshot_revision
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from primary_room)
      and players.account_id = (select account_id from test_accounts where label = 'host')
  ),
  'viewer snapshot revision is the monotonic public plus private sum'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_leave_room(%s, %L)',
    (select account_id from test_accounts where label = 'guest'),
    (select room_code from primary_room)
  ),
  'a rejoined member may leave again'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_leave_room(%s, %L)',
    (select account_id from test_accounts where label = 'third'),
    (select room_code from primary_room)
  ),
  'another lobby member may leave'
);

select lives_ok(
  pg_catalog.format(
    'select * from public.app_leave_room(%s, %L)',
    (select account_id from test_accounts where label = 'host'),
    (select room_code from primary_room)
  ),
  'the last member may close the room'
);

select is(
  (
    select snapshot -> 'room' ->> 'status'
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from primary_room),
      null,
      false
    )
  ),
  'closed',
  'the last departure projects a closed Room'
);

select is(
  (
    select lookup.access_kind
    from public.app_classify_room_lookup(
      (select account_id from test_accounts where label = 'newcomer'),
      (select room_code from primary_room)
    ) as lookup
  ),
  'not_found',
  'a closed Room releases its invitation code'
);

create temporary table expiring_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'expiring'),
  'Expiring',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update expiring_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = expiring_room.room_id;

update public.rooms
set created_at = created_at - interval '1 hour',
    lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
where id = (select room_id from expiring_room);

select is(
  (
    select expired.notification_reason
    from public.app_expire_room_if_needed(
      (select room_id from expiring_room)
    ) as expired
  ),
  'room_closed',
  'lobby expiry closes a Room with the canonical marker'
);

select ok(
  (
    select rooms.closed_at is not null
    from public.rooms as rooms
    where rooms.id = (select room_id from expiring_room)
  ),
  'expiry persists Room closure'
);

create temporary table readiness_expiring_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'readiness-expiring'),
  'Readiness Expiring',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update readiness_expiring_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = readiness_expiring_room.room_id;

update public.rooms
set created_at = created_at - interval '1 hour',
    lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
where id = (select room_id from readiness_expiring_room);

select is(
  (
    select ready.notification_reason
    from public.app_set_room_player_ready(
      (select account_id from test_accounts where label = 'readiness-expiring'),
      (select room_code from readiness_expiring_room),
      true,
      1
    ) as ready
  ),
  'room_closed',
  'readiness applies request-time expiry before mutating a waiting Room'
);

select is(
  (
    select row(
      rooms.closed_at is not null,
      players.left_at is not null,
      players.ready_roster_revision,
      exists (
        select 1
        from public.room_events as events
        where events.room_id = rooms.id
          and events.event_kind = 'player_ready_changed'
      )
    )::text
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from readiness_expiring_room)
  ),
  '(t,t,,f)'::text,
  'expired readiness closes membership without recording a readiness mutation'
);

create temporary table leave_expiring_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'leave-expiring'),
  'Leave Expiring',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update leave_expiring_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = leave_expiring_room.room_id;

update public.rooms
set created_at = created_at - interval '1 hour',
    lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
where id = (select room_id from leave_expiring_room);

select is(
  (
    select left_room.notification_reason
    from public.app_leave_room(
      (select account_id from test_accounts where label = 'leave-expiring'),
      (select room_code from leave_expiring_room)
    ) as left_room
  ),
  'room_closed',
  'leave applies request-time expiry before mutating a waiting Room'
);

select is(
  (
    select row(
      rooms.closed_at is not null,
      players.left_at is not null,
      exists (
        select 1
        from public.room_events as events
        where events.room_id = rooms.id
          and events.event_kind = 'player_left'
      )
    )::text
    from public.rooms as rooms
    join public.players as players
      on players.room_id = rooms.id
    where rooms.id = (select room_id from leave_expiring_room)
  ),
  '(t,t,f)'::text,
  'expired leave closes membership without recording a player-left mutation'
);

create temporary table expired_create_source as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'expired-create'),
  'Expired Create Source',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update expired_create_source
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = expired_create_source.room_id;

update public.rooms
set created_at = created_at - interval '1 hour',
    lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
where id = (select room_id from expired_create_source);

create temporary table expired_create_transition as
select created.*
from public.app_create_room(
  (select account_id from test_accounts where label = 'expired-create'),
  'Expired Create Target',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created;

select results_eq(
  $$
    select result_kind, notification_reason
    from expired_create_transition
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'room_closed'::text),
      ('target'::text, 'room_created'::text)
  $$,
  'create expires the current Room before creating a replacement membership'
);

select is(
  (
    select row(
      source_rooms.closed_at is not null,
      source_players.left_at is not null,
      active_players.room_id = (
        select transition.room_id
        from expired_create_transition as transition
        where transition.result_kind = 'target'
      )
    )::text
    from public.rooms as source_rooms
    join public.players as source_players
      on source_players.room_id = source_rooms.id
     and source_players.account_id = (
       select account_id from test_accounts where label = 'expired-create'
     )
    join public.players as active_players
      on active_players.account_id = source_players.account_id
     and active_players.left_at is null
    where source_rooms.id = (select room_id from expired_create_source)
  ),
  '(t,t,t)'::text,
  'expired-current create leaves exactly the replacement membership active'
);

create temporary table expired_join_source as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from test_accounts where label = 'expired-join'),
  'Expired Join Source',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update expired_join_source
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = expired_join_source.room_id;

update public.rooms
set created_at = created_at - interval '1 hour',
    lobby_expires_at = pg_catalog.statement_timestamp() - interval '1 second'
where id = (select room_id from expired_join_source);

create temporary table expired_join_transition as
select joined.*
from public.app_join_room(
  (select account_id from test_accounts where label = 'expired-join'),
  (select room_code from membership_target_room),
  'Expired Join Target'
) as joined;

select results_eq(
  $$
    select result_kind, notification_reason
    from expired_join_transition
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'room_closed'::text),
      ('target'::text, 'player_joined'::text)
  $$,
  'join expires the current Room before activating the target membership'
);

select is(
  (
    select row(
      source_rooms.closed_at is not null,
      source_players.left_at is not null,
      active_players.room_id = (select room_id from membership_target_room)
    )::text
    from public.rooms as source_rooms
    join public.players as source_players
      on source_players.room_id = source_rooms.id
     and source_players.account_id = (
       select account_id from test_accounts where label = 'expired-join'
     )
    join public.players as active_players
      on active_players.account_id = source_players.account_id
     and active_players.left_at is null
    where source_rooms.id = (select room_id from expired_join_source)
  ),
  '(t,t,t)'::text,
  'expired-current join leaves exactly the target membership active'
);

select * from finish();
rollback;
