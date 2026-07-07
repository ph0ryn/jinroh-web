import { requireAccount } from "@/lib/server/authenticatedRoute";
import { submitNightConversationMessage } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";

type SendNightConversationBody = {
  body?: unknown;
  conversationGroupId?: unknown;
  nightNumber?: unknown;
  phaseInstanceId?: unknown;
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

  const body = await readJson<SendNightConversationBody>(request);

  if (body === null) {
    return jsonError("bad_request", "Request body is required.", 400);
  }

  if (typeof body.conversationGroupId !== "string" || body.conversationGroupId === "") {
    return jsonError("bad_request", "conversationGroupId is required.", 400);
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

  const { roomCode } = await context.params;

  try {
    return jsonOk(
      await submitNightConversationMessage(auth.account, roomCode, {
        body: body.body,
        conversationGroupId: body.conversationGroupId,
        nightNumber,
        phaseInstanceId: body.phaseInstanceId,
      }),
    );
  } catch {
    return jsonError("conflict", "Night conversation update failed.", 409);
  }
}
