# Supabase persistence architecture

This document defines the persistence, transaction, authorization, and realtime
boundaries for Jinroh Web. Product behavior remains defined by `docs/spec.md`
and `docs/game/*.md`.

## Design goals

- PostgreSQL is the source of truth for persistent room and game state.
- Every write that spans a domain invariant is one database transaction.
- Browser code never reads or writes base tables.
- Application-server reads observe one coherent room snapshot.
- Cross-room references are structurally impossible.
- Realtime messages only invalidate cached state; they never carry authoritative
  game state.
- Role IDs and role-defined action kinds are opaque application identifiers.
  The database validates their shape and relationships without enumerating
  values, while `RoleRegistry` validates their semantics.
- Migrations are handwritten, reviewable, and organized by responsibility.

## Migration layout

The pre-release baseline has four migrations:

1. `0001_core_schema.sql` owns schemas, tables, constraints, indexes, RLS, and
   default privileges.
2. `0002_room_transactions.sql` owns identity, membership, room lifecycle,
   maintenance, and the server-only aggregate runtime snapshot.
3. `0003_game_transactions.sql` owns game start, action submission, private
   night messages, and phase resolution.
4. `0004_realtime_authorization.sql` owns short-lived realtime grants and the
   `realtime.messages` receive policy.

Do not add generated dashboard dumps, owner statements, blanket grants, or
extension boilerplate. Before the first production release, update this baseline
when a clean rebuild is intended. After production release, treat applied
migrations as immutable and add a new forward migration.

## Data ownership

### Identity

`accounts` is the stable anonymous identity. `account_tokens` stores only keyed
token hashes and revocation metadata. Raw account tokens exist only in the
browser and application server.

Identity creation and token registration are atomic through
`app_create_identity`. Authentication uses `app_authenticate_account`, which
also throttles `last_used_at` writes.

### Abuse-rate persistence

`private.rate_limit_buckets` stores atomic token-bucket state for identity
issuance, room create/join/switch mutations, and outsider room-code lookup.
`app_consume_rate_limits` locks every requested bucket in stable key order,
evaluates the complete batch against one database timestamp, and consumes all
or none of the requested tokens. This makes capacity boundaries deterministic
across concurrent server instances. Each policy's `refillSeconds` is the time
required to refill the entire capacity, not the interval for one token.

Bucket keys are HMAC-SHA-256 digests derived with a domain-separated use of
`ACCOUNT_TOKEN_HASH_SECRET`. Raw client IP addresses and limiter subjects are
never persisted or passed to `app_consume_rate_limits`; ordinary room RPCs still
receive room codes as domain input. IPv4 clients are grouped by canonical `/32`; IPv6
privacy addresses are canonicalized to `/64`, while IPv4-mapped IPv6 values are
normalized back to their underlying IPv4 `/32`, before hashing. Account policies
are also HMAC-keyed so the limiter table contains no directly reusable subject
identifiers.

The application consumes client/network buckets before authentication for room
mutations, then consumes account buckets after authentication. Invalid bearer
credentials, malformed bodies, unknown rooms, and failed domain mutations
therefore still spend the relevant abuse quota. `app_switch_room` uses the same
create or join policy selected by its request discriminator. Join also consumes
a global target-room bucket so distributed clients cannot bypass concentration
limits by rotating source addresses.

Ordinary member room reads are excluded because each active browser polls every
four seconds. `app_classify_room_lookup` first resolves only room existence and
active membership using the same room-code ordering as the full snapshot. An
outsider or missing-room lookup consumes the stricter account and network
buckets before any full snapshot, expiration, resolution, or broadcast work.
This preserves the existing public-view policy while bounding six-digit
room-code enumeration and its database cost.

Classification and the later snapshot are separate transactions. Membership or
room lifecycle may change between them: a request classified as a member keeps
that one-request exemption, a request classified as an outsider still spends
its quota if it joins concurrently, and a room classified as missing remains a
`404` for that request even if a matching code is created immediately afterward.
The next request observes the new state. A room that disappears or expires after
classification is still returned as `404` by the authoritative snapshot path.

Expired bucket rows are removed in bounded batches during consume calls. A
limiter error fails closed with `503`; an exhausted bucket returns `429` and a
database-derived `Retry-After`. This database layer is not a WAF: ingress must
still enforce request-size, bot, volumetric, and direct-origin controls.

