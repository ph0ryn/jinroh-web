drop function if exists public.app_get_realtime_subscriptions(bigint, text, integer);

drop table if exists public.realtime_grants cascade;

create table public.realtime_grants (
  id bigint generated always as identity primary key,
  grant_id uuid not null default gen_random_uuid() unique,
  player_id bigint not null references public.players(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.realtime_grant_topics (
  grant_id bigint not null references public.realtime_grants(id) on delete cascade,
  topic_id bigint not null references public.realtime_topics(id) on delete cascade,
  primary key (grant_id, topic_id)
);

create index realtime_grants_player_active_idx
  on public.realtime_grants (player_id, expires_at)
  where revoked_at is null;

alter table public.realtime_grants enable row level security;
alter table public.realtime_grants force row level security;
alter table public.realtime_grant_topics enable row level security;
alter table public.realtime_grant_topics force row level security;

revoke all on table public.realtime_grants from public, anon, authenticated;
revoke all on table public.realtime_grant_topics from public, anon, authenticated;
grant all on table public.realtime_grants to service_role;
grant all on table public.realtime_grant_topics to service_role;
grant usage, select on sequence public.realtime_grants_id_seq to service_role;

create function public.app_issue_realtime_grant(
  p_account_id bigint,
  p_room_code text,
  p_grant_seconds integer default 120
) returns table (
  topic text,
  scope text,
  grant_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
  v_grant public.realtime_grants%rowtype;
  v_grant_seconds integer := least(greatest(coalesce(p_grant_seconds, 120), 60), 300);
  v_player public.players%rowtype;
  v_role_id text;
  v_room public.rooms%rowtype;
begin
  select rooms.*
  into v_room
  from public.rooms
  where rooms.public_room_code = p_room_code
  order by rooms.created_at desc
  limit 1;

  if not found then
    raise exception 'Room not found.';
  end if;

  select players.*
  into v_player
  from public.players
  where players.room_id = v_room.id
    and players.account_id = p_account_id
    and players.status <> 'left';

  if not found then
    raise exception 'Current account is not an active room player.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(v_player.id);

  select role_assignments.role_id
  into v_role_id
  from public.role_assignments
  where role_assignments.room_id = v_room.id
    and role_assignments.player_id = v_player.id;

  insert into public.realtime_topics (room_id, scope, topic)
  values (v_room.id, 'room', v_room.realtime_topic)
  on conflict do nothing;

  insert into public.realtime_topics (player_id, room_id, scope, topic)
  values (v_player.id, v_room.id, 'player_private', 'player:' || gen_random_uuid()::text)
  on conflict do nothing;

  if v_role_id is not null then
    insert into public.realtime_topics (role_id, room_id, scope, topic)
    values (v_role_id, v_room.id, 'role_private', 'role:' || gen_random_uuid()::text)
    on conflict do nothing;
  end if;

  delete from public.realtime_grants
  where realtime_grants.player_id = v_player.id
    and realtime_grants.expires_at <= now();

  update public.realtime_grants
  set revoked_at = now()
  where realtime_grants.player_id = v_player.id
    and realtime_grants.revoked_at is null
    and (
      exists (
        select 1
        from public.realtime_grant_topics
        join public.realtime_topics
          on realtime_topics.id = realtime_grant_topics.topic_id
        where realtime_grant_topics.grant_id = realtime_grants.id
          and not (
            realtime_topics.room_id = v_room.id
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
          )
      )
      or (
        select count(*)
        from public.realtime_grant_topics
        where realtime_grant_topics.grant_id = realtime_grants.id
      ) <> (
        select count(*)
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
      )
    );

  v_expires_at := now() + make_interval(secs => v_grant_seconds);

  select realtime_grants.*
  into v_grant
  from public.realtime_grants
  where realtime_grants.player_id = v_player.id
    and realtime_grants.expires_at > now() + interval '45 seconds'
    and realtime_grants.revoked_at is null
  order by realtime_grants.expires_at desc
  limit 1;

  if not found then
    insert into public.realtime_grants (player_id, expires_at)
    values (v_player.id, v_expires_at)
    returning * into v_grant;

    insert into public.realtime_grant_topics (grant_id, topic_id)
    select v_grant.id, realtime_topics.id
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
      );
  end if;

  return query
  select
    realtime_topics.topic,
    realtime_topics.scope,
    v_grant.grant_id,
    v_grant.expires_at
  from public.realtime_grant_topics
  join public.realtime_topics
    on realtime_topics.id = realtime_grant_topics.topic_id
  where realtime_grant_topics.grant_id = v_grant.id
  order by
    case realtime_topics.scope
      when 'room' then 0
      when 'player_private' then 1
      when 'role_private' then 2
      else 3
    end;
end;
$$;

revoke all on function public.app_issue_realtime_grant(bigint, text, integer) from public;
grant execute on function public.app_issue_realtime_grant(bigint, text, integer) to service_role;

create function public.can_receive_realtime_topic(
  p_grant_id text,
  p_topic text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.realtime_grants
    join public.players
      on players.id = realtime_grants.player_id
    join public.realtime_grant_topics
      on realtime_grant_topics.grant_id = realtime_grants.id
    join public.realtime_topics
      on realtime_topics.id = realtime_grant_topics.topic_id
    where realtime_grants.grant_id::text = p_grant_id
      and realtime_grants.expires_at > now()
      and realtime_grants.revoked_at is null
      and players.status <> 'left'
      and realtime_topics.topic = p_topic
  );
$$;

revoke all on function public.can_receive_realtime_topic(text, text) from public;
grant execute on function public.can_receive_realtime_topic(text, text) to authenticated;

create policy "Authenticated room players can receive granted broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.can_receive_realtime_topic(
    current_setting('request.jwt.claims', true)::jsonb ->> 'realtime_grant_id',
    realtime.topic()
  )
);
