begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

select plan(86);

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
    ('overflow', repeat('d', 43)),
    ('source', repeat('e', 43)),
    ('target_host', repeat('f', 43)),
    ('expiring', repeat('g', 43)),
    ('revoked', repeat('h', 43))
) as identities(label, token_hash)
cross join lateral public.app_create_identity(identities.token_hash, 'test-key') as created;

select is(
  (select count(*) from test_accounts),
  8::bigint,
  'identity creation returns distinct accounts without fixed IDs'
);

select is(
  (
    select authenticated.account_id
    from public.app_authenticate_account(repeat('a', 43)) as authenticated
  ),
  (select account_id from test_accounts where label = 'host'),
  'an active token authenticates its account'
);

select is(
  (select count(*) from public.app_authenticate_account(repeat('z', 43))),
  0::bigint,
  'an unknown token does not authenticate'
);

update public.account_tokens
set revoked_at = statement_timestamp()
where token_hash = repeat('h', 43);

select is(
  (select count(*) from public.app_authenticate_account(repeat('h', 43))),
  0::bigint,
  'a revoked token does not authenticate'
);

create temporary table room_calls (
  label text primary key,
  room_id bigint not null,
  actor_player_id bigint not null,
  notification_reason text
);

insert into room_calls
select
  'primary_create',
  created.room_id,
  created.actor_player_id,
  created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'host'),
  '  Host  ',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

select is(
  (select notification_reason from room_calls where label = 'primary_create'),
  'room_created',
  'room creation reports its semantic notification reason'
);

select is(
  (
    select row(rooms.status, rooms.target_player_count, rooms.snapshot_revision)::text
    from public.rooms as rooms
    where rooms.id = (select room_id from room_calls where label = 'primary_create')
  ),
  '(waiting,3,0)',
  'a room starts waiting with an explicit target and settled revision'
);

select ok(
  exists (
    select 1
    from public.players
    where id = (select actor_player_id from room_calls where label = 'primary_create')
      and display_name = 'Host'
      and status = 'joined'
      and public_player_id ~ '^pl_[A-Za-z0-9_-]{16,64}$'
  ),
  'room creation trims the host name and creates a valid active player'
);

select is(
  (
    select array_agg(scope order by scope)
    from public.realtime_topics
    where room_id = (select room_id from room_calls where label = 'primary_create')
  ),
  array['player_private', 'room']::text[],
  'room creation provisions room and host-private realtime topics'
);

select is(
  (
    select event_kind
    from public.room_events
    where room_id = (select room_id from room_calls where label = 'primary_create')
  ),
  'room_created',
  'room creation writes one domain event'
);

select is(
  (
    select row(current_room.room_id, current_room.actor_player_id)::text
    from public.app_get_current_room(
      (select account_id from test_accounts where label = 'host')
    ) as current_room
  ),
  (
    select row(room_id, actor_player_id)::text
    from room_calls
    where label = 'primary_create'
  ),
  'current room is derived from the active player membership'
);

select is(
  (
    select access_kind
    from public.app_classify_room_lookup(
      (select account_id from test_accounts where label = 'host'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'primary_create')
      )
    )
  ),
  'member',
  'room lookup classification exempts an active member'
);

select is(
  (
    select access_kind
    from public.app_classify_room_lookup(
      (select account_id from test_accounts where label = 'overflow'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'primary_create')
      )
    )
  ),
  'outsider',
  'room lookup classification identifies a nonmember before reading a snapshot'
);

select is(
  (
    select access_kind
    from public.app_classify_room_lookup(
      (select account_id from test_accounts where label = 'overflow'),
      '999999'
    )
  ),
  'not_found',
  'room lookup classification rejects an unknown code without reading a snapshot'
);

select function_privs_are(
  'public',
  'app_classify_room_lookup',
  array['bigint', 'text'],
  'service_role',
  array['EXECUTE'],
  'only the application service role can classify room lookup access'
);

select throws_ok(
  $$
    select *
    from public.app_create_room(
      (select account_id from test_accounts where label = 'host'),
      'Host',
      3,
      statement_timestamp() + interval '1 hour'
    )
  $$,
  'P0001',
  'current_room_exists',
  'an account cannot create a second active membership'
);

