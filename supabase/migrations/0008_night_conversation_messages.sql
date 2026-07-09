drop function if exists public.app_submit_werewolf_consultation(
  bigint,
  text,
  uuid,
  integer,
  integer,
  text,
  text,
  jsonb,
  text
);

drop table if exists public.werewolf_consultation_slots cascade;

delete from public.game_event_visible_players
using public.game_events
where game_event_visible_players.game_event_id = game_events.id
  and game_events.event_kind in (
    'werewolf_consultation_submitted',
    'werewolf_consultation_retracted'
  );

delete from public.game_event_visible_roles
using public.game_events
where game_event_visible_roles.game_event_id = game_events.id
  and game_events.event_kind in (
    'werewolf_consultation_submitted',
    'werewolf_consultation_retracted'
  );

delete from public.game_events
where event_kind in (
  'werewolf_consultation_submitted',
  'werewolf_consultation_retracted'
);

alter table public.game_events
  drop constraint if exists game_events_event_kind_check;

alter table public.game_events
  add constraint game_events_event_kind_check
  check (
    event_kind in (
      'action_submitted',
      'action_resolved',
      'effect_applied',
      'player_died',
      'phase_changed',
      'vote_resolved',
      'game_ended',
      'initial_inspection',
      'inspection_result',
      'attack_guarded',
      'player_executed',
      'peaceful_night',
      'game_started'
    )
  );

create table if not exists public.night_conversation_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  night_number integer not null,
  conversation_group_id text not null,
  sender_player_id bigint not null references public.players(id),
  body text not null,
  created_at timestamptz not null default now(),
  constraint night_conversation_messages_body_check check (char_length(body) between 1 and 100),
  constraint night_conversation_messages_group_id_check check (
    conversation_group_id ~ '^[a-z0-9_:-]{1,64}$'
  )
);

create index if not exists night_conversation_messages_room_group_night_idx
  on public.night_conversation_messages(
    room_id,
    conversation_group_id,
    night_number,
    created_at,
    id
  );

create index if not exists night_conversation_messages_sender_player_idx
  on public.night_conversation_messages(sender_player_id);

alter table public.night_conversation_messages enable row level security;
alter table public.night_conversation_messages force row level security;

revoke all on table public.night_conversation_messages from public, anon, authenticated;
grant all on table public.night_conversation_messages to service_role;
grant all on all sequences in schema public to service_role;

create or replace function public.app_send_night_conversation_message(
  p_account_id bigint,
  p_room_code text,
  p_phase_instance_id uuid,
  p_night_number integer,
  p_conversation_group_id text,
  p_body text
)
returns table (
  id bigint,
  public_room_code text,
  status text,
  host_account_id bigint,
  realtime_topic text,
  lobby_expires_at timestamptz,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_body text;
  v_group jsonb;
  v_group_role_ids jsonb;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
begin
  v_body := btrim(coalesce(p_body, ''));

  if char_length(v_body) < 1 or char_length(v_body) > 100 then
    raise exception 'Night conversation message is invalid.';
  end if;

  if p_conversation_group_id !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'Night conversation group is invalid.';
  end if;

  select *
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Room not found.';
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found
    or v_room.status <> 'playing'
    or v_state.status <> 'playing'
    or v_state.phase <> 'night'
    or v_state.phase_instance_id <> p_phase_instance_id
    or v_state.night_number <> p_night_number
  then
    raise exception 'Night conversation belongs to a stale phase.';
  end if;

  select role_assignments.role_id
  into v_submitter_role_id
  from public.role_assignments
  where role_assignments.room_id = v_room.id
    and role_assignments.player_id = v_player.id;

  select game_player_states.alive
  into v_submitter_alive
  from public.game_player_states
  where game_player_states.room_id = v_room.id
    and game_player_states.player_id = v_player.id;

  if coalesce(v_submitter_alive, false) = false then
    raise exception 'Night conversation is not allowed.';
  end if;

  select conversation_group
  into v_group
  from jsonb_array_elements(
    coalesce(v_state.resolved_role_setup->'nightConversationGroups', '[]'::jsonb)
  ) as conversation_group
  where conversation_group->>'groupId' = p_conversation_group_id
  limit 1;

  if v_group is null then
    raise exception 'Night conversation group is not available.';
  end if;

  v_group_role_ids := coalesce(v_group->'roleIds', '[]'::jsonb);

  if not exists (
    select 1
    from jsonb_array_elements_text(v_group_role_ids) as role_id
    where role_id = v_submitter_role_id
  ) then
    raise exception 'Night conversation is not allowed.';
  end if;

  insert into public.night_conversation_messages (
    room_id,
    night_number,
    conversation_group_id,
    sender_player_id,
    body
  )
  values (
    v_room.id,
    p_night_number,
    p_conversation_group_id,
    v_player.id,
    v_body
  );

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      'private_view_changed'::text;
end;
$$;

revoke all on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.app_send_night_conversation_message(
  bigint,
  text,
  uuid,
  integer,
  text,
  text
) to service_role;
