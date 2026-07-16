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

Generate a local ES256 JWT signing key, then start the local Supabase stack:

```sh
pnpm run db:keygen
pnpm run db:start
```

The generated `supabase/signing_keys.json` is local secret material and is
ignored by Git. Generate a different key for every environment and never reuse
the local key in a hosted Supabase project.

Generate the token hash secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Create `.env.local` with the local values printed by `pnpm run db:start`:

```sh
ACCOUNT_TOKEN_HASH_SECRET=<generated 32-byte base64 secret>
MAINTENANCE_SECRET=<random secret containing at least 32 bytes>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<SECRET_KEY>
SUPABASE_JWT_SIGNING_KEY='<single-line JSON from supabase/signing_keys.json>'
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Print the single JWK object for `SUPABASE_JWT_SIGNING_KEY` instead of copying
the surrounding JSON array:

```sh
jq -c '.[0]' supabase/signing_keys.json
```

To print the local Supabase values again, run:

```sh
pnpm exec supabase status -o env
```

`NEXT_PUBLIC_SUPABASE_URL` should match `SUPABASE_URL`. Add
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to enable Supabase Realtime invalidation
in the browser. Without the public key, the live table still works through
polling. `SUPABASE_JWT_SIGNING_KEY` contains the first ES256 private JWK object
from the generated JSON array and is used to sign short-lived browser tokens for
private Realtime channels. Its `kid` must match the key loaded by the local
Supabase stack; never expose the private JWK through a `NEXT_PUBLIC_` variable.
Keep production Supabase credentials out of local `.env.local`.
`NEXT_PUBLIC_SITE_URL` is optional locally. Set it to the deployed origin in
production when you want Open Graph images to resolve to a canonical URL; Vercel
deployment URL environment variables are used as a fallback. Never expose
`SUPABASE_SECRET_KEY` to the browser.

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
the five responsibility-based baseline migrations are the only applied versions:

```sh
pnpm exec supabase migration list
```

Local and remote versions should list only `0001` through `0005`. Recreate any
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

Supabase Cron calls the maintenance endpoint every five minutes. It can also be
invoked manually:

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
SUPABASE_SECRET_KEY=
SUPABASE_JWT_SIGNING_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=
```

Use the Supabase publishable key (`sb_publishable_...`) and secret key
(`sb_secret_...`); do not configure the legacy `anon` or `service_role` API
keys. Generate the production ES256 private JWK with `pnpm run jwt:keygen`, store
the printed JSON immediately in a secure secret manager, and import that same
JWK as a standby key under Supabase Dashboard > JWT Signing Keys.
Supabase-generated asymmetric keys cannot be exported and therefore cannot be
used by this application server to mint custom Realtime JWTs.

If the Dashboard still shows `Migrate JWT secret`, run that migration first. It
imports the legacy secret into the Signing Keys system and creates a
Supabase-generated asymmetric standby key. Do not rotate that generated key:
move it to Previously used and then Revoked to free the standby position, because
its private key cannot be exported for this application's custom JWT signer. If
the project already uses the Signing Keys system, create the application-owned
standby key directly.

After importing the application-owned key, rotate it into use before deploying
the application with its serialized private JWK in `SUPABASE_JWT_SIGNING_KEY`.
The JWT `kid` must match the imported key. Keep the previous key trusted until
the new deployment has completed a private-Realtime smoke test and every token
from the retired deployment has expired. Realtime grants currently last 120
seconds, so wait at least 120 seconds plus an operational margin after retiring
the old deployment. Only then disable the legacy API keys and revoke the legacy
JWT signing key. Never commit or log a private JWK.

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

Identity creation, room creation, joining, switching, room snapshots, heartbeats,
readiness updates, night-conversation messages, Realtime grant issuance, and
outsider room lookup use atomic database-backed token buckets. In-room operations
combine an Account bucket with a trusted-client bucket scoped to the target Room.
A rejected request returns `429` with `Retry-After`; unavailable rate-limit storage
returns `503` and does not perform the protected operation. These application
limits protect domain writes and room-code lookup, but they do not replace CDN/WAF
rate limiting, bot management, request-size limits, or network-level
denial-of-service protection.

Migration `0005_maintenance_cron.sql` enables `pg_cron`, reuses `pg_net` and
Supabase Vault, and registers the `jinroh-web-expire-rooms` job. Create these
named Vault secrets before applying the migration:

```sql
select vault.create_secret(
  'https://jinroh.example',
  'jinroh_web_maintenance_base_url',
  'Jinroh Web maintenance endpoint base URL'
);

select vault.create_secret(
  '<same value as MAINTENANCE_SECRET>',
  'jinroh_web_maintenance_secret',
  'Jinroh Web maintenance endpoint bearer secret'
);
```

The base URL must be an HTTPS origin without a path. The maintenance secret must
contain at least 32 bytes and must exactly match the Next.js
`MAINTENANCE_SECRET`. Create or update the values through the Supabase Vault UI
when the named secrets already exist; never commit either value to the
repository.

If the job was disabled while configuring Vault, enable it after both values are
present:

```sql
select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'jinroh-web-expire-rooms'
  ),
  active := true
);
```

Deployment order:

1. Create the Supabase publishable and secret API keys.
2. If `Migrate JWT secret` is shown, run it and move its automatically generated
   asymmetric standby key to Previously used and then Revoked without rotating
   it.
3. Generate, securely store, import, and rotate the application-owned ES256 JWT
   signing key.
4. Create or update the two named Supabase Vault secrets.
5. Apply Supabase migrations with `pnpm exec supabase db push`.
6. Confirm `pnpm exec supabase migration list` shows local and remote at the
   same latest migration.
7. Configure the production environment variables in the host.
8. Confirm the trusted ingress overwrites the configured client IP header and
   the application origin cannot be reached around it.
9. Build with `pnpm run build`; the release preflight must succeed before Next.js
   begins compiling.
10. Deploy the app. Self-hosted deployments must launch it with `pnpm run start`
    so the same preflight runs before the server process.
11. Verify a deliberate quota breach returns `429` with a positive
    `Retry-After`, and verify the upstream WAF independently blocks abusive
    traffic.
12. Verify a private Realtime subscription with an ES256 token. After the old
    deployment is retired, wait at least the 120-second grant lifetime plus an
    operational margin, confirm the legacy API keys are no longer used, disable
    them, and then revoke the legacy JWT signing key. If the grant lifetime
    changes, wait for its maximum possible lifetime plus a margin instead.
13. Confirm `jinroh-web-expire-rooms` is active in Supabase Cron and inspect its
    run history. Check recent `net._http_response` rows for an HTTP `200` from the
    maintenance route.
14. Run focused smoke checks against the local test stack when needed. The
    repository integration and browser suites write test data, so do not run
    them against production data.

The Cron function fails explicitly when either Vault secret is missing or
invalid. The endpoint is idempotent for already-expired Room lobbies. `pg_net`
stores responses temporarily, so external alerting should not depend on that
table as long-term history.

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
