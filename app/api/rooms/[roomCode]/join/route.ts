import { requireAccount } from "@/lib/server/authenticatedRoute";
import { joinRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";

type JoinRoomBody = {
  displayName?: unknown;
};

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

  const body = await readJson<JoinRoomBody>(request);

  if (body === null || typeof body.displayName !== "string") {
    return jsonError("bad_request", "displayName is required.", 400);
  }

  const { roomCode } = await context.params;

  try {
    return jsonOk(await joinRoom(auth.account, roomCode, body.displayName));
  } catch {
    return jsonError("conflict", "Join failed.", 409);
  }
}
