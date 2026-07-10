begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

select has_column(
  'public',
  'accounts',
  'current_room_id',
  'accounts exposes a current room foreign key'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'accounts_current_room_id_fkey'
      and condeferrable
      and condeferred
      and confdeltype = 'n'
  ),
  'current room foreign key is deferred and uses ON DELETE SET NULL'
);

select has_index(
  'public',
  'accounts',
  'accounts_current_room_id_idx',
  'accounts current room lookup is indexed'
);

select ok(
  (
    select count(*)
    from pg_trigger
    where tgname in (
      'accounts_validate_current_room',
      'players_validate_account_current_room',
      'rooms_validate_account_current_room'
    )
      and tgdeferrable
      and tginitdeferred
  ) = 3,
  'membership consistency is checked by deferred constraint triggers'
);

select ok(
  not has_function_privilege('anon', 'public.app_get_current_room(bigint)', 'execute'),
  'anonymous clients cannot call the current room RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.app_switch_join_room(bigint,text,text,text,text)',
    'execute'
  ),
  'authenticated clients cannot call switch RPCs directly'
);

select ok(
  has_function_privilege('service_role', 'public.app_get_current_room(bigint)', 'execute'),
  'the service role can call the current room RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.app_issue_realtime_grant_without_membership_check(bigint,text,integer)',
    'execute'
  ),
  'the renamed realtime helper is not browser executable'
);

insert into public.accounts (id)
overriding system value
select account_id
from generate_series(9101, 9111) as account_id;

select lives_ok(
  $$
    select * from public.app_create_room(
      9101,
      '910001',
      'room:910001-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '2099-01-01T00:00:00Z',
      'player-9101-a',
      'Host A',
      3
    )
  $$,
  'creating a room claims it as the account current room'
);

select is(
  (
    select rooms.public_room_code
    from public.accounts
    join public.rooms on rooms.id = accounts.current_room_id
    where accounts.id = 9101
  ),
  '910001',
  'the created room is the account current room'
);

select is(
  (
    select count(*)
    from public.players
    where players.account_id = 9101
      and players.status = 'joined'
  ),
  1::bigint,
  'room creation creates one active player'
);

select throws_ok(
  $$
    select * from public.app_create_room(
      9101,
      '910002',
      'room:910002-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '2099-01-01T00:00:00Z',
      'player-9101-b',
      'Host A',
      3
    )
  $$,
  'P0001',
  'current_room_exists',
  'an account cannot create a second room'
);

select lives_ok(
  $$
    select * from public.app_create_room(
      9102,
      '910002',
      'room:910002-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '2099-01-01T00:00:00Z',
      'player-9102-a',
      'Host B',
      3
    )
  $$,
  'a different account can create another room'
);

select throws_ok(
  $$select * from public.app_join_room(9101, '910002', 'player-9101-b', 'Host A')$$,
  'P0001',
  'current_room_exists',
  'an account cannot join a different room while current'
);

update public.players
set disconnected_at = now(), status = 'disconnected'
where players.account_id = 9101;

select is(
  (select accounts.current_room_id from public.accounts where accounts.id = 9101),
  (select rooms.id from public.rooms where rooms.public_room_code = '910001'),
  'disconnecting does not release current room membership'
);

select lives_ok(
  $$select * from public.app_join_room(9101, '910001', 'ignored-player-id', 'Ignored Name')$$,
  'joining the current room reconnects the existing player'
);

select is(
  (select players.public_player_id from public.players where players.account_id = 9101),
  'player-9101-a',
  'reconnect preserves the public player id'
);

select is(
  (select players.display_name from public.players where players.account_id = 9101),
  'Host A',
  'reconnect preserves the fixed display name'
);

select throws_ok(
  $$select * from public.app_heartbeat_room_player(9101, '910002', 45)$$,
  'P0001',
  'current_room_changed',
  'a stale tab cannot heartbeat a different room'
);

select lives_ok(
  $$select * from public.app_leave_room(9101, '910001')$$,
  'explicit leave releases room membership'
);

select is(
  (select accounts.current_room_id from public.accounts where accounts.id = 9101),
  null::bigint,
  'leave clears the current room id'
);

select is(
  (select rooms.status from public.rooms where rooms.public_room_code = '910001'),
  'disbanded',
  'the last lobby player leaving disbands the room'
);

select lives_ok(
  $$
    select * from public.app_create_room(
      9103,
      '910003',
      'room:910003-cccccccccccccccccccccccccccccccc',
      '2099-01-01T00:00:00Z',
      'player-9103-a',
      'Host C',
      3
    )
  $$,
  'a room can be created for ended-state coverage'
);

update public.rooms set status = 'ended', ended_at = now()
where public_room_code = '910003';

select is(
  (select accounts.current_room_id from public.accounts where accounts.id = 9103),
  (select rooms.id from public.rooms where rooms.public_room_code = '910003'),
  'ended rooms remain current until explicit leave'
);