Only a trusted ingress-provided, single-value IP header may be configured.
Vercel uses its system `x-vercel-forwarded-for` value. Other production
environments must set `RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER`, strip any incoming
value with that name, overwrite it from the transport peer, and prevent direct
origin access. Missing or malformed trusted headers fail closed rather than
collapsing public traffic into a shared fallback bucket.

The `build` and `start` package scripts explicitly select release validation;
they do not rely on an ambient `NODE_ENV` value to decide whether the trusted
header is mandatory. Both load the standard Next.js production environment
files and run the shared server-environment validator before starting Next.js.
This keeps Vercel builds and self-hosted startup fail-fast while leaving
`pnpm run dev` on development semantics.

### Rooms and membership

`rooms` is the reusable invitation and membership boundary. It owns the host,
capacity, lobby expiry, permanent `closed_at`, nullable `current_game_id`,
monotonic `roster_revision`, and the public component of
`snapshot_revision`. Game completion does not close the Room.

Room status is derived from `closed_at` and the pointed Game: `closed` after
permanent closure, `playing` for an open Game, `ended` for a completed current
Game retained as a result lobby, and `waiting` when `current_game_id` is null.

`players` is the only source of truth for membership:

- `left_at is null` means the account currently belongs to that room.
- `disconnected_at is not null` means the active player is temporarily
  disconnected.
- `left_at is not null` is historical membership.
- `ready_roster_revision = rooms.roster_revision` means the active Player is
  lobby-ready for the exact current roster.
- `private_snapshot_revision` is a Room-lifetime monotonic private-view
  ordering component that never resets when the Game or Role changes.

A partial unique index on `players(account_id) where left_at is null` guarantees
that an account has at most one current room. There is no account-level current
room column and no synchronization trigger.

Room codes are unique while `closed_at is null`. A completed current Game keeps
the same reserved code for replay. Code reuse begins only after expiry or the
last active member permanently closes the Room, so active-result lookup no
longer needs duplicate-code preference logic.

The host foreign key is `(rooms.id, rooms.host_account_id)` to
`players(room_id, account_id)`. It is deferred so room creation can insert the
room and its host player in one transaction.

### Game state

`games` is the first-class root of one playthrough. Its UUID is safe to expose as
the browser Game session ID. It owns `room_id`, Room-local sequence, current
phase fields, Day/Night counters, `revision`, `action_revision`, winner Team,
and start/end timestamps. A partial unique index allows one open Game per Room.
`rooms.current_game_id` uses a deferred same-Room composite foreign key to
`games(room_id, id)`.

`game_rule_sets` stores the validated rule options, role counts, resolved role
setup, and engine compatibility versions used to start the game. The resolved
setup contains active role IDs, typed setup contributions, and resolved night
conversation groups. Winner judgements exist only as typed contributions; they
are not duplicated in another JSON field. Engine and registry versions live in
dedicated columns rather than inside the resolved setup JSON.

Game start and phase resolution RPCs accept a duration in seconds rather than an
application-computed deadline. PostgreSQL derives both `started_at` and
`ends_at` from the same transaction clock so transport latency and clock skew
cannot shorten a phase or reject a valid minimum duration.

`game_phase_instances` is the append-only identity and timing history for every
playing phase. A transition closes the current instance and inserts the next
one. Phase-owned actions, events, speech slots, and resolved actions use a
composite foreign key to the owning Game and phase instance. A partial unique
index permits at most one open instance per Game, while the composite `games`
foreign key requires the current phase, counters, start time, and deadline to
match that instance exactly.

An action-window transition may keep the same user-visible phase while still
closing one phase instance and opening another. This gives every
compare-and-swap boundary its own identity and deadline without erasing the
preceding window's history.

`games` points to the current phase instance and owns current counters and two
revisions:

- `revision` changes when the phase or authoritative game state changes.
- `action_revision` changes when a submission changes within the current phase.

The Game roster is fixed atomically at start. `players` remains Room membership
history, while `game_players` owns the fixed Player, Role, mutable alive state,
and nullable final result for one Game. Same-Room composite foreign keys prove
that a Game Player belongs to the Game's Room. Gameplay actors, targets,
speakers, event recipients, message senders, and result owners reference this
fixed roster, so a membership row outside it cannot enter Game state.

`current_actions` contains the currently open action definitions.
Eligible targets are normalized in `current_action_eligible_players` rather than
stored in an array. `pending_actions` has one row per current action; the first
eligible submission is accepted and later duplicates are idempotent no-ops.

