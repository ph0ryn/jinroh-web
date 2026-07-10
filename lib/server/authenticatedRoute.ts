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

  const authentication = await authenticateAccount(token);

  if ("response" in authentication) {
    return authentication;
  }

  if (authentication.account === null) {
    return { response: jsonError("unauthorized", "Invalid account token.", 401) };
  }

  return { account: authentication.account };
}

async function authenticateAccount(
  token: string,
): Promise<{ account: AccountRecord | null } | { response: Response }> {
  try {
    return { account: await authenticate(token) };
  } catch {
    return {
      response: jsonError("server_error", "Authentication is temporarily unavailable.", 500),
    };
  }
}
