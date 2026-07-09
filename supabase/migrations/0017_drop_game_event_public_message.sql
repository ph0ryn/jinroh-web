create or replace function public.app_insert_game_events(
  p_room_id bigint,
  p_phase_instance_id uuid,
  p_events jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event jsonb;
  v_event_id bigint;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Events payload must be an array.';
  end if;

  for v_event in
    select value
    from jsonb_array_elements(p_events) as event(value)
  loop
    insert into public.game_events (
      event_kind,
      payload,
      phase_instance_id,
      room_id,
      visibility
    )
    values (
      v_event ->> 'event_kind',
      coalesce(v_event -> 'payload', '{}'::jsonb),
      p_phase_instance_id,
      p_room_id,
      v_event ->> 'visibility'
    )
    returning game_events.id into v_event_id;

    insert into public.game_event_visible_players (game_event_id, player_id)
    select v_event_id, player_id.value::bigint
    from jsonb_array_elements_text(
      coalesce(v_event -> 'visible_to_player_ids', '[]'::jsonb)
    ) as player_id(value);

    insert into public.game_event_visible_roles (game_event_id, role_id)
    select v_event_id, role_id.value
    from jsonb_array_elements_text(
      coalesce(v_event -> 'visible_to_role_ids', '[]'::jsonb)
    ) as role_id(value);
  end loop;
end;
$$;

alter table public.game_events
  drop column if exists public_message;
