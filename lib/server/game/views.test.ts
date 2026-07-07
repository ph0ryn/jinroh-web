import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_OPTIONS } from "./ruleset";
import { GameEventKind, GameEventVisibility, GamePhase, GameStatus } from "./types";
import {
  buildNightConversationPrivateGameView,
  buildPublicGameView,
  buildRealtimeNotificationPayload,
  buildSelfPrivateGameView,
} from "./views";

import type {
  GameEvent,
  NightConversationMessageState,
  PlayerId,
  ReadonlyGameState,
  ResolvedRoleSetup,
  RoleId,
} from "./types";

describe("secret game views", () => {
  it("does not leak role assignments or private event payloads into the public view", () => {
    const input = createViewInput();
    const publicView = buildPublicGameView(input);
    const publicJson = JSON.stringify(publicView);

    expect(publicJson).not.toContain("roleByPlayerId");
    expect(publicJson).not.toContain("werewolf");
    expect(publicJson).not.toContain("attackTargetId");
    expect(publicJson).not.toContain("inspectionResult");
    expect(publicJson).not.toContain("internalAudit");
    expect(publicView.events).toHaveLength(1);
  });

  it("returns only self role and self-visible private events in the self view", () => {
    const input = createViewInput();
    const selfView = buildSelfPrivateGameView(input, "seer");
    const selfJson = JSON.stringify(selfView);

    expect(selfView.roleId).toBe("seer");
    expect(selfJson).toContain("inspectionResult");
    expect(selfJson).not.toContain("attackTargetId");
    expect(selfJson).not.toContain("internalAudit");
  });

  it("limits night conversation to configured role groups, not same-team roles", () => {
    const input = createViewInput();
    const madmanView = buildNightConversationPrivateGameView(input, "madman");
    const werewolfView = buildNightConversationPrivateGameView(input, "wolf");

    expect(madmanView).toBeNull();
    expect(werewolfView?.groupId).toBe("werewolf");
    expect(werewolfView?.participantPlayerIds).toEqual(["wolf"]);
    expect(werewolfView?.messages).toHaveLength(1);
    expect(JSON.stringify(werewolfView)).toContain("wait for the guard claim");
  });

  it("builds realtime invalidation payloads without secret state", () => {
    const payload = buildRealtimeNotificationPayload({
      reason: "phase_changed",
      roomCode: "428913",
      scope: "room",
      sentAt: "2026-07-07T00:00:00.000Z",
    });
    const payloadJson = JSON.stringify(payload);

    expect(payload).toEqual({
      reason: "phase_changed",
      roomCode: "428913",
      scope: "room",
      sentAt: "2026-07-07T00:00:00.000Z",
    });
    expect(payloadJson).not.toContain("account");
    expect(payloadJson).not.toContain("token");
    expect(payloadJson).not.toContain("roleAssignment");
    expect(payloadJson).not.toContain("targetPlayer");
    expect(payloadJson).not.toContain("inspectionResult");
  });
});

function createViewInput() {
  const roleByPlayerId = new Map<PlayerId, RoleId>([
    ["wolf", "werewolf"],
    ["madman", "madman"],
    ["seer", "seer"],
    ["villager", "villager"],
  ]);
  const resolvedRoleSetup: ResolvedRoleSetup = {
    activeRoleIds: ["werewolf", "madman", "seer", "villager"],
    contributions: [],
    nightConversationGroups: [
      {
        groupId: "werewolf",
        labelKey: "nightConversation.werewolf",
        roleIds: ["werewolf"],
      },
    ],
    winnerJudgements: [],
  };
  const events: readonly GameEvent[] = [
    {
      actorPlayerId: null,
      id: "public-event",
      kind: GameEventKind.PhaseChanged,
      payload: { message: "day_started" },
      phase: GamePhase.Day,
      phaseInstanceId: "day-1",
      targetPlayerIds: [],
      visibility: GameEventVisibility.Public,
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
    {
      actorPlayerId: "wolf",
      id: "night-conversation-private-event",
      kind: GameEventKind.ActionResolved,
      payload: { nightConversationChanged: true },
      phase: GamePhase.Night,
      phaseInstanceId: "night-2",
      targetPlayerIds: [],
      visibility: GameEventVisibility.Private,
      visibleToPlayerIds: [],
      visibleToRoleIds: ["werewolf"],
    },
    {
      actorPlayerId: "seer",
      id: "seer-private-event",
      kind: GameEventKind.ActionResolved,
      payload: { inspectionResult: "werewolf" },
      phase: GamePhase.Night,
      phaseInstanceId: "night-2",
      targetPlayerIds: ["wolf"],
      visibility: GameEventVisibility.Private,
      visibleToPlayerIds: ["seer"],
      visibleToRoleIds: [],
    },
    {
      actorPlayerId: null,
      id: "internal-event",
      kind: GameEventKind.ActionResolved,
      payload: { internalAudit: "hidden" },
      phase: GamePhase.Night,
      phaseInstanceId: "night-2",
      targetPlayerIds: [],
      visibility: GameEventVisibility.Internal,
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
  ];
  const nightConversationMessages: readonly NightConversationMessageState[] = [
    {
      body: "wait for the guard claim",
      conversationGroupId: "werewolf",
      createdAt: "2026-01-01T00:00:00Z",
      id: "message-1",
      nightNumber: 2,
      senderPlayerId: "wolf",
    },
  ];
  const state: ReadonlyGameState = {
    alivePlayerIds: ["wolf", "madman", "seer", "villager"],
    currentActions: [],
    events,
    finalOutcome: null,
    nightNumber: 2,
    pendingActions: [],
    phase: GamePhase.Night,
    phaseInstanceId: "night-2",
    resolvedRoleSetup,
    roleByPlayerId,
    ruleOptions: DEFAULT_RULE_OPTIONS,
    status: GameStatus.Playing,
    nightConversationMessages,
  };

  return {
    players: [
      { alive: true, displayName: "Wolf", playerId: "wolf" },
      { alive: true, displayName: "Madman", playerId: "madman" },
      { alive: true, displayName: "Seer", playerId: "seer" },
      { alive: true, displayName: "Villager", playerId: "villager" },
    ],
    state,
  };
}
