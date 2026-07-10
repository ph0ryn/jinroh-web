import { cleanupExpiredWaitingRooms } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";
import { isAuthorizedMaintenanceRequest } from "@/lib/server/maintenanceAuth";

type CleanupExpiredWaitingRoomsBody = {
  limit?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const authenticationFailure = getAuthenticationFailure(request);

  if (authenticationFailure !== null) {
    return authenticationFailure;
  }

  const body = await readJson<CleanupExpiredWaitingRoomsBody>(request);
  const parsedLimit = parseLimit(body?.limit);

  if ("response" in parsedLimit) {
    return parsedLimit.response;
  }

  try {
    return jsonOk(await cleanupExpiredWaitingRooms(parsedLimit.limit));
  } catch {
    return jsonError("server_error", "Expired waiting room cleanup failed.", 500);
  }
}

function getAuthenticationFailure(request: Request): Response | null {
  try {
    return isAuthorizedMaintenanceRequest(request)
      ? null
      : jsonError("unauthorized", "Valid maintenance credentials are required.", 401);
  } catch {
    return jsonError("server_error", "Maintenance authentication is not configured.", 500);
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
