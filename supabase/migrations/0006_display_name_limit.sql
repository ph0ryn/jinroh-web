update public.players
set display_name = coalesce(
  nullif(
    pg_catalog.btrim(
      pg_catalog.left(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(display_name, '[^A-Za-z0-9 ]', '', 'g'),
          ' +',
          ' ',
          'g'
        ),
        8
      )
    ),
    ''
  ),
  'Player'
)
where pg_catalog.char_length(display_name) > 8
  or display_name !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$';

alter table public.players
  drop constraint players_display_name_check;

alter table public.players
  add constraint players_display_name_check
  check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 8
    and display_name ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$'
  );
