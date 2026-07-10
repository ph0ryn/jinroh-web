


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."app_cleanup_expired_lobbies"("p_limit" integer DEFAULT 50) RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return query
    with expired_rooms as (
      select rooms.id
      from public.rooms
      where rooms.status = 'lobby'
        and rooms.lobby_expires_at <= now()
      order by rooms.lobby_expires_at asc
      limit v_limit
      for update skip locked
    ),
    updated_rooms as (
      update public.rooms
      set disbanded_at = now(),
          status = 'disbanded'
      from expired_rooms
      where rooms.id = expired_rooms.id
        and rooms.status = 'lobby'
      returning rooms.*
    ),
    inserted_events as (
      insert into public.room_events (
        actor_account_id,
        actor_player_id,
        event_kind,
        payload,
        room_id
      )
      select
        null,
        null,
        'room_disbanded',
        '{"reason":"lobby_expired_cleanup"}'::jsonb,
        updated_rooms.id
      from updated_rooms
      returning room_events.room_id
    )
    select
      updated_rooms.id,
      updated_rooms.public_room_code,
      updated_rooms.status,
      updated_rooms.host_account_id,
      updated_rooms.realtime_topic,
      updated_rooms.lobby_expires_at,
      null::bigint,
      'room_disbanded'::text
    from updated_rooms
    join inserted_events
      on inserted_events.room_id = updated_rooms.id;
end;
$$;


ALTER FUNCTION "public"."app_cleanup_expired_lobbies"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_create_room"("p_account_id" bigint, "p_public_room_code" "text", "p_realtime_topic" "text", "p_lobby_expires_at" timestamp with time zone, "p_public_player_id" "text", "p_display_name" "text", "p_target_player_count" integer) RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_player_id bigint;
  v_room public.rooms%rowtype;
begin
  if p_target_player_count is null
    or p_target_player_count < 3
    or p_target_player_count > 10
  then
    raise exception 'Target player count must be between 3 and 10.';
  end if;

  insert into public.rooms (
    host_account_id,
    lobby_expires_at,
    public_room_code,
    realtime_topic,
    status,
    target_player_count
  )
  values (
    p_account_id,
    p_lobby_expires_at,
    p_public_room_code,
    p_realtime_topic,
    'lobby',
    p_target_player_count
  )
  returning * into v_room;

  insert into public.players (
    account_id,
    display_name,
    public_player_id,
    room_id,
    status
  )
  values (
    p_account_id,
    p_display_name,
    p_public_player_id,
    v_room.id,
    'joined'
  )
  returning players.id into v_player_id;

  insert into public.game_states (room_id, status)
  values (v_room.id, 'waiting');

  insert into public.realtime_topics (room_id, scope, topic)
  values (v_room.id, 'room', p_realtime_topic);

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player_id, 'room_created', '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player_id,
      'room_created'::text;
end;
$$;


ALTER FUNCTION "public"."app_create_room"("p_account_id" bigint, "p_public_room_code" "text", "p_realtime_topic" "text", "p_lobby_expires_at" timestamp with time zone, "p_public_player_id" "text", "p_display_name" "text", "p_target_player_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_expire_lobby_if_needed"("p_room_id" bigint) RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_notification_reason text := null;
  v_room public.rooms%rowtype;
begin
  select *
  into v_room
  from public.rooms
  where rooms.id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.';
  end if;

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );

    v_notification_reason := 'room_disbanded';
  end if;

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      null::bigint,
      v_notification_reason;
end;
$$;


