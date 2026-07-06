import { requireAccount } from "@/lib/server/authenticatedRoute";
import { startRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import { ROLE_IDS, type RoleId, type RuleSetInput } from "@/lib/shared/game";

type StartBody = {
  ruleSet?: RuleSetInput | null;
};

type RouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

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
  } catch (error) {
    return jsonError("conflict", error instanceof Error ? error.message : "Start failed.", 409);
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

  for (const roleId of ROLE_IDS) {
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

  return {
    ruleSet: {
      dayMode: value["dayMode"],
      guardConsecutiveTargetPolicy: value["guardConsecutiveTargetPolicy"],
      initialInspectionPolicy: value["initialInspectionPolicy"],
      roleCounts,
      voteResultVisibility: value["voteResultVisibility"],
    },
  };
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
