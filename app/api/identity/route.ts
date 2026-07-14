import { createIdentity } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";
import { enforceIdentityRateLimit } from "@/lib/server/rateLimit";

export async function POST(request: Request): Promise<Response> {
  try {
    const rateLimitResponse = await enforceIdentityRateLimit(request);

    if (rateLimitResponse !== null) {
      return rateLimitResponse;
    }

    return jsonOk(await createIdentity(), { status: 201 });
  } catch {
    return jsonError("server_error", "Failed to create identity.", 500);
  }
}