ALTER FUNCTION "public"."app_expire_lobby_if_needed"("p_room_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_get_realtime_subscriptions"("p_account_id" bigint, "p_room_code" "text", "p_grant_seconds" integer DEFAULT 900) RETURNS TABLE("topic" "text", "scope" "text", "grant_id" "uuid", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_expires_at timestamptz;
  v_grant_seconds integer := least(greatest(coalesce(p_grant_seconds, 900), 60), 3600);
  v_player public.players%rowtype;
  v_role_id text;
  v_room public.rooms%rowtype;
begin
  select *
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1;

  if not found then
    raise exception 'Room not found.';
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status <> 'left';

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  select role_assignments.role_id
  into v_role_id
  from public.role_assignments
  where role_assignments.room_id = v_room.id
    and role_assignments.player_id = v_player.id;

  insert into public.realtime_topics (
    room_id,
    scope,
    topic
  )
  values (
    v_room.id,
    'room',
    v_room.realtime_topic
  )
  on conflict do nothing;

  insert into public.realtime_topics (
    player_id,
    room_id,
    scope,
    topic
  )
  values (
    v_player.id,
    v_room.id,
    'player_private',
    'player:' || gen_random_uuid()::text
  )
  on conflict do nothing;

  if v_role_id is not null then
    insert into public.realtime_topics (
      role_id,
      room_id,
      scope,
      topic
    )
    values (
      v_role_id,
      v_room.id,
      'role_private',
      'role:' || gen_random_uuid()::text
    )
    on conflict do nothing;
  end if;

  v_expires_at := now() + make_interval(secs => v_grant_seconds);

  return query
    with visible_topics as (
      select realtime_topics.id, realtime_topics.scope, realtime_topics.topic
      from public.realtime_topics
      where realtime_topics.room_id = v_room.id
        and (
          realtime_topics.scope = 'room'
          or (
            realtime_topics.scope = 'player_private'
            and realtime_topics.player_id = v_player.id
          )
          or (
            realtime_topics.scope = 'role_private'
            and realtime_topics.role_id = v_role_id
          )
        )
    ),
    inserted_grants as (
      insert into public.realtime_grants (
        expires_at,
        player_id,
        scope,
        topic_id
      )
      select
        v_expires_at,
        v_player.id,
        visible_topics.scope,
        visible_topics.id
      from visible_topics
      returning
        realtime_grants.expires_at,
        realtime_grants.grant_id,
        realtime_grants.scope,
        realtime_grants.topic_id
    )
    select
      visible_topics.topic,
      inserted_grants.scope,
      inserted_grants.grant_id,
      inserted_grants.expires_at
    from inserted_grants
    join visible_topics
      on visible_topics.id = inserted_grants.topic_id
    order by
      case inserted_grants.scope
        when 'room' then 0
        when 'player_private' then 1
        when 'role_private' then 2
        else 3
      end;
end;
$$;


ALTER FUNCTION "public"."app_get_realtime_subscriptions"("p_account_id" bigint, "p_room_code" "text", "p_grant_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_heartbeat_room_player"("p_account_id" bigint, "p_room_code" "text", "p_disconnect_after_seconds" integer DEFAULT 45) RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_disconnect_after_seconds integer := least(greatest(coalesce(p_disconnect_after_seconds, 45), 10), 300);
  v_disconnected_count integer := 0;
  v_notification_reason text := null;
  v_player public.players%rowtype;
  v_reconnected boolean := false;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms
  join public.players
    on players.room_id = rooms.id
  where rooms.public_room_code = p_room_code
    and players.account_id = p_account_id
  order by rooms.created_at desc
  limit 1
  for update of rooms;

  if not found then
    raise exception 'Room not found.';
  end if;

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );

    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        null::bigint,
        'room_disbanded'::text;
    return;
  end if;

  if v_room.status not in ('lobby', 'playing') then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        null::bigint,
        null::text;
    return;
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status <> 'left'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  v_reconnected := v_player.status = 'disconnected';

  update public.players
  set disconnected_at = null,
      last_seen_at = now(),
      status = 'joined'
  where players.id = v_player.id
  returning * into v_player;

  if v_reconnected then
    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (p_account_id, v_player.id, 'player_reconnected', '{}'::jsonb, v_room.id);
  end if;

  with stale_players as (
    update public.players
    set disconnected_at = now(),
        status = 'disconnected'
    where players.room_id = v_room.id
      and players.account_id <> p_account_id
      and players.status = 'joined'
      and players.last_seen_at <= now() - make_interval(secs => v_disconnect_after_seconds)
    returning players.id
  ),
  inserted_events as (
    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    select
      null,
      stale_players.id,
      'player_disconnected',
      '{}'::jsonb,
      v_room.id
    from stale_players
    returning room_events.id
  )
  select count(*)
  into v_disconnected_count
  from inserted_events;

  v_notification_reason := case
    when v_reconnected then 'player_reconnected'
    when v_disconnected_count > 0 then 'player_disconnected'
    else null
  end;

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      v_notification_reason;
end;
$$;


ALTER FUNCTION "public"."app_heartbeat_room_player"("p_account_id" bigint, "p_room_code" "text", "p_disconnect_after_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_insert_current_actions"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_closes_at" timestamp with time zone, "p_actions" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_action jsonb;
begin
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Actions payload must be an array.';
  end if;

  for v_action in
    select value
    from jsonb_array_elements(p_actions) as action(value)
  loop
    insert into public.current_actions (
      action_key,
      action_kind,
      actor_player_id,
      actor_role_id,
      closes_at,
      eligible_target_player_ids,
      phase_instance_id,
      room_id,
      target_kind
    )
    values (
      v_action ->> 'action_key',
      v_action ->> 'action_kind',
      nullif(v_action ->> 'actor_player_id', '')::bigint,
      v_action ->> 'actor_role_id',
      p_closes_at,
      array(
        select target.value::bigint
        from jsonb_array_elements_text(
          coalesce(v_action -> 'eligible_target_player_ids', '[]'::jsonb)
        ) as target(value)
      ),
      p_phase_instance_id,
      p_room_id,
      v_action ->> 'target_kind'
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."app_insert_current_actions"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_closes_at" timestamp with time zone, "p_actions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_insert_day_speech_slots"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_slots" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_expected_slot_count integer;
  v_inserted_slot_count integer;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Day speech slots payload must be an array.';
  end if;

  v_expected_slot_count := jsonb_array_length(p_slots);

  if v_expected_slot_count = 0 then
    return;
  end if;

  insert into public.day_speech_slots (
    phase_instance_id,
    room_id,
    slot_index,
    speaker_player_id
  )
  select
    p_phase_instance_id,
    p_room_id,
    slot.slot_index,
    slot.speaker_player_id
  from jsonb_to_recordset(p_slots) as slot(slot_index integer, speaker_player_id bigint)
  join public.players
    on players.id = slot.speaker_player_id
   and players.room_id = p_room_id;

  get diagnostics v_inserted_slot_count = row_count;

  if v_inserted_slot_count <> v_expected_slot_count then
    raise exception 'Day speech slots payload contains an invalid player.';
  end if;
end;
$$;


ALTER FUNCTION "public"."app_insert_day_speech_slots"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_slots" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_insert_game_events"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_events" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_insert_game_events"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_join_room"("p_account_id" bigint, "p_room_code" "text", "p_public_player_id" "text", "p_display_name" "text") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_event_kind text;
  v_joined_player_count bigint;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
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

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );
  end if;

  if v_room.status not in ('lobby', 'playing') then
    raise exception 'Room is not joinable.';
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if found then
    v_event_kind := case
      when v_player.status = 'left' then 'player_joined'
      else 'player_reconnected'
    end;

    if v_player.status <> 'joined' then
      select count(*)
      into v_joined_player_count
      from public.players
      where players.room_id = v_room.id
        and players.status = 'joined';

      if v_joined_player_count >= v_room.target_player_count then
        raise exception 'Room is full.';
      end if;
    end if;

    update public.players
    set last_seen_at = now(),
        status = 'joined'
    where players.id = v_player.id
    returning * into v_player;
  else
    if v_room.status <> 'lobby' then
      raise exception 'New players can only join during lobby.';
    end if;

    select count(*)
    into v_joined_player_count
    from public.players
    where players.room_id = v_room.id
      and players.status = 'joined';

    if v_joined_player_count >= v_room.target_player_count then
      raise exception 'Room is full.';
    end if;

    v_event_kind := 'player_joined';

    insert into public.players (
      account_id,
      display_name,
      public_player_id,
      room_id,
      status
    )
    values (
      p_account_id,
      p_display_name,
      p_public_player_id,
      v_room.id,
      'joined'
    )
    returning * into v_player;
  end if;

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player.id, v_event_kind, '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      v_event_kind;
end;
$$;


ALTER FUNCTION "public"."app_join_room"("p_account_id" bigint, "p_room_code" "text", "p_public_player_id" "text", "p_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_leave_room"("p_account_id" bigint, "p_room_code" "text") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_notification_reason text := 'player_left';
  v_player public.players%rowtype;
  v_remaining_player public.players%rowtype;
  v_room public.rooms%rowtype;
begin
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

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );
  end if;

  if v_room.status = 'playing' then
    raise exception 'Players cannot leave while the game is in progress.';
  end if;

  select *
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
  for update;

  if not found then
    raise exception 'Current account is not a room player.';
  end if;

  if v_player.status = 'left' then
    raise exception 'Current account has already left the room.';
  end if;

  update public.players
  set left_at = now(),
      status = 'left'
  where players.id = v_player.id
  returning * into v_player;

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, v_player.id, 'player_left', '{}'::jsonb, v_room.id);

  if v_room.status in ('lobby', 'ended') then
    select *
    into v_remaining_player
    from public.players
    where players.room_id = v_room.id
      and players.status in ('joined', 'disconnected')
    order by players.joined_at asc, players.id asc
    limit 1;

    if not found and v_room.status = 'lobby' then
      update public.rooms
      set disbanded_at = now(),
          status = 'disbanded'
      where rooms.id = v_room.id
        and rooms.status = 'lobby'
      returning * into v_room;

      insert into public.room_events (
        actor_account_id,
        actor_player_id,
        event_kind,
        payload,
        room_id
      )
      values (
        p_account_id,
        v_player.id,
        'room_disbanded',
        '{"reason":"last_player_left_lobby"}'::jsonb,
        v_room.id
      );

      v_notification_reason := 'room_disbanded';
    elsif found and v_room.host_account_id = p_account_id then
      update public.rooms
      set host_account_id = v_remaining_player.account_id
      where rooms.id = v_room.id
        and rooms.status in ('lobby', 'ended')
      returning * into v_room;
    end if;
  end if;

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_player.id,
      v_notification_reason;
end;
$$;


ALTER FUNCTION "public"."app_leave_room"("p_account_id" bigint, "p_room_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_resolve_phase"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_expected_current_action_ids" bigint[], "p_expected_pending_action_ids" bigint[], "p_deaths" "jsonb", "p_final_outcome" "jsonb", "p_player_results" "jsonb", "p_next_phase" "text", "p_next_phase_instance_id" "uuid", "p_next_phase_ends_at" timestamp with time zone, "p_next_day_number" integer, "p_next_night_number" integer, "p_actions" "jsonb", "p_day_speech_slots" "jsonb", "p_events" "jsonb") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_all_actions_submitted boolean;
  v_current_action_count integer;
  v_current_action_ids bigint[];
  v_death jsonb;
  v_final_outcome_id bigint;
  v_host_player public.players%rowtype;
  v_pending_action_count integer;
  v_pending_action_ids bigint[];
  v_phase_timed_out boolean;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
begin
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

  if v_room.host_account_id <> p_account_id then
    raise exception 'Only the host can advance the phase.';
  end if;

  select *
  into v_host_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  if v_room.status <> 'playing' then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found
    or v_state.status <> 'playing'
    or v_state.phase_instance_id <> p_phase_instance_id
    or v_state.revision <> p_expected_revision
  then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  select coalesce(array_agg(action_id order by action_id), '{}'::bigint[])
  into v_current_action_ids
  from (
    select current_actions.id as action_id
    from public.current_actions
    where current_actions.room_id = v_room.id
      and current_actions.phase_instance_id = p_phase_instance_id
    for update
  ) as locked_actions;

  select coalesce(array_agg(pending_action_id order by pending_action_id), '{}'::bigint[])
  into v_pending_action_ids
  from (
    select pending_actions.id as pending_action_id
    from public.pending_actions
    join public.current_actions
      on current_actions.id = pending_actions.current_action_id
    where current_actions.room_id = v_room.id
      and current_actions.phase_instance_id = p_phase_instance_id
    for update of pending_actions
  ) as locked_pending_actions;

  if v_current_action_ids <> coalesce(p_expected_current_action_ids, '{}'::bigint[])
    or v_pending_action_ids <> coalesce(p_expected_pending_action_ids, '{}'::bigint[])
  then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  v_current_action_count := coalesce(array_length(v_current_action_ids, 1), 0);
  v_pending_action_count := coalesce(array_length(v_pending_action_ids, 1), 0);
  v_all_actions_submitted := v_current_action_count > 0
    and v_current_action_count = v_pending_action_count;
  v_phase_timed_out := v_state.phase_ends_at is not null and v_state.phase_ends_at <= now();

  if not (
    v_phase_timed_out
    or (
      (v_state.phase <> 'night' or v_state.night_number = 1)
      and v_all_actions_submitted
    )
  ) then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_host_player.id,
        null::text;
    return;
  end if;

  if p_deaths is null or jsonb_typeof(p_deaths) <> 'array' then
    raise exception 'Deaths payload must be an array.';
  end if;

  for v_death in
    select value
    from jsonb_array_elements(p_deaths) as death(value)
  loop
    update public.game_player_states
    set alive = false,
        death_reason = v_death ->> 'reason',
        died_at = now()
    where game_player_states.room_id = v_room.id
      and game_player_states.player_id = (v_death ->> 'player_id')::bigint;
  end loop;

  delete from public.pending_actions
  where pending_actions.id = any(v_pending_action_ids);

  delete from public.current_actions
  where current_actions.id = any(v_current_action_ids);

  if p_final_outcome is not null then
    insert into public.final_outcomes (
      payload,
      reason,
      room_id,
      winner_team
    )
    values (
      '{}'::jsonb,
      p_final_outcome ->> 'reason',
      v_room.id,
      p_final_outcome ->> 'winner_team'
    )
    returning final_outcomes.id into v_final_outcome_id;

    if p_player_results is null or jsonb_typeof(p_player_results) <> 'array' then
      raise exception 'Player results payload must be an array.';
    end if;

    insert into public.player_results (player_id, result, room_id)
    select player_result.player_id, player_result.result, v_room.id
    from jsonb_to_recordset(p_player_results) as player_result(player_id bigint, result text);

    update public.game_states
    set final_outcome_id = v_final_outcome_id,
        phase = null,
        phase_ends_at = null,
        phase_instance_id = null,
        revision = v_state.revision + 1,
        status = 'ended'
    where game_states.id = v_state.id
      and game_states.revision = v_state.revision;

    update public.rooms
    set ended_at = now(),
        status = 'ended'
    where rooms.id = v_room.id
    returning * into v_room;
  else
    update public.game_states
    set day_number = p_next_day_number,
        night_number = p_next_night_number,
        phase = p_next_phase,
        phase_ends_at = p_next_phase_ends_at,
        phase_instance_id = p_next_phase_instance_id,
        phase_started_at = now(),
        revision = v_state.revision + 1,
        status = 'playing'
    where game_states.id = v_state.id
      and game_states.revision = v_state.revision;

    if p_next_phase_instance_id is not null and p_next_phase_ends_at is not null then
      perform public.app_insert_current_actions(
        v_room.id,
        p_next_phase_instance_id,
        p_next_phase_ends_at,
        p_actions
      );

      perform public.app_insert_day_speech_slots(
        v_room.id,
        p_next_phase_instance_id,
        p_day_speech_slots
      );
    end if;
  end if;

  perform public.app_insert_game_events(v_room.id, p_next_phase_instance_id, p_events);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_host_player.id,
      case
        when p_final_outcome is null then 'phase_changed'::text
        else 'game_ended'::text
      end;
end;
$$;


ALTER FUNCTION "public"."app_resolve_phase"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_expected_current_action_ids" bigint[], "p_expected_pending_action_ids" bigint[], "p_deaths" "jsonb", "p_final_outcome" "jsonb", "p_player_results" "jsonb", "p_next_phase" "text", "p_next_phase_instance_id" "uuid", "p_next_phase_ends_at" timestamp with time zone, "p_next_day_number" integer, "p_next_night_number" integer, "p_actions" "jsonb", "p_day_speech_slots" "jsonb", "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_send_night_conversation_message"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_night_number" integer, "p_conversation_group_id" "text", "p_body" "text") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."app_send_night_conversation_message"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_night_number" integer, "p_conversation_group_id" "text", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_start_room"("p_account_id" bigint, "p_room_code" "text", "p_expected_player_ids" bigint[], "p_phase_instance_id" "uuid", "p_phase_ends_at" timestamp with time zone, "p_role_counts" "jsonb", "p_options" "jsonb", "p_resolved_role_setup" "jsonb", "p_role_registry_version" "text", "p_engine_version" "text", "p_assignments" "jsonb", "p_actions" "jsonb", "p_events" "jsonb") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_host_player public.players%rowtype;
  v_joined_player_ids bigint[];
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
begin
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

  if v_room.status = 'lobby' and v_room.lobby_expires_at <= now() then
    update public.rooms
    set disbanded_at = now(),
        status = 'disbanded'
    where rooms.id = v_room.id
      and rooms.status = 'lobby'
    returning * into v_room;

    insert into public.room_events (
      actor_account_id,
      actor_player_id,
      event_kind,
      payload,
      room_id
    )
    values (
      null,
      null,
      'room_disbanded',
      '{"reason":"lobby_expired"}'::jsonb,
      v_room.id
    );

    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        null::bigint,
        'room_disbanded'::text;
    return;
  end if;

  if v_room.host_account_id <> p_account_id then
    raise exception 'Only the host can start the game.';
  end if;

  select *
  into v_host_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status = 'joined'
  for update;

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'Room must be in lobby.';
  end if;

  select *
  into v_state
  from public.game_states
  where game_states.room_id = v_room.id
  for update;

  if not found or v_state.status <> 'waiting' then
    raise exception 'Room must be waiting for start.';
  end if;

  select coalesce(array_agg(player_id order by joined_at, player_id), '{}'::bigint[])
  into v_joined_player_ids
  from (
    select players.id as player_id, players.joined_at
    from public.players
    where players.room_id = v_room.id
      and players.status = 'joined'
  ) as joined_players;

  if v_joined_player_ids <> coalesce(p_expected_player_ids, '{}'::bigint[]) then
    raise exception 'Room players changed. Retry game start.';
  end if;

  if jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) <> coalesce(array_length(p_expected_player_ids, 1), 0)
  then
    raise exception 'Role assignments do not match joined players.';
  end if;

  update public.rooms
  set started_at = now(),
      status = 'playing'
  where rooms.id = v_room.id
    and rooms.status = 'lobby'
  returning * into v_room;

  insert into public.game_rule_sets (
    engine_version,
    options,
    role_counts,
    role_registry_version,
    room_id
  )
  values (
    p_engine_version,
    p_options,
    p_role_counts,
    p_role_registry_version,
    v_room.id
  );

  update public.game_states
  set night_number = 1,
      phase = 'night',
      phase_ends_at = p_phase_ends_at,
      phase_instance_id = p_phase_instance_id,
      phase_started_at = now(),
      resolved_role_setup = p_resolved_role_setup,
      revision = 1,
      status = 'playing'
  where game_states.id = v_state.id
    and game_states.status = 'waiting';

  insert into public.role_assignments (player_id, role_id, room_id)
  select assignment.player_id, assignment.role_id, v_room.id
  from jsonb_to_recordset(p_assignments) as assignment(player_id bigint, role_id text);

  insert into public.game_player_states (alive, player_id, room_id)
  select true, player_id, v_room.id
  from unnest(p_expected_player_ids) as player_id;

  perform public.app_insert_current_actions(
    v_room.id,
    p_phase_instance_id,
    p_phase_ends_at,
    p_actions
  );
  perform public.app_insert_game_events(v_room.id, p_phase_instance_id, p_events);

  insert into public.room_events (
    actor_account_id,
    actor_player_id,
    event_kind,
    payload,
    room_id
  )
  values (p_account_id, null, 'game_started', '{}'::jsonb, v_room.id);

  return query
    select
      v_room.id,
      v_room.public_room_code,
      v_room.status,
      v_room.host_account_id,
      v_room.realtime_topic,
      v_room.lobby_expires_at,
      v_host_player.id,
      'game_started'::text;
end;
$$;


ALTER FUNCTION "public"."app_start_room"("p_account_id" bigint, "p_room_code" "text", "p_expected_player_ids" bigint[], "p_phase_instance_id" "uuid", "p_phase_ends_at" timestamp with time zone, "p_role_counts" "jsonb", "p_options" "jsonb", "p_resolved_role_setup" "jsonb", "p_role_registry_version" "text", "p_engine_version" "text", "p_assignments" "jsonb", "p_actions" "jsonb", "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_submit_action"("p_account_id" bigint, "p_room_code" "text", "p_action_key" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_target_public_player_id" "text") RETURNS TABLE("id" bigint, "public_room_code" "text", "status" "text", "host_account_id" bigint, "realtime_topic" "text", "lobby_expires_at" timestamp with time zone, "actor_player_id" bigint, "notification_reason" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_action public.current_actions%rowtype;
  v_pending_action_id bigint;
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_state public.game_states%rowtype;
  v_submitter_alive boolean;
  v_submitter_role_id text;
  v_target_player_id bigint;
begin
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
    or v_state.phase_instance_id <> p_phase_instance_id
    or p_expected_revision is null
    or v_state.revision <> p_expected_revision
  then
    raise exception 'Action belongs to a stale phase.';
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
    raise exception 'Action is not allowed.';
  end if;

  if p_target_public_player_id is not null then
    select players.id
    into v_target_player_id
    from public.players
    where players.room_id = v_room.id
      and players.public_player_id = p_target_public_player_id;

    if not found then
      raise exception 'Target player not found.';
    end if;
  end if;

  select *
  into v_action
  from public.current_actions
  where current_actions.room_id = v_room.id
    and current_actions.action_key = p_action_key
    and current_actions.phase_instance_id = p_phase_instance_id
  for update;

  if not found then
    raise exception 'Action is not available.';
  end if;

  if v_action.closes_at is not null and v_action.closes_at <= now() then
    raise exception 'Action window is closed.';
  end if;

  if v_action.actor_player_id is not null and v_action.actor_player_id <> v_player.id then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.actor_player_id is null
    and v_action.actor_role_id is distinct from v_submitter_role_id
  then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.target_kind = 'none' and v_target_player_id is not null then
    raise exception 'Action is not allowed.';
  end if;

  if v_action.target_kind = 'single_player'
    and (
      v_target_player_id is null
      or not (v_target_player_id = any(v_action.eligible_target_player_ids))
    )
  then
    raise exception 'Action is not allowed.';
  end if;

  insert into public.pending_actions (
    current_action_id,
    room_id,
    submitter_player_id,
    target_player_id
  )
  values (
    v_action.id,
    v_room.id,
    v_player.id,
    v_target_player_id
  )
  on conflict (current_action_id) do nothing
  returning pending_actions.id into v_pending_action_id;

  if v_pending_action_id is null then
    return query
      select
        v_room.id,
        v_room.public_room_code,
        v_room.status,
        v_room.host_account_id,
        v_room.realtime_topic,
        v_room.lobby_expires_at,
        v_player.id,
        null::text;
    return;
  end if;

  insert into public.game_events (
    event_kind,
    payload,
    phase_instance_id,
    room_id,
    visibility
  )
  values (
    'action_submitted',
    jsonb_build_object('actionKind', v_action.action_kind),
    p_phase_instance_id,
    v_room.id,
    'internal'
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
      'action_window_changed'::text;
end;
$$;


ALTER FUNCTION "public"."app_submit_action"("p_account_id" bigint, "p_room_code" "text", "p_action_key" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_target_public_player_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_tokens" (
    "id" bigint NOT NULL,
    "account_id" bigint NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_hash_key_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "account_tokens_token_hash_shape_check" CHECK (("token_hash" ~ '^[A-Za-z0-9_-]{43,128}$'::"text"))
);

ALTER TABLE ONLY "public"."account_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_tokens" OWNER TO "postgres";


ALTER TABLE "public"."account_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."account_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."accounts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" OWNER TO "postgres";


ALTER TABLE "public"."accounts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."current_actions" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "phase_instance_id" "uuid" NOT NULL,
    "action_key" "text" NOT NULL,
    "action_kind" "text" NOT NULL,
    "actor_player_id" bigint,
    "actor_role_id" "text",
    "target_kind" "text" NOT NULL,
    "eligible_target_player_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    "closes_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "current_actions_action_kind_shape_check" CHECK (("action_kind" ~ '^[a-z][a-z0-9_]*$'::"text")),
    CONSTRAINT "current_actions_target_kind_check" CHECK (("target_kind" = ANY (ARRAY['none'::"text", 'single_player'::"text"])))
);

ALTER TABLE ONLY "public"."current_actions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."current_actions" OWNER TO "postgres";


ALTER TABLE "public"."current_actions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."current_actions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."day_speech_slots" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "phase_instance_id" "uuid" NOT NULL,
    "slot_index" integer NOT NULL,
    "speaker_player_id" bigint NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."day_speech_slots" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."day_speech_slots" OWNER TO "postgres";


ALTER TABLE "public"."day_speech_slots" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."day_speech_slots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."final_outcomes" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "winner_team" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "final_outcomes_winner_team_shape_check" CHECK (("winner_team" ~ '^[a-z][a-z0-9_]*$'::"text"))
);

ALTER TABLE ONLY "public"."final_outcomes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."final_outcomes" OWNER TO "postgres";


ALTER TABLE "public"."final_outcomes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."final_outcomes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_event_visible_players" (
    "game_event_id" bigint NOT NULL,
    "player_id" bigint NOT NULL
);

ALTER TABLE ONLY "public"."game_event_visible_players" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_event_visible_players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_event_visible_roles" (
    "game_event_id" bigint NOT NULL,
    "role_id" "text" NOT NULL
);

