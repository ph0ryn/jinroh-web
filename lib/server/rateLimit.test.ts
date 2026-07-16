import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enforceIdentityRateLimit,
  enforceRoomLookupRateLimit,
  getTrustedClientAddress,
} from "./rateLimit";
import { classifyRoomLookup, consumeRateLimits } from "./rateLimitRepository";

vi.mock("./rateLimitRepository", () => ({
  classifyRoomLookup: vi.fn(),
  consumeRateLimits: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trusted rate-limit client address", () => {
  it("accepts one canonical IPv4 address from Vercel", () => {
    const request = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": " 192.0.2.10 " },
    });

    expect(getTrustedClientAddress(request)).toBe("192.0.2.10");
  });

  it("groups equivalent IPv6 privacy addresses by canonical /64", () => {
    const expanded = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "2001:0DB8:0001:0002:0000:0000:0000:0001" },
    });
    const compressed = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "2001:db8:1:2::ffff" },
    });

    expect(getTrustedClientAddress(expanded)).toBe("2001:db8:1:2::/64");
    expect(getTrustedClientAddress(compressed)).toBe("2001:db8:1:2::/64");
  });

  it("canonicalizes compressed IPv6 boundaries and loopback networks", () => {
    const compressedAtStart = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "::1" },
    });
    const compressedAtEnd = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "2001:db8:1:2::" },
    });
    const ipv4Loopback = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "127.0.0.1" },
    });

    expect(getTrustedClientAddress(compressedAtStart)).toBe("0:0:0:0::/64");
    expect(getTrustedClientAddress(compressedAtEnd)).toBe("2001:db8:1:2::/64");
    expect(getTrustedClientAddress(ipv4Loopback)).toBe("127.0.0.1");
  });

  it("normalizes IPv4-mapped IPv6 without collapsing unrelated IPv4 clients", () => {
    const dotted = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "::ffff:192.0.2.10" },
    });
    const hexadecimal = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "::ffff:c000:20a" },
    });

    expect(getTrustedClientAddress(dotted)).toBe("192.0.2.10");
    expect(getTrustedClientAddress(hexadecimal)).toBe("192.0.2.10");
  });

  it("rejects forwarded chains and malformed addresses", () => {
    const forwardedChain = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "192.0.2.1, 198.51.100.2" },
    });
    const malformed = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "client.example.test" },
    });

    expect(getTrustedClientAddress(forwardedChain)).toBeNull();
    expect(getTrustedClientAddress(malformed)).toBeNull();
  });

  it("does not trust generic forwarded headers", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });

    expect(getTrustedClientAddress(request)).toBeNull();
  });

  it("skips rate limiting and lookup classification outside Vercel", async () => {
    vi.stubEnv("VERCEL", "");

    await expect(enforceIdentityRateLimit(new Request("https://example.test"))).resolves.toBeNull();
    await expect(
      enforceRoomLookupRateLimit(new Request("https://example.test"), 1, "123456"),
    ).resolves.toBeNull();
    expect(consumeRateLimits).not.toHaveBeenCalled();
    expect(classifyRoomLookup).not.toHaveBeenCalled();
  });

  it("returns a no-store 503 when Vercel's header is missing or invalid", async () => {
    vi.stubEnv("VERCEL", "1");

    const missing = await enforceIdentityRateLimit(new Request("https://example.test"));
    const invalid = await enforceIdentityRateLimit(
      new Request("https://example.test", {
        headers: { "x-vercel-forwarded-for": "192.0.2.1, 198.51.100.2" },
      }),
    );

    expect(missing?.status).toBe(503);
    expect(missing?.headers.get("cache-control")).toBe("no-store");
    expect(invalid?.status).toBe(503);
    expect(invalid?.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when rate-limit storage is unavailable", async () => {
    stubVercelRateLimitEnv();
    vi.mocked(consumeRateLimits).mockRejectedValue(new Error("storage unavailable"));

    const response = await enforceIdentityRateLimit(
      new Request("https://example.test", {
        headers: { "x-vercel-forwarded-for": "192.0.2.10" },
      }),
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when room lookup classification is unavailable", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.mocked(classifyRoomLookup).mockRejectedValue(new Error("classification unavailable"));

    const response = await enforceRoomLookupRateLimit(
      new Request("https://example.test"),
      1,
      "123456",
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });
});

function stubVercelRateLimitEnv(): void {
  vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test-key");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VERCEL", "1");
}
