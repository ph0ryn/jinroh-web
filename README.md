# Jinroh Web

Jinroh Web is a polished Next.js application for managing shared game state for
in-person or voice-call werewolf games.

It does not replace table talk, voice chat, or human discussion. Its role is to
track the state that is tedious or error-prone to manage by hand: anonymous room
identity, waiting-room membership, role-safe private views, phase timers, night actions,
voting, execution, and locked final results.

![Jinroh Web tabletop hero](public/images/jinroh-og.jpg)

## Product Goals

- Start a room anonymously and let players join with a six-digit code.
- Keep the database as the source of truth and use realtime only as a reload
  signal.
- Never expose Account IDs, raw account tokens, pre-result role assignments, night
  targets, vote details in progress, or role-private night conversation content to
  the wrong browser view.
- Visualize a complete game path with Werewolf, Villager, Madman, Seer, Guard,
  Spiritist, Hunter, and Fox roles while backend implementation follows the
  current product spec.
- Provide a high-polish mobile-first UI that also works as a desktop
  progress board.

## UI Surface

The current app shell is a live product surface backed by Next.js API routes
and Supabase:

- Home and waiting-room entry for anonymous room creation and code-based joining.
- Desktop live table with room metrics, invite tools, player list, host
  controls, private actions, and a public event log.
- First night, night actions, day progress, voting, execution, result, and
  role-private night conversation.
- Phase-aware generated tabletop backgrounds for waiting, day, voting,
  execution, night, and result states.
- Mobile layout with stacked room, control, private view, and public log panels.

Use `docs/spec.md` as the primary product boundary and `docs/game/*.md` for
game-system details.

## Architecture Boundaries

- The application server is the only client for application database RPCs. Its
  service-role runtime snapshot contains authoritative secret state and must be
  projected into public, self-private, and role-private views before any
  browser response.
- Role-owned IDs, action kinds, end reasons, metadata, and behavior stay in the
  owning Role module. Shared code coordinates generic hooks, effects, phases,
  persistence, and projections without role-specific allowlists or switches.
- Hunter-specific definitions live only in
  `lib/server/game/roles/hunter.ts`. A different Role must be able to produce
  equivalent effects under its own identifiers without changes to common code.
- `game_phase_instances` preserves phase identity and timing history, while
  `resolved_actions` preserves complete submitted and missing core and
  role-action history independently from bounded presentation events.

See `docs/supabase.md` for the transaction and secret-boundary details and
`docs/game/roles.md` for the extension model.

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
MAINTENANCE_SECRET=<random secret containing at least 32 bytes>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
SUPABASE_JWT_SECRET=<JWT_SECRET>
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
`SUPABASE_JWT_SECRET` signs short-lived browser tokens for private Realtime
channels. Use the local `JWT_SECRET` printed by `supabase status`; never expose
it through a `NEXT_PUBLIC_` variable.
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

Before the first release, use a disposable development database and verify that
the four responsibility-based baseline migrations are the only applied versions:

```sh
pnpm exec supabase migration list
```

Local and remote versions should list only `0001` through `0004`. Recreate any
pre-release database that contains the superseded development migration history
instead of repairing it in place.

To verify room-code reuse hardening, run:

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

Migration change policy:

- Before the first production release, update the responsibility-based baseline
  only together with recreating every disposable database that applied an older
  baseline. Do not repair superseded development history in place.
- After the first production release, do not edit or delete an already-applied
  migration. Add a forward migration that restores behavior or provides a
  compatibility path.
- For production data issues, snapshot/export the affected tables first, then
  apply a forward corrective migration.
- Roll back application deploys independently from database migrations. Keep
  server code compatible with the applied schema before promoting it.

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
curl -X POST http://localhost:3000/api/maintenance/expire-waiting-rooms \
  -H "authorization: Bearer $MAINTENANCE_SECRET" \
  -H "content-type: application/json" \
  -d '{"limit":50}'
```

The endpoint ends only already-expired waiting rooms, prunes obsolete Realtime
grants, and returns both counts.

## Deploy

Deploy the Next.js app to Vercel or another server runtime that supports the
Next.js App Router API routes.

Production environment variables:

```sh
ACCOUNT_TOKEN_HASH_SECRET=
MAINTENANCE_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
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

If using scheduled cleanup, call `/api/maintenance/expire-waiting-rooms` from a
trusted cron job with `Authorization: Bearer <MAINTENANCE_SECRET>`. The secret
must contain at least 32 bytes. The endpoint is idempotent for already-expired
waiting rooms.

## Validation

```sh
pnpm run format
pnpm run lint
pnpm test
pnpm run lint:db
pnpm run test:db
pnpm run db:diff
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm run build
pnpm run test:e2e:all
```

Unit tests cover the engine, roles, effects, persisted contracts, token
handling, shared rule constraints, maintenance authentication, localization,
and presentation helpers. Database tests require the local Supabase stack;
`db:diff` should report no schema DDL after a clean reset.

The Playwright suite owns one reproducible local lifecycle. It reads and validates
the loopback-only local environment from `supabase status -o env`, resets local
Supabase, injects the local credentials into the build and test server, and starts
`next start`. Its specs verify the three-browser waiting-room
and first-night UI flow, eight-player role/private-view boundaries, stale action
rejection, private night conversation, private Realtime authorization and
broadcast delivery, and maintenance authentication.

Use `test:e2e:roles` or `test:e2e:security` to run tagged subsets.
`test:e2e:all` is an alias for the complete Playwright suite. Set
`E2E_SKIP_DB_RESET=1` or `E2E_SKIP_BUILD=1` only when deliberately reusing local
state or an existing build.

To test an already running deployment, pass `E2E_BASE_URL=https://...`. Remote
runs do not reset a database, build the app, or start a server. The authorized
maintenance assertion is skipped unless running against the managed local test
server.

## Architecture

- Browser code talks to Next.js API routes only.
- Server code authenticates `Authorization: Bearer <account token>` and hashes
  tokens with `ACCOUNT_TOKEN_HASH_SECRET`.
- Supabase base tables are RLS-enabled and default-deny for browser clients.
- Browser-facing state is cut into public, self-private, and role-private views.
- Realtime uses short-lived server-signed grants and private channels. Payloads
  carry notification reasons only; clients reload views from the API after a
  notification.
