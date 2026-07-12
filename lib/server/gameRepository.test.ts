import { describe, expect, it } from "vitest";

import {
  getExpectedPersistedGameStatus,
  isRoomEndedBeforeStart,
  toPublicActionProgress,
  toPublicGameEvent,
  toPublicPhaseFocus,
  toRevealedRoleId,
  toSubmittedResolutionActions,
} from "./gameRepository";
import { toActionSubmissionReceipt, toPrivateGameEvent } from "./gameRoomView";

type GameState = Parameters<typeof toPublicActionProgress>[0];
type CurrentAction = Parameters<typeof toPublicActionProgress>[1][number];
type Player = Parameters<typeof toPublicPhaseFocus>[2][number];
type GameEvent = Parameters<typeof toPublicGameEvent>[0];

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    action_revision: 0,
    day_number: 1,
    ended_at: null,
    night_number: 1,
    phase: "day",
    phase_ends_at: null,
    phase_instance_id: "phase-1",
    phase_started_at: null,
    revision: 1,
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
    actor_state_requirement: "alive",
    closes_at: null,
    created_at: "2099-01-01T00:00:00.000Z",
    eligible_target_player_ids: [],
    id: 1,
    phase_instance_id: "phase-1",
    resolver_role_id: null,
    target_state_requirement: "assigned",
    target_kind: "none",
    ...overrides,
  };
}

const players: Player[] = [
  {
    account_id: 11,
    disconnected_at: null,
    display_name: "Alice",
    id: 1,
    joined_at: "2099-01-01T00:00:00.000Z",
    last_seen_at: "2099-01-01T00:00:00.000Z",
    left_at: null,
    public_player_id: "public-alice",
    room_id: 1,
    status: "joined",
  },
  {
    account_id: 12,
    disconnected_at: null,
    display_name: "Bob",
    id: 2,
    joined_at: "2099-01-01T00:00:00.000Z",
    last_seen_at: "2099-01-01T00:00:00.000Z",
    left_at: null,
    public_player_id: "public-bob",
    room_id: 1,
    status: "joined",
  },
];

function makeEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    created_at: "2099-01-01T00:00:00.000Z",
    event_kind: "game_started",
    id: 1,
    payload: {},
    phase_instance_id: "phase-1",
    visibility: "public",
    ...overrides,
  };
}

