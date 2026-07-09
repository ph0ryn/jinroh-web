import { describe, expect, it } from "vitest";

import {
  collectDeathResolvedEffects,
  collectExecutionEffects,
  collectRoleActionEffects,
  resolveEffects,
} from "./effects";
import { roleRegistry } from "./roles";
import { DEFAULT_RULE_OPTIONS } from "./ruleset";
import { DeathReason, GameActionKind, GameEffectKind, GamePhase, GameStatus } from "./types";

import type { RoleContext } from "./roles";
import type { PlayerId, ReadonlyGameState, ResolvedRoleSetup, RoleId } from "./types";

describe("resolveEffects", () => {
  it("lets guard protection prevent guardable attack death", () => {
    const context = createRoleContext([
      ["wolf", "werewolf"],
      ["target", "villager"],
      ["guard", "guard"],
    ]);
    const effects = [
      ...collectRoleActionEffects({
        actionKind: GameActionKind.Attack,
        actorId: "wolf",
        actorRoleId: "werewolf",
        context,
        sourceActionId: "attack-action",
        targetId: "target",
      }),
      ...collectRoleActionEffects({
        actionKind: GameActionKind.Guard,
        actorId: "guard",
        actorRoleId: "guard",
        context,
        sourceActionId: "guard-action",
        targetId: "target",
      }),
    ];

    const resolution = resolveEffects(effects);

    expect(resolution.deathEffectsByPlayerId.has("target")).toBe(false);
    expect(resolution.preventedEffects).toHaveLength(1);
    expect(resolution.preventedEffects[0]?.effect.kind).toBe(GameEffectKind.Death);
  });

  it("does not let guard protection prevent execution death", () => {
    const context = createRoleContext([
      ["target", "villager"],
      ["guard", "guard"],
    ]);
    const effects = [
      ...collectExecutionEffects({
        context,
        sourceActionId: "execution-action",
        targetId: "target",
      }),
      ...collectRoleActionEffects({
        actionKind: GameActionKind.Guard,
        actorId: "guard",
        actorRoleId: "guard",
        context,
        sourceActionId: "guard-action",
        targetId: "target",
      }),
    ];

    const resolution = resolveEffects(effects);

    expect(resolution.deathEffectsByPlayerId.get("target")?.kind).toBe(GameEffectKind.Death);
    expect(resolution.preventedEffects).toHaveLength(0);
  });

  it("keeps fox alive on attack but kills fox on inspection", () => {
    const context = createRoleContext([
      ["seer", "seer"],
      ["fox", "fox"],
      ["wolf", "werewolf"],
    ]);
    const attackResolution = resolveEffects(
      collectRoleActionEffects({
        actionKind: GameActionKind.Attack,
        actorId: "wolf",
        actorRoleId: "werewolf",
        context,
        sourceActionId: "attack-action",
        targetId: "fox",
      }),
    );
    const inspectionResolution = resolveEffects(
      collectRoleActionEffects({
        actionKind: GameActionKind.Inspect,
        actorId: "seer",
        actorRoleId: "seer",
        context,
        sourceActionId: "inspect-action",
        targetId: "fox",
      }),
    );

    expect(attackResolution.deathEffectsByPlayerId.has("fox")).toBe(false);
    expect(inspectionResolution.deathEffectsByPlayerId.get("fox")?.kind).toBe(GameEffectKind.Death);
  });

  it("collects hunter retaliation as an execution follow-up action from the role class", () => {
    const context = createRoleContext([
      ["hunter", "hunter"],
      ["wolf", "werewolf"],
      ["villager", "villager"],
    ]);
    const effects = collectExecutionEffects({
      context,
      sourceActionId: "execution-action",
      targetId: "hunter",
    });
    const actionEffect = effects.find((effect) => effect.kind === GameEffectKind.CurrentAction);

    expect(actionEffect).toMatchObject({
      actionKind: GameActionKind.HunterRetaliate,
      actorPlayerId: "hunter",
      eligibleTargetPlayerIds: ["wolf", "villager"],
      kind: GameEffectKind.CurrentAction,
    });
  });

  it("collects spiritist result private messages from the role class", () => {
    const context = createRoleContext([
      ["spiritist", "spiritist"],
      ["target", "villager"],
      ["wolf", "werewolf"],
    ]);
    const effects = collectDeathResolvedEffects({
      context,
      deaths: [
        {
          playerId: "target",
          reason: DeathReason.Execution,
          roleId: "villager",
          sourceActionId: "execution-action",
        },
      ],
      sourceActionId: "execution-action",
    });

    expect(effects).toEqual([
      expect.objectContaining({
        kind: GameEffectKind.PrivateMessage,
        messageKey: "spiritist_result",
        payload: {
          result: "human",
          targetPlayerId: "target",
        },
        playerId: "spiritist",
      }),
    ]);
  });
});

function createRoleContext(assignments: readonly (readonly [PlayerId, RoleId])[]): RoleContext {
  const roleByPlayerId = new Map<PlayerId, RoleId>(assignments);
  const activeRoleIds = [...new Set(assignments.map(([, roleId]) => roleId))];
  const resolvedRoleSetup: ResolvedRoleSetup = {
    activeRoleIds,
    contributions: [],
    nightConversationGroups: [],
    winnerJudgements: [],
  };
  const state: ReadonlyGameState = {
    alivePlayerIds: assignments.map(([playerId]) => playerId),
    currentActions: [],
    events: [],
    finalOutcome: null,
    nightNumber: 2,
    pendingActions: [],
    phase: GamePhase.Night,
    phaseInstanceId: "night-2",
    resolvedRoleSetup,
    roleByPlayerId,
    ruleOptions: DEFAULT_RULE_OPTIONS,
    status: GameStatus.Playing,
    nightConversationMessages: [],
  };

  return {
    roles: roleRegistry,
    state,
  };
}
