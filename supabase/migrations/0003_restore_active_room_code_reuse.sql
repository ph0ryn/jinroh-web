drop index if exists public.rooms_public_room_code_global_unique;

create unique index if not exists rooms_active_code_unique
  on public.rooms(public_room_code)
  where status in ('lobby', 'playing');