`actor_state_requirement` and `target_state_requirement` are policies for the
currently open action, not facts about a resolved action. `alive` requires the
actor or target to remain alive when the action is materialized and submitted;
`assigned` requires only membership in the fixed game roster. The Engine filters
eligible targets after same-window effects, and SQL rechecks an `alive` target at
submission time. This policy is not copied into normalized history after the
window closes.

Every current action preserves its resolver independently from its submission
audience. `resolver_role_id` identifies the `Role` hook that owns a role-defined
action and is null only for a documented core action. `actor_player_id` and
`actor_role_id` constrain who may submit; neither field is used to infer the
resolver. This separation also supports a role that grants an action to another
player or role.

`action_kind` remains opaque text from insertion through snapshot reads and
resolved action history. SQL validates its identifier shape but does not
maintain a role action allowlist, translate it, or attach behavior to it. The
application dispatches a submitted role action with
`(resolver_role_id, action_kind)` and resolves its fallback presentation from
`RoleRegistry`. Adding another role with equivalent effects therefore does not
require a database constraint, function branch, or view-adapter exception.
An accepted first submission also records one submitter-private
`action_submitted` receipt carrying both the opaque `actionKey` and `kind`. The
view validates both identifiers before exposing the receipt and never infers the
kind from a shared allowlist.

`resolved_actions` is the normalized semantic history consumed by the phase
Engine. When an action window resolves, every core and role-defined current
action produces exactly one row with `resolution_status = 'submitted'` or
`'missing'`, together with its opaque key and kind, nullable resolver Role,
actor, target, and phase instance. A null resolver identifies a documented core
action. The engine-history snapshot joins the owning phase instance to add
`day_number` and `night_number`. Its exact validator enforces phase/counter
consistency and strict `(resolved_at, id)` chronological order before the Engine
uses the history. The Role context then filters that complete input to role-owned
rows before invoking Role hooks. Ordinary runtime reads do not load the history.
It is not mixed with bounded presentation events and is never silently truncated
when the Engine explicitly requests it.

`game_events` is the append-only presentation and audit history. Private
audience relationships live in `game_event_visible_players` and
`game_event_visible_roles`. Role-generated events cross the view boundary only
through the generic safe presentation contract; arbitrary payload keys are not
interpreted as role behavior.
`day_speech_slots` stores the complete ordered-speech plan for the current phase
instance. The engine creates the plan once when the Day opens and carries the
same full plan into every later action-window instance of that Day. It never
regenerates or shortens the persisted plan; when a future speaker has died, the
engine skips that slot only when selecting the next current speaker.
`night_conversation_messages` stores role-group messages.

`games.winner_team` and `game_players.result` are fixed only on completion.
Phase resolution validates that a final outcome contains exactly one result for
every Game Player. Role-owned end candidates and their opaque reasons are transient
winner-evaluation inputs, not a shared SQL enum or duplicated final-outcome
column. Team IDs are opaque `RoleRegistry` data rather than a database enum. A
winner judgement may select only a registered team, and the persisted outcome
owns only that selected team ID and per-player results. Winner-judgement
identity is the pair `(sourceRoleId, id)`, so different Roles may reuse the same
local judgement ID without colliding.

### Realtime

`realtime_topics` is the only topic registry. Each Room has one room topic, each
Player has one private topic, and each active Game Role has one Game-scoped
role-private topic. Topics are opaque random identifiers. Private ordering is
owned by the monotonic Player counter rather than a Game-local topic counter.

`realtime_grants` stores short-lived authorization leases and the Game that was
current when the lease was issued. Room/player topics remain usable under active
membership. Role-topic eligibility additionally requires the grant Game, topic
Game, Room current Game, and `game_players` Role to match whenever Realtime
checks a JWT grant.

## Same-room integrity

Room-lifecycle records use `(room_id, player_id)` composite foreign keys. Game
records use `(game_id, player_id)` against the fixed `game_players` roster, and
`game_players` itself uses same-Room composite foreign keys to both `games` and
`players`. Phase/action parents expose matching Game-scoped composite keys.

This prevents a valid player ID from another room from being used as an actor,
target, speaker, event audience, result owner, message sender, or realtime
principal. Application checks may improve error messages, but they are not the
integrity boundary.

## Transaction API

Only the application server's service-role client may execute application RPCs.
The `anon` and `authenticated` database roles have no execute grant on them.

