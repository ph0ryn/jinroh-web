import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, makeDefaultRuleSetForPlayers, ROLE_REGISTRY_VERSION } from "./gameEngine";
import {
  canSendNightConversation,
  getSharedActionRoleRecipients,
  isActionAvailableToPlayer,
  isRoomSnapshot,
  parseSnapshotRuleSet,
  type CurrentActionRecord,
  type GameStateRecord,
  type PlayerRecord,
  type RoomSnapshot,
} from "./gameRoomView";

const player: PlayerRecord = {
  account_id: 1,
  disconnected_at: null,
  display_name: "Assigned actor",
  id: 7,
  joined_at: "2099-01-01T00:00:00.000Z",
  last_seen_at: "2099-01-01T00:00:00.000Z",
  left_at: null,
  public_player_id: "pl_assignedActor0001",
  room_id: 3,
  status: "joined",
};

function makeAction(overrides: Partial<CurrentActionRecord> = {}): CurrentActionRecord {
  return {
    action_key: "attack:2:werewolf",
    action_kind: "attack",
    actor_player_id: null,
    actor_role_id: "werewolf",
    actor_state_requirement: "alive",
    closes_at: null,
    created_at: "2099-01-01T00:00:00.000Z",
    eligible_target_player_ids: [8],
    id: 11,
    phase_instance_id: "550e8400-e29b-41d4-a716-446655440000",
    resolver_role_id: "werewolf",
    target_state_requirement: "alive",
    target_kind: "single_player",
    ...overrides,
  };
}

function makeState(overrides: Partial<GameStateRecord> = {}): GameStateRecord {
  return {
    action_revision: 0,
    day_number: 1,
    ended_at: null,
    night_number: 2,
    phase: "night",
    phase_ends_at: null,
    phase_instance_id: "550e8400-e29b-41d4-a716-446655440000",
    phase_started_at: "2099-01-01T00:00:00.000Z",
    revision: 1,
    status: "playing",
    ...overrides,
  };
}

