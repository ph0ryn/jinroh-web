import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getRoleCatalog, getRoleIds } from "@/lib/server/game/roles";
import { startRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import {
  isValidRuleSetNumber,
  RULE_SET_NUMBER_FIELDS,
  RULE_SET_NUMBER_LIMITS,
  type RuleSetNumberField,
} from "@/lib/shared/ruleSetConstraints";

import type { RoomRouteContext } from "@/lib/server/roomRoute";
import type { RoleId, RuleSetInput } from "@/lib/shared/game";

type StartBody = {
  ruleSet?: RuleSetInput | null;
};

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJson<StartBody>(request);
  const parsedRuleSet = parseRuleSetInput(body?.ruleSet);

  if ("response" in parsedRuleSet) {
    return parsedRuleSet.response;
  }

  const { roomCode } = await context.params;

  try {
    return jsonOk(await startRoom(auth.account, roomCode, parsedRuleSet.ruleSet));
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("conflict", "Start failed.", 409);
  }
}

function parseRuleSetInput(
  value: unknown,
): { ruleSet: RuleSetInput | null } | { response: Response } {
  if (value === undefined || value === null) {
    return { ruleSet: null };
  }

  if (!isRecord(value) || !isRecord(value["roleCounts"])) {
    return { response: jsonError("bad_request", "ruleSet is invalid.", 400) };
  }

  const expectedKeys = [
    ...RULE_SET_NUMBER_FIELDS,
    "dayMode",
    "roleCounts",
    "roleOptions",
    "voteResultVisibility",
  ];

  if (
    Object.keys(value).length !== expectedKeys.length ||
    Object.keys(value).some((key) => !expectedKeys.includes(key))
  ) {
    return { response: jsonError("bad_request", "ruleSet is invalid.", 400) };
  }

  const roleCounts: Partial<Record<RoleId, number>> = {};
  const roleIds = getRoleIds();

  if (Object.keys(value["roleCounts"]).some((roleId) => !roleIds.includes(roleId))) {
    return { response: jsonError("bad_request", "roleCounts contains an unknown role.", 400) };
  }

  for (const roleId of roleIds) {
    const rawCount = value["roleCounts"][roleId];

    if (rawCount !== undefined) {
      if (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 0) {
        return {
          response: jsonError("bad_request", "roleCounts must be non-negative integers.", 400),
        };
      }

      roleCounts[roleId] = rawCount;
    }
  }

  if (!isDayMode(value["dayMode"])) {
    return { response: jsonError("bad_request", "dayMode is invalid.", 400) };
  }

  if (!isVoteVisibility(value["voteResultVisibility"])) {
    return { response: jsonError("bad_request", "voteResultVisibility is invalid.", 400) };
  }

  const parsedTimings = parseRuleTimingFields(value);

  if ("response" in parsedTimings) {
    return parsedTimings;
  }

  const roleOptions = parseRoleOptions(value["roleOptions"]);

  if (roleOptions === null) {
    return { response: jsonError("bad_request", "roleOptions is invalid.", 400) };
  }

  return {
    ruleSet: {
      dayMode: value["dayMode"],
      dayReadyCheckSecondsPerPlayer: parsedTimings.timings.dayReadyCheckSecondsPerPlayer,
      daySpeechSeconds: parsedTimings.timings.daySpeechSeconds,
      executionLastWordsSeconds: parsedTimings.timings.executionLastWordsSeconds,
      firstDaySpeechRounds: parsedTimings.timings.firstDaySpeechRounds,
      firstNightSeconds: parsedTimings.timings.firstNightSeconds,
      nightSeconds: parsedTimings.timings.nightSeconds,
      normalDaySpeechRounds: parsedTimings.timings.normalDaySpeechRounds,
      roleCounts,
      roleOptions,
      voteResultVisibility: value["voteResultVisibility"],
      votingSeconds: parsedTimings.timings.votingSeconds,
    },
  };
}

function parseRuleTimingFields(
  value: Record<string, unknown>,
): { timings: Record<RuleSetNumberField, number> } | { response: Response } {
  const timings = {} as Record<RuleSetNumberField, number>;

  for (const field of RULE_SET_NUMBER_FIELDS) {
    const rawValue = value[field];

    if (!isValidRuleSetNumber(field, rawValue)) {
      const limits = RULE_SET_NUMBER_LIMITS[field];

      return {
        response: jsonError(
          "bad_request",
          `${field} must be an integer from ${limits.min} to ${limits.max}.`,
          400,
        ),
      };
    }

    timings[field] = rawValue;
  }

  return { timings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDayMode(value: unknown): value is RuleSetInput["dayMode"] {
  return value === "ready_check" || value === "ordered_speech";
}

function isVoteVisibility(value: unknown): value is RuleSetInput["voteResultVisibility"] {
  return value === "count_only" || value === "voter_to_target";
}

function parseRoleOptions(value: unknown): RuleSetInput["roleOptions"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const catalog = getRoleCatalog();
  const parsed: RuleSetInput["roleOptions"] = {};

  for (const [roleId, rawOptions] of Object.entries(value)) {
    const role = catalog.find((candidate) => candidate.id === roleId);

    if (role === undefined || role.specificOptions.length === 0 || !isRecord(rawOptions)) {
      return null;
    }

    const definitions = role.specificOptions;
    const optionValues: Record<string, string> = {};

    for (const [optionKey, rawValue] of Object.entries(rawOptions)) {
      const definition = definitions.find((candidate) => candidate.key === optionKey);

      if (
        definition === undefined ||
        typeof rawValue !== "string" ||
        !definition.choices.some((choice) => choice.value === rawValue)
      ) {
        return null;
      }

      optionValues[optionKey] = rawValue;
    }

    parsed[roleId] = optionValues;
  }

  return parsed;
}
