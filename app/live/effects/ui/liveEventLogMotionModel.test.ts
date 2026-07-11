import { describe, expect, it } from "vitest";

import {
  createLiveEventLogMotionState,
  getLiveEventLogMotionSnapshotKey,
  reconcileLiveEventLogMotion,
  type LiveEventLogMotionSnapshot,
} from "./liveEventLogMotionModel";

describe("live event log motion model", () => {
  it("settles the first snapshot and unchanged polling", () => {
    const initial = reconcileLiveEventLogMotion(
      createLiveEventLogMotionState(),
      snapshot(["event-a"]),
      true,
    );

    expect(initial.animatedEventIds).toEqual([]);
    expect(
      reconcileLiveEventLogMotion(initial.state, snapshot(["event-a"]), true).animatedEventIds,
    ).toEqual([]);
  });

  it("reveals rows added while the open log is visible", () => {
    const initial = baseline(["event-a"]);
    const next = reconcileLiveEventLogMotion(
      initial.state,
      snapshot(["event-a", "event-b", "event-c"]),
      true,
    );

    expect(next.animatedEventIds).toEqual(["event-b", "event-c"]);
    expect(next.state.pendingEventIds).toEqual([]);
  });

  it("holds new rows behind a cinematic cue and releases them when visible", () => {
    const initial = baseline(["event-a"]);
    const obscured = reconcileLiveEventLogMotion(
      initial.state,
      snapshot(["event-a", "event-b"], { isObscured: true }),
      true,
    );

    expect(obscured.animatedEventIds).toEqual([]);
    expect(obscured.state.pendingEventIds).toEqual(["event-b"]);

    const released = reconcileLiveEventLogMotion(
      obscured.state,
      snapshot(["event-a", "event-b"]),
      true,
    );

    expect(released.animatedEventIds).toEqual(["event-b"]);
    expect(released.state.pendingEventIds).toEqual([]);
  });

  it("does not replay history when opening or reopening the log", () => {
    const closed = baseline(["event-a"], { isOpen: false });
    const opened = reconcileLiveEventLogMotion(
      closed.state,
      snapshot(["event-a", "event-b"]),
      true,
    );

    expect(opened.animatedEventIds).toEqual([]);
    expect(opened.state.pendingEventIds).toEqual([]);
  });

  it("discards pending rows on close, room, viewer, hidden, and reduced baselines", () => {
    const initial = baseline(["event-a"]);
    const obscured = reconcileLiveEventLogMotion(
      initial.state,
      snapshot(["event-a", "event-b"], { isObscured: true }),
      true,
    );
    const scenarios = [
      snapshot(["event-a", "event-b"], { isOpen: false }),
      snapshot(["event-a", "event-b"], { roomCode: "654321" }),
      snapshot(["event-a", "event-b"], { viewerPlayerId: "viewer-b" }),
    ];

    for (const current of scenarios) {
      const reconciliation = reconcileLiveEventLogMotion(obscured.state, current, true);

      expect(reconciliation.animatedEventIds).toEqual([]);
      expect(reconciliation.state.pendingEventIds).toEqual([]);
    }

    expect(
      reconcileLiveEventLogMotion(obscured.state, snapshot(["event-a", "event-b"]), false).state
        .pendingEventIds,
    ).toEqual([]);
  });

  it("caps rapid obscured batches at the newest six rows", () => {
    const initial = baseline([]);
    const eventIds = Array.from({ length: 9 }, (unusedValue, index) => {
      void unusedValue;

      return `event-${index}`;
    });
    const obscured = reconcileLiveEventLogMotion(
      initial.state,
      snapshot(eventIds, { isObscured: true }),
      true,
    );

    expect(obscured.state.pendingEventIds).toEqual(eventIds.slice(-6));
  });

  it("provides a semantic dependency key", () => {
    expect(getLiveEventLogMotionSnapshotKey(snapshot(["event-a", "event-b"]))).toBe(
      "open:visible:123456:viewer-a:event-a:event-b",
    );
  });
});

function baseline(
  eventIds: readonly string[],
  overrides: Partial<LiveEventLogMotionSnapshot> = {},
) {
  return reconcileLiveEventLogMotion(
    createLiveEventLogMotionState(),
    snapshot(eventIds, overrides),
    true,
  );
}

function snapshot(
  eventIds: readonly string[],
  overrides: Partial<LiveEventLogMotionSnapshot> = {},
): LiveEventLogMotionSnapshot {
  return {
    eventIds,
    isObscured: false,
    isOpen: true,
    roomCode: "123456",
    viewerPlayerId: "viewer-a",
    ...overrides,
  };
}
