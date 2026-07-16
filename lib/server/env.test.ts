import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestSupabaseJwtSigningKey } from "./testEnvironment";

const VALID_SERVER_ENV = {
  ACCOUNT_TOKEN_HASH_SECRET: Buffer.alloc(32, 7).toString("base64"),
  MAINTENANCE_SECRET: "maintenance-secret-that-is-at-least-32-bytes",
  RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER: "x-ingress-client-ip",
  SUPABASE_JWT_SIGNING_KEY: createTestSupabaseJwtSigningKey(),
  SUPABASE_SECRET_KEY: "sb_secret_test-key",
  SUPABASE_URL: "https://example.supabase.co",
} as const;

describe("server environment startup validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(
    Object.keys(VALID_SERVER_ENV).filter((key) => key !== "RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER"),
  )("rejects startup when %s is empty", async (key) => {
    stubValidServerEnv();
    vi.stubEnv(key, "");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow(`${key} is required.`);
  });

  it("rejects startup when the account token HMAC key is malformed", async () => {
    stubValidServerEnv();
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", "not-standard-base64");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow("ACCOUNT_TOKEN_HASH_SECRET must be standard base64.");
  });

  it("rejects a legacy service-role API key", async () => {
    stubValidServerEnv();
    vi.stubEnv("SUPABASE_SECRET_KEY", "legacy-service-role-key");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow("SUPABASE_SECRET_KEY must be a Supabase secret key.");
  });

  it("rejects a malformed JWT signing key", async () => {
    stubValidServerEnv();
    vi.stubEnv("SUPABASE_JWT_SIGNING_KEY", JSON.stringify({ alg: "HS256", kid: "legacy" }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow(
      "SUPABASE_JWT_SIGNING_KEY must be a valid ES256 private JWK.",
    );
  });

  it("accepts a complete server environment through instrumentation", async () => {
    stubValidServerEnv();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("../../instrumentation");

    await expect(register()).resolves.toBeUndefined();
  });

  it("rejects non-Vercel production startup without a trusted client IP header", async () => {
    stubValidServerEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("VERCEL", "");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow(
      "RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER is required outside Vercel.",
    );
  });

  it("uses Vercel's system client IP header without extra configuration", async () => {
    stubValidServerEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("VERCEL", "1");

    const { getServerEnv } = await import("./env");
    const { register } = await import("../../instrumentation");

    await expect(register()).resolves.toBeUndefined();
    expect(getServerEnv().rateLimitTrustedClientIpHeader).toBe("x-vercel-forwarded-for");
  });

  it("rejects a malformed trusted client IP header name", async () => {
    stubValidServerEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER", "invalid header");

    const { register } = await import("../../instrumentation");

    await expect(register()).rejects.toThrow(
      "RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER must be a valid HTTP header name.",
    );
  });

  it("does not load Node.js-only validation in the Edge runtime", async () => {
    for (const key of Object.keys(VALID_SERVER_ENV)) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("NEXT_RUNTIME", "edge");

    const { register } = await import("../../instrumentation");

    await expect(register()).resolves.toBeUndefined();
  });
});

function stubValidServerEnv(): void {
  for (const [key, value] of Object.entries(VALID_SERVER_ENV)) {
    vi.stubEnv(key, value);
  }
}
