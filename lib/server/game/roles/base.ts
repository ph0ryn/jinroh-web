import "server-only";
import { CountGroup, DeathReason, EffectTag, InspectionView, ROLE_IDS } from "../types";
import { createDeathEffect } from "./roleEffects";

import type {
  CurrentAction,
  GameEffect,
  GameEndCandidate,
  GameEndReason,
  PlayerResult,
  PlayerId,
  ReadonlyGameState,
  RoleActionDefinition,
  RoleId,
  RoleNightConversationDefinition,
  RoleSetupContribution,
  Team,
  WinnerJudgementContribution,
} from "../types";

export const ROLE_REGISTRY_VERSION = "jinroh-core-v1";

export type RoleContext = {
  roles: RoleRegistry;
  state: ReadonlyGameState;
};

export type PlayerRoleContext = RoleContext & {
  playerId: PlayerId;
};

export type InspectionContext = RoleContext & {
  targetId: PlayerId;
  viewerId: PlayerId;
};

export type AttackContext = RoleContext & {
  attackerIds: readonly PlayerId[];
  targetId: PlayerId;
};

export type ExecutionContext = RoleContext & {
  targetId: PlayerId;
};

export type WinnerJudgementContext = RoleContext & {
  endReasons: readonly GameEndReason[];
};

export type PlayerResultContext = PlayerRoleContext & {
  endReasons: readonly GameEndReason[];
  winnerTeam: Team;
};

export abstract class Role {
  abstract readonly description: string;
  abstract readonly id: RoleId;
  abstract readonly name: string;
  abstract readonly team: Team;

  readonly incompatibleRoleIds: readonly RoleId[] = [];
  readonly maxCount: number | null = null;
  readonly minCount: number = 0;
  readonly nightConversation: RoleNightConversationDefinition | null = null;
  readonly required: boolean = false;

  countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.NonWerewolf;
  }

  seenAs(context: InspectionContext): InspectionView {
    void context;

    return InspectionView.Human;
  }

  getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    void context;

    return [];
  }

  getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [];
  }

  onInspected(context: InspectionContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onAttacked(context: AttackContext): readonly GameEffect[] {
    return [
      createDeathEffect({
        emitterRoleId: this.id,
        id: `death:attack:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.Attack,
        tags: [EffectTag.Attack, EffectTag.Guardable],
      }),
    ];
  }

  onExecuted(context: ExecutionContext): readonly GameEffect[] {
    return [
      createDeathEffect({
        emitterRoleId: this.id,
        id: `death:execution:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.Execution,
        tags: [EffectTag.Execution, EffectTag.Unpreventable],
      }),
    ];
  }

  onMissingAction(currentAction: CurrentAction, context: RoleContext): readonly GameEffect[] {
    void currentAction;
    void context;

    return [];
  }

  checkEndCondition(context: RoleContext): GameEndCandidate | null {
    void context;

    return null;
  }

  evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    void judgement;
    void context;

    return false;
  }

  evaluateResult(context: PlayerResultContext): PlayerResult | null {
    void context;

    return null;
  }
}

export class RoleRegistry {
  readonly version = ROLE_REGISTRY_VERSION;

  readonly #rolesById: ReadonlyMap<RoleId, Role>;

  constructor(roles: readonly Role[]) {
    this.#rolesById = new Map(roles.map((role) => [role.id, role]));
  }

  get(roleId: RoleId): Role {
    const role = this.#rolesById.get(roleId);

    if (role === undefined) {
      throw new Error(`Unknown role: ${roleId}`);
    }

    return role;
  }

  getAll(): readonly Role[] {
    return ROLE_IDS.map((roleId) => this.get(roleId));
  }

  getActiveRoles(state: ReadonlyGameState): readonly Role[] {
    return state.resolvedRoleSetup.activeRoleIds.map((roleId) => this.get(roleId));
  }
}
