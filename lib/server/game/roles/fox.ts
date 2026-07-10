import "server-only";
import {
  CountGroup,
  DeathReason,
  EffectTag,
  PlayerResult,
  RoleSetupContributionKind,
  Team,
} from "../types";
import { Role } from "./base";

import type {
  GameEffect,
  RoleId,
  RoleDefaultCountContext,
  RoleSetupContribution,
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

export class FoxRole extends Role {
  override readonly description =
    "Cannot be killed by attacks and can win alone if alive at game end.";
  override readonly id: RoleId = "fox";
  override readonly maxCount = 1;
  override readonly name = "Fox";
  override readonly order = 70;
  override readonly shortLabel = "F";
  override readonly team = Team.Fox;

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
          id: "fox_alive",
          priority: 10,
          sourceRoleId: this.id,
          winnerTeam: Team.Fox,
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
        reason: DeathReason.RuleEffect,
        tags: [EffectTag.Inspection, EffectTag.Unpreventable],
      }),
    ];
  }

  override onAttacked(context: AttackContext): readonly GameEffect[] {
    void context;

    return [];
  }

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    void judgement;

    return context.state.alivePlayerIds.some((playerId) => {
      return context.state.roleByPlayerId.get(playerId) === this.id;
    });
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    if (context.winnerTeam !== Team.Fox) {
      return null;
    }

    return context.state.roleByPlayerId.get(context.playerId) === this.id
      ? PlayerResult.Win
      : PlayerResult.Lose;
  }
}