insert into room_calls
select 'guest_join', joined.room_id, joined.actor_player_id, joined.notification_reason
from public.app_join_room(
  (select account_id from test_accounts where label = 'guest'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  'Guest'
) as joined
where joined.result_kind = 'target';

select is(
  (select notification_reason from room_calls where label = 'guest_join'),
  'player_joined',
  'a second account joins the waiting room'
);

insert into room_calls
select 'third_join', joined.room_id, joined.actor_player_id, joined.notification_reason
from public.app_join_room(
  (select account_id from test_accounts where label = 'third'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  'Third'
) as joined
where joined.result_kind = 'target';

select is(
  (select notification_reason from room_calls where label = 'third_join'),
  'player_joined',
  'a third account joins the waiting room'
);

select is(
  (
    select count(*)
    from public.players
    where room_id = (select room_id from room_calls where label = 'primary_create')
      and left_at is null
  ),
  3::bigint,
  'the lifecycle fixture reaches the real three-player target'
);

select throws_ok(
  $$
    select *
    from public.app_join_room(
      (select account_id from test_accounts where label = 'overflow'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'primary_create')
      ),
      'Overflow'
    )
  $$,
  'P0001',
  'room_full',
  'joining beyond the exact target is rejected'
);

select is(
  (
    select row(
      snapshots.snapshot ->> 'version',
      snapshots.snapshot ->> 'viewerPlayerId',
      jsonb_array_length(snapshots.snapshot -> 'players')
    )::text
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      (select room_id from room_calls where label = 'primary_create'),
      null
    ) as snapshots
  ),
  (
    select row('1', actor_player_id::text, 3)::text
    from room_calls
    where label = 'primary_create'
  ),
  'room snapshots locate by ID and identify an active viewer'
);

select ok(
  (
    select snapshots.snapshot -> 'viewerPlayerId' = 'null'::jsonb
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'overflow'),
      null,
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'primary_create')
      )
    ) as snapshots
  ),
  'room snapshots locate by code without inventing spectator membership'
);

select throws_ok(
  $$
    select *
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'host'),
      null::bigint,
      null::text
    )
  $$,
  'P0001',
  'invalid_room_locator',
  'room snapshots require exactly one locator'
);

update public.players
set disconnected_at = statement_timestamp(),
    last_seen_at = statement_timestamp()
where id = (select actor_player_id from room_calls where label = 'guest_join');

insert into room_calls
select
  'guest_reconnect',
  reconnected.room_id,
  reconnected.actor_player_id,
  reconnected.notification_reason
from public.app_join_room(
  (select account_id from test_accounts where label = 'guest'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  'Ignored replacement'
) as reconnected
where reconnected.result_kind = 'target';

select is(
  (select notification_reason from room_calls where label = 'guest_reconnect'),
  'player_reconnected',
  'joining an existing disconnected membership reconnects it'
);

select is(
  (select actor_player_id from room_calls where label = 'guest_reconnect'),
  (select actor_player_id from room_calls where label = 'guest_join'),
  'reconnection preserves the stable player identity'
);

update public.players
set joined_at = statement_timestamp() - interval '2 minutes',
    last_seen_at = statement_timestamp() - interval '1 minute'
where id = (select actor_player_id from room_calls where label = 'third_join');

insert into room_calls
select 'host_heartbeat', heartbeat.*
from public.app_heartbeat_room_player(
  (select account_id from test_accounts where label = 'host'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  10
) as heartbeat;

select is(
  (select notification_reason from room_calls where label = 'host_heartbeat'),
  'player_disconnected',
  'heartbeat reports another stale player becoming disconnected'
);

select is(
  (
    select status
    from public.players
    where id = (select actor_player_id from room_calls where label = 'third_join')
  ),
  'disconnected',
  'heartbeat derives disconnected status from its timestamp'
);

insert into room_calls
select 'third_heartbeat', heartbeat.*
from public.app_heartbeat_room_player(
  (select account_id from test_accounts where label = 'third'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  10
) as heartbeat;

select is(
  (select notification_reason from room_calls where label = 'third_heartbeat'),
  'player_reconnected',
  'a disconnected caller heartbeat reports reconnection'
);

select is(
  (
    select status
    from public.players
    where id = (select actor_player_id from room_calls where label = 'third_join')
  ),
  'joined',
  'reconnection clears the derived disconnected status'
);

insert into room_calls
select 'guest_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_accounts where label = 'guest'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  )
) as left_room;

select is(
  (select notification_reason from room_calls where label = 'guest_leave'),
  'player_left',
  'a non-host can leave a waiting room'
);

insert into room_calls
select 'host_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_accounts where label = 'host'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  )
) as left_room;

select is(
  (select notification_reason from room_calls where label = 'host_leave'),
  'player_left',
  'the host can leave while another waiting player remains'
);

select is(
  (
    select host_account_id
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  (select account_id from test_accounts where label = 'third'),
  'host ownership transfers to the earliest remaining active player'
);

select is(
  (
    select count(*)
    from public.app_get_current_room(
      (select account_id from test_accounts where label = 'host')
    )
  ),
  0::bigint,
  'leaving removes the derived current room'
);

insert into room_calls
select 'third_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_accounts where label = 'third'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  )
) as left_room;

select is(
  (select notification_reason from room_calls where label = 'third_leave'),
  'waiting_room_ended',
  'the last waiting player leaving ends the room'
);

select is(
  (
    select status
    from public.rooms
    where id = (select room_id from room_calls where label = 'primary_create')
  ),
  'ended',
  'room status is derived as ended after the last player leaves'
);

select is(
  (
    select count(*)
    from public.players
    where room_id = (select room_id from room_calls where label = 'primary_create')
      and left_at is null
  ),
  0::bigint,
  'an ended waiting room has no active memberships'
);

insert into room_calls
select 'source_create', created.room_id, created.actor_player_id, created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'source'),
  'Source',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