ALTER TABLE ONLY "public"."game_event_visible_roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_event_visible_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_events" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "phase_instance_id" "uuid",
    "event_kind" "text" NOT NULL,
    "visibility" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase" "text",
    "actor_player_id" bigint,
    "target_player_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payload_version" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "game_events_event_kind_shape_check" CHECK (("event_kind" ~ '^[a-z][a-z0-9_]*$'::"text")),
    CONSTRAINT "game_events_payload_shape_check" CHECK ((("jsonb_typeof"("payload") = 'object'::"text") AND ("jsonb_typeof"("target_player_ids") = 'array'::"text") AND ("payload_version" > 0))),
    CONSTRAINT "game_events_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'private'::"text", 'internal'::"text"])))
);

ALTER TABLE ONLY "public"."game_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_events" OWNER TO "postgres";


ALTER TABLE "public"."game_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."game_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_player_states" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "player_id" bigint NOT NULL,
    "alive" boolean DEFAULT true NOT NULL,
    "death_reason" "text",
    "died_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_player_states_death_reason_shape_check" CHECK ((("death_reason" IS NULL) OR ("death_reason" ~ '^[a-z][a-z0-9_]*$'::"text")))
);

ALTER TABLE ONLY "public"."game_player_states" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_player_states" OWNER TO "postgres";


