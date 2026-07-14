import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRealtimeAccessToken } from "./realtimeToken";

describe("Realtime access token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs an authenticated grant without internal account identifiers", () => {
    const secret = "test-supabase-jwt-secret";
    const grantId = "11111111-2222-4333-8444-555555555555";

    vi.stubEnv("SUPABASE_JWT_SECRET", secret);

    const token = createRealtimeAccessToken({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      grantId,
    });
    const [header, payload, signature] = token.split(".");

    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();

    if (header === undefined || payload === undefined || signature === undefined) {
      return;
    }

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const expectedSignature = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(signature).toBe(expectedSignature);
    expect(claims).toMatchObject({
      aud: "authenticated",
      realtime_grant_id: grantId,
      role: "authenticated",
      sub: grantId,
    });
    expect(claims).not.toHaveProperty("accountId");
    expect(claims).not.toHaveProperty("playerId");
  });

  it("refuses to sign an already-expired grant", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "test-supabase-jwt-secret");

    expect(() =>
      createRealtimeAccessToken({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        grantId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow(/must be in the future/u);
  });
});
