import { describe, expect, it } from "vitest";

import { getLiveRoundTableSeats } from "./liveRoundTableModel";

import type { PublicPlayer, RoomStatus } from "@/lib/shared/game";

describe("getLiveRoundTableSeats", () => {
  it("fills unoccupied target slots with empty seats", () => {
    const seats = getLiveRoundTableSeats({
      currentPlayerId: null,
      players: [makePlayer("alice")],
      status: "waiting",
      targetPlayerCount: 4,
    });

    expect(seats).toHaveLength(4);
    expect(seats.map(({ player }) => player?.id ?? null)).toEqual(["alice", null, null, null]);
    expect(seats.map(({ seatNumber }) => seatNumber)).toEqual([1, 2, 3, 4]);
  });

  it("keeps disconnected waiting players seated and excludes players who left", () => {
    const seats = getLiveRoundTableSeats({
      currentPlayerId: null,
      players: [
        makePlayer("alice"),
        makePlayer("blair", { status: "disconnected" }),
        makePlayer("casey", { status: "left" }),
      ],
      status: "waiting",
      targetPlayerCount: 3,
    });

    expect(seats.map(({ player }) => player?.id ?? null)).toEqual(["alice", "blair", null]);
  });

  it("keeps a non-host current player's seat stable from waiting through playing and ended", () => {
    const waitingPlayers = [
      makePlayer("alice", { isHost: true }),
      makePlayer("departed", { status: "left" }),
      makePlayer("blair", { isCurrent: true, status: "disconnected" }),
      makePlayer("casey"),
    ];
    const playingPlayers = waitingPlayers.map((player) =>
      player.id === "departed" ? player : { ...player, alive: true, status: "joined" as const },
    );
    const endedPlayers = playingPlayers.map((player) =>
      player.id === "blair" ? { ...player, alive: false, status: "left" as const } : player,
    );

    const waitingSeats = getSeatLayout("waiting", waitingPlayers, "blair");
    const playingSeats = getSeatLayout("playing", playingPlayers, "blair");
    const endedSeats = getSeatLayout("ended", endedPlayers, "blair");

    expect(waitingSeats.map(({ id, seatNumber }) => [id, seatNumber])).toEqual([
      ["alice", 1],
      ["blair", 2],
      ["casey", 3],
    ]);
    expect(playingSeats).toEqual(waitingSeats);
    expect(endedSeats).toEqual(waitingSeats);
    expect(waitingSeats.find(({ id }) => id === "blair")).toMatchObject({ x: 50 });
    expect(waitingSeats.find(({ id }) => id === "blair")?.y).toBeGreaterThan(50);
  });

  it("rotates empty slots with the current player's table perspective", () => {
    const players = [makePlayer("alice"), makePlayer("blair", { isCurrent: true })];
    const canonicalSeats = getLiveRoundTableSeats({
      currentPlayerId: null,
      players,
      status: "waiting",
      targetPlayerCount: 4,
    });
    const rotatedSeats = getLiveRoundTableSeats({
      currentPlayerId: "blair",
      players,
      status: "waiting",
      targetPlayerCount: 4,
    });

    expect(rotatedSeats.map(({ player, seatNumber }) => [player?.id ?? null, seatNumber])).toEqual(
      canonicalSeats.map(({ player, seatNumber }) => [player?.id ?? null, seatNumber]),
    );
    expect(getPosition(rotatedSeats, 1)).toEqual(getPosition(canonicalSeats, 4));
    expect(getPosition(rotatedSeats, 2)).toEqual(getPosition(canonicalSeats, 1));
    expect(getPosition(rotatedSeats, 3)).toEqual(getPosition(canonicalSeats, 2));
    expect(getPosition(rotatedSeats, 4)).toEqual(getPosition(canonicalSeats, 3));
  });

  it.each([
    { currentPlayerId: "alice", expectedSeatNumber: 1 },
    { currentPlayerId: "blair", expectedSeatNumber: 2 },
    { currentPlayerId: "casey", expectedSeatNumber: 3 },
  ])(
    "places $currentPlayerId at the bottom without changing canonical join order",
    ({ currentPlayerId, expectedSeatNumber }) => {
      const players = ["alice", "blair", "casey"].map((id) =>
        makePlayer(id, { alive: true, isCurrent: id === currentPlayerId }),
      );
      const seats = getLiveRoundTableSeats({
        currentPlayerId,
        players,
        status: "playing",
        targetPlayerCount: 3,
      });
      const currentSeat = seats.find(({ player }) => player?.id === currentPlayerId);

      expect(seats.map(({ player, seatNumber }) => [player?.id, seatNumber])).toEqual([
        ["alice", 1],
        ["blair", 2],
        ["casey", 3],
      ]);
      expect(currentSeat).toMatchObject({ seatNumber: expectedSeatNumber, x: 50 });
      expect(currentSeat?.y).toBeGreaterThan(50);
    },
  );

  it.each([null, "missing-player"])(
    "keeps canonical seat 1 at the bottom when currentPlayerId is %s",
    (currentPlayerId) => {
      const seats = getLiveRoundTableSeats({
        currentPlayerId,
        players: [makePlayer("alice"), makePlayer("blair"), makePlayer("casey")],
        status: "waiting",
        targetPlayerCount: 3,
      });

      expect(seats[0]).toMatchObject({ seatNumber: 1, x: 50 });
      expect(seats[0]?.y).toBeGreaterThan(50);
    },
  );

  it("expands defensively when valid seated players exceed the target", () => {
    const seats = getLiveRoundTableSeats({
      currentPlayerId: null,
      players: [makePlayer("alice"), makePlayer("blair"), makePlayer("casey"), makePlayer("devon")],
      status: "waiting",
      targetPlayerCount: 3,
    });

    expect(seats).toHaveLength(4);
    expect(seats.map(({ player }) => player?.id)).toEqual(["alice", "blair", "casey", "devon"]);
  });

  it.each([3, 4, 5, 6, 7, 8, 9, 10])(
    "places %i seats at unique positions clockwise from the bottom",
    (playerCount) => {
      const seats = getLiveRoundTableSeats({
        currentPlayerId: null,
        players: Array.from({ length: playerCount }, (unusedValue, index) => {
          void unusedValue;

          return makePlayer(`player-${index + 1}`, { alive: true });
        }),
        status: "playing",
        targetPlayerCount: playerCount,
      });
      const positions = new Set(seats.map(({ x, y }) => `${x}:${y}`));
      const firstSeat = seats[0];
      const secondSeat = seats[1];

      expect(positions.size).toBe(playerCount);
      expect(firstSeat).toMatchObject({ seatNumber: 1, x: 50 });
      expect(firstSeat?.y).toBeGreaterThan(50);
      expect(secondSeat?.x).toBeLessThan(50);
      expect(seats.every(({ x, y }) => x >= 0 && x <= 100 && y >= 0 && y <= 100)).toBe(true);
    },
  );

  it("keeps eight comfortable seats inside the compact table edge", () => {
    const seats = getLiveRoundTableSeats({
      currentPlayerId: null,
      players: [makePlayer("host")],
      status: "waiting",
      targetPlayerCount: 8,
    });

    expect(seats.every(({ x, y }) => x >= 11 && x <= 89 && y >= 11 && y <= 89)).toBe(true);
  });
});

function makePlayer(id: string, overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    alive: null,
    displayName: id,
    id,
    isCurrent: false,
    isHost: false,
    isLobbyReady: false,
    revealedRoleId: null,
    status: "joined",
    ...overrides,
  };
}

function getSeatLayout(
  status: Extract<RoomStatus, "ended" | "playing" | "waiting">,
  players: readonly PublicPlayer[],
  currentPlayerId: string,
): readonly {
  readonly id: string;
  readonly seatNumber: number;
  readonly x: number;
  readonly y: number;
}[] {
  return getLiveRoundTableSeats({
    currentPlayerId,
    players: [...players],
    status,
    targetPlayerCount: 3,
  }).flatMap(({ player, seatNumber, x, y }) =>
    player === null ? [] : [{ id: player.id, seatNumber, x, y }],
  );
}

function getPosition(
  seats: ReturnType<typeof getLiveRoundTableSeats>,
  seatNumber: number,
): { readonly x: number; readonly y: number } | undefined {
  const seat = seats.find((candidate) => candidate.seatNumber === seatNumber);

  return seat === undefined ? undefined : { x: seat.x, y: seat.y };
}
