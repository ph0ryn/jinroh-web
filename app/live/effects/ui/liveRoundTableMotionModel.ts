import { getLiveRoundTableSeats } from "../../liveRoundTableModel";
import { getLiveSeatState } from "../../liveSeatPresentation";

import type { LiveSeatState } from "../../liveSeatPresentation";
import type { RoomSummary } from "@/lib/shared/game";

export type LiveRoundTableMotionSeat = {
  readonly playerId: string;
  readonly presentationState: LiveSeatState;
  readonly seatNumber: number;
  readonly x: number;
  readonly y: number;
};

export type LiveRoundTableMotionSnapshot = {
  readonly emptySeatNumbers: readonly number[];
  readonly roomCode: string;
  readonly seats: readonly LiveRoundTableMotionSeat[];
  readonly viewerPlayerId: string | null;
};

export type LiveRoundTableMotionChanges = {
  readonly disconnectedPlayerIds: readonly string[];
  readonly emptyMaterializedSeatNumbers: readonly number[];
  readonly executionPlayerIds: readonly string[];
  readonly materializedPlayerIds: readonly string[];
  readonly movedPlayerIds: readonly string[];
  readonly reconnectedPlayerIds: readonly string[];
  readonly speakingPlayerIds: readonly string[];
};

export type ReconciledLiveRoundTableMotion = {
  readonly changes: LiveRoundTableMotionChanges;
  readonly snapshot: LiveRoundTableMotionSnapshot;
};

const EMPTY_CHANGES: LiveRoundTableMotionChanges = {
  disconnectedPlayerIds: [],
  emptyMaterializedSeatNumbers: [],
  executionPlayerIds: [],
  materializedPlayerIds: [],
  movedPlayerIds: [],
  reconnectedPlayerIds: [],
  speakingPlayerIds: [],
};

export function createLiveRoundTableMotionSnapshot(
  summary: RoomSummary,
): LiveRoundTableMotionSnapshot {
  const roundTableSeats = getLiveRoundTableSeats(summary);
  const seats = roundTableSeats.flatMap(
    ({ player, seatNumber, x, y }): LiveRoundTableMotionSeat[] => {
      if (player === null) {
        return [];
      }

      return [
        {
          playerId: player.id,
          presentationState: getLiveSeatState(player, summary),
          seatNumber,
          x,
          y,
        },
      ];
    },
  );

  return {
    emptySeatNumbers: roundTableSeats.flatMap(({ player, seatNumber }) =>
      player === null ? [seatNumber] : [],
    ),
    roomCode: summary.code,
    seats,
    viewerPlayerId: summary.currentPlayerId,
  };
}

export function getLiveRoundTableMotionSnapshotKey(snapshot: LiveRoundTableMotionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function getLiveRoundTableMotionChanges(
  previousSnapshot: LiveRoundTableMotionSnapshot | null,
  nextSnapshot: LiveRoundTableMotionSnapshot,
): LiveRoundTableMotionChanges {
  if (
    previousSnapshot === null ||
    previousSnapshot.roomCode !== nextSnapshot.roomCode ||
    previousSnapshot.viewerPlayerId !== nextSnapshot.viewerPlayerId
  ) {
    return EMPTY_CHANGES;
  }

  const previousSeats = new Map(
    previousSnapshot.seats.map((seat) => [seat.playerId, seat] as const),
  );
  const disconnectedPlayerIds: string[] = [];
  const emptyMaterializedSeatNumbers = nextSnapshot.emptySeatNumbers.filter(
    (seatNumber) => !previousSnapshot.emptySeatNumbers.includes(seatNumber),
  );
  const executionPlayerIds: string[] = [];
  const materializedPlayerIds: string[] = [];
  const movedPlayerIds: string[] = [];
  const reconnectedPlayerIds: string[] = [];
  const speakingPlayerIds: string[] = [];

  for (const nextSeat of nextSnapshot.seats) {
    const previousSeat = previousSeats.get(nextSeat.playerId);

    if (previousSeat === undefined) {
      if (nextSeat.presentationState !== "eliminated") {
        materializedPlayerIds.push(nextSeat.playerId);
      }

      continue;
    }

    if (
      previousSeat.presentationState === "eliminated" ||
      nextSeat.presentationState === "eliminated"
    ) {
      continue;
    }

    if (
      previousSeat.seatNumber !== nextSeat.seatNumber ||
      previousSeat.x !== nextSeat.x ||
      previousSeat.y !== nextSeat.y
    ) {
      movedPlayerIds.push(nextSeat.playerId);
    }

    if (
      !isInactivePresentationState(previousSeat.presentationState) &&
      isInactivePresentationState(nextSeat.presentationState)
    ) {
      disconnectedPlayerIds.push(nextSeat.playerId);
    }

    if (
      isInactivePresentationState(previousSeat.presentationState) &&
      isConnectedPresentationState(nextSeat.presentationState)
    ) {
      reconnectedPlayerIds.push(nextSeat.playerId);
      continue;
    }

    if (
      previousSeat.presentationState !== "speaking" &&
      nextSeat.presentationState === "speaking"
    ) {
      speakingPlayerIds.push(nextSeat.playerId);
    }

    if (
      previousSeat.presentationState !== "execution" &&
      nextSeat.presentationState === "execution"
    ) {
      executionPlayerIds.push(nextSeat.playerId);
    }
  }

  return {
    disconnectedPlayerIds,
    emptyMaterializedSeatNumbers,
    executionPlayerIds,
    materializedPlayerIds,
    movedPlayerIds,
    reconnectedPlayerIds,
    speakingPlayerIds,
  };
}

export function reconcileLiveRoundTableMotion(
  previousSnapshot: LiveRoundTableMotionSnapshot | null,
  nextSnapshot: LiveRoundTableMotionSnapshot,
  shouldAnimate: boolean,
): ReconciledLiveRoundTableMotion {
  return {
    changes: shouldAnimate
      ? getLiveRoundTableMotionChanges(previousSnapshot, nextSnapshot)
      : EMPTY_CHANGES,
    snapshot: nextSnapshot,
  };
}

export function hasLiveRoundTableMotionChanges(changes: LiveRoundTableMotionChanges): boolean {
  return Object.values(changes).some((values) => values.length > 0);
}

function isConnectedPresentationState(state: LiveSeatState): boolean {
  return state === "active" || state === "execution" || state === "speaking";
}

function isInactivePresentationState(state: LiveSeatState): boolean {
  return state === "disconnected" || state === "left";
}
