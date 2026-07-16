import { issueRealtimeGrant } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { createRealtimeAccessToken } from "@/lib/server/realtimeToken";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { requireRoomAccount } from "@/lib/server/roomRoute";

import type { RoomRouteContext } from "@/lib/server/roomRoute";
import type { RealtimeAuthorization } from "@/lib/shared/game";

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const roomAuth = await requireRoomAccount(request, context, "realtime-token");

  if ("response" in roomAuth) {
    return roomAuth.response;
  }

  try {
    const grant = await issueRealtimeGrant(roomAuth.account, roomAuth.roomCode);

    try {
      const authorization: RealtimeAuthorization = {
        accessToken: await createRealtimeAccessToken(grant),
        expiresAt: grant.expiresAt,
        subscriptions: grant.subscriptions,
      };

      return jsonOk(authorization);
    } catch {
      return jsonError("server_error", "Realtime token signing failed.", 500);
    }
  } catch (error) {
    return (
      roomApiErrorResponse(error) ??
      jsonError("server_error", "Realtime authorization failed.", 500)
    );
  }
}
