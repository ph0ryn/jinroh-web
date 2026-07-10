import { requireAccount } from "@/lib/server/authenticatedRoute";
import { issueRealtimeGrant } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { createRealtimeAccessToken } from "@/lib/server/realtimeToken";

import type { RealtimeAuthorization } from "@/lib/shared/game";

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

  const { roomCode } = await context.params;
  const grant = await issueRealtimeGrant(auth.account, roomCode).catch(() => null);

  if (grant === null) {
    return jsonError("not_found", "Realtime authorization failed.", 404);
  }

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
}