function makeValidFullSnapshot(): RoomSnapshot {
  const phaseInstanceId = "550e8400-e29b-41d4-a716-446655440000";

  return {
    assignments: [
      { player_id: 7, role_id: "future_role" },
      { player_id: 8, role_id: "village_member" },
      { player_id: 9, role_id: "village_member" },
    ],
    currentActions: [
      {
        action_key: "future-action:day:7",
        action_kind: "future_action",
        actor_player_id: 7,
        actor_role_id: "future_role",
        actor_state_requirement: "alive",
        closes_at: "2099-01-01T00:03:00.000Z",
        created_at: "2099-01-01T00:02:00.000Z",
        eligible_target_player_ids: [8, 9],
        id: 11,
        phase_instance_id: phaseInstanceId,
        resolver_role_id: "future_role",
        target_state_requirement: "alive",
        target_kind: "single_player",
      },
    ],
    daySpeechSlots: [{ slot_index: 0, speaker_player_id: 7 }],
    finalOutcome: null,
    gameState: {
      action_revision: 1,
      day_number: 1,
      ended_at: null,
      night_number: 1,
      phase: "day",
      phase_ends_at: "2099-01-01T00:03:00.000Z",
      phase_instance_id: phaseInstanceId,
      phase_started_at: "2099-01-01T00:02:00.000Z",
      revision: 2,
      status: "playing",
    },
    nightConversationMessages: [
      {
        body: "A future role message",
        conversation_group_id: "future_chat",
        created_at: "2099-01-01T00:01:30.000Z",
        id: 31,
        night_number: 1,
        sender_player_id: 7,
      },
    ],
    pendingActions: [
      {
        current_action_id: 11,
        submitted_at: "2099-01-01T00:02:30.000Z",
        submitter_player_id: 7,
        target_player_id: 8,
      },
    ],
    playerResults: [],
    playerStates: [
      { alive: true, player_id: 7 },
      { alive: true, player_id: 8 },
      { alive: true, player_id: 9 },
    ],
    players: [
      {
        account_id: 1,
        disconnected_at: null,
        display_name: "Future actor",
        id: 7,
        joined_at: "2099-01-01T00:00:00.000Z",
        last_seen_at: "2099-01-01T00:01:00.000Z",
        left_at: null,
        public_player_id: "pl_playerAlpha00001",
        room_id: 3,
        status: "joined",
      },
      {
        account_id: 2,
        disconnected_at: null,
        display_name: "Second player",
        id: 8,
        joined_at: "2099-01-01T00:00:00.000Z",
        last_seen_at: "2099-01-01T00:01:00.000Z",
        left_at: null,
        public_player_id: "pl_playerBeta000001",
        room_id: 3,
        status: "joined",
      },
      {
        account_id: 3,
        disconnected_at: null,
        display_name: "Third player",
        id: 9,
        joined_at: "2099-01-01T00:00:00.000Z",
        last_seen_at: "2099-01-01T00:01:00.000Z",
        left_at: null,
        public_player_id: "pl_playerGamma00001",
        room_id: 3,
        status: "joined",
      },
    ],
    privateEvents: [
      {
        created_at: "2099-01-01T00:02:40.000Z",
        event_kind: "future_private_result",
        id: 102,
        payload: { result: { tags: ["future", null, true, 1] } },
        phase_instance_id: phaseInstanceId,
        visibility: "private",
      },
    ],
    publicEvents: [
      {
        created_at: "2099-01-01T00:02:00.000Z",
        event_kind: "future_role_event",
        id: 101,
        payload: { nested: { values: [1, true, null, "opaque"] } },
        phase_instance_id: phaseInstanceId,
        visibility: "public",
      },
    ],
    realtimeTopics: [
      {
        player_id: null,
        role_id: null,
        scope: "room",
        topic: `room:${"A".repeat(32)}`,
      },
      {
        player_id: 7,
        role_id: null,
        scope: "player_private",
        topic: `player:${"B".repeat(32)}`,
      },
      {
        player_id: 8,
        role_id: null,
        scope: "player_private",
        topic: `player:${"D".repeat(32)}`,
      },
      {
        player_id: 9,
        role_id: null,
        scope: "player_private",
        topic: `player:${"E".repeat(32)}`,
      },
      {
        player_id: null,
        role_id: "future_role",
        scope: "role_private",
        topic: `role:${"C".repeat(32)}`,
      },
      {
        player_id: null,
        role_id: "village_member",
        scope: "role_private",
        topic: `role:${"F".repeat(32)}`,
      },
    ],
    resolvedActions: [
      {
        action_key: "future-history:night:7",
        action_kind: "future_action",
        actor_player_id: 7,
        actor_role_id: "future_role",
        day_number: 0,
        id: 21,
        night_number: 1,
        phase: "night",
        phase_instance_id: "550e8400-e29b-41d4-a716-446655440001",
        resolution_status: "submitted",
        resolved_at: "2099-01-01T00:01:00.000Z",
        resolver_role_id: "future_role",
        target_player_id: 8,
      },
    ],
    room: {
      created_at: "2099-01-01T00:00:00.000Z",
      ended_at: null,
      host_account_id: 1,
      id: 3,
      public_room_code: "123456",
      snapshot_revision: 4,
      started_at: "2099-01-01T00:01:00.000Z",
      status: "playing",
      target_player_count: 3,
      updated_at: "2099-01-01T00:02:00.000Z",
      waiting_expires_at: "2099-01-01T01:00:00.000Z",
    },
    ruleSet: {
      engine_version: "engine.v1",
      options: {
        dayMode: "ordered_speech",
        dayReadyCheckSecondsPerPlayer: 30,
        daySpeechSeconds: 60,
        executionLastWordsSeconds: 30,
        firstDaySpeechRounds: 1,
        firstNightSeconds: 60,
        nightSeconds: 60,
        normalDaySpeechRounds: 1,
        roleOptions: { future_role: { effect_mode: "retaliate" } },
        voteResultVisibility: "count_only",
        votingSeconds: 60,
      },
      resolved_role_setup: {
        activeRoleIds: ["future_role", "village_member"],
        contributions: [
          {
            judgement: {
              id: "future-role:win",
              priority: 100,
              sourceRoleId: "future_role",
              winnerTeam: "future_team",
            },
            kind: "winner_judgement",
          },
        ],
        nightConversationGroups: [
          {
            groupId: "future_chat",
            label: { en: "Future chat", ja: "未来会話" },
            roleIds: ["future_role"],
          },
        ],
      },
      role_counts: { future_role: 1, village_member: 2 },
      role_registry_version: "roles.v1",
    },
    version: 1,
    viewerPlayerId: 7,
  };
}

