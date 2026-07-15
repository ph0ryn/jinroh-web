# Replayable Rooms Tasks

## Task 1: Contract And Schema (Completed)

- Update shared Room/Game/readiness contracts.
- Rewrite the clean schema baseline around `rooms.current_game_id`, `games`, and
  Game-scoped artifacts.
- Add roster revision, monotonic member-private revision, and Game-aware
  realtime authorization.
- Completion: a clean database reset applies the new schema and schema-security
  pgTAP assertions pass.

## Task 2: Room And Game Transactions (Completed)

- Rework create, join, switch, leave, heartbeat, expiry, readiness, start,
  action, chat, and phase-resolution RPCs.
- Preserve atomic membership and current-Game pointer behavior under races.
- Completion: lifecycle and Game transaction pgTAP tests cover replay,
  readiness, stale Game IDs, and result reset.

## Task 3: Server Snapshot And APIs (Completed)

- Introduce the nested version 2 current-Game snapshot.
- Move repository resolution and persistence calls from Room IDs to Game IDs.
- Add readiness API and Game IDs to Game mutation bodies.
- Suppress completed Game data for non-members.
- Completion: server unit tests and integration API tests prove projection and
  stale-request isolation.

## Task 4: Live UI And Motion (Completed)

- Add ready/unready controls and indicators to waiting and result surfaces.
- Gate host start on exact connected occupancy and readiness.
- Keep invitation, settings, leave, and result access usable after a Game.
- Add Game-session settlement to every Game-bound GSAP/UI state holder.
- Completion: focused model tests and browser tests cover both same-roster
  replay and new-participant reset.

## Task 5: Documentation And Validation (Completed)

- Align `docs/spec.md`, `docs/game/*`, `docs/supabase.md`, and test fixtures.
- Run format, lint, type checking, unit, DB, build, browser/integration, schema
  diff, and structural debt checks.
- Record requirement coverage and any residual gap in `validation.md`.
- Completion: all requirements have passing evidence and the worktree contains
  no generated or unrelated changes.
- Final evidence: see `validation.md`.

## Dependencies And Concurrency

- Task 1 contracts must stabilize before Tasks 2-4 integrate.
- SQL transaction work and UI component work may proceed in parallel after the
  public contract is fixed.
- Snapshot/API integration depends on the final SQL payload shape.
- Full browser validation depends on all earlier tasks and a reset local DB.
