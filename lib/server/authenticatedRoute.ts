import "server-only";
import { authenticate } from "./gameRepository";
import { jsonError, parseBearerToken } from "./http";

import type { AccountRecord } from "./types";

export async function requireAccount(
  request: Request,
): Promise<{ account: AccountRecord } | { response: Response }> {
  const token = parseBearerToken(request);

  if (token === null) {
    return { response: jsonError("unauthorized", "Bearer token is required.", 401) };
  }

  const account = await authenticate(token);

  if (account === null) {
    return { response: jsonError("unauthorized", "Invalid account token.", 401) };
  }

  return { account };
}
