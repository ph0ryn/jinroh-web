import type { RoomSummary } from "@/lib/shared/game";

export type LiveGameSessionIdentity = {
  readonly gameId: string | null;
  readonly roomCode: string | null;
  readonly viewerPlayerId: string | null;
};

export function getLiveGameSessionIdentity(summary: RoomSummary | null): LiveGameSessionIdentity {
  return {
    gameId: summary?.game?.gameId ?? null,
    roomCode: summary?.code ?? null,
    viewerPlayerId: summary?.currentPlayerId ?? null,
  };
}

export function getLiveGameSessionKey(summary: RoomSummary | null): string {
  const identity = getLiveGameSessionIdentity(summary);

  return JSON.stringify([identity.roomCode, identity.viewerPlayerId, identity.gameId]);
}

export function isSameLiveRoomViewerSession(
  previous: RoomSummary | null,
  next: RoomSummary,
): previous is RoomSummary {
  return (
    previous !== null &&
    previous.code === next.code &&
    previous.currentPlayerId === next.currentPlayerId
  );
}

export function hasLiveGameBoundary(previous: RoomSummary | null, next: RoomSummary): boolean {
  return isSameLiveRoomViewerSession(previous, next) && previous.game?.gameId !== next.game?.gameId;
}
