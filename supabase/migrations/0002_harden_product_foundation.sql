alter table public.game_rule_sets
  add column if not exists validation_result jsonb,
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.game_states
  add column if not exists first_night_state jsonb,
  add column if not exists day_state jsonb,
  add column if not exists execution_state jsonb;

alter table public.game_events
  add column if not exists phase text,
  add column if not exists actor_player_id bigint references public.players (id),
  add column if not exists target_player_ids jsonb not null default '[]'::jsonb,
  add column if not exists payload_version integer not null default 1;

alter table public.player_results
  add column if not exists payload jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_player_states'::regclass
      and conname = 'game_player_states_death_reason_check'
  ) then
    alter table public.game_player_states
      drop constraint game_player_states_death_reason_check;
  end if;

  alter table public.game_player_states
    add constraint game_player_states_death_reason_check
    check (
      death_reason is null
      or death_reason in ('attack', 'execution', 'rule_effect')
    );
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.player_results'::regclass
      and conname = 'player_results_result_check'
  ) then
    alter table public.player_results
      drop constraint player_results_result_check;
  end if;

  alter table public.player_results
    add constraint player_results_result_check
    check (result in ('win', 'lose'));
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.final_outcomes'::regclass
      and conname = 'final_outcomes_winner_team_check'
  ) then
    alter table public.final_outcomes
      drop constraint final_outcomes_winner_team_check;
  end if;

  alter table public.final_outcomes
    add constraint final_outcomes_winner_team_check
    check (winner_team in ('villagers', 'werewolves', 'fox'));
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_tokens'::regclass
      and conname = 'account_tokens_token_hash_shape_check'
  ) then
    alter table public.account_tokens
      add constraint account_tokens_token_hash_shape_check
      check (token_hash ~ '^[A-Za-z0-9_-]{43,128}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rooms'::regclass
      and conname = 'rooms_realtime_topic_not_room_code_check'
  ) then
    alter table public.rooms
      add constraint rooms_realtime_topic_not_room_code_check
      check (length(realtime_topic) >= 32 and realtime_topic <> public_room_code);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_events'::regclass
      and conname = 'room_events_event_kind_check'
  ) then
    alter table public.room_events
      add constraint room_events_event_kind_check
      check (
        event_kind in (
          'room_created',
          'player_joined',
          'player_reconnected',
          'player_disconnected',
          'player_left',
          'game_started',
          'room_disbanded',
          'room_ended'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.role_assignments'::regclass
      and conname = 'role_assignments_role_id_check'
  ) then
    alter table public.role_assignments
      add constraint role_assignments_role_id_check
      check (role_id in ('werewolf', 'villager', 'madman', 'seer', 'guard', 'fox'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_events'::regclass
      and conname = 'game_events_event_kind_check'
  ) then
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
          'werewolf_consultation_submitted',
          'werewolf_consultation_retracted',
          'game_ended',
          'initial_inspection',
          'inspection_result',
          'attack_guarded',
          'player_executed',
          'peaceful_night',
          'game_started'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.realtime_topics'::regclass
      and conname = 'realtime_topics_target_check'
  ) then
    alter table public.realtime_topics
      add constraint realtime_topics_target_check
      check (
        (scope = 'room' and player_id is null and role_id is null)
        or (scope = 'player_private' and player_id is not null and role_id is null)
        or (scope = 'role_private' and player_id is null and role_id is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_events'::regclass
      and conname = 'room_events_payload_object_check'
  ) then
    alter table public.room_events
      add constraint room_events_payload_object_check
      check (jsonb_typeof(payload) = 'object');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_rule_sets'::regclass
      and conname = 'game_rule_sets_payload_shape_check'
  ) then
    alter table public.game_rule_sets
      add constraint game_rule_sets_payload_shape_check
      check (
        jsonb_typeof(role_counts) = 'object'
        and jsonb_typeof(options) = 'object'
        and (validation_result is null or jsonb_typeof(validation_result) = 'object')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_events'::regclass
      and conname = 'game_events_payload_shape_check'
  ) then
    alter table public.game_events
      add constraint game_events_payload_shape_check
      check (
        jsonb_typeof(payload) = 'object'
        and jsonb_typeof(target_player_ids) = 'array'
        and payload_version > 0
      );
  end if;
end $$;

create index if not exists account_tokens_account_id_idx
  on public.account_tokens (account_id);

create index if not exists account_tokens_active_account_id_idx
  on public.account_tokens (account_id)
  where revoked_at is null;

create index if not exists rooms_public_room_code_idx
  on public.rooms (public_room_code);

create unique index if not exists rooms_public_room_code_global_unique
  on public.rooms (public_room_code);

create index if not exists room_events_actor_account_id_idx
  on public.room_events (actor_account_id);

create index if not exists game_events_room_phase_idx
  on public.game_events (room_id, phase_instance_id);

create index if not exists current_actions_closes_at_idx
  on public.current_actions (closes_at)
  where closes_at is not null;

create index if not exists realtime_topics_room_scope_idx
  on public.realtime_topics (room_id, scope);

create index if not exists realtime_topics_player_id_idx
  on public.realtime_topics (player_id)
  where player_id is not null;

create index if not exists realtime_grants_active_grant_idx
  on public.realtime_grants (grant_id)
  where revoked_at is null;

alter table public.accounts force row level security;
alter table public.account_tokens force row level security;
alter table public.rooms force row level security;
alter table public.players force row level security;
alter table public.room_events force row level security;
alter table public.game_rule_sets force row level security;
alter table public.game_states force row level security;
alter table public.role_assignments force row level security;
alter table public.game_player_states force row level security;
alter table public.current_actions force row level security;
alter table public.pending_actions force row level security;
alter table public.game_events force row level security;
alter table public.game_event_visible_players force row level security;
alter table public.game_event_visible_roles force row level security;
alter table public.werewolf_consultation_slots force row level security;
alter table public.day_speech_slots force row level security;
alter table public.final_outcomes force row level security;
alter table public.player_results force row level security;
alter table public.realtime_topics force row level security;
alter table public.realtime_grants force row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
