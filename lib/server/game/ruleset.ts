import "server-only";
import { DEFAULT_RULE_SET_OPTIONS, isActionKey, isRoleId } from "@/lib/shared/game";
import { isValidRuleSetNumber, RULE_SET_NUMBER_FIELDS } from "@/lib/shared/ruleSetConstraints";

import {
  getRoleIds,
  makeDefaultRoleCounts as makeDefaultRoleCountsFromRoles,
  roleRegistry,
  scopeRoleContext,
} from "./roles";
import { toRegisteredRuleOptions } from "./ruleSetAdapters";
import {
  DayDiscussionMode,
  GameStatus,
  RoleSetupContributionKind,
  VoteResultVisibility,
} from "./types";

import type { RoleContext, RoleRuleValidationIssueCode } from "./roles";
import type {
  NightConversationGroup,
  ReadonlyGameState,
  ResolvedRoleSetup,
  RoleCounts,
  RoleId,
  RuleOptions,
  Team,
} from "./types";

export type RuleSet = {
  options: RuleOptions;
  roleCounts: RoleCounts;
};

export type RuleSetInput = {
  options?: Partial<RuleOptions>;
  roleCounts?: Partial<Record<RoleId, number>>;
};

export type RuleSetValidationIssueCode =
  | "invalid_option"
  | "invalid_role_count"
  | "missing_required_role"
  | RoleRuleValidationIssueCode
  | "player_count_too_large"
  | "player_count_too_small"
  | "role_count_mismatch"
  | "role_incompatible"
  | "role_max_exceeded"
  | "role_min_not_met";

export type RuleSetValidationIssue = {
  code: RuleSetValidationIssueCode;
  message: string;
  roleId?: RoleId;
};

export type RuleSetValidationResult =
  | {
      ok: true;
      resolvedRoleSetup: ResolvedRoleSetup;
      ruleSet: RuleSet;
    }
  | {
      issues: readonly RuleSetValidationIssue[];
      ok: false;
    };

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  ...toRegisteredRuleOptions(DEFAULT_RULE_SET_OPTIONS),
  roleOptions: getDefaultRoleOptions(),
};

export function normalizeRuleSetInput(input: RuleSetInput = {}, playerCount = 0): RuleSet {
  return {
    options: {
      ...DEFAULT_RULE_OPTIONS,
      ...input.options,
      roleOptions: normalizeRoleOptions(input.options?.roleOptions),
    },
    roleCounts: normalizeRoleCounts(input.roleCounts, playerCount),
  };
}

export function makeDefaultRoleCounts(playerCount: number): RoleCounts {
  return makeDefaultRoleCountsFromRoles(playerCount);
}

export function validateRuleSet(ruleSet: RuleSet, playerCount: number): RuleSetValidationResult {
  const issues: RuleSetValidationIssue[] = [];
  const roleIds = getRoleIds();
  const totalRoles = roleIds.reduce(
    (total, roleId) => total + (ruleSet.roleCounts[roleId] ?? 0),
    0,
  );

  validateOptions(ruleSet.options, issues);

  if (playerCount < 3) {
    issues.push({
      code: "player_count_too_small",
      message: "At least three joined players are required.",
    });
  }

  if (playerCount > 10) {
    issues.push({
      code: "player_count_too_large",
      message: "At most ten joined players are supported.",
    });
  }

  if (totalRoles !== playerCount) {
    issues.push({
      code: "role_count_mismatch",
      message: `Role count (${totalRoles}) must match joined player count (${playerCount}).`,
    });
  }

  for (const roleId of roleIds) {
    const role = roleRegistry.get(roleId);
    const count = ruleSet.roleCounts[roleId] ?? 0;

    if (!Number.isInteger(count) || count < 0) {
      issues.push({
        code: "invalid_role_count",
        message: `${role.name} count must be a non-negative integer.`,
        roleId,
      });

      continue;
    }

    if (role.required && count === 0) {
      issues.push({
        code: "missing_required_role",
        message: `${role.name} is required.`,
        roleId,
      });
    }

    if (count < role.minCount) {
      issues.push({
        code: "role_min_not_met",
        message: `${role.name} count must be at least ${role.minCount}.`,
        roleId,
      });
    }

    if (role.maxCount !== null && count > role.maxCount) {
      issues.push({
        code: "role_max_exceeded",
        message: `${role.name} count must be at most ${role.maxCount}.`,
        roleId,
      });
    }

    for (const incompatibleRoleId of role.incompatibleRoleIds) {
      if (count > 0 && (ruleSet.roleCounts[incompatibleRoleId] ?? 0) > 0) {
        issues.push({
          code: "role_incompatible",
          message: `${role.name} cannot be used with ${roleRegistry.get(incompatibleRoleId).name}.`,
          roleId,
        });
      }
    }
  }

  issues.push(
    ...roleRegistry.getAll().flatMap((role) =>
      role.validateRuleSet({
        options: ruleSet.options,
        roleCounts: ruleSet.roleCounts,
        roles: roleRegistry,
      }),
    ),
  );

  if (issues.length > 0) {
    return {
      issues,
      ok: false,
    };
  }

  return {
    ok: true,
    resolvedRoleSetup: resolveRoleSetup(ruleSet),
    ruleSet,
  };
}