ALTER TABLE "public"."game_player_states" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."game_player_states_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_rule_sets" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "role_counts" "jsonb" NOT NULL,
    "options" "jsonb" NOT NULL,
    "role_registry_version" "text" NOT NULL,
    "engine_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "validation_result" "jsonb",
    "locked_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_rule_sets_payload_shape_check" CHECK ((("jsonb_typeof"("role_counts") = 'object'::"text") AND ("jsonb_typeof"("options") = 'object'::"text") AND (("validation_result" IS NULL) OR ("jsonb_typeof"("validation_result") = 'object'::"text"))))
);

ALTER TABLE ONLY "public"."game_rule_sets" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_rule_sets" OWNER TO "postgres";


ALTER TABLE "public"."game_rule_sets" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."game_rule_sets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_states" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "phase" "text",
    "phase_instance_id" "uuid",
    "phase_started_at" timestamp with time zone,
    "phase_ends_at" timestamp with time zone,
    "day_number" integer DEFAULT 0 NOT NULL,
    "night_number" integer DEFAULT 0 NOT NULL,
    "revision" integer DEFAULT 0 NOT NULL,
    "resolved_role_setup" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "final_outcome_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_night_state" "jsonb",
    "day_state" "jsonb",
    "execution_state" "jsonb",
    CONSTRAINT "game_states_phase_check" CHECK ((("phase" IS NULL) OR ("phase" = ANY (ARRAY['night'::"text", 'day'::"text", 'voting'::"text", 'execution'::"text"])))),
    CONSTRAINT "game_states_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'assigning_roles'::"text", 'playing'::"text", 'ended'::"text"])))
);

