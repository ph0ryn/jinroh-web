alter table public.werewolf_consultation_slots
  add column if not exists values jsonb not null default '{}'::jsonb,
  add column if not exists submission_count integer not null default 0,
  add column if not exists retraction_used boolean not null default false,
  add column if not exists submitted_at timestamptz,
  add column if not exists retracted_at timestamptz;

update public.werewolf_consultation_slots
set status = 'submitted',
    submission_count = greatest(submission_count, 2),
    retraction_used = true
where status = 'resubmitted';

update public.werewolf_consultation_slots
set submission_count = greatest(submission_count, 1)
where status = 'submitted';

update public.werewolf_consultation_slots
set submission_count = greatest(submission_count, 1),
    retraction_used = true
where status = 'retracted';

alter table public.werewolf_consultation_slots
  drop constraint if exists werewolf_consultation_slots_status_check,
  drop constraint if exists werewolf_consultation_slots_values_object_check,
  drop constraint if exists werewolf_consultation_slots_transition_check;

alter table public.werewolf_consultation_slots
  add constraint werewolf_consultation_slots_status_check
    check (status in ('empty', 'submitted', 'retracted')),
  add constraint werewolf_consultation_slots_values_object_check
    check (jsonb_typeof(values) = 'object'),
  add constraint werewolf_consultation_slots_transition_check
    check (
      (
        status = 'empty'
        and submission_count = 0
        and retraction_used = false
      )
      or (
        status = 'submitted'
        and (
          (
            submission_count = 1
            and retraction_used = false
          )
          or (
            submission_count = 2
            and retraction_used = true
          )
        )
      )
      or (
        status = 'retracted'
        and submission_count = 1
        and retraction_used = true
      )
    );

create index if not exists werewolf_consultation_slots_sender_player_idx
  on public.werewolf_consultation_slots(sender_player_id);