export function resolveRoleSetup(ruleSet: RuleSet): ResolvedRoleSetup {
  const activeRoleIds = getRoleIds().filter((roleId) => (ruleSet.roleCounts[roleId] ?? 0) > 0);
  const context = createRoleSetupContext(ruleSet, activeRoleIds);
  const contributionKeys = new Set<string>();
  const contributions = activeRoleIds.flatMap((roleId) => {
    const roleContributions = roleRegistry
      .get(roleId)
      .getSetupContributions(scopeRoleContext(context, roleId));

    for (const contribution of roleContributions) {
      const judgement = contribution.judgement;
      const key = getWinnerJudgementKey(judgement.sourceRoleId, judgement.id);

      if (judgement.sourceRoleId !== roleId) {
        throw new Error(`Role ${roleId} returned a judgement owned by ${judgement.sourceRoleId}.`);
      }

      roleRegistry.getTeam(judgement.winnerTeam);

      if (contributionKeys.has(key)) {
        throw new Error(`Duplicate winner judgement: ${key}`);
      }

      contributionKeys.add(key);
    }

    return roleContributions;
  });

  return {
    activeRoleIds,
    contributions,
    nightConversationGroups: resolveNightConversationGroups(activeRoleIds),
  };
}

export function parseResolvedRoleSetup(value: unknown): ResolvedRoleSetup | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !("activeRoleIds" in value) ||
    !("contributions" in value) ||
    !("nightConversationGroups" in value)
  ) {
    return null;
  }

  const activeRoleIds = parseStringArray(value["activeRoleIds"]);
  const nightConversationGroups = parseNightConversationGroups(value["nightConversationGroups"]);
  const contributions = parseRoleSetupContributions(value["contributions"]);

  if (
    activeRoleIds === null ||
    activeRoleIds.length === 0 ||
    new Set(activeRoleIds).size !== activeRoleIds.length ||
    activeRoleIds.some((roleId) => !getRoleIds().includes(roleId)) ||
    nightConversationGroups === null ||
    contributions === null
  ) {
    return null;
  }

  const activeRoleIdSet = new Set(activeRoleIds);
  const nightConversationGroupIds = nightConversationGroups.map((group) => group.groupId);
  const nightConversationRoleIds = nightConversationGroups.flatMap((group) => group.roleIds);

  if (
    new Set(nightConversationGroupIds).size !== nightConversationGroupIds.length ||
    new Set(nightConversationRoleIds).size !== nightConversationRoleIds.length ||
    nightConversationGroups.some(
      (group) =>
        !/^[a-z][a-z0-9_:-]{0,63}$/u.test(group.groupId) ||
        !isLocalizedText(group.label) ||
        group.roleIds.length === 0 ||
        new Set(group.roleIds).size !== group.roleIds.length ||
        group.roleIds.some((roleId) => !activeRoleIdSet.has(roleId)),
    ) ||
    contributions.some(
      (contribution) =>
        !activeRoleIdSet.has(contribution.judgement.sourceRoleId) ||
        !roleRegistry.getTeams().some((team) => team.id === contribution.judgement.winnerTeam),
    ) ||
    new Set(
      contributions.map((contribution) =>
        getWinnerJudgementKey(contribution.judgement.sourceRoleId, contribution.judgement.id),
      ),
    ).size !== contributions.length
  ) {
    return null;
  }

  return {
    activeRoleIds,
    contributions,
    nightConversationGroups,
  };
}