insert into room_calls
select 'target_create', created.room_id, created.actor_player_id, created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'target_host'),
  'Target host',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

select throws_ok(
  $$
    select *
    from public.app_switch_room(
      (select account_id from test_accounts where label = 'target_host'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'target_create')
      ),
      'join',
      'Target host',
      (
        select lpad(candidates.value::text, 6, '0')
        from generate_series(0, 999999) as candidates(value)
        where not exists (
          select 1
          from public.rooms
          where public_room_code = lpad(candidates.value::text, 6, '0')
        )
        limit 1
      )
    )
  $$,
  'P0001',
  'room_not_found',
  'a switch to a missing room fails before leaving the source'
);

select is(
  (
    select count(*)
    from public.players
    where account_id = (select account_id from test_accounts where label = 'target_host')
      and room_id = (select room_id from room_calls where label = 'target_create')
      and left_at is null
  ),
  1::bigint,
  'a failed switch preserves the source membership'
);

select throws_ok(
  $$
    select *
    from public.app_switch_room(
      (select account_id from test_accounts where label = 'target_host'),
      null,
      'join',
      'Target host',
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'source_create')
      )
    )
  $$,
  'P0001',
  'current_room_changed',
  'a switch requires an explicit expected current room code'
);

select is(
  (
    select count(*)
    from public.players
    where account_id = (select account_id from test_accounts where label = 'target_host')
      and room_id = (select room_id from room_calls where label = 'target_create')
      and left_at is null
  ),
  1::bigint,
  'a missing switch precondition preserves the source membership'
);

select throws_ok(
  $$
    select *
    from public.app_switch_room(
      (select account_id from test_accounts where label = 'source'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'source_create')
      ),
      'join',
      'Source',
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'source_create')
      )
    )
  $$,
  'P0001',
  'current_room_exists',
  'a switch cannot target the same visible room code'
);

select results_eq(
  $$
    select switched.result_kind, switched.notification_reason
    from public.app_switch_room(
      (select account_id from test_accounts where label = 'source'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'source_create')
      ),
      'join',
      'Source',
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'target_create')
      )
    ) as switched
  $$,
  $$values ('source'::text, 'waiting_room_ended'::text), ('target'::text, 'player_joined'::text)$$,
  'a successful switch reports both source and target mutations'
);

select is(
  (
    select status
    from public.rooms
    where id = (select room_id from room_calls where label = 'source_create')
  ),
  'ended',
  'switching the last source player ends the source waiting room'
);

select is(
  (
    select count(*)
    from public.players
    where account_id = (select account_id from test_accounts where label = 'source')
      and room_id = (select room_id from room_calls where label = 'target_create')
      and left_at is null
  ),
  1::bigint,
  'a successful switch leaves exactly one target membership'
);

update public.rooms
set started_at = statement_timestamp(),
    updated_at = statement_timestamp()
where id = (select room_id from room_calls where label = 'target_create');

select throws_ok(
  $$
    select *
    from public.app_leave_room(
      (select account_id from test_accounts where label = 'target_host'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'target_create')
      )
    )
  $$,
  'P0001',
  'room_switch_forbidden',
  'playing room membership cannot be left or switched'
);

select is(
  (
    select count(*)
    from public.players
    where account_id = (select account_id from test_accounts where label = 'target_host')
      and room_id = (select room_id from room_calls where label = 'target_create')
      and left_at is null
  ),
  1::bigint,
  'a rejected playing-room leave preserves membership'
);

