import "server-only";
import { randomInt } from "node:crypto";

import {
  ActionScope,
  GameActionKind,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  GameStatus,
  InitialInspectionPolicy,
  InspectionView,
  ResolveTiming,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";

import type {
  GameEffect,
  ReadonlyGameState,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type {
  InspectionContext,
  PlayerRoleContext,
  RoleRuleValidationContext,
  RoleRuleValidationIssue,
} from "./base";

export class SeerRole extends Role {
  override readonly description =
    "Inspects one player at night and receives their inspection view.";
  override readonly id: RoleId = "seer";
  override readonly maxCount = 1;
  override readonly name = "Seer";
  override readonly order = 30;
  override readonly shortLabel = "Se";
  override readonly team = Team.Village;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 4 ? 1 : 0;
  }

  override getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [
      {
        key: "initialInspectionPolicy",
        label: "Initial inspection",
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
        kind: GameActionKind.Inspect,
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

  override validateRuleSet(context: RoleRuleValidationContext): readonly RoleRuleValidationIssue[] {
    if (
      context.options.initialInspectionPolicy !== InitialInspectionPolicy.Enabled ||
      (context.roleCounts[this.id] ?? 0) <= 0 ||
      this.hasInitialInspectionHumanCandidate(context)
    ) {
      return [];
    }

    return [
      {
        code: "role:seer:no_initial_inspection_candidate",
        message: "Initial inspection requires at least one non-seer human inspection candidate.",
        roleId: this.id,
      },
    ];
  }

  override onFirstNightStarted(context: PlayerRoleContext): readonly GameEffect[] {
    if (context.state.ruleOptions.initialInspectionPolicy !== InitialInspectionPolicy.Enabled) {
      return [];
    }

    const candidateIds = context.state.alivePlayerIds.filter((playerId) => {
      if (playerId === context.playerId) {
        return false;
      }

      const roleId = context.state.roleByPlayerId.get(playerId);

      if (roleId === undefined) {
        return false;
      }

      const role = context.roles.get(roleId);

      return (
        role.seenAs({
          ...context,
          targetId: playerId,
          viewerId: context.playerId,
        }) === InspectionView.Human
      );
    });
    if (candidateIds.length === 0) {
      return [];
    }

    const targetId = candidateIds[randomInt(candidateIds.length)];

    return [
      {
        emitterRoleId: this.id,
        id: `initial-inspection:${context.playerId}:${targetId}`,
        kind: GameEffectKind.PrivateMessage,
        layer: GameEffectLayer.Information,
        messageKey: "initial_inspection",
        payload: {
          result: "human",
          targetPlayerId: targetId,
        },
        playerId: context.playerId,
        priority: 100,
        sourceActionId: null,
        tags: [],
      },
    ];
  }

  private hasInitialInspectionHumanCandidate(context: RoleRuleValidationContext): boolean {
    return context.roles.getAll().some((role) => {
      if (role.id === this.id || (context.roleCounts[role.id] ?? 0) <= 0) {
        return false;
      }

      return (
        role.seenAs(createInspectionCandidateContext(context, this.id, role.id)) ===
        InspectionView.Human
      );
    });
  }
}

function createInspectionCandidateContext(
  context: RoleRuleValidationContext,
  viewerRoleId: RoleId,
  roleId: RoleId,
): InspectionContext {
  return {
    roles: context.roles,
    state: createInspectionCandidateState(context, viewerRoleId, roleId),
    targetId: "candidate",
    viewerId: "viewer",
  };
}

function createInspectionCandidateState(
  context: RoleRuleValidationContext,
  viewerRoleId: RoleId,
  roleId: RoleId,
): ReadonlyGameState {
  return {
    alivePlayerIds: ["viewer", "candidate"],
    currentActions: [],
    events: [],
    finalOutcome: null,
    nightConversationMessages: [],
    nightNumber: 1,
    pendingActions: [],
    phase: GamePhase.Night,
    phaseInstanceId: "setup",
    resolvedRoleSetup: {
      activeRoleIds: [...new Set([viewerRoleId, roleId])],
      contributions: [],
      nightConversationGroups: [],
      winnerJudgements: [],
    },
    roleByPlayerId: new Map([
      ["viewer", viewerRoleId],
      ["candidate", roleId],
    ]),
    ruleOptions: context.options,
    status: GameStatus.Playing,
  };
}