function makeValidEndedSnapshot(): RoomSnapshot {
  const snapshot = makeValidFullSnapshot();

  return {
    ...snapshot,
    currentActions: [],
    daySpeechSlots: [],
    finalOutcome: { winner_team: "future_team" },
    gameState: {
      ...snapshot.gameState!,
      action_revision: 0,
      ended_at: "2099-01-01T00:04:00.000Z",
      phase: null,
      phase_ends_at: null,
      phase_instance_id: null,
      phase_started_at: null,
      status: "ended",
    },
    pendingActions: [],
    playerResults: [
      { player_id: 7, result: "win" },
      { player_id: 8, result: "lose" },
      { player_id: 9, result: "lose" },
    ],
    room: {
      ...snapshot.room,
      ended_at: "2099-01-01T00:04:00.000Z",
      status: "ended",
      updated_at: "2099-01-01T00:04:00.000Z",
    },
  };
}

function makeValidWaitingSnapshot(): RoomSnapshot {
  const snapshot = makeValidFullSnapshot();

  return {
    ...snapshot,
    assignments: [],
    currentActions: [],
    daySpeechSlots: [],
    gameState: null,
    nightConversationMessages: [],
    pendingActions: [],
    playerStates: [],
    privateEvents: [],
    publicEvents: [],
    resolvedActions: [],
    realtimeTopics: snapshot.realtimeTopics.filter((topic) => topic.scope !== "role_private"),
    room: {
      ...snapshot.room,
      started_at: null,
      status: "waiting",
    },
    ruleSet: null,
  };
}

function makeCurrentRuleSetSnapshot(): RoomSnapshot {
  const snapshot = makeValidFullSnapshot();
  const ruleSet = makeDefaultRuleSetForPlayers(snapshot.room.target_player_count);

  return {
    ...snapshot,
    ruleSet: {
      engine_version: ENGINE_VERSION,
      options: {
        dayMode: ruleSet.dayMode,
        dayReadyCheckSecondsPerPlayer: ruleSet.dayReadyCheckSecondsPerPlayer,
        daySpeechSeconds: ruleSet.daySpeechSeconds,
        executionLastWordsSeconds: ruleSet.executionLastWordsSeconds,
        firstDaySpeechRounds: ruleSet.firstDaySpeechRounds,
        firstNightSeconds: ruleSet.firstNightSeconds,
        nightSeconds: ruleSet.nightSeconds,
        normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
        roleOptions: ruleSet.roleOptions,
        voteResultVisibility: ruleSet.voteResultVisibility,
        votingSeconds: ruleSet.votingSeconds,
      },
      resolved_role_setup: snapshot.ruleSet!.resolved_role_setup,
      role_counts: ruleSet.roleCounts as Record<string, number>,
      role_registry_version: ROLE_REGISTRY_VERSION,
    },
  };
}

function omitOwnKey(value: object, key: string): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>;

  Reflect.deleteProperty(copy, key);

  return copy;
}

