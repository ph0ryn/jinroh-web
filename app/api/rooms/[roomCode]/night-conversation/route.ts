import { submitNightConversationMessage } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { requireRoomAccount } from "@/lib/server/roomRoute";
import { isGameId } from "@/lib/shared/game";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

type SendNightConversationBody = {
  body?: unknown;
  conversationGroupId?: unknown;
  gameId?: unknown;
  nightNumber?: unknown;
  phaseInstanceId?: unknown;
};

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const roomAuth = await requireRoomAccount(request, context, "night-conversation");

  if ("response" in roomAuth) {
    return roomAuth.response;
  }

  const body = await readJson<SendNightConversationBody>(request);

  if (body === null) {
    return jsonError("bad_request", "Request body is required.", 400);
  }

  if (typeof body.conversationGroupId !== "string" || body.conversationGroupId === "") {
    return jsonError("bad_request", "conversationGroupId is required.", 400);
  }

  if (!isGameId(body.gameId)) {
    return jsonError("bad_request", "gameId must be a UUID.", 400);
  }

  if (typeof body.phaseInstanceId !== "string" || body.phaseInstanceId === "") {
    return jsonError("bad_request", "phaseInstanceId is required.", 400);
  }

  if (typeof body.body !== "string") {
    return jsonError("bad_request", "body is required.", 400);
  }

  const nightNumber = body.nightNumber;

  if (typeof nightNumber !== "number" || !Number.isSafeInteger(nightNumber) || nightNumber < 1) {
    return jsonError("bad_request", "nightNumber is invalid.", 400);
  }

  try {
    return jsonOk(
      await submitNightConversationMessage(roomAuth.account, roomAuth.roomCode, {
        body: body.body,
        conversationGroupId: body.conversationGroupId,
        gameId: body.gameId,
        nightNumber,
        phaseInstanceId: body.phaseInstanceId,
      }),
    );
  } catch (error) {
    return (
      roomApiErrorResponse(error) ?? jsonError("conflict", "Night conversation update failed.", 409)
    );
  }
}
