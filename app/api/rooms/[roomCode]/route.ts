import { getRoomView } from "@/lib/server/gameRepository";
import { RoomNotFoundError } from "@/lib/server/gameRepositoryErrors";
import { jsonError, jsonOk } from "@/lib/server/http";
import { enforceRoomLookupRateLimit } from "@/lib/server/rateLimit";
import { requireRoomAccount } from "@/lib/server/roomRoute";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

export async function GET(request: Request, context: RoomRouteContext): Promise<Response> {
  const roomAuth = await requireRoomAccount(request, context);

  if ("response" in roomAuth) {
    return roomAuth.response;
  }

  const rateLimitResponse = await enforceRoomLookupRateLimit(
    request,
    roomAuth.account.id,
    roomAuth.roomCode,
  );

  if (rateLimitResponse !== null) {
    return rateLimitResponse;
  }

  try {
    return jsonOk(await getRoomView(roomAuth.account, roomAuth.roomCode));
  } catch (error) {
    return error instanceof RoomNotFoundError
      ? jsonError("not_found", "Room not found.", 404)
      : jsonError("server_error", "Room state is temporarily unavailable.", 500);
  }
}
