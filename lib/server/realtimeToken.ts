import "server-only";
import { importJWK, SignJWT } from "jose";

import { getSupabaseJwtSigningKey } from "./env";

type RealtimeTokenInput = {
  expiresAt: string;
  grantId: string;
};

export async function createRealtimeAccessToken(input: RealtimeTokenInput): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = Math.floor(Date.parse(input.expiresAt) / 1000);

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("Realtime grant expiration must be in the future.");
  }

  const signingKey = getSupabaseJwtSigningKey();
  const privateKey = await importJWK(signingKey, signingKey.alg);

  return await new SignJWT({
    realtime_grant_id: input.grantId,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: signingKey.alg, kid: signingKey.kid, typ: "JWT" })
    .setAudience("authenticated")
    .setExpirationTime(expiresAt)
    .setIssuedAt(issuedAt)
    .setSubject(input.grantId)
    .sign(privateKey);
}
