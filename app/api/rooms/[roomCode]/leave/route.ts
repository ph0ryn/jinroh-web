import { requireAccount } from "@/lib/server/authenticatedRoute";
import { leaveRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";

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

  try {
    return jsonOk(await leaveRoom(auth.account, roomCode));
  } catch (error) {
    return roomApiErrorResponse(error) ?? jsonError("conflict", "Leave failed.", 409);
  }
}
