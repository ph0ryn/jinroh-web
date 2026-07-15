import "server-only";
import { isActionKind, isRoleId } from "@/lib/shared/game";

import {
  ActionTargetStateRequirement,
  CountGroup,
  DEATH_REASON,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  InspectionView,
  RoleTargetKind,
} from "../types";

import type {
  AvailableRoleAction,
  CurrentAction,
  DeathReason,
  EffectTag,
  FirstNightStartedEffect,
  GameEffect,
  GameActionKind,
  GameEndCandidate,
  PlayerResult,
  PlayerId,
  ReadonlyGameState,
  ResolvedDeath,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleNightConversationDefinition,
  RolePublicMetadata,
  RoleTeamDefinition,
  RoleCounts,
  RuleOptions,
  RoleSetupContribution,
  RoleSpecificOptionDefinition,
  Team,
  WinnerJudgementContribution,
} from "../types";
import type { RolePresentation } from "@/lib/shared/game";

export const ROLE_REGISTRY_VERSION_PREFIX = "jinroh-role-registry-v1";

const FULL_ROLE_STATE = Symbol("fullRoleState");

export type RoleContext = {
  readonly [FULL_ROLE_STATE]?: ReadonlyGameState;
  roles: RoleRegistry;
  state: ReadonlyGameState;
};

export function scopeRoleContext(context: RoleContext, roleId: RoleId): RoleContext {
  const fullState = context[FULL_ROLE_STATE] ?? context.state;
  const currentActions = fullState.currentActions.filter(
    (action) => action.resolverRoleId === null || action.resolverRoleId === roleId,
  );
  const visibleCurrentActionIds = new Set(currentActions.map((action) => action.id));

  return {
    [FULL_ROLE_STATE]: fullState,
    roles: context.roles,
    state: {
      ...fullState,
      currentActions,
      pendingActions: fullState.pendingActions.filter((action) =>
        visibleCurrentActionIds.has(action.currentActionId),
      ),
      resolvedActions: fullState.resolvedActions.filter(
        (action) => action.resolverRoleId === roleId,
      ),
    },
  };
}

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
  actorRoleId: RoleId;
  targetId: PlayerId | null;
};

export type WinnerJudgementContext = RoleContext & {
  ownEndCandidates: readonly GameEndCandidate[];
};

export type PlayerResultContext = PlayerRoleContext & {
  ownEndCandidates: readonly GameEndCandidate[];
  winnerTeam: Team;
};

export type RoleRuleValidationIssueCode = `role:${string}`;

export type RoleRuleValidationIssue = {
  code: RoleRuleValidationIssueCode;
  message: string;
  roleId?: RoleId;
};

export type RoleRuleValidationContext = {
  options: RuleOptions;
  roleCounts: RoleCounts;
  roles: RoleRegistry;
};

export abstract class Role {
  abstract readonly id: RoleId;
  abstract readonly presentation: RolePresentation;
  abstract readonly team: RoleTeamDefinition;

  readonly actionDefinitions: readonly RoleActionDefinition[] = [];
  readonly incompatibleRoleIds: readonly RoleId[] = [];
  readonly maxCount: number | null = null;
  readonly minCount: number = 0;
  readonly nightConversation: RoleNightConversationDefinition | null = null;
  readonly order: number = 1000;
  readonly required: boolean = false;
  readonly version: number = 1;

  get description(): string {
    return this.presentation.en.description;
  }

  get name(): string {
    return this.presentation.en.name;
  }

  get shortLabel(): string {
    return this.presentation.en.shortLabel;
  }

  getPublicMetadata(): RolePublicMetadata {
    return {
      id: this.id,
      maxCount: this.maxCount,
      minCount: this.minCount,
      order: this.order,
      presentation: this.presentation,
      specificOptions: this.getSpecificOptions(),
    };
  }

  getDefaultCount(context: RoleDefaultCountContext): number {
    void context;

    return 0;
  }

  getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [];
  }

  protected getOptionValue(options: RuleOptions, optionKey: string): string {
    const definition = this.getSpecificOptions().find((option) => option.key === optionKey);

    if (definition === undefined) {
      throw new Error(`Unknown option for ${this.id}: ${optionKey}`);
    }

    return options.roleOptions[this.id]?.[optionKey] ?? definition.defaultValue;
  }

  countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.NonWerewolf;
  }

  seenAs(context: InspectionContext): InspectionView {
    void context;

    return InspectionView.Human;
  }

  getActions(context: PlayerRoleContext): readonly AvailableRoleAction[] {
    void context;

    return [];
  }

  getActionDefinition(actionKind: GameActionKind): RoleActionDefinition {
    const definition = this.actionDefinitions.find((action) => action.kind === actionKind);

    if (definition === undefined) {
      throw new Error(`Role ${this.id} does not define action: ${actionKind}`);
    }

    return definition;
  }

  protected createAvailableAction(
    actionKind: GameActionKind,
    roleGroupRoleId: RoleId | null,
  ): AvailableRoleAction {
    const definition = this.getActionDefinition(actionKind);

    return {
      kind: definition.kind,
      roleGroupRoleId,
      target: definition.target,
      targetStateRequirement: definition.targetStateRequirement,
    };
  }

  protected createCurrentActionEffect(
    params: Omit<
      Extract<GameEffect, { kind: GameEffectKind.CurrentAction }>,
      | "actionKind"
      | "emitterRoleId"
      | "kind"
      | "resolverRoleId"
      | "target"
      | "targetStateRequirement"
    > & {
      actionKind: GameActionKind;
    },
  ): Extract<GameEffect, { kind: GameEffectKind.CurrentAction }> {
    const definition = this.getActionDefinition(params.actionKind);

    return {
      ...params,
      actionKind: definition.kind,
      emitterRoleId: this.id,
      kind: GameEffectKind.CurrentAction,
      resolverRoleId: this.id,
      target: definition.target,
      targetStateRequirement: definition.targetStateRequirement,
    };
  }

  getEligibleTargets(action: AvailableRoleAction, context: PlayerRoleContext): readonly PlayerId[] {
    if (action.target === RoleTargetKind.None) {
      return [];
    }

    return context.state.alivePlayerIds.filter((playerId) => playerId !== context.playerId);
  }

  getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [];
  }

  validateRuleSet(context: RoleRuleValidationContext): readonly RoleRuleValidationIssue[] {
    void context;

    return [];
  }

  onInspected(context: InspectionContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onFirstNightStarted(context: PlayerRoleContext): readonly FirstNightStartedEffect[] {
    void context;

    return [];
  }

  onAttacked(context: AttackContext): readonly GameEffect[] {
    return [
      this.createDeathEffect({
        id: `death:attack:${context.targetId}`,
        playerId: context.targetId,
        reason: DEATH_REASON.Attack,
        tags: [EFFECT_TAG.Attack, EFFECT_TAG.Guardable],
      }),
    ];
  }

  onExecuted(context: ExecutionContext): readonly GameEffect[] {
    return [
      this.createDeathEffect({
        id: `death:execution:${context.targetId}`,
        playerId: context.targetId,
        reason: DEATH_REASON.Execution,
        tags: [EFFECT_TAG.Execution, EFFECT_TAG.Unpreventable],
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

  protected createDeathEffect(params: {
    id: string;
    playerId: PlayerId;
    reason: DeathReason;
    tags: readonly EffectTag[];
  }): GameEffect {
    return {
      emitterRoleId: this.id,
      id: params.id,
      kind: GameEffectKind.Death,
      layer: GameEffectLayer.Death,
      playerId: params.playerId,
      priority: 100,
      reason: params.reason,
      sourceActionId: null,
      tags: params.tags,
    };
  }
}

export class RoleRegistry {
  readonly version: string;

  readonly #roles: readonly Role[];

  readonly #rolesById: ReadonlyMap<RoleId, Role>;

  readonly #teams: readonly RoleTeamDefinition[];

  readonly #teamsById: ReadonlyMap<string, RoleTeamDefinition>;

  constructor(roles: readonly Role[]) {
    const roleIds = roles.map((role) => role.id);
    const uniqueRoleIds = new Set(roleIds);

    if (roleIds.length !== uniqueRoleIds.size) {
      throw new Error("Duplicate role ids are not allowed.");
    }

    for (const role of roles) {
      validateRoleDefinition(role);
    }

    const teamsById = new Map<string, RoleTeamDefinition>();

    for (const role of roles) {
      const existingTeam = teamsById.get(role.team.id);

      if (
        existingTeam !== undefined &&
        (existingTeam.presentation.en !== role.team.presentation.en ||
          existingTeam.presentation.ja !== role.team.presentation.ja)
      ) {
        throw new Error(`Team presentations disagree: ${role.team.id}`);
      }

      teamsById.set(role.team.id, role.team);
    }

    this.#roles = [...roles].sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.id.localeCompare(right.id);
    });
    this.#rolesById = new Map(roles.map((role) => [role.id, role]));
    this.#teams = [...teamsById.values()].toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );
    this.#teamsById = teamsById;
    this.version = createRegistryVersion(this.#roles);
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

  getTeam(teamId: string): RoleTeamDefinition {
    const team = this.#teamsById.get(teamId);

    if (team === undefined) {
      throw new Error(`Unknown team: ${teamId}`);
    }

    return team;
  }

  getTeams(): readonly RoleTeamDefinition[] {
    return this.#teams;
  }

  getActiveRoles(state: ReadonlyGameState): readonly Role[] {
    return state.resolvedRoleSetup.activeRoleIds.map((roleId) => this.get(roleId));
  }
}

function validateRoleDefinition(role: Role): void {
  if (!isRoleId(role.id)) {
    throw new Error("Invalid role id.");
  }

  if (!isRoleId(role.team.id) || !isLocalizedTextValid(role.team.presentation)) {
    throw new Error(`Invalid role team: ${role.id}`);
  }

  if (!Number.isSafeInteger(role.version) || role.version < 1) {
    throw new Error(`Invalid role version: ${role.id}`);
  }

  if (
    !isRolePresentationTextValid(role.presentation.en) ||
    !isRolePresentationTextValid(role.presentation.ja)
  ) {
    throw new Error(`Invalid role presentation: ${role.id}`);
  }

  const actionKinds = role.actionDefinitions.map((action) => action.kind);

  if (new Set(actionKinds).size !== actionKinds.length) {
    throw new Error(`Duplicate role action kinds: ${role.id}`);
  }

  for (const action of role.actionDefinitions) {
    if (!isRoleActionDefinitionValid(action)) {
      throw new Error(`Invalid role action definition: ${role.id}:${action.kind}`);
    }
  }

  if (
    role.nightConversation !== null &&
    (!/^[a-z][a-z0-9_:-]{0,63}$/u.test(role.nightConversation.groupId) ||
      !isLocalizedTextValid(role.nightConversation.label))
  ) {
    throw new Error(`Invalid night conversation definition: ${role.id}`);
  }

  const options = role.getSpecificOptions();
  const optionKeys = options.map((option) => option.key);

  if (new Set(optionKeys).size !== optionKeys.length) {
    throw new Error(`Duplicate role option keys: ${role.id}`);
  }

  for (const option of options) {
    const values = option.choices.map((choice) => choice.value);

    if (
      !/^[a-z][a-z0-9_]{0,63}$/u.test(option.key) ||
      !isLocalizedTextValid(option.label) ||
      values.length === 0 ||
      new Set(values).size !== values.length ||
      !values.includes(option.defaultValue) ||
      option.choices.some(
        (choice) =>
          !/^[a-z][a-z0-9_]{0,63}$/u.test(choice.value) || !isLocalizedTextValid(choice.label),
      )
    ) {
      throw new Error(`Invalid role option definition: ${role.id}:${option.key}`);
    }
  }
}

function isLocalizedTextValid(text: { en: string; ja: string }): boolean {
  return text.en.trim().length > 0 && text.ja.trim().length > 0;
}

function isRolePresentationTextValid(text: {
  description: string;
  name: string;
  shortLabel: string;
}): boolean {
  return (
    text.description.trim().length > 0 &&
    text.name.trim().length > 0 &&
    text.shortLabel.trim().length > 0
  );
}

function isRoleActionDefinitionValid(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const target = value["target"];

  return (
    isActionKind(value["kind"]) &&
    (target === RoleTargetKind.None || target === RoleTargetKind.SinglePlayer) &&
    (value["targetStateRequirement"] === ActionTargetStateRequirement.Alive ||
      value["targetStateRequirement"] === ActionTargetStateRequirement.Assigned) &&
    isActionPresentationValid(value["presentation"], target)
  );
}

function isActionPresentationValid(value: unknown, target: RoleTargetKind): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return ["en", "ja"].every((locale) => {
    const text = value[locale];

    if (
      !isRecord(text) ||
      !isNonEmptyString(text["label"]) ||
      !isNonEmptyString(text["submitLabel"]) ||
      !isNonEmptyString(text["submittedMessage"])
    ) {
      return false;
    }

    if (target === RoleTargetKind.None) {
      return !("targetConfirmation" in text);
    }

    const confirmation = text["targetConfirmation"];

    return (
      isRecord(confirmation) &&
      typeof confirmation["afterTarget"] === "string" &&
      typeof confirmation["beforeTarget"] === "string" &&
      `${confirmation["beforeTarget"]}${confirmation["afterTarget"]}`.trim().length > 0
    );
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRegistryVersion(roles: readonly Role[]): string {
  const manifest = JSON.stringify(
    roles.map((role) => ({
      actions: role.actionDefinitions,
      metadata: role.getPublicMetadata(),
      nightConversation: role.nightConversation,
      team: role.team,
      version: role.version,
    })),
  );
  let hash = 2166136261;

  for (const character of manifest) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return `${ROLE_REGISTRY_VERSION_PREFIX}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