function parseNightConversationGroups(value: unknown): NightConversationGroup[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const groups: NightConversationGroup[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 3) {
      return null;
    }

    const roleIds = parseStringArray(candidate["roleIds"]);

    if (
      typeof candidate["groupId"] !== "string" ||
      !isLocalizedText(candidate["label"]) ||
      roleIds === null
    ) {
      return null;
    }

    groups.push({
      groupId: candidate["groupId"],
      label: candidate["label"],
      roleIds,
    });
  }

  return groups;
}

function parseRoleSetupContributions(value: unknown): ResolvedRoleSetup["contributions"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const contributions: ResolvedRoleSetup["contributions"][number][] = [];

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).length !== 2 ||
      candidate["kind"] !== RoleSetupContributionKind.WinnerJudgement ||
      !("judgement" in candidate)
    ) {
      return null;
    }

    const judgement = parseWinnerJudgement(candidate["judgement"]);

    if (judgement === null) {
      return null;
    }

    contributions.push({
      judgement,
      kind: RoleSetupContributionKind.WinnerJudgement,
    });
  }

  return contributions;
}

function parseWinnerJudgement(
  value: unknown,
): ResolvedRoleSetup["contributions"][number]["judgement"] | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    !isActionKey(value["id"]) ||
    !Number.isSafeInteger(value["priority"]) ||
    (value["priority"] as number) < -2_147_483_648 ||
    (value["priority"] as number) > 2_147_483_647 ||
    !isRoleId(value["sourceRoleId"]) ||
    !isRegisteredTeam(value["winnerTeam"])
  ) {
    return null;
  }

  return {
    id: value["id"],
    priority: value["priority"] as number,
    sourceRoleId: value["sourceRoleId"],
    winnerTeam: value["winnerTeam"],
  };
}

function parseStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function isRegisteredTeam(value: unknown): value is Team {
  return isRoleId(value) && roleRegistry.getTeams().some((team) => team.id === value);
}

