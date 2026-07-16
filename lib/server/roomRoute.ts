import "server-only";
import { requireAccount } from "./authenticatedRoute";
import { jsonError, jsonOk } from "./http";
import {
  enforceRoomOperationAccountRateLimit,
  enforceRoomOperationClientRateLimit,
} from "./rateLimit";
import { roomApiErrorResponse } from "./roomApiError";

import type { RoomOperationKind } from "./rateLimit";
import type { AccountRecord } from "./types";

export type RoomRouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

export function createAuthenticatedRoomMutationRoute<Body>(
  mutation: (account: AccountRecord, roomCode: string) => Promise<Body>,
  fallbackMessage: string,
  rateLimitKind?: RoomOperationKind,
): (request: Request, context: RoomRouteContext) => Promise<Response> {
  return async (request, context) => {
    const roomAuth = await requireRoomAccount(request, context, rateLimitKind);

    if ("response" in roomAuth) {
      return roomAuth.response;
    }

    try {
      return jsonOk(await mutation(roomAuth.account, roomAuth.roomCode));
    } catch (error) {
      return roomApiErrorResponse(error) ?? jsonError("conflict", fallbackMessage, 409);
    }
  };
}

export async function requireRoomAccount(
  request: Request,
  context: RoomRouteContext,
  rateLimitKind?: RoomOperationKind,
): Promise<
  { readonly account: AccountRecord; readonly roomCode: string } | { readonly response: Response }
> {
  const { roomCode } = await context.params;

  if (rateLimitKind !== undefined) {
    const clientRateLimitResponse = await enforceRoomOperationClientRateLimit(
      request,
      rateLimitKind,
      roomCode,
    );

    if (clientRateLimitResponse !== null) {
      return { response: clientRateLimitResponse };
    }
  }

  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth;
  }

  if (rateLimitKind !== undefined) {
    const accountRateLimitResponse = await enforceRoomOperationAccountRateLimit(
      auth.account.id,
      rateLimitKind,
    );

    if (accountRateLimitResponse !== null) {
      return { response: accountRateLimitResponse };
    }
  }

  return { account: auth.account, roomCode };
}
