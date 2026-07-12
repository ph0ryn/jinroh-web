begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

create temporary table test_realtime_accounts (
  label text primary key,
  account_id bigint not null unique,
  player_id bigint,
  role_id text,
  token_hash text not null unique
);

insert into test_realtime_accounts (label, account_id, role_id, token_hash)
select identities.label, created.account_id, identities.role_id, identities.token_hash
from (
  values
    ('host', 'role_alpha', repeat('l', 43)),
    ('guest', 'role_alpha', repeat('m', 43)),
    ('third', 'role_beta', repeat('n', 43)),
    ('outsider', null, repeat('o', 43))
) as identities(label, role_id, token_hash)
cross join lateral public.app_create_identity(identities.token_hash, 'test-key') as created;

create temporary table test_realtime_room_create as
select created.*
from public.app_create_room(
  (select account_id from test_realtime_accounts where label = 'host'),
  'Host',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

create temporary table test_realtime_room as
select created.room_id, rooms.public_room_code as room_code
from test_realtime_room_create as created
join public.rooms as rooms on rooms.id = created.room_id;

create temporary table test_realtime_join_calls as
select 'guest'::text as label, joined.*
from public.app_join_room(
  (select account_id from test_realtime_accounts where label = 'guest'),
  (select room_code from test_realtime_room),
  'Guest'
) as joined;

insert into test_realtime_join_calls
select 'third', joined.*
from public.app_join_room(
  (select account_id from test_realtime_accounts where label = 'third'),
  (select room_code from test_realtime_room),
  'Third'
) as joined;

update test_realtime_accounts as accounts
set player_id = players.id
from public.players as players
where players.account_id = accounts.account_id
  and players.room_id = (select room_id from test_realtime_room);

insert into public.role_assignments (room_id, player_id, role_id)
select (select room_id from test_realtime_room), player_id, role_id
from test_realtime_accounts
where player_id is not null;

insert into public.realtime_topics (topic, room_id, scope, role_id)
select
  private.random_identifier('role:', 24),
  (select room_id from test_realtime_room),
  'role_private',
  roles.role_id
from (
  select distinct role_id
  from test_realtime_accounts
  where role_id is not null
) as roles;

select is(
  (
    select count(*)
    from public.players
    where room_id = (select room_id from test_realtime_room)
      and left_at is null
  ),
  3::bigint,
  'the realtime fixture has three active room players'
);

select is(
  (
    select count(*)
    from public.realtime_topics
    where room_id = (select room_id from test_realtime_room)
      and scope = 'role_private'
  ),
  2::bigint,
  'the fixture has one topic for each assigned role'
);

select throws_ok(
  $$
    insert into public.realtime_topics (topic, room_id, scope)
    values (
      'role:' || repeat('z', 48),
      (select room_id from test_realtime_room),
      'role_private'
    )
  $$,
  '23514',
  'new row for relation "realtime_topics" violates check constraint "realtime_topics_target_check"',
  'a role-private topic requires a concrete role ID'
);

select throws_ok(
  $$
    select *
    from public.app_issue_realtime_grant(
      (select account_id from test_realtime_accounts where label = 'outsider'),
      (select room_code from test_realtime_room),
      120
    )
  $$,
  'P0001',
  'current_room_changed',
  'an account without active membership cannot receive a grant'
);

create temporary table test_unrelated_realtime_room_create as
select created.*
from public.app_create_room(
  (select account_id from test_realtime_accounts where label = 'outsider'),
  'Other room host',
  3,
  statement_timestamp() + interval '1 hour'
) as created;

create temporary table test_unrelated_realtime_room as
select created.room_id, rooms.public_room_code as room_code
from test_unrelated_realtime_room_create as created
join public.rooms as rooms on rooms.id = created.room_id;

create temporary table test_realtime_grant_calls (
  label text not null,
  topic text not null,
  scope text not null,
  grant_id uuid not null,
  expires_at timestamptz not null
);

insert into test_realtime_grant_calls
select
  'host_first',
  granted.topic,
  granted.scope,
  granted.grant_id,
  granted.expires_at
from public.app_issue_realtime_grant(
  (select account_id from test_realtime_accounts where label = 'host'),
  (select room_code from test_realtime_room),
  1
) as granted;

select is(
  (
    select string_agg(
      scope,
      ','
      order by case scope when 'room' then 1 when 'player_private' then 2 else 3 end
    )
    from test_realtime_grant_calls
    where label = 'host_first'
  ),
  'room,player_private,role_private',
  'a role-assigned player grant contains only its three eligible scopes'
);

select ok(
  (
    select count(distinct grant_id) = 1
      and extract(epoch from min(expires_at) - statement_timestamp()) between 59 and 61
    from test_realtime_grant_calls
    where label = 'host_first'
  ),
  'grant rows share one ID and clamp a short lifetime to sixty seconds'
);

select ok(
  (
    select bool_and(public.can_receive_realtime_topic(grant_id::text, topic))
    from test_realtime_grant_calls
    where label = 'host_first'
  ),
  'a fresh grant authorizes every returned topic'
);

insert into realtime.messages (topic, extension, payload, event, private)
select topics.topic, 'broadcast', '{}'::jsonb, 'room_changed', true
from public.realtime_topics as topics
where topics.room_id = (select room_id from test_realtime_room);

insert into realtime.messages (topic, extension, payload, event, private)
select topics.topic, 'presence', '{}'::jsonb, 'presence', true
from public.realtime_topics as topics
where topics.room_id = (select room_id from test_realtime_room)
  and topics.scope = 'room';

insert into realtime.messages (topic, extension, payload, event, private)
select topics.topic, 'broadcast', '{}'::jsonb, 'room_changed', true
from public.realtime_topics as topics
where topics.room_id = (select room_id from test_unrelated_realtime_room)
  and topics.scope = 'room';

select is(
  (
    select count(*)
    from realtime.messages as messages
    join public.realtime_topics as topics on topics.topic = messages.topic
    where topics.room_id = (select room_id from test_unrelated_realtime_room)
      and topics.scope = 'room'
      and messages.extension = 'broadcast'
  ),
  1::bigint,
  'the unrelated room fixture has a real broadcast row'
);

create function pg_temp.set_realtime_request(p_grant_id uuid, p_topic text)
returns void
language plpgsql
as $$
declare
  v_expires_at bigint;
  v_issued_at bigint;
begin
  select
    pg_catalog.floor(extract(epoch from grants.created_at))::bigint,
    pg_catalog.floor(extract(epoch from grants.expires_at))::bigint
  into v_issued_at, v_expires_at
  from public.realtime_grants as grants
  where grants.grant_id = p_grant_id;

  if not found then
    raise exception 'realtime grant fixture is missing';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'aud', 'authenticated',
      'exp', v_expires_at,
      'iat', v_issued_at,
      'realtime_grant_id', p_grant_id,
      'role', 'authenticated',
      'sub', p_grant_id
    )::text,
    true
  );
  perform pg_catalog.set_config('realtime.topic', p_topic, true);
