alter table public.role_assignments
  drop constraint if exists role_assignments_role_id_check;

alter table public.role_assignments
  add constraint role_assignments_role_id_shape_check
  check (role_id ~ '^[a-z][a-z0-9_]*$');

alter table public.current_actions
  drop constraint if exists current_actions_action_kind_check;

alter table public.current_actions
  add constraint current_actions_action_kind_shape_check
  check (action_kind ~ '^[a-z][a-z0-9_]*$');

alter table public.game_player_states
  drop constraint if exists game_player_states_death_reason_check;

alter table public.game_player_states
  add constraint game_player_states_death_reason_shape_check
  check (death_reason is null or death_reason ~ '^[a-z][a-z0-9_]*$');

alter table public.final_outcomes
  drop constraint if exists final_outcomes_winner_team_check;

alter table public.final_outcomes
  add constraint final_outcomes_winner_team_shape_check
  check (winner_team ~ '^[a-z][a-z0-9_]*$');

alter table public.player_results
  drop constraint if exists player_results_result_check;

alter table public.player_results
  add constraint player_results_result_shape_check
  check (result ~ '^[a-z][a-z0-9_]*$');

alter table public.game_events
  drop constraint if exists game_events_event_kind_check;

alter table public.game_events
  add constraint game_events_event_kind_shape_check
  check (event_kind ~ '^[a-z][a-z0-9_]*$');
