import { describe, expect, it } from "vitest";

import {
  createLiveLobbyProgressSnapshot,
  getLiveLobbyProgressChange,
  getLiveLobbyProgressRatio,
  getLiveLobbyProgressSnapshotKey,
  getLiveLobbyProgressState,
  reconcileLiveLobbyProgress,
  type LiveLobbyProgressSnapshot,
} from "./liveLobbyProgressModel";

import type { PublicPlayer } from "@/lib/shared/game";

const HOST: PublicPlayer = {
  alive: null,
  displayName: "Aster",
  id: "aster",
  isCurrent: true,
  isHost: true,
  revealedRoleId: null,
  status: "joined",
};

describe("live lobby progress model", () => {
  it("projects only aggregate joined progress from a room summary", () => {
    const first = createLiveLobbyProgressSnapshot({
      code: "123456",
      currentPlayerId: HOST.id,
      players: [HOST, makePlayer("birch", "joined"), makePlayer("cedar", "disconnected")],
      status: "waiting",
      targetPlayerCount: 4,
    });
    const replacement = createLiveLobbyProgressSnapshot({
      code: "123456",
      currentPlayerId: HOST.id,
      players: [HOST, makePlayer("dahlia", "joined"), makePlayer("elm", "left")],
      status: "waiting",
      targetPlayerCount: 4,
    });

    expect(first.joinedPlayerCount).toBe(2);
    expect(getLiveLobbyProgressSnapshotKey(first)).toBe(
      getLiveLobbyProgressSnapshotKey(replacement),
    );
  });

  it("treats the first snapshot and room, viewer, or target changes as baselines", () => {
    const current = makeSnapshot({ joinedPlayerCount: 1 });

    expect(getLiveLobbyProgressChange(null, current)).toBeNull();
    expect(
      getLiveLobbyProgressChange(
        current,
        makeSnapshot({ joinedPlayerCount: 2, roomCode: "654321" }),
      ),
    ).toBeNull();
    expect(
      getLiveLobbyProgressChange(
        current,
        makeSnapshot({ joinedPlayerCount: 2, viewerPlayerId: "birch" }),
      ),
    ).toBeNull();
    expect(
      getLiveLobbyProgressChange(
        current,
        makeSnapshot({ joinedPlayerCount: 2, targetPlayerCount: 4 }),
      ),
    ).toBeNull();
  });

  it("classifies accepted aggregate increases without depending on player identity", () => {
    expect(
      getLiveLobbyProgressChange(
        makeSnapshot({ joinedPlayerCount: 1 }),
        makeSnapshot({ joinedPlayerCount: 2 }),
      ),
    ).toEqual({
      direction: "increase",
      kind: "increase",
      previousJoinedPlayerCount: 1,
    });
  });

  it("promotes exact target arrival to a ready change", () => {
    expect(
      getLiveLobbyProgressChange(
        makeSnapshot({ joinedPlayerCount: 2 }),
        makeSnapshot({ joinedPlayerCount: 3 }),
      ),
    ).toEqual({
      direction: "increase",
      kind: "ready",
      previousJoinedPlayerCount: 2,
    });
    expect(
      getLiveLobbyProgressChange(
        makeSnapshot({ joinedPlayerCount: 4 }),
        makeSnapshot({ joinedPlayerCount: 3 }),
      ),
    ).toEqual({
      direction: "decrease",
      kind: "ready",
      previousJoinedPlayerCount: 4,
    });
  });

  it("classifies departures and disconnects as aggregate decreases", () => {
    expect(
      getLiveLobbyProgressChange(
        makeSnapshot({ joinedPlayerCount: 3 }),
        makeSnapshot({ joinedPlayerCount: 2 }),
      ),
    ).toEqual({
      direction: "decrease",
      kind: "decrease",
      previousJoinedPlayerCount: 3,
    });
  });

  it("does not animate unchanged polling or changes outside the waiting room", () => {
    const current = makeSnapshot({ joinedPlayerCount: 2 });

    expect(getLiveLobbyProgressChange(current, current)).toBeNull();
    expect(
      getLiveLobbyProgressChange(
        current,
        makeSnapshot({ joinedPlayerCount: 3, roomStatus: "playing" }),
      ),
    ).toBeNull();
  });

  it("settles hidden and reduced-motion updates without replaying them later", () => {
    const first = makeSnapshot({ joinedPlayerCount: 1 });
    const second = makeSnapshot({ joinedPlayerCount: 2 });
    const settled = reconcileLiveLobbyProgress(first, second, false);

    expect(settled.change).toBeNull();
    expect(reconcileLiveLobbyProgress(settled.snapshot, second, true).change).toBeNull();
  });

  it("keeps waiting, ready, and overfilled static states truthful", () => {
    const waiting = makeSnapshot({ joinedPlayerCount: 2 });
    const ready = makeSnapshot({ joinedPlayerCount: 3 });
    const overfilled = makeSnapshot({ joinedPlayerCount: 4 });

    expect(getLiveLobbyProgressState(waiting)).toBe("waiting");
    expect(getLiveLobbyProgressState(ready)).toBe("ready");
    expect(getLiveLobbyProgressState(overfilled)).toBe("overfilled");
    expect(getLiveLobbyProgressRatio(waiting)).toBeCloseTo(2 / 3);
    expect(getLiveLobbyProgressRatio(ready)).toBe(1);
    expect(getLiveLobbyProgressRatio(overfilled)).toBe(1);
  });
});

function makeSnapshot({
  joinedPlayerCount,
  roomCode = "123456",
  roomStatus = "waiting",
  targetPlayerCount = 3,
  viewerPlayerId = HOST.id,
}: {
  readonly joinedPlayerCount: number;
  readonly roomCode?: string;
  readonly roomStatus?: LiveLobbyProgressSnapshot["roomStatus"];
  readonly targetPlayerCount?: number;
  readonly viewerPlayerId?: string | null;
}): LiveLobbyProgressSnapshot {
  return {
    joinedPlayerCount,
    roomCode,
    roomStatus,
    targetPlayerCount,
    viewerPlayerId,
  };
}

function makePlayer(id: string, status: PublicPlayer["status"]): PublicPlayer {
  return {
    alive: null,
    displayName: id,
    id,
    isCurrent: false,
    isHost: false,
    revealedRoleId: null,
    status,
  };
}
