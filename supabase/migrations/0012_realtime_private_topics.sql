create unique index if not exists realtime_topics_room_scope_room_unique
  on public.realtime_topics (room_id)
  where scope = 'room';

create unique index if not exists realtime_topics_room_player_private_unique
  on public.realtime_topics (room_id, player_id)
  where scope = 'player_private';

create unique index if not exists realtime_topics_room_role_private_unique
  on public.realtime_topics (room_id, role_id)
  where scope = 'role_private';

create index if not exists realtime_grants_player_active_idx
  on public.realtime_grants (player_id, expires_at)
  where revoked_at is null;

create or replace function public.app_get_realtime_subscriptions(
  p_account_id bigint,
  p_room_code text,
  p_grant_seconds integer default 900
)
returns table (
  topic text,
  scope text,
  grant_id uuid,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
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

revoke all on function public.app_get_realtime_subscriptions(bigint, text, integer)
  from public, anon, authenticated;

grant execute on function public.app_get_realtime_subscriptions(bigint, text, integer)
  to service_role;