end;
$$;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (select topic from test_realtime_grant_calls where label = 'host_first' and scope = 'room')
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  1::bigint,
  'realtime RLS exposes only the requested authorized room broadcast'
);
reset role;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'player_private'
        and player_id = (select player_id from test_realtime_accounts where label = 'host')
    )
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  1::bigint,
  'realtime RLS admits the grant holder own player-private topic'
);
reset role;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'player_private'
        and player_id = (select player_id from test_realtime_accounts where label = 'guest')
    )
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'realtime RLS rejects another player private topic'
);
reset role;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'role_private'
        and role_id = 'role_beta'
    )
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'realtime RLS rejects a different role private topic'
);
reset role;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'role_private'
        and role_id = 'role_alpha'
    )
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  1::bigint,
  'realtime RLS admits the requesting player own role topic'
);
reset role;

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_unrelated_realtime_room)
        and scope = 'room'
    )
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'realtime RLS rejects a room topic outside the grant room'
);
reset role;

update public.players as players
set left_at = greatest(players.last_seen_at, statement_timestamp())
where players.room_id = (select room_id from test_unrelated_realtime_room)
  and players.left_at is null;

update public.rooms as rooms
set ended_at = statement_timestamp(),
    updated_at = statement_timestamp()
where rooms.id = (select room_id from test_unrelated_realtime_room);

select is(
  public.can_receive_realtime_topic(
    'not-a-uuid',
    (select topic from test_realtime_grant_calls where label = 'host_first' and scope = 'room')
  ),
  false,
  'a malformed grant ID fails closed without raising an authorization error'
);

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'player_private'
        and player_id = (select player_id from test_realtime_accounts where label = 'guest')
    )
  ),
  false,
  'a grant cannot receive another player private topic'
);

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'host_first' limit 1),
    (
      select topic
      from public.realtime_topics
      where room_id = (select room_id from test_realtime_room)
        and scope = 'role_private'
        and role_id = 'role_beta'
    )
  ),
  false,
  'a grant cannot receive a different role private topic'
);