describe("current action availability", () => {
  it("shows an alive role action to a joined player with the matching role", () => {
    expect(isActionAvailableToPlayer(makeAction(), player, "werewolf", true)).toBe(true);
  });

  it("hides an alive-only role action from a dead role member", () => {
    expect(isActionAvailableToPlayer(makeAction(), player, "werewolf", false)).toBe(false);
  });

  it("shows a dead player only an assigned action owned by that player and role", () => {
    const action = makeAction({
      action_key: "post-death-action:7",
      action_kind: "counterstrike",
      actor_player_id: 7,
      actor_role_id: "post_death_role",
      actor_state_requirement: "assigned",
      resolver_role_id: "post_death_role",
    });

    expect(isActionAvailableToPlayer(action, player, "post_death_role", false)).toBe(true);
    expect(isActionAvailableToPlayer(action, { ...player, id: 8 }, "post_death_role", false)).toBe(
      false,
    );
    expect(isActionAvailableToPlayer(action, player, "werewolf", false)).toBe(false);
  });

  it("hides actions while the current player is disconnected", () => {
    expect(
      isActionAvailableToPlayer(
        makeAction(),
        { ...player, status: "disconnected" },
        "werewolf",
        true,
      ),
    ).toBe(false);
  });
});

describe("private action notification audience", () => {
  it("includes the role topic only for a shared role action", () => {
    expect(getSharedActionRoleRecipients(makeAction())).toEqual(["werewolf"]);
  });

  it("keeps player-owned and player-plus-role actions on the player topic", () => {
    expect(getSharedActionRoleRecipients(makeAction({ actor_player_id: 7 }))).toEqual([]);
    expect(
      getSharedActionRoleRecipients(makeAction({ actor_player_id: 7, actor_role_id: null })),
    ).toEqual([]);
  });
});

describe("night conversation write access", () => {
  it("allows a participating alive player to send during night", () => {
    expect(canSendNightConversation(makeState(), player, true)).toBe(true);
  });

  it("keeps the conversation read-only for a dead participant", () => {
    expect(canSendNightConversation(makeState(), player, false)).toBe(false);
  });

  it("keeps the conversation read-only for a disconnected participant", () => {
    expect(canSendNightConversation(makeState(), { ...player, status: "disconnected" }, true)).toBe(
      false,
    );
  });

  it("keeps the conversation read-only outside night", () => {
    expect(canSendNightConversation(makeState({ phase: "day" }), player, true)).toBe(false);
  });
});

describe("persisted rule set compatibility", () => {
  it("parses a complete rule set for the current engine and role registry", () => {
    const snapshot = makeCurrentRuleSetSnapshot();

    expect(parseSnapshotRuleSet(snapshot)).toEqual(
      makeDefaultRuleSetForPlayers(snapshot.room.target_player_count),
    );
  });

  it.each([
    { field: "engine_version" as const, value: `${ENGINE_VERSION}-mismatch` },
    { field: "role_registry_version" as const, value: `${ROLE_REGISTRY_VERSION}-mismatch` },
  ])("rejects a mismatched $field", ({ field, value }) => {
    const snapshot = makeCurrentRuleSetSnapshot();

    expect(() =>
      parseSnapshotRuleSet({
        ...snapshot,
        ruleSet: { ...snapshot.ruleSet!, [field]: value },
      }),
    ).toThrow();
  });

  it("rejects a role count for an unknown role", () => {
    const snapshot = makeCurrentRuleSetSnapshot();

    expect(() =>
      parseSnapshotRuleSet({
        ...snapshot,
        ruleSet: {
          ...snapshot.ruleSet!,
          role_counts: { ...snapshot.ruleSet!.role_counts, unknown_role: 1 },
        },
      }),
    ).toThrow();
  });

  it("rejects a missing required option instead of applying a default", () => {
    const snapshot = makeCurrentRuleSetSnapshot();

    expect(() =>
      parseSnapshotRuleSet({
        ...snapshot,
        ruleSet: {
          ...snapshot.ruleSet!,
          options: omitOwnKey(snapshot.ruleSet!.options, "nightSeconds"),
        },
      }),
    ).toThrow();
  });
});