ALTER TABLE ONLY "public"."game_states" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_states" OWNER TO "postgres";


ALTER TABLE "public"."game_states" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."game_states_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."night_conversation_messages" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "night_number" integer NOT NULL,
    "conversation_group_id" "text" NOT NULL,
    "sender_player_id" bigint NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "night_conversation_messages_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 100))),
    CONSTRAINT "night_conversation_messages_group_id_check" CHECK (("conversation_group_id" ~ '^[a-z0-9_:-]{1,64}$'::"text"))
);

ALTER TABLE ONLY "public"."night_conversation_messages" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."night_conversation_messages" OWNER TO "postgres";


ALTER TABLE "public"."night_conversation_messages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."night_conversation_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pending_actions" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "current_action_id" bigint NOT NULL,
    "submitter_player_id" bigint NOT NULL,
    "target_player_id" bigint,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."pending_actions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_actions" OWNER TO "postgres";


ALTER TABLE "public"."pending_actions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pending_actions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."player_results" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "player_id" bigint NOT NULL,
    "result" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "player_results_result_shape_check" CHECK (("result" ~ '^[a-z][a-z0-9_]*$'::"text"))
);

ALTER TABLE ONLY "public"."player_results" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_results" OWNER TO "postgres";


ALTER TABLE "public"."player_results" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."player_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" bigint NOT NULL,
    "public_player_id" "text" NOT NULL,
    "room_id" bigint NOT NULL,
    "account_id" bigint NOT NULL,
    "display_name" "text" NOT NULL,
    "status" "text" DEFAULT 'joined'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "left_at" timestamp with time zone,
    "disconnected_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "players_display_name_length" CHECK ((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 32))),
    CONSTRAINT "players_status_check" CHECK (("status" = ANY (ARRAY['joined'::"text", 'disconnected'::"text", 'left'::"text"])))
);

