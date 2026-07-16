import { importJWK, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRealtimeAccessToken } from "./realtimeToken";
import { createTestSupabaseJwtSigningKey } from "./testEnvironment";

describe("Realtime access token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs an authenticated grant with an ES256 signing key", async () => {
    const serializedSigningKey = createTestSupabaseJwtSigningKey();
    const signingKey = JSON.parse(serializedSigningKey) as JsonWebKey & { kid: string };
    const grantId = "11111111-2222-4333-8444-555555555555";

    vi.stubEnv("SUPABASE_JWT_SIGNING_KEY", serializedSigningKey);

    const token = await createRealtimeAccessToken({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      grantId,
    });
    const publicKey = await importJWK(
      {
        alg: "ES256",
        crv: signingKey.crv,
        kid: signingKey.kid,
        kty: signingKey.kty,
        x: signingKey.x,
        y: signingKey.y,
      },
      "ES256",
    );
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: ["ES256"],
      audience: "authenticated",
    });

    expect(protectedHeader).toMatchObject({
      alg: "ES256",
      kid: signingKey.kid,
      typ: "JWT",
    });
    expect(payload).toMatchObject({
      aud: "authenticated",
      realtime_grant_id: grantId,
      role: "authenticated",
      sub: grantId,
    });
    expect(payload).not.toHaveProperty("accountId");
    expect(payload).not.toHaveProperty("playerId");
  });

  it("refuses to sign an already-expired grant", async () => {
    vi.stubEnv("SUPABASE_JWT_SIGNING_KEY", createTestSupabaseJwtSigningKey());

    await expect(
      createRealtimeAccessToken({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        grantId: "11111111-2222-4333-8444-555555555555",
      }),
    ).rejects.toThrow(/must be in the future/u);
  });
});
