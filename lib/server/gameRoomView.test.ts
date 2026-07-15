import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, ROLE_REGISTRY_VERSION, startGame } from "./gameEngine";
import {
  buildRoomView,
  canSendNightConversation,
  getRuntimePlayersFromSnapshot,
  getSharedActionRoleRecipients,
  isActionAvailableToPlayer,
  isRoomSnapshot,
  parseSnapshotRuleSet,
  type CurrentActionRecord,
  type GameRecord,
  type PlayerRecord,
  type RoomSnapshot,
} from "./gameRoomView";

const GAME_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_GAME_ID = "550e8400-e29b-41d4-a716-446655440001";
const PHASE_INSTANCE_ID = "550e8400-e29b-41d4-a716-446655440010";

function makePlayer(
  id: number,
  accountId: number,
  publicPlayerId: string,
  displayName: string,
): PlayerRecord {
  return {
    account_id: accountId,
    disconnected_at: null,
    display_name: displayName,
    id,
    joined_at: "2099-01-01T00:00:00.000Z",
    last_seen_at: "2099-01-01T00:00:30.000Z",
    left_at: null,
    private_snapshot_revision: 0,
    public_player_id: publicPlayerId,
    ready_roster_revision: 1,
    room_id: 3,
    status: "joined",
  };
}

const players = [
  makePlayer(7, 1, "pl_playerAlpha00001", "Alpha"),
  makePlayer(8, 2, "pl_playerBeta000001", "Beta"),
  makePlayer(9, 3, "pl_playerGamma00001", "Gamma"),
];

function makeAction(overrides: Partial<CurrentActionRecord> = {}): CurrentActionRecord {
  return {
    action_key: "attack:2:werewolf",
    action_kind: "attack",
    actor_player_id: null,
    actor_role_id: "werewolf",
    actor_state_requirement: "alive",
    closes_at: "2099-01-01T00:02:00.000Z",
    created_at: "2099-01-01T00:01:00.000Z",
    eligible_target_player_ids: [8],
    id: 11,
    phase_instance_id: PHASE_INSTANCE_ID,
    resolver_role_id: "werewolf",
    target_kind: "single_player",
    target_state_requirement: "alive",
    ...overrides,
  };
}

function makeGame(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    action_revision: 0,
    day_number: 0,
    ended_at: null,
    id: GAME_ID,
    night_number: 1,
    phase: "night",
    phase_ends_at: "2099-01-01T00:02:00.000Z",
    phase_instance_id: PHASE_INSTANCE_ID,
    phase_started_at: "2099-01-01T00:01:00.000Z",
    revision: 1,
    started_at: "2099-01-01T00:01:00.000Z",
    status: "playing",
    winner_team: null,
    ...overrides,
  };
}

function makePlayingSnapshot(): RoomSnapshot {
  const start = startGame(
    players.map((candidate) => ({ id: String(candidate.id), name: candidate.display_name })),
    null,
  );

  if (!start.ok) {
    throw new Error(start.errors.join(" "));
  }

  const activeRoleIds = start.resolvedRoleSetup.activeRoleIds;

  return {
    currentGame: {
      currentActions: [],
      daySpeechSlots: [],
      game: makeGame(),
      gamePlayers: start.assignments.map((assignment) => ({
        alive: true,
        player_id: Number(assignment.playerId),
        result: null,
        role_id: assignment.roleId,
      })),
      nightConversationMessages: [],
      pendingActions: [],
      privateEvents: [],
      publicEvents: [],
      resolvedActions: [],
      ruleSet: {
        engine_version: ENGINE_VERSION,
        options: {
          dayMode: start.ruleSet.dayMode,
          dayReadyCheckSecondsPerPlayer: start.ruleSet.dayReadyCheckSecondsPerPlayer,
          daySpeechSeconds: start.ruleSet.daySpeechSeconds,
          executionLastWordsSeconds: start.ruleSet.executionLastWordsSeconds,
          firstDaySpeechRounds: start.ruleSet.firstDaySpeechRounds,
          firstNightSeconds: start.ruleSet.firstNightSeconds,
          nightSeconds: start.ruleSet.nightSeconds,
          normalDaySpeechRounds: start.ruleSet.normalDaySpeechRounds,
          roleOptions: start.ruleSet.roleOptions,
          voteResultVisibility: start.ruleSet.voteResultVisibility,
          votingSeconds: start.ruleSet.votingSeconds,
        },
        resolved_role_setup: { ...start.resolvedRoleSetup },
        role_counts: { ...start.ruleSet.roleCounts } as Record<string, number>,
        role_registry_version: ROLE_REGISTRY_VERSION,
      },
    },
    lobbyPlayers: players.map((candidate) => ({ ...candidate })),
    realtimeTopics: [
      {
        game_id: null,
        player_id: null,
        role_id: null,
        scope: "room",
        topic: `room:${"A".repeat(32)}`,
      },
      ...players.map((candidate, index) => ({
        game_id: null,
        player_id: candidate.id,
        role_id: null,
        scope: "player_private" as const,
        topic: `player:${String.fromCharCode(66 + index).repeat(32)}`,
      })),
      ...activeRoleIds.map((roleId, index) => ({
        game_id: GAME_ID,
        player_id: null,
        role_id: roleId,
        scope: "role_private" as const,
        topic: `role:${String.fromCharCode(70 + index).repeat(32)}`,
      })),
    ],
    room: {
      closed_at: null,
      created_at: "2099-01-01T00:00:00.000Z",
      current_game_id: GAME_ID,
      host_account_id: 1,
      id: 3,
      public_room_code: "123456",
      roster_revision: 1,
      snapshot_revision: 7,
      status: "playing",
      target_player_count: 3,
      updated_at: "2099-01-01T00:01:00.000Z",
      lobby_expires_at: "2099-01-01T01:00:00.000Z",
    },
    version: 2,
    viewerPlayerId: 7,
  };
}

