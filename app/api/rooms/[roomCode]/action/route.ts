import { requireAccount } from "@/lib/server/authenticatedRoute";
import { submitAction } from "@/lib/server/gameRepository";
import { isNonNegativeSafeInteger, jsonError, jsonOk, readJson } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";
import { isGameId } from "@/lib/shared/game";

import type { RoomRouteContext } from "@/lib/server/roomRoute";

type SubmitActionBody = {
  actionKey?: unknown;
  gameId?: unknown;
  phaseInstanceId?: unknown;
  revision?: unknown;
  targetPlayerId?: unknown;
};

export async function POST(request: Request, context: RoomRouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJson<SubmitActionBody>(request);

  if (body === null || typeof body.actionKey !== "string") {
    return jsonError("bad_request", "actionKey is required.", 400);
  }

  if (!isGameId(body.gameId)) {
    return jsonError("bad_request", "gameId must be a UUID.", 400);
  }

  if (typeof body.phaseInstanceId !== "string") {
    return jsonError("bad_request", "phaseInstanceId is required.", 400);
  }

  if (!isNonNegativeSafeInteger(body.revision)) {
    return jsonError("bad_request", "revision is required.", 400);
  }

  const targetPlayerId =
    typeof body.targetPlayerId === "string" && body.targetPlayerId !== ""
      ? body.targetPlayerId
      : null;
  const { roomCode } = await context.params;

  try {
    return jsonOk(
      await submitAction(
        auth.account,
        roomCode,
        body.gameId,
        body.actionKey,
        body.phaseInstanceId,
        body.revision,
        targetPlayerId,
      ),
    );
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("conflict", "Submit failed.", 409);
  }
}