update public.rooms
set ended_at = statement_timestamp(),
    updated_at = statement_timestamp()
where id = (select room_id from room_calls where label = 'target_create');

update public.players
set disconnected_at = statement_timestamp(),
    last_seen_at = statement_timestamp()
where room_id = (select room_id from room_calls where label = 'target_create')
  and account_id = (select account_id from test_accounts where label = 'source');

insert into room_calls
select 'ended_reconnect', heartbeat.*
from public.app_heartbeat_room_player(
  (select account_id from test_accounts where label = 'source'),
  (
    select public_room_code
    from public.rooms
    where id = (select room_id from room_calls where label = 'target_create')
  ),
  10
) as heartbeat;

select is(
  (select notification_reason from room_calls where label = 'ended_reconnect'),
  'player_reconnected',
  'an ended-room heartbeat reports the caller reconnection'
);

select is(
  (
    select status
    from public.players
    where room_id = (select room_id from room_calls where label = 'target_create')
      and account_id = (select account_id from test_accounts where label = 'source')
  ),
  'joined',
  'an ended-room heartbeat clears the caller disconnected state'
);

create temporary table reused_code_room (
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
  select
    rooms.public_room_code,
    (select account_id from test_accounts where label = 'overflow'),
    3,
    statement_timestamp() + interval '1 hour'
  from public.rooms as rooms
  where rooms.id = (select room_id from room_calls where label = 'target_create')
  returning id, public_room_code
)
insert into reused_code_room
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
  (select account_id from test_accounts where label = 'overflow'),
  'pl_' || repeat('r', 24),
  'Reused host'
from reused_code_room;

insert into public.realtime_topics (room_id, scope, topic)
select room_id, 'room', 'room:' || repeat('r', 48)
from reused_code_room;

insert into public.realtime_topics (room_id, player_id, scope, topic)
select rooms.room_id, players.id, 'player_private', 'player:' || repeat('r', 48)
from reused_code_room as rooms
join public.players as players on players.room_id = rooms.room_id;

select is(
  (
    select row(
      snapshots.snapshot -> 'room' ->> 'id',
      snapshots.snapshot ->> 'viewerPlayerId'
    )::text
    from public.app_read_room_runtime_snapshot(
      (select account_id from test_accounts where label = 'target_host'),
      null,
      (select room_code from reused_code_room)
    ) as snapshots
  ),
  (
    select row(
      room_id::text,
      (
        select id::text
        from public.players
        where room_id = room_calls.room_id
          and account_id = (select account_id from test_accounts where label = 'target_host')
      )
    )::text
    from room_calls
    where label = 'target_create'
  ),
  'snapshot by reused code prefers the caller active membership in the ended room'
);

insert into room_calls
select 'same_code_leave', left_room.*
from public.app_leave_room(
  (select account_id from test_accounts where label = 'target_host'),
  (select room_code from reused_code_room)
) as left_room;

select is(
  (
    select row(room_id, notification_reason)::text
    from room_calls
    where label = 'same_code_leave'
  ),
  (
    select row(room_id, 'player_left'::text)::text
    from room_calls
    where label = 'target_create'
  ),
  'leave by reused code closes the caller old-room membership'
);

select is(
  (
    select row(
      rooms.status,
      count(players.id) filter (where players.left_at is null)
    )::text
    from reused_code_room as reused
    join public.rooms as rooms on rooms.id = reused.room_id
    left join public.players as players on players.room_id = rooms.id
    group by rooms.id
  ),
  '(waiting,1)',
  'old-room leave leaves the newer active room untouched'
);

insert into room_calls
select 'expiring_create', created.room_id, created.actor_player_id, created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'expiring'),
  'Expiring',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

update public.rooms
set created_at = statement_timestamp() - interval '2 hours',
    waiting_expires_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where id = (select room_id from room_calls where label = 'expiring_create');

insert into room_calls
select 'expiring_current', current_room.*
from public.app_get_current_room(
  (select account_id from test_accounts where label = 'expiring')
) as current_room;

select is(
  (select notification_reason from room_calls where label = 'expiring_current'),
  'waiting_room_ended',
  'reading an expired waiting room closes it transactionally'
);

select is(
  (
    select status
    from public.rooms
    where id = (select room_id from room_calls where label = 'expiring_create')
  ),
  'ended',
  'expired waiting room status is derived as ended'
);