| RPC                                   | Responsibility                                                      |
| ------------------------------------- | ------------------------------------------------------------------- |
| `app_create_identity`                 | Atomically create an account and hashed token                       |
| `app_authenticate_account`            | Resolve a valid token hash and record bounded usage metadata        |
| `app_create_room`                     | Settle an expired source membership, then create a Room             |
| `app_join_room`                       | Join/reconnect and detach a completed Game for a non-roster join    |
| `app_leave_room`                      | Leave, invalidate readiness, transfer host, and close an empty Room |
| `app_switch_room`                     | Atomically leave one lobby Room and create or join another          |
| `app_get_current_room`                | Resolve membership and expire an overdue Room lobby                 |
| `app_expire_room_if_needed`           | Idempotently expire one overdue Room lobby                          |
| `app_cleanup_expired_rooms`           | Claim and expire a bounded batch with `skip locked`                 |
| `app_heartbeat_room_player`           | Refresh the caller and mark stale peers disconnected                |
| `app_set_room_player_ready`           | Set readiness for one accepted roster revision                      |
| `app_start_game`                      | Create and point to a complete validated Game atomically            |
| `app_submit_action`                   | Validate Game identity and upsert one eligible submission           |
| `app_send_night_conversation_message` | Validate Game, phase, role group, and body before insert            |
| `app_resolve_phase`                   | Compare-and-swap one transition by current Game ID                  |
| `app_read_room_runtime_snapshot`      | Return one coherent server-only runtime aggregate                   |
| `app_issue_realtime_grant`            | Replace a player's short-lived realtime lease                       |
| `app_cleanup_expired_realtime_grants` | Delete a bounded batch of obsolete grants                           |

Private helper functions are in the `private` schema and have no execute grant
for API roles.

`app_start_game` accepts only the exact core option keys and validates every
number, enum, role-option identifier/value shape, resolved-setup key, typed
contribution, active Role relationship, and conversation-group relationship
before inserting anything. `RoleRegistry` remains the semantic authority for
opaque Role IDs and options; the SQL checks are a structural transaction
boundary, not a duplicated role-specific allowlist.

## Locking and compare-and-swap

Account-scoped room commands lock in this order:

1. account;
2. room, or every involved room ordered by room ID;
3. player;
4. current Game and phase-owned rows when required.

Maintenance commands claim rooms in deterministic order with `for update skip
locked`. Helpers that mutate a room require their public caller to have locked
that room first.

Phase resolution is a system operation, not a host privilege. The application
computes a proposed transition from a coherent snapshot. `app_resolve_phase`
accepts it only when all of these still match:

- Game ID still referenced by `rooms.current_game_id` and phase instance;
- game `revision`;
- `action_revision`.

The public six-digit Room code is an API locator reserved until permanent Room
closure. Game mutations additionally carry the immutable UUID Game ID. A delayed
request for Game A cannot mutate Game B in the same Room because the transaction
requires that exact Game to remain the Room's current pointer.

On success, the transaction records submitted and missing core and Role actions, closes
the old phase instance, deletes its current action rows, applies deaths and
results, inserts the next phase instance and phase-owned rows, increments
`revision`, and resets `action_revision`. Concurrent resolvers therefore produce
at most one committed transition without transporting large expected-ID arrays.

Game completion sets the winner and every `game_players.result`, increments the
Room roster revision, refreshes the lobby expiry, and retains the ended Game as
`current_game_id`. It never sets `closed_at`.

## Snapshot reads

`app_read_room_runtime_snapshot` is the sole base-state read path for the
application server. Version 2 is an explicit projection: every top-level and
nested field is selected with `jsonb_build_object`, and no base-table row is
serialized wholesale. The TypeScript boundary requires the exact v2 key set and
field shapes, so adding a database column cannot silently expand the trusted
runtime contract.

The top level contains `room`, `viewerPlayerId`, `lobbyPlayers`, nullable
`currentGame`, and `realtimeTopics`. Every ruleset, Game Player, phase, action,
event, night message, outcome, and result below `currentGame` is filtered by the
exact Room pointer. A clean lobby has `currentGame = null` by construction.
`p_include_engine_history` defaults to false; in that mode the v2
`resolvedActions` field is an empty array and no history rows are loaded.
Only the phase resolver opts in, using the current Game ID, because Role hooks
and core phase continuations need normalized history. Browser-facing room reads
keep the default.

Despite accepting an Account-derived viewer identity for private selection and
revision calculation, this RPC is not a browser-facing or viewer-safe projection.
Its aggregate contains authoritative runtime and secret state. The function is
callable only with the server-held service-role credential, and the application
server must convert it into public, self-private, and role-private `RoomView`
contracts before responding to a browser. Never return the raw runtime snapshot
or expose the service-role credential to client code.

