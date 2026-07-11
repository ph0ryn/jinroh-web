import { describe, expect, it } from "vitest";

import {
  createLiveRoundTableMotionSnapshot,
  getLiveRoundTableMotionChanges,
  getLiveRoundTableMotionSnapshotKey,
  hasLiveRoundTableMotionChanges,
  reconcileLiveRoundTableMotion,
  type LiveRoundTableMotionChanges,
  type LiveRoundTableMotionSeat,
  type LiveRoundTableMotionSnapshot,
} from "./liveRoundTableMotionModel";

import type { LiveSeatState } from "../../liveSeatPresentation";
import type { PublicPlayer, RoomSummary } from "@/lib/shared/game";

describe("live round table motion model", () => {
  it("treats the first snapshot and effect-session changes as baselines", () => {
    const initial = makeSnapshot({ seats: [makeSeat("alice", 1)] });
    const otherRoom = makeSnapshot({ roomCode: "654321", seats: [makeSeat("alice", 1)] });
    const otherViewer = makeSnapshot({ seats: [makeSeat("alice", 1)], viewerPlayerId: "blair" });

    expect(getLiveRoundTableMotionChanges(null, initial)).toEqual(emptyChanges());
    expect(getLiveRoundTableMotionChanges(initial, otherRoom)).toEqual(emptyChanges());
    expect(getLiveRoundTableMotionChanges(initial, otherViewer)).toEqual(emptyChanges());
  });

  it("does not react to revisions or data outside the public seat presentation", () => {
    const firstSummary = makeSummary();
    const secondSummary: RoomSummary = {
      ...firstSummary,
      game: {
        ...firstSummary.game!,
        actionProgress: {
          kind: "votes_submitted",
          label: "Votes submitted.",
          required: 3,
          submitted: 2,
          visibility: "public",
        },
        revision: 99,
      },
      snapshotRevision: 42,
    };
    const first = createLiveRoundTableMotionSnapshot(firstSummary);
    const second = createLiveRoundTableMotionSnapshot(secondSummary);

    expect(getLiveRoundTableMotionSnapshotKey(second)).toBe(
      getLiveRoundTableMotionSnapshotKey(first),
    );
    expect(getLiveRoundTableMotionChanges(first, second)).toEqual(emptyChanges());
  });

  it("projects player materialization, seat movement, and a newly empty slot", () => {
    const initial = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("blair", 2), makeSeat("casey", 3)],
    });
    const afterLeave = makeSnapshot({
      emptySeatNumbers: [3],
      seats: [makeSeat("alice", 1), makeSeat("casey", 2)],
    });
    const afterJoin = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("casey", 2), makeSeat("devon", 3)],
    });

    expect(getLiveRoundTableMotionChanges(initial, afterLeave)).toEqual({
      ...emptyChanges(),
      emptyMaterializedSeatNumbers: [3],
      movedPlayerIds: ["casey"],
    });
    expect(getLiveRoundTableMotionChanges(afterLeave, afterJoin)).toEqual({
      ...emptyChanges(),
      materializedPlayerIds: ["devon"],
    });
  });

  it("projects public speaking and execution focus only when it changes", () => {
    const active = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("blair", 2)],
    });
    const aliceSpeaking = makeSnapshot({
      seats: [makeSeat("alice", 1, "speaking"), makeSeat("blair", 2)],
    });
    const blairSpeaking = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("blair", 2, "speaking")],
    });
    const blairExecution = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("blair", 2, "execution")],
    });

    expect(getLiveRoundTableMotionChanges(active, aliceSpeaking)).toEqual({
      ...emptyChanges(),
      speakingPlayerIds: ["alice"],
    });
    expect(getLiveRoundTableMotionChanges(aliceSpeaking, aliceSpeaking)).toEqual(emptyChanges());
    expect(getLiveRoundTableMotionChanges(aliceSpeaking, blairSpeaking)).toEqual({
      ...emptyChanges(),
      speakingPlayerIds: ["blair"],
    });
    expect(getLiveRoundTableMotionChanges(blairSpeaking, blairExecution)).toEqual({
      ...emptyChanges(),
      executionPlayerIds: ["blair"],
    });
  });

  it("gives reconnect feedback precedence over focus feedback", () => {
    const active = makeSnapshot({ seats: [makeSeat("alice", 1)] });
    const disconnected = makeSnapshot({
      seats: [makeSeat("alice", 1, "disconnected")],
    });
    const reconnectedSpeaking = makeSnapshot({
      seats: [makeSeat("alice", 1, "speaking")],
    });

    expect(getLiveRoundTableMotionChanges(active, disconnected)).toEqual({
      ...emptyChanges(),
      disconnectedPlayerIds: ["alice"],
    });
    expect(getLiveRoundTableMotionChanges(disconnected, reconnectedSpeaking)).toEqual({
      ...emptyChanges(),
      reconnectedPlayerIds: ["alice"],
    });
  });

  it("leaves elimination entirely to the death effect", () => {
    const active = makeSnapshot({ seats: [makeSeat("alice", 1)] });
    const eliminated = makeSnapshot({
      seats: [makeSeat("alice", 2, "eliminated")],
    });
    const firstSeenEliminated = makeSnapshot({
      seats: [makeSeat("blair", 2, "eliminated")],
    });

    expect(getLiveRoundTableMotionChanges(active, eliminated)).toEqual(emptyChanges());
    expect(getLiveRoundTableMotionChanges(eliminated, active)).toEqual(emptyChanges());
    expect(getLiveRoundTableMotionChanges(active, firstSeenEliminated)).toEqual(emptyChanges());
  });

  it("settles hidden updates as the next visible baseline", () => {
    const initial = makeSnapshot({ seats: [makeSeat("alice", 1)] });
    const hiddenUpdate = makeSnapshot({
      seats: [makeSeat("alice", 1), makeSeat("blair", 2)],
    });
    const hiddenReconciliation = reconcileLiveRoundTableMotion(initial, hiddenUpdate, false);
    const visibleReconciliation = reconcileLiveRoundTableMotion(
      hiddenReconciliation.snapshot,
      hiddenUpdate,
      true,
    );

    expect(hasLiveRoundTableMotionChanges(hiddenReconciliation.changes)).toBe(false);
    expect(visibleReconciliation.changes).toEqual(emptyChanges());
  });
});

