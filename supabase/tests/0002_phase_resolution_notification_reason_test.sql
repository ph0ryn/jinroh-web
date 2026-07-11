begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

create function pg_temp.resolve_phase_notification_reason(
  p_account_id bigint,
  p_room_code text,
  p_current_phase text,
  p_next_phase text,
  p_final_outcome jsonb default null
)
returns text
language plpgsql
as $$
declare
  v_current_phase_instance_id uuid := gen_random_uuid();
  v_next_phase_instance_id uuid := gen_random_uuid();
  v_notification_reason text;
  v_room_id bigint;
begin
  insert into public.accounts (id)
  overriding system value
  values (p_account_id);

  perform public.app_create_room(
    p_account_id,
    p_room_code,
    'room:' || p_room_code || '-00000000000000000000000000000000',
    '2099-01-01T00:00:00Z',
    'player-' || p_account_id,
    'Host ' || p_account_id,
    3
  );

  update public.rooms
  set started_at = now(),
      status = 'playing'
  where rooms.public_room_code = p_room_code
  returning rooms.id into v_room_id;

  insert into public.game_states (
    day_number,
    night_number,
    phase,
    phase_ends_at,
    phase_instance_id,
    phase_started_at,
    revision,
    room_id,
    status
  )
  values (
    1,
    1,
    p_current_phase,
    now() - interval '1 minute',
    v_current_phase_instance_id,
    now() - interval '2 minutes',
    0,
    v_room_id,
    'playing'
  );

  select resolved.notification_reason
  into v_notification_reason
  from public.app_resolve_phase(
    p_account_id,
    p_room_code,
    v_current_phase_instance_id,
    0,
    '{}'::bigint[],
    '{}'::bigint[],
    '[]'::jsonb,
    p_final_outcome,
    case when p_final_outcome is null then null else '[]'::jsonb end,
    p_next_phase,
    v_next_phase_instance_id,
    now() + interval '1 minute',
    1,
    1,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  ) as resolved;

  return v_notification_reason;
end;
$$;

select is(
  pg_temp.resolve_phase_notification_reason(9201, '920001', 'day', 'day'),
  'action_window_changed',
  'resolving within the same phase reports an action window change'
);

select is(
  pg_temp.resolve_phase_notification_reason(9202, '920002', 'day', 'night'),
  'phase_changed',
  'resolving into a different phase reports a phase change'
);

select is(
  pg_temp.resolve_phase_notification_reason(
    9203,
    '920003',
    'day',
    'night',
    '{"reason":"winner_determined","winner_team":"villagers"}'::jsonb
  ),
  'game_ended',
  'a final outcome reports game end before phase comparison'
);

select * from finish();
rollback;
