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

### Rooms and membership

`rooms` owns room lifecycle timestamps, the host account, capacity, and the
public component of `snapshot_revision`. Its `status` is generated from
`started_at` and `ended_at`.

`players` is the only source of truth for membership:

- `left_at is null` means the account currently belongs to that room.
- `disconnected_at is not null` means the active player is temporarily
  disconnected.
- `left_at is not null` is historical membership.

A partial unique index on `players(account_id) where left_at is null` guarantees
that an account has at most one current room. There is no account-level current
room column and no synchronization trigger.

Room codes are unique while a room is waiting or playing and may be reused after
the older room ends. Account-bound lookups prefer the caller's active membership
over a newer room with the same code. An atomic create switch excludes the source
code, and an atomic join switch rejects the same visible code, so the browser
always observes a different room session key.

The host foreign key is `(rooms.id, rooms.host_account_id)` to
`players(room_id, account_id)`. It is deferred so room creation can insert the
room and its host player in one transaction.

### Game state

`game_rule_sets` stores the validated rule options, role counts, resolved role
setup, and engine compatibility versions used to start the game. The resolved
setup contains active role IDs, typed setup contributions, and resolved night
conversation groups. Winner judgements exist only as typed contributions; they
are not duplicated in another JSON field. Engine and registry versions live in
dedicated columns rather than inside the resolved setup JSON.

`game_phase_instances` is the append-only identity and timing history for every
playing phase. A transition closes the current instance and inserts the next
one. Phase-owned actions, events, speech slots, and resolved actions use a
composite foreign key to the owning room and phase instance. A partial unique
index permits at most one open instance per room, while the composite
`game_states` foreign key requires the current phase, counters, start time, and
deadline to match that instance exactly.

An action-window transition may keep the same user-visible phase while still
closing one phase instance and opening another. This gives every
compare-and-swap boundary its own identity and deadline without erasing the
preceding window's history.

`game_states` points to the current phase instance and owns current counters and
two revisions:

- `revision` changes when the phase or authoritative game state changes.
- `action_revision` changes when a submission changes within the current phase.

The game roster is fixed atomically at game start. `players` remains room
membership history, while paired `role_assignments` and `game_player_states`
rows define exactly which players belong to the started game. Once a game
exists, the runtime snapshot selects players through that fixed roster instead
of treating every room-membership row as a game player. Gameplay actors,
targets, speakers, event recipients, message senders, and result owners
reference `game_player_states(room_id, player_id)`, so a membership row outside
the fixed roster cannot enter game state.

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

`final_outcomes` and `player_results` exist only for a completed game. Phase
resolution validates that a final outcome contains exactly one result for every
game player. Role-owned end candidates and their opaque reasons are transient
winner-evaluation inputs, not a shared SQL enum or duplicated final-outcome
column. Team IDs are opaque `RoleRegistry` data rather than a database enum. A
winner judgement may select only a registered team, and the persisted outcome
owns only that selected team ID and per-player results. Winner-judgement
identity is the pair `(sourceRoleId, id)`, so different Roles may reuse the same
local judgement ID without colliding.

### Realtime

`realtime_topics` is the only topic registry. Each room has one room topic, each
player has one private topic, and each assigned role has one role-private topic.
Topics are opaque random identifiers. Player-private and role-private topics
also own monotonic revision components for state visible only to that audience.

`realtime_grants` stores short-lived authorization leases. Topic eligibility is
not copied into a grant mapping table. It is derived from current membership,
assignment, and topic ownership whenever Realtime checks a JWT grant.

## Same-room integrity

Every table that references a player or action carries `room_id` and uses a
composite foreign key. Room-lifecycle records reference
`players(room_id, id)`, while gameplay records reference the fixed
`game_player_states(room_id, player_id)` roster or a phase/action row already
constrained to it. Parent tables expose matching composite unique keys.

This prevents a valid player ID from another room from being used as an actor,
target, speaker, event audience, result owner, message sender, or realtime
principal. Application checks may improve error messages, but they are not the
integrity boundary.

## Transaction API

Only the application server's service-role client may execute application RPCs.
The `anon` and `authenticated` database roles have no execute grant on them.

