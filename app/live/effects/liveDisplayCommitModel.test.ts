import { describe, expect, it } from "vitest";

import {
  getLiveDisplayCommitOwner,
  reconcileLiveDisplayCommit,
  resolveLiveDisplayCommit,
} from "./liveDisplayCommitModel";

import type { LiveEffectCue, LiveVictoryEffectCue } from "./liveEffectCues";
import type { GamePhase, RoomStatus, RoomSummary } from "@/lib/shared/game";

describe("live display commit model", () => {
  it("assigns a batched snapshot to the last cinematic cue", () => {
    const voteCue = makeCue("vote", "vote");
    const deathCue = makeCue("death", "death");
    const victoryCue = makeCue("victory", "victory");

    expect(getLiveDisplayCommitOwner([voteCue, deathCue, victoryCue])).toBe(victoryCue);
  });

  it("defers an ended snapshot until its owner animation requests the display commit", () => {
    const ended = makeSummary({ snapshotRevision: 2, status: "ended" });
    const victoryCue = makeCue("victory", "victory");
    const deferred = reconcileLiveDisplayCommit(null, ended, victoryCue, [victoryCue]);

    expect(deferred).toEqual({
      kind: "defer",
      ticket: {
        cueId: victoryCue.id,
        gameId: victoryCue.gameId,
        roomCode: victoryCue.roomCode,
        summary: ended,
        viewerPlayerId: ended.currentPlayerId,
      },
    });

    if (deferred.kind !== "defer") {
      throw new Error("The ended snapshot was not deferred.");
    }

    expect(resolveLiveDisplayCommit(deferred.ticket, makeCue("death", "death"), ended)).toBeNull();
    expect(resolveLiveDisplayCommit(deferred.ticket, victoryCue, ended)).toBe(ended);
  });

  it("keeps the latest accepted snapshot behind an existing owner cue", () => {
    const first = makeSummary({ snapshotRevision: 2, status: "playing" });
    const latest = makeSummary({ snapshotRevision: 3, status: "playing" });
    const phaseCue = makeCue("phase", "phase");
    const initial = reconcileLiveDisplayCommit(null, first, phaseCue, [phaseCue]);

    if (initial.kind !== "defer") {
      throw new Error("The phase snapshot was not deferred.");
    }

    const updated = reconcileLiveDisplayCommit(initial.ticket, latest, null, [phaseCue]);

    expect(updated).toMatchObject({
      kind: "defer",
      ticket: { cueId: phaseCue.id, summary: latest },
    });
  });

  it("hands the latest snapshot to a superseding owner and rejects the old callback", () => {
    const first = makeSummary({ snapshotRevision: 2, status: "playing" });
    const latest = makeSummary({ snapshotRevision: 3, status: "ended" });
    const phaseCue = makeCue("phase", "phase");
    const victoryCue = makeCue("victory", "victory");
    const initial = reconcileLiveDisplayCommit(null, first, phaseCue, [phaseCue]);

    if (initial.kind !== "defer") {
      throw new Error("The phase snapshot was not deferred.");
    }

    const superseded = reconcileLiveDisplayCommit(initial.ticket, latest, victoryCue, [victoryCue]);

    if (superseded.kind !== "defer") {
      throw new Error("The victory snapshot was not deferred.");
    }

    expect(superseded.ticket).toMatchObject({ cueId: victoryCue.id, summary: latest });
    expect(resolveLiveDisplayCommit(superseded.ticket, phaseCue, latest)).toBeNull();
    expect(resolveLiveDisplayCommit(superseded.ticket, victoryCue, latest)).toBe(latest);
  });

  it("settles immediately when there is no cinematic owner or the owner was discarded", () => {
    const first = makeSummary({ snapshotRevision: 2, status: "playing" });
    const latest = makeSummary({ snapshotRevision: 3, status: "playing" });
    const phaseCue = makeCue("phase", "phase");
    const initial = reconcileLiveDisplayCommit(null, first, phaseCue, [phaseCue]);

    if (initial.kind !== "defer") {
      throw new Error("The phase snapshot was not deferred.");
    }

    expect(reconcileLiveDisplayCommit(null, first, null, [])).toEqual({
      kind: "display",
      summary: first,
    });
    expect(reconcileLiveDisplayCommit(initial.ticket, latest, null, [])).toEqual({
      kind: "display",
      summary: latest,
    });
    expect(reconcileLiveDisplayCommit(initial.ticket, latest, null, [phaseCue], true)).toEqual({
      kind: "display",
      summary: latest,
    });
    expect(reconcileLiveDisplayCommit(null, latest, phaseCue, [phaseCue], true)).toEqual({
      kind: "display",
      summary: latest,
    });
  });

  it("rejects stale callbacks after the accepted snapshot changes session or revision", () => {
    const ended = makeSummary({ snapshotRevision: 2, status: "ended" });
    const victoryCue = makeCue("victory", "victory");
    const deferred = reconcileLiveDisplayCommit(null, ended, victoryCue, [victoryCue]);

    if (deferred.kind !== "defer") {
      throw new Error("The ended snapshot was not deferred.");
    }

    expect(
      resolveLiveDisplayCommit(
        deferred.ticket,
        victoryCue,
        makeSummary({ snapshotRevision: 3, status: "ended" }),
      ),
    ).toBeNull();
    expect(
      resolveLiveDisplayCommit(
        deferred.ticket,
        victoryCue,
        makeSummary({ code: "654321", snapshotRevision: 2, status: "ended" }),
      ),
    ).toBeNull();
  });
});

function makeCue(id: string, kind: LiveEffectCue["kind"]): LiveEffectCue {
  const base = {
    eventIds: [],
    gameId: "game-a",
    id,
    roomCode: "123456",
  };

  switch (kind) {
    case "death":
      return { ...base, kind, playerIds: ["alice"] };
    case "phase":
      return {
        ...base,
        dayNumber: 1,
        kind,
        nightNumber: 1,
        phase: "day",
      };
    case "role":
      return {
        ...base,
        kind,
        playerId: "alice",
        roleId: "villager",
        source: "automatic",
      };
    case "vote":
      return {
        ...base,
        dayNumber: 1,
        kind,
        outcome: { kind: "no_votes" },
        rows: [],
        visibility: "count_only",
      };
    case "victory":
      return {
        ...base,
        kind,
        playerResult: "win",
        winnerTeam: "villagers",
      } satisfies LiveVictoryEffectCue;
  }
}

function makeSummary({
  code = "123456",
  snapshotRevision,
  status,
}: {
  readonly code?: string;
  readonly snapshotRevision: number;
  readonly status: RoomStatus;
}): RoomSummary {
  const hasGame = status === "playing" || status === "ended";
  const phase: GamePhase | null = status === "playing" ? "day" : null;

  return {
    code,
    currentPlayerId: "alice",
    defaultRoleCounts: {},
    game: hasGame
      ? {
          actionProgress: null,
          dayNumber: 1,
          events: [],
          gameId: "game-a",
          nightNumber: 1,
          phase,
          phaseEndsAt: null,
          phaseFocus: null,
          phaseInstanceId: phase === null ? null : "phase-a",
          revision: snapshotRevision,
          status,
          winnerTeam: status === "ended" ? "villagers" : null,
        }
      : null,
    hostPlayerId: "alice",
    isHost: true,
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
    players: [],
    roleCatalog: [],
    rolePrivate: null,
    rosterRevision: 1,
    self: null,
    snapshotRevision,
    status,
    targetPlayerCount: 3,
    teamCatalog: [],
  };
}