describe("room snapshot validation", () => {
  it("accepts a complete snapshot whose role and action identifiers are not registered here", () => {
    expect(isRoomSnapshot(makeValidFullSnapshot())).toBe(true);
  });

  it("accepts the nullable ended-state shape and a generic final outcome", () => {
    expect(isRoomSnapshot(makeValidEndedSnapshot())).toBe(true);
  });

  it("accepts a pre-game snapshot with nullable game records", () => {
    expect(isRoomSnapshot(makeValidWaitingSnapshot())).toBe(true);
  });

  it("accepts a room that ended before starting without game artifacts", () => {
    const snapshot = makeValidWaitingSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        room: {
          ...snapshot.room,
          ended_at: snapshot.room.waiting_expires_at,
          status: "ended",
          updated_at: snapshot.room.waiting_expires_at,
        },
      }),
    ).toBe(true);
  });

  it("rejects missing and extra keys at both the root and nested record boundaries", () => {
    const snapshot = makeValidFullSnapshot();

    expect(isRoomSnapshot({ ...snapshot, unexpected: true })).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        room: omitOwnKey(snapshot.room, "created_at"),
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        players: [
          { ...snapshot.players[0], internal_note: "secret" },
          ...snapshot.players.slice(1),
        ],
      }),
    ).toBe(false);
  });

  it("rejects malformed nested JSON instead of accepting any payload record", () => {
    const snapshot = makeValidFullSnapshot();
    const event = snapshot.publicEvents[0]!;

    expect(
      isRoomSnapshot({
        ...snapshot,
        publicEvents: [
          {
            ...event,
            payload: { nested: [{ valid: true }, undefined] },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        publicEvents: [{ ...event, payload: { invalidNumber: Number.NaN } }],
      }),
    ).toBe(false);
  });

  it("rejects invalid identifiers and scalar ranges inside nested arrays", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...snapshot.currentActions[0]!, id: 0 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...snapshot.currentActions[0]!, action_kind: "FutureAction" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        players: [{ ...snapshot.players[0]!, public_player_id: "private-id" }],
      }),
    ).toBe(false);
  });

  it("rejects invalid statuses, lifecycle nullability, and timestamps", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        room: { ...snapshot.room, status: "paused" },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        players: [{ ...snapshot.players[0]!, status: "disconnected" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        room: { ...snapshot.room, updated_at: "not-a-date" },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        room: { ...snapshot.room, updated_at: "2099-02-30T00:02:00.000Z" },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        gameState: { ...snapshot.gameState!, phase_instance_id: "not-a-uuid" },
      }),
    ).toBe(false);
  });

  it("validates generic rule-set options and resolved setup records deeply", () => {
    const snapshot = makeValidFullSnapshot();
    const ruleSet = snapshot.ruleSet!;
    const futureJudgementContribution = {
      judgement: {
        id: "future-role:win",
        priority: 100,
        sourceRoleId: "future_role",
        winnerTeam: "future_team",
      },
      kind: "winner_judgement",
    } as const;

    expect(
      isRoomSnapshot({
        ...snapshot,
        ruleSet: {
          ...ruleSet,
          options: { ...ruleSet.options, unexpected: true },
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        ruleSet: {
          ...ruleSet,
          role_counts: { future_role: 1, village_member: 1 },
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        ruleSet: {
          ...ruleSet,
          resolved_role_setup: {
            ...ruleSet.resolved_role_setup,
            contributions: [
              {
                judgement: {
                  id: "future-role:win",
                  priority: 100,
                  sourceRoleId: "unlisted_role",
                  winnerTeam: "future_team",
                },
                kind: "winner_judgement",
              },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        ruleSet: {
          ...ruleSet,
          resolved_role_setup: {
            ...ruleSet.resolved_role_setup,
            contributions: [
              futureJudgementContribution,
              {
                judgement: {
                  id: "future-role:win",
                  priority: 100,
                  sourceRoleId: "village_member",
                  winnerTeam: "future_team",
                },
                kind: "winner_judgement",
              },
            ],
          },
        },
      }),
    ).toBe(true);
    expect(
      isRoomSnapshot({
        ...snapshot,
        ruleSet: {
          ...ruleSet,
          resolved_role_setup: {
            ...ruleSet.resolved_role_setup,
            contributions: [futureJudgementContribution, futureJudgementContribution],
          },
        },
      }),
    ).toBe(false);
  });

  it("validates realtime topic ownership and resolved-action status invariants", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: [
          {
            ...snapshot.realtimeTopics[0]!,
            player_id: 7,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [
          {
            ...snapshot.resolvedActions[0]!,
            actor_player_id: null,
            resolution_status: "submitted",
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects cross-room players, duplicate identities, and orphaned viewers", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        players: [{ ...snapshot.players[0]!, room_id: 99 }, ...snapshot.players.slice(1)],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        players: [
          snapshot.players[0],
          { ...snapshot.players[1]!, account_id: snapshot.players[0]!.account_id },
          snapshot.players[2],
        ],
      }),
    ).toBe(false);
    expect(isRoomSnapshot({ ...snapshot, viewerPlayerId: 99 })).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        room: { ...snapshot.room, host_account_id: 99 },
      }),
    ).toBe(false);
  });

  it("rejects incomplete assignments, player states, and role-count relations", () => {
    const snapshot = makeValidFullSnapshot();

    expect(isRoomSnapshot({ ...snapshot, assignments: snapshot.assignments.slice(1) })).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        assignments: [snapshot.assignments[0], snapshot.assignments[0], snapshot.assignments[2]],
      }),
    ).toBe(false);
    expect(isRoomSnapshot({ ...snapshot, playerStates: snapshot.playerStates.slice(1) })).toBe(
      false,
    );
    expect(
      isRoomSnapshot({
        ...snapshot,
        assignments: snapshot.assignments.map((assignment) =>
          assignment.player_id === 9 ? { ...assignment, role_id: "future_role" } : assignment,
        ),
      }),
    ).toBe(false);
  });

  it("rejects game artifacts and role topics before the game starts", () => {
    const snapshot = makeValidWaitingSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        publicEvents: makeValidFullSnapshot().publicEvents,
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: [
          ...snapshot.realtimeTopics,
          {
            player_id: null,
            role_id: "future_role",
            scope: "role_private",
            topic: `role:${"Z".repeat(32)}`,
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects room and game lifecycle disagreements and incomplete final results", () => {
    const snapshot = makeValidFullSnapshot();
    const endedSnapshot = makeValidEndedSnapshot();

    expect(isRoomSnapshot({ ...snapshot, gameState: endedSnapshot.gameState })).toBe(false);
    expect(isRoomSnapshot({ ...snapshot, ruleSet: null })).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        gameState: {
          ...snapshot.gameState!,
          phase_started_at: "2099-01-01T00:00:59.000Z",
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...endedSnapshot,
        gameState: {
          ...endedSnapshot.gameState!,
          ended_at: "2099-01-01T00:03:59.000Z",
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...endedSnapshot,
        playerResults: endedSnapshot.playerResults.slice(1),
      }),
    ).toBe(false);
  });

  it("rejects current actions with inconsistent phase, ownership, or targets", () => {
    const snapshot = makeValidFullSnapshot();
    const action = snapshot.currentActions[0]!;

    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, phase_instance_id: "550e8400-e29b-41d4-a716-446655440099" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, actor_player_id: 99 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, actor_role_id: "village_member" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, resolver_role_id: "inactive_role" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, eligible_target_player_ids: [99] }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        currentActions: [{ ...action, eligible_target_player_ids: [], target_kind: "none" }],
      }),
    ).toBe(false);
  });

  it("rejects pending actions that do not belong to a valid current action submission", () => {
    const snapshot = makeValidFullSnapshot();
    const pendingAction = snapshot.pendingActions[0]!;

    expect(
      isRoomSnapshot({
        ...snapshot,
        pendingActions: [{ ...pendingAction, current_action_id: 99 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        pendingActions: [{ ...pendingAction, submitter_player_id: 8 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        pendingActions: [{ ...pendingAction, target_player_id: 7 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        pendingActions: [{ ...pendingAction, submitted_at: "2099-01-01T00:01:59.000Z" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        gameState: { ...snapshot.gameState!, action_revision: 0 },
      }),
    ).toBe(false);
  });

  it("rejects invalid speech-slot, event, and private-view relations", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        daySpeechSlots: [
          { slot_index: 0, speaker_player_id: 7 },
          { slot_index: 2, speaker_player_id: 8 },
        ],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        playerStates: snapshot.playerStates.map((playerState) =>
          playerState.player_id === 8 ? { ...playerState, alive: false } : playerState,
        ),
        currentActions: [{ ...snapshot.currentActions[0]!, eligible_target_player_ids: [9] }],
        pendingActions: [{ ...snapshot.pendingActions[0]!, target_player_id: 9 }],
        daySpeechSlots: [{ slot_index: 0, speaker_player_id: 8 }],
      }),
    ).toBe(true);
    expect(
      isRoomSnapshot({
        ...snapshot,
        daySpeechSlots: [{ slot_index: 0, speaker_player_id: 10 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        privateEvents: [{ ...snapshot.privateEvents[0]!, id: snapshot.publicEvents[0]!.id }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        nightConversationMessages: [],
        privateEvents: snapshot.privateEvents,
        viewerPlayerId: null,
      }),
    ).toBe(false);
  });

  it("rejects night messages outside the viewer and sender conversation group", () => {
    const snapshot = makeValidFullSnapshot();
    const message = snapshot.nightConversationMessages[0]!;

    expect(
      isRoomSnapshot({
        ...snapshot,
        nightConversationMessages: [{ ...message, sender_player_id: 99 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        nightConversationMessages: [{ ...message, sender_player_id: 8 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        nightConversationMessages: [{ ...message, conversation_group_id: "other_chat" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        nightConversationMessages: [{ ...message, night_number: 2 }],
      }),
    ).toBe(false);
  });

  it("rejects missing, duplicate, and orphaned realtime topics", () => {
    const snapshot = makeValidFullSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: snapshot.realtimeTopics.filter((topic) => topic.scope !== "room"),
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: snapshot.realtimeTopics.filter(
          (topic) => topic.scope !== "player_private" || topic.player_id !== 8,
        ),
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: snapshot.realtimeTopics.map((topic) =>
          topic.scope === "player_private" && topic.player_id === 8
            ? { ...topic, player_id: 99 }
            : topic,
        ),
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: snapshot.realtimeTopics.map((topic) =>
          topic.scope === "role_private" && topic.role_id === "village_member"
            ? { ...topic, role_id: "inactive_role" }
            : topic,
        ),
      }),
    ).toBe(false);
  });

  it("rejects malformed, unordered, and conflicting resolved action history", () => {
    const snapshot = makeValidFullSnapshot();
    const resolvedAction = snapshot.resolvedActions[0]!;
    const currentAction = snapshot.currentActions[0]!;

    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [{ ...resolvedAction, actor_player_id: 99 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [{ ...resolvedAction, target_player_id: 99 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [{ ...resolvedAction, resolver_role_id: "inactive_role" }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [{ ...resolvedAction, day_number: 1, night_number: 1 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [
          {
            ...resolvedAction,
            action_key: currentAction.action_key,
            phase: "day",
            phase_instance_id: currentAction.phase_instance_id,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [resolvedAction, { ...resolvedAction, id: 22 }],
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        resolvedActions: [
          resolvedAction,
          {
            ...resolvedAction,
            action_key: "future-history:night:8",
            id: 22,
            resolved_at: "2099-01-01T00:00:59.000Z",
          },
        ],
      }),
    ).toBe(false);
  });
});
