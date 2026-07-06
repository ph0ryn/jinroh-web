import { requireAccount } from "@/lib/server/authenticatedRoute";
import { createRoom } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";

type CreateRoomBody = {
  displayName?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJson<CreateRoomBody>(request);

  if (body === null || typeof body.displayName !== "string") {
    return jsonError("bad_request", "displayName is required.", 400);
  }

  try {
    return jsonOk(await createRoom(auth.account, body.displayName), { status: 201 });
  } catch (error) {
    return jsonError("server_error", error instanceof Error ? error.message : "Failed.", 500);
  }
}
