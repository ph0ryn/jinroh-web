# AGENTS.md

## Scope

This file contains repository-specific guidance for agents working on Jinroh
Web. Keep personal, machine-level, or global agent rules out of this file.

## Project Context

Jinroh Web is a Next.js application for managing shared game state for in-person
or voice-call werewolf games. The current product boundary is a complete
playable foundation: anonymous browser identity, room creation and joining,
player management, host state, realtime invalidation, role assignment, phase
timers, night actions, voting, execution, final results, and role-private night
conversation for roles that opt in.

Do not implement general public chat, direct messages, registered accounts,
OAuth, moderation tools, admin screens, billing, or friend features unless the
product spec is updated first. Role-private night conversation is in scope only
through the explicit role opt-in model in `docs/game/night-conversation.md`.

## Source Of Truth

- Use `docs/spec.md` as the primary product specification.
- Use `docs/game/*.md` for game-flow, ruleset, visibility, model, and engine
  details for playable game behavior.
- If `README.md` conflicts with `docs/spec.md`, follow `docs/spec.md`.

## Repository Layout

- `app/`: Next.js routes, layouts, and UI.
- `lib/server/`: server-only application logic and secret-dependent helpers.
- `docs/`: product and game-system specifications.
- `*.config.ts`, `*.config.mjs`: tool configuration. Keep changes narrow and
  tied to a concrete need.

## Implementation Rules

- Keep the database as the source of truth for persistent game state.
- Treat realtime messages as invalidation signals. Clients should reload current
  room state from the application server after a notification.
- Browser code must not read or write Supabase base tables directly.
- Put authorization checks on the application server. Use the authenticated
  Account, not client-supplied Player IDs, as the authority for permissions.
- Do not expose internal Account IDs to the browser.
- Never store raw account tokens in the database, log raw account tokens, or put
  account tokens in URLs.
- `ACCOUNT_TOKEN_HASH_SECRET` is a server-only secret. It must be a standard
  base64 encoded 32-byte HMAC key.
- Keep user-supplied display names as text. Do not render them as HTML.

## TypeScript Style

- Follow the naming convention enforced by ESLint:
  - type-like names use `StrictPascalCase`;
  - variables use `strictCamelCase` or `UPPER_CASE`;
  - parameters use `strictCamelCase`.
- Prefer small server-only helpers under `lib/server/` for secret-dependent
  behavior.
- Keep public identifiers, API shapes, and comments in English.
- Add comments only when they clarify non-obvious domain or security behavior.
