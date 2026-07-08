import "server-only";
import {
  ActionScope,
  GameActionKind,
  GamePhase,
  ResolveTiming,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";
import { isGuardTargetAllowed } from "./guardTarget";
import { createGuardProtectionEffect } from "./roleEffects";
import { GUARD_ROLE_ID } from "./roleIds";

import type {
  GameEffect,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type { PlayerRoleContext, RoleActionResolvedContext } from "./base";

export class GuardRole extends Role {
  override readonly description = "Protects one player from guardable night death effects.";
  override readonly id: RoleId = GUARD_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Guard";
  override readonly order = 40;
  override readonly shortLabel = "G";
  override readonly team = Team.Village;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 5 ? 1 : 0;
  }

  override getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [
      {
        key: "guardConsecutiveTargetPolicy",
        label: "Consecutive target",
        roleId: this.id,
      },
    ];
  }

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Guard,
        phase: GamePhase.Night,
        required: true,
        resolveTiming: ResolveTiming.PhaseEnd,
        roleGroupPolicy: null,
        roleGroupRoleId: null,
        scope: ActionScope.Player,
        submitPolicy: SubmitPolicy.FirstSubmitWins,
        target: RoleTargetKind.SinglePlayer,
      },
    ];
  }

  override getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly string[] {
    if (action.kind !== GameActionKind.Guard) {
      return super.getEligibleTargets(action, context);
    }

    return context.state.alivePlayerIds.filter((playerId) => {
      return (
        playerId !== context.playerId &&
        isGuardTargetAllowed({
          context,
          guardPlayerId: context.playerId,
          targetPlayerId: playerId,
        })
      );
    });
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== GameActionKind.Guard || context.targetId === null) {
      return [];
    }

    return [
      createGuardProtectionEffect({
        emitterRoleId: this.id,
        playerId: context.targetId,
        sourceActionId: null,
      }),
    ];
  }
}