function makeEndedSnapshot(): RoomSnapshot {
  const snapshot = makePlayingSnapshot();

  return {
    ...snapshot,
    currentGame: {
      ...snapshot.currentGame!,
      game: makeGame({
        action_revision: 0,
        ended_at: "2099-01-01T00:03:00.000Z",
        phase: null,
        phase_ends_at: null,
        phase_instance_id: null,
        phase_started_at: null,
        revision: 2,
        status: "ended",
        winner_team: "village",
      }),
      gamePlayers: snapshot.currentGame!.gamePlayers.map((gamePlayer) => ({
        ...gamePlayer,
        result: "win",
      })),
    },
    room: {
      ...snapshot.room,
      roster_revision: 2,
      snapshot_revision: 8,
      status: "ended",
      updated_at: "2099-01-01T00:03:00.000Z",
    },
  };
}

function makeWaitingSnapshot(): RoomSnapshot {
  const snapshot = makePlayingSnapshot();

  return {
    ...snapshot,
    currentGame: null,
    realtimeTopics: snapshot.realtimeTopics.filter((topic) => topic.scope !== "role_private"),
    room: {
      ...snapshot.room,
      current_game_id: null,
      status: "waiting",
    },
  };
}

describe("Room snapshot version 2", () => {
  it("accepts clean lobby, playing Game, and ended result lobby snapshots", () => {
    expect(isRoomSnapshot(makeWaitingSnapshot())).toBe(true);
    expect(isRoomSnapshot(makePlayingSnapshot())).toBe(true);
    expect(isRoomSnapshot(makeEndedSnapshot())).toBe(true);
  });

  it("rejects legacy, extra, and mismatched current-Game payloads", () => {
    const snapshot = makePlayingSnapshot();

    expect(isRoomSnapshot({ ...snapshot, version: 1 })).toBe(false);
    expect(isRoomSnapshot({ ...snapshot, staleGameState: snapshot.currentGame?.game })).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        room: { ...snapshot.room, current_game_id: OTHER_GAME_ID },
      }),
    ).toBe(false);
  });

  it("accepts an internal ended-Game snapshot while public projection suppresses it", () => {
    const snapshot = makeEndedSnapshot();
    const internalSnapshot = { ...snapshot, viewerPlayerId: null };

    expect(isRoomSnapshot(internalSnapshot)).toBe(true);
    expect(buildRoomView(internalSnapshot).game).toBeNull();
  });

  it("accepts the database-suppressed result lookup for a prospective member", () => {
    const snapshot = makeEndedSnapshot();
    const lookupSnapshot: RoomSnapshot = {
      ...snapshot,
      currentGame: null,
      realtimeTopics: snapshot.realtimeTopics.filter((topic) => topic.scope !== "role_private"),
      viewerPlayerId: null,
    };

    expect(isRoomSnapshot(lookupSnapshot)).toBe(true);
    expect(buildRoomView(lookupSnapshot)).toMatchObject({
      game: null,
      rolePrivate: null,
      self: null,
      status: "ended",
    });
  });

  it("rejects a missing current Game for an active member", () => {
    const snapshot = makePlayingSnapshot();

    expect(() =>
      buildRoomView({
        ...snapshot,
        currentGame: null,
        realtimeTopics: snapshot.realtimeTopics.filter((topic) => topic.scope !== "role_private"),
      }),
    ).toThrow(/current Game pointer/iu);
  });

  it("rejects role topics from a different Game and future readiness epochs", () => {
    const snapshot = makePlayingSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        realtimeTopics: snapshot.realtimeTopics.map((topic) =>
          topic.scope === "role_private" ? { ...topic, game_id: OTHER_GAME_ID } : topic,
        ),
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...snapshot,
        lobbyPlayers: snapshot.lobbyPlayers.map((candidate, index) =>
          index === 0 ? { ...candidate, ready_roster_revision: 2 } : candidate,
        ),
      }),
    ).toBe(false);
  });

  it("rejects incomplete Game rosters and Game artifacts in a clean lobby", () => {
    const snapshot = makePlayingSnapshot();

    expect(
      isRoomSnapshot({
        ...snapshot,
        currentGame: {
          ...snapshot.currentGame!,
          gamePlayers: snapshot.currentGame!.gamePlayers.slice(1),
        },
      }),
    ).toBe(false);
    expect(
      isRoomSnapshot({
        ...makeWaitingSnapshot(),
        currentGame: snapshot.currentGame,
      }),
    ).toBe(false);
  });
});

