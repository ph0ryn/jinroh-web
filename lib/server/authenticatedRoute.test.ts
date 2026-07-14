import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireAccount } from "./authenticatedRoute";
import { authenticate } from "./gameRepository";

vi.mock("./gameRepository", () => ({
  authenticate: vi.fn(),
}));

const mockedAuthenticate = vi.mocked(authenticate);

describe("authenticated route helper", () => {
  beforeEach(() => {
    mockedAuthenticate.mockReset();
  });

  it("returns a stable 401 response when the bearer token is missing", async () => {
    const result = await requireAccount(new Request("https://jinroh.example/api"));

    expect("response" in result).toBe(true);
    expect(mockedAuthenticate).not.toHaveBeenCalled();

    if ("response" in result) {
      await expectApiError(result.response, 401, "unauthorized");
    }
  });

  it("returns a stable 401 response when authentication fails", async () => {
    mockedAuthenticate.mockResolvedValue(null);

    const result = await requireAccount(
      new Request("https://jinroh.example/api", {
        headers: { authorization: "Bearer jat_unknown" },
      }),
    );

    expect(mockedAuthenticate).toHaveBeenCalledWith("jat_unknown");
    expect("response" in result).toBe(true);

    if ("response" in result) {
      await expectApiError(result.response, 401, "unauthorized");
    }
  });

  it("preserves repository outages as a server error", async () => {
    mockedAuthenticate.mockRejectedValue(new Error("database unavailable"));

    const result = await requireAccount(
      new Request("https://jinroh.example/api", {
        headers: { authorization: "Bearer jat_known" },
      }),
    );

    expect("response" in result).toBe(true);

    if ("response" in result) {
      await expectApiError(result.response, 500, "server_error");
    }
  });

  it("returns the authenticated account without exposing token details", async () => {
    mockedAuthenticate.mockResolvedValue({ id: 42 });

    const result = await requireAccount(
      new Request("https://jinroh.example/api", {
        headers: { authorization: "Bearer jat_known" },
      }),
    );

    expect(result).toEqual({ account: { id: 42 } });
    expect(mockedAuthenticate).toHaveBeenCalledWith("jat_known");
  });
});

async function expectApiError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);

  const body = (await response.json()) as {
    readonly error?: { readonly code?: unknown; readonly message?: unknown };
  };

  expect(body).toEqual({
    error: {
      code,
      message: expect.any(String),
    },
  });
  expect(String(body.error?.message).trim()).not.toBe("");
}
