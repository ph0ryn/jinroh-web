import { describe, expect, it } from "vitest";

import {
  getExpectedPersistedGameStatus,
  isRoomEndedBeforeStart,
  toPublicActionProgress,
  toPublicPhaseFocus,
  toRevealedRoleId,
} from "./gameRepository";

type GameState = Parameters<typeof toPublicActionProgress>[0];
type CurrentAction = Parameters<typeof toPublicActionProgress>[1][number];
type Player = Parameters<typeof toPublicPhaseFocus>[2][number];

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    day_number: 1,
    final_outcome_id: null,
    id: 1,
    night_number: 1,
    phase: "day",
    phase_ends_at: null,
    phase_instance_id: "phase-1",
    revision: 1,
    resolved_role_setup: null,
    room_id: 1,
    status: "playing",
    ...overrides,
  };
}

function makeAction(overrides: Partial<CurrentAction> = {}): CurrentAction {
  return {
    action_key: "action-1",
    action_kind: "day_ready",
    actor_player_id: 1,
    actor_role_id: null,
    closes_at: null,
    eligible_target_player_ids: [],
    id: 1,
    phase_instance_id: "phase-1",
    target_kind: "none",
    ...overrides,
  };
}

const players: Player[] = [
  {
    account_id: 11,
    display_name: "Alice",
    id: 1,
    public_player_id: "public-alice",
    room_id: 1,
    status: "joined",
  },
  {
    account_id: 12,
    display_name: "Bob",
    id: 2,
    public_player_id: "public-bob",
    room_id: 1,
    status: "joined",
  },
];

describe("public game view metadata", () => {
  it.each([
    { actionKind: "day_ready", expected: "day_ready", phase: "day" },
    { actionKind: "end_speech", expected: "current_speech_turn", phase: "day" },
    { actionKind: "execution_skip", expected: "execution_last_words", phase: "execution" },
    { actionKind: "first_night_ready", expected: "first_night_ready", phase: "night" },
    { actionKind: "vote", expected: "votes_submitted", phase: "voting" },
  ] as const)("uses $expected for $phase progress", ({ actionKind, expected, phase }) => {
    const progress = toPublicActionProgress(
      makeState({ phase }),
      [makeAction({ action_kind: actionKind })],
      [],
    );

    expect(progress?.kind).toBe(expected);
  });

  it("marks later-night progress as hidden without exposing submissions", () => {
    const progress = toPublicActionProgress(
      makeState({ night_number: 2, phase: "night" }),
      [makeAction({ action_kind: "attack" })],
      [],
    );

    expect(progress).toEqual({
      kind: "night_actions_hidden",
      label: "Night actions are private until dawn.",
      visibility: "hidden",
    });
  });

  it("maps the ordered speaker from an internal ID to a public ID", () => {
    const focus = toPublicPhaseFocus(
      makeState({ phase: "day" }),
      [makeAction({ action_kind: "end_speech", actor_player_id: 2 })],
      players,
    );

    expect(focus).toEqual({ kind: "current_speaker", playerId: "public-bob" });
  });

  it("maps the execution candidate from an internal ID to a public ID", () => {
    const focus = toPublicPhaseFocus(
      makeState({ phase: "execution" }),
      [makeAction({ action_kind: "execution_skip", actor_player_id: 1 })],
      players,
    );

    expect(focus).toEqual({ kind: "execution_candidate", playerId: "public-alice" });
  });

  it.each(["night", "voting"] as const)("does not expose an actor during %s", (phase) => {
    const focus = toPublicPhaseFocus(
      makeState({ phase }),
      [makeAction({ action_kind: phase === "night" ? "hunter_retaliate" : "vote" })],
      players,
    );

    expect(focus).toBeNull();
  });

  it("does not infer a day focus from ready actions", () => {
    const focus = toPublicPhaseFocus(
      makeState({ phase: "day" }),
      [makeAction({ action_kind: "day_ready" })],
      players,
    );

    expect(focus).toBeNull();
  });

  it("does not expose an unknown internal player ID", () => {
    const focus = toPublicPhaseFocus(
      makeState({ phase: "execution" }),
      [makeAction({ action_kind: "execution_skip", actor_player_id: 999 })],
      players,
    );

    expect(focus).toBeNull();
  });
});

describe("final role reveal boundary", () => {
  it.each([
    {
      expected: null,
      gameStatus: null,
      name: "a waiting room without game state",
      roomStatus: "waiting",
    },
    {
      expected: null,
      gameStatus: "playing",
      name: "an in-progress game",
      roomStatus: "playing",
    },
    {
      expected: null,
      gameStatus: "ended",
      name: "an inconsistent room that has not ended",
      roomStatus: "playing",
    },
    {
      expected: null,
      gameStatus: "playing",
      name: "an inconsistent game that has not ended",
      roomStatus: "ended",
    },
    {
      expected: null,
      gameStatus: null,
      name: "a waiting room that ended before starting",
      roomStatus: "ended",
    },
    {
      expected: "seer",
      gameStatus: "ended",
      name: "a fully ended game",
      roomStatus: "ended",
    },
  ] as const)("returns $expected for $name", ({ expected, gameStatus, roomStatus }) => {
    expect(toRevealedRoleId(roomStatus, gameStatus, "seer")).toBe(expected);
  });

  it("does not invent a missing assignment after the game ends", () => {
    expect(toRevealedRoleId("ended", "ended", null)).toBeNull();
  });
});

describe("persisted room and game lifecycle", () => {
  it.each([
    {
      expected: null,
      name: "a waiting room",
      roomStatus: "waiting",
      startedAt: null,
    },
    {
      expected: "playing",
      name: "a started room in progress",
      roomStatus: "playing",
      startedAt: "2099-01-01T00:00:00.000Z",
    },
    {
      expected: null,
      name: "a waiting room that ended before starting",
      roomStatus: "ended",
      startedAt: null,
    },
    {
      expected: "ended",
      name: "a completed game",
      roomStatus: "ended",
      startedAt: "2099-01-01T00:00:00.000Z",
    },
  ] as const)("returns $expected for $name", ({ expected, roomStatus, startedAt }) => {
    expect(getExpectedPersistedGameStatus(roomStatus, startedAt)).toBe(expected);
  });

  it("rejects a waiting room with a start time", () => {
    expect(() => getExpectedPersistedGameStatus("waiting", "2099-01-01T00:00:00.000Z")).toThrow(
      /waiting room cannot have a start time/u,
    );
  });

  it("rejects a playing room without a start time", () => {
    expect(() => getExpectedPersistedGameStatus("playing", null)).toThrow(
      /playing room must have a start time/u,
    );
  });

  it("distinguishes a waiting room that ended before start from a completed game", () => {
    expect(isRoomEndedBeforeStart("ended", null)).toBe(true);
    expect(isRoomEndedBeforeStart("ended", "2099-01-01T00:00:00.000Z")).toBe(false);
    expect(isRoomEndedBeforeStart("waiting", null)).toBe(false);
  });
});