function emptyChanges(): LiveRoundTableMotionChanges {
  return {
    disconnectedPlayerIds: [],
    emptyMaterializedSeatNumbers: [],
    executionPlayerIds: [],
    materializedPlayerIds: [],
    movedPlayerIds: [],
    reconnectedPlayerIds: [],
    speakingPlayerIds: [],
  };
}

function makeSnapshot({
  emptySeatNumbers = [],
  roomCode = "123456",
  seats,
  viewerPlayerId = "alice",
}: {
  readonly emptySeatNumbers?: readonly number[];
  readonly roomCode?: string;
  readonly seats: readonly LiveRoundTableMotionSeat[];
  readonly viewerPlayerId?: string | null;
}): LiveRoundTableMotionSnapshot {
  return { emptySeatNumbers, roomCode, seats, viewerPlayerId };
}

function makeSeat(
  playerId: string,
  seatNumber: number,
  presentationState: LiveSeatState = "active",
): LiveRoundTableMotionSeat {
  return {
    playerId,
    presentationState,
    seatNumber,
    x: seatNumber * 10,
    y: seatNumber * 12,
  };
}

function makeSummary(): RoomSummary {
  const players: PublicPlayer[] = [
    {
      alive: true,
      displayName: "Alice",
      id: "alice",
      isCurrent: true,
      isHost: true,
      revealedRoleId: null,
      status: "joined",
    },
    {
      alive: true,
      displayName: "Blair",
      id: "blair",
      isCurrent: false,
      isHost: false,
      revealedRoleId: null,
      status: "joined",
    },
  ];

  return {
    code: "123456",
    currentPlayerId: "alice",
    defaultRoleCounts: {},
    game: {
      actionProgress: null,
      dayNumber: 1,
      events: [],
      nightNumber: 1,
      phase: "day",
      phaseEndsAt: null,
      phaseFocus: null,
      phaseInstanceId: "phase-1",
      revision: 1,
      status: "playing",
      winnerTeam: null,
    },
    hostPlayerId: "alice",
    isHost: true,
    players,
    roleCatalog: [],
    rolePrivate: null,
    self: null,
    snapshotRevision: 1,
    status: "playing",
    targetPlayerCount: 2,
    waitingExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