function getWinnerJudgementKey(sourceRoleId: RoleId, judgementId: string): string {
  return JSON.stringify([sourceRoleId, judgementId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalizedText(value: unknown): value is { en: string; ja: string } {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value["en"] === "string" &&
    value["en"].length > 0 &&
    typeof value["ja"] === "string" &&
    value["ja"].length > 0
  );
}

function resolveNightConversationGroups(
  activeRoleIds: readonly RoleId[],
): NightConversationGroup[] {
  const groupsById = new Map<string, NightConversationGroup>();

  for (const roleId of activeRoleIds) {
    const nightConversation = roleRegistry.get(roleId).nightConversation;

    if (nightConversation === null) {
      continue;
    }

    const existingGroup = groupsById.get(nightConversation.groupId);

    if (
      existingGroup !== undefined &&
      JSON.stringify(existingGroup.label) !== JSON.stringify(nightConversation.label)
    ) {
      throw new Error(`Night conversation labels disagree: ${nightConversation.groupId}`);
    }

    groupsById.set(nightConversation.groupId, {
      groupId: nightConversation.groupId,
      label: nightConversation.label,
      roleIds: [...(existingGroup?.roleIds ?? []), roleId],
    });
  }

  return [...groupsById.values()];
}

function normalizeRoleCounts(
  inputRoleCounts: Partial<Record<RoleId, number>> | undefined,
  playerCount: number,
): RoleCounts {
  if (inputRoleCounts === undefined) {
    return makeDefaultRoleCounts(playerCount);
  }

  return Object.fromEntries(
    getRoleIds().map((roleId) => [roleId, inputRoleCounts[roleId] ?? 0]),
  ) as RoleCounts;
}

function getDefaultRoleOptions(): RuleOptions["roleOptions"] {
  return Object.fromEntries(
    roleRegistry.getAll().flatMap((role) => {
      const options = role.getSpecificOptions();

      return options.length === 0
        ? []
        : [
            [
              role.id,
              Object.fromEntries(options.map((option) => [option.key, option.defaultValue])),
            ],
          ];
    }),
  );
}

function normalizeRoleOptions(
  input: RuleOptions["roleOptions"] | undefined,
): RuleOptions["roleOptions"] {
  return Object.fromEntries(
    roleRegistry.getAll().flatMap((role) => {
      const definitions = role.getSpecificOptions();

      return definitions.length === 0
        ? []
        : [
            [
              role.id,
              Object.fromEntries(
                definitions.map((definition) => [
                  definition.key,
                  input?.[role.id]?.[definition.key] ?? definition.defaultValue,
                ]),
              ),
            ],
          ];
    }),
  );
}

function validateOptions(options: RuleOptions, issues: RuleSetValidationIssue[]): void {
  if (!Object.values(DayDiscussionMode).includes(options.dayDiscussionMode)) {
    issues.push({
      code: "invalid_option",
      message: "Day discussion mode must be ready_check or ordered_speech.",
    });
  }

  if (!Object.values(VoteResultVisibility).includes(options.voteResultVisibility)) {
    issues.push({
      code: "invalid_option",
      message: "Vote result visibility must be count_only or voter_to_target.",
    });
  }

  const numericOptions = getPositiveIntegerOptions(options);

  for (const field of RULE_SET_NUMBER_FIELDS) {
    if (!isValidRuleSetNumber(field, numericOptions[field])) {
      issues.push({
        code: "invalid_option",
        message: `${field} is outside the supported range.`,
      });
    }
  }

  validateRoleOptions(options.roleOptions, issues);
}

function validateRoleOptions(
  values: RuleOptions["roleOptions"],
  issues: RuleSetValidationIssue[],
): void {
  const rolesWithOptions = roleRegistry
    .getAll()
    .filter((role) => role.getSpecificOptions().length > 0);
  const expectedRoleIds = rolesWithOptions.map((role) => role.id);
  const actualRoleIds = Object.keys(values);

  if (
    actualRoleIds.length !== expectedRoleIds.length ||
    actualRoleIds.some((roleId) => !expectedRoleIds.includes(roleId))
  ) {
    issues.push({ code: "invalid_option", message: "Role option owners are invalid." });
    return;
  }

  for (const role of rolesWithOptions) {
    const definitions = role.getSpecificOptions();
    const roleValues = values[role.id];

    if (
      roleValues === undefined ||
      Object.keys(roleValues).length !== definitions.length ||
      Object.keys(roleValues).some(
        (optionKey) => !definitions.some((definition) => definition.key === optionKey),
      )
    ) {
      issues.push({
        code: "invalid_option",
        message: `${role.name} options are invalid.`,
        roleId: role.id,
      });
      continue;
    }

    for (const definition of definitions) {
      const value = roleValues[definition.key];

      if (!definition.choices.some((choice) => choice.value === value)) {
        issues.push({
          code: "invalid_option",
          message: `${role.name} option ${definition.key} is invalid.`,
          roleId: role.id,
        });
      }
    }
  }
}

function getPositiveIntegerOptions(options: RuleOptions): Readonly<Record<string, number>> {
  return {
    dayReadyCheckSecondsPerPlayer: options.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: options.daySpeechSeconds,
    executionLastWordsSeconds: options.executionLastWordsSeconds,
    firstDaySpeechRounds: options.firstDaySpeechRounds,
    firstNightSeconds: options.firstNightSeconds,
    nightSeconds: options.nightSeconds,
    normalDaySpeechRounds: options.normalDaySpeechRounds,
    votingSeconds: options.votingSeconds,
  };
}

export function createEmptyGameStateForRuleSet(
  ruleSet: RuleSet,
  activeRoleIds: readonly RoleId[],
): ReadonlyGameState {
  return {
    alivePlayerIds: [],
    currentActions: [],
    finalOutcome: null,
    nightNumber: 0,
    pendingActions: [],
    phase: null,
    phaseInstanceId: null,
    resolvedActions: [],
    resolvedRoleSetup: {
      activeRoleIds,
      contributions: [],
      nightConversationGroups: [],
    },
    roleByPlayerId: new Map(),
    ruleOptions: ruleSet.options,
    status: GameStatus.AssigningRoles,
    nightConversationMessages: [],
  };
}

function createRoleSetupContext(ruleSet: RuleSet, activeRoleIds: readonly RoleId[]): RoleContext {
  return {
    roles: roleRegistry,
    state: createEmptyGameStateForRuleSet(ruleSet, activeRoleIds),
  };
}
