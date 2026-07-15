# Replayable Rooms Design

## Current Behavior And Required Delta

Today `rooms.started_at` and `rooms.ended_at` encode both Room and Game state,
and every Game artifact is keyed by `room_id`. The first completed Game is
terminal, its code becomes reusable, and the runtime snapshot has no way to
exclude one Game while retaining Room membership.

The new model keeps Room identity and membership across plays. A first-class
Game owns all play-specific state, and `rooms.current_game_id` is the sole
projection pointer. Detaching or replacing that pointer changes the current
view without deleting historical Games.

## Requirement Mapping

| Design area                            | Requirements                                        |
| -------------------------------------- | --------------------------------------------------- |
| Room/Game split and current pointer    | `REPLAY-ROOM-*`, `REPLAY-GAME-*`, `REPLAY-RESULT-*` |
| Membership and roster revision         | `REPLAY-JOIN-*`, `REPLAY-READY-*`                   |
| Atomic start and stale mutation checks | `REPLAY-START-*`, `REPLAY-STALE-001`                |
| Snapshot and realtime isolation        | `REPLAY-REALTIME-001`, `REPLAY-REVISION-001`        |
| Browser state and motion settlement    | `REPLAY-UI-*`                                       |

## Data Model

### Room

`rooms` owns invitation and membership lifecycle only.

- Remove Game lifecycle fields `started_at` and Game-ending `ended_at`.
- Add `closed_at` for permanent Room closure.
- Add nullable `current_game_id`.
- Add monotonic `roster_revision`.
- Keep `lobby_expires_at`, refreshing it on Game completion and on a
  non-roster postgame join.
- Keep monotonic public `snapshot_revision`.
- Reserve the public Room code with a partial unique index while
  `closed_at is null`.
- Enforce `(room_id, current_game_id)` against `games(room_id, id)` with a
  deferred same-Room foreign key.

Room status is derived rather than stored:

```text
closed_at != null                         -> closed
current Game exists and ended_at is null -> playing
current Game exists and ended_at != null -> ended result lobby
current_game_id is null                   -> waiting clean lobby
```

The browser does not receive a closed Room as its current Room. For a
non-member lookup, the application projection suppresses an ended current Game
and exposes only joinable lobby information.

### Membership

`players` remains the stable Account-to-Room identity and gains:

- `ready_roster_revision`: nullable revision for which the Player is ready.
- `private_snapshot_revision`: a Room-lifetime monotonic counter for private
  view ordering.

An active Player is lobby-ready only when
`ready_roster_revision = rooms.roster_revision`. Incrementing the Room roster
revision invalidates all readiness without a mass update or a race between
concurrent ready requests.

### Game

`games` replaces the one-per-Room `game_states` record and is the root of one
playthrough.

- UUID `id`, exposed as `PublicGameView.gameId`.
- `room_id` and Room-local `sequence_number`.
- Current phase, phase instance, day/night counters, Game revision, and action
  revision.
- `winner_team`, `started_at`, `updated_at`, and nullable `ended_at`.
- One open Game per Room and unique `(room_id, sequence)`.

`game_players` replaces the parallel `role_assignments`,
`game_player_states`, and `player_results` rows. It owns the immutable roster
and role plus mutable `alive` and nullable final `result`. Composite foreign
keys prove that each Game Player belongs to the same Room as the Game.

The following tables become Game-scoped through `game_id`:

- `game_rule_sets`
- `game_phase_instances`
- `game_players`
- `current_actions` and eligible targets
- `pending_actions` and `resolved_actions`
- `game_events` and visibility recipients
- `night_conversation_messages`
- `day_speech_slots`

The winner lives on `games`; the separate one-row `final_outcomes` table is no
longer needed.

## Runtime Snapshot

The server-only snapshot advances to version 2 and nests all current-Game data:

```text
RoomRuntimeSnapshot
  room
  viewerPlayerId
  lobbyPlayers
  currentGame: null | GameRuntimeSnapshot
  realtimeTopics
```

`GameRuntimeSnapshot` contains only rows filtered by the exact
`rooms.current_game_id`. Engine history uses the same Game ID. The waiting
snapshot cannot contain Game players, roles, actions, events, chat, receipts,
winner, or results by construction.

The public view exposes `gameId` but no internal Room or Account identifier.
Game action and night-conversation requests include `gameId`; repository and DB
transactions verify it equals the Room's current Game before phase/revision CAS.

## Lifecycle Transactions

### Join

1. Lock the Account, then lock source and target Rooms in ascending Room-ID
   order before membership changes.
2. Before create or join, close an expired current Room in the same transaction
   so an obsolete membership cannot block the requested destination.
3. Reject an outsider while the current Game is playing; permit an existing
   active member to reconnect.
4. Check capacity before changing the current Game pointer.
5. If the activating Player is absent from the current completed Game roster,
   set `current_game_id = null`, increment `roster_revision`, refresh the lobby
   expiry, and then activate the membership in the same transaction.
