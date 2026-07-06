import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("account token invariants", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-service-role-key");
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", Buffer.alloc(32, 7).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates opaque 256-bit bearer tokens with the project prefix", async () => {
    const { createAccountToken, isValidTokenShape } = await import("./accountToken");
    const rawToken = createAccountToken();

    expect(rawToken).toMatch(/^jat_[A-Za-z0-9_-]{43}$/);
    expect(isValidTokenShape(rawToken)).toBe(true);
  });

  it("hashes tokens without returning or storing the raw credential shape", async () => {
    const { hashAccountToken } = await import("./accountToken");
    const rawToken = `jat_${"A".repeat(43)}`;
    const tokenHash = hashAccountToken(rawToken);

    expect(tokenHash).not.toBe(rawToken);
    expect(tokenHash).not.toContain(rawToken);
    expect(tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects non-standard base64 token hash secrets", async () => {
    vi.resetModules();
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", Buffer.alloc(32, 7).toString("base64url"));

    const { getServerEnv } = await import("./env");

    expect(() => getServerEnv()).toThrow(/standard base64|exactly 32 bytes/u);
  });

  it("compares same-length hashes in constant-time form", async () => {
    const { constantTimeEqual } = await import("./accountToken");

    expect(constantTimeEqual("same-hash", "same-hash")).toBe(true);
    expect(constantTimeEqual("same-hash", "otherhash")).toBe(false);
    expect(constantTimeEqual("short", "longer")).toBe(false);
  });
});
