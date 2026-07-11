insert into public.accounts (id, created_at, updated_at)
overriding system value
values
  (1001, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  (1002, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
on conflict (id) do nothing;

insert into public.account_tokens (
  id,
  account_id,
  token_hash,
  token_hash_key_id,
  created_at
)
overriding system value
values
  (
    1001,
    1001,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'local-dev',
    '2026-01-01T00:00:00Z'
  ),
  (
    1002,
    1002,
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'local-dev',
    '2026-01-01T00:00:00Z'
  )
on conflict (id) do nothing;

insert into public.rooms (
  id,
  public_room_code,
  status,
  host_account_id,
  realtime_topic,
  waiting_expires_at,
  created_at,
  updated_at
)
overriding system value
values (
  1001,
  '123456',
  'waiting',
  1001,
  'local_room_topic_123456_000000000001',
  '2026-01-01T00:30:00Z',
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
)
on conflict (id) do nothing;

insert into public.players (
  id,
  public_player_id,
  room_id,
  account_id,
  display_name,
  status,
  joined_at,
  last_seen_at
)
overriding system value
values
  (
    1001,
    'local_p1',
    1001,
    1001,
    'Host',
    'joined',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    1002,
    'local_p2',
    1001,
    1002,
    'Guest',
    'joined',
    '2026-01-01T00:01:00Z',
    '2026-01-01T00:01:00Z'
  )
on conflict (id) do nothing;

insert into public.room_events (
  id,
  room_id,
  actor_player_id,
  actor_account_id,
  event_kind,
  payload,
  created_at
)
overriding system value
values (
  1001,
  1001,
  1001,
  1001,
  'room_created',
  '{"source":"seed"}',
  '2026-01-01T00:00:00Z'
)
on conflict (id) do nothing;
