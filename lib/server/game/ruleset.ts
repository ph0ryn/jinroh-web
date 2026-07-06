import "server-only";
import {
  getCoreSetupContributions,
  hasInitialInspectionHumanCandidate,
  roleRegistry,
} from "./roles";
import {
  DayDiscussionMode,
  GameStatus,
  GuardConsecutiveTargetPolicy,
  InitialInspectionPolicy,
  ROLE_IDS,
  RoleSetupContributionKind,
  VoteResultVisibility,
} from "./types";

import type { RoleContext } from "./roles";
import type {
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
  | "no_initial_inspection_candidate"
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
  const werewolf = playerCount >= 7 ? 2 : 1;
  const seer = playerCount >= 4 ? 1 : 0;
  const guard = playerCount >= 5 ? 1 : 0;
  const madman = playerCount >= 6 ? 1 : 0;
  const fox = playerCount >= 8 ? 1 : 0;
  const fixedRoles = werewolf + seer + guard + madman + fox;

  return {
    fox,
    guard,
    madman,
    seer,
    villager: Math.max(playerCount - fixedRoles, 0),
    werewolf,
  };
}

export function validateRuleSet(ruleSet: RuleSet, playerCount: number): RuleSetValidationResult {
  const issues: RuleSetValidationIssue[] = [];
  const totalRoles = ROLE_IDS.reduce((total, roleId) => total + ruleSet.roleCounts[roleId], 0);

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

  for (const roleId of ROLE_IDS) {
    const role = roleRegistry.get(roleId);
    const count = ruleSet.roleCounts[roleId];

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
      if (count > 0 && ruleSet.roleCounts[incompatibleRoleId] > 0) {
        issues.push({
          code: "role_incompatible",
          message: `${role.name} cannot be used with ${roleRegistry.get(incompatibleRoleId).name}.`,
          roleId,
        });
      }
    }
  }

  if (
    ruleSet.options.initialInspectionPolicy === InitialInspectionPolicy.Enabled &&
    !hasInitialInspectionHumanCandidate({
      roleCounts: ruleSet.roleCounts,
      seerCount: ruleSet.roleCounts.seer,
    })
  ) {
    issues.push({
      code: "no_initial_inspection_candidate",
      message: "Initial inspection requires at least one non-seer human inspection candidate.",
      roleId: "seer",
    });
  }

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
  const activeRoleIds = ROLE_IDS.filter((roleId) => ruleSet.roleCounts[roleId] > 0);
  const context = createRoleSetupContext(ruleSet, activeRoleIds);
  const contributions = [
    ...getCoreSetupContributions(),
    ...activeRoleIds.flatMap((roleId) => roleRegistry.get(roleId).getSetupContributions(context)),
  ];

  return {
    activeRoleIds,
    contributions,
    werewolfConsultationTemplates: contributions.flatMap((contribution) => {
      return contribution.kind === RoleSetupContributionKind.WerewolfConsultationTemplate
        ? [contribution.template]
        : [];
    }),
    winnerJudgements: contributions.flatMap((contribution) => {
      return contribution.kind === RoleSetupContributionKind.WinnerJudgement
        ? [contribution.judgement]
        : [];
    }),
  };
}

function normalizeRoleCounts(
  inputRoleCounts: Partial<Record<RoleId, number>> | undefined,
  playerCount: number,
): RoleCounts {
  if (inputRoleCounts === undefined) {
    return makeDefaultRoleCounts(playerCount);
  }

  return Object.fromEntries(
    ROLE_IDS.map((roleId) => [roleId, inputRoleCounts[roleId] ?? 0]),
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

  for (const [optionName, optionValue] of Object.entries(getPositiveIntegerOptions(options))) {
    if (!Number.isInteger(optionValue) || optionValue <= 0) {
      issues.push({
        code: "invalid_option",
        message: `${optionName} must be a positive integer.`,
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
      werewolfConsultationTemplates: [],
      winnerJudgements: [],
    },
    roleByPlayerId: new Map(),
    ruleOptions: ruleSet.options,
    status: GameStatus.Waiting,
    werewolfConsultations: [],
  };
}

function createRoleSetupContext(ruleSet: RuleSet, activeRoleIds: readonly RoleId[]): RoleContext {
  return {
    roles: roleRegistry,
    state: createEmptyGameStateForRuleSet(ruleSet, activeRoleIds),
  };
}
