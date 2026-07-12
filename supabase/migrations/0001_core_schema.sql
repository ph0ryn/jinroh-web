create schema private;

revoke all on schema private from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

create table public.accounts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

create table public.account_tokens (
  token_hash text primary key,
  account_id bigint not null references public.accounts (id),
  token_hash_key_id text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint account_tokens_token_hash_shape_check
    check (token_hash ~ '^[A-Za-z0-9_-]{43,128}$'),
  constraint account_tokens_key_id_shape_check
    check (token_hash_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint account_tokens_timestamps_check
    check (
      (last_used_at is null or last_used_at >= created_at)
      and (revoked_at is null or revoked_at >= created_at)
      and (
        revoked_at is null
        or last_used_at is null
        or last_used_at <= revoked_at
      )
    )
);

create index account_tokens_active_account_idx
  on public.account_tokens (account_id)
  where revoked_at is null;

create table public.rooms (
  id bigint generated always as identity primary key,
  public_room_code text not null,
  host_account_id bigint not null references public.accounts (id),
  target_player_count integer not null default 6,
  waiting_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  snapshot_revision bigint not null default 0,
  status text generated always as (
    case
      when ended_at is not null then 'ended'::text
      when started_at is not null then 'playing'::text
      else 'waiting'::text
    end
  ) stored,
  constraint rooms_public_room_code_shape_check
    check (public_room_code ~ '^[0-9]{6}$'),
  constraint rooms_target_player_count_check
    check (target_player_count between 3 and 10),
  constraint rooms_snapshot_revision_check
    check (snapshot_revision >= 0),
  constraint rooms_lifecycle_check
    check (
      waiting_expires_at >= created_at
      and (started_at is null or started_at >= created_at)
      and (started_at is null or started_at <= waiting_expires_at)
      and (ended_at is null or ended_at >= created_at)
      and (
        ended_at is null
        or started_at is null
        or ended_at >= started_at
      )
      and updated_at >= created_at
      and (started_at is null or updated_at >= started_at)
      and (ended_at is null or updated_at >= ended_at)
    )
);

create unique index rooms_active_code_unique
  on public.rooms (public_room_code)
  where ended_at is null;

create index rooms_code_created_idx
  on public.rooms (public_room_code, created_at desc, id desc);

create index rooms_waiting_expiration_idx
  on public.rooms (waiting_expires_at, id)
  where started_at is null and ended_at is null;

create table public.players (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  account_id bigint not null references public.accounts (id),
  public_player_id text not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  disconnected_at timestamptz,
  last_seen_at timestamptz not null default now(),
  status text generated always as (
    case
      when left_at is not null then 'left'::text
      when disconnected_at is not null then 'disconnected'::text
      else 'joined'::text
    end
  ) stored,
  constraint players_room_id_id_key unique (room_id, id),
  constraint players_room_account_key unique (room_id, account_id),
  constraint players_room_public_player_key unique (room_id, public_player_id),
  constraint players_public_player_id_shape_check
    check (public_player_id ~ '^pl_[A-Za-z0-9_-]{16,64}$'),
  constraint players_display_name_check
    check (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 32
    ),
  constraint players_timestamps_check
    check (
      last_seen_at >= joined_at
      and (disconnected_at is null or disconnected_at >= last_seen_at)
      and (left_at is null or left_at >= last_seen_at)
      and not (disconnected_at is not null and left_at is not null)
    )
);

create unique index players_one_active_room_per_account_idx
  on public.players (account_id)
  where left_at is null;

create index players_room_joined_idx
  on public.players (room_id, joined_at, id);

alter table public.rooms
  add constraint rooms_host_player_fk
  foreign key (id, host_account_id)
  references public.players (room_id, account_id)
  deferrable initially deferred;

create table public.room_events (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  event_kind text not null,
  actor_player_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_events_kind_check
    check (
      event_kind in (
        'room_created',
        'player_joined',
        'player_reconnected',
        'player_disconnected',
        'player_left',
        'game_started',
        'room_ended'
      )
    ),
  constraint room_events_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint room_events_actor_player_fk
    foreign key (room_id, actor_player_id)
    references public.players (room_id, id)
);

create index room_events_room_created_idx
  on public.room_events (room_id, created_at, id);

create table public.game_rule_sets (
  room_id bigint primary key references public.rooms (id),
  role_counts jsonb not null,
  options jsonb not null,
  resolved_role_setup jsonb not null,
  role_registry_version text not null,
  engine_version text not null,
  created_at timestamptz not null default now(),
  constraint game_rule_sets_payload_check
    check (
      jsonb_typeof(role_counts) = 'object'
      and jsonb_typeof(options) = 'object'
      and jsonb_typeof(resolved_role_setup) = 'object'
    ),
  constraint game_rule_sets_role_registry_version_shape_check
    check (
      role_registry_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    ),
  constraint game_rule_sets_engine_version_shape_check
    check (engine_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
);

create table public.game_phase_instances (
  room_id bigint not null references public.rooms (id),
  id uuid not null,
  phase text not null,
  day_number integer not null,
  night_number integer not null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,
  primary key (room_id, id),
  constraint game_phase_instances_room_id_phase_key
    unique (room_id, id, phase),
  constraint game_phase_instances_state_reference_key
    unique (
      room_id,
      id,
      phase,
      day_number,
      night_number,
      started_at,
      ends_at
    ),
  constraint game_phase_instances_phase_check
    check (phase in ('night', 'day', 'voting', 'execution')),
  constraint game_phase_instances_counters_check
    check (
      day_number >= 0
      and night_number >= 1
      and (
        (phase = 'night' and night_number = day_number + 1)
        or (
          phase in ('day', 'voting', 'execution')
          and day_number >= 1
          and night_number = day_number
        )
      )
    ),
  constraint game_phase_instances_timestamps_check
    check (
      ends_at > started_at
      and (ended_at is null or ended_at >= started_at)
    )
);

create index game_phase_instances_room_started_idx
  on public.game_phase_instances (room_id, started_at, id);

create unique index game_phase_instances_one_open_per_room_idx
  on public.game_phase_instances (room_id)
  where ended_at is null;

create table public.game_states (
  room_id bigint primary key references public.rooms (id),
  phase text,
  phase_instance_id uuid,
  phase_started_at timestamptz,
  phase_ends_at timestamptz,
  day_number integer not null default 0,
  night_number integer not null default 1,
  revision bigint not null default 0,
  action_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  status text generated always as (
    case
      when ended_at is null then 'playing'::text
      else 'ended'::text
    end
  ) stored,
  constraint game_states_room_phase_instance_key
    unique (room_id, phase_instance_id),
  constraint game_states_phase_instance_fk
    foreign key (
      room_id,
      phase_instance_id,
      phase,
      day_number,
      night_number,
      phase_started_at,
      phase_ends_at
    )
    references public.game_phase_instances (
      room_id,
      id,
      phase,
      day_number,
      night_number,
      started_at,
      ends_at
    )
    deferrable initially deferred,
  constraint game_states_phase_check
    check (phase is null or phase in ('night', 'day', 'voting', 'execution')),
  constraint game_states_revision_check
    check (revision >= 0 and action_revision >= 0),
  constraint game_states_phase_counters_check
    check (
      day_number >= 0
      and night_number >= 1
      and (
        (phase = 'night' and night_number = day_number + 1)
        or (
          phase in ('day', 'voting', 'execution')
          and day_number >= 1
          and night_number = day_number
        )
        or (
          phase is null
          and night_number between day_number and day_number + 1
        )
      )
    ),
  constraint game_states_lifecycle_check
    check (
      (
        ended_at is null
        and phase is not null
        and phase_instance_id is not null
        and phase_started_at is not null
        and phase_ends_at is not null
      )
      or (
        ended_at is not null
        and phase is null
        and phase_instance_id is null
        and phase_started_at is null
        and phase_ends_at is null
      )
    ),
  constraint game_states_timestamps_check
    check (
      updated_at >= created_at
      and (phase_started_at is null or phase_started_at >= created_at)
      and (phase_started_at is null or updated_at >= phase_started_at)
      and (
        phase_ends_at is null
        or (
          phase_started_at is not null
          and phase_ends_at >= phase_started_at
        )
      )
      and (ended_at is null or ended_at >= created_at)
      and (ended_at is null or updated_at >= ended_at)
    )
);

create table public.role_assignments (
  room_id bigint not null references public.rooms (id),
  player_id bigint not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, player_id),
  constraint role_assignments_player_fk
    foreign key (room_id, player_id)
    references public.players (room_id, id),
  constraint role_assignments_role_id_shape_check
    check (role_id ~ '^[a-z][a-z0-9_]{0,63}$')
);

create index role_assignments_room_role_idx
  on public.role_assignments (room_id, role_id, player_id);

create table public.game_player_states (
  room_id bigint not null references public.rooms (id),
  player_id bigint not null,
  alive boolean not null default true,
  primary key (room_id, player_id),
  constraint game_player_states_assignment_fk
    foreign key (room_id, player_id)
    references public.role_assignments (room_id, player_id)
);

create index game_player_states_room_alive_idx
  on public.game_player_states (room_id, alive, player_id);

create table public.current_actions (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  phase_instance_id uuid not null,
  action_key text not null,
  action_kind text not null,
  resolver_role_id text,
  actor_player_id bigint,
  actor_role_id text,
  actor_state_requirement text not null,
  target_state_requirement text not null,
  target_kind text not null,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  constraint current_actions_room_id_id_key unique (room_id, id),
  constraint current_actions_room_phase_key
    unique (room_id, phase_instance_id, action_key),
  constraint current_actions_game_phase_fk
    foreign key (room_id, phase_instance_id)
    references public.game_phase_instances (room_id, id),
  constraint current_actions_actor_player_fk
    foreign key (room_id, actor_player_id)
    references public.game_player_states (room_id, player_id),
  constraint current_actions_action_key_shape_check
    check (action_key ~ '^[a-z0-9][a-z0-9:_-]{0,127}$'),
  constraint current_actions_action_kind_shape_check
    check (action_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint current_actions_resolver_role_id_shape_check
    check (
      resolver_role_id is null
      or resolver_role_id ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint current_actions_actor_role_id_shape_check
    check (
      actor_role_id is null
      or actor_role_id ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint current_actions_actor_check
    check (actor_player_id is not null or actor_role_id is not null),
  constraint current_actions_actor_state_requirement_check
    check (actor_state_requirement in ('alive', 'assigned')),
  constraint current_actions_target_state_requirement_check
    check (target_state_requirement in ('alive', 'assigned')),
  constraint current_actions_target_kind_check
    check (target_kind in ('none', 'single_player')),
  constraint current_actions_closes_at_check
    check (closes_at is null or closes_at >= created_at)
);

create table public.current_action_eligible_players (
  room_id bigint not null,
  current_action_id bigint not null,
  player_id bigint not null,
  primary key (room_id, current_action_id, player_id),
  constraint current_action_eligible_players_action_fk
    foreign key (room_id, current_action_id)
    references public.current_actions (room_id, id)
    on delete cascade,
  constraint current_action_eligible_players_player_fk
    foreign key (room_id, player_id)
    references public.game_player_states (room_id, player_id)
);

create table public.pending_actions (
  current_action_id bigint primary key,
  room_id bigint not null,
  submitter_player_id bigint not null,
  target_player_id bigint,
  submitted_at timestamptz not null default now(),
  constraint pending_actions_action_fk
    foreign key (room_id, current_action_id)
    references public.current_actions (room_id, id)
    on delete cascade,
  constraint pending_actions_submitter_player_fk
    foreign key (room_id, submitter_player_id)
    references public.game_player_states (room_id, player_id),
  constraint pending_actions_target_eligibility_fk
    foreign key (room_id, current_action_id, target_player_id)
    references public.current_action_eligible_players (
      room_id,
      current_action_id,
      player_id
    )
);

create index pending_actions_room_submitted_idx
  on public.pending_actions (room_id, submitted_at, current_action_id);

create table public.resolved_actions (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  phase_instance_id uuid not null,
  phase text not null,
  action_key text not null,
  action_kind text not null,
  resolver_role_id text,
  actor_player_id bigint,
  actor_role_id text,
  resolution_status text not null,
  target_player_id bigint,
  resolved_at timestamptz not null default now(),
  constraint resolved_actions_room_phase_key
    unique (room_id, phase_instance_id, action_key),
  constraint resolved_actions_phase_instance_fk
    foreign key (room_id, phase_instance_id, phase)
    references public.game_phase_instances (room_id, id, phase),
  constraint resolved_actions_actor_player_fk
    foreign key (room_id, actor_player_id)
    references public.game_player_states (room_id, player_id),
  constraint resolved_actions_target_player_fk
    foreign key (room_id, target_player_id)
    references public.game_player_states (room_id, player_id),
  constraint resolved_actions_phase_check
    check (phase in ('night', 'day', 'voting', 'execution')),
  constraint resolved_actions_action_key_shape_check
    check (action_key ~ '^[a-z0-9][a-z0-9:_-]{0,127}$'),
  constraint resolved_actions_action_kind_shape_check
    check (action_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint resolved_actions_resolver_role_id_shape_check
    check (
      resolver_role_id is null
      or resolver_role_id ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint resolved_actions_actor_role_id_shape_check
    check (
      actor_role_id is null
      or actor_role_id ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint resolved_actions_actor_check
    check (actor_player_id is not null or actor_role_id is not null),
  constraint resolved_actions_resolution_check
    check (
      (resolution_status = 'submitted' and actor_player_id is not null)
      or (
        resolution_status = 'missing'
        and target_player_id is null
      )
    )
);

create index resolved_actions_room_history_idx
  on public.resolved_actions (room_id, resolved_at, id);

create table public.game_events (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  phase_instance_id uuid not null,
  event_kind text not null,
  visibility text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint game_events_room_id_id_key unique (room_id, id),
  constraint game_events_phase_instance_fk
    foreign key (room_id, phase_instance_id)
    references public.game_phase_instances (room_id, id),
  constraint game_events_event_kind_shape_check
    check (event_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint game_events_visibility_check
    check (visibility in ('public', 'private', 'internal')),
  constraint game_events_payload_check
    check (jsonb_typeof(payload) = 'object')
);

create index game_events_room_created_idx
  on public.game_events (room_id, created_at, id);

create index game_events_room_phase_kind_idx
  on public.game_events (room_id, phase_instance_id, event_kind, id);

create table public.game_event_visible_players (
  room_id bigint not null,
  game_event_id bigint not null,
  player_id bigint not null,
  primary key (room_id, game_event_id, player_id),
  constraint game_event_visible_players_event_fk
    foreign key (room_id, game_event_id)
    references public.game_events (room_id, id)
    on delete cascade,
  constraint game_event_visible_players_player_fk
    foreign key (room_id, player_id)
    references public.game_player_states (room_id, player_id)
);

create index game_event_visible_players_viewer_idx
  on public.game_event_visible_players (room_id, player_id, game_event_id);

create table public.game_event_visible_roles (
  room_id bigint not null,
  game_event_id bigint not null,
  role_id text not null,
  primary key (room_id, game_event_id, role_id),
  constraint game_event_visible_roles_event_fk
    foreign key (room_id, game_event_id)
    references public.game_events (room_id, id)
    on delete cascade,
  constraint game_event_visible_roles_role_id_shape_check
    check (role_id ~ '^[a-z][a-z0-9_]{0,63}$')
);

create index game_event_visible_roles_viewer_idx
  on public.game_event_visible_roles (room_id, role_id, game_event_id);

create table public.night_conversation_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id),
  night_number integer not null,
  conversation_group_id text not null,
  sender_player_id bigint not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint night_conversation_messages_sender_player_fk
    foreign key (room_id, sender_player_id)
    references public.game_player_states (room_id, player_id),
  constraint night_conversation_messages_night_number_check
    check (night_number >= 1),
  constraint night_conversation_messages_group_id_shape_check
    check (conversation_group_id ~ '^[a-z][a-z0-9_:-]{0,63}$'),
  constraint night_conversation_messages_body_check
    check (
      body = btrim(body)
      and char_length(body) between 1 and 100
    )
);

create index night_conversation_messages_view_idx
  on public.night_conversation_messages (
    room_id,
    night_number,
    conversation_group_id,
    created_at,
    id
  );

create table public.day_speech_slots (
  room_id bigint not null,
  phase_instance_id uuid not null,
  slot_index integer not null,
  speaker_player_id bigint not null,
  primary key (room_id, phase_instance_id, slot_index),
  constraint day_speech_slots_game_phase_fk
    foreign key (room_id, phase_instance_id)
    references public.game_phase_instances (room_id, id),
  constraint day_speech_slots_speaker_player_fk
    foreign key (room_id, speaker_player_id)
    references public.game_player_states (room_id, player_id),
  constraint day_speech_slots_slot_index_check
    check (slot_index >= 0)
);

create table public.final_outcomes (
  room_id bigint primary key references public.rooms (id),
  winner_team text not null,
  created_at timestamptz not null default now(),
  constraint final_outcomes_winner_team_shape_check
    check (winner_team ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table public.player_results (
  room_id bigint not null references public.final_outcomes (room_id),
  player_id bigint not null,
  result text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, player_id),
  constraint player_results_player_fk
    foreign key (room_id, player_id)
    references public.game_player_states (room_id, player_id),
  constraint player_results_result_check
    check (result in ('win', 'lose', 'draw', 'special'))
);

create table public.realtime_topics (
  topic text primary key,
  room_id bigint not null references public.rooms (id),
  scope text not null,
  role_id text,
  player_id bigint,
  snapshot_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint realtime_topics_player_fk
    foreign key (room_id, player_id)
    references public.players (room_id, id),
  constraint realtime_topics_scope_check
    check (scope in ('room', 'player_private', 'role_private')),
  constraint realtime_topics_snapshot_revision_check
    check (snapshot_revision >= 0),
  constraint realtime_topics_target_check
    check (
      (
        scope = 'room'
        and player_id is null
        and role_id is null
        and topic ~ '^room:[A-Za-z0-9_-]{32,128}$'
      )
      or (
        scope = 'player_private'
        and player_id is not null
        and role_id is null
        and topic ~ '^player:[A-Za-z0-9_-]{32,128}$'
      )
      or (
        scope = 'role_private'
        and player_id is null
        and role_id is not null
        and role_id ~ '^[a-z][a-z0-9_]{0,63}$'
        and topic ~ '^role:[A-Za-z0-9_-]{32,128}$'
      )
    )
);

create unique index realtime_topics_room_unique
  on public.realtime_topics (room_id)
  where scope = 'room';

create unique index realtime_topics_player_unique
  on public.realtime_topics (room_id, player_id)
  where scope = 'player_private';

create unique index realtime_topics_role_unique
  on public.realtime_topics (room_id, role_id)
  where scope = 'role_private';

create index realtime_topics_room_scope_idx
  on public.realtime_topics (room_id, scope, topic);

create table public.realtime_grants (
  grant_id uuid primary key default gen_random_uuid(),
  room_id bigint not null,
  player_id bigint not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint realtime_grants_player_fk
    foreign key (room_id, player_id)
    references public.players (room_id, id),
  constraint realtime_grants_timestamps_check
    check (
      expires_at > created_at
      and (revoked_at is null or revoked_at >= created_at)
    )
);

create index realtime_grants_player_active_idx
  on public.realtime_grants (room_id, player_id, expires_at desc)
  where revoked_at is null;

create index realtime_grants_expiration_idx
  on public.realtime_grants (expires_at, grant_id)
  where revoked_at is null;

create index realtime_grants_revoked_cleanup_idx
  on public.realtime_grants (revoked_at, grant_id)
  where revoked_at is not null;

alter table public.accounts enable row level security;
alter table public.accounts force row level security;
alter table public.account_tokens enable row level security;
alter table public.account_tokens force row level security;
alter table public.rooms enable row level security;
alter table public.rooms force row level security;
alter table public.players enable row level security;
alter table public.players force row level security;
alter table public.room_events enable row level security;
alter table public.room_events force row level security;
alter table public.game_rule_sets enable row level security;
alter table public.game_rule_sets force row level security;
alter table public.game_phase_instances enable row level security;
alter table public.game_phase_instances force row level security;
alter table public.game_states enable row level security;
alter table public.game_states force row level security;
alter table public.role_assignments enable row level security;
alter table public.role_assignments force row level security;
alter table public.game_player_states enable row level security;
alter table public.game_player_states force row level security;
alter table public.current_actions enable row level security;
alter table public.current_actions force row level security;
alter table public.current_action_eligible_players enable row level security;
alter table public.current_action_eligible_players force row level security;
alter table public.pending_actions enable row level security;
alter table public.pending_actions force row level security;
alter table public.resolved_actions enable row level security;
alter table public.resolved_actions force row level security;
alter table public.game_events enable row level security;
alter table public.game_events force row level security;
alter table public.game_event_visible_players enable row level security;
alter table public.game_event_visible_players force row level security;
alter table public.game_event_visible_roles enable row level security;
alter table public.game_event_visible_roles force row level security;
alter table public.night_conversation_messages enable row level security;
alter table public.night_conversation_messages force row level security;
alter table public.day_speech_slots enable row level security;
alter table public.day_speech_slots force row level security;
alter table public.final_outcomes enable row level security;
alter table public.final_outcomes force row level security;
alter table public.player_results enable row level security;
alter table public.player_results force row level security;
alter table public.realtime_topics enable row level security;
alter table public.realtime_topics force row level security;
alter table public.realtime_grants enable row level security;
alter table public.realtime_grants force row level security;

revoke all on all tables in schema public
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema public
  from public, anon, authenticated, service_role;
