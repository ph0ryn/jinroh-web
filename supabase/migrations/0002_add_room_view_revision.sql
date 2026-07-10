alter table public.rooms
  add column view_revision bigint not null default 0;

create or replace function public.bump_room_view_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_room_id bigint;
begin
  v_room_id := case when tg_op = 'DELETE' then old.room_id else new.room_id end;

  update public.rooms
  set view_revision = view_revision + 1
  where rooms.id = v_room_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.bump_room_view_revision_on_room_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.view_revision := old.view_revision + 1;
  return new;
end;
$$;

create trigger rooms_bump_view_revision
  before update of
    public_room_code,
    status,
    host_account_id,
    realtime_topic,
    waiting_expires_at,
    target_player_count
  on public.rooms
  for each row execute function public.bump_room_view_revision_on_room_update();

create trigger players_insert_delete_bump_room_view_revision
  after insert or delete
  on public.players
  for each row execute function public.bump_room_view_revision();

create trigger players_update_bump_room_view_revision
  after update of display_name, public_player_id, status
  on public.players
  for each row
  when (
    old.display_name is distinct from new.display_name
    or old.public_player_id is distinct from new.public_player_id
    or old.status is distinct from new.status
  )
  execute function public.bump_room_view_revision();

create trigger game_states_bump_room_view_revision
  after insert or update or delete on public.game_states
  for each row execute function public.bump_room_view_revision();

create trigger role_assignments_bump_room_view_revision
  after insert or update or delete on public.role_assignments
  for each row execute function public.bump_room_view_revision();

create trigger game_player_states_bump_room_view_revision
  after insert or update or delete on public.game_player_states
  for each row execute function public.bump_room_view_revision();

create trigger current_actions_bump_room_view_revision
  after insert or update or delete on public.current_actions
  for each row execute function public.bump_room_view_revision();

create trigger pending_actions_bump_room_view_revision
  after insert or update or delete on public.pending_actions
  for each row execute function public.bump_room_view_revision();

create trigger day_speech_slots_bump_room_view_revision
  after insert or update or delete on public.day_speech_slots
  for each row execute function public.bump_room_view_revision();

create trigger game_events_bump_room_view_revision
  after insert or update or delete on public.game_events
  for each row execute function public.bump_room_view_revision();

create trigger final_outcomes_bump_room_view_revision
  after insert or update or delete on public.final_outcomes
  for each row execute function public.bump_room_view_revision();

create trigger player_results_bump_room_view_revision
  after insert or update or delete on public.player_results
  for each row execute function public.bump_room_view_revision();

create trigger night_conversation_messages_bump_room_view_revision
  after insert or update or delete on public.night_conversation_messages
  for each row execute function public.bump_room_view_revision();

create trigger realtime_topics_bump_room_view_revision
  after insert or update or delete on public.realtime_topics
  for each row execute function public.bump_room_view_revision();

revoke all on function public.bump_room_view_revision() from public, anon, authenticated;
revoke all on function public.bump_room_view_revision_on_room_update()
  from public, anon, authenticated;

grant execute on function public.bump_room_view_revision() to service_role;
grant execute on function public.bump_room_view_revision_on_room_update() to service_role;