select is(
  (
    select count(*)
    from public.players
    where room_id = (select room_id from room_calls where label = 'expiring_create')
      and left_at is null
  ),
  0::bigint,
  'expiring a waiting room closes every active membership'
);

insert into room_calls
select
  'expired_join_create',
  created.room_id,
  created.actor_player_id,
  created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'revoked'),
  'Expired join host',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

update public.rooms
set created_at = statement_timestamp() - interval '2 hours',
    waiting_expires_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where id = (select room_id from room_calls where label = 'expired_join_create');

select is(
  (
    select notification_reason
    from public.app_join_room(
      (select account_id from test_accounts where label = 'host'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'expired_join_create')
      ),
      'Late joiner'
    )
  ),
  'waiting_room_ended',
  'joining an expired target settles it without creating a membership'
);

select is(
  (
    select row(
      rooms.status,
      count(players.id) filter (where players.left_at is null)
    )::text
    from public.rooms as rooms
    left join public.players as players on players.room_id = rooms.id
    where rooms.id = (select room_id from room_calls where label = 'expired_join_create')
    group by rooms.id
  ),
  '(ended,0)',
  'expired join settlement closes the room and its memberships'
);

insert into room_calls
select
  'expired_switch_create',
  created.room_id,
  created.actor_player_id,
  created.notification_reason
from public.app_create_room(
  (select account_id from test_accounts where label = 'guest'),
  'Expired switch host',
  3,
  statement_timestamp() + interval '1 hour'
) as created
where created.result_kind = 'target';

update public.rooms
set created_at = statement_timestamp() - interval '2 hours',
    waiting_expires_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where id = (select room_id from room_calls where label = 'expired_switch_create');

select results_eq(
  $$
    select switched.result_kind, switched.notification_reason
    from public.app_switch_room(
      (select account_id from test_accounts where label = 'source'),
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'target_create')
      ),
      'join',
      'Source',
      (
        select public_room_code
        from public.rooms
        where id = (select room_id from room_calls where label = 'expired_switch_create')
      )
    ) as switched
  $$,
  $$values ('source'::text, null::text), ('target'::text, 'waiting_room_ended'::text)$$,
  'switching to an expired target reports settlement without leaving the source'
);

select is(
  (
    select row(
      (
        select count(*)
        from public.players
        where room_id = (select room_id from room_calls where label = 'target_create')
          and account_id = (select account_id from test_accounts where label = 'source')
          and left_at is null
      ),
      (
        select status
        from public.rooms
        where id = (select room_id from room_calls where label = 'expired_switch_create')
      )
    )::text
  ),
  '(1,ended)',
  'expired switch settlement preserves the source membership and ends the target'
);

create temporary table test_expiry_transition_accounts (
  label text primary key,
  account_id bigint not null unique
);

insert into test_expiry_transition_accounts (label, account_id)
select identities.label, created.account_id
from (
  values
    ('direct_create', repeat('s', 43)),
    ('direct_join', repeat('t', 43)),
    ('join_target', repeat('u', 43)),
    ('leave_guest', repeat('5', 43)),
    ('leave_host', repeat('6', 43)),
    ('switch_create', repeat('v', 43)),
    ('switch_join', repeat('w', 43))
) as identities(label, token_hash)
cross join lateral public.app_create_identity(
  identities.token_hash,
  'test-key'
) as created;

create temporary table test_expiry_transition_rooms (
  label text primary key,
  result_kind text not null,
  room_id bigint not null,
  actor_player_id bigint not null,
  notification_reason text not null
);

insert into test_expiry_transition_rooms
select 'direct_create_source', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'direct_create'
  ),
  'Direct create source',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_expiry_transition_rooms
select 'direct_join_source', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'direct_join'
  ),
  'Direct join source',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_expiry_transition_rooms
select 'join_target', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'join_target'
  ),
  'Join target',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_expiry_transition_rooms
select 'switch_create_source', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'switch_create'
  ),
  'Switch create source',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_expiry_transition_rooms
select 'switch_join_source', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'switch_join'
  ),
  'Switch join source',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

insert into test_expiry_transition_rooms
select 'leave_source', created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'leave_host'
  ),
  'Expired leave source',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

create temporary table test_expired_leave_join as
select joined.*
from public.app_join_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'leave_guest'
  ),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'leave_source'
    )
  ),
  'Expired leave guest'
) as joined;

update public.rooms
set created_at = statement_timestamp() - interval '2 hours',
    waiting_expires_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where id in (
  select room_id
  from test_expiry_transition_rooms
  where label <> 'join_target'
);

