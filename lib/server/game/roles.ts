import "server-only";
import { RoleRegistry } from "./roles/base";
import { FoxRole } from "./roles/fox";
import { GuardRole } from "./roles/guard";
import { HunterRole } from "./roles/hunter";
import { MadmanRole } from "./roles/madman";
import { SeerRole } from "./roles/seer";
import { SpiritistRole } from "./roles/spiritist";
import { VillagerRole } from "./roles/villager";
import { WerewolfRole } from "./roles/werewolf";
import { GameEndReason, PlayerResult, RoleSetupContributionKind, Team } from "./types";

import type { PlayerResultContext, WinnerJudgementContext } from "./roles/base";
import type {
  RoleCounts,
  RoleId,
  RolePublicMetadata,
  RoleSetupContribution,
  WinnerJudgementContribution,
} from "./types";

export { ROLE_REGISTRY_VERSION, Role, RoleRegistry } from "./roles/base";
export type {
  AttackContext,
  DeathResolvedContext,
  ExecutionContext,
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleContext,
  RoleRuleValidationContext,
  RoleRuleValidationIssue,
  RoleRuleValidationIssueCode,
  WinnerJudgementContext,
} from "./roles/base";
export { FoxRole } from "./roles/fox";
export { GuardRole } from "./roles/guard";
export { HunterRole } from "./roles/hunter";
export { MadmanRole } from "./roles/madman";
export { SeerRole } from "./roles/seer";
export { SpiritistRole } from "./roles/spiritist";
export { VillagerRole } from "./roles/villager";
export { WerewolfRole } from "./roles/werewolf";

export const roleRegistry = new RoleRegistry([
  new WerewolfRole(),
  new MadmanRole(),
  new SeerRole(),
  new GuardRole(),
  new SpiritistRole(),
  new HunterRole(),
  new FoxRole(),
  new VillagerRole(),
]);

export function getRoleIds(): readonly RoleId[] {
  return roleRegistry.getAll().map((role) => role.id);
}

export function getRoleCatalog(): readonly RolePublicMetadata[] {
  return roleRegistry.getAll().map((role) => role.getPublicMetadata());
}

export function makeDefaultRoleCounts(playerCount: number): RoleCounts {
  const roleCounts: Record<RoleId, number> = {};
  let assignedRoleCount = 0;

  for (const role of roleRegistry.getAll()) {
    const count = role.getDefaultCount({
      assignedRoleCount,
      playerCount,
    });

    roleCounts[role.id] = count;
    assignedRoleCount += count;
  }

  return roleCounts;
}

export function getCoreSetupContributions(): readonly RoleSetupContribution[] {
  return [
    {
      judgement: {
        id: "core_werewolf_dominance",
        priority: 100,
        sourceRoleId: null,
        winnerTeam: Team.Werewolf,
      },
      kind: RoleSetupContributionKind.WinnerJudgement,
    },
    {
      judgement: {
        id: "core_werewolves_eliminated",
        priority: 100,
        sourceRoleId: null,
        winnerTeam: Team.Village,
      },
      kind: RoleSetupContributionKind.WinnerJudgement,
    },
  ];
}

export function evaluateCoreWinnerJudgement(
  judgement: WinnerJudgementContribution,
  endReasons: readonly GameEndReason[],
): boolean {
  if (judgement.id === "core_werewolf_dominance") {
    return endReasons.includes(GameEndReason.WerewolfDominance);
  }

  if (judgement.id === "core_werewolves_eliminated") {
    return endReasons.includes(GameEndReason.WerewolvesEliminated);
  }

  return false;
}

export function evaluateWinnerTeam(context: WinnerJudgementContext): Team {
  const judgements = [...context.state.resolvedRoleSetup.winnerJudgements].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });

  for (const judgement of judgements) {
    const winnerMatched =
      judgement.sourceRoleId === null
        ? evaluateCoreWinnerJudgement(judgement, context.endReasons)
        : context.roles.get(judgement.sourceRoleId).evaluateWinnerJudgement(judgement, context);

    if (winnerMatched) {
      return judgement.winnerTeam;
    }
  }

  return Team.Neutral;
}

export function evaluatePlayerResult(context: PlayerResultContext): PlayerResult {
  const roleId = context.state.roleByPlayerId.get(context.playerId);

  if (roleId === undefined) {
    return PlayerResult.Lose;
  }

  const role = context.roles.get(roleId);
  const roleResult = role.evaluateResult(context);

  if (roleResult !== null) {
    return roleResult;
  }

  return role.team === context.winnerTeam ? PlayerResult.Win : PlayerResult.Lose;
}
