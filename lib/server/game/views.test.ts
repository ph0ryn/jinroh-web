import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_OPTIONS } from "./ruleset";
import {
  GameEventKind,
  GameEventVisibility,
  GamePhase,
  GameStatus,
  WerewolfConsultationStatus,
} from "./types";
import {
  buildPublicGameView,
  buildSelfPrivateGameView,
  buildWerewolfPrivateGameView,
} from "./views";

import type {
  GameEvent,
  PlayerId,
  ReadonlyGameState,
  ResolvedRoleSetup,
  RoleId,
  WerewolfConsultationSlotState,
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

  it("limits werewolf consultation to actual WerewolfRole players, not madman team members", () => {
    const input = createViewInput();
    const madmanView = buildWerewolfPrivateGameView(input, "madman");
    const werewolfView = buildWerewolfPrivateGameView(input, "wolf");

    expect(madmanView).toBeNull();
    expect(werewolfView?.partnerPlayerIds).toEqual(["wolf"]);
    expect(werewolfView?.consultationSlots).toHaveLength(1);
    expect(JSON.stringify(werewolfView)).toContain("attackTargetId");
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
    werewolfConsultationTemplates: [],
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
      id: "werewolf-private-event",
      kind: GameEventKind.WerewolfConsultationSubmitted,
      payload: { attackTargetId: "villager" },
      phase: GamePhase.Night,
      phaseInstanceId: "night-2",
      targetPlayerIds: ["villager"],
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
  const werewolfConsultations: readonly WerewolfConsultationSlotState[] = [
    {
      nightNumber: 2,
      retractedAt: null,
      retractionUsed: false,
      senderPlayerId: "wolf",
      slotKey: "2:wolf:werewolf_attack_target",
      status: WerewolfConsultationStatus.Submitted,
      submissionCount: 1,
      submittedAt: "2026-01-01T00:00:00Z",
      templateId: "werewolf_attack_target",
      values: {
        attackTargetId: "villager",
      },
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
    werewolfConsultations,
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
