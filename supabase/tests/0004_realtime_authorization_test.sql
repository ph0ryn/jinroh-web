begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create temporary table realtime_accounts (
  label text primary key,
  account_id bigint not null unique,
  player_id bigint,
  role_id text not null,
  token_hash text not null unique
);

insert into realtime_accounts (label, account_id, role_id, token_hash)
select identities.label, created.account_id, identities.role_id, identities.token_hash
from (
  values
    ('host', 'role_alpha', repeat('k', 43)),
    ('guest', 'role_alpha', repeat('l', 43)),
    ('third', 'role_beta', repeat('m', 43))
) as identities(label, role_id, token_hash)
cross join lateral public.app_create_identity(
  identities.token_hash,
  'test-key'
) as created;

create temporary table realtime_room as
select created.room_id, null::text as room_code
from public.app_create_room(
  (select account_id from realtime_accounts where label = 'host'),
  'Host',
  3,
  pg_catalog.statement_timestamp() + interval '30 minutes'
) as created
where created.result_kind = 'target';

update realtime_room
set room_code = rooms.public_room_code
from public.rooms as rooms
where rooms.id = realtime_room.room_id;

select *
from public.app_join_room(
  (select account_id from realtime_accounts where label = 'guest'),
  (select room_code from realtime_room),
  'Guest'
);

select *
from public.app_join_room(
  (select account_id from realtime_accounts where label = 'third'),
  (select room_code from realtime_room),
  'Third'
);

update realtime_accounts as accounts
set player_id = players.id
from public.players as players
where players.account_id = accounts.account_id
  and players.room_id = (select room_id from realtime_room);

create temporary table lobby_grant as
select issued.*
from public.app_issue_realtime_grant(
  (select account_id from realtime_accounts where label = 'host'),
  (select room_code from realtime_room),
  120
) as issued;

select is(
  (
    select pg_catalog.array_agg(
      grants.result_kind
      order by grants.scope
    )
    from lobby_grant as grants
  ),
  array['active', 'active']::text[],
  'a lobby grant returns active room and player subscription rows'
);

select is(
  (
    select pg_catalog.array_agg(grants.scope order by grants.scope)
    from lobby_grant as grants
  ),
  array['player_private', 'room']::text[],
  'a lobby grant has no role-private subscription'
);

select ok(
  (
    select pg_catalog.bool_and(grants.game_id is null)
    from lobby_grant as grants
  ),
  'a pre-game grant records no Game identity'
);

select ok(
  public.can_receive_realtime_topic(
    (select grant_id::text from lobby_grant limit 1),
    (select topic from lobby_grant where scope = 'room')
  ),
  'an active lobby grant receives its Room invalidation'
);

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
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select room_id from realtime_room),
  1,
  'night',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp() + interval '1 minute',
  0,
  1,
  1,
  0,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
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
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101',
  'night',
  0,
  1,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp() + interval '1 minute'
);

insert into public.game_rule_sets (
  game_id,
  role_counts,
  options,
  resolved_role_setup,
  role_registry_version,
  engine_version
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '{"role_alpha":2,"role_beta":1}'::jsonb,
  '{}'::jsonb,
  '{"activeRoleIds":["role_alpha","role_beta"],"contributions":[],"nightConversationGroups":[]}'::jsonb,
  'test-registry-v1',
  'test-engine-v1'
);

insert into public.game_players (
  game_id,
  room_id,
  player_id,
  role_id
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select room_id from realtime_room),
  accounts.player_id,
  accounts.role_id
from realtime_accounts as accounts;

insert into public.realtime_topics (
  topic,
  room_id,
  scope,
  game_id,
  role_id
)
select
  private.random_identifier('role:', 24),
  (select room_id from realtime_room),
  'role_private',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  roles.role_id
from (
  select distinct role_id
  from realtime_accounts
) as roles;

update public.rooms
set current_game_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    snapshot_revision = snapshot_revision + 1
where id = (select room_id from realtime_room);

create temporary table first_game_grant as
select issued.*
from public.app_issue_realtime_grant(
  (select account_id from realtime_accounts where label = 'host'),
  (select room_code from realtime_room),
  120
) as issued;

select is(
  (
    select pg_catalog.array_agg(grants.scope order by grants.scope)
    from first_game_grant as grants
  ),
  array['player_private', 'role_private', 'room']::text[],
  'a Game grant includes the matching role-private topic'
);

select ok(
  (
    select pg_catalog.bool_and(
      grants.game_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
    )
    from first_game_grant as grants
  ),
  'every subscription row exposes the Game recorded on the grant'
);

select is(
  (
    select row(grants.role_id, grants.player_id)::text
    from first_game_grant as grants
    where grants.scope = 'role_private'
  ),
  '(role_alpha,)'::text,
  'role subscription targets are explicit and player-neutral'
);

