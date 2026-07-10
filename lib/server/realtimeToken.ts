import "server-only";
import { createHmac } from "node:crypto";

import { getSupabaseJwtSecret } from "./env";

type RealtimeTokenInput = {
  expiresAt: string;
  grantId: string;
};

export function createRealtimeAccessToken(input: RealtimeTokenInput): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = Math.floor(Date.parse(input.expiresAt) / 1000);

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("Realtime grant expiration must be in the future.");
  }

  const header = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const payload = encodeJwtPart({
    aud: "authenticated",
    exp: expiresAt,
    iat: issuedAt,
    realtime_grant_id: input.grantId,
    role: "authenticated",
    sub: input.grantId,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", getSupabaseJwtSecret())
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
