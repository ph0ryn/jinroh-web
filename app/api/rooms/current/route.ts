import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getCurrentRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { roomApiErrorResponse } from "@/lib/server/roomApiError";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    return jsonOk({ room: await getCurrentRoom(auth.account) });
  } catch (error) {
    return (
      roomApiErrorResponse(error) ??
      jsonError("server_error", "Current room is temporarily unavailable.", 500)
    );
  }
}
