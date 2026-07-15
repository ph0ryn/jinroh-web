create function public.app_issue_realtime_grant(
  p_account_id bigint,
  p_room_code text,
  p_grant_seconds integer default 120
)
returns table (
  result_kind text,
  topic text,
  scope text,
  game_id uuid,
  role_id text,
  player_id bigint,
  grant_id uuid,
  expires_at timestamptz,
  room_id bigint,
  actor_player_id bigint,
  notification_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
  v_game_id uuid;
  v_grant_id uuid;
  v_grant_seconds integer := least(
    greatest(coalesce(p_grant_seconds, 120), 60),
    300
  );
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player public.players%rowtype;
  v_role_id text;
  v_room public.rooms%rowtype;
  v_topic_count integer;
begin
  perform private.lock_account(p_account_id);

  select rooms.*
  into v_room
  from public.rooms as rooms
  join public.players as players
    on players.room_id = rooms.id
   and players.account_id = p_account_id
   and players.left_at is null
  where rooms.public_room_code = pg_catalog.btrim(p_room_code)
  for update of rooms;

  if not found or v_room.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'current_room_changed';
  end if;

  select players.*
  into v_player
  from public.players as players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.left_at is null
  for update;

  if private.expire_open_room(v_room.id, v_now) then
    return query
    select
      'room_closed'::text,
      null::text,
      null::text,
      null::uuid,
      null::text,
      null::bigint,
      null::uuid,
      null::timestamptz,
      v_room.id,
      v_player.id,
      'room_closed'::text;
    return;
  end if;

  v_game_id := v_room.current_game_id;

  if v_game_id is not null then
    select game_players.role_id
    into v_role_id
    from public.game_players as game_players
    where game_players.game_id = v_game_id
      and game_players.player_id = v_player.id;
  end if;

  select pg_catalog.count(*)
  into v_topic_count
  from public.realtime_topics as topics
  where topics.room_id = v_room.id
    and (
      topics.scope = 'room'
      or (
        topics.scope = 'player_private'
        and topics.player_id = v_player.id
      )
      or (
        topics.scope = 'role_private'
        and topics.game_id = v_game_id
        and topics.role_id = v_role_id
      )
    );

  if v_topic_count <> (2 + case when v_role_id is null then 0 else 1 end) then
    raise exception using errcode = 'P0001', message = 'realtime_topic_missing';
  end if;

  update public.realtime_grants as grants
  set revoked_at = coalesce(
    grants.revoked_at,
    greatest(grants.created_at, v_now)
  )
  where grants.room_id = v_room.id
    and grants.player_id = v_player.id
    and grants.revoked_at is null;

  v_expires_at := v_now + pg_catalog.make_interval(secs => v_grant_seconds);

  insert into public.realtime_grants (
    room_id,
    player_id,
    game_id,
    expires_at,
    created_at
  )
  values (
    v_room.id,
    v_player.id,
    v_game_id,
    v_expires_at,
    v_now
  )
  returning realtime_grants.grant_id into v_grant_id;

  return query
  select
    'active'::text,
    topics.topic,
    topics.scope,
    v_game_id,
    topics.role_id,
    topics.player_id,
    v_grant_id,
    v_expires_at,
    v_room.id,
    v_player.id,
    null::text
  from public.realtime_topics as topics
  where topics.room_id = v_room.id
    and (
      topics.scope = 'room'
      or (
        topics.scope = 'player_private'
        and topics.player_id = v_player.id
      )
      or (
        topics.scope = 'role_private'
        and topics.game_id = v_game_id
        and topics.role_id = v_role_id
      )
    )
  order by
    case topics.scope
      when 'room' then 0
      when 'player_private' then 1
      when 'role_private' then 2
      else 3
    end,
    topics.topic;
end;
$$;

create function public.can_receive_realtime_topic(
  p_grant_id text,
  p_topic text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.realtime_grants as grants
    join public.rooms as rooms
      on rooms.id = grants.room_id
    join public.players as players
      on players.room_id = grants.room_id
     and players.id = grants.player_id
    join public.realtime_topics as topics
      on topics.room_id = grants.room_id
     and topics.topic = p_topic
    where grants.grant_id = case
        when pg_catalog.pg_input_is_valid(p_grant_id, 'uuid')
          then p_grant_id::uuid
        else null::uuid
      end
      and grants.expires_at > pg_catalog.statement_timestamp()
      and grants.revoked_at is null
      and rooms.closed_at is null
      and players.left_at is null
      and (
        topics.scope = 'room'
        or (
          topics.scope = 'player_private'
          and topics.player_id = players.id
        )
        or (
          topics.scope = 'role_private'
          and grants.game_id is not null
          and grants.game_id = topics.game_id
          and topics.game_id = rooms.current_game_id
          and exists (
            select 1
            from public.game_players as game_players
            where game_players.game_id = grants.game_id
              and game_players.player_id = players.id
              and game_players.role_id = topics.role_id
          )
        )
      )
  );
$$;

create function public.app_cleanup_expired_realtime_grants(
  p_limit integer default 500
)
returns table (deleted_grants bigint)
language sql
security definer
set search_path = ''
as $$
  with settings as (
    select least(
      greatest(coalesce(p_limit, 500), 1),
      5000
    ) as row_limit
  ), candidate_ids as (
    (
      select grants.grant_id, grants.expires_at as cleanup_at
      from public.realtime_grants as grants
      where grants.revoked_at is null
        and grants.expires_at <= pg_catalog.statement_timestamp()
      order by grants.expires_at, grants.grant_id
      limit (select row_limit from settings)
    )
    union all
    (
      select grants.grant_id, grants.revoked_at as cleanup_at
      from public.realtime_grants as grants
      where grants.revoked_at is not null
        and grants.revoked_at
          <= pg_catalog.statement_timestamp() - interval '5 minutes'
      order by grants.revoked_at, grants.grant_id
      limit (select row_limit from settings)
    )
  ), expired_grants as (
    select grants.grant_id
    from public.realtime_grants as grants
    join candidate_ids as candidates
      on candidates.grant_id = grants.grant_id
    order by candidates.cleanup_at, grants.grant_id
    limit (select row_limit from settings)
    for update of grants skip locked
  ), deleted as (
    delete from public.realtime_grants as grants
    using expired_grants
    where grants.grant_id = expired_grants.grant_id
    returning 1
  )
  select pg_catalog.count(*) from deleted;
$$;

create policy "Authenticated players can receive eligible room broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and topic = realtime.topic()
  and public.can_receive_realtime_topic(
    (select auth.jwt() ->> 'realtime_grant_id'),
    realtime.topic()
  )
);

revoke all on function public.app_issue_realtime_grant(bigint, text, integer)
  from public, anon, authenticated;
revoke all on function public.can_receive_realtime_topic(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.app_cleanup_expired_realtime_grants(integer)
  from public, anon, authenticated;

grant execute on function public.app_issue_realtime_grant(bigint, text, integer)
  to service_role;
grant execute on function public.can_receive_realtime_topic(text, text)
  to authenticated;
grant execute on function public.app_cleanup_expired_realtime_grants(integer)
  to service_role;