ALTER TABLE ONLY "public"."players" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" OWNER TO "postgres";


ALTER TABLE "public"."players" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."players_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."realtime_grants" (
    "id" bigint NOT NULL,
    "grant_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_id" bigint NOT NULL,
    "player_id" bigint NOT NULL,
    "scope" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "realtime_grants_scope_check" CHECK (("scope" = ANY (ARRAY['room'::"text", 'player_private'::"text", 'role_private'::"text"])))
);

ALTER TABLE ONLY "public"."realtime_grants" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."realtime_grants" OWNER TO "postgres";


ALTER TABLE "public"."realtime_grants" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."realtime_grants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."realtime_topics" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "topic" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "role_id" "text",
    "player_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "realtime_topics_scope_check" CHECK (("scope" = ANY (ARRAY['room'::"text", 'player_private'::"text", 'role_private'::"text"]))),
    CONSTRAINT "realtime_topics_target_check" CHECK (((("scope" = 'room'::"text") AND ("player_id" IS NULL) AND ("role_id" IS NULL)) OR (("scope" = 'player_private'::"text") AND ("player_id" IS NOT NULL) AND ("role_id" IS NULL)) OR (("scope" = 'role_private'::"text") AND ("player_id" IS NULL) AND ("role_id" IS NOT NULL))))
);

ALTER TABLE ONLY "public"."realtime_topics" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."realtime_topics" OWNER TO "postgres";


ALTER TABLE "public"."realtime_topics" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."realtime_topics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."role_assignments" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "player_id" bigint NOT NULL,
    "role_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "role_assignments_role_id_shape_check" CHECK (("role_id" ~ '^[a-z][a-z0-9_]*$'::"text"))
);

ALTER TABLE ONLY "public"."role_assignments" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_assignments" OWNER TO "postgres";


ALTER TABLE "public"."role_assignments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."role_assignments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."room_events" (
    "id" bigint NOT NULL,
    "room_id" bigint NOT NULL,
    "event_kind" "text" NOT NULL,
    "actor_player_id" bigint,
    "actor_account_id" bigint,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "room_events_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['room_created'::"text", 'player_joined'::"text", 'player_reconnected'::"text", 'player_disconnected'::"text", 'player_left'::"text", 'game_started'::"text", 'room_disbanded'::"text", 'room_ended'::"text"]))),
    CONSTRAINT "room_events_payload_object_check" CHECK (("jsonb_typeof"("payload") = 'object'::"text"))
);

ALTER TABLE ONLY "public"."room_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_events" OWNER TO "postgres";


ALTER TABLE "public"."room_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."room_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "id" bigint NOT NULL,
    "public_room_code" "text" NOT NULL,
    "status" "text" DEFAULT 'lobby'::"text" NOT NULL,
    "host_account_id" bigint NOT NULL,
    "realtime_topic" "text" NOT NULL,
    "lobby_expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "disbanded_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_player_count" integer DEFAULT 6 NOT NULL,
    CONSTRAINT "rooms_public_room_code_check" CHECK (("public_room_code" ~ '^[0-9]{6}$'::"text")),
    CONSTRAINT "rooms_realtime_topic_not_room_code_check" CHECK ((("length"("realtime_topic") >= 32) AND ("realtime_topic" <> "public_room_code"))),
    CONSTRAINT "rooms_status_check" CHECK (("status" = ANY (ARRAY['lobby'::"text", 'playing'::"text", 'disbanded'::"text", 'ended'::"text"]))),
    CONSTRAINT "rooms_target_player_count_check" CHECK ((("target_player_count" >= 3) AND ("target_player_count" <= 10)))
);

ALTER TABLE ONLY "public"."rooms" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" OWNER TO "postgres";


ALTER TABLE "public"."rooms" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."rooms_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."account_tokens"
    ADD CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_tokens"
    ADD CONSTRAINT "account_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."current_actions"
    ADD CONSTRAINT "current_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."current_actions"
    ADD CONSTRAINT "current_actions_room_id_action_key_key" UNIQUE ("room_id", "action_key");



ALTER TABLE ONLY "public"."day_speech_slots"
    ADD CONSTRAINT "day_speech_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_speech_slots"
    ADD CONSTRAINT "day_speech_slots_room_id_phase_instance_id_slot_index_key" UNIQUE ("room_id", "phase_instance_id", "slot_index");



ALTER TABLE ONLY "public"."final_outcomes"
    ADD CONSTRAINT "final_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."final_outcomes"
    ADD CONSTRAINT "final_outcomes_room_id_key" UNIQUE ("room_id");



ALTER TABLE ONLY "public"."game_event_visible_players"
    ADD CONSTRAINT "game_event_visible_players_pkey" PRIMARY KEY ("game_event_id", "player_id");



ALTER TABLE ONLY "public"."game_event_visible_roles"
    ADD CONSTRAINT "game_event_visible_roles_pkey" PRIMARY KEY ("game_event_id", "role_id");



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_player_states"
    ADD CONSTRAINT "game_player_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_player_states"
    ADD CONSTRAINT "game_player_states_room_id_player_id_key" UNIQUE ("room_id", "player_id");



ALTER TABLE ONLY "public"."game_rule_sets"
    ADD CONSTRAINT "game_rule_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_rule_sets"
    ADD CONSTRAINT "game_rule_sets_room_id_key" UNIQUE ("room_id");



ALTER TABLE ONLY "public"."game_states"
    ADD CONSTRAINT "game_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_states"
    ADD CONSTRAINT "game_states_room_id_key" UNIQUE ("room_id");