| RPC                                   | Responsibility                                                     |
| ------------------------------------- | ------------------------------------------------------------------ |
| `app_create_identity`                 | Atomically create an account and hashed token                      |
| `app_authenticate_account`            | Resolve a valid token hash and record bounded usage metadata       |
| `app_create_room`                     | Settle an expired source membership, then create a waiting room    |
| `app_join_room`                       | Settle expired source/target rooms, then join or reconnect         |
| `app_leave_room`                      | Expire the room or leave, transfer host, and end an empty room     |
| `app_switch_room`                     | Atomically leave one waiting/ended room and create or join another |
| `app_get_current_room`                | Resolve membership and expire an overdue waiting room              |
| `app_expire_waiting_room_if_needed`   | Idempotently expire one waiting room                               |
| `app_cleanup_expired_waiting_rooms`   | Claim and expire a bounded batch with `skip locked`                |
| `app_heartbeat_room_player`           | Refresh the caller and mark stale peers disconnected               |
| `app_start_room`                      | Persist the complete validated initial game atomically             |
| `app_submit_action`                   | Validate and upsert one eligible action submission                 |
| `app_send_night_conversation_message` | Validate phase, role group, and body before insert                 |
| `app_resolve_phase`                   | Compare-and-swap one transition by internal room ID                |
| `app_read_room_runtime_snapshot`      | Return one coherent server-only runtime aggregate                  |
| `app_issue_realtime_grant`            | Replace a player's short-lived realtime lease                      |
| `app_cleanup_expired_realtime_grants` | Delete a bounded batch of obsolete grants                          |

Private helper functions are in the `private` schema and have no execute grant
for API roles.

`app_start_room` accepts only the exact core option keys and validates every
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
4. game state and phase-owned rows when required.

Maintenance commands claim rooms in deterministic order with `for update skip
locked`. Helpers that mutate a room require their public caller to have locked
that room first.

Phase resolution is a system operation, not a host privilege. The application
computes a proposed transition from a coherent snapshot. `app_resolve_phase`
accepts it only when all of these still match:

- internal room ID and phase instance;
- game `revision`;
- `action_revision`.

The public six-digit room code is an API locator and may be reused after an old
room ends. The application resolves it before entering the engine loop, then
uses the immutable internal room ID for runtime snapshot reads and
`app_resolve_phase`. Phase resolution therefore cannot target a different room
merely because a public code was reused.

On success, the transaction records submitted and missing core and role actions, closes
the old phase instance, deletes its current action rows, applies deaths and
results, inserts the next phase instance and phase-owned rows, increments
`revision`, and resets `action_revision`. Concurrent resolvers therefore produce
at most one committed transition without transporting large expected-ID arrays.

## Snapshot reads

`app_read_room_runtime_snapshot` is the sole base-state read path for the
application server. Version 1 is an explicit projection: every top-level and
nested field is selected with `jsonb_build_object`, and no base-table row is
serialized wholesale. The TypeScript boundary requires the exact v1 key set and
field shapes, so adding a database column cannot silently expand the trusted
runtime contract.

The default projection contains the room, room players (the fixed game roster
after start), current game state, rules, all assignments and current action
state, bounded events, viewer-selected private events and night messages, final
results, and topics.
`p_include_engine_history` defaults to false; in that mode the v1
`resolvedActions` field is an empty array and no history rows are loaded.
Only the phase resolver opts in, using an internal room ID, because Role hooks
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
room's public revision, the viewer's player-private topic revision, and the
viewer's assigned role-private topic revision. Public commands increment the
room component. Private-only submissions increment the submitter component and,
for a shared role action, its role component. Night conversation increments only
the resolved group's role components. A viewer therefore gets response ordering
for every state they can see without learning the timing of another audience's
private changes. Revisions are command-owned and are not maintained by triggers.

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
- the topic is the room topic, that player's private topic, or the topic for the
  player's current assigned role.

Leaving, ending an unstarted room, or issuing a replacement grant revokes the
old lease for new and reauthorized subscriptions. Supabase Realtime may cache an
existing private-channel authorization until its JWT is refreshed or expires,
so the 120-second grant lifetime bounds revocation rather than promising an
instant disconnect. Realtime payloads contain only invalidation metadata and no
private game state. Clients reload the authorized HTTP room snapshot after a
notification.

Grant issuance also settles an expired waiting room in the same transaction and
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
pnpm run test:db
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
application, and starts `next start` on `127.0.0.1:3010`. The application uses
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
