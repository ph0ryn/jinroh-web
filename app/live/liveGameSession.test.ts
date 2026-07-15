import { describe, expect, it } from "vitest";

import {
  getLiveGameSessionIdentity,
  getLiveGameSessionKey,
  hasLiveGameBoundary,
  isSameLiveRoomViewerSession,
} from "./liveGameSession";

import type { RoomSummary } from "@/lib/shared/game";

describe("live game session", () => {
  it("rotates the shared browser session key when a same-viewer Game is replaced", () => {
    const summary = makeSummary("game-a");
    const replay = makeSummary("game-b");

    expect(getLiveGameSessionIdentity(summary)).toEqual({
      gameId: "game-a",
      roomCode: "123456",
      viewerPlayerId: "alice",
    });
    expect(getLiveGameSessionKey(summary)).toBe('["123456","alice","game-a"]');
    expect(getLiveGameSessionKey(replay)).toBe('["123456","alice","game-b"]');
    expect(getLiveGameSessionKey(replay)).not.toBe(getLiveGameSessionKey(summary));
  });

  it("detects Game replacement and detachment without treating a room switch as one", () => {
    const ended = makeSummary("game-a");
    const cleanLobby = { ...ended, game: null, status: "waiting" as const };
    const replay = makeSummary("game-b");
    const otherRoom = { ...replay, code: "654321" };

    expect(isSameLiveRoomViewerSession(ended, cleanLobby)).toBe(true);
    expect(hasLiveGameBoundary(ended, cleanLobby)).toBe(true);
    expect(hasLiveGameBoundary(ended, replay)).toBe(true);
    expect(hasLiveGameBoundary(ended, otherRoom)).toBe(false);
  });
});

function makeSummary(gameId: string): RoomSummary {
  return {
    code: "123456",
    currentPlayerId: "alice",
    defaultRoleCounts: {},
    game: {
      actionProgress: null,
      dayNumber: 1,
      events: [],
      gameId,
      nightNumber: 1,
      phase: null,
      phaseEndsAt: null,
      phaseFocus: null,
      phaseInstanceId: null,
      revision: 1,
      status: "ended",
      winnerTeam: "villagers",
    },
    hostPlayerId: "alice",
    isHost: true,
    players: [],
    roleCatalog: [],
    rosterRevision: 2,
    rolePrivate: null,
    self: null,
    snapshotRevision: 2,
    status: "ended",
    targetPlayerCount: 3,
    teamCatalog: [],
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