select ok(
  public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (select topic from first_game_grant where scope = 'role_private')
  ),
  'a current-Game grant can receive its matching role topic'
);

select ok(
  not public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (
      select topics.topic
      from public.realtime_topics as topics
      where topics.game_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        and topics.role_id = 'role_beta'
    )
  ),
  'a grant cannot receive another role topic from the same Game'
);

update public.game_phase_instances
set ended_at = pg_catalog.statement_timestamp()
where game_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  and id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa101';

update public.games
set phase = null,
    phase_instance_id = null,
    phase_started_at = null,
    phase_ends_at = null,
    winner_team = 'alpha_team',
    ended_at = pg_catalog.statement_timestamp(),
    updated_at = pg_catalog.statement_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

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
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  (select room_id from realtime_room),
  2,
  'night',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb202',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp() + interval '1 minute',
  0,
  1,
  1,
  0,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
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
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb202',
  'night',
  0,
  1,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp() + interval '1 minute'
);

insert into public.game_rule_sets (
  game_id,
  role_counts,
  options,
  resolved_role_setup,
  role_registry_version,
  engine_version
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  '{"role_alpha":2,"role_beta":1}'::jsonb,
  '{}'::jsonb,
  '{"activeRoleIds":["role_alpha","role_beta"],"contributions":[],"nightConversationGroups":[]}'::jsonb,
  'test-registry-v1',
  'test-engine-v1'
);

insert into public.game_players (
  game_id,
  room_id,
  player_id,
  role_id
)
select
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  (select room_id from realtime_room),
  accounts.player_id,
  accounts.role_id
from realtime_accounts as accounts;

insert into public.realtime_topics (
  topic,
  room_id,
  scope,
  game_id,
  role_id
)
select
  private.random_identifier('role:', 24),
  (select room_id from realtime_room),
  'role_private',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  roles.role_id
from (
  select distinct role_id
  from realtime_accounts
) as roles;

update public.rooms
set current_game_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    snapshot_revision = snapshot_revision + 1
where id = (select room_id from realtime_room);

select ok(
  public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (select topic from first_game_grant where scope = 'room')
  ),
  'a prior-Game grant still receives Room invalidation'
);

select ok(
  public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (select topic from first_game_grant where scope = 'player_private')
  ),
  'a prior-Game grant still receives its Room-lifetime player topic'
);

select ok(
  not public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (select topic from first_game_grant where scope = 'role_private')
  ),
  'a prior-Game grant loses its old role authorization after replacement'
);

select ok(
  not public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (
      select topics.topic
      from public.realtime_topics as topics
      where topics.game_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
        and topics.role_id = 'role_alpha'
    )
  ),
  'a prior-Game grant cannot receive the replacement Game role topic'
);

create temporary table second_game_grant as
select issued.*
from public.app_issue_realtime_grant(
  (select account_id from realtime_accounts where label = 'host'),
  (select room_code from realtime_room),
  120
) as issued;

select ok(
  public.can_receive_realtime_topic(
    (select grant_id::text from second_game_grant limit 1),
    (select topic from second_game_grant where scope = 'role_private')
  ),
  'a freshly issued replacement-Game grant receives its role topic'
);

select ok(
  not public.can_receive_realtime_topic(
    (select grant_id::text from first_game_grant limit 1),
    (select topic from first_game_grant where scope = 'room')
  ),
  'issuing a replacement grant revokes older grants for the same Player'
);

select ok(
  not public.can_receive_realtime_topic(
    'not-a-uuid',
    (select topic from second_game_grant where scope = 'room')
  ),
  'malformed grant IDs are denied without a cast error'
);

update public.realtime_grants
set created_at = pg_catalog.statement_timestamp() - interval '2 hours',
    expires_at = pg_catalog.statement_timestamp() - interval '1 hour'
where grant_id = (select grant_id from second_game_grant limit 1);

select ok(
  not public.can_receive_realtime_topic(
    (select grant_id::text from second_game_grant limit 1),
    (select topic from second_game_grant where scope = 'room')
  ),
  'expired grants cannot receive Room topics'
);

select is(
  (
    select cleanup.deleted_grants
    from public.app_cleanup_expired_realtime_grants(100) as cleanup
  ),
  1::bigint,
  'cleanup deletes the expired grant while recent revoked grants retain their grace period'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policy as policies
    join pg_catalog.pg_class as classes
      on classes.oid = policies.polrelid
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'realtime'
      and classes.relname = 'messages'
      and policies.polname =
        'Authenticated players can receive eligible room broadcasts'
      and pg_catalog.pg_get_expr(policies.polqual, policies.polrelid)
        like '%can_receive_realtime_topic%'
  ),
  'Realtime broadcast RLS delegates to Game-aware authorization'
);

select * from finish();
rollback;
