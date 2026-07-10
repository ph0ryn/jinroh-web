import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getRoomView } from "@/lib/server/gameRepository";
import { RoomNotFoundError } from "@/lib/server/gameRepositoryErrors";
import { jsonError, jsonOk } from "@/lib/server/http";

type RouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const { roomCode } = await context.params;

  try {
    return jsonOk(await getRoomView(auth.account, roomCode));
  } catch (error) {
    return error instanceof RoomNotFoundError
      ? jsonError("not_found", "Room not found.", 404)
      : jsonError("server_error", "Room state is temporarily unavailable.", 500);
  }
}
