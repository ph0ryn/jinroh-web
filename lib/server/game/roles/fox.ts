import "server-only";
import {
  CountGroup,
  DEATH_REASON,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  PlayerResult,
  RoleSetupContributionKind,
} from "../types";
import { Role } from "./base";

import type {
  GameEffect,
  RoleId,
  RoleDefaultCountContext,
  RoleSetupContribution,
  RoleTeamDefinition,
  WinnerJudgementContribution,
} from "../types";
import type {
  AttackContext,
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleContext,
  WinnerJudgementContext,
} from "./base";

const FOX_ALIVE_JUDGEMENT = "fox_alive";
const FOX_TEAM = {
  id: "fox",
  presentation: { en: "Fox", ja: "妖狐" },
} as const satisfies RoleTeamDefinition;

export class FoxRole extends Role {
  override readonly id: RoleId = "fox";
  override readonly maxCount = 1;
  override readonly order = 70;
  override readonly presentation = {
    en: {
      description: "Survive until the game ends to steal victory for yourself.",
      name: "Fox",
      shortLabel: "F",
    },
    ja: {
      description: "ゲーム終了まで生き残り、単独勝利を奪います。",
      name: "妖狐",
      shortLabel: "狐",
    },
  };
  override readonly team = FOX_TEAM;
  override readonly version = 2;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    void context;

    return 0;
  }

  override countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.NonWerewolf;
  }

  override getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [
      {
        judgement: {
          id: FOX_ALIVE_JUDGEMENT,
          priority: 10,
          sourceRoleId: this.id,
          winnerTeam: this.team.id,
        },
        kind: RoleSetupContributionKind.WinnerJudgement,
      },
    ];
  }

  override onInspected(context: InspectionContext): readonly GameEffect[] {
    return [
      this.createDeathEffect({
        id: `death:inspection:${context.targetId}`,
        playerId: context.targetId,
        reason: DEATH_REASON.RuleEffect,
        tags: [EFFECT_TAG.Inspection, EFFECT_TAG.Unpreventable],
      }),
    ];
  }

  override onAttacked(context: AttackContext): readonly GameEffect[] {
    return [
      {
        emitterRoleId: this.id,
        id: `protection:fox-immunity:${context.targetId}`,
        kind: GameEffectKind.Protection,
        layer: GameEffectLayer.Prevention,
        playerId: context.targetId,
        prevents: [EFFECT_TAG.Attack],
        priority: 5,
        reason: "fox_immunity",
        sourceActionId: null,
        tags: [],
      },
      ...super.onAttacked(context),
    ];
  }

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    if (judgement.id !== FOX_ALIVE_JUDGEMENT) {
      return false;
    }

    return context.state.alivePlayerIds.some((playerId) => {
      return context.state.roleByPlayerId.get(playerId) === this.id;
    });
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    if (context.winnerTeam !== this.team.id) {
      return null;
    }

    return context.state.roleByPlayerId.get(context.playerId) === this.id
      ? PlayerResult.Win
      : PlayerResult.Lose;
  }
}
