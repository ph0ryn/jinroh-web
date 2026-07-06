create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.account_tokens (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.accounts(id),
  token_hash text not null unique,
  token_hash_key_id text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.rooms (
  id bigint generated always as identity primary key,
  public_room_code text not null,
  status text not null default 'lobby',
  host_account_id bigint not null references public.accounts(id),
  realtime_topic text not null unique,
  lobby_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  disbanded_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint rooms_status_check check (status in ('lobby', 'playing', 'disbanded', 'ended')),
  constraint rooms_public_room_code_check check (public_room_code ~ '^[0-9]{6}$')
);

create unique index if not exists rooms_active_code_unique
  on public.rooms(public_room_code)
  where status in ('lobby', 'playing');

create index if not exists rooms_status_lobby_expires_at_idx
  on public.rooms(status, lobby_expires_at);

create index if not exists rooms_host_account_id_idx
  on public.rooms(host_account_id);

create table if not exists public.players (
  id bigint generated always as identity primary key,
  public_player_id text not null,
  room_id bigint not null references public.rooms(id),
  account_id bigint not null references public.accounts(id),
  display_name text not null,
  status text not null default 'joined',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  disconnected_at timestamptz,
  last_seen_at timestamptz not null default now(),
  constraint players_status_check check (status in ('joined', 'disconnected', 'left')),
  constraint players_display_name_length check (char_length(display_name) between 1 and 32),
  unique (room_id, account_id),
  unique (room_id, public_player_id)
);

create index if not exists players_room_id_idx on public.players(room_id);
create index if not exists players_account_id_idx on public.players(account_id);

create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  event_kind text not null,
  actor_player_id bigint references public.players(id),
  actor_account_id bigint references public.accounts(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_events_room_created_idx
  on public.room_events(room_id, created_at);

create table if not exists public.game_rule_sets (
  id bigint generated always as identity primary key,
  room_id bigint not null unique references public.rooms(id),
  role_counts jsonb not null,
  options jsonb not null,
  role_registry_version text not null,
  engine_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.game_states (
  id bigint generated always as identity primary key,
  room_id bigint not null unique references public.rooms(id),
  status text not null default 'waiting',
  phase text,
  phase_instance_id uuid,
  phase_started_at timestamptz,
  phase_ends_at timestamptz,
  day_number integer not null default 0,
  night_number integer not null default 0,
  revision integer not null default 0,
  resolved_role_setup jsonb not null default '{}'::jsonb,
  final_outcome_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_states_status_check check (status in ('waiting', 'assigning_roles', 'playing', 'ended')),
  constraint game_states_phase_check check (phase is null or phase in ('night', 'day', 'voting', 'execution'))
);

create index if not exists game_states_status_phase_ends_idx
  on public.game_states(status, phase_ends_at);

create table if not exists public.role_assignments (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  player_id bigint not null references public.players(id),
  role_id text not null,
  created_at timestamptz not null default now(),
  unique (room_id, player_id)
);

create index if not exists role_assignments_room_id_idx on public.role_assignments(room_id);
create index if not exists role_assignments_player_id_idx on public.role_assignments(player_id);

create table if not exists public.game_player_states (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  player_id bigint not null references public.players(id),
  alive boolean not null default true,
  death_reason text,
  died_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_player_states_death_reason_check check (
    death_reason is null or death_reason in ('attack', 'execution', 'rule_effect')
  ),
  unique (room_id, player_id)
);

create index if not exists game_player_states_room_alive_idx
  on public.game_player_states(room_id, alive);

create table if not exists public.current_actions (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  phase_instance_id uuid not null,
  action_key text not null,
  action_kind text not null,
  actor_player_id bigint references public.players(id),
  actor_role_id text,
  target_kind text not null,
  eligible_target_player_ids bigint[] not null default '{}',
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  constraint current_actions_action_kind_check check (
    action_kind in (
      'first_night_ready',
      'inspect',
      'guard',
      'attack',
      'day_ready',
      'vote',
      'execution_skip'
    )
  ),
  constraint current_actions_target_kind_check check (target_kind in ('none', 'single_player')),
  unique (room_id, action_key)
);

create index if not exists current_actions_room_phase_idx
  on public.current_actions(room_id, phase_instance_id);

create table if not exists public.pending_actions (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  current_action_id bigint not null references public.current_actions(id),
  submitter_player_id bigint not null references public.players(id),
  target_player_id bigint references public.players(id),
  payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (current_action_id)
);

create index if not exists pending_actions_room_phase_idx
  on public.pending_actions(room_id, submitted_at);

create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  phase_instance_id uuid,
  event_kind text not null,
  visibility text not null,
  payload jsonb not null default '{}'::jsonb,
  public_message text,
  created_at timestamptz not null default now(),
  constraint game_events_visibility_check check (visibility in ('public', 'private', 'internal'))
);

create index if not exists game_events_room_created_idx
  on public.game_events(room_id, created_at);

create table if not exists public.game_event_visible_players (
  game_event_id bigint not null references public.game_events(id) on delete cascade,
  player_id bigint not null references public.players(id),
  primary key (game_event_id, player_id)
);

create index if not exists game_event_visible_players_player_idx
  on public.game_event_visible_players(player_id, game_event_id);

create table if not exists public.game_event_visible_roles (
  game_event_id bigint not null references public.game_events(id) on delete cascade,
  role_id text not null,
  primary key (game_event_id, role_id)
);

create index if not exists game_event_visible_roles_role_idx
  on public.game_event_visible_roles(role_id, game_event_id);

create table if not exists public.werewolf_consultation_slots (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  night_number integer not null,
  sender_player_id bigint not null references public.players(id),
  template_id text not null,
  label text not null,
  value text,
  status text not null default 'empty',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint werewolf_consultation_slots_status_check check (
    status in ('empty', 'submitted', 'retracted', 'resubmitted')
  ),
  unique (room_id, night_number, sender_player_id, template_id)
);

create index if not exists werewolf_consultation_slots_room_night_idx
  on public.werewolf_consultation_slots(room_id, night_number);

create table if not exists public.day_speech_slots (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  phase_instance_id uuid not null,
  slot_index integer not null,
  speaker_player_id bigint not null references public.players(id),
  starts_at timestamptz,
  ends_at timestamptz,
  finished_at timestamptz,
  unique (room_id, phase_instance_id, slot_index)
);

create table if not exists public.final_outcomes (
  id bigint generated always as identity primary key,
  room_id bigint not null unique references public.rooms(id),
  winner_team text not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint final_outcomes_winner_team_check check (winner_team in ('villagers', 'werewolves', 'fox'))
);

alter table public.game_states
  add constraint game_states_final_outcome_id_fk
  foreign key (final_outcome_id) references public.final_outcomes(id);

create table if not exists public.player_results (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  player_id bigint not null references public.players(id),
  result text not null,
  created_at timestamptz not null default now(),
  constraint player_results_result_check check (result in ('win', 'lose')),
  unique (room_id, player_id)
);

create table if not exists public.realtime_topics (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  topic text not null unique,
  scope text not null,
  role_id text,
  player_id bigint references public.players(id),
  created_at timestamptz not null default now(),
  constraint realtime_topics_scope_check check (scope in ('room', 'player_private', 'role_private'))
);

create table if not exists public.realtime_grants (
  id bigint generated always as identity primary key,
  grant_id uuid not null default gen_random_uuid() unique,
  topic_id bigint not null references public.realtime_topics(id),
  player_id bigint not null references public.players(id),
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint realtime_grants_scope_check check (scope in ('room', 'player_private', 'role_private'))
);

create index if not exists realtime_grants_grant_expires_idx
  on public.realtime_grants(grant_id, expires_at);

alter table public.accounts enable row level security;
alter table public.account_tokens enable row level security;
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.room_events enable row level security;
alter table public.game_rule_sets enable row level security;
alter table public.game_states enable row level security;
alter table public.role_assignments enable row level security;
alter table public.game_player_states enable row level security;
alter table public.current_actions enable row level security;
alter table public.pending_actions enable row level security;
alter table public.game_events enable row level security;
alter table public.game_event_visible_players enable row level security;
alter table public.game_event_visible_roles enable row level security;
alter table public.werewolf_consultation_slots enable row level security;
alter table public.day_speech_slots enable row level security;
alter table public.final_outcomes enable row level security;
alter table public.player_results enable row level security;
alter table public.realtime_topics enable row level security;
alter table public.realtime_grants enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();

drop trigger if exists game_states_touch_updated_at on public.game_states;
create trigger game_states_touch_updated_at
  before update on public.game_states
  for each row execute function public.touch_updated_at();

drop trigger if exists game_player_states_touch_updated_at on public.game_player_states;
create trigger game_player_states_touch_updated_at
  before update on public.game_player_states
  for each row execute function public.touch_updated_at();

drop trigger if exists consultation_touch_updated_at on public.werewolf_consultation_slots;
create trigger consultation_touch_updated_at
  before update on public.werewolf_consultation_slots
  for each row execute function public.touch_updated_at();
