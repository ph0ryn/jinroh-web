import { describe, expect, it } from "vitest";

import {
  didPlayerWin,
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

      expect(publicInitialEvents).toHaveLength(1);
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
      const targetPlayerId = inspectionEvent?.payload["targetPlayerId"];
      const targetAssignment = result.assignments.find(
        (assignment) => assignment.playerId === targetPlayerId,
      );

      expect(result.actions.every((action) => action.kind !== "inspect")).toBe(true);
      expect(seerAssignment).toBeDefined();
      expect(inspectionEvent).toMatchObject({
        payload: { result: "human" },
        visibility: "private",
        visibleToPlayerIds: [seerAssignment?.playerId],
      });
      expect(targetPlayerId).not.toBe(seerAssignment?.playerId);
      expect(targetAssignment?.roleId).not.toBe("werewolf");
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

  it("removes the previous guard target when consecutive guard is denied", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      guardConsecutiveTargetPolicy: "deny" as const,
    };
    const guardAction = getAvailableNightActions(players, 3, ruleSet, { "2": "3" }).find(
      (action) => action.kind === "guard",
    );

    expect(guardAction?.eligibleTargetPlayerIds).not.toContain("3");
    expect(guardAction?.eligibleTargetPlayerIds).toContain("4");
  });

  it("keeps the previous guard target eligible when consecutive guard is allowed", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      guardConsecutiveTargetPolicy: "allow" as const,
    };
    const guardAction = getAvailableNightActions(players, 3, ruleSet, { "2": "3" }).find(
      (action) => action.kind === "guard",
    );

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
      actions: [{ actorPlayerId: "1", kind: "attack", targetPlayerId: "3" }],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(3),
    });

    expect(resolution.nextPhase).toBe("day");
    expect(resolution.deaths).toEqual([{ playerId: "3", reason: "attack" }]);
  });

  it("keeps fox alive against a werewolf attack", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "fox" },
      { alive: true, playerId: "3", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [{ actorPlayerId: "1", kind: "attack", targetPlayerId: "2" }],
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
      actions: [{ actorPlayerId: "2", kind: "inspect", targetPlayerId: "3" }],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "3", reason: "rule_effect" }]);
    expect(resolution.events.map((event) => event.kind)).toContain("inspection_result");
  });

  it("records guard target internally for the next night", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "guard" },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolution = resolvePhase({
      actions: [{ actorPlayerId: "2", kind: "guard", targetPlayerId: "3" }],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });
    const guardEvent = resolution.events.find(
      (event) => event.kind === "action_resolved" && event.payload["actionKind"] === "guard",
    );

    expect(guardEvent).toMatchObject({
      payload: { actorPlayerId: "2", targetPlayerIds: ["3"] },
      visibility: "internal",
    });
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
        { actorPlayerId: "1", kind: "vote", targetPlayerId: "2" },
        { actorPlayerId: "3", kind: "vote", targetPlayerId: "2" },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet,
    });
    const voteEvent = resolution.events.find((event) => event.kind === "vote_resolved");

    expect(voteEvent?.payload).toMatchObject({ executionCandidatePlayerId: "2" });
    expect(voteEvent?.payload["acceptedVotes"]).toBeUndefined();
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
        { actorPlayerId: "1", kind: "vote", targetPlayerId: "2" },
        { actorPlayerId: "3", kind: "vote", targetPlayerId: "2" },
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
      actions: [{ actorPlayerId: "2", kind: "execution_skip", targetPlayerId: null }],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
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
      actions: [{ actorPlayerId: "3", kind: "execution_skip", targetPlayerId: null }],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });
    const spiritistEvent = resolution.events.find((event) => event.kind === "spiritist_result");

    expect(spiritistEvent).toMatchObject({
      payload: { result: "human", targetPlayerId: "3" },
      visibility: "private",
      visibleToPlayerIds: ["2"],
    });
  });

  it("opens a role-defined retaliation action when the hunter is executed", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "hunter" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [{ actorPlayerId: "2", kind: "execution_skip", targetPlayerId: null }],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "2", reason: "execution" }]);
    expect(resolution.nextPhase).toBe("execution");
    expect(resolution.actionsToOpen).toEqual([
      expect.objectContaining({
        actorPlayerId: "2",
        actorRoleId: "hunter",
        eligibleTargetPlayerIds: ["1", "3", "4"],
        kind: "hunter_retaliate",
        targetKind: "single_player",
      }),
    ]);
  });

  it("resolves the hunter retaliation action as retaliation death", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: false, playerId: "2", roleId: "hunter" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [{ actorPlayerId: "2", kind: "hunter_retaliate", targetPlayerId: "1" }],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "1", reason: "retaliation" }]);
    expect(resolution.events.map((event) => event.kind)).toContain("player_died");
    expect(resolution.finalOutcome?.winnerTeam).toBe("villagers");
  });

  it("continues without retaliation death when the hunter action times out", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: false, playerId: "2", roleId: "hunter" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([]);
    expect(resolution.nextPhase).toBe("night");
    expect(resolution.actionsToOpen.every((action) => action.kind !== "hunter_retaliate")).toBe(
      true,
    );
  });

  it("does not open hunter retaliation after a night attack", () => {
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: "hunter" },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolution = resolvePhase({
      actions: [{ actorPlayerId: "1", kind: "attack", targetPlayerId: "2" }],
      currentPhase: "night",
      dayNumber: 1,
      nightNumber: 2,
      players,
      ruleSet: makeDefaultRuleSetForPlayers(4),
    });

    expect(resolution.deaths).toEqual([{ playerId: "2", reason: "attack" }]);
    expect(resolution.actionsToOpen.every((action) => action.kind !== "hunter_retaliate")).toBe(
      true,
    );
  });

  it("evaluates fox as a high-priority winner", () => {
    expect(
      evaluateWinner([
        { alive: true, playerId: "1", roleId: "fox" },
        { alive: true, playerId: "2", roleId: "werewolf" },
      ]),
    ).toEqual({
      reason: "A fox survived when another team condition resolved.",
      winnerTeam: "fox",
    });
  });

  it("maps player result from role team after final outcome", () => {
    expect(didPlayerWin("madman", "werewolves")).toBe(true);
    expect(didPlayerWin("seer", "werewolves")).toBe(false);
  });
});
