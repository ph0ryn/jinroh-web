import { countJoinedPlayers } from "../../livePresentation";

import type { RoomSummary } from "@/lib/shared/game";

type LiveLobbyProgressSummary = Pick<
  RoomSummary,
  "code" | "currentPlayerId" | "players" | "status" | "targetPlayerCount"
>;

export type LiveLobbyProgressState = "full" | "overfilled" | "waiting";

export type LiveLobbyProgressSnapshot = {
  readonly joinedPlayerCount: number;
  readonly roomCode: string;
  readonly roomStatus: RoomSummary["status"];
  readonly targetPlayerCount: number;
  readonly viewerPlayerId: string | null;
};

export type LiveLobbyProgressChange = {
  readonly direction: "decrease" | "increase";
  readonly kind: "decrease" | "full" | "increase";
  readonly previousJoinedPlayerCount: number;
};

export type ReconciledLiveLobbyProgress = {
  readonly change: LiveLobbyProgressChange | null;
  readonly snapshot: LiveLobbyProgressSnapshot;
};

export function createLiveLobbyProgressSnapshot(
  summary: LiveLobbyProgressSummary,
): LiveLobbyProgressSnapshot {
  return {
    joinedPlayerCount: countJoinedPlayers(summary),
    roomCode: summary.code,
    roomStatus: summary.status,
    targetPlayerCount: summary.targetPlayerCount,
    viewerPlayerId: summary.currentPlayerId,
  };
}

export function getLiveLobbyProgressSnapshotKey(snapshot: LiveLobbyProgressSnapshot): string {
  return JSON.stringify(snapshot);
}

export function getLiveLobbyProgressState(
  snapshot: LiveLobbyProgressSnapshot,
): LiveLobbyProgressState {
  if (snapshot.joinedPlayerCount > snapshot.targetPlayerCount) {
    return "overfilled";
  }

  return snapshot.joinedPlayerCount === snapshot.targetPlayerCount ? "full" : "waiting";
}

export function getLiveLobbyProgressRatio(snapshot: LiveLobbyProgressSnapshot): number {
  if (snapshot.targetPlayerCount <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, snapshot.joinedPlayerCount / snapshot.targetPlayerCount));
}

export function getLiveLobbyProgressChange(
  previousSnapshot: LiveLobbyProgressSnapshot | null,
  nextSnapshot: LiveLobbyProgressSnapshot,
): LiveLobbyProgressChange | null {
  if (
    previousSnapshot === null ||
    previousSnapshot.roomCode !== nextSnapshot.roomCode ||
    previousSnapshot.viewerPlayerId !== nextSnapshot.viewerPlayerId ||
    previousSnapshot.roomStatus !== "waiting" ||
    nextSnapshot.roomStatus !== "waiting" ||
    previousSnapshot.targetPlayerCount !== nextSnapshot.targetPlayerCount ||
    previousSnapshot.joinedPlayerCount === nextSnapshot.joinedPlayerCount
  ) {
    return null;
  }

  const direction =
    nextSnapshot.joinedPlayerCount > previousSnapshot.joinedPlayerCount ? "increase" : "decrease";

  return {
    direction,
    kind: nextSnapshot.joinedPlayerCount === nextSnapshot.targetPlayerCount ? "full" : direction,
    previousJoinedPlayerCount: previousSnapshot.joinedPlayerCount,
  };
}

export function reconcileLiveLobbyProgress(
  previousSnapshot: LiveLobbyProgressSnapshot | null,
  nextSnapshot: LiveLobbyProgressSnapshot,
  shouldAnimate: boolean,
): ReconciledLiveLobbyProgress {
  return {
    change: shouldAnimate ? getLiveLobbyProgressChange(previousSnapshot, nextSnapshot) : null,
    snapshot: nextSnapshot,
  };
}
