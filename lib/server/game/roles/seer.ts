import "server-only";
import { randomInt } from "node:crypto";

import {
  ActionScope,
  GameActionKind,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  InitialInspectionPolicy,
  InspectionView,
  ResolveTiming,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";
import { SEER_ROLE_ID } from "./roleIds";

import type {
  GameEffect,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type { PlayerRoleContext } from "./base";

export class SeerRole extends Role {
  override readonly description =
    "Inspects one player at night and receives their inspection view.";
  override readonly id: RoleId = SEER_ROLE_ID;
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
}
