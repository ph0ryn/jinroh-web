import { requireAccount } from "@/lib/server/authenticatedRoute";
import { resolveRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";

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
    return jsonOk(await resolveRoom(auth.account, roomCode));
  } catch {
    return jsonError("conflict", "Resolve failed.", 409);
  }
}
