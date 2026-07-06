import { describe, expect, it } from "vitest";

import { makeDefaultRuleSetForPlayers } from "@/lib/shared/game";

import {
  didPlayerWin,
  evaluateWinner,
  getAvailableNightActions,
  resolvePhase,
  startGame,
  type PlayerRuntimeState,
} from "./gameEngine";

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

  it("evaluates fox as a high-priority winner", () => {
    expect(
      evaluateWinner([
        { alive: true, playerId: "1", roleId: "fox" },
        { alive: true, playerId: "2", roleId: "werewolf" },
        { alive: true, playerId: "3", roleId: "villager" },
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
