import { setRoomReadiness } from "@/lib/server/gameRepository";
import { isNonNegativeSafeInteger, jsonError, jsonOk, readJson } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { requireRoomAccount } from "@/lib/server/roomRoute";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

type SetRoomReadinessBody = {
  expectedRosterRevision?: unknown;
  isReady?: unknown;
};

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const roomAuth = await requireRoomAccount(request, context, "readiness");

  if ("response" in roomAuth) {
    return roomAuth.response;
  }

  const body = await readJson<SetRoomReadinessBody>(request);

  if (body === null || typeof body.isReady !== "boolean") {
    return jsonError("bad_request", "isReady is required.", 400);
  }

  if (!isNonNegativeSafeInteger(body.expectedRosterRevision)) {
    return jsonError("bad_request", "expectedRosterRevision is required.", 400);
  }

  try {
    return jsonOk(
      await setRoomReadiness(
        roomAuth.account,
        roomAuth.roomCode,
        body.isReady,
        body.expectedRosterRevision,
      ),
    );
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("conflict", "Readiness update failed.", 409);
  }
}