select lives_ok(
  $$
    select * from public.app_create_room(
      9104,
      '910004',
      'room:910004-dddddddddddddddddddddddddddddddd',
      '2099-01-01T00:00:00Z',
      'player-9104-a',
      'Host D',
      3
    )
  $$,
  'a room can be created for playing-state coverage'
);

update public.rooms set status = 'playing', started_at = now()
where public_room_code = '910004';

select throws_ok(
  $$
    select * from public.app_switch_create_room(
      9104,
      '910004',
      '910005',
      'room:910005-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      '2099-01-01T00:00:00Z',
      'player-9104-b',
      'Host D',
      3
    )
  $$,
  'P0001',
  'room_switch_forbidden',
  'playing rooms cannot be left through switching'
);

select is(
  (select rooms.public_room_code from public.accounts join public.rooms on rooms.id = accounts.current_room_id where accounts.id = 9104),
  '910004',
  'a rejected playing-room switch preserves current membership'
);

update public.rooms set status = 'disbanded', disbanded_at = now()
where public_room_code = '910004';

select is(
  (select accounts.current_room_id from public.accounts where accounts.id = 9104),
  null::bigint,
  'disbanding a room clears current membership through the room trigger'
);

select lives_ok(
  $$select * from public.app_create_room(9105, '910005', 'room:910005-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '2099-01-01', 'player-9105-a', 'Host E', 3)$$,
  'a switch source room can be created'
);

select lives_ok(
  $$select * from public.app_create_room(9106, '910006', 'room:910006-ffffffffffffffffffffffffffffffff', '2099-01-01', 'player-9106-a', 'Host F', 3)$$,
  'a switch target room can be created'
);

select lives_ok(
  $$select * from public.app_switch_join_room(9105, '910005', '910006', 'player-9105-b', 'Host E')$$,
  'confirmed switch joins the target atomically'
);

select is(
  (select rooms.public_room_code from public.accounts join public.rooms on rooms.id = accounts.current_room_id where accounts.id = 9105),
  '910006',
  'successful switch updates the account current room'
);

select is(
  (select players.status from public.players join public.rooms on rooms.id = players.room_id where players.account_id = 9105 and rooms.public_room_code = '910005'),
  'left',
  'successful switch marks the source player left'
);

select is(
  (select rooms.status from public.rooms where rooms.public_room_code = '910005'),
  'disbanded',
  'switching the last source player disbands its lobby'
);

select lives_ok(
  $$select * from public.app_create_room(9107, '910007', 'room:910007-gggggggggggggggggggggggggggggggg', '2099-01-01', 'player-9107-a', 'Host G', 3)$$,
  'a rollback source room can be created'
);

select lives_ok(
  $$select * from public.app_create_room(9108, '910008', 'room:910008-hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh', '2099-01-01', 'player-9108-a', 'Host H', 3)$$,
  'a rollback target room can be created'
);

select lives_ok(
  $$select * from public.app_join_room(9109, '910008', 'player-9109-a', 'Guest I')$$,
  'the rollback target accepts its second player'
);

select lives_ok(
  $$select * from public.app_join_room(9110, '910008', 'player-9110-a', 'Guest J')$$,
  'the rollback target accepts its final seat'
);

select throws_ok(
  $$select * from public.app_switch_join_room(9107, '910007', '910008', 'player-9107-b', 'Host G')$$,
  'P0001',
  'room_full',
  'switching to a full room fails with a stable marker'
);

select is(
  (select rooms.public_room_code from public.accounts join public.rooms on rooms.id = accounts.current_room_id where accounts.id = 9107),
  '910007',
  'a failed switch preserves source current membership'
);

select is(
  (select players.status from public.players join public.rooms on rooms.id = players.room_id where players.account_id = 9107 and rooms.public_room_code = '910007'),
  'joined',
  'a failed switch preserves the source player state'
);

select is(
  (
    select count(*)
    from public.room_events
    join public.rooms on rooms.id = room_events.room_id
    where rooms.public_room_code = '910007'
      and room_events.event_kind = 'player_left'
  ),
  0::bigint,
  'a failed switch rolls back source leave events'
);

select lives_ok(
  $$select * from public.app_create_room(9111, '910011', 'room:910011-kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk', '2000-01-01', 'player-9111-a', 'Host K', 3)$$,
  'an already expired lobby can be created for expiry processing coverage'
);

select is(
  (select notification_reason from public.app_get_current_room(9111)),
  'room_disbanded',
  'current room lookup processes lobby expiry'
);

select is(
  (select accounts.current_room_id from public.accounts where accounts.id = 9111),
  null::bigint,
  'lobby expiry releases current membership'
);

select throws_ok(
  $test$
    do $body$
    begin
      update public.accounts set current_room_id = null where id = 9103;
      set constraints all immediate;
    end;
    $body$
  $test$,
  '23514',
  'single_room_membership_invariant',
  'the deferred invariant rejects an active player without current membership'
);

select is(
  (select rooms.public_room_code from public.accounts join public.rooms on rooms.id = accounts.current_room_id where accounts.id = 9103),
  '910003',
  'a rejected invariant violation rolls back the invalid account update'
);

select * from finish();
rollback;
