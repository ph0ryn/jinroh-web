import { randomInt } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<
    Record<string, unknown> & { randomInt: typeof randomInt }
  >();

  return {
    ...original,
    randomInt: vi.fn(original.randomInt),
  };
});

import { roleRegistry } from "./game/roles";
import {
  ActionActorStateRequirement,
  ActionTargetStateRequirement,
  DEATH_REASON,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  type FirstNightStartedEffect,
} from "./game/types";
import {
  evaluateWinner,
  getAvailableNightActions,
  makeDefaultRuleSetForPlayers,
  makeResolvedRoleSetupForPlayers,
  resolvePhase as resolvePhaseWithSetup,
  startGame,
  type PhaseResolutionInput,
  type PlayerRuntimeState,
} from "./gameEngine";

type TestPhaseResolutionInput = Omit<PhaseResolutionInput, "resolvedRoleSetup">;

function resolvePhase(input: TestPhaseResolutionInput) {
  return resolvePhaseWithSetup({
    ...input,
    resolvedRoleSetup: makeResolvedRoleSetupForPlayers(input.ruleSet, input.players),
  });
}

const PLAYERS = [
  { id: "1", name: "Aki" },
  { id: "2", name: "Bora" },
  { id: "3", name: "Chika" },
  { id: "4", name: "Dai" },
  { id: "5", name: "Ema" },
  { id: "6", name: "Fumi" },
];