create or replace function public.app_submit_werewolf_consultation(
  p_account_id bigint,
  p_room_code text,
  p_phase_instance_id uuid,
  p_expected_revision integer,
  p_night_number integer,
  p_template_id text,
  p_label text,
  p_values jsonb,
  p_operation text
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
  v_event_id bigint;
  v_field jsonb;
  v_field_count integer;
  v_field_id text;
  v_field_kind text;
  v_field_value text;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_slot public.werewolf_consultation_slots%rowtype;
  v_state public.game_states%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_template jsonb;
  v_template_fields jsonb;
  v_value_count integer;
  v_value_player_id bigint;
begin
  if p_operation not in ('submit', 'retract') then
    raise exception 'Consultation operation is invalid.';
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
    or v_state.revision <> p_expected_revision
    or v_state.night_number <> p_night_number
  then
    raise exception 'Consultation belongs to a stale phase.';
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

  if v_submitter_role_id <> 'werewolf' or coalesce(v_submitter_alive, false) = false then
    raise exception 'Consultation is not allowed.';
  end if;

  select template
  into v_template
  from jsonb_array_elements(
    coalesce(v_state.resolved_role_setup->'werewolfConsultationTemplates', '[]'::jsonb)
  ) as template
  where template->>'id' = p_template_id
  limit 1;

  if v_template is null then
    raise exception 'Consultation template is not available.';
  end if;

  if coalesce((v_template->>'normalNightOnly')::boolean, false) and v_state.night_number < 2 then
    raise exception 'Consultation template is not available.';
  end if;

  if p_operation = 'submit' then
    p_values := coalesce(p_values, '{}'::jsonb);

    if jsonb_typeof(p_values) <> 'object' then
      raise exception 'Consultation values are invalid.';
    end if;

    v_template_fields := coalesce(v_template->'fields', '[]'::jsonb);

    select count(*)
    into v_field_count
    from jsonb_array_elements(v_template_fields);

    select count(*)
    into v_value_count
    from jsonb_object_keys(p_values);

    if v_field_count <> v_value_count then
      raise exception 'Consultation values do not match the template.';
    end if;

    for v_field in
      select value from jsonb_array_elements(v_template_fields)
    loop
      v_field_id := v_field->>'id';
      v_field_kind := v_field->>'kind';

      if v_field_id is null or jsonb_typeof(p_values->v_field_id) <> 'string' then
        raise exception 'Consultation value is invalid.';
      end if;

      v_field_value := p_values->>v_field_id;

      if v_field_kind = 'player' then
        if v_field_value !~ '^[0-9]+$' then
          raise exception 'Consultation player value is invalid.';
        end if;

        v_value_player_id := v_field_value::bigint;

        if v_field->>'candidates' = 'sender_or_werewolf_ally' then
          if not exists (
            select 1
            from public.role_assignments
            join public.game_player_states
              on game_player_states.room_id = role_assignments.room_id
             and game_player_states.player_id = role_assignments.player_id
            where role_assignments.room_id = v_room.id
              and role_assignments.player_id = v_value_player_id
              and role_assignments.role_id = 'werewolf'
              and game_player_states.alive = true
          ) then
            raise exception 'Consultation player value is invalid.';
          end if;
        else
          if not exists (
            select 1
            from public.game_player_states
            where game_player_states.room_id = v_room.id
              and game_player_states.player_id = v_value_player_id
              and game_player_states.alive = true
          ) then
            raise exception 'Consultation player value is invalid.';
          end if;
        end if;
      elsif v_field_kind = 'role' then
        if not exists (
          select 1
          from public.role_assignments
          where role_assignments.room_id = v_room.id
            and role_assignments.role_id = v_field_value
        ) then
          raise exception 'Consultation role value is invalid.';
        end if;
      elsif v_field_kind = 'inspection_view' then
        if v_field_value not in ('human', 'werewolf') then
          raise exception 'Consultation inspection value is invalid.';
        end if;
      else
        raise exception 'Consultation field is invalid.';
      end if;
    end loop;
  end if;

  if p_operation = 'submit' then
    insert into public.werewolf_consultation_slots (
      room_id,
      night_number,
      sender_player_id,
      template_id,
      label,
      value,
      values,
      status,
      submission_count,
      retraction_used,
      submitted_at
    )
    values (
      v_room.id,
      p_night_number,
      v_player.id,
      p_template_id,
      p_label,
      p_values::text,
      p_values,
      'submitted',
      1,
      false,
      now()
    )
    on conflict (room_id, night_number, sender_player_id, template_id) do nothing
    returning * into v_slot;

    if v_slot.id is null then
      select *
      into v_slot
      from public.werewolf_consultation_slots
      where werewolf_consultation_slots.room_id = v_room.id
        and werewolf_consultation_slots.night_number = p_night_number
        and werewolf_consultation_slots.sender_player_id = v_player.id
        and werewolf_consultation_slots.template_id = p_template_id
      for update;

      if not found then
        raise exception 'Consultation slot not found.';
      end if;

      if v_slot.status = 'empty'
        and v_slot.submission_count = 0
        and v_slot.retraction_used = false
      then
        update public.werewolf_consultation_slots
        set label = p_label,
            status = 'submitted',
            submission_count = 1,
            submitted_at = now(),
            value = p_values::text,
            values = p_values
        where werewolf_consultation_slots.id = v_slot.id
        returning * into v_slot;
      elsif v_slot.status = 'retracted'
        and v_slot.submission_count = 1
        and v_slot.retraction_used = true
      then
        update public.werewolf_consultation_slots
        set label = p_label,
            status = 'submitted',
            submission_count = 2,
            submitted_at = now(),
            value = p_values::text,
            values = p_values
        where werewolf_consultation_slots.id = v_slot.id
        returning * into v_slot;
      else
        raise exception 'Consultation transition is not allowed.';
      end if;
    end if;
  else
    select *
    into v_slot
    from public.werewolf_consultation_slots
    where werewolf_consultation_slots.room_id = v_room.id
      and werewolf_consultation_slots.night_number = p_night_number
      and werewolf_consultation_slots.sender_player_id = v_player.id
      and werewolf_consultation_slots.template_id = p_template_id
    for update;

    if not found then
      raise exception 'Consultation slot not found.';
    end if;

    if v_slot.status <> 'submitted'
      or v_slot.submission_count <> 1
      or v_slot.retraction_used = true
    then
      raise exception 'Consultation transition is not allowed.';
    end if;

    update public.werewolf_consultation_slots
    set status = 'retracted',
        retraction_used = true,
        retracted_at = now()
    where werewolf_consultation_slots.id = v_slot.id
    returning * into v_slot;
  end if;

  update public.game_states
  set revision = v_state.revision + 1
  where game_states.id = v_state.id;

  insert into public.game_events (
    event_kind,
    payload,
    phase_instance_id,
    public_message,
    room_id,
    visibility
  )
  values (
    case
      when p_operation = 'submit' then 'werewolf_consultation_submitted'
      else 'werewolf_consultation_retracted'
    end,
    jsonb_build_object(
      'nightNumber',
      p_night_number,
      'operation',
      p_operation,
      'templateId',
      p_template_id
    ),
    p_phase_instance_id,
    null,
    v_room.id,
    'private'
  )
  returning game_events.id into v_event_id;

  insert into public.game_event_visible_roles (game_event_id, role_id)
  values (v_event_id, 'werewolf');

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

revoke all on function public.app_submit_werewolf_consultation(
  bigint,
  text,
  uuid,
  integer,
  integer,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function public.app_submit_werewolf_consultation(
  bigint,
  text,
  uuid,
  integer,
  integer,
  text,
  text,
  jsonb,
  text
) to service_role;
