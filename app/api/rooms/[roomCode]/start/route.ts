import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getRoleIds } from "@/lib/server/game/roles";
import { startRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import { type RoleId, type RuleSetInput } from "@/lib/shared/game";

type StartBody = {
  ruleSet?: RuleSetInput | null;
};

type RouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

const RULE_TIMING_FIELDS = [
  "dayReadyCheckSecondsPerPlayer",
  "daySpeechSeconds",
  "executionLastWordsSeconds",
  "firstDaySpeechRounds",
  "firstNightSeconds",
  "nightSeconds",
  "normalDaySpeechRounds",
  "votingSeconds",
] as const;

type RuleTimingField = (typeof RULE_TIMING_FIELDS)[number];

export async function POST(request: Request, context: RouteContext): Promise<Response> {
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
  } catch {
    return jsonError("conflict", "Start failed.", 409);
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

  const roleCounts: Partial<Record<RoleId, number>> = {};

  for (const roleId of getRoleIds()) {
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

  if (!isGuardPolicy(value["guardConsecutiveTargetPolicy"])) {
    return {
      response: jsonError("bad_request", "guardConsecutiveTargetPolicy is invalid.", 400),
    };
  }

  if (!isInspectionPolicy(value["initialInspectionPolicy"])) {
    return { response: jsonError("bad_request", "initialInspectionPolicy is invalid.", 400) };
  }

  if (!isVoteVisibility(value["voteResultVisibility"])) {
    return { response: jsonError("bad_request", "voteResultVisibility is invalid.", 400) };
  }

  const parsedTimings = parseRuleTimingFields(value);

  if ("response" in parsedTimings) {
    return parsedTimings;
  }

  return {
    ruleSet: {
      dayMode: value["dayMode"],
      dayReadyCheckSecondsPerPlayer: parsedTimings.timings.dayReadyCheckSecondsPerPlayer,
      daySpeechSeconds: parsedTimings.timings.daySpeechSeconds,
      executionLastWordsSeconds: parsedTimings.timings.executionLastWordsSeconds,
      firstDaySpeechRounds: parsedTimings.timings.firstDaySpeechRounds,
      firstNightSeconds: parsedTimings.timings.firstNightSeconds,
      guardConsecutiveTargetPolicy: value["guardConsecutiveTargetPolicy"],
      initialInspectionPolicy: value["initialInspectionPolicy"],
      nightSeconds: parsedTimings.timings.nightSeconds,
      normalDaySpeechRounds: parsedTimings.timings.normalDaySpeechRounds,
      roleCounts,
      voteResultVisibility: value["voteResultVisibility"],
      votingSeconds: parsedTimings.timings.votingSeconds,
    },
  };
}

function parseRuleTimingFields(
  value: Record<string, unknown>,
): { timings: Record<RuleTimingField, number> } | { response: Response } {
  const timings = {} as Record<RuleTimingField, number>;

  for (const field of RULE_TIMING_FIELDS) {
    const rawValue = value[field];

    if (typeof rawValue !== "number" || !Number.isInteger(rawValue) || rawValue <= 0) {
      return {
        response: jsonError("bad_request", `${field} must be a positive integer.`, 400),
      };
    }

    timings[field] = rawValue;
  }

  return { timings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDayMode(value: unknown): value is RuleSetInput["dayMode"] {
  return value === "ready_check" || value === "ordered_speech";
}

function isGuardPolicy(value: unknown): value is RuleSetInput["guardConsecutiveTargetPolicy"] {
  return value === "allow" || value === "deny";
}

function isInspectionPolicy(value: unknown): value is RuleSetInput["initialInspectionPolicy"] {
  return value === "enabled" || value === "disabled";
}

function isVoteVisibility(value: unknown): value is RuleSetInput["voteResultVisibility"] {
  return value === "count_only" || value === "voter_to_target";
}
