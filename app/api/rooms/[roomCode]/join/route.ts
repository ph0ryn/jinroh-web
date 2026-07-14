import { requireAccount } from "@/lib/server/authenticatedRoute";
import { joinRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import {
  enforceRoomMutationAccountRateLimit,
  enforceRoomMutationClientRateLimit,
} from "@/lib/server/rateLimit";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

type JoinRoomBody = {
  displayName?: unknown;
};

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const { roomCode } = await context.params;
  const clientRateLimitResponse = await enforceRoomMutationClientRateLimit(
    request,
    "join",
    roomCode,
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
    "join",
  );

  if (accountRateLimitResponse !== null) {
    return accountRateLimitResponse;
  }

  const body = await readJson<JoinRoomBody>(request);

  if (body === null || typeof body.displayName !== "string") {
    return jsonError("bad_request", "displayName is required.", 400);
  }

  try {
    return jsonOk(await joinRoom(auth.account, roomCode, body.displayName));
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("conflict", "Join failed.", 409);
  }
}
