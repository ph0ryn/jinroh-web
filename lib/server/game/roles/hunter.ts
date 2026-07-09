import "server-only";
import {
  DeathReason,
  EffectTag,
  GameActionKind,
  GameEffectKind,
  GameEffectLayer,
  RoleTargetKind,
  Team,
} from "../types";
import { Role } from "./base";

import type { GameEffect, RoleId } from "../types";
import type { ExecutionContext, RoleActionResolvedContext } from "./base";

export class HunterRole extends Role {
  override readonly description = "Retaliates once when executed.";
  override readonly id: RoleId = "hunter";
  override readonly maxCount = 1;
  override readonly name = "Hunter";
  override readonly order = 60;
  override readonly shortLabel = "H";
  override readonly team = Team.Village;

  override onExecuted(context: ExecutionContext): readonly GameEffect[] {
    const eligibleTargetPlayerIds = context.state.alivePlayerIds.filter(
      (playerId) => playerId !== context.targetId,
    );

    return [
      ...super.onExecuted(context),
      ...(eligibleTargetPlayerIds.length === 0
        ? []
        : [
            {
              actionKey: `hunter-retaliate:${context.state.phaseInstanceId ?? "execution"}:${context.targetId}`,
              actionKind: GameActionKind.HunterRetaliate,
              actorPlayerId: context.targetId,
              actorRoleId: this.id,
              eligibleTargetPlayerIds,
              emitterRoleId: this.id,
              id: `action:hunter-retaliate:${context.targetId}`,
              kind: GameEffectKind.CurrentAction,
              layer: GameEffectLayer.Action,
              priority: 200,
              sourceActionId: null,
              tags: [],
              target: RoleTargetKind.SinglePlayer,
            } satisfies GameEffect,
          ]),
    ];
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== GameActionKind.HunterRetaliate || context.targetId === null) {
      return [];
    }

    return [
      this.createDeathEffect({
        id: `death:retaliation:${context.actorId}:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.Retaliation,
        tags: [EffectTag.Retaliation, EffectTag.Unpreventable],
      }),
    ];
  }
}
