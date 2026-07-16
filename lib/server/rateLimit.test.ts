import { afterEach, describe, expect, it, vi } from "vitest";

import { enforceIdentityRateLimit, getTrustedClientAddress } from "./rateLimit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trusted rate-limit client address", () => {
  it("accepts one canonical IPv4 address from the configured header", () => {
    const request = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": " 192.0.2.10 " },
    });

    expect(getTrustedClientAddress(request, "x-ingress-client-ip")).toBe("192.0.2.10");
  });

  it("groups equivalent IPv6 privacy addresses by canonical /64", () => {
    const expanded = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "2001:0DB8:0001:0002:0000:0000:0000:0001" },
    });
    const compressed = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "2001:db8:1:2::ffff" },
    });

    expect(getTrustedClientAddress(expanded, "x-ingress-client-ip")).toBe("2001:db8:1:2::/64");
    expect(getTrustedClientAddress(compressed, "x-ingress-client-ip")).toBe("2001:db8:1:2::/64");
  });

  it("canonicalizes compressed IPv6 boundaries and loopback networks", () => {
    const compressedAtStart = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "::1" },
    });
    const compressedAtEnd = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "2001:db8:1:2::" },
    });
    const ipv4Loopback = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "127.0.0.1" },
    });

    expect(getTrustedClientAddress(compressedAtStart, "x-ingress-client-ip")).toBe("0:0:0:0::/64");
    expect(getTrustedClientAddress(compressedAtEnd, "x-ingress-client-ip")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(getTrustedClientAddress(ipv4Loopback, "x-ingress-client-ip")).toBe("127.0.0.1");
  });

  it("normalizes IPv4-mapped IPv6 without collapsing unrelated IPv4 clients", () => {
    const dotted = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "::ffff:192.0.2.10" },
    });
    const hexadecimal = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "::ffff:c000:20a" },
    });

    expect(getTrustedClientAddress(dotted, "x-ingress-client-ip")).toBe("192.0.2.10");
    expect(getTrustedClientAddress(hexadecimal, "x-ingress-client-ip")).toBe("192.0.2.10");
  });

  it("rejects forwarded chains and malformed addresses", () => {
    const forwardedChain = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "192.0.2.1, 198.51.100.2" },
    });
    const malformed = new Request("https://example.test", {
      headers: { "x-ingress-client-ip": "client.example.test" },
    });

    expect(getTrustedClientAddress(forwardedChain, "x-ingress-client-ip")).toBeNull();
    expect(getTrustedClientAddress(malformed, "x-ingress-client-ip")).toBeNull();
  });

  it("does not trust an IP header unless ingress configured it", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });

    expect(getTrustedClientAddress(request, null)).toBeNull();
  });

  it("returns a no-store 503 when the trusted header is missing or invalid", async () => {
    vi.stubEnv("ACCOUNT_TOKEN_HASH_SECRET", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test-key");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER", "x-ingress-client-ip");

    const missing = await enforceIdentityRateLimit(new Request("https://example.test"));
    const invalid = await enforceIdentityRateLimit(
      new Request("https://example.test", {
        headers: { "x-ingress-client-ip": "192.0.2.1, 198.51.100.2" },
      }),
    );

    expect(missing?.status).toBe(503);
    expect(missing?.headers.get("cache-control")).toBe("no-store");
    expect(invalid?.status).toBe(503);
    expect(invalid?.headers.get("cache-control")).toBe("no-store");
  });
});
