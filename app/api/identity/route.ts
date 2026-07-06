import { createIdentity } from "@/lib/server/gameRepository";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function POST(): Promise<Response> {
  try {
    return jsonOk(await createIdentity(), { status: 201 });
  } catch {
    return jsonError("server_error", "Failed to create identity.", 500);
  }
}
