import "server-only";
import {
  ActionScope,
  CountGroup,
  GameActionKind,
  GameEndReason,
  GamePhase,
  InspectionView,
  PlayerResult,
  ResolveTiming,
  RoleGroupActionPolicy,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";

import type {
  GameEffect,
  GameEndCandidate,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
} from "../types";
import type {
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleActionResolvedContext,
  RoleContext,
} from "./base";

export class WerewolfRole extends Role {
  override readonly description = "Attacks at night and wins when werewolves dominate.";
  override readonly id: RoleId = "werewolf";
  override readonly minCount = 1;
  override readonly name = "Werewolf";
  override readonly nightConversation = {
    groupId: "werewolf",
    labelKey: "nightConversation.werewolf",
  };
  override readonly order = 10;
  override readonly required = true;
  override readonly shortLabel = "W";
  override readonly team = Team.Werewolf;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 7 ? 2 : 1;
  }

  override countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.Werewolf;
  }

  override seenAs(context: InspectionContext): InspectionView {
    void context;

    return InspectionView.Werewolf;
  }

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Attack,
        phase: GamePhase.Night,
        required: true,
        resolveTiming: ResolveTiming.PhaseEnd,
        roleGroupPolicy: RoleGroupActionPolicy.FirstSubmitWins,
        roleGroupRoleId: this.id,
        scope: ActionScope.RoleGroup,
        submitPolicy: SubmitPolicy.FirstSubmitWins,
        target: RoleTargetKind.SinglePlayer,
      },
    ];
  }

  override getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly string[] {
    if (action.kind !== GameActionKind.Attack) {
      return super.getEligibleTargets(action, context);
    }

    return context.state.alivePlayerIds.filter((playerId) => {
      return context.state.roleByPlayerId.get(playerId) !== this.id;
    });
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== GameActionKind.Attack || context.targetId === null) {
      return [];
    }

    const targetRoleId = context.state.roleByPlayerId.get(context.targetId);

    if (targetRoleId === undefined) {
      return [];
    }

    const targetRole = context.roles.get(targetRoleId);

    return targetRole.onAttacked({
      ...context,
      attackerIds: this.getAliveWerewolfIds(context),
      targetId: context.targetId,
    });
  }

  override checkEndCondition(context: RoleContext): GameEndCandidate | null {
    const aliveWerewolves = this.countAliveByGroup(context, CountGroup.Werewolf);
    const aliveOthers = this.countAliveByGroup(context, CountGroup.NonWerewolf);

    if (aliveWerewolves === 0) {
      return {
        reason: GameEndReason.WerewolvesEliminated,
        sourceRoleId: this.id,
      };
    }

    if (aliveWerewolves >= aliveOthers) {
      return {
        reason: GameEndReason.WerewolfDominance,
        sourceRoleId: this.id,
      };
    }

    return null;
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === Team.Werewolf ? PlayerResult.Win : null;
  }

  private getAliveWerewolfIds(context: RoleContext): readonly string[] {
    return context.state.alivePlayerIds.filter((playerId) => {
      return context.state.roleByPlayerId.get(playerId) === this.id;
    });
  }

  private countAliveByGroup(context: RoleContext, group: CountGroup): number {
    let count = 0;

    for (const playerId of context.state.alivePlayerIds) {
      const roleId = context.state.roleByPlayerId.get(playerId);

      if (roleId === undefined) {
        continue;
      }

      const role = context.roles.get(roleId);

      if (role.countAs({ ...context, playerId }) === group) {
        count += 1;
      }
    }

    return count;
  }
}