describe("game engine", () => {
  it("starts first night without public role leakage", () => {
    const result = startGame(PLAYERS, null);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.phase).toBe("night");
      expect(result.actions).toHaveLength(PLAYERS.length);
      const publicInitialEvents = result.initialEvents.filter(
        (event) => event.visibility === "public",
      );

      expect(publicInitialEvents.map((event) => event.kind)).toEqual([
        "game_started",
        "phase_changed",
      ]);
      expect(publicInitialEvents[1]?.payload).toEqual({ phase: "night" });
      expect(
        publicInitialEvents.some((event) => JSON.stringify(event.payload).includes("role")),
      ).toBe(false);
    }
  });

  it("sends first-night automatic human inspection privately from the seer role", () => {
    const result = startGame(PLAYERS.slice(0, 4), makeDefaultRuleSetForPlayers(4));

    expect(result.ok).toBe(true);

    if (result.ok) {
      const seerAssignment = result.assignments.find((assignment) => assignment.roleId === "seer");
      const inspectionEvent = result.initialEvents.find(
        (event) => event.kind === "initial_inspection",
      );
      const presentation = inspectionEvent?.payload["presentation"];
      const details =
        typeof presentation === "object" && presentation !== null && "details" in presentation
          ? presentation.details
          : null;
      const targetPlayerId =
        Array.isArray(details) &&
        typeof details[0] === "object" &&
        details[0] !== null &&
        "value" in details[0] &&
        typeof details[0].value === "object" &&
        details[0].value !== null &&
        "playerId" in details[0].value
          ? details[0].value.playerId
          : null;
      const targetAssignment = result.assignments.find(
        (assignment) => assignment.playerId === targetPlayerId,
      );

      expect(result.actions.every((action) => action.kind !== "inspect")).toBe(true);
      expect(seerAssignment).toBeDefined();
      expect(inspectionEvent).toMatchObject({
        visibility: "private",
        visibleToPlayerIds: [seerAssignment?.playerId],
      });
      expect(presentation).toBeDefined();
      expect(targetPlayerId).not.toBe(seerAssignment?.playerId);
      expect(targetAssignment?.roleId).not.toBe("werewolf");
    }
  });

  it("rejects causal effects from the informational first-night-started hook", () => {
    const spy = vi.spyOn(roleRegistry.get("seer"), "onFirstNightStarted").mockReturnValue([
      {
        emitterRoleId: "seer",
        id: "invalid-first-night-death",
        kind: GameEffectKind.Death,
        layer: GameEffectLayer.Death,
        playerId: "1",
        priority: 100,
        reason: DEATH_REASON.RuleEffect,
        sourceActionId: null,
        tags: [EFFECT_TAG.Unpreventable],
      } as unknown as FirstNightStartedEffect,
    ]);

    expect(() => startGame(PLAYERS.slice(0, 4), makeDefaultRuleSetForPlayers(4))).toThrow(
      "Unsupported first-night-started effect",
    );
    spy.mockRestore();
  });

  it("uses secure Fisher-Yates draws and ignores the input player order", () => {
    const secureRandomIntMock = vi.mocked(randomInt);
    const originalImplementation = secureRandomIntMock.getMockImplementation();
    const draws = [1, 3, 0, 2, 1, 0, 1, 3, 0, 2, 1, 0];
    const maxExclusiveValues: number[] = [];

    secureRandomIntMock.mockImplementation((maxExclusive) => {
      const draw = draws.shift();

      if (draw === undefined || draw >= maxExclusive) {
        throw new Error("Invalid test entropy.");
      }

      maxExclusiveValues.push(maxExclusive);
      return draw;
    });

    try {
      const firstResult = startGame(PLAYERS, makeDefaultRuleSetForPlayers(PLAYERS.length));
      const reversedResult = startGame(
        [...PLAYERS].reverse(),
        makeDefaultRuleSetForPlayers(PLAYERS.length),
      );

      expect(firstResult.ok).toBe(true);
      expect(reversedResult.ok).toBe(true);

      if (firstResult.ok && reversedResult.ok) {
        expect(reversedResult.assignments).toEqual(firstResult.assignments);
        expect(firstResult.assignments.map((assignment) => assignment.playerId)).toEqual([
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
        ]);
      }

      expect(maxExclusiveValues).toEqual([6, 5, 4, 3, 2, 4, 6, 5, 4, 3, 2, 4]);
    } finally {
      if (originalImplementation === undefined) {
        secureRandomIntMock.mockReset();
      } else {
        secureRandomIntMock.mockImplementation(originalImplementation);
      }
    }
  });

  it("does not derive repeatable assignments from player ids", () => {
    const secureRandomIntMock = vi.mocked(randomInt);
    const originalImplementation = secureRandomIntMock.getMockImplementation();

    try {
      secureRandomIntMock.mockImplementation(() => 0);
      const firstResult = startGame(PLAYERS, makeDefaultRuleSetForPlayers(PLAYERS.length));

      secureRandomIntMock.mockImplementation((maxExclusive) => maxExclusive - 1);
      const secondResult = startGame(PLAYERS, makeDefaultRuleSetForPlayers(PLAYERS.length));

      expect(firstResult.ok).toBe(true);
      expect(secondResult.ok).toBe(true);

      if (firstResult.ok && secondResult.ok) {
        expect(secondResult.assignments).not.toEqual(firstResult.assignments);
        expect(
          firstResult.assignments.reduce<Record<string, number>>((counts, assignment) => {
            counts[assignment.roleId] = (counts[assignment.roleId] ?? 0) + 1;
            return counts;
          }, {}),
        ).toEqual(
          Object.fromEntries(
            Object.entries(firstResult.ruleSet.roleCounts).filter(
              ([, count]) => count !== undefined && count > 0,
            ),
          ),
        );
      }
    } finally {
      if (originalImplementation === undefined) {
        secureRandomIntMock.mockReset();
      } else {
        secureRandomIntMock.mockImplementation(originalImplementation);
      }
    }
  });

  it("creates role-scoped werewolf attack but excludes madman from attack owners", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "madman" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const actions = getAvailableNightActions(players, 2);

    expect(actions.find((action) => action.kind === "attack")).toMatchObject({
      actorPlayerId: null,
      actorRoleId: "werewolf",
    });
    expect(
      actions.find((action) => action.kind === "attack")?.eligibleTargetPlayerIds,
    ).not.toContain("1");
  });

  it("delegates an unsubmitted role action to the resolver role at phase timeout", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "guard" },
      { alive: true, playerId: "2", roleId: "werewolf" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const resolvedRoleSetup = makeResolvedRoleSetupForPlayers(ruleSet, players);
    const guardAction = getAvailableNightActions(players, 2, ruleSet, resolvedRoleSetup).find(
      (action) => action.kind === "guard",
    );

    expect(guardAction).toBeDefined();

    if (guardAction === undefined) {
      return;
    }

    const missingActionSpy = vi
      .spyOn(roleRegistry.get("guard"), "onMissingAction")
      .mockReturnValue([]);

    try {
      resolvePhaseWithSetup({
        actions: [],
        currentActions: [
          {
            ...guardAction,
            closesAt: "2099-01-01T00:03:00.000Z",
            id: "41",
            openedAt: "2099-01-01T00:00:00.000Z",
          },
        ],
        currentPhase: "night",
        dayNumber: 1,
        nightNumber: 2,
        players,
        resolvedRoleSetup,
        ruleSet,
      });

      expect(missingActionSpy).toHaveBeenCalledOnce();
      expect(missingActionSpy.mock.calls[0]?.[0]).toMatchObject({
        actionKey: guardAction.key,
        id: "41",
        ownerPlayerId: "1",
      });
    } finally {
      missingActionSpy.mockRestore();
    }
  });

  it("removes the previous guard target when consecutive guard is denied", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      roleOptions: {
        ...makeDefaultRuleSetForPlayers(players.length).roleOptions,
        guard: { consecutive_target: "deny" },
      },
    };
    const guardAction = getAvailableNightActions(players, 3, ruleSet, undefined, [
      {
        actionKey: "guard:previous-night:2",
        actionKind: "guard",
        actorPlayerId: "2",
        actorRoleId: null,
        dayNumber: 1,
        eventId: "previous-guard-action",
        nightNumber: 2,
        phase: "night",
        phaseInstanceId: "previous-night",
        resolutionStatus: "submitted",
        resolverRoleId: "guard",
        targetPlayerIds: ["3"],
      },
    ]).find((action) => action.kind === "guard");

    expect(guardAction?.eligibleTargetPlayerIds).not.toContain("3");
    expect(guardAction?.eligibleTargetPlayerIds).toContain("4");
  });

  it("allows an older guard target when the immediately previous night was missed", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      roleOptions: {
        ...makeDefaultRuleSetForPlayers(players.length).roleOptions,
        guard: { consecutive_target: "deny" },
      },
    };
    const guardAction = getAvailableNightActions(players, 4, ruleSet, undefined, [
      {
        actionKey: "guard:submitted-night:2",
        actionKind: "guard",
        actorPlayerId: "2",
        actorRoleId: null,
        dayNumber: 1,
        eventId: "older-guard-action",
        nightNumber: 2,
        phase: "night",
        phaseInstanceId: "submitted-night",
        resolutionStatus: "submitted",
        resolverRoleId: "guard",
        targetPlayerIds: ["3"],
      },
      {
        actionKey: "guard:missing-night:3",
        actionKind: "guard",
        actorPlayerId: "2",
        actorRoleId: null,
        dayNumber: 2,
        eventId: "missing-guard-action",
        nightNumber: 3,
        phase: "night",
        phaseInstanceId: "missing-night",
        resolutionStatus: "missing",
        resolverRoleId: "guard",
        targetPlayerIds: [],
      },
    ]).find((action) => action.kind === "guard");

    expect(guardAction?.eligibleTargetPlayerIds).toContain("3");
  });

  it("keeps the previous guard target eligible when consecutive guard is allowed", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      roleOptions: {
        ...makeDefaultRuleSetForPlayers(players.length).roleOptions,
        guard: { consecutive_target: "allow" },
      },
    };
    const guardAction = getAvailableNightActions(players, 3, ruleSet, undefined, [
      {
        actionKey: "guard:previous-night:2",
        actionKind: "guard",
        actorPlayerId: "2",
        actorRoleId: null,
        dayNumber: 1,
        eventId: "previous-guard-action",
        nightNumber: 2,
        phase: "night",
        phaseInstanceId: "previous-night",
        resolutionStatus: "submitted",
        resolverRoleId: "guard",
        targetPlayerIds: ["3"],
      },
    ]).find((action) => action.kind === "guard");

    expect(guardAction?.eligibleTargetPlayerIds).toContain("3");
  });

  it("keeps normal night from resolving early unless caller asks after timeout", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "attack:night-2",
          actorPlayerId: "1",
          currentActionId: "attack-action",
          kind: "attack",
          resolverRoleId: "werewolf",
          submittedAt: "2099-01-01T00:00:00.000Z",
          targetPlayerId: "3",
        },
      ],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(3),
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.deaths).toEqual([{ playerId: "3", reason: "attack" }]);
    expect(resolution.events.at(-1)).toMatchObject({
      kind: "phase_changed",
      payload: { phase: "day" },
    });
    expect(resolution.events.at(-1)?.payload).toEqual({ phase: "day" });
  });

  it("keeps fox alive against a werewolf attack", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "fox" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "attack:night-2",
          actorPlayerId: "1",
          currentActionId: "attack-action",
          kind: "attack",
          resolverRoleId: "werewolf",
          submittedAt: "2099-01-01T00:00:00.000Z",
          targetPlayerId: "2",
        },
      ],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(3),
    });

    expect(resolution.deaths).toEqual([]);
    expect(resolution.events.map((event) => event.kind)).toContain("attack_guarded");
  });

  it("kills fox after inspection as a rule effect", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "fox" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "inspect:night-2:2",
          actorPlayerId: "2",
          currentActionId: "inspect-action",
          kind: "inspect",
          resolverRoleId: "seer",
          submittedAt: "2099-01-01T00:00:00.000Z",
          targetPlayerId: "3",
        },
      ],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "3", reason: "rule_effect" }]);
    expect(resolution.events.map((event) => event.kind)).toContain("inspection_result");
  });

  it("opens ordered speech with one current speaker action", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolution = resolvePhase({
      actions: players.map((player) => ({
        actorPlayerId: player.playerId,
        actionKey: `first-night-ready:${player.playerId}`,
        kind: "first_night_ready",
        resolverRoleId: null,
        targetPlayerId: null,
      })),
      currentPhase: "night",
      dayNumber: 0,
      nightNumber: 1,
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.nextDayNumber).toBe(1);
    expect(resolution.nextPhaseDurationSeconds).toBe(90);
    expect(resolution.actionsToOpen).toHaveLength(1);
    expect(resolution.speechSlotsToCreate).toHaveLength(6);
    expect(resolution.actionsToOpen[0]).toMatchObject({
      kind: "end_speech",
      targetKind: "none",
    });
  });

  it("advances ordered speech slots before voting", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "1",
          actionKey: "end-speech:1:0:1",
          kind: "end_speech",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.actionsToOpen).toHaveLength(1);
    expect(resolution.actionsToOpen[0]?.key).toContain("end-speech:1:1:");
    expect(resolution.events).toEqual([]);
  });

  it("advances ordered speech using persisted slot order", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "3",
          actionKey: "end-speech:1:0:3",
          kind: "end_speech",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      orderedSpeechSlots: [
        { slotIndex: 0, speakerPlayerId: "3" },
        { slotIndex: 1, speakerPlayerId: "1" },
        { slotIndex: 2, speakerPlayerId: "2" },
      ],
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.actionsToOpen).toHaveLength(1);
    expect(resolution.actionsToOpen[0]?.key).toBe("end-speech:1:1:1");
    expect(resolution.speechSlotsToCreate).toEqual([
      { slotIndex: 0, speakerPlayerId: "3" },
      { slotIndex: 1, speakerPlayerId: "1" },
      { slotIndex: 2, speakerPlayerId: "2" },
    ]);
  });

  it("advances ordered speech from its current action when the slot times out", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolution = resolvePhase({
      actions: [],
      currentActions: [
        {
          actorPlayerId: "3",
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          closesAt: "2099-01-01T00:01:00.000Z",
          eligibleTargetPlayerIds: [],
          id: "speech-window-1",
          key: "end-speech:1:0:3",
          kind: "end_speech",
          openedAt: "2099-01-01T00:00:00.000Z",
          resolverRoleId: null,
          targetKind: "none",
          targetStateRequirement: ActionTargetStateRequirement.Assigned,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      orderedSpeechSlots: [
        { slotIndex: 0, speakerPlayerId: "3" },
        { slotIndex: 1, speakerPlayerId: "1" },
        { slotIndex: 2, speakerPlayerId: "2" },
      ],
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.actionsToOpen).toContainEqual(
      expect.objectContaining({ key: "end-speech:1:1:1" }),
    );
  });

  it("preserves ordered speech while skipping a dead future speaker", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: false, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const orderedSpeechSlots = [
      { slotIndex: 0, speakerPlayerId: "3" },
      { slotIndex: 1, speakerPlayerId: "2" },
      { slotIndex: 2, speakerPlayerId: "1" },
      { slotIndex: 3, speakerPlayerId: "4" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "3",
          actionKey: "end-speech:1:0:3",
          kind: "end_speech",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      orderedSpeechSlots,
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.actionsToOpen[0]?.key).toBe("end-speech:1:2:1");
    expect(resolution.speechSlotsToCreate).toEqual(orderedSpeechSlots);
  });

  it("opens voting after the final ordered speech slot", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "1",
          actionKey: "end-speech:1:5:1",
          kind: "end_speech",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });

    expect(resolution.nextPhase).toBe("voting");
    expect(resolution.actionsToOpen.every((action) => action.kind === "vote")).toBe(true);
    expect(resolution.events).toEqual([
      expect.objectContaining({
        kind: "phase_changed",
        payload: { phase: "voting" },
      }),
    ]);
    expect(resolution.events[0]?.payload).toEqual({ phase: "voting" });
  });

  it("keeps voter targets out of count-only public vote payloads", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      voteResultVisibility: "count_only" as const,
    };
    const resolution = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "2" },
        { actorPlayerId: "3", kind: "vote", resolverRoleId: null, targetPlayerId: "2" },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });
    const voteEvent = resolution.events.find((event) => event.kind === "vote_resolved");
    const phaseEvent = resolution.events.find((event) => event.kind === "phase_changed");

    expect(resolution.events.map((event) => event.kind)).toEqual([
      "vote_resolved",
      "phase_changed",
    ]);
    expect(voteEvent?.payload).toMatchObject({ dayNumber: 1, executionCandidatePlayerId: "2" });
    expect(voteEvent?.payload["acceptedVotes"]).toBeUndefined();
    expect(phaseEvent?.payload).toEqual({ phase: "execution" });
  });

  it("moves a tied vote directly to night with one phase event", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "2" },
        { actorPlayerId: "2", kind: "vote", resolverRoleId: null, targetPlayerId: "1" },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.nextPhase).toBe("night");
    expect(resolution.events.map((event) => event.kind)).toEqual([
      "vote_resolved",
      "phase_changed",
    ]);
    expect(resolution.events.at(-1)?.payload).toEqual({ phase: "night" });
  });

  it("includes voter targets in voter-to-target public vote payloads", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "seer" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      voteResultVisibility: "voter_to_target" as const,
    };
    const resolution = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "2" },
        { actorPlayerId: "3", kind: "vote", resolverRoleId: null, targetPlayerId: "2" },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });
    const voteEvent = resolution.events.find((event) => event.kind === "vote_resolved");

    expect(voteEvent?.payload["acceptedVotes"]).toEqual([
      { targetPlayerId: "2", voterPlayerId: "1" },
      { targetPlayerId: "2", voterPlayerId: "3" },
    ]);
  });

  it("executes the selected player when execution resolves", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "villager" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "2",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "2", reason: "execution" }]);
    expect(resolution.events.map((event) => event.kind)).toContain("player_executed");
  });

  it("executes the selected player from the current action when last words time out", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "villager" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [],
      currentActions: [
        {
          actorPlayerId: "2",
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          closesAt: "2099-01-01T00:01:00.000Z",
          eligibleTargetPlayerIds: [],
          id: "execution-window-1",
          key: "execution-skip:1:2",
          kind: "execution_skip",
          openedAt: "2099-01-01T00:00:00.000Z",
          resolverRoleId: null,
          targetKind: "none",
          targetStateRequirement: ActionTargetStateRequirement.Assigned,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.deaths).toEqual([{ playerId: "2", reason: "execution" }]);
    expect(resolution.events.map((event) => event.kind)).toContain("player_executed");
  });

  it("shows executed werewolf judgement privately to alive spiritists", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "spiritist" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "3",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });
    const spiritistEvent = resolution.events.find((event) => event.kind === "spiritist_result");

    expect(spiritistEvent).toMatchObject({
      payload: {
        presentation: {
          details: expect.arrayContaining([
            expect.objectContaining({
              value: { kind: "player", playerId: "3" },
            }),
          ]),
        },
      },
      visibility: "private",
      visibleToPlayerIds: ["2"],
    });
  });

  it("ends after a decisive night death without emitting a phase event", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "villager" },
      { alive: true, playerId: "3", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "attack:night-2",
          actorPlayerId: "1",
          currentActionId: "attack-action",
          kind: "attack",
          resolverRoleId: "werewolf",
          submittedAt: "2099-01-01T00:00:00.000Z",
          targetPlayerId: "2",
        },
      ],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.nextPhase).toBeNull();
    expect(resolution.finalOutcome?.winnerTeam).toBe("werewolf");
    expect(resolution.events.map((event) => event.kind)).toEqual(["player_died", "game_ended"]);
    expect(resolution.events.at(-1)?.payload).toEqual({ winnerTeam: "werewolf" });
  });

  it("ends after a decisive execution without emitting a phase event", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "villager" },
      { alive: true, playerId: "3", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "1",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.nextPhase).toBeNull();
    expect(resolution.finalOutcome?.winnerTeam).toBe("village");
    expect(resolution.finalOutcome?.playerResultsByPlayerId).toEqual({
      "1": "lose",
      "2": "win",
      "3": "win",
    });
    expect(resolution.events.map((event) => event.kind)).toEqual(["player_executed", "game_ended"]);
    expect(resolution.events.at(-1)?.payload).toEqual({ winnerTeam: "village" });
  });

  it("settles an executed role's blocking action before evaluating the winner", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "hunter" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const execution = resolvePhase({
      actions: [
        {
          actorPlayerId: "2",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });
    const blockingAction = execution.actionsToOpen[0];

    expect(execution.nextPhase).toBe("execution");
    expect(execution.finalOutcome).toBeNull();
    expect(execution.deaths).toEqual([{ playerId: "2", reason: "execution" }]);
    expect(blockingAction).toMatchObject({
      actorPlayerId: "2",
      resolverRoleId: "hunter",
      targetKind: "single_player",
    });

    if (blockingAction?.resolverRoleId === undefined || blockingAction.resolverRoleId === null) {
      throw new Error("The executed role did not open its blocking action.");
    }

    const followUp = resolvePhase({
      actions: [
        {
          actionKey: blockingAction.key,
          actorPlayerId: "2",
          currentActionId: "blocking-action",
          kind: blockingAction.kind,
          resolverRoleId: blockingAction.resolverRoleId,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: "1",
        },
      ],
      currentActions: [
        {
          ...blockingAction,
          closesAt: "2099-01-01T00:01:00.000Z",
          id: "blocking-action",
          openedAt: "2099-01-01T00:00:00.000Z",
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players: players.map((player) =>
        player.playerId === "2" ? { ...player, alive: false } : player,
      ),
      ruleSet,
    });

    expect(followUp.deaths).toEqual([{ playerId: "1", reason: "retaliation" }]);
    expect(followUp.finalOutcome?.winnerTeam).toBe("village");
  });

  it("evaluates fox as a high-priority winner", () => {
    expect(
      evaluateWinner([
        { alive: true, playerId: "1", roleId: "fox" },
        { alive: true, playerId: "2", roleId: "werewolf" },
      ]),
    ).toEqual({ winnerTeam: "fox" });
  });
});
