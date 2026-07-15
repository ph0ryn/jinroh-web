import { describe, expect, it } from "vitest";

import { localizations } from "@/lib/i18n/localization";

import {
  canStartRoom,
  countLobbyReadyPlayers,
  getLiveDocumentTitle,
  getLobbyReadinessHint,
} from "./livePresentation";

import type { PublicPlayer, RoomSummary } from "@/lib/shared/game";

describe("live lobby presentation", () => {
  it("identifies the live surface and accepted room in the document title", () => {
    expect(getLiveDocumentTitle(null, localizations.en)).toBe("Enter room — Jinroh Web");
    expect(getLiveDocumentTitle(makeSummary("waiting", []), localizations.en)).toBe(
      "Waiting · 123456 — Jinroh Web",
    );
    const ended = makeSummary("ended", []);
    ended.game = {
      actionProgress: null,
      dayNumber: 2,
      events: [],
      gameId: "game-a",
      nightNumber: 1,
      phase: null,
      phaseEndsAt: null,
      phaseFocus: null,
      phaseInstanceId: null,
      revision: 1,
      status: "ended",
      winnerTeam: "villagers",
    };

    expect(getLiveDocumentTitle(ended, localizations.ja)).toBe("結果 · 123456 — Jinroh Web");
  });

  it("requires an exact connected and ready roster before either first play or replay", () => {
    const waiting = makeSummary("waiting", [
      makePlayer("alice", true),
      makePlayer("blair", true),
      makePlayer("casey", false),
    ]);

    expect(canStartRoom(waiting)).toBe(false);
    expect(countLobbyReadyPlayers(waiting)).toBe(2);
    expect(getLobbyReadinessHint(waiting, localizations.en)).toBe("1 player is not ready yet.");

    const ready = {
      ...waiting,
      players: waiting.players.map((player) => ({ ...player, isLobbyReady: true })),
    };

    expect(canStartRoom(ready)).toBe(true);
    expect(canStartRoom({ ...ready, status: "ended" })).toBe(true);
  });

  it("keeps readiness but blocks start while a participant is disconnected", () => {
    const summary = makeSummary("ended", [
      makePlayer("alice", true),
      makePlayer("blair", true, "disconnected"),
      makePlayer("casey", true),
    ]);

    expect(canStartRoom(summary)).toBe(false);
    expect(getLobbyReadinessHint(summary, localizations.en)).toBe(
      "1 player must reconnect before starting.",
    );
  });
});

function makePlayer(
  id: string,
  isLobbyReady: boolean,
  status: PublicPlayer["status"] = "joined",
): PublicPlayer {
  return {
    alive: null,
    displayName: id,
    id,
    isCurrent: id === "alice",
    isHost: id === "alice",
    isLobbyReady,
    revealedRoleId: null,
    status,
  };
}

function makeSummary(
  status: Extract<RoomSummary["status"], "ended" | "waiting">,
  players: PublicPlayer[],
): RoomSummary {
  return {
    code: "123456",
    currentPlayerId: "alice",
    defaultRoleCounts: {},
    game: null,
    hostPlayerId: "alice",
    isHost: true,
    players,
    roleCatalog: [],
    rolePrivate: null,
    rosterRevision: 1,
    self: null,
    snapshotRevision: 1,
    status,
    targetPlayerCount: 3,
    teamCatalog: [],
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
