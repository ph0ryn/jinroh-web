import "server-only";
import { RoleRegistry } from "./roles/base";
import { FoxRole } from "./roles/fox";
import { GuardRole } from "./roles/guard";
import { HunterRole } from "./roles/hunter";
import { MadmanRole } from "./roles/madman";
import { SEER_ROLE_ID } from "./roles/roleIds";
import { SeerRole } from "./roles/seer";
import { SpiritistRole } from "./roles/spiritist";
import { VillagerRole } from "./roles/villager";
import { WerewolfRole } from "./roles/werewolf";
import {
  DayDiscussionMode,
  GameEndReason,
  GamePhase,
  GameStatus,
  GuardConsecutiveTargetPolicy,
  InitialInspectionPolicy,
  InspectionView,
  PlayerResult,
  ROLE_IDS,
  RoleSetupContributionKind,
  Team,
  VoteResultVisibility,
} from "./types";

import type { InspectionContext, PlayerResultContext, WinnerJudgementContext } from "./roles/base";
import type { RoleId, RoleSetupContribution, WinnerJudgementContribution } from "./types";

export { ROLE_REGISTRY_VERSION, Role, RoleRegistry } from "./roles/base";
export type {
  AttackContext,
  ExecutionContext,
  InspectionContext,
  PlayerResultContext,
  PlayerRoleContext,
  RoleContext,
  WinnerJudgementContext,
} from "./roles/base";
export { FoxRole } from "./roles/fox";
export { GuardRole } from "./roles/guard";
export { HunterRole } from "./roles/hunter";
export { isGuardTargetAllowed } from "./roles/guardTarget";
export { countAliveByGroup } from "./roles/helpers";
export { MadmanRole } from "./roles/madman";
export { createGuardProtectionEffect } from "./roles/roleEffects";
export { SeerRole } from "./roles/seer";
export { SpiritistRole } from "./roles/spiritist";
export { VillagerRole } from "./roles/villager";
export { WerewolfRole } from "./roles/werewolf";

export const roleRegistry = new RoleRegistry([
  new WerewolfRole(),
  new VillagerRole(),
  new MadmanRole(),
  new SeerRole(),
  new GuardRole(),
  new SpiritistRole(),
  new HunterRole(),
  new FoxRole(),
]);

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

export function hasInitialInspectionHumanCandidate(params: {
  roleCounts: Readonly<Record<RoleId, number>>;
  seerCount: number;
}): boolean {
  if (params.seerCount <= 0) {
    return true;
  }

  return ROLE_IDS.some((roleId) => {
    if (roleId === SEER_ROLE_ID || params.roleCounts[roleId] <= 0) {
      return false;
    }

    const role = roleRegistry.get(roleId);

    return role.seenAs(createInspectionCandidateContext(roleId)) === InspectionView.Human;
  });
}

function createInspectionCandidateContext(roleId: RoleId): InspectionContext {
  return {
    roles: roleRegistry,
    state: {
      alivePlayerIds: ["candidate"],
      currentActions: [],
      events: [],
      finalOutcome: null,
      nightNumber: 1,
      pendingActions: [],
      phase: GamePhase.Night,
      phaseInstanceId: "setup",
      resolvedRoleSetup: {
        activeRoleIds: [roleId],
        contributions: [],
        nightConversationGroups: [],
        winnerJudgements: [],
      },
      roleByPlayerId: new Map([["candidate", roleId]]),
      ruleOptions: {
        dayDiscussionMode: DayDiscussionMode.ReadyCheck,
        dayReadyCheckSecondsPerPlayer: 90,
        daySpeechSeconds: 90,
        executionLastWordsSeconds: 60,
        firstDaySpeechRounds: 2,
        firstNightSeconds: 30,
        guardConsecutiveTargetPolicy: GuardConsecutiveTargetPolicy.DenySameTarget,
        initialInspectionPolicy: InitialInspectionPolicy.Enabled,
        nightSeconds: 180,
        normalDaySpeechRounds: 1,
        voteResultVisibility: VoteResultVisibility.CountOnly,
        votingSeconds: 30,
      },
      status: GameStatus.Playing,
      nightConversationMessages: [],
    },
    targetId: "candidate",
    viewerId: "seer",
  };
}
