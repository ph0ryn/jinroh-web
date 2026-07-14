import { describe, expect, it } from "vitest";

import { jsonError, parseBearerToken, readJson } from "./http";

function requestWithAuthorization(value: string | null): Request {
  const headers = new Headers();

  if (value !== null) {
    headers.set("authorization", value);
  }

  return new Request("https://jinroh.example/api", { headers });
}

describe("HTTP route helpers", () => {
  it("parses a single opaque bearer token", () => {
    expect(parseBearerToken(requestWithAuthorization("Bearer jat_validToken"))).toBe(
      "jat_validToken",
    );
    expect(parseBearerToken(requestWithAuthorization("bearer jat_validToken"))).toBe(
      "jat_validToken",
    );
  });

  it("rejects missing, empty, malformed, and whitespace-bearing credentials", () => {
    expect(parseBearerToken(requestWithAuthorization(null))).toBeNull();
    expect(parseBearerToken(requestWithAuthorization(""))).toBeNull();
    expect(parseBearerToken(requestWithAuthorization("Basic jat_validToken"))).toBeNull();
    expect(parseBearerToken(requestWithAuthorization("Bearer"))).toBeNull();
    expect(parseBearerToken(requestWithAuthorization("Bearer "))).toBeNull();
    expect(parseBearerToken(requestWithAuthorization("Bearer token extra"))).toBeNull();
  });

  it("returns null instead of throwing on invalid JSON bodies", async () => {
    const request = new Request("https://jinroh.example/api", {
      body: "{invalid-json",
      method: "POST",
    });

    await expect(readJson(request)).resolves.toBeNull();
  });

  it("parses valid JSON bodies", async () => {
    const request = new Request("https://jinroh.example/api", {
      body: JSON.stringify({ fixture: true }),
      method: "POST",
    });

    await expect(readJson(request)).resolves.toEqual({ fixture: true });
  });

  it("serializes the supplied API error contract", async () => {
    const response = jsonError("conflict", "fixture message", 409);

    await expect(response.json()).resolves.toEqual({
      error: { code: "conflict", message: "fixture message" },
    });
    expect(response.status).toBe(409);
  });
});
