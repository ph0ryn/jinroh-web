import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("account token invariants", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_local-test-key");
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

  it("hashes tokens deterministically against a fixed HMAC contract", async () => {
    const { hashAccountToken } = await import("./accountToken");
    const rawToken = `jat_${"A".repeat(43)}`;
    const tokenHash = hashAccountToken(rawToken);

    expect(tokenHash).toBe("uJE6_w4SbsxDGdCFtJgDF6hosBm1yf19HCGiH125BdA");
    expect(hashAccountToken(rawToken)).toBe(tokenHash);
    expect(tokenHash).not.toBe(rawToken);
    expect(tokenHash).not.toContain(rawToken);
    expect(tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("isolates hashes produced with different server secrets", async () => {
    const rawToken = `jat_${"A".repeat(43)}`;
    const { hashAccountToken: hashWithFirstSecret } = await import("./accountToken");
    const firstHash = hashWithFirstSecret(rawToken);

    vi.resetModules();
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", Buffer.alloc(32, 8).toString("base64"));

    const { hashAccountToken: hashWithSecondSecret } = await import("./accountToken");

    expect(hashWithSecondSecret(rawToken)).not.toBe(firstHash);
  });

  it.each([
    { secret: undefined, state: "missing" },
    { secret: "", state: "empty" },
    { secret: "not-standard-base64_", state: "invalid standard base64" },
    { secret: Buffer.alloc(31, 7).toString("base64"), state: "31 bytes" },
    { secret: Buffer.alloc(33, 7).toString("base64"), state: "33 bytes" },
  ])("fails closed when the token hash secret is $state", async ({ secret }) => {
    vi.resetModules();
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", secret);

    const { getServerEnv } = await import("./env");

    expect(() => getServerEnv()).toThrow();
  });

  it("compares same-length hashes in constant-time form", async () => {
    const { constantTimeEqual } = await import("./accountToken");

    expect(constantTimeEqual("same-hash", "same-hash")).toBe(true);
    expect(constantTimeEqual("same-hash", "otherhash")).toBe(false);
    expect(constantTimeEqual("short", "longer")).toBe(false);
  });
});
