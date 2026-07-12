import "server-only";
import { requireAccount } from "./authenticatedRoute";
import { jsonError, jsonOk } from "./http";
import { roomApiErrorResponse } from "./roomApiError";

import type { AccountRecord } from "./types";

export type RoomRouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

export function createAuthenticatedRoomMutationRoute<Body>(
  mutation: (account: AccountRecord, roomCode: string) => Promise<Body>,
  fallbackMessage: string,
): (request: Request, context: RoomRouteContext) => Promise<Response> {
  return async (request, context) => {
    const auth = await requireAccount(request);

    if ("response" in auth) {
      return auth.response;
    }

    const { roomCode } = await context.params;

    try {
      return jsonOk(await mutation(auth.account, roomCode));
    } catch (error) {
      return roomApiErrorResponse(error) ?? jsonError("conflict", fallbackMessage, 409);
    }
  };
}
