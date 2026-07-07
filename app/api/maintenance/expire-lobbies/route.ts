import { cleanupExpiredLobbies } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";

type CleanupExpiredLobbiesBody = {
  limit?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const body = await readJson<CleanupExpiredLobbiesBody>(request);
  const parsedLimit = parseLimit(body?.limit);

  if ("response" in parsedLimit) {
    return parsedLimit.response;
  }

  try {
    return jsonOk(await cleanupExpiredLobbies(parsedLimit.limit));
  } catch {
    return jsonError("server_error", "Expired lobby cleanup failed.", 500);
  }
}

function parseLimit(value: unknown): { limit: number } | { response: Response } {
  if (value === undefined) {
    return { limit: 50 };
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 200) {
    return { response: jsonError("bad_request", "limit must be an integer from 1 to 200.", 400) };
  }

  return { limit: value };
}
