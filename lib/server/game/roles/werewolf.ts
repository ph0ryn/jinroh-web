import "server-only";
import {
  ActionTargetStateRequirement,
  CountGroup,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  InspectionView,
  PlayerResult,
  RoleSetupContributionKind,
  RoleTargetKind,
} from "../types";
import { Role, scopeRoleContext } from "./base";
import { VILLAGE_TEAM } from "./villager";

import type {
  GameActionKind,
  GameEffect,
  GameEndCandidate,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSetupContribution,
  RoleTeamDefinition,
  WinnerJudgementContribution,
} from "../types";
import type {
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleActionResolvedContext,
  RoleContext,
  WinnerJudgementContext,
} from "./base";

const ATTACK_ACTION_KIND: GameActionKind = "attack";
const WEREWOLF_DOMINANCE_REASON = "werewolf_dominance";
const WEREWOLVES_ELIMINATED_REASON = "werewolves_eliminated";
const WEREWOLF_DOMINANCE_JUDGEMENT = "werewolf_dominance";
const VILLAGE_ELIMINATION_JUDGEMENT = "werewolves_eliminated";

export const WEREWOLF_TEAM = {
  id: "werewolf",
  presentation: { en: "Werewolves", ja: "人狼陣営" },
} as const satisfies RoleTeamDefinition;

export class WerewolfRole extends Role {
  override readonly id: RoleId = "werewolf";
  override readonly minCount = 1;
  override readonly nightConversation = {
    groupId: "werewolf",
    label: { en: "Werewolf council", ja: "人狼の密談" },
  };
  override readonly order = 10;
  override readonly presentation = {
    en: {
      description: "Hide among the village and attack one player each night.",
      name: "Werewolf",
      shortLabel: "W",
    },
    ja: {
      description: "村に紛れ込み、毎夜1人を襲撃します。",
      name: "人狼",
      shortLabel: "狼",
    },
  };
  override readonly required = true;
  override readonly team = WEREWOLF_TEAM;
  override readonly version = 2;

  override getActionPresentation(actionKind: GameActionKind) {
    if (actionKind !== ATTACK_ACTION_KIND) {
      return super.getActionPresentation(actionKind);
    }

    return {
      en: { label: "Choose someone to attack", submitLabel: "Attack" },
      ja: { label: "襲撃する相手を選ぶ", submitLabel: "襲撃する" },
    };
  }

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
        kind: ATTACK_ACTION_KIND,
        roleGroupRoleId: this.id,
        target: RoleTargetKind.SinglePlayer,
        targetStateRequirement: ActionTargetStateRequirement.Alive,
      },
    ];
  }

  override getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly string[] {
    if (action.kind !== ATTACK_ACTION_KIND) {
      return super.getEligibleTargets(action, context);
    }

    return context.state.alivePlayerIds.filter((playerId) => {
      return context.state.roleByPlayerId.get(playerId) !== this.id;
    });
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== ATTACK_ACTION_KIND || context.targetId === null) {
      return [];
    }

    return [
      {
        attackerIds: this.getAliveWerewolfIds(context),
        emitterRoleId: this.id,
        id: `attack:${context.actorId}:${context.targetId}`,
        kind: GameEffectKind.Attack,
        layer: GameEffectLayer.Action,
        priority: 100,
        sourceActionId: null,
        tags: [EFFECT_TAG.Attack],
        targetId: context.targetId,
      },
    ];
  }

  override getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [
      {
        judgement: {
          id: WEREWOLF_DOMINANCE_JUDGEMENT,
          priority: 100,
          sourceRoleId: this.id,
          winnerTeam: this.team.id,
        },
        kind: RoleSetupContributionKind.WinnerJudgement,
      },
      {
        judgement: {
          id: VILLAGE_ELIMINATION_JUDGEMENT,
          priority: 100,
          sourceRoleId: this.id,
          winnerTeam: VILLAGE_TEAM.id,
        },
        kind: RoleSetupContributionKind.WinnerJudgement,
      },
    ];
  }

  override checkEndCondition(context: RoleContext): GameEndCandidate | null {
    const aliveWerewolves = this.countAliveByGroup(context, CountGroup.Werewolf);
    const aliveOthers = this.countAliveByGroup(context, CountGroup.NonWerewolf);

    if (aliveWerewolves === 0) {
      return {
        reason: WEREWOLVES_ELIMINATED_REASON,
        sourceRoleId: this.id,
      };
    }

    if (aliveWerewolves >= aliveOthers) {
      return {
        reason: WEREWOLF_DOMINANCE_REASON,
        sourceRoleId: this.id,
      };
    }

    return null;
  }

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    if (judgement.id === WEREWOLF_DOMINANCE_JUDGEMENT) {
      return context.ownEndCandidates.some(
        (candidate) => candidate.reason === WEREWOLF_DOMINANCE_REASON,
      );
    }

    if (judgement.id === VILLAGE_ELIMINATION_JUDGEMENT) {
      return context.ownEndCandidates.some(
        (candidate) => candidate.reason === WEREWOLVES_ELIMINATED_REASON,
      );
    }

    return false;
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === this.team.id ? PlayerResult.Win : null;
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

      if (role.countAs({ ...scopeRoleContext(context, role.id), playerId }) === group) {
        count += 1;
      }
    }

    return count;
  }
}