create temporary table test_expired_leave_results as
select left_room.*
from public.app_leave_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'leave_host'
  ),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'leave_source'
    )
  )
) as left_room;

select is(
  (select notification_reason from test_expired_leave_results),
  'waiting_room_ended',
  'leaving an expired waiting room settles its expiry before membership changes'
);

select is(
  (
    select row(
      rooms.status,
      count(players.id) filter (where players.left_at is null)
    )::text
    from public.rooms as rooms
    left join public.players as players on players.room_id = rooms.id
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'leave_source'
    )
    group by rooms.id
  ),
  '(ended,0)',
  'expired leave settlement closes every remaining room membership'
);

create temporary table test_direct_create_expiry_results as
select created.*
from public.app_create_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'direct_create'
  ),
  'Direct create target',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

select results_eq(
  $$
    select result_kind, notification_reason
    from test_direct_create_expiry_results
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'waiting_room_ended'::text),
      ('target'::text, 'room_created'::text)
  $$,
  'direct room creation reports expired source settlement before target creation'
);

select is(
  (
    select row(
      source_rooms.status,
      count(source_players.id) filter (where source_players.left_at is null),
      (
        select count(*)
        from public.players as target_players
        where target_players.room_id = (
          select room_id
          from test_direct_create_expiry_results
          where result_kind = 'target'
        )
          and target_players.account_id = (
            select account_id
            from test_expiry_transition_accounts
            where label = 'direct_create'
          )
          and target_players.left_at is null
      )
    )::text
    from public.rooms as source_rooms
    left join public.players as source_players
      on source_players.room_id = source_rooms.id
    where source_rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'direct_create_source'
    )
    group by source_rooms.id
  ),
  '(ended,0,1)',
  'direct room creation atomically replaces an expired source membership'
);

create temporary table test_direct_join_expiry_results as
select joined.*
from public.app_join_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'direct_join'
  ),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'join_target'
    )
  ),
  'Direct join target'
) as joined;

select results_eq(
  $$
    select result_kind, notification_reason
    from test_direct_join_expiry_results
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'waiting_room_ended'::text),
      ('target'::text, 'player_joined'::text)
  $$,
  'direct room join reports expired source settlement before target join'
);

select is(
  (
    select row(
      source_rooms.status,
      count(source_players.id) filter (where source_players.left_at is null),
      (
        select count(*)
        from public.players as target_players
        where target_players.room_id = (
          select room_id
          from test_expiry_transition_rooms
          where label = 'join_target'
        )
          and target_players.account_id = (
            select account_id
            from test_expiry_transition_accounts
            where label = 'direct_join'
          )
          and target_players.left_at is null
      )
    )::text
    from public.rooms as source_rooms
    left join public.players as source_players
      on source_players.room_id = source_rooms.id
    where source_rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'direct_join_source'
    )
    group by source_rooms.id
  ),
  '(ended,0,1)',
  'direct room join atomically moves an expired source membership to its target'
);

create temporary table test_switch_create_expiry_results as
select switched.*
from public.app_switch_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'switch_create'
  ),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'switch_create_source'
    )
  ),
  'create',
  'Switch create target',
  null,
  3,
  statement_timestamp() + interval '1 hour'
) as switched;

select results_eq(
  $$
    select result_kind, notification_reason
    from test_switch_create_expiry_results
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'waiting_room_ended'::text),
      ('target'::text, 'room_created'::text)
  $$,
  'room switch create continues atomically after expired source settlement'
);

select is(
  (
    select row(
      source_rooms.status,
      (
        select count(*)
        from public.players as target_players
        where target_players.room_id = (
          select room_id
          from test_switch_create_expiry_results
          where result_kind = 'target'
        )
          and target_players.account_id = (
            select account_id
            from test_expiry_transition_accounts
            where label = 'switch_create'
          )
          and target_players.left_at is null
      )
    )::text
    from public.rooms as source_rooms
    where source_rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'switch_create_source'
    )
  ),
  '(ended,1)',
  'room switch create leaves only the replacement membership active'
);

create temporary table test_switch_join_expiry_results as
select switched.*
from public.app_switch_room(
  (
    select account_id
    from test_expiry_transition_accounts
    where label = 'switch_join'
  ),
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'switch_join_source'
    )
  ),
  'join',
  'Switch join target',
  (
    select rooms.public_room_code
    from public.rooms as rooms
    where rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'join_target'
    )
  )
) as switched;

