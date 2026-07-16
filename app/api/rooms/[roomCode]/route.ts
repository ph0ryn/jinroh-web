import { getRoomView } from "@/lib/server/gameRepository";
import { RoomNotFoundError } from "@/lib/server/gameRepositoryErrors";
import { jsonError, jsonOk } from "@/lib/server/http";
import {
  enforceRoomLookupAccountRateLimit,
  enforceRoomLookupClientRateLimit,
  enforceRoomOperationAccountRateLimit,
  enforceRoomOperationClientRateLimit,
  rateLimitUnavailableResponse,
} from "@/lib/server/rateLimit";
import { classifyRoomLookup } from "@/lib/server/rateLimitRepository";
import { requireRoomAccount } from "@/lib/server/roomRoute";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

export async function GET(request: Request, context: RoomRouteContext): Promise<Response> {
  const roomAuth = await requireRoomAccount(request, context);

  if ("response" in roomAuth) {
    return roomAuth.response;
  }

  const access = await classifyRoomLookup(roomAuth.account.id, roomAuth.roomCode).catch(() => null);

  if (access === null) {
    return rateLimitUnavailableResponse();
  }

  if (access === "member") {
    const clientRateLimitResponse = await enforceRoomOperationClientRateLimit(
      request,
      "snapshot",
      roomAuth.roomCode,
    );

    if (clientRateLimitResponse !== null) {
      return clientRateLimitResponse;
    }

    const accountRateLimitResponse = await enforceRoomOperationAccountRateLimit(
      roomAuth.account.id,
      "snapshot",
    );

    if (accountRateLimitResponse !== null) {
      return accountRateLimitResponse;
    }
  } else {
    const clientRateLimitResponse = await enforceRoomLookupClientRateLimit(request);

    if (clientRateLimitResponse !== null) {
      return clientRateLimitResponse;
    }

    const accountRateLimitResponse = await enforceRoomLookupAccountRateLimit(roomAuth.account.id);

    if (accountRateLimitResponse !== null) {
      return accountRateLimitResponse;
    }
  }

  if (access === "not_found") {
    return jsonError("not_found", "Room not found.", 404);
  }

  try {
    return jsonOk(await getRoomView(roomAuth.account, roomAuth.roomCode));
  } catch (error) {
    return error instanceof RoomNotFoundError
      ? jsonError("not_found", "Room not found.", 404)
      : jsonError("server_error", "Room state is temporarily unavailable.", 500);
  }
}
