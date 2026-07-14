import {
  MAX_ROOM_PLAYERS,
  type RoleCatalogItem,
  type RoleCounts,
  type RoleId,
  type RoleOptionValues,
  type RoomSummary,
} from "@/lib/shared/game";
import { isValidRuleSetNumber, RULE_SET_NUMBER_FIELDS } from "@/lib/shared/ruleSetConstraints";

import { buildStartRuleSetInput, type StartRuleSetSettings } from "./liveStartSettings";

export const START_SETTINGS_STORAGE_KEY = "jinrohWeb.startSettings.v1";

export type StartSettingsRoomSession = {
  readonly currentPlayerId: string;
  readonly roomCode: string;
  readonly targetPlayerCount: number;
  readonly waitingExpiresAt: string;
};

type StoredStartSettings = {
  readonly session: StartSettingsRoomSession;
  readonly settings: StartRuleSetSettings;
  readonly version: 1;
};

export function getStartSettingsRoomSession(summary: RoomSummary): StartSettingsRoomSession | null {
  if (summary.status !== "waiting" || !summary.isHost || summary.currentPlayerId === null) {
    return null;
  }

  return {
    currentPlayerId: summary.currentPlayerId,
    roomCode: summary.code,
    targetPlayerCount: summary.targetPlayerCount,
    waitingExpiresAt: summary.waitingExpiresAt,
  };
}

export function getStartSettingsRoomSessionId(session: StartSettingsRoomSession): string {
  return JSON.stringify([
    session.roomCode,
    session.waitingExpiresAt,
    session.currentPlayerId,
    session.targetPlayerCount,
  ]);
}

export function serializeStartSettings(
  session: StartSettingsRoomSession,
  settings: StartRuleSetSettings,
): string {
  const storedSettings: StoredStartSettings = {
    session,
    settings: buildStartRuleSetInput(settings),
    version: 1,
  };

  return JSON.stringify(storedSettings);
}

export function parseStartSettings(
  value: string,
  expectedSession: StartSettingsRoomSession,
  roleCatalog: readonly RoleCatalogItem[],
): StartRuleSetSettings | null {
  const parsedValue = parseJson(value);

  if (!isRecord(parsedValue) || parsedValue["version"] !== 1) {
    return null;
  }

  const session = parseSession(parsedValue["session"]);

  if (
    session === null ||
    getStartSettingsRoomSessionId(session) !== getStartSettingsRoomSessionId(expectedSession)
  ) {
    return null;
  }

  return parseSettings(parsedValue["settings"], roleCatalog);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseSession(value: unknown): StartSettingsRoomSession | null {
  if (
    !isRecord(value) ||
    typeof value["currentPlayerId"] !== "string" ||
    typeof value["roomCode"] !== "string" ||
    typeof value["targetPlayerCount"] !== "number" ||
    typeof value["waitingExpiresAt"] !== "string"
  ) {
    return null;
  }

  return {
    currentPlayerId: value["currentPlayerId"],
    roomCode: value["roomCode"],
    targetPlayerCount: value["targetPlayerCount"],
    waitingExpiresAt: value["waitingExpiresAt"],
  };
}

function parseSettings(
  value: unknown,
  roleCatalog: readonly RoleCatalogItem[],
): StartRuleSetSettings | null {
  if (
    !isRecord(value) ||
    (value["dayMode"] !== "ready_check" && value["dayMode"] !== "ordered_speech") ||
    (value["voteResultVisibility"] !== "count_only" &&
      value["voteResultVisibility"] !== "voter_to_target")
  ) {
    return null;
  }

  for (const field of RULE_SET_NUMBER_FIELDS) {
    if (!isValidRuleSetNumber(field, value[field])) {
      return null;
    }
  }

  const roleCounts = parseRoleCounts(value["roleCounts"], roleCatalog);
  const roleOptions = parseRoleOptions(value["roleOptions"], roleCatalog);

  if (roleCounts === null || roleOptions === null) {
    return null;
  }

  return {
    dayMode: value["dayMode"],
    dayReadyCheckSecondsPerPlayer: value["dayReadyCheckSecondsPerPlayer"] as number,
    daySpeechSeconds: value["daySpeechSeconds"] as number,
    executionLastWordsSeconds: value["executionLastWordsSeconds"] as number,
    firstDaySpeechRounds: value["firstDaySpeechRounds"] as number,
    firstNightSeconds: value["firstNightSeconds"] as number,
    nightSeconds: value["nightSeconds"] as number,
    normalDaySpeechRounds: value["normalDaySpeechRounds"] as number,
    roleCounts,
    roleOptions,
    voteResultVisibility: value["voteResultVisibility"],
    votingSeconds: value["votingSeconds"] as number,
  };
}

function parseRoleCounts(
  value: unknown,
  roleCatalog: readonly RoleCatalogItem[],
): RoleCounts | null {
  if (!isRecord(value)) {
    return null;
  }

  const roleIds = new Set(roleCatalog.map((role) => role.id));
  const roleCounts: Partial<Record<RoleId, number>> = {};

  for (const [roleId, count] of Object.entries(value)) {
    if (
      !roleIds.has(roleId) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_ROOM_PLAYERS
    ) {
      return null;
    }

    roleCounts[roleId] = count;
  }

  return roleCounts;
}

function parseRoleOptions(
  value: unknown,
  roleCatalog: readonly RoleCatalogItem[],
): RoleOptionValues | null {
  if (!isRecord(value)) {
    return null;
  }

  const roleById = new Map(roleCatalog.map((role) => [role.id, role]));
  const roleOptions: Partial<Record<RoleId, Readonly<Record<string, string>>>> = {};

  for (const [roleId, rawOptions] of Object.entries(value)) {
    const role = roleById.get(roleId);

    if (role === undefined || !isRecord(rawOptions)) {
      return null;
    }

    const optionByKey = new Map(role.specificOptions.map((option) => [option.key, option]));
    const parsedOptions: Record<string, string> = {};

    for (const [optionKey, optionValue] of Object.entries(rawOptions)) {
      const option = optionByKey.get(optionKey);

      if (
        option === undefined ||
        typeof optionValue !== "string" ||
        !option.choices.some((choice) => choice.value === optionValue)
      ) {
        return null;
      }

      parsedOptions[optionKey] = optionValue;
    }

    roleOptions[roleId] = parsedOptions;
  }

  return roleOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