select results_eq(
  $$
    select result_kind, notification_reason
    from test_switch_join_expiry_results
    order by case result_kind when 'source' then 0 else 1 end
  $$,
  $$
    values
      ('source'::text, 'waiting_room_ended'::text),
      ('target'::text, 'player_joined'::text)
  $$,
  'room switch join continues atomically after expired source settlement'
);

select is(
  (
    select row(
      source_rooms.status,
      (
        select count(*)
        from public.players as target_players
        where target_players.room_id = (
          select room_id
          from test_expiry_transition_rooms
          where label = 'join_target'
        )
          and target_players.account_id = (
            select account_id
            from test_expiry_transition_accounts
            where label = 'switch_join'
          )
          and target_players.left_at is null
      )
    )::text
    from public.rooms as source_rooms
    where source_rooms.id = (
      select room_id
      from test_expiry_transition_rooms
      where label = 'switch_join_source'
    )
  ),
  '(ended,1)',
  'room switch join leaves only the target membership active'
);

select ok(
  (
    select allowed
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        )
      )
    )
  ),
  'the first token-bucket attempt is allowed'
);

select ok(
  (
    select allowed
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        )
      )
    )
  ),
  'the last available token is allowed'
);

select is(
  (
    select allowed
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        )
      )
    )
  ),
  false,
  'capacity plus one is rejected'
);

select ok(
  (
    select retry_after_seconds > 0
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        )
      )
    )
  ),
  'a rejection returns a positive Retry-After value'
);

select is(
  (
    select allowed
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        ),
        jsonb_build_object(
          'key', repeat('b', 43),
          'capacity', 1,
          'refillSeconds', 60
        )
      )
    )
  ),
  false,
  'a multi-bucket request is denied when any bucket is empty'
);

select is(
  (select tokens from private.rate_limit_buckets where bucket_key = repeat('b', 43)),
  1::numeric,
  'a denied multi-bucket request consumes no tokens'
);

update private.rate_limit_buckets
set updated_at = clock_timestamp() - interval '1 minute'
where bucket_key = repeat('a', 43);

select ok(
  (
    select allowed
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('a', 43),
          'capacity', 2,
          'refillSeconds', 60
        )
      )
    )
  ),
  'elapsed time refills the token bucket'
);

insert into private.rate_limit_buckets (bucket_key, tokens, updated_at, expires_at)
values (
  repeat('c', 43),
  0,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute'
);

select lives_ok(
  $$
    select *
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('d', 43),
          'capacity', 1,
          'refillSeconds', 60
        )
      )
    )
  $$,
  'a consume call cleans expired buckets without blocking the request'
);

select is(
  (select count(*) from private.rate_limit_buckets where bucket_key = repeat('c', 43)),
  0::bigint,
  'expired buckets are deleted'
);

select throws_ok(
  $$
    select *
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object('key', repeat('e', 43), 'capacity', 1, 'refillSeconds', 60),
        jsonb_build_object('key', repeat('e', 43), 'capacity', 1, 'refillSeconds', 60)
      )
    )
  $$,
  '22023',
  'duplicate_rate_limit_rule',
  'duplicate rules are rejected before locking buckets'
);

select throws_ok(
  $$select * from public.app_consume_rate_limits(null::jsonb)$$,
  '22023',
  'invalid_rate_limit_rules',
  'null rate-limit rules are rejected'
);

select throws_ok(
  $$select * from public.app_consume_rate_limits('{}'::jsonb)$$,
  '22023',
  'invalid_rate_limit_rules',
  'non-array rate-limit rules are rejected'
);

select throws_ok(
  $$select * from public.app_consume_rate_limits('[]'::jsonb)$$,
  '22023',
  'invalid_rate_limit_rules',
  'empty rate-limit rules are rejected'
);

select throws_ok(
  $$
    select *
    from public.app_consume_rate_limits(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', rpad(rule_number::text, 43, 'x'),
            'capacity', 1,
            'refillSeconds', 60
          )
        )
        from generate_series(1, 13) as rules(rule_number)
      )
    )
  $$,
  '22023',
  'invalid_rate_limit_rules',
  'an oversized rate-limit rule batch is rejected'
);

