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
      'execution_skip'
    )
  );
