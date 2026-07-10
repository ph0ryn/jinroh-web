import {
  DEFAULT_RULE_SET_OPTIONS,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type RoleCatalogItem,
  type RoleCounts,
  type RoleId,
  type RoleSpecificOptionItem,
  type RuleSetInput,
} from "@/lib/shared/game";

import type { Localization } from "@/lib/i18n/localization";

export type StartRuleSetSettings = RuleSetInput;

export type RuleSetNumberField =
  | "dayReadyCheckSecondsPerPlayer"
  | "daySpeechSeconds"
  | "executionLastWordsSeconds"
  | "firstDaySpeechRounds"
  | "firstNightSeconds"
  | "nightSeconds"
  | "normalDaySpeechRounds"
  | "votingSeconds";

type RuleSetNumberLimit = {
  readonly max: number;
  readonly min: number;
};

export const DEFAULT_START_RULE_SET_SETTINGS: StartRuleSetSettings = {
  dayMode: DEFAULT_RULE_SET_OPTIONS.dayMode,
  dayReadyCheckSecondsPerPlayer: DEFAULT_RULE_SET_OPTIONS.dayReadyCheckSecondsPerPlayer,
  daySpeechSeconds: DEFAULT_RULE_SET_OPTIONS.daySpeechSeconds,
  executionLastWordsSeconds: DEFAULT_RULE_SET_OPTIONS.executionLastWordsSeconds,
  firstDaySpeechRounds: DEFAULT_RULE_SET_OPTIONS.firstDaySpeechRounds,
  firstNightSeconds: DEFAULT_RULE_SET_OPTIONS.firstNightSeconds,
  guardConsecutiveTargetPolicy: DEFAULT_RULE_SET_OPTIONS.guardConsecutiveTargetPolicy,
  initialInspectionPolicy: DEFAULT_RULE_SET_OPTIONS.initialInspectionPolicy,
  nightSeconds: DEFAULT_RULE_SET_OPTIONS.nightSeconds,
  normalDaySpeechRounds: DEFAULT_RULE_SET_OPTIONS.normalDaySpeechRounds,
  roleCounts: {},
  voteResultVisibility: DEFAULT_RULE_SET_OPTIONS.voteResultVisibility,
  votingSeconds: DEFAULT_RULE_SET_OPTIONS.votingSeconds,
};

export const RULE_SET_NUMBER_LIMITS: Record<RuleSetNumberField, RuleSetNumberLimit> = {
  dayReadyCheckSecondsPerPlayer: { max: 300, min: 1 },
  daySpeechSeconds: { max: 300, min: 1 },
  executionLastWordsSeconds: { max: 300, min: 1 },
  firstDaySpeechRounds: { max: 5, min: 1 },
  firstNightSeconds: { max: 300, min: 1 },
  nightSeconds: { max: 600, min: 1 },
  normalDaySpeechRounds: { max: 5, min: 1 },
  votingSeconds: { max: 300, min: 1 },
};

export function buildStartRuleSetInput(settings: StartRuleSetSettings): RuleSetInput {
  return {
    ...settings,
    roleCounts: { ...settings.roleCounts },
  };
}

export function getEffectiveStartRoleCounts(
  settings: StartRuleSetSettings,
  roleCatalog: readonly RoleCatalogItem[],
  defaultRoleCounts: Readonly<RoleCounts>,
): RoleCounts {
  const roleIds = getRoleIdsFromCatalog(roleCatalog);
  const specifiedRoleCount = roleIds.reduce(
    (total, roleId) => total + getRoleCount(settings.roleCounts, roleId),
    0,
  );

  if (specifiedRoleCount === 0) {
    return buildCatalogRoleCounts(defaultRoleCounts, roleCatalog);
  }

  return buildCatalogRoleCounts(settings.roleCounts, roleCatalog);
}

export function getStartRuleSetValidationMessages(
  settings: StartRuleSetSettings,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
  defaultRoleCounts: Readonly<RoleCounts>,
  t: Localization,
): readonly string[] {
  const startRoleCatalog = getStartRoleCatalog(roleCatalog);
  const roleCounts = getEffectiveStartRoleCounts(settings, roleCatalog, defaultRoleCounts);
  const messages: string[] = [];
  const totalRoles = getRoleCountTotal(roleCounts, startRoleCatalog);

  if (playerCount < MIN_ROOM_PLAYERS || playerCount > MAX_ROOM_PLAYERS) {
    messages.push(
      t.live.settings.validation.availableForPlayers(MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS),
    );
  }

  if (totalRoles !== playerCount) {
    const diff = playerCount - totalRoles;
    messages.push(
      diff > 0
        ? t.live.settings.validation.addRoles(diff)
        : t.live.settings.validation.removeRoles(Math.abs(diff)),
    );
  }

  for (const definition of startRoleCatalog) {
    const count = getRoleCount(roleCounts, definition.id);
    const maxCount = getRoleMaxCount(definition.id, playerCount, roleCatalog);

    if (!Number.isInteger(count) || count < 0) {
      messages.push(t.live.settings.validation.countNonNegative(definition.name));
    }

    if (count < definition.minCount) {
      messages.push(t.live.settings.validation.countAtLeast(definition.name, definition.minCount));
    }

    if (count > maxCount) {
      messages.push(t.live.settings.validation.countAtMost(definition.name, maxCount));
    }
  }

  return messages;
}

