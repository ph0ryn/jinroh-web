import { requireAccount } from "@/lib/server/authenticatedRoute";
import { createRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import {
  enforceRoomMutationAccountRateLimit,
  enforceRoomMutationClientRateLimit,
} from "@/lib/server/rateLimit";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { DEFAULT_TARGET_PLAYER_COUNT, MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS } from "@/lib/shared/game";

type CreateRoomBody = {
  displayName?: unknown;
  targetPlayerCount?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const clientRateLimitResponse = await enforceRoomMutationClientRateLimit(request, "create");

  if (clientRateLimitResponse !== null) {
    return clientRateLimitResponse;
  }

  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const accountRateLimitResponse = await enforceRoomMutationAccountRateLimit(
    auth.account.id,
    "create",
  );

  if (accountRateLimitResponse !== null) {
    return accountRateLimitResponse;
  }

  const body = await readJson<CreateRoomBody>(request);

  if (body === null || typeof body.displayName !== "string") {
    return jsonError("bad_request", "displayName is required.", 400);
  }

  const targetPlayerCount = parseTargetPlayerCount(body.targetPlayerCount);

  if (targetPlayerCount === null) {
    return jsonError(
      "bad_request",
      `targetPlayerCount must be an integer between ${MIN_ROOM_PLAYERS} and ${MAX_ROOM_PLAYERS}.`,
      400,
    );
  }

  try {
    return jsonOk(await createRoom(auth.account, body.displayName, targetPlayerCount), {
      status: 201,
    });
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("server_error", "Failed to create room.", 500);
  }
}

function parseTargetPlayerCount(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_TARGET_PLAYER_COUNT;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  if (value < MIN_ROOM_PLAYERS || value > MAX_ROOM_PLAYERS) {
    return null;
  }

  return value;
}
