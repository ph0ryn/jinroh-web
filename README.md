# Jinroh Web

Jinroh Web is a polished Next.js application for managing shared game state for
in-person or voice-call werewolf games.

It does not replace table talk, voice chat, or human discussion. Its role is to
track the state that is tedious or error-prone to manage by hand: anonymous room
identity, lobby membership, role-safe private views, phase timers, night actions,
voting, execution, and locked final results.

![Jinroh Web tabletop hero](public/images/jinroh-tabletop.jpg)

## Product Goals

- Start a room anonymously and let players join with a six-digit code.
- Keep the database as the source of truth and use realtime only as a reload
  signal.
- Never expose Account IDs, raw account tokens, role assignments, night targets,
  vote details in progress, or werewolf consultation content to the wrong
  browser view.
- Visualize a complete game path with Werewolf, Villager, Madman, Seer, Guard,
  and Fox roles while backend implementation follows the current product spec.
- Provide a high-polish mobile-first UI that also works as a desktop
  progress board.

## UI Surface

The current app shell is a local, code-native product surface for the full
Jinroh Web direction:

- Home and lobby entry for anonymous room creation and code-based joining.
- Desktop game board with state rail, phase timeline, player seats, host
  controls, action status, activity, and role legend.
- Night, day, voting, execution, result, and demo states driven by local UI
  state for product review and demos.
- Mobile layout with stacked content, scrollable state rail, and bottom phase
  tabs.

This UI does not add new persisted game behavior by itself. Use `docs/spec.md`
as the implementation boundary for the current product.

## Local Setup

Create `.env.local`:

```sh
ACCOUNT_TOKEN_HASH_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Generate the token hash secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Install dependencies and run:

```sh
pnpm install
pnpm dev
```

Apply the Supabase schema files in `supabase/migrations/` to a fresh Supabase
project before using the app.

For an existing Supabase project, apply migrations in order. To verify room-code
reuse hardening after `0003_restore_active_room_code_reuse.sql`, run:

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

## Validation

```sh
pnpm test
pnpm run test:e2e
pnpm run lint
pnpm run build
```

The focused tests cover ruleset validation, token hashing, secret-safe game
events, role-scoped night actions, winner judgement, and player result mapping.
The E2E smoke test launches three isolated browser contexts and plays a room
from creation through the final result, including the execution timeout path.

## Architecture

- Browser code talks to Next.js API routes only.
- Server code authenticates `Authorization: Bearer <account token>` and hashes
  tokens with `ACCOUNT_TOKEN_HASH_SECRET`.
- Supabase base tables are RLS-enabled and default-deny for browser clients.
- Browser-facing state is cut into public, self-private, and role-private views.
- Realtime payloads should carry notification reasons only; clients reload views
  from the API after a notification.
