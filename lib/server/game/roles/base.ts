import "server-only";
import { CountGroup, DeathReason, EffectTag, InspectionView, RoleTargetKind } from "../types";
import { createDeathEffect } from "./roleEffects";

import type {
  CurrentAction,
  GameEffect,
  GameActionKind,
  GameEndCandidate,
  GameEndReason,
  PlayerResult,
  PlayerId,
  ReadonlyGameState,
  ResolvedDeath,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleNightConversationDefinition,
  RolePublicMetadata,
  RoleSetupContribution,
  RoleSpecificOptionDefinition,
  Team,
  WinnerJudgementContribution,
} from "../types";

export const ROLE_REGISTRY_VERSION = "jinroh-core-v2";

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

export type ExecutionResolvedContext = RoleContext & {
  targetId: PlayerId;
  targetRoleId: RoleId;
};

export type DeathResolvedContext = RoleContext & {
  death: ResolvedDeath;
};

export type RoleActionResolvedContext = RoleContext & {
  actionKind: GameActionKind;
  actorId: PlayerId;
  targetId: PlayerId | null;
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
  readonly order: number = 1000;
  readonly required: boolean = false;
  readonly shortLabel: string = "?";

  getPublicMetadata(): RolePublicMetadata {
    return {
      description: this.description,
      id: this.id,
      maxCount: this.maxCount,
      minCount: this.minCount,
      name: this.name,
      order: this.order,
      shortLabel: this.shortLabel,
      team: this.team,
    };
  }

  getDefaultCount(context: RoleDefaultCountContext): number {
    void context;

    return 0;
  }

  getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [];
  }

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

  getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly PlayerId[] {
    if (action.target === RoleTargetKind.None) {
      return [];
    }

    return context.state.alivePlayerIds.filter((playerId) => playerId !== context.playerId);
  }

  getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [];
  }

  onInspected(context: InspectionContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onFirstNightStarted(context: PlayerRoleContext): readonly GameEffect[] {
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

  onExecutionResolved(context: ExecutionResolvedContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onDeathResolved(context: DeathResolvedContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    void context;

    return [];
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

  readonly #roles: readonly Role[];

  readonly #rolesById: ReadonlyMap<RoleId, Role>;

  constructor(roles: readonly Role[]) {
    const roleIds = roles.map((role) => role.id);
    const uniqueRoleIds = new Set(roleIds);

    if (roleIds.length !== uniqueRoleIds.size) {
      throw new Error("Duplicate role ids are not allowed.");
    }

    this.#roles = [...roles].sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.id.localeCompare(right.id);
    });
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
    return this.#roles;
  }

  getActiveRoles(state: ReadonlyGameState): readonly Role[] {
    return state.resolvedRoleSetup.activeRoleIds.map((roleId) => this.get(roleId));
  }
}
