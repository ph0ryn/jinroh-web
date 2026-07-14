import { requireAccount } from "@/lib/server/authenticatedRoute";
import { switchRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import {
  enforceRoomMutationAccountRateLimit,
  enforceRoomMutationClientRateLimit,
} from "@/lib/server/rateLimit";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS, type SwitchRoomRequest } from "@/lib/shared/game";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson<unknown>(request);
  const mutationKind = getMutationKind(body);
  const clientRateLimitResponse = await enforceRoomMutationClientRateLimit(
    request,
    mutationKind,
    getTargetRoomCode(body),
  );

  if (clientRateLimitResponse !== null) {
    return clientRateLimitResponse;
  }

  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const accountRateLimitResponse = await enforceRoomMutationAccountRateLimit(
    auth.account.id,
    mutationKind,
  );

  if (accountRateLimitResponse !== null) {
    return accountRateLimitResponse;
  }

  if (!isSwitchRoomRequest(body)) {
    return jsonError("bad_request", "A valid room switch request is required.", 400);
  }

  try {
    return jsonOk(await switchRoom(auth.account, body), {
      status: body.kind === "create" ? 201 : 200,
    });
  } catch (error) {
    return (
      roomApiErrorResponse(error) ??
      jsonError("server_error", "Room switch is temporarily unavailable.", 500)
    );
  }
}

function getMutationKind(value: unknown): "create" | "join" | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  return value["kind"] === "create" || value["kind"] === "join" ? value["kind"] : undefined;
}

function getTargetRoomCode(value: unknown): string | undefined {
  return isObject(value) && typeof value["targetRoomCode"] === "string"
    ? value["targetRoomCode"]
    : undefined;
}

function isSwitchRoomRequest(value: unknown): value is SwitchRoomRequest {
  if (!isObject(value) || typeof value["displayName"] !== "string") {
    return false;
  }

  if (!isRoomCode(value["expectedCurrentRoomCode"])) {
    return false;
  }

  if (value["kind"] === "join") {
    return isRoomCode(value["targetRoomCode"]);
  }

  return (
    value["kind"] === "create" &&
    typeof value["targetPlayerCount"] === "number" &&
    Number.isInteger(value["targetPlayerCount"]) &&
    value["targetPlayerCount"] >= MIN_ROOM_PLAYERS &&
    value["targetPlayerCount"] <= MAX_ROOM_PLAYERS
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/u.test(value.trim());
}