insert into test_realtime_grant_calls
select
  'guest_first',
  granted.topic,
  granted.scope,
  granted.grant_id,
  granted.expires_at
from public.app_issue_realtime_grant(
  (select account_id from test_realtime_accounts where label = 'guest'),
  (select room_code from test_realtime_room),
  120
) as granted;

select ok(
  (
    select count(*) filter (where scope = 'role_private') = 1
      and count(*) filter (where scope = 'player_private') = 1
    from test_realtime_grant_calls
    where label = 'guest_first'
  ),
  'players sharing a role share its topic but retain one personal topic'
);

insert into test_realtime_grant_calls
select
  'host_second',
  granted.topic,
  granted.scope,
  granted.grant_id,
  granted.expires_at
from public.app_issue_realtime_grant(
  (select account_id from test_realtime_accounts where label = 'host'),
  (select room_code from test_realtime_room),
  120
) as granted;

select ok(
  (
    select first_grant.grant_id <> second_grant.grant_id
      and grants.revoked_at is not null
    from (
      select grant_id
      from test_realtime_grant_calls
      where label = 'host_first'
      limit 1
    ) as first_grant
    cross join (
      select grant_id
      from test_realtime_grant_calls
      where label = 'host_second'
      limit 1
    ) as second_grant
    join public.realtime_grants as grants on grants.grant_id = first_grant.grant_id
  ),
  'issuing a replacement grant revokes the previous grant'
);

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'host_first' limit 1),
    (select topic from test_realtime_grant_calls where label = 'host_first' and scope = 'room')
  ),
  false,
  'a rotated grant immediately loses authorization'
);

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'host_first' limit 1),
    (select topic from test_realtime_grant_calls where label = 'host_first' and scope = 'room')
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'realtime RLS rejects a revoked grant'
);
reset role;

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'host_second' limit 1),
    (select topic from test_realtime_grant_calls where label = 'host_second' and scope = 'room')
  ),
  true,
  'the replacement grant remains authorized'
);

select lives_ok(
  $$
    select *
    from public.app_leave_room(
      (select account_id from test_realtime_accounts where label = 'guest'),
      (select room_code from test_realtime_room)
    )
  $$,
  'leaving a waiting room revokes its player grants'
);

select ok(
  (
    select bool_and(revoked_at is not null)
    from public.realtime_grants
    where player_id = (select player_id from test_realtime_accounts where label = 'guest')
  ),
  'every grant for a leaving player is marked revoked'
);

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'guest_first' limit 1),
    (select topic from test_realtime_grant_calls where label = 'guest_first' and scope = 'room')
  ),
  false,
  'a left membership cannot receive broadcasts even with its old grant'
);

insert into test_realtime_grant_calls
select
  'third_expiring',
  granted.topic,
  granted.scope,
  granted.grant_id,
  granted.expires_at
from public.app_issue_realtime_grant(
  (select account_id from test_realtime_accounts where label = 'third'),
  (select room_code from test_realtime_room),
  120
) as granted;

update public.realtime_grants
set created_at = statement_timestamp() - interval '10 minutes',
    expires_at = statement_timestamp() - interval '1 minute'
where grant_id = (
  select grant_id
  from test_realtime_grant_calls
  where label = 'third_expiring'
  limit 1
);

update public.realtime_grants
set created_at = statement_timestamp() - interval '10 minutes',
    revoked_at = statement_timestamp() - interval '6 minutes'
where grant_id = (
  select grant_id
  from test_realtime_grant_calls
  where label = 'host_first'
  limit 1
);

select is(
  public.can_receive_realtime_topic(
    (select grant_id::text from test_realtime_grant_calls where label = 'third_expiring' limit 1),
    (select topic from test_realtime_grant_calls where label = 'third_expiring' and scope = 'room')
  ),
  false,
  'an expired grant fails authorization before cleanup'
);

do $$
begin
  perform pg_temp.set_realtime_request(
    (select grant_id from test_realtime_grant_calls where label = 'third_expiring' limit 1),
    (select topic from test_realtime_grant_calls where label = 'third_expiring' and scope = 'room')
  );
end;
$$;
set local role authenticated;
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'realtime RLS rejects an expired grant'
);
reset role;