do $$
begin
  perform dblink_connect(
    'rate_limit_cleanup_lock',
    'host=supabase_db_jinroh-web port=5432 dbname='
      || current_database()
      || ' user=postgres password=postgres'
  );
  perform dblink_exec(
    'rate_limit_cleanup_lock',
    $remote$
      insert into private.rate_limit_buckets (
        bucket_key,
        tokens,
        updated_at,
        expires_at
      ) values (
        'lllllllllllllllllllllllllllllllllllllllllll',
        0,
        clock_timestamp() - interval '2 minutes',
        clock_timestamp() - interval '1 minute'
      )
    $remote$
  );
  perform dblink_exec('rate_limit_cleanup_lock', 'begin');
  perform locked.bucket_key
  from dblink(
    'rate_limit_cleanup_lock',
    $remote$
      select bucket_key
      from private.rate_limit_buckets
      where bucket_key = 'lllllllllllllllllllllllllllllllllllllllllll'
      for update
    $remote$
  ) as locked(bucket_key text);
end;
$$;

set local lock_timeout = '500ms';

select lives_ok(
  $$
    select *
    from public.app_consume_rate_limits(
      jsonb_build_array(
        jsonb_build_object(
          'key', repeat('m', 43),
          'capacity', 1,
          'refillSeconds', 60
        )
      )
    )
  $$,
  'cleanup skips an expired bucket locked by another consumer'
);

select is(
  (select tokens from private.rate_limit_buckets where bucket_key = repeat('m', 43)),
  0::numeric,
  'concurrent cleanup does not delete the newly consumed bucket'
);

select is(
  (
    select count(*)
    from private.rate_limit_buckets
    where bucket_key = repeat('l', 43)
  ),
  1::bigint,
  'the locked expired bucket remains for a later bounded cleanup pass'
);

do $$
begin
  perform dblink_exec('rate_limit_cleanup_lock', 'rollback');
  perform dblink_exec(
    'rate_limit_cleanup_lock',
    $remote$
      delete from private.rate_limit_buckets
      where bucket_key = 'lllllllllllllllllllllllllllllllllllllllllll'
    $remote$
  );
  perform dblink_disconnect('rate_limit_cleanup_lock');
end;
$$;

create temporary table test_rate_limit_lock_timing (
  released_at timestamptz not null
);

do $$
declare
  v_connection_string text := 'host=supabase_db_jinroh-web port=5432 dbname='
    || current_database()
    || ' user=postgres password=postgres';
begin
  perform dblink_connect('rate_limit_timestamp_lock', v_connection_string);
  perform dblink_connect('rate_limit_timestamp_consumer', v_connection_string);
  perform dblink_exec(
    'rate_limit_timestamp_lock',
    $remote$
      insert into private.rate_limit_buckets (
        bucket_key,
        tokens,
        updated_at,
        expires_at
      ) values (
        'ttttttttttttttttttttttttttttttttttttttttttt',
        1,
        clock_timestamp(),
        clock_timestamp() + interval '2 minutes'
      )
    $remote$
  );
  perform dblink_exec('rate_limit_timestamp_lock', 'begin');
  perform locked.bucket_key
  from dblink(
    'rate_limit_timestamp_lock',
    $remote$
      select bucket_key
      from private.rate_limit_buckets
      where bucket_key = 'ttttttttttttttttttttttttttttttttttttttttttt'
      for update
    $remote$
  ) as locked(bucket_key text);
  perform dblink_send_query(
    'rate_limit_timestamp_consumer',
    $remote$
      select *
      from public.app_consume_rate_limits(
        jsonb_build_array(
          jsonb_build_object(
            'key', 'ttttttttttttttttttttttttttttttttttttttttttt',
            'capacity', 1,
            'refillSeconds', 60
          )
        )
      )
    $remote$
  );
  perform pg_sleep(0.2);
  insert into test_rate_limit_lock_timing (released_at) values (clock_timestamp());
  perform dblink_exec('rate_limit_timestamp_lock', 'commit');
  perform result.allowed
  from dblink_get_result('rate_limit_timestamp_consumer')
    as result(allowed boolean, retry_after_seconds integer);
  perform dblink_disconnect('rate_limit_timestamp_lock');
  perform dblink_disconnect('rate_limit_timestamp_consumer');
end;
$$;

select ok(
  (
    select buckets.updated_at >= timing.released_at
    from private.rate_limit_buckets as buckets
    cross join test_rate_limit_lock_timing as timing
    where buckets.bucket_key = repeat('t', 43)
  ),
  'a waiting consumer fixes its decision timestamp after acquiring every bucket lock'
);

select function_privs_are(
  'public',
  'app_consume_rate_limits',
  array['jsonb'],
  'service_role',
  array['EXECUTE'],
  'only the application service role can consume rate limits'
);

select * from finish();
rollback;