The function executes as one PostgreSQL statement, so all fields share one MVCC
snapshot. This replaces retry loops around many independent PostgREST reads.
The returned `room.snapshot_revision` is a viewer-scoped monotonic sum of the
Room public revision and the viewer Player's Room-lifetime private revision.
Public commands increment the Room component. Private-only submissions and
night conversation increment only the affected Players' private components. A
Game or Role replacement cannot make the value decrease, and another audience's
private update timing remains hidden. Revisions are command-owned and are not
maintained by triggers.

Public and private event arrays are limited to the newest 250 rows, then returned
in chronological order. Night conversation returns at most 100 messages for the
current night and only groups allowed for the viewer's assigned role. When the
engine-history option is enabled, `resolvedActions` is complete because game
rules must not change when presentation-history limits are reached. Each entry
includes its phase instance and Day / Night counters, and the array is validated
in ascending `resolved_at`, then ID, order.

## Realtime authorization

The application server calls `app_issue_realtime_grant` for an active player and
signs a short-lived JWT containing `realtime_grant_id`. Realtime may deliver a
broadcast only when `can_receive_realtime_topic` confirms:

- the grant exists, is unexpired, and is not revoked;
- the player still has active membership;
- the topic belongs to the grant room; and
- the topic is the Room topic, that Player's private topic, or a role topic whose
  grant Game, topic Game, Room current Game, and Game Player Role all match.

Leaving, closing an unstarted Room, or issuing a replacement grant revokes the
old lease for new and reauthorized subscriptions. Supabase Realtime may cache an
existing private-channel authorization until its JWT is refreshed or expires,
so the 120-second grant lifetime bounds revocation rather than promising an
instant disconnect. Realtime payloads contain only invalidation metadata and no
private game state. Clients reload the authorized HTTP room snapshot after a
notification.

An old grant may still receive the Room invalidation that announces a Game
boundary, but it cannot authorize a detached or replacement Game's role-private
topic. The browser reloads and obtains a replacement grant for the new Game.

Grant issuance also settles an expired Room lobby in the same transaction and
returns a typed lifecycle result instead of creating a lease for stale
membership.

The database suite evaluates the actual `realtime.messages` RLS policy under the
`authenticated` role with JWT claims for valid, expired, revoked, cross-room,
player-private, and role-private grants. Helper-function tests alone are not a
substitute for exercising the policy with the same role and claim context used
by Realtime.

## Security model

- All application tables have RLS enabled and forced.
- `public`, `anon`, `authenticated`, and `service_role` have no direct table or
  sequence privileges.
- Future tables, sequences, and functions inherit fail-closed default
  privileges.
- Public RPC execute privileges are explicitly revoked before the minimum role
  grant is added.
- `SECURITY DEFINER` functions use an empty fixed `search_path` and fully
  qualified object names.
- Browser code receives public player IDs, never account IDs or internal player
  IDs.
- Raw core-event payload projection is allowlisted by generic event shape.
  Role-generated messages use a generic safe presentation contract rather than
  a role-identifier allowlist. Unknown or malformed payload shapes are dropped
  rather than exposing raw keys, but a valid opaque role or action identifier is
  never rejected merely because common code does not enumerate it.

## Local validation

Run the local validation lifecycle explicitly:

```sh
pnpm run db:start
pnpm run db:reset
pnpm run lint:db
pnpm run db:test
pnpm run db:diff
pnpm run db:stop
```

`db:diff` must contain no schema DDL after a clean reset. Run the repository's
normal lint, unit, build, and E2E checks as well.

The pgTAP suite also verifies exact start-payload validation, one-open-phase and
composite phase integrity, complete submitted/missing core and role-action
history, RPC privileges, fixed `search_path` values, and authenticated Realtime
RLS behavior.

The Playwright server is local-only: it resets the local database, builds the
application, and runs `pnpm start` on `127.0.0.1:3010`. The application uses
the documented `.env.local` values. Playwright tests exercise the application
through its HTTP and browser boundaries.

## Change checklist

When changing persistence:

1. Update the responsible migration instead of adding an unrelated patch to a
   different responsibility layer.
2. Encode room ownership and lifecycle invariants with constraints or one
   transaction, not synchronized duplicate columns.
3. Keep the lock order deterministic.
4. Add or update pgTAP coverage for the invariant, privilege, and failure path.
5. Update the snapshot only when the server needs the new field.
6. Confirm browser-facing projections still exclude internal identifiers.
7. Reset, lint, run pgTAP, and verify an empty schema diff.
