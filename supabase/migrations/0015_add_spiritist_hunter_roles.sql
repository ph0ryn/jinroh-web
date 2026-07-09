alter table public.game_player_states
  drop constraint if exists game_player_states_death_reason_check;

alter table public.game_player_states
  add constraint game_player_states_death_reason_check
  check (
    death_reason is null
    or death_reason in ('attack', 'execution', 'retaliation', 'rule_effect')
  );

alter table public.role_assignments
  drop constraint if exists role_assignments_role_id_check;

alter table public.role_assignments
  add constraint role_assignments_role_id_check
  check (
    role_id in (
      'werewolf',
      'villager',
      'madman',
      'seer',
      'guard',
      'spiritist',
      'hunter',
      'fox'
    )
  );

alter table public.current_actions
  drop constraint if exists current_actions_action_kind_check;

alter table public.current_actions
  add constraint current_actions_action_kind_check
  check (
    action_kind in (
      'first_night_ready',
      'attack',
      'inspect',
      'guard',
      'day_ready',
      'end_speech',
      'vote',
      'execution_skip',
      'hunter_retaliate'
    )
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
      'game_started',
      'spiritist_result'
    )
  );
