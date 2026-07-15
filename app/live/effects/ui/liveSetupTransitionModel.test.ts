import { describe, expect, it } from "vitest";

import {
  getLiveSetupTransitionSnapshotKey,
  reconcileLiveSetupTransition,
  type LiveSetupTransitionSnapshot,
} from "./liveSetupTransitionModel";

describe("live setup transition model", () => {
  it("settles its first snapshot and restored waiting rooms", () => {
    expect(reconcileLiveSetupTransition(null, snapshot("entry"), true)).toBeNull();
    expect(
      reconcileLiveSetupTransition(snapshot("loading"), snapshot("waiting", "123456"), true),
    ).toBeNull();
  });

  it("reveals entry after identity readiness and an accepted leave", () => {
    expect(reconcileLiveSetupTransition(snapshot("loading"), snapshot("entry"), true)).toBe(
      "entry",
    );
    expect(
      reconcileLiveSetupTransition(snapshot("waiting", "123456"), snapshot("entry"), true),
    ).toBe("entry");
  });

  it("reveals a waiting room only after entry submits into one", () => {
    expect(
      reconcileLiveSetupTransition(snapshot("entry"), snapshot("waiting", "123456"), true),
    ).toBe("waiting");
  });

  it("leaves game-owned and room-switch transitions settled", () => {
    expect(
      reconcileLiveSetupTransition(snapshot("waiting", "123456"), snapshot("game", "123456"), true),
    ).toBeNull();
    expect(
      reconcileLiveSetupTransition(snapshot("game", "123456"), snapshot("waiting", "123456"), true),
    ).toBeNull();
    expect(
      reconcileLiveSetupTransition(
        snapshot("waiting", "123456"),
        snapshot("waiting", "654321"),
        true,
      ),
    ).toBeNull();
  });

  it("settles hidden and reduced-motion updates", () => {
    expect(
      reconcileLiveSetupTransition(snapshot("entry"), snapshot("waiting", "123456"), false),
    ).toBeNull();
  });

  it("provides a stable semantic dependency key", () => {
    const original = snapshot("waiting", "123456");

    expect(getLiveSetupTransitionSnapshotKey(original)).toBe(
      getLiveSetupTransitionSnapshotKey({ ...original }),
    );
    expect(getLiveSetupTransitionSnapshotKey(original)).not.toBe(
      getLiveSetupTransitionSnapshotKey({ ...original, roomCode: "654321" }),
    );
    expect(getLiveSetupTransitionSnapshotKey(original)).not.toBe(
      getLiveSetupTransitionSnapshotKey({ ...original, viewerPlayerId: "viewer-b" }),
    );
  });
});

function snapshot(
  kind: LiveSetupTransitionSnapshot["kind"],
  roomCode: string | null = null,
): LiveSetupTransitionSnapshot {
  return { kind, roomCode, viewerPlayerId: roomCode === null ? null : "viewer-a" };
}
