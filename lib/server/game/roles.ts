import "server-only";
import { RoleRegistry, scopeRoleContext } from "./roles/base";
import { FoxRole } from "./roles/fox";
import { GuardRole } from "./roles/guard";
import { HunterRole } from "./roles/hunter";
import { MadmanRole } from "./roles/madman";
import { SeerRole } from "./roles/seer";
import { SpiritistRole } from "./roles/spiritist";
import { VillagerRole } from "./roles/villager";
import { WerewolfRole } from "./roles/werewolf";
import { PlayerResult } from "./types";

import type {
  PlayerResultContext,
  PlayerRoleContext,
  RoleContext,
  WinnerJudgementContext,
} from "./roles/base";
import type {
  GameEndCandidate,
  RoleCounts,
  RoleId,
  RolePublicMetadata,
  RoleTeamDefinition,
  Team,
} from "./types";

export { ROLE_REGISTRY_VERSION_PREFIX, Role, RoleRegistry, scopeRoleContext } from "./roles/base";
export type {
  AttackContext,
  DeathResolvedContext,
  ExecutionContext,
  ExecutionResolvedContext,
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleContext,
  RoleActionResolvedContext,
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

export function getTeamCatalog(): readonly RoleTeamDefinition[] {
  return roleRegistry.getTeams();
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

type WinnerTeamEvaluationContext = RoleContext & {
  endCandidates: readonly GameEndCandidate[];
};

type PlayerResultEvaluationContext = PlayerRoleContext & {
  endCandidates: readonly GameEndCandidate[];
  winnerTeam: Team;
};

export function evaluateWinnerTeam(context: WinnerTeamEvaluationContext): Team {
  const judgements = context.state.resolvedRoleSetup.contributions
    .map((contribution) => contribution.judgement)
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      const ownerComparison = left.sourceRoleId.localeCompare(right.sourceRoleId);

      return ownerComparison === 0 ? left.id.localeCompare(right.id) : ownerComparison;
    });

  for (const judgement of judgements) {
    const judgementRole = context.roles.get(judgement.sourceRoleId);
    const ownedContext = scopeRoleContext(context, judgementRole.id);
    const judgementContext: WinnerJudgementContext = {
      ownEndCandidates: context.endCandidates.filter(
        (candidate) => candidate.sourceRoleId === judgementRole.id,
      ),
      ...ownedContext,
    };
    const winnerMatched = judgementRole.evaluateWinnerJudgement(judgement, judgementContext);

    if (winnerMatched) {
      context.roles.getTeam(judgement.winnerTeam);
      return judgement.winnerTeam;
    }
  }

  throw new Error("No winner judgement matched the resolved end candidates.");
}

export function evaluatePlayerResult(context: PlayerResultEvaluationContext): PlayerResult {
  const roleId = context.state.roleByPlayerId.get(context.playerId);

  if (roleId === undefined) {
    throw new Error(`Missing role assignment for player: ${context.playerId}`);
  }

  const role = context.roles.get(roleId);
  const ownedContext = scopeRoleContext(context, role.id);
  const resultContext: PlayerResultContext = {
    ownEndCandidates: context.endCandidates.filter(
      (candidate) => candidate.sourceRoleId === role.id,
    ),
    playerId: context.playerId,
    ...ownedContext,
    winnerTeam: context.winnerTeam,
  };
  const roleResult = role.evaluateResult(resultContext);

  if (roleResult !== null) {
    return roleResult;
  }

  return role.team.id === context.winnerTeam ? PlayerResult.Win : PlayerResult.Lose;
}
