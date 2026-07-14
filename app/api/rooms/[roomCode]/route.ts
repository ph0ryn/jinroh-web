import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getRoomView } from "@/lib/server/gameRepository";
import { RoomNotFoundError } from "@/lib/server/gameRepositoryErrors";
import { jsonError, jsonOk } from "@/lib/server/http";
import {
  enforceRoomLookupAccountRateLimit,
  enforceRoomLookupClientRateLimit,
  rateLimitUnavailableResponse,
} from "@/lib/server/rateLimit";
import { classifyRoomLookup } from "@/lib/server/rateLimitRepository";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

export async function GET(request: Request, context: RoomRouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const { roomCode } = await context.params;
  const access = await classifyRoomLookup(auth.account.id, roomCode).catch(() => null);

  if (access === null) {
    return rateLimitUnavailableResponse();
  }

  if (access !== "member") {
    const clientRateLimitResponse = await enforceRoomLookupClientRateLimit(request);

    if (clientRateLimitResponse !== null) {
      return clientRateLimitResponse;
    }

    const accountRateLimitResponse = await enforceRoomLookupAccountRateLimit(auth.account.id);

    if (accountRateLimitResponse !== null) {
      return accountRateLimitResponse;
    }
  }

  if (access === "not_found") {
    return jsonError("not_found", "Room not found.", 404);
  }

  try {
    return jsonOk(await getRoomView(auth.account, roomCode));
  } catch (error) {
    return error instanceof RoomNotFoundError
      ? jsonError("not_found", "Room not found.", 404)
      : jsonError("server_error", "Room state is temporarily unavailable.", 500);
  }
}
