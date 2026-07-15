import { describe, expect, it } from "vitest";

import { collectExecutionEffects, collectRoleActionEffects } from "../effects";
import { roleRegistry } from "../roles";
import { DEFAULT_RULE_OPTIONS } from "../ruleset";
import { GameEffectKind, GamePhase, GameStatus } from "../types";

import type { RoleContext } from "../roles";
import type { ReadonlyGameState, ResolvedRoleSetup } from "../types";

describe("HunterRole", () => {
  it("opens and resolves its own post-execution action", () => {
    const context = createContext();
    const executionEffects = collectExecutionEffects({
      context,
      sourceActionId: "execution-action",
      targetId: "hunter-player",
    });
    const actionEffect = executionEffects.find(
      (effect) => effect.kind === GameEffectKind.CurrentAction,
    );

    expect(actionEffect).toMatchObject({
      actorPlayerId: "hunter-player",
      actorRoleId: "hunter",
      eligibleTargetPlayerIds: ["wolf-player", "villager-player"],
      kind: GameEffectKind.CurrentAction,
      resolverRoleId: "hunter",
    });

    if (actionEffect?.kind !== GameEffectKind.CurrentAction) {
      throw new Error("Hunter did not create its follow-up action.");
    }

    const actionDefinition = roleRegistry
      .get(actionEffect.resolverRoleId)
      .getActionDefinition(actionEffect.actionKind);

    expect(actionDefinition).toMatchObject({
      presentation: {
        ja: {
          label: "道連れにするプレイヤーを選択してください",
        },
      },
      target: actionEffect.target,
      targetStateRequirement: actionEffect.targetStateRequirement,
    });

    expect(
      collectRoleActionEffects({
        actionKind: actionEffect.actionKind,
        actorId: "hunter-player",
        context,
        resolverRoleId: actionEffect.resolverRoleId,
        sourceActionId: actionEffect.actionKey,
        targetId: "wolf-player",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: GameEffectKind.Death,
        playerId: "wolf-player",
        reason: "retaliation",
      }),
    ]);
  });
});

function createContext(): RoleContext {
  const roleByPlayerId = new Map([
    ["hunter-player", "hunter"],
    ["villager-player", "villager"],
    ["wolf-player", "werewolf"],
  ]);
  const resolvedRoleSetup: ResolvedRoleSetup = {
    activeRoleIds: ["werewolf", "hunter", "villager"],
    contributions: [],
    nightConversationGroups: [],
  };
  const state: ReadonlyGameState = {
    alivePlayerIds: ["hunter-player", "wolf-player", "villager-player"],
    currentActions: [],
    finalOutcome: null,
    nightConversationMessages: [],
    nightNumber: 1,
    pendingActions: [],
    phase: GamePhase.Execution,
    phaseInstanceId: "execution-1",
    resolvedActions: [],
    resolvedRoleSetup,
    roleByPlayerId,
    ruleOptions: DEFAULT_RULE_OPTIONS,
    status: GameStatus.Playing,
  };

  return { roles: roleRegistry, state };
}