6. If the Player belonged to the completed Game, keep the result pointer but
   still increment `roster_revision` for an effective reactivation.
7. Record Room events and increment the public snapshot revision once.

A failed capacity, current-Room, or joinability check rolls back both membership
and pointer changes.

### Leave

- Resolve request-time lobby expiry before applying the leave.
- Reject leave while the current Game is playing.
- Mark membership left, increment `roster_revision`, transfer host if needed,
  and keep a completed current Game available to remaining members.
- Set `closed_at` only when no active membership remains. Only then is the Room
  code released.

### Lobby Readiness

`POST /api/rooms/[roomCode]/readiness` accepts `isReady` and
`expectedRosterRevision`.

- Authenticate through Account membership.
- Resolve request-time lobby expiry before applying readiness.
- Allow only a joined Player while no current Game is playing.
- Reject a mismatched roster revision.
- Set or clear `ready_roster_revision` idempotently.
- Increment the public snapshot revision and notify only when effective state
  changes.

### Start

The application computes Role assignment for the accepted roster, then the DB
transaction rechecks under lock:

- request-time lobby expiry;
- joined host authority;
- open, unexpired Room with no playing current Game;
- exact active and connected target roster;
- every Player ready for `expectedRosterRevision`;
- exact expected Player IDs.

It inserts a new Game and all initial Game-scoped artifacts, replaces
`current_game_id`, increments Room snapshot revision, and records
`game_started`. A concurrent join, leave, readiness epoch change, or start makes
one side fail cleanly.

### Game Completion

The phase-resolution transaction identifies the Game directly and verifies it
is still `rooms.current_game_id`. It fixes winner and Player results on that
Game, closes the phase, sets `games.ended_at`, increments `roster_revision`,
refreshes `lobby_expires_at`, retains the pointer for result presentation,
and records `game_ended`. It never closes the Room.

## Realtime And Revision Ordering

- Room and player-private topics remain Room/membership scoped.
- Role-private topics carry `game_id` and are unique per Game role.
- A grant records the Game that was current when issued.
- Room/player topic checks continue to use active membership.
- Role-topic checks additionally require
  `grant.game_id = topic.game_id = rooms.current_game_id` and a matching
  `game_players.role_id`.

Old grants may still receive the Room invalidation that tells the browser to
reload, but cannot receive a detached or replacement Game's role topic. The
next authorization refresh issues a grant for the new Game.

Remove topic-local snapshot counters. Public mutations increment
`rooms.snapshot_revision`; private mutations increment the affected Players'
`private_snapshot_revision`. The browser revision is their sum, so it never
decreases when a role topic or Game changes.

## Browser And Motion Boundaries

- `PublicPlayer.isLobbyReady` drives ready indicators and the current Player's
  toggle.
- Seat occupancy progress remains separate from readiness and renames its
  misleading internal `ready` state to `full`.
- Waiting and result surfaces both expose readiness, leave, invite, settings
  for the host, and a host-only start button.
- The start button requires exact target occupancy, all members connected, and
  all members ready.
- `gameId` becomes the Game-session key for cinematic queues, action feedback,
  public log additions, night conversation, Game-bound toasts, and other held
  UI state.
- An accepted transition from ended `gameId` to `game = null` cancels and
  settles all Game-bound state immediately. A different new `gameId` starts a
  fresh role/phase choreography even if the viewer receives the same Role again.
- Existing GSAP registration, scoped timelines, reduced-motion handling, and
  setup-transition baselines remain unchanged.

## Error Handling And Security

- Add explicit conflict errors for stale roster revision, unready roster, and
  stale Game ID.
- Map a presence change during the locked start check to `players_not_ready`,
  and an existing active membership in another Room to `current_room_exists`.
- Keep Account authority server-side; no mutation trusts browser Player IDs.
- Never project a historical Game merely because it is the latest row. Projection
  always follows the explicit current pointer and viewer authorization.
- Non-member Room reads suppress completed-Game public results to prevent a
  prospective joiner from inspecting revealed roles before the join reset.

## Alternatives Rejected

- **Delete and reuse one Room-scoped Game:** rejected because it loses history,
  requires fragile deletion ordering, and leaves future artifacts easy to miss.
- **Select the latest Game automatically:** rejected because a clean lobby after
  a new participant joins must intentionally have no displayed Game.
- **Boolean readiness:** rejected because stale concurrent requests can restore
  readiness after a roster change.
- **Use snapshot revision as the readiness epoch:** rejected because independent
  simultaneous ready requests would conflict with one another.
- **Keep role topics Room-scoped:** rejected because role authority changes on
  every Game.

## Impact And Migration

This is a pre-release destructive baseline rewrite. All four migrations, pgTAP
tests, repository snapshot parsing/projection, Room/Game transactions, API
contracts, browser state, localization, fixtures, and product/game/Supabase
documentation are affected. No production data migration or compatibility path
will be added.
