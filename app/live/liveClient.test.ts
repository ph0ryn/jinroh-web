import { afterEach, describe, expect, it, vi } from "vitest";

import { localizations } from "@/lib/i18n/localization";

import { apiFetch, isUnauthorizedRequestError, toRequestFailureMessage } from "./liveClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rate-limited API responses", () => {
  it("localizes Retry-After without treating 429 as an expired identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "rate_limited", message: "Too many attempts." },
          }),
          {
            headers: { "content-type": "application/json", "retry-after": "37" },
            status: 429,
          },
        ),
      ),
    );

    const error = await apiFetch("/api/identity", { method: "POST" }).catch(
      (reason: unknown) => reason,
    );

    expect(isUnauthorizedRequestError(error)).toBe(false);
    expect(toRequestFailureMessage(error, localizations.en)).toBe(
      "Too many attempts. Try again in 37 seconds.",
    );
    expect(toRequestFailureMessage(error, localizations.ja)).toBe(
      "操作が多すぎます。37秒待ってからもう一度お試しください。",
    );
  });
});
