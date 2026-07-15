import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/authenticatedRoute", () => ({
  requireAccount: vi.fn(async () => ({ account: { id: 1 } })),
}));

vi.mock("@/lib/server/gameRepository", () => ({
  setRoomReadiness: vi.fn(),
  startGame: vi.fn(),
  submitAction: vi.fn(),
  submitNightConversationMessage: vi.fn(),
}));

import {
  setRoomReadiness,
  startGame,
  submitAction,
  submitNightConversationMessage,
} from "@/lib/server/gameRepository";
import { toGameRepositoryError } from "@/lib/server/gameRepositoryErrors";

import { POST as submitActionRoute } from "./action/route";
import { POST as sendNightConversationRoute } from "./night-conversation/route";
import { POST as setReadinessRoute } from "./readiness/route";
import { POST as startGameRoute } from "./start/route";

const context = { params: Promise.resolve({ roomCode: "123456" }) };

describe("Game mutation route IDs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed action gameId before repository access", async () => {
    const response = await submitActionRoute(
      makeJsonRequest({
        actionKey: "vote:1",
        gameId: "not-a-uuid",
        phaseInstanceId: "550e8400-e29b-41d4-a716-446655440010",
        revision: 1,
        targetPlayerId: null,
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "gameId must be a UUID." },
    });
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("rejects a malformed night-conversation gameId before repository access", async () => {
    const response = await sendNightConversationRoute(
      makeJsonRequest({
        body: "hello",
        conversationGroupId: "werewolf_pack",
        gameId: "550e8400",
        nightNumber: 1,
        phaseInstanceId: "550e8400-e29b-41d4-a716-446655440010",
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "gameId must be a UUID." },
    });
    expect(submitNightConversationMessage).not.toHaveBeenCalled();
  });

  it("requires the roster revision when starting a Game", async () => {
    const response = await startGameRoute(makeJsonRequest({}), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "expectedRosterRevision is required." },
    });
    expect(startGame).not.toHaveBeenCalled();
  });

  it("reports a presence change during start as players not ready", async () => {
    vi.mocked(startGame).mockRejectedValueOnce(toGameRepositoryError("room_players_changed"));

    const response = await startGameRoute(makeJsonRequest({ expectedRosterRevision: 1 }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "players_not_ready" },
    });
  });

  it("requires a boolean readiness value and roster revision", async () => {
    const invalidReadyResponse = await setReadinessRoute(
      makeJsonRequest({ expectedRosterRevision: 1, isReady: "yes" }),
      context,
    );
    const missingRevisionResponse = await setReadinessRoute(
      makeJsonRequest({ isReady: true }),
      context,
    );

    expect(invalidReadyResponse.status).toBe(400);
    expect(missingRevisionResponse.status).toBe(400);
    expect(setRoomReadiness).not.toHaveBeenCalled();
  });
});

function makeJsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/rooms/123456/mutation", {
    body: JSON.stringify(body),
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    method: "POST",
  });
}