describe("private action receipt projection", () => {
  it("preserves an opaque action kind from a submitter-private receipt", () => {
    const event = makeEvent({
      event_kind: "action_submitted",
      payload: {
        actionKey: "future-role:choose:1",
        kind: "future_action",
      },
      visibility: "private",
    });

    expect(toActionSubmissionReceipt(event)).toEqual([
      {
        actionKey: "future-role:choose:1",
        id: "1",
        kind: "future_action",
        phaseInstanceId: "phase-1",
        submittedAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("rejects a receipt without a valid opaque action kind", () => {
    expect(
      toActionSubmissionReceipt(
        makeEvent({
          event_kind: "action_submitted",
          payload: { actionKey: "future-role:choose:1" },
          visibility: "private",
        }),
      ),
    ).toEqual([]);
  });
});

describe("phase resolution input", () => {
  it("keeps timed-out core actions missing instead of synthesizing submissions", () => {
    expect(
      toSubmittedResolutionActions(
        [
          makeAction({
            action_key: "end-speech:1:0:1",
            action_kind: "end_speech",
          }),
          makeAction({
            action_key: "execution-skip:1:1",
            action_kind: "execution_skip",
            id: 2,
          }),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("maps only accepted pending rows to submitted engine actions", () => {
    expect(
      toSubmittedResolutionActions(
        [
          makeAction({
            action_key: "end-speech:1:0:1",
            action_kind: "end_speech",
          }),
        ],
        [
          {
            current_action_id: 1,
            submitted_at: "2099-01-01T00:00:01.000Z",
            submitter_player_id: 1,
            target_player_id: null,
          },
        ],
      ),
    ).toEqual([
      {
        actionKey: "end-speech:1:0:1",
        actorPlayerId: "1",
        actorRoleId: null,
        currentActionId: "1",
        kind: "end_speech",
        resolverRoleId: null,
        submittedAt: "2099-01-01T00:00:01.000Z",
        targetPlayerId: null,
      },
    ]);
  });
});

describe("public game event projection", () => {
  it("maps only allowlisted vote fields and public player IDs", () => {
    const event = toPublicGameEvent(
      makeEvent({
        event_kind: "vote_resolved",
        payload: {
          acceptedVotes: [{ targetPlayerId: "2", unknownPlayerId: "1", voterPlayerId: "1" }],
          dayNumber: 1,
          executionCandidatePlayerId: "2",
          internalPlayerId: "1",
          unknownPayload: { playerId: "1" },
          voteCountsByTarget: { "2": 1 },
        },
      }),
      players,
    );

    expect(event).toEqual({
      createdAt: "2099-01-01T00:00:00.000Z",
      id: "1",
      kind: "vote_resolved",
      payload: {
        acceptedVotes: [{ targetPlayerId: "public-bob", voterPlayerId: "public-alice" }],
        dayNumber: 1,
        executionCandidatePlayerId: "public-bob",
        voteCountsByTarget: { "public-bob": 1 },
      },
      presentation: null,
    });
  });

  it("drops unknown public event kinds instead of forwarding their payload", () => {
    expect(
      toPublicGameEvent(
        makeEvent({
          event_kind: "unknown_event",
          payload: { actorPlayerId: "1", secret: "must-not-leak" },
        }),
        players,
      ),
    ).toBeNull();
  });

  it("projects an unknown role event through the generic safe presentation contract", () => {
    expect(
      toPublicGameEvent(
        makeEvent({
          event_kind: "future_role_announcement",
          payload: {
            presentation: {
              details: [
                {
                  label: { en: "Target", ja: "対象" },
                  value: { kind: "player", playerId: "2" },
                },
              ],
              message: { en: "A role event resolved.", ja: "役職イベントが解決しました。" },
              title: { en: "Future role", ja: "未来の役職" },
            },
            secret: "must-not-leak",
          },
        }),
        players,
      ),
    ).toEqual({
      createdAt: "2099-01-01T00:00:00.000Z",
      id: "1",
      kind: "future_role_announcement",
      payload: {},
      presentation: {
        details: [
          {
            label: { en: "Target", ja: "対象" },
            value: { en: "Bob", ja: "Bob" },
          },
        ],
        message: { en: "A role event resolved.", ja: "役職イベントが解決しました。" },
        title: { en: "Future role", ja: "未来の役職" },
      },
    });
  });

  it("projects an unknown private role event without an event-kind allowlist", () => {
    expect(
      toPrivateGameEvent(
        makeEvent({
          event_kind: "future_private_result",
          payload: {
            presentation: {
              details: [],
              message: { en: "Private result.", ja: "非公開の結果です。" },
              title: { en: "Future result", ja: "未来の結果" },
            },
          },
          visibility: "private",
        }),
        players,
      ),
    ).toEqual({
      createdAt: "2099-01-01T00:00:00.000Z",
      kind: "future_private_result",
      presentation: {
        details: [],
        message: { en: "Private result.", ja: "非公開の結果です。" },
        title: { en: "Future result", ja: "未来の結果" },
      },
    });
  });

  it("drops an event that references a player outside the current room", () => {
    expect(
      toPublicGameEvent(
        makeEvent({
          event_kind: "player_died",
          payload: { reason: "attack", targetPlayerId: "999" },
        }),
        players,
      ),
    ).toBeNull();
  });

  it("drops an event that stores an internal player ID as a number", () => {
    expect(
      toPublicGameEvent(
        makeEvent({
          event_kind: "player_executed",
          payload: { targetPlayerId: 1 },
        }),
        players,
      ),
    ).toBeNull();
  });

  it("does not expose internal result maps from a game-ended payload", () => {
    expect(
      toPublicGameEvent(
        makeEvent({
          event_kind: "game_ended",
          payload: {
            playerResultsByPlayerId: { "1": "win", "2": "lose" },
            reason: "werewolves_eliminated",
            winnerTeam: "village",
          },
        }),
        players,
      )?.payload,
    ).toEqual({ winnerTeam: "village" });
  });
});

describe("public game view metadata", () => {
  it.each([
    { actionKind: "day_ready", expected: "day_ready", phase: "day", resolverRoleId: null },
    {
      actionKind: "end_speech",
      expected: "current_speech_turn",
      phase: "day",
      resolverRoleId: null,
    },
    {
      actionKind: "execution_skip",
      expected: "execution_last_words",
      phase: "execution",
      resolverRoleId: null,
    },
    {
      actionKind: "future_action",
      expected: "role_actions",
      phase: "execution",
      resolverRoleId: "future_role",
    },
    {
      actionKind: "first_night_ready",
      expected: "first_night_ready",
      phase: "night",
      resolverRoleId: null,
    },
    { actionKind: "vote", expected: "votes_submitted", phase: "voting", resolverRoleId: null },
  ] as const)(
    "uses $expected for $phase progress",
    ({ actionKind, expected, phase, resolverRoleId }) => {
      const progress = toPublicActionProgress(
        makeState({ phase }),
        [makeAction({ action_kind: actionKind, resolver_role_id: resolverRoleId })],
        [],
      );

      expect(progress?.kind).toBe(expected);
    },
  );

  it("marks later-night progress as hidden without exposing submissions", () => {
    const progress = toPublicActionProgress(
      makeState({ night_number: 2, phase: "night" }),
      [makeAction({ action_kind: "attack" })],
      [],
    );

    expect(progress).toEqual({
      kind: "night_actions_hidden",
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
      [makeAction({ action_kind: phase === "night" ? "counterstrike" : "vote" })],
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
