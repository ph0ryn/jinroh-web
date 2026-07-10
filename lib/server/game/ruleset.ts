import "server-only";
import { isValidRuleSetNumber, RULE_SET_NUMBER_FIELDS } from "@/lib/shared/ruleSetConstraints";

import {
  getCoreSetupContributions,
  getRoleIds,
  makeDefaultRoleCounts as makeDefaultRoleCountsFromRoles,
  roleRegistry,
} from "./roles";
import {
  DayDiscussionMode,
  GameStatus,
  GuardConsecutiveTargetPolicy,
  InitialInspectionPolicy,
  RoleSetupContributionKind,
  Team,
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
} from "./types";

export const ENGINE_VERSION = "jinroh-engine-v1";

export type RuleSet = {
  engineVersion: string;
  options: RuleOptions;
  roleCounts: RoleCounts;
  roleRegistryVersion: string;
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
};

export function normalizeRuleSetInput(input: RuleSetInput = {}, playerCount = 0): RuleSet {
  return {
    engineVersion: ENGINE_VERSION,
    options: {
      ...DEFAULT_RULE_OPTIONS,
      ...input.options,
    },
    roleCounts: normalizeRoleCounts(input.roleCounts, playerCount),
    roleRegistryVersion: roleRegistry.version,
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
  const contributions = [
    ...getCoreSetupContributions(),
    ...activeRoleIds.flatMap((roleId) => roleRegistry.get(roleId).getSetupContributions(context)),
  ];

  return {
    activeRoleIds,
    contributions,
    nightConversationGroups: resolveNightConversationGroups(activeRoleIds),
    winnerJudgements: contributions.map((contribution) => contribution.judgement),
  };
}

export function parseResolvedRoleSetup(value: unknown): ResolvedRoleSetup | null {
  if (!isRecord(value)) {
    return null;
  }

  const activeRoleIds = parseStringArray(value["activeRoleIds"]);
  const nightConversationGroups = parseNightConversationGroups(value["nightConversationGroups"]);
  const winnerJudgements = parseWinnerJudgements(value["winnerJudgements"]);
  const contributions = parseRoleSetupContributions(value["contributions"]);

  if (
    activeRoleIds === null ||
    activeRoleIds.length === 0 ||
    new Set(activeRoleIds).size !== activeRoleIds.length ||
    activeRoleIds.some((roleId) => !getRoleIds().includes(roleId)) ||
    nightConversationGroups === null ||
    winnerJudgements === null ||
    contributions === null
  ) {
    return null;
  }

  const activeRoleIdSet = new Set(activeRoleIds);

  if (
    nightConversationGroups.some(
      (group) =>
        group.groupId.length === 0 ||
        group.labelKey.length === 0 ||
        group.roleIds.length === 0 ||
        new Set(group.roleIds).size !== group.roleIds.length ||
        group.roleIds.some((roleId) => !activeRoleIdSet.has(roleId)),
    ) ||
    winnerJudgements.some(
      (judgement) =>
        judgement.sourceRoleId !== null && !activeRoleIdSet.has(judgement.sourceRoleId),
    ) ||
    new Set(winnerJudgements.map((judgement) => judgement.id)).size !== winnerJudgements.length ||
    JSON.stringify(contributions.map((contribution) => contribution.judgement)) !==
      JSON.stringify(winnerJudgements)
  ) {
    return null;
  }

  return {
    activeRoleIds,
    contributions,
    nightConversationGroups,
    winnerJudgements,
  };
}

function parseNightConversationGroups(value: unknown): NightConversationGroup[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const groups: NightConversationGroup[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      return null;
    }

    const roleIds = parseStringArray(candidate["roleIds"]);

    if (
      typeof candidate["groupId"] !== "string" ||
      typeof candidate["labelKey"] !== "string" ||
      roleIds === null
    ) {
      return null;
    }

    groups.push({
      groupId: candidate["groupId"],
      labelKey: candidate["labelKey"],
      roleIds,
    });
  }

  return groups;
}

function parseWinnerJudgements(value: unknown): ResolvedRoleSetup["winnerJudgements"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const judgements: ResolvedRoleSetup["winnerJudgements"][number][] = [];

  for (const candidate of value) {
    const judgement = parseWinnerJudgement(candidate);

    if (judgement === null) {
      return null;
    }

    judgements.push(judgement);
  }

  return judgements;
}

function parseRoleSetupContributions(value: unknown): ResolvedRoleSetup["contributions"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const contributions: ResolvedRoleSetup["contributions"][number][] = [];

  for (const candidate of value) {
    if (!isRecord(candidate) || candidate["kind"] !== RoleSetupContributionKind.WinnerJudgement) {
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
): ResolvedRoleSetup["winnerJudgements"][number] | null {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    !Number.isSafeInteger(value["priority"]) ||
    (value["sourceRoleId"] !== null && typeof value["sourceRoleId"] !== "string") ||
    !isTeam(value["winnerTeam"])
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

function isTeam(value: unknown): value is Team {
  return Object.values(Team).some((team) => team === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

    groupsById.set(nightConversation.groupId, {
      groupId: nightConversation.groupId,
      labelKey: nightConversation.labelKey,
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

function validateOptions(options: RuleOptions, issues: RuleSetValidationIssue[]): void {
  if (!Object.values(DayDiscussionMode).includes(options.dayDiscussionMode)) {
    issues.push({
      code: "invalid_option",
      message: "Day discussion mode must be ready_check or ordered_speech.",
    });
  }

  if (!Object.values(InitialInspectionPolicy).includes(options.initialInspectionPolicy)) {
    issues.push({
      code: "invalid_option",
      message: "Initial inspection policy must be enabled or disabled.",
    });
  }

  if (!Object.values(GuardConsecutiveTargetPolicy).includes(options.guardConsecutiveTargetPolicy)) {
    issues.push({
      code: "invalid_option",
      message: "Guard consecutive target policy must be allow or deny_same_target.",
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
    events: [],
    finalOutcome: null,
    nightNumber: 0,
    pendingActions: [],
    phase: null,
    phaseInstanceId: null,
    resolvedRoleSetup: {
      activeRoleIds,
      contributions: [],
      nightConversationGroups: [],
      winnerJudgements: [],
    },
    roleByPlayerId: new Map(),
    ruleOptions: ruleSet.options,
    status: GameStatus.Waiting,
    nightConversationMessages: [],
  };
}

function createRoleSetupContext(ruleSet: RuleSet, activeRoleIds: readonly RoleId[]): RoleContext {
  return {
    roles: roleRegistry,
    state: createEmptyGameStateForRuleSet(ruleSet, activeRoleIds),
  };
}
