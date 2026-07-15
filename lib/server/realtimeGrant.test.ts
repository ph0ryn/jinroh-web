import { describe, expect, it } from "vitest";

import { parseRealtimeGrantRpcResult } from "./realtimeGrant";

const baseRecord = {
  actor_player_id: 7,
  expires_at: "2099-01-01T00:02:00+00:00",
  game_id: null,
  grant_id: "550e8400-e29b-41d4-a716-446655440000",
  notification_reason: null,
  player_id: null,
  result_kind: "active",
  role_id: null,
  room_id: 3,
};

describe("realtime grant RPC parsing", () => {
  it("accepts the room and player-private subscriptions issued before a game starts", () => {
    expect(
      parseRealtimeGrantRpcResult([
        { ...baseRecord, scope: "room", topic: "room:public" },
        { ...baseRecord, player_id: 7, scope: "player_private", topic: "player:private" },
      ]),
    ).toEqual({
      actorPlayerId: 7,
      expiresAt: "2099-01-01T00:02:00+00:00",
      gameId: null,
      grantId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "active",
      roomId: 3,
      subscriptions: [
        { scope: "room", topic: "room:public" },
        { scope: "player_private", topic: "player:private" },
      ],
    });
  });

  it("accepts the additional role-private subscription issued after assignment", () => {
    const gameRecord = {
      ...baseRecord,
      game_id: "8d1fe495-7fc4-4c70-b0c0-4ce352987442",
    };
    const result = parseRealtimeGrantRpcResult([
      { ...gameRecord, scope: "room", topic: "room:public" },
      { ...gameRecord, player_id: 7, scope: "player_private", topic: "player:private" },
      { ...gameRecord, role_id: "werewolf", scope: "role_private", topic: "role:private" },
    ]);

    expect(result.kind).toBe("active");
    expect(result.kind === "active" ? result.subscriptions : []).toHaveLength(3);
  });

  it("rejects scope names that are not part of the database contract", () => {
    expect(() =>
      parseRealtimeGrantRpcResult([
        { ...baseRecord, scope: "room", topic: "room:public" },
        { ...baseRecord, player_id: 7, scope: "player", topic: "player:private" },
      ]),
    ).toThrow(/invalid subscription record/u);
  });

  it("rejects inconsistent grant metadata", () => {
    expect(() =>
      parseRealtimeGrantRpcResult([
        { ...baseRecord, scope: "room", topic: "room:public" },
        {
          ...baseRecord,
          grant_id: "8d1fe495-7fc4-4c70-b0c0-4ce352987442",
          player_id: 7,
          scope: "player_private",
          topic: "player:private",
        },
      ]),
    ).toThrow(/inconsistent subscription set/u);
  });

  it("parses the typed closed-Room sentinel", () => {
    expect(
      parseRealtimeGrantRpcResult([
        {
          actor_player_id: 7,
          expires_at: null,
          game_id: null,
          grant_id: null,
          notification_reason: "room_closed",
          player_id: null,
          result_kind: "room_closed",
          role_id: null,
          room_id: 3,
          scope: null,
          topic: null,
        },
      ]),
    ).toEqual({ actorPlayerId: 7, kind: "room_closed", roomId: 3 });
  });
});
