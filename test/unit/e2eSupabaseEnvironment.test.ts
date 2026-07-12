import { afterEach, describe, expect, it, vi } from "vitest";

import {
  E2E_ACCOUNT_TOKEN_HASH_SECRET,
  assertLoopbackUrl,
  createLocalE2eEnvironment,
  parseSupabaseStatusEnvironment,
} from "../../scripts/e2eSupabaseEnvironment.mjs";
import { getPublicSupabaseEnvironment } from "../e2e/support/environment";

const LOCAL_STATUS_ENVIRONMENT = {
  ANON_KEY: "local-anon-key",
  API_URL: "http://127.0.0.1:54321",
  JWT_SECRET: "local-jwt-secret",
  SERVICE_ROLE_KEY: "local-service-role-key",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E2E Supabase environment", () => {
  it("parses quoted Supabase status output", () => {
    expect(
      parseSupabaseStatusEnvironment(`API_URL="http://127.0.0.1:54321"
ANON_KEY=local-anon-key
IGNORED_LINE`),
    ).toEqual({
      ANON_KEY: "local-anon-key",
      API_URL: "http://127.0.0.1:54321",
    });
  });

  it("forces every local Supabase credential into the E2E process environment", () => {
    const environment = createLocalE2eEnvironment(
      {
        ACCOUNT_TOKEN_HASH_SECRET: "remote-account-token-secret",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "remote-anon-key",
        NEXT_PUBLIC_SUPABASE_URL: "https://remote.example.com",
        SUPABASE_JWT_SECRET: "remote-jwt-secret",
        SUPABASE_SERVICE_ROLE_KEY: "remote-service-role-key",
        SUPABASE_URL: "https://remote.example.com",
      },
      LOCAL_STATUS_ENVIRONMENT,
    );

    expect(environment).toMatchObject({
      ACCOUNT_TOKEN_HASH_SECRET: E2E_ACCOUNT_TOKEN_HASH_SECRET,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_JWT_SECRET: "local-jwt-secret",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
      SUPABASE_URL: "http://127.0.0.1:54321",
    });
    const accountTokenHashSecret = Buffer.from(E2E_ACCOUNT_TOKEN_HASH_SECRET, "base64");

    expect(accountTokenHashSecret).toHaveLength(32);
    expect(accountTokenHashSecret.toString("base64")).toBe(E2E_ACCOUNT_TOKEN_HASH_SECRET);
  });

  it("rejects incomplete or non-loopback local status output", () => {
    expect(() =>
      createLocalE2eEnvironment({}, { ...LOCAL_STATUS_ENVIRONMENT, ANON_KEY: "" }),
    ).toThrow(/did not provide ANON_KEY/u);
    expect(() =>
      createLocalE2eEnvironment(
        {},
        { ...LOCAL_STATUS_ENVIRONMENT, API_URL: "https://example.com" },
      ),
    ).toThrow(/literal loopback address/u);
    expect(() => assertLoopbackUrl("http://localhost:54321")).toThrow(/literal loopback address/u);
    expect(() => assertLoopbackUrl("http://[::1]:54321")).not.toThrow();
  });

  it("uses only explicit process values for remote E2E runs", async () => {
    vi.stubEnv("E2E_BASE_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "remote-anon-key");

    await expect(getPublicSupabaseEnvironment()).resolves.toEqual({
      anonKey: "remote-anon-key",
      url: "https://supabase.example.com",
    });
  });
});
