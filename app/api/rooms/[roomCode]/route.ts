import { requireAccount } from "@/lib/server/authenticatedRoute";
import { getRoomView } from "@/lib/server/gameRepository";
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
  } catch {
    return jsonError("not_found", "Room not found.", 404);
  }
}
