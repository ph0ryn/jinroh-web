# Replayable Rooms Change Log

## 2026-07-15: Requirements And Design Baseline

- Defined Room as the reusable invitation/membership boundary and Game as a
  first-class playthrough.
- Chose an explicit `rooms.current_game_id` projection pointer while retaining
  historical Games.
- Defined roster-revision readiness, atomic non-roster join reset, Game-aware
  mutations/realtime, monotonic private revisions, and Game-session UI
  settlement.
- Recorded the destructive migration boundary and full validation plan.

Reason: the previous one-Room/one-Game contract cannot provide replay without
history mixing, role leakage, code-reuse ambiguity, and stale request hazards.

Affected artifacts: `requirements.md`, `design.md`, `tasks.md`, and
`validation.md`.

## 2026-07-15: Implementation And Validation Completed

- Rebuilt all four migrations and pgTAP suites around reusable Rooms,
  first-class Games, Game Players, roster-revision readiness, and Game-scoped
  realtime authorization.
- Added the version 2 nested current-Game snapshot, readiness API, public Game
  ID mutation checks, and server projection that cannot mix historical Games.
- Added result-lobby replay controls and Game-session settlement for dialogs,
  drafts, toasts, action feedback, held additions, realtime grants, and GSAP
  cinematic queues.
- Hardened same-Role replay grant rotation, idempotent false readiness,
  request-time expiry, start/presence races, and stable source/target Room lock
  ordering.
- Added stale action, chat, and phase checks plus result expiry, monotonic
  revision, same-roster replay, and new-participant reset coverage.
- Aligned product, game-system, Supabase, README, localization, fixtures, and
  maintenance endpoint documentation.
- Completed the format, lint, type, unit, database, schema, production build,
  Playwright, and structural-debt validation recorded in `validation.md`.

Reason: a Room is now a reusable social and membership boundary, while each
playthrough needs isolated, durable Game identity and authorization.

Impact area: schema baseline, Room/Game transactions, snapshots, API contracts,
realtime grants, live UI and effects, localization, tests, and documentation.

Related artifacts: all documents in this feature directory, the four Supabase
migrations and pgTAP suites, server Game repository/view modules, `/live`, and
replay integration/browser tests.