describe("public Room projection", () => {
  it("projects Game ID and roster-scoped lobby readiness", () => {
    const snapshot = makePlayingSnapshot();
    snapshot.lobbyPlayers[1]!.ready_roster_revision = null;
    const summary = buildRoomView(snapshot);

    expect(summary.game?.gameId).toBe(GAME_ID);
    expect(summary.rosterRevision).toBe(1);
    expect(summary.snapshotRevision).toBe(7);
    expect(summary.players.map((candidate) => candidate.isLobbyReady)).toEqual([true, false, true]);
  });

  it("reveals roles only for an ended current Game", () => {
    const playing = buildRoomView(makePlayingSnapshot());
    const ended = buildRoomView(makeEndedSnapshot());

    expect(playing.players.every((candidate) => candidate.revealedRoleId === null)).toBe(true);
    expect(ended.players.every((candidate) => candidate.revealedRoleId !== null)).toBe(true);
    expect(ended.game?.winnerTeam).toBe("village");
  });

  it("constructs a clean pre-game view without prior Game residue", () => {
    const summary = buildRoomView(makeWaitingSnapshot());

    expect(summary.game).toBeNull();
    expect(summary.self).toMatchObject({
      actionReceipts: [],
      actions: [],
      events: [],
      result: null,
      roleId: null,
    });
    expect(summary.rolePrivate).toBeNull();
    expect(summary.players.every((candidate) => candidate.alive === null)).toBe(true);
    expect(summary.players.every((candidate) => candidate.revealedRoleId === null)).toBe(true);
  });

  it("defensively suppresses an ended Game from a non-member projection", () => {
    const snapshot = makeEndedSnapshot();
    const summary = buildRoomView({ ...snapshot, viewerPlayerId: null });

    expect(summary.game).toBeNull();
    expect(summary.self).toBeNull();
    expect(summary.rolePrivate).toBeNull();
    expect(summary.players.every((candidate) => candidate.revealedRoleId === null)).toBe(true);
  });
});

describe("current Game engine adapters", () => {
  it("reads runtime players and RuleSet only from the nested current Game", () => {
    const snapshot = makePlayingSnapshot();

    expect(getRuntimePlayersFromSnapshot(snapshot)).toHaveLength(3);
    expect(parseSnapshotRuleSet(snapshot).roleCounts).toEqual(
      snapshot.currentGame?.ruleSet.role_counts,
    );
    expect(() => parseSnapshotRuleSet(makeWaitingSnapshot())).toThrow(/current Game is missing/iu);
  });
});

describe("action and night-conversation visibility", () => {
  const assignedPlayer = players[0]!;

  it("requires matching assignment, presence, and actor state", () => {
    const action = makeAction({ actor_player_id: assignedPlayer.id, actor_role_id: null });

    expect(isActionAvailableToPlayer(action, assignedPlayer, null, true)).toBe(true);
    expect(
      isActionAvailableToPlayer(action, { ...assignedPlayer, status: "disconnected" }, null, true),
    ).toBe(false);
    expect(isActionAvailableToPlayer(action, assignedPlayer, null, false)).toBe(false);
  });

  it("derives role-private invalidation recipients from opaque role ownership", () => {
    expect(getSharedActionRoleRecipients(makeAction())).toEqual(["werewolf"]);
    expect(getSharedActionRoleRecipients(makeAction({ actor_player_id: 7 }))).toEqual([]);
  });

  it("allows sending only for a joined, alive Player during a playing night", () => {
    const state = makeGame();

    expect(canSendNightConversation(state, assignedPlayer, true)).toBe(true);
    expect(canSendNightConversation({ ...state, phase: "day" }, assignedPlayer, true)).toBe(false);
    expect(canSendNightConversation(state, assignedPlayer, false)).toBe(false);
  });
});
