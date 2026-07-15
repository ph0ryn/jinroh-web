# Jinroh Web

Jinroh Web is a polished Next.js application for managing shared game state for
in-person or voice-call werewolf games.

It does not replace table talk, voice chat, or human discussion. Its role is to
track the state that is tedious or error-prone to manage by hand: anonymous Room
identity, reusable lobby membership, role-safe private views, phase timers, night
actions, voting, execution, and isolated per-Game results.

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
- A Room is the reusable invitation and membership boundary. Every playthrough
  is a distinct Game, and only `rooms.current_game_id` may supply the Game state
  projected into the Room snapshot.
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
pnpm run db:start
```

Generate the token hash secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Create `.env.local` with the local values printed by `pnpm run db:start`:

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

Stop the local Supabase stack explicitly when finished:

```sh
pnpm run db:stop
```

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
- Every joined player marks themselves ready. The host can start only after the
  exact target roster is connected and ready.
- Players use their visible action controls through first night, day, voting,
  execution, normal night, and result.
- After the result, players may leave, rejoin, ready, and start another Game in
  the same Room. If a person outside the completed Game roster joins, the Room
  returns to a clean pre-game lobby and no prior roles or results remain in the
  current view.
- Werewolf players can open night chat; it is writable during night and
  read-only outside night.
- Open room pages heartbeat in the background. Players with stale heartbeats
  are shown as disconnected and become joined again when their browser resumes.

Optional maintenance endpoint for cron or manual cleanup:

```sh
curl -X POST http://localhost:3000/api/maintenance/expire-rooms \
  -H "authorization: Bearer $MAINTENANCE_SECRET" \
  -H "content-type: application/json" \
  -d '{"limit":50}'
```

The endpoint closes only Rooms whose waiting or result lobby has expired,
prunes obsolete Realtime grants, and returns both counts.

## Deploy

Deploy the Next.js app to Vercel or another server runtime that supports the
Next.js App Router API routes.

Production environment variables:

```sh
ACCOUNT_TOKEN_HASH_SECRET=
MAINTENANCE_SECRET=
RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

`RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER` must name a single-value client IP header
that a trusted ingress removes and rewrites on every request. Vercel deployments
use the platform-provided `x-vercel-forwarded-for` header automatically when the
variable is omitted. Other production runtimes fail closed until the variable
is configured. Reject direct origin access that can bypass the ingress; never
configure a client-controlled `x-forwarded-for` or `x-real-ip` header without
that guarantee.

`pnpm run build` and `pnpm run start` run the same release-environment preflight
before invoking Next.js. Missing or malformed required server variables stop a
build before an artifact is produced and stop a self-hosted server before it can
print `Ready` or listen on a port. These commands are treated as release
operations even when the parent shell did not set `NODE_ENV`. Self-hosted
deployments must use `pnpm run start` rather than invoke `next start` directly.
`pnpm run dev` keeps development semantics and may omit the trusted client IP
header.

Identity creation, room creation, joining, switching, and outsider room lookup
use atomic database-backed token buckets. A rejected request returns `429` with
`Retry-After`; unavailable rate-limit storage returns `503` and does not perform
the protected operation. These application limits protect domain writes and
room-code lookup, but they do not replace CDN/WAF rate limiting, bot management,
request-size limits, or network-level denial-of-service protection.

Deployment order:

1. Apply Supabase migrations with `pnpm exec supabase db push`.
2. Confirm `pnpm exec supabase migration list` shows local and remote at the
   same latest migration.
3. Configure the production environment variables in the host.
4. Confirm the trusted ingress overwrites the configured client IP header and
   the application origin cannot be reached around it.
5. Build with `pnpm run build`; the release preflight must succeed before Next.js
   begins compiling.
6. Deploy the app. Self-hosted deployments must launch it with `pnpm run start`
   so the same preflight runs before the server process.
7. Verify a deliberate quota breach returns `429` with a positive
   `Retry-After`, and verify the upstream WAF independently blocks abusive
   traffic.
8. Run focused smoke checks against the local test stack when needed. The
   repository integration and browser suites write test data, so do not run
   them against production data.

If using scheduled cleanup, call `/api/maintenance/expire-rooms` from a
trusted cron job with `Authorization: Bearer <MAINTENANCE_SECRET>`. The secret
must contain at least 32 bytes. The endpoint is idempotent for already-expired
Room lobbies.

## Validation

```sh
pnpm run format
pnpm run lint
pnpm run lint:db
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm test
pnpm run db:diff
```

Unit tests cover the engine, roles, effects, persisted contracts, token
handling, shared rule constraints, maintenance authentication, localization,
and presentation helpers. Database tests require the local Supabase stack;
`db:diff` should report no schema DDL after a clean reset.

Playwright has separate `integration` and `browser` projects under
`test/integration/` and `test/browser/`. `test:e2e` resets the database, runs
pgTAP, and invokes Playwright once so both projects share one `webServer` build
and `next start` lifecycle. Run `pnpm test` for unit, pgTAP, integration, and
browser coverage. Local E2E commands reset and write to the same database, so
do not run multiple E2E commands concurrently.

See `test/README.md` for fixture and assertion guidance.

## Architecture

- Browser code talks to Next.js API routes only.
- Server code authenticates `Authorization: Bearer <account token>` and hashes
  tokens with `ACCOUNT_TOKEN_HASH_SECRET`.
- Supabase base tables are RLS-enabled and default-deny for browser clients.
- Browser-facing state is cut into public, self-private, and role-private views.
- Realtime uses short-lived server-signed grants and private channels. Payloads
  carry notification reasons only; clients reload views from the API after a
  notification.
