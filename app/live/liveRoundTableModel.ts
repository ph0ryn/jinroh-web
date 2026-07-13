import type { PublicPlayer, RoomSummary } from "@/lib/shared/game";

type LiveRoundTableSummary = Pick<
  RoomSummary,
  "currentPlayerId" | "players" | "status" | "targetPlayerCount"
>;

export type LiveRoundTableSeat = {
  readonly player: PublicPlayer | null;
  readonly seatNumber: number;
  readonly x: number;
  readonly y: number;
};

export function getLiveRoundTableSeats(summary: LiveRoundTableSummary): LiveRoundTableSeat[] {
  const seatedPlayers = summary.players.filter((player) => isPlayerSeated(player, summary.status));
  const targetSlotCount =
    Number.isSafeInteger(summary.targetPlayerCount) && summary.targetPlayerCount > 0
      ? summary.targetPlayerCount
      : 0;
  const slotCount = Math.max(targetSlotCount, seatedPlayers.length);
  const currentSeatIndex = seatedPlayers.findIndex(
    (player) => player.id === summary.currentPlayerId,
  );
  const bottomSeatIndex = currentSeatIndex === -1 ? 0 : currentSeatIndex;

  return Array.from({ length: slotCount }, (unusedValue, index) => {
    void unusedValue;

    const positionIndex = (index - bottomSeatIndex + slotCount) % slotCount;
    const position = getSeatPosition(positionIndex, slotCount);

    return {
      player: seatedPlayers[index] ?? null,
      seatNumber: index + 1,
      ...position,
    };
  });
}

function isPlayerSeated(player: PublicPlayer, roomStatus: RoomSummary["status"]): boolean {
  if (roomStatus === "waiting") {
    return player.status === "joined" || player.status === "disconnected";
  }

  return player.alive !== null;
}

function getSeatPosition(index: number, slotCount: number): Pick<LiveRoundTableSeat, "x" | "y"> {
  let radius = 42;

  if (slotCount <= 4) {
    radius = 38;
  } else if (slotCount <= 6) {
    radius = 40;
  } else if (slotCount <= 8) {
    radius = 39;
  }

  const angle = Math.PI / 2 + (index / slotCount) * Math.PI * 2;

  return {
    x: Number((50 + Math.cos(angle) * radius).toFixed(3)),
    y: Number((50 + Math.sin(angle) * radius).toFixed(3)),
  };
}
