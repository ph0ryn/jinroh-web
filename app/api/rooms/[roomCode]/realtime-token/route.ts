import { requireAccount } from "@/lib/server/authenticatedRoute";
import { issueRealtimeGrant } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { createRealtimeAccessToken } from "@/lib/server/realtimeToken";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";

import type { RoomRouteContext } from "@/lib/server/roomRoute";
import type { RealtimeAuthorization } from "@/lib/shared/game";

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const { roomCode } = await context.params;

  try {
    const grant = await issueRealtimeGrant(auth.account, roomCode);

    try {
      const authorization: RealtimeAuthorization = {
        accessToken: createRealtimeAccessToken(grant),
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
