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

## Live Animation Boundaries

- Implement new time-based `/live` motion with GSAP and the shared registration
  in `app/live/effects/liveGsap.ts`.
- Keep animation cues, queueing, and choreography under `app/live/effects/`.
  Do not attach animations directly to polling, realtime callbacks, or API
  handlers.
- Reserve the shared FIFO queue for interruptive cinematic effects. Keep
  component-local state feedback under `app/live/effects/ui/` with its own
  scoped timeline so frequent UI changes cannot delay role, phase, death, or
  victory cues.
- Derive cues only from room snapshots after request ordering and stale-response
  checks have accepted them. Realtime messages remain invalidation signals.
- Diff only viewer-visible, semantic presentation state for component-local motion.
  Treat the first snapshot, room or viewer changes, unchanged polling results,
  and updates received while the document is hidden as settled baselines rather
  than effects to replay.
- Setup surface navigation may reveal an accepted entry-to-waiting or
  waiting-to-entry change even though the room session changes. A restored
  room, a viewer change within a room, and a room-to-room switch remain settled
  baselines.
- Treat action submission as confirmed only when a submitter-private receipt is
  present in an accepted snapshot. Do not infer personal confirmation from HTTP
  success, shared action status, or public progress. If the accepted submission
  already advanced the phase and removed its row, let the phase effect own the
  transition.
- Let the round table own player-specific membership motion. Lobby progress may
  animate only the accepted aggregate joined count against the fixed target;
  room, viewer, and target changes are settled baselines, and readiness requires
  exact equality rather than a visually full bar.
- Give each effect component one scoped `useGSAP()` timeline and let React remain
  the source of truth for game state and final CSS classes.
- Route `/live` notifications through the shared toast controller. Keep one
  active notification plus the latest pending replacement, scope room-bound
  notifications to the current room session, and keep dismissal timers out of
  page and request handlers.
- Hold accepted stable-ID list additions, including public-log rows and night
  conversation messages, while an interruptive cinematic cue obscures their
  dialog, then reveal only the latest bounded batch after the cue queue clears.
  Discard held items on close, session changes, hidden updates, and reduced
  motion rather than replaying them later.
- Separate static placement, animated transform/opacity, and final visual state
  onto different DOM layers when they could compete for the same CSS property.
  Clear transient GSAP properties and diagnostic markers after settlement.
- Use CSS Modules for static effect layout and appearance. Do not add CSS
  keyframes or CSS-driven timing for new `/live` game animations.
- Every effect must provide reduced-motion behavior through a shortened timeline
  or immediate final-state settlement, clean up on unmount or room changes,
  avoid blocking input, and preserve a non-transient way to read current game
  state.
- Route `/live` dialogs through `app/live/effects/ui/LiveModalFrame.tsx`. Keep
  dialog content mounted until its exit completes, and leave focus trapping,
  background inertness, scroll locking, and stacked-dialog ownership to the
  shared modal infrastructure.

## Role Architecture Boundaries

Keep role behavior owned by `Role` classes and `RoleRegistry`.

- Role-specific behavior must live in the role class through hooks, action
  definitions, target resolvers, setup contributions, winner judgements, and
  result evaluation.
- Adding a role should normally require adding a role class and registering it.
  Shared engine changes are acceptable only when adding a generic hook,
  resolver capability, effect type, or rule extension needed by a class.
- Do not add role-specific `roleId` branches to common game engine logic unless
  the role is part of explicitly documented core game primitives.
- Common game logic may coordinate generic concepts such as phases, actions,
  effects, deaths, teams, count groups, inspections, and winner judgement
  priority, but it should delegate role-specific decisions back to roles.
- `lib/shared/game.ts` is an API/view contract, not the source of truth for role
  behavior, role metadata, role ordering, default counts, hooks, win conditions,
  or inspection/count semantics.
- UI should render configurable role state from server-provided role catalog and
  rule data rather than maintaining its own role metadata or role universe.
- Tests and fixtures may hard-code example roles, but production behavior must
  not depend on fixture-only role lists.

When modifying older code, check whether the change belongs in a role class,
the registry, a generic engine extension, or a view/API adapter before editing.

## TypeScript Style

- Follow the naming convention enforced by ESLint:
  - type-like names use `StrictPascalCase`;
  - variables use `strictCamelCase` or `UPPER_CASE`;
  - parameters use `strictCamelCase`.
- Prefer small server-only helpers under `lib/server/` for secret-dependent
  behavior.
- Keep public identifiers, API shapes, and comments in English.
- Add comments only when they clarify non-obvious domain or security behavior.
