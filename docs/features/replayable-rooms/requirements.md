# Replayable Rooms Requirements

## Background

The current persistence model treats a Room and one Game as the same lifecycle.
Completing a Game therefore ends the Room, releases its room code, and leaves all
role assignments, actions, events, conversations, and results keyed only by the
Room. That model cannot safely support a second Game or a new participant after
the result screen.

## Objective

Keep a Room as a reusable invitation and membership boundary while storing each
playthrough as an independent Game. A completed Room must allow free entry and
exit, require every current participant to become lobby-ready before a Game can
start, and remove the previous Game from the current view as soon as a person
outside that Game roster joins.

## Scope

- Separate Room membership state from Game state and history.
- Retain completed Games under stable Game identifiers.
- Add roster-scoped lobby readiness for every active Room participant.
- Allow leave, rejoin, host transfer, and atomic Room switching after a Game.
- Allow the same roster to start another Game after everyone is ready.
- Reset the visible lobby to a clean pre-game snapshot when a non-roster
  participant joins after a completed Game.
- Make snapshots, mutations, realtime authorization, effects, and tests
  Game-aware.

## Non-Scope

- User-facing match history or a past-Game browser.
- Mid-Game entry, exit, roster replacement, or spectator access.
- Changing a Room's target player count after creation.
- Treating lobby readiness as approval of the host's locally selected RuleSet.
- Preserving compatibility with the pre-release Room-scoped database schema.

## Functional Requirements

- `REPLAY-ROOM-001`: Completing a Game must not close its Room or release the
  Room code.
- `REPLAY-ROOM-002`: A Room code must remain unique while the Room is open and
  become reusable only after the Room is permanently closed.
- `REPLAY-GAME-001`: Every start must create a distinct Game with a stable,
  browser-safe Game ID and a Room-local sequence number.
- `REPLAY-GAME-002`: RuleSet, roster, roles, mutable player state, phases,
  actions, events, conversations, winner, and player results must belong to one
  Game rather than directly to a Room.
- `REPLAY-GAME-003`: Only `rooms.current_game_id` may be projected as the
  current Game. Historical Games must never be merged into the current snapshot
  or Engine input.
- `REPLAY-RESULT-001`: Active members of the completed Game roster may continue
  to view its result, revealed roles, public log, and their authorized private
  result while that Game remains current.
- `REPLAY-RESULT-002`: A non-member lookup must not reveal the completed Game's
  roles, events, conversations, action receipts, or results.
- `REPLAY-JOIN-001`: Joining and leaving must be allowed when there is no
  playing current Game. Existing active members may reconnect during a Game,
  but outsiders may not join and members may not leave while it is playing.
- `REPLAY-JOIN-002`: When a Player who is not in the current completed Game
  roster becomes an active member, the same transaction must detach that Game
  from `rooms.current_game_id`, refresh the lobby expiry, invalidate lobby
  readiness, and return a clean pre-game snapshot.
- `REPLAY-JOIN-003`: Reconnecting an active member or reactivating a Player who
  belonged to the current completed Game must not detach the result Game.
- `REPLAY-READY-001`: Every active participant must explicitly set lobby
  readiness for the current roster revision.
- `REPLAY-READY-002`: An effective join, reactivation, leave, or Game completion
  must increment the roster revision and thereby invalidate all earlier lobby
  readiness. Disconnect and reconnect alone must preserve readiness.
- `REPLAY-READY-003`: Readiness changes must use an expected roster revision so
  a stale click cannot apply to a changed roster, while simultaneous readiness
  changes for the same roster may all succeed.
- `REPLAY-START-001`: Only the joined host may start. The active roster must
  exactly match the target count, every active member must be connected and
  ready for the accepted roster revision, and the expected roster and Player
  IDs must still match under the database lock.
- `REPLAY-START-002`: A successful replay start must atomically create a new
  Game and replace `rooms.current_game_id`; the prior Game remains historical.
- `REPLAY-STALE-001`: Game mutations must carry the public Game ID and reject a
  request unless it identifies the Room's current Game in addition to passing
  the existing phase and revision checks.
- `REPLAY-REALTIME-001`: Role-private realtime topics and authorization must be
  scoped to one Game. A prior Game's role authorization must stop working as
  soon as that Game is detached or replaced.
- `REPLAY-REVISION-001`: Browser snapshot revisions must remain monotonic for a
  Room member across Game detachments and replacements.
- `REPLAY-UI-001`: Waiting and result surfaces must show each active member's
  lobby readiness, let the current member toggle it, and keep the host start
  action disabled until all start conditions are satisfied.
- `REPLAY-UI-002`: Moving from a completed Game to a clean lobby must clear all
  Game-bound dialogs, drafts, notifications, pending action feedback, held list
  additions, and cinematic effects without replaying old cues.

## Non-Functional Requirements

- Membership, current-Game pointer changes, roster revision changes, and Game
  creation must be transactional under concurrent tabs and requests.
- Browser code must continue to use application-server APIs only.
- Account IDs, tokens, and secret Game data must not enter browser payloads or
  realtime invalidation messages.
- Game-specific identifiers and Role behavior must remain opaque outside their
  owning Role modules.
- The clean pre-release schema baseline must be rewritten directly; no legacy
  compatibility columns, data migrations, or fallback query paths are required.

## Assumptions

- "A new person" means an activating Player who is absent from the current
  completed Game roster. A returning participant from that roster may still see
  the result they participated in.
- Lobby readiness means availability to begin, not approval of RuleSet details.
- The Room target count remains fixed for every replay.
- Completed Game rows are retained for integrity and auditability but are not
  exposed through a history UI.
- A completed Game refreshes the Room's 30-minute lobby window. Detaching that
  Game because of a new participant refreshes the window again.

## Unresolved Items

None.

## Acceptance Criteria

1. A full Game can end, all original participants can ready, and the host can
   start a second Game with a different Game ID in the same Room.
2. The host cannot start when any active member is missing, disconnected,
   unready, or ready for an older roster revision.
3. A non-roster join after Game completion atomically produces `game = null`,
   unrevealed roles, no old actions/events/chat/results, and a waiting UI for all
   members.
4. Old Game action, chat, phase-resolution, and role-topic credentials cannot
   affect or observe a detached or replacement Game.
5. A completed Room keeps its code until the last member leaves or the refreshed
   lobby expires.
6. Repository-standard format, lint, type checking, unit, database, build, and
   browser/integration validation all pass from a clean database reset.
