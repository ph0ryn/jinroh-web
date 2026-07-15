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

describe("replayable room conflicts", () => {
  it.each([
    [
      "players_not_ready",
      "Every connected player must be ready before the game can start.",
      "ゲーム開始には、接続中の全員が準備完了する必要があります。",
    ],
    [
      "roster_changed",
      "The player roster changed. Review readiness and try again.",
      "参加者が変わりました。準備状態を確認してもう一度お試しください。",
    ],
    [
      "game_changed",
      "The game changed. Review the latest room state and try again.",
      "ゲームが切り替わりました。最新の部屋状態を確認してもう一度お試しください。",
    ],
    [
      "room_closed",
      "That room is closed and can no longer be joined.",
      "その部屋は閉じられているため、参加できません。",
    ],
  ])("localizes %s", async (code, english, japanese) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: "Conflict." } }), {
          headers: { "content-type": "application/json" },
          status: 409,
        }),
      ),
    );

    const error = await apiFetch("/api/rooms/123456/start", { method: "POST" }).catch(
      (reason: unknown) => reason,
    );

    expect(toRequestFailureMessage(error, localizations.en)).toBe(english);
    expect(toRequestFailureMessage(error, localizations.ja)).toBe(japanese);
  });
});
