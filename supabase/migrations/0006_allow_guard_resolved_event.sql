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
      'guard_resolved',
      'attack_guarded',
      'player_executed',
      'peaceful_night',
      'game_started'
    )
  );
