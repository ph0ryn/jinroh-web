import { describe, expect, it, vi } from "vitest";

import {
  collectDeathResolvedEffects,
  collectExecutionEffects,
  collectRoleActionEffects,
  expandRoleInteractionEffects,
  resolveEffects,
} from "./effects";
import { roleRegistry } from "./roles";
import { DEFAULT_RULE_OPTIONS } from "./ruleset";
import { DEATH_REASON, GameEffectKind, GameEffectLayer, GamePhase, GameStatus } from "./types";

import type { RoleContext } from "./roles";
import type { PlayerId, ReadonlyGameState, ResolvedRoleSetup, RoleId } from "./types";

describe("resolveEffects", () => {
  it("rejects effects that claim another role as their owner", () => {
    const context = createRoleContext([
      ["target", "villager"],
      ["wolf", "werewolf"],
    ]);
    const villagerRole = roleRegistry.get("villager");
    const hook = vi.spyOn(villagerRole, "onExecuted").mockReturnValue([
      {
        emitterRoleId: "werewolf",
        id: "foreign-effect",
        kind: GameEffectKind.Death,
        layer: GameEffectLayer.Death,
        playerId: "target",
        priority: 100,
        reason: "foreign_reason",
        sourceActionId: null,
        tags: [],
      },
    ]);

    try {
      expect(() =>
        collectExecutionEffects({
          context,
          sourceActionId: "execution-action",
          targetId: "target",
        }),
      ).toThrow("Role villager returned an effect owned by werewolf.");
    } finally {
      hook.mockRestore();
    }
  });

  it("lets guard protection prevent guardable attack death", () => {
    const context = createRoleContext([
      ["wolf", "werewolf"],
      ["target", "villager"],
      ["guard", "guard"],
    ]);
    const effects = [
      ...collectRoleActionEffects({
        actionKind: "attack",
        actorId: "wolf",
        context,
        resolverRoleId: "werewolf",
        sourceActionId: "attack-action",
        targetId: "target",
      }),
      ...collectRoleActionEffects({
        actionKind: "guard",
        actorId: "guard",
        context,
        resolverRoleId: "guard",
        sourceActionId: "guard-action",
        targetId: "target",
      }),
    ];

    const resolution = resolveEffects(expandRoleInteractionEffects(effects, context));

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
        actionKind: "guard",
        actorId: "guard",
        context,
        resolverRoleId: "guard",
        sourceActionId: "guard-action",
        targetId: "target",
      }),
    ];

    const resolution = resolveEffects(expandRoleInteractionEffects(effects, context));

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
      expandRoleInteractionEffects(
        collectRoleActionEffects({
          actionKind: "attack",
          actorId: "wolf",
          context,
          resolverRoleId: "werewolf",
          sourceActionId: "attack-action",
          targetId: "fox",
        }),
        context,
      ),
    );
    const inspectionResolution = resolveEffects(
      expandRoleInteractionEffects(
        collectRoleActionEffects({
          actionKind: "inspect",
          actorId: "seer",
          context,
          resolverRoleId: "seer",
          sourceActionId: "inspect-action",
          targetId: "fox",
        }),
        context,
      ),
    );

    expect(attackResolution.deathEffectsByPlayerId.has("fox")).toBe(false);
    expect(inspectionResolution.deathEffectsByPlayerId.get("fox")?.kind).toBe(GameEffectKind.Death);
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
          reason: DEATH_REASON.Execution,
          roleId: "villager",
          sourceActionId: "execution-action",
        },
      ],
      sourceActionId: "execution-action",
    });

    expect(effects).toEqual([
      expect.objectContaining({
        eventKind: "spiritist_result",
        kind: GameEffectKind.PrivateMessage,
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
  };
  const state: ReadonlyGameState = {
    alivePlayerIds: assignments.map(([playerId]) => playerId),
    currentActions: [],
    finalOutcome: null,
    nightNumber: 2,
    pendingActions: [],
    phase: GamePhase.Night,
    phaseInstanceId: "night-2",
    resolvedActions: [],
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