ALTER TABLE ONLY "public"."night_conversation_messages"
    ADD CONSTRAINT "night_conversation_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_current_action_id_key" UNIQUE ("current_action_id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_results"
    ADD CONSTRAINT "player_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_results"
    ADD CONSTRAINT "player_results_room_id_player_id_key" UNIQUE ("room_id", "player_id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_room_id_account_id_key" UNIQUE ("room_id", "account_id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_room_id_public_player_id_key" UNIQUE ("room_id", "public_player_id");



ALTER TABLE ONLY "public"."realtime_grants"
    ADD CONSTRAINT "realtime_grants_grant_id_key" UNIQUE ("grant_id");



ALTER TABLE ONLY "public"."realtime_grants"
    ADD CONSTRAINT "realtime_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realtime_topics"
    ADD CONSTRAINT "realtime_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realtime_topics"
    ADD CONSTRAINT "realtime_topics_topic_key" UNIQUE ("topic");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_room_id_player_id_key" UNIQUE ("room_id", "player_id");



ALTER TABLE ONLY "public"."room_events"
    ADD CONSTRAINT "room_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_realtime_topic_key" UNIQUE ("realtime_topic");



CREATE INDEX "account_tokens_account_id_idx" ON "public"."account_tokens" USING "btree" ("account_id");



CREATE INDEX "account_tokens_active_account_id_idx" ON "public"."account_tokens" USING "btree" ("account_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "current_actions_closes_at_idx" ON "public"."current_actions" USING "btree" ("closes_at") WHERE ("closes_at" IS NOT NULL);



CREATE INDEX "current_actions_room_phase_idx" ON "public"."current_actions" USING "btree" ("room_id", "phase_instance_id");



CREATE INDEX "game_event_visible_players_player_idx" ON "public"."game_event_visible_players" USING "btree" ("player_id", "game_event_id");



CREATE INDEX "game_event_visible_roles_role_idx" ON "public"."game_event_visible_roles" USING "btree" ("role_id", "game_event_id");



CREATE INDEX "game_events_room_created_idx" ON "public"."game_events" USING "btree" ("room_id", "created_at");



CREATE INDEX "game_events_room_phase_idx" ON "public"."game_events" USING "btree" ("room_id", "phase_instance_id");



CREATE INDEX "game_player_states_room_alive_idx" ON "public"."game_player_states" USING "btree" ("room_id", "alive");



CREATE INDEX "game_states_status_phase_ends_idx" ON "public"."game_states" USING "btree" ("status", "phase_ends_at");



CREATE INDEX "night_conversation_messages_room_group_night_idx" ON "public"."night_conversation_messages" USING "btree" ("room_id", "conversation_group_id", "night_number", "created_at", "id");



CREATE INDEX "night_conversation_messages_sender_player_idx" ON "public"."night_conversation_messages" USING "btree" ("sender_player_id");



CREATE INDEX "pending_actions_room_phase_idx" ON "public"."pending_actions" USING "btree" ("room_id", "submitted_at");



CREATE INDEX "players_account_id_idx" ON "public"."players" USING "btree" ("account_id");



CREATE INDEX "players_room_id_idx" ON "public"."players" USING "btree" ("room_id");



CREATE INDEX "realtime_grants_active_grant_idx" ON "public"."realtime_grants" USING "btree" ("grant_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "realtime_grants_grant_expires_idx" ON "public"."realtime_grants" USING "btree" ("grant_id", "expires_at");



CREATE INDEX "realtime_grants_player_active_idx" ON "public"."realtime_grants" USING "btree" ("player_id", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "realtime_topics_player_id_idx" ON "public"."realtime_topics" USING "btree" ("player_id") WHERE ("player_id" IS NOT NULL);



CREATE UNIQUE INDEX "realtime_topics_room_player_private_unique" ON "public"."realtime_topics" USING "btree" ("room_id", "player_id") WHERE ("scope" = 'player_private'::"text");



CREATE UNIQUE INDEX "realtime_topics_room_role_private_unique" ON "public"."realtime_topics" USING "btree" ("room_id", "role_id") WHERE ("scope" = 'role_private'::"text");



CREATE INDEX "realtime_topics_room_scope_idx" ON "public"."realtime_topics" USING "btree" ("room_id", "scope");



CREATE UNIQUE INDEX "realtime_topics_room_scope_room_unique" ON "public"."realtime_topics" USING "btree" ("room_id") WHERE ("scope" = 'room'::"text");



CREATE INDEX "role_assignments_player_id_idx" ON "public"."role_assignments" USING "btree" ("player_id");



CREATE INDEX "role_assignments_room_id_idx" ON "public"."role_assignments" USING "btree" ("room_id");



CREATE INDEX "room_events_actor_account_id_idx" ON "public"."room_events" USING "btree" ("actor_account_id");



CREATE INDEX "room_events_room_created_idx" ON "public"."room_events" USING "btree" ("room_id", "created_at");



CREATE UNIQUE INDEX "rooms_active_code_unique" ON "public"."rooms" USING "btree" ("public_room_code") WHERE ("status" = ANY (ARRAY['lobby'::"text", 'playing'::"text"]));



CREATE INDEX "rooms_host_account_id_idx" ON "public"."rooms" USING "btree" ("host_account_id");



CREATE INDEX "rooms_public_room_code_idx" ON "public"."rooms" USING "btree" ("public_room_code");



CREATE INDEX "rooms_status_lobby_expires_at_idx" ON "public"."rooms" USING "btree" ("status", "lobby_expires_at");



CREATE OR REPLACE TRIGGER "accounts_touch_updated_at" BEFORE UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "game_player_states_touch_updated_at" BEFORE UPDATE ON "public"."game_player_states" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "game_states_touch_updated_at" BEFORE UPDATE ON "public"."game_states" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "rooms_touch_updated_at" BEFORE UPDATE ON "public"."rooms" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."account_tokens"
    ADD CONSTRAINT "account_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."current_actions"
    ADD CONSTRAINT "current_actions_actor_player_id_fkey" FOREIGN KEY ("actor_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."current_actions"
    ADD CONSTRAINT "current_actions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."day_speech_slots"
    ADD CONSTRAINT "day_speech_slots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."day_speech_slots"
    ADD CONSTRAINT "day_speech_slots_speaker_player_id_fkey" FOREIGN KEY ("speaker_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."final_outcomes"
    ADD CONSTRAINT "final_outcomes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."game_event_visible_players"
    ADD CONSTRAINT "game_event_visible_players_game_event_id_fkey" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_event_visible_players"
    ADD CONSTRAINT "game_event_visible_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."game_event_visible_roles"
    ADD CONSTRAINT "game_event_visible_roles_game_event_id_fkey" FOREIGN KEY ("game_event_id") REFERENCES "public"."game_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_actor_player_id_fkey" FOREIGN KEY ("actor_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."game_events"
    ADD CONSTRAINT "game_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."game_player_states"
    ADD CONSTRAINT "game_player_states_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."game_player_states"
    ADD CONSTRAINT "game_player_states_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."game_rule_sets"
    ADD CONSTRAINT "game_rule_sets_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."game_states"
    ADD CONSTRAINT "game_states_final_outcome_id_fk" FOREIGN KEY ("final_outcome_id") REFERENCES "public"."final_outcomes"("id");



ALTER TABLE ONLY "public"."game_states"
    ADD CONSTRAINT "game_states_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."night_conversation_messages"
    ADD CONSTRAINT "night_conversation_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."night_conversation_messages"
    ADD CONSTRAINT "night_conversation_messages_sender_player_id_fkey" FOREIGN KEY ("sender_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_current_action_id_fkey" FOREIGN KEY ("current_action_id") REFERENCES "public"."current_actions"("id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_submitter_player_id_fkey" FOREIGN KEY ("submitter_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."pending_actions"
    ADD CONSTRAINT "pending_actions_target_player_id_fkey" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."player_results"
    ADD CONSTRAINT "player_results_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."player_results"
    ADD CONSTRAINT "player_results_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."realtime_grants"
    ADD CONSTRAINT "realtime_grants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."realtime_grants"
    ADD CONSTRAINT "realtime_grants_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."realtime_topics"("id");



ALTER TABLE ONLY "public"."realtime_topics"
    ADD CONSTRAINT "realtime_topics_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."realtime_topics"
    ADD CONSTRAINT "realtime_topics_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."room_events"
    ADD CONSTRAINT "room_events_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."room_events"
    ADD CONSTRAINT "room_events_actor_player_id_fkey" FOREIGN KEY ("actor_player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."room_events"
    ADD CONSTRAINT "room_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_host_account_id_fkey" FOREIGN KEY ("host_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE "public"."account_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."current_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."day_speech_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."final_outcomes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_event_visible_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_event_visible_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_player_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_rule_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."night_conversation_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realtime_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realtime_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































REVOKE ALL ON FUNCTION "public"."app_cleanup_expired_lobbies"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_cleanup_expired_lobbies"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_create_room"("p_account_id" bigint, "p_public_room_code" "text", "p_realtime_topic" "text", "p_lobby_expires_at" timestamp with time zone, "p_public_player_id" "text", "p_display_name" "text", "p_target_player_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_create_room"("p_account_id" bigint, "p_public_room_code" "text", "p_realtime_topic" "text", "p_lobby_expires_at" timestamp with time zone, "p_public_player_id" "text", "p_display_name" "text", "p_target_player_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_expire_lobby_if_needed"("p_room_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_expire_lobby_if_needed"("p_room_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_get_realtime_subscriptions"("p_account_id" bigint, "p_room_code" "text", "p_grant_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_get_realtime_subscriptions"("p_account_id" bigint, "p_room_code" "text", "p_grant_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_heartbeat_room_player"("p_account_id" bigint, "p_room_code" "text", "p_disconnect_after_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_heartbeat_room_player"("p_account_id" bigint, "p_room_code" "text", "p_disconnect_after_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_insert_current_actions"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_closes_at" timestamp with time zone, "p_actions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_insert_current_actions"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_closes_at" timestamp with time zone, "p_actions" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_insert_day_speech_slots"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_slots" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_insert_day_speech_slots"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_slots" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_insert_game_events"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_insert_game_events"("p_room_id" bigint, "p_phase_instance_id" "uuid", "p_events" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_join_room"("p_account_id" bigint, "p_room_code" "text", "p_public_player_id" "text", "p_display_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_join_room"("p_account_id" bigint, "p_room_code" "text", "p_public_player_id" "text", "p_display_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_leave_room"("p_account_id" bigint, "p_room_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_leave_room"("p_account_id" bigint, "p_room_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_resolve_phase"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_expected_current_action_ids" bigint[], "p_expected_pending_action_ids" bigint[], "p_deaths" "jsonb", "p_final_outcome" "jsonb", "p_player_results" "jsonb", "p_next_phase" "text", "p_next_phase_instance_id" "uuid", "p_next_phase_ends_at" timestamp with time zone, "p_next_day_number" integer, "p_next_night_number" integer, "p_actions" "jsonb", "p_day_speech_slots" "jsonb", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_resolve_phase"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_expected_current_action_ids" bigint[], "p_expected_pending_action_ids" bigint[], "p_deaths" "jsonb", "p_final_outcome" "jsonb", "p_player_results" "jsonb", "p_next_phase" "text", "p_next_phase_instance_id" "uuid", "p_next_phase_ends_at" timestamp with time zone, "p_next_day_number" integer, "p_next_night_number" integer, "p_actions" "jsonb", "p_day_speech_slots" "jsonb", "p_events" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_send_night_conversation_message"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_night_number" integer, "p_conversation_group_id" "text", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_send_night_conversation_message"("p_account_id" bigint, "p_room_code" "text", "p_phase_instance_id" "uuid", "p_night_number" integer, "p_conversation_group_id" "text", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_start_room"("p_account_id" bigint, "p_room_code" "text", "p_expected_player_ids" bigint[], "p_phase_instance_id" "uuid", "p_phase_ends_at" timestamp with time zone, "p_role_counts" "jsonb", "p_options" "jsonb", "p_resolved_role_setup" "jsonb", "p_role_registry_version" "text", "p_engine_version" "text", "p_assignments" "jsonb", "p_actions" "jsonb", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_start_room"("p_account_id" bigint, "p_room_code" "text", "p_expected_player_ids" bigint[], "p_phase_instance_id" "uuid", "p_phase_ends_at" timestamp with time zone, "p_role_counts" "jsonb", "p_options" "jsonb", "p_resolved_role_setup" "jsonb", "p_role_registry_version" "text", "p_engine_version" "text", "p_assignments" "jsonb", "p_actions" "jsonb", "p_events" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_submit_action"("p_account_id" bigint, "p_room_code" "text", "p_action_key" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_target_public_player_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_submit_action"("p_account_id" bigint, "p_room_code" "text", "p_action_key" "text", "p_phase_instance_id" "uuid", "p_expected_revision" integer, "p_target_public_player_id" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."account_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."account_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."current_actions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."current_actions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."day_speech_slots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."day_speech_slots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."final_outcomes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."final_outcomes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_event_visible_players" TO "service_role";



GRANT ALL ON TABLE "public"."game_event_visible_roles" TO "service_role";



GRANT ALL ON TABLE "public"."game_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_player_states" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_player_states_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_rule_sets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_rule_sets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_states" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_states_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."night_conversation_messages" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."night_conversation_messages_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."night_conversation_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."night_conversation_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pending_actions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pending_actions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."player_results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."player_results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."players" TO "service_role";



GRANT ALL ON SEQUENCE "public"."players_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."realtime_grants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."realtime_grants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."realtime_topics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."realtime_topics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."role_assignments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."role_assignments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."room_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."room_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rooms_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--
