import { describe, expect, it } from "vitest";

import {
  createLiveBackgroundState,
  getLiveBackgroundSnapshot,
  getUniqueLiveBackgroundSources,
  LIVE_BACKGROUND_SOURCE_BY_MOOD,
  reconcileLiveBackgroundState,
  settleLiveBackgroundState,
} from "./liveBackgroundModel";

describe("live background model", () => {
  it("starts from one settled scene", () => {
    expect(createLiveBackgroundState(snapshot("setup"))).toEqual({
      generation: 0,
      scenes: [{ ...snapshot("setup"), id: 0 }],
    });
  });

  it("keeps unchanged polling as the same state", () => {
    const state = createLiveBackgroundState(snapshot("night"));

    expect(reconcileLiveBackgroundState(state, snapshot("night"), true)).toBe(state);
  });

  it("appends same-session semantic image changes for a crossfade", () => {
    const night = createLiveBackgroundState(snapshot("night"));
    const day = reconcileLiveBackgroundState(night, snapshot("day"), true);

    expect(day).toEqual({
      generation: 1,
      scenes: [night.scenes[0], { ...snapshot("day"), id: 1 }],
    });
  });

  it("settles room and viewer changes without a transient layer", () => {
    const current = reconcileLiveBackgroundState(
      createLiveBackgroundState(snapshot("night")),
      snapshot("day"),
      true,
    );

    expect(
      reconcileLiveBackgroundState(current, snapshot("voting", "654321", "viewer-a"), true),
    ).toEqual({
      generation: 2,
      scenes: [{ ...snapshot("voting", "654321", "viewer-a"), id: 2 }],
    });
    expect(
      reconcileLiveBackgroundState(current, snapshot("voting", "123456", "viewer-b"), true),
    ).toEqual({
      generation: 2,
      scenes: [{ ...snapshot("voting", "123456", "viewer-b"), id: 2 }],
    });
  });

  it("settles a Game replacement or detachment without retaining the result scene", () => {
    const result = createLiveBackgroundState(snapshot("result", "123456", "viewer-a", "game-a"));

    expect(
      reconcileLiveBackgroundState(result, snapshot("waiting", "123456", "viewer-a", null), true),
    ).toEqual({
      generation: 1,
      scenes: [{ ...snapshot("waiting", "123456", "viewer-a", null), id: 1 }],
    });
    expect(
      reconcileLiveBackgroundState(result, snapshot("night", "123456", "viewer-a", "game-b"), true)
        .scenes,
    ).toEqual([{ ...snapshot("night", "123456", "viewer-a", "game-b"), id: 1 }]);
  });

  it("treats reduced-motion and hidden updates as settled baselines", () => {
    const state = reconcileLiveBackgroundState(
      createLiveBackgroundState(snapshot("night")),
      snapshot("day"),
      true,
    );

    expect(reconcileLiveBackgroundState(state, snapshot("voting"), false)).toEqual({
      generation: 2,
      scenes: [{ ...snapshot("voting"), id: 2 }],
    });
  });

  it("does not dissolve between moods that share one image", () => {
    const setup = createLiveBackgroundState(snapshot("setup", null, null));
    const voting = createLiveBackgroundState(snapshot("voting"));

    expect(
      reconcileLiveBackgroundState(setup, snapshot("waiting", null, null), true).scenes,
    ).toEqual([{ ...snapshot("waiting", null, null), id: 1 }]);
    expect(reconcileLiveBackgroundState(voting, snapshot("execution"), true).scenes).toEqual([
      { ...snapshot("execution"), id: 1 },
    ]);
  });

  it("keeps interrupted scenes until the latest crossfade settles", () => {
    const night = createLiveBackgroundState(snapshot("night"));
    const day = reconcileLiveBackgroundState(night, snapshot("day"), true);
    const voting = reconcileLiveBackgroundState(day, snapshot("voting"), true);

    expect(voting.scenes.map((scene) => scene.mood)).toEqual(["night", "day", "voting"]);
    expect(settleLiveBackgroundState(voting, day.generation)).toBe(voting);
    expect(settleLiveBackgroundState(voting, voting.generation).scenes).toEqual([
      voting.scenes.at(-1),
    ]);
  });

  it("caps a pathological rapid stack by settling the latest scene", () => {
    let state = createLiveBackgroundState(snapshot("night"));
    const moods = ["day", "voting", "result"] as const;

    for (let index = 0; index < 9; index += 1) {
      state = reconcileLiveBackgroundState(
        state,
        snapshot(moods[index % moods.length] ?? "day"),
        true,
      );
    }

    expect(state.scenes).toHaveLength(2);
    expect(state.scenes.at(-1)?.mood).toBe("result");
  });

  it("returns every configured source exactly once", () => {
    const uniqueSources = getUniqueLiveBackgroundSources();

    expect(new Set(uniqueSources).size).toBe(uniqueSources.length);

    for (const source of Object.values(LIVE_BACKGROUND_SOURCE_BY_MOOD)) {
      expect(uniqueSources).toContain(source);
    }
  });
});

function snapshot(
  mood: Parameters<typeof getLiveBackgroundSnapshot>[0],
  roomCode: string | null = "123456",
  viewerPlayerId: string | null = "viewer-a",
  gameId: string | null = "game-a",
) {
  return getLiveBackgroundSnapshot(mood, roomCode, viewerPlayerId, gameId);
}
