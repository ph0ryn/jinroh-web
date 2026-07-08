# Jinroh Web

Jinroh Web is a polished Next.js application for managing shared game state for
in-person or voice-call werewolf games.

It does not replace table talk, voice chat, or human discussion. Its role is to
track the state that is tedious or error-prone to manage by hand: anonymous room
identity, lobby membership, role-safe private views, phase timers, night actions,
voting, execution, and locked final results.

![Jinroh Web tabletop hero](public/images/jinroh-og.jpg)

## Product Goals

- Start a room anonymously and let players join with a six-digit code.
- Keep the database as the source of truth and use realtime only as a reload
  signal.
- Never expose Account IDs, raw account tokens, role assignments, night targets,
  vote details in progress, or role-private night conversation content to the wrong
  browser view.
- Visualize a complete game path with Werewolf, Villager, Madman, Seer, Guard,
  and Fox roles while backend implementation follows the current product spec.
- Provide a high-polish mobile-first UI that also works as a desktop
  progress board.

## UI Surface

The current app shell is a live product surface backed by Next.js API routes
and Supabase:

- Home and lobby entry for anonymous room creation and code-based joining.
- Desktop live table with room metrics, invite tools, player list, host
  controls, private actions, and a public event log.
- First night, night actions, day progress, voting, execution, result, and
  role-private night conversation.
- Phase-aware generated tabletop backgrounds for lobby, day, voting,
  execution, night, and result states.
- Mobile layout with stacked room, control, private view, and public log panels.

Use `docs/spec.md` as the primary product boundary and `docs/game/*.md` for
game-system details.

## Local Setup

Install dependencies:

```sh
pnpm install
```

Start the local Supabase stack:

```sh
pnpm exec supabase start
```

Generate the token hash secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Create `.env.local` with the local values printed by `supabase start`:

```sh
ACCOUNT_TOKEN_HASH_SECRET=<generated 32-byte base64 secret>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

To print the local Supabase values again, run:

```sh
pnpm exec supabase status -o env
```

`NEXT_PUBLIC_SUPABASE_URL` should match `SUPABASE_URL`. Add
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable Supabase Realtime invalidation in the
browser. Without the public key, the live table still works through polling.
Keep production Supabase credentials out of local `.env.local`.
`NEXT_PUBLIC_SITE_URL` is optional locally. Set it to the deployed origin in
production when you want Open Graph images to resolve to a canonical URL; Vercel
deployment URL environment variables are used as a fallback. Never expose
`SUPABASE_SERVICE_ROLE_KEY` to the browser.

## Remote Database Setup

Log in and link the Supabase project:

```sh
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
```

Apply migrations:

```sh
pnpm exec supabase db push
```

If the CLI cannot connect with the temporary login role, set
`SUPABASE_DB_PASSWORD` for the linked project's database password and rerun the
same command.

For an existing project that was migrated manually, verify migration history:

```sh
pnpm exec supabase migration list
```

Local and remote versions should both list `0001` through the latest migration.
If a manually applied database is missing migration history rows, repair only
after verifying the schema:

```sh
pnpm exec supabase migration repair --linked --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013
```

To verify room-code reuse hardening after
`0003_restore_active_room_code_reuse.sql`, run:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'rooms'
  and indexname in ('rooms_active_code_unique', 'rooms_public_room_code_global_unique')
order by indexname;
```

The expected result is one `rooms_active_code_unique` row and no
`rooms_public_room_code_global_unique` row.

Rollback policy:

- Do not edit or delete an already-applied migration.
- Prefer a forward migration that restores the previous behavior or adds a
  compatibility path.
- For a failed `db push` before release traffic reaches the schema, fix the
  migration locally and rerun against a fresh project.
- For production data issues, snapshot/export the affected tables first, then
  apply a forward corrective migration.
- Application deploys should be rolled back independently from database
  migrations. Keep server code compatible with the currently applied schema
  before promoting it.

## Run

Start the development server:

```sh
pnpm dev
```

Open `http://localhost:3000/live`.

Basic play flow:

- Enter a display name and create a room.
- Copy or share the six-digit room code with other players.
- Other browsers or profiles join with the code.
- The host starts the game once 3 to 10 players are joined.
- Players use their visible action controls through first night, day, voting,
  execution, normal night, and result.
- Werewolf players can open night chat; it is writable during night and
  read-only outside night.
- Open room pages heartbeat in the background. Players with stale heartbeats
  are shown as disconnected and become joined again when their browser resumes.

Optional maintenance endpoint for cron or manual cleanup:

```sh
curl -X POST http://localhost:3000/api/maintenance/expire-lobbies \
  -H "content-type: application/json" \
  -d '{"limit":50}'
```

The endpoint only disbands already-expired lobby rooms and returns the number
of rooms changed.

## Deploy

Deploy the Next.js app to Vercel or another server runtime that supports the
Next.js App Router API routes.

Production environment variables:

```sh
ACCOUNT_TOKEN_HASH_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

Deployment order:

1. Apply Supabase migrations with `pnpm exec supabase db push`.
2. Confirm `pnpm exec supabase migration list` shows local and remote at the
   same latest migration.
3. Configure the production environment variables in the host.
4. Build with `pnpm run build`.
5. Deploy the app.
6. Run smoke checks against the deployment, for example:

```sh
E2E_BASE_URL=https://your-deployment.example pnpm run test:e2e
E2E_BASE_URL=https://your-deployment.example pnpm run test:e2e:security
```

If using scheduled cleanup, call `/api/maintenance/expire-lobbies` from a
trusted cron job. The endpoint is idempotent for already-expired lobbies.

## Validation

```sh
pnpm run format
pnpm run lint
pnpm test
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm run build
pnpm run test:e2e:all
```

The focused tests cover ruleset validation, token hashing, secret-safe game
events, role-scoped night actions, winner judgement, and player result mapping.
The E2E smoke test starts the built app with `next start`, launches three
isolated browser contexts, and plays a room from creation through the final
result, including the execution timeout path.

`test:e2e:all` runs the live smoke flow, ordered-speech flow, role coverage,
and security coverage sequentially. The individual commands remain available:
`test:e2e`, `test:e2e:roles`, `test:e2e:security`, and
`E2E_RULESET=ordered_speech E2E_PORT=3015 node scripts/e2e-live-smoke.mjs`.

`test:e2e:roles` launches eight isolated browser contexts and verifies the
default role set, role-private night actions, night conversation visibility,
non-member rejection, and read-only chat after night. To test an already
running deployment, pass `E2E_BASE_URL=https://...` to the E2E command.

`test:e2e:security` uses the HTTP APIs directly to verify scoped realtime
subscriptions, stale action revision rejection, and private night conversation
message boundaries.

## Architecture

- Browser code talks to Next.js API routes only.
- Server code authenticates `Authorization: Bearer <account token>` and hashes
  tokens with `ACCOUNT_TOKEN_HASH_SECRET`.
- Supabase base tables are RLS-enabled and default-deny for browser clients.
- Browser-facing state is cut into public, self-private, and role-private views.
- Realtime payloads should carry notification reasons only; clients reload views
  from the API after a notification.
