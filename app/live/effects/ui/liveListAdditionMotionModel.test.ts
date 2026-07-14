import { describe, expect, it } from "vitest";

import {
  createLiveListAdditionMotionState,
  getLiveListAdditionMotionSnapshotKey,
  reconcileLiveListAdditionMotion,
  type LiveListAdditionMotionSnapshot,
} from "./liveListAdditionMotionModel";

describe("live list addition motion model", () => {
  it("settles the first snapshot and unchanged polling", () => {
    const initial = reconcileLiveListAdditionMotion(
      createLiveListAdditionMotionState(),
      snapshot(["item-a"]),
      true,
    );

    expect(initial.animatedItemIds).toEqual([]);
    expect(
      reconcileLiveListAdditionMotion(initial.state, snapshot(["item-a"]), true).animatedItemIds,
    ).toEqual([]);
  });

  it("reveals items added while the open list is visible", () => {
    const initial = baseline(["item-a"]);
    const next = reconcileLiveListAdditionMotion(
      initial.state,
      snapshot(["item-a", "item-b", "item-c"]),
      true,
    );

    expect(next.animatedItemIds).toEqual(["item-b", "item-c"]);
    expect(next.state.pendingItemIds).toEqual([]);
  });

  it("holds additions behind a cinematic cue and releases them when visible", () => {
    const initial = baseline(["item-a"]);
    const obscured = reconcileLiveListAdditionMotion(
      initial.state,
      snapshot(["item-a", "item-b"], { isObscured: true }),
      true,
    );

    expect(obscured.animatedItemIds).toEqual([]);
    expect(obscured.state.pendingItemIds).toEqual(["item-b"]);

    const released = reconcileLiveListAdditionMotion(
      obscured.state,
      snapshot(["item-a", "item-b"]),
      true,
    );

    expect(released.animatedItemIds).toEqual(["item-b"]);
    expect(released.state.pendingItemIds).toEqual([]);
  });

  it("does not replay history when opening or reopening a list", () => {
    const closed = baseline(["item-a"], { isOpen: false });
    const opened = reconcileLiveListAdditionMotion(
      closed.state,
      snapshot(["item-a", "item-b"]),
      true,
    );

    expect(opened.animatedItemIds).toEqual([]);
    expect(opened.state.pendingItemIds).toEqual([]);
  });

  it("discards pending items on close, session, hidden, and reduced baselines", () => {
    const initial = baseline(["item-a"]);
    const obscured = reconcileLiveListAdditionMotion(
      initial.state,
      snapshot(["item-a", "item-b"], { isObscured: true }),
      true,
    );
    const scenarios = [
      snapshot(["item-a", "item-b"], { isOpen: false }),
      snapshot(["item-a", "item-b"], { sessionKey: "session-b" }),
    ];

    for (const current of scenarios) {
      const reconciliation = reconcileLiveListAdditionMotion(obscured.state, current, true);

      expect(reconciliation.animatedItemIds).toEqual([]);
      expect(reconciliation.state.pendingItemIds).toEqual([]);
    }

    expect(
      reconcileLiveListAdditionMotion(obscured.state, snapshot(["item-a", "item-b"]), false).state
        .pendingItemIds,
    ).toEqual([]);
  });

  it("caps rapid obscured batches at the newest six items", () => {
    const initial = baseline([]);
    const itemIds = Array.from({ length: 9 }, (unusedValue, index) => {
      void unusedValue;

      return `item-${index}`;
    });
    const obscured = reconcileLiveListAdditionMotion(
      initial.state,
      snapshot(itemIds, { isObscured: true }),
      true,
    );

    expect(obscured.state.pendingItemIds).toEqual(itemIds.slice(-6));
  });

  it("provides a semantic dependency key", () => {
    const original = snapshot(["item-a", "item-b"]);

    expect(getLiveListAdditionMotionSnapshotKey(original)).toBe(
      getLiveListAdditionMotionSnapshotKey({ ...original, itemIds: [...original.itemIds] }),
    );
    expect(getLiveListAdditionMotionSnapshotKey(original)).not.toBe(
      getLiveListAdditionMotionSnapshotKey({ ...original, isObscured: true }),
    );
    expect(getLiveListAdditionMotionSnapshotKey(original)).not.toBe(
      getLiveListAdditionMotionSnapshotKey({ ...original, sessionKey: "session-b" }),
    );
  });
});

function baseline(
  itemIds: readonly string[],
  overrides: Partial<LiveListAdditionMotionSnapshot> = {},
) {
  return reconcileLiveListAdditionMotion(
    createLiveListAdditionMotionState(),
    snapshot(itemIds, overrides),
    true,
  );
}

function snapshot(
  itemIds: readonly string[],
  overrides: Partial<LiveListAdditionMotionSnapshot> = {},
): LiveListAdditionMotionSnapshot {
  return {
    isObscured: false,
    isOpen: true,
    itemIds,
    sessionKey: "session-a",
    ...overrides,
  };
}