export function canChangeRoleCount(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleId: RoleId,
  delta: -1 | 1,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): boolean {
  const currentCount = getRoleCount(roleCounts, roleId);
  const nextCount = currentCount + delta;

  if (
    nextCount < getStartRoleCatalogItem(roleCatalog, roleId).minCount ||
    nextCount > getRoleMaxCount(roleId, playerCount, roleCatalog)
  ) {
    return false;
  }

  if (delta > 0 && getRoleCountTotal(roleCounts, roleCatalog) >= playerCount) {
    return false;
  }

  return true;
}

export function clampRoleCount(
  roleId: RoleId,
  value: number,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  const integerValue = Math.trunc(value);

  return Math.min(
    getRoleMaxCount(roleId, playerCount, roleCatalog),
    Math.max(getStartRoleCatalogItem(roleCatalog, roleId).minCount, integerValue),
  );
}

export function getPresetRoleEntries(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  startRoleCatalog: readonly RoleCatalogItem[],
): readonly { readonly count: number; readonly role: RoleCatalogItem }[] {
  return startRoleCatalog.flatMap((role) => {
    const count = getRoleCount(roleCounts, role.id);

    return count > 0 ? [{ count, role }] : [];
  });
}

export function getStartRoleCatalog(
  roleCatalog: readonly RoleCatalogItem[],
): readonly RoleCatalogItem[] {
  return [...roleCatalog].sort(compareStartRoleCatalogItems);
}

export function getActiveRoleSpecificOptions(
  roleCatalog: readonly RoleCatalogItem[],
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
): { readonly option: RoleSpecificOptionItem; readonly role: RoleCatalogItem }[] {
  return getStartRoleCatalog(roleCatalog).flatMap((role) => {
    if (getRoleCount(roleCounts, role.id) <= 0) {
      return [];
    }

    return role.specificOptions.map((option) => ({
      option,
      role,
    }));
  });
}

export function getRoleIdsFromCatalog(roleCatalog: readonly RoleCatalogItem[]): readonly RoleId[] {
  return getStartRoleCatalog(roleCatalog).map((role) => role.id);
}

export function getRoleCount(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleId: RoleId,
): number {
  return roleCounts[roleId] ?? 0;
}

export function getSettingsFlowItems(
  settings: StartRuleSetSettings,
  t: Localization,
): readonly { readonly label: string; readonly value: string }[] {
  const dayValue =
    settings.dayMode === "ordered_speech"
      ? t.live.settings.flow.orderedDay(
          settings.firstDaySpeechRounds,
          settings.normalDaySpeechRounds,
          formatSettingsDuration(settings.daySpeechSeconds, t),
        )
      : t.live.settings.flow.readyDay(
          formatSettingsDuration(settings.dayReadyCheckSecondsPerPlayer, t),
        );

  return [
    {
      label: t.live.settings.flow.firstNight,
      value: formatSettingsDuration(settings.firstNightSeconds, t),
    },
    { label: t.live.settings.flow.day, value: dayValue },
    { label: t.live.settings.flow.vote, value: formatSettingsDuration(settings.votingSeconds, t) },
    {
      label: t.live.settings.flow.lastWords,
      value: formatSettingsDuration(settings.executionLastWordsSeconds, t),
    },
    { label: t.live.settings.flow.night, value: formatSettingsDuration(settings.nightSeconds, t) },
  ];
}

export function clampRuleSetNumber(field: RuleSetNumberField, value: number): number {
  const limits = RULE_SET_NUMBER_LIMITS[field];
  const integerValue = Math.trunc(value);

  return Math.min(limits.max, Math.max(limits.min, integerValue));
}

function getRoleCountTotal(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  return roleCatalog.reduce((total, role) => total + getRoleCount(roleCounts, role.id), 0);
}

function getRoleMaxCount(
  roleId: RoleId,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  return Math.min(
    getStartRoleCatalogItem(roleCatalog, roleId).maxCount ?? playerCount,
    playerCount,
  );
}

function getStartRoleCatalogItem(
  roleCatalog: readonly RoleCatalogItem[],
  roleId: RoleId,
): RoleCatalogItem {
  const role = roleCatalog.find((candidate) => candidate.id === roleId);

  if (role === undefined) {
    throw new Error(`Role catalog is missing ${roleId}.`);
  }

  return role;
}

function buildCatalogRoleCounts(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleCatalog: readonly RoleCatalogItem[],
): RoleCounts {
  return Object.fromEntries(
    getRoleIdsFromCatalog(roleCatalog).map((roleId) => [roleId, getRoleCount(roleCounts, roleId)]),
  ) as RoleCounts;
}

function compareStartRoleCatalogItems(left: RoleCatalogItem, right: RoleCatalogItem): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }

  return left.id.localeCompare(right.id);
}

function formatSettingsDuration(seconds: number, t: Localization): string {
  if (seconds < 60) {
    return t.live.time.durationSeconds(seconds);
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds === 0
    ? t.live.time.durationMinutes(minutes)
    : t.live.time.durationMinutesSeconds(minutes, remainingSeconds);
}