select lives_ok(
  $$select * from public.app_cleanup_expired_realtime_grants(500)$$,
  'expired grant cleanup completes transactionally'
);

select is(
  (
    select count(*)
    from public.realtime_grants
    where grant_id = (
      select grant_id
      from test_realtime_grant_calls
      where label = 'third_expiring'
      limit 1
    )
  ),
  0::bigint,
  'cleanup deletes the expired grant'
);

select is(
  (
    select count(*)
    from public.realtime_grants
    where grant_id = (
      select grant_id
      from test_realtime_grant_calls
      where label = 'host_first'
      limit 1
    )
  ),
  0::bigint,
  'cleanup deletes a revoked grant after its retention window'
);

update public.rooms
set ended_at = statement_timestamp(),
    updated_at = statement_timestamp()
where id = (select room_id from test_realtime_room);

create temporary table test_reused_realtime_room (
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
    (select room_code from test_realtime_room),
    (select account_id from test_realtime_accounts where label = 'outsider'),
    3,
    statement_timestamp() + interval '1 hour'
  )
  returning id, public_room_code
)
insert into test_reused_realtime_room
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
  (select account_id from test_realtime_accounts where label = 'outsider'),
  'pl_' || repeat('s', 24),
  'New room host'
from test_reused_realtime_room;

insert into public.realtime_topics (room_id, scope, topic)
select room_id, 'room', 'room:' || repeat('s', 48)
from test_reused_realtime_room;

insert into public.realtime_topics (room_id, player_id, scope, topic)
select rooms.room_id, players.id, 'player_private', 'player:' || repeat('s', 48)
from test_reused_realtime_room as rooms
join public.players as players on players.room_id = rooms.room_id;

insert into test_realtime_grant_calls
select
  'third_reused_code',
  granted.topic,
  granted.scope,
  granted.grant_id,
  granted.expires_at
from public.app_issue_realtime_grant(
  (select account_id from test_realtime_accounts where label = 'third'),
  (select room_code from test_reused_realtime_room),
  120
) as granted;

select is(
  (
    select row(
      count(*),
      count(*) filter (
        where exists (
          select 1
          from public.realtime_topics as topics
          where topics.room_id = (select room_id from test_realtime_room)
            and topics.topic = calls.topic
        )
      ),
      count(distinct grant_id)
    )::text
    from test_realtime_grant_calls as calls
    where label = 'third_reused_code'
  ),
  '(3,3,1)',
  'grant by reused code prefers the caller old-room membership and topics'
);

update public.rooms
set created_at = statement_timestamp() - interval '2 hours',
    waiting_expires_at = statement_timestamp() - interval '1 hour',
    updated_at = statement_timestamp()
where id = (select room_id from test_reused_realtime_room);

select is(
  (
    select row(notification_reason, grant_id, topic)::text
    from public.app_issue_realtime_grant(
      (select account_id from test_realtime_accounts where label = 'outsider'),
      (select room_code from test_reused_realtime_room),
      120
    )
  ),
  '(waiting_room_ended,,)',
  'grant issuance settles an expired waiting room without creating a lease'
);

select is(
  (
    select row(
      rooms.status,
      count(players.id) filter (where players.left_at is null)
    )::text
    from test_reused_realtime_room as reused
    join public.rooms as rooms on rooms.id = reused.room_id
    left join public.players as players on players.room_id = rooms.id
    group by rooms.id
  ),
  '(ended,0)',
  'expired grant settlement closes the room membership'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.app_issue_realtime_grant(bigint,text,integer)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.app_issue_realtime_grant(bigint,text,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.app_issue_realtime_grant(bigint,text,integer)',
      'EXECUTE'
    ),
  'only the service role can issue realtime grants'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.can_receive_realtime_topic(text,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.can_receive_realtime_topic(text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.can_receive_realtime_topic(text,text)',
      'EXECUTE'
    ),
  'only authenticated realtime clients can evaluate topic eligibility'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.app_cleanup_expired_realtime_grants(integer)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.app_cleanup_expired_realtime_grants(integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.app_cleanup_expired_realtime_grants(integer)',
      'EXECUTE'
    ),
  'only the service role can clean realtime grants'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'Authenticated players can receive eligible room broadcasts'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
      and qual like '%can_receive_realtime_topic%'
      and qual like '%realtime_grant_id%'
  ),
  'the realtime broadcast policy delegates authenticated reads to grant eligibility'
);

select * from finish();
rollback;
