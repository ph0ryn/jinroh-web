import type { LiveMood } from "../../livePresentation";

export type LiveBackgroundSnapshot = {
  readonly mood: LiveMood;
  readonly roomCode: string | null;
  readonly viewerPlayerId: string | null;
};

export type LiveBackgroundScene = LiveBackgroundSnapshot & {
  readonly id: number;
};

export type LiveBackgroundState = {
  readonly generation: number;
  readonly scenes: readonly LiveBackgroundScene[];
};

export const LIVE_BACKGROUND_SOURCE_BY_MOOD: Readonly<Record<LiveMood, string>> = {
  day: "/images/jinroh-day-same-angle.jpg",
  execution: "/images/jinroh-voting-same-angle.jpg",
  night: "/images/jinroh-night.jpg",
  result: "/images/jinroh-result-same-angle.jpg",
  setup: "/images/jinroh-waiting-same-angle.jpg",
  voting: "/images/jinroh-voting-same-angle.jpg",
  waiting: "/images/jinroh-waiting-same-angle.jpg",
};

const MAX_TRANSIENT_SCENES = 8;

export function createLiveBackgroundState(snapshot: LiveBackgroundSnapshot): LiveBackgroundState {
  return { generation: 0, scenes: [{ ...snapshot, id: 0 }] };
}

export function reconcileLiveBackgroundState(
  state: LiveBackgroundState,
  snapshot: LiveBackgroundSnapshot,
  shouldAnimate: boolean,
): LiveBackgroundState {
  const current = state.scenes.at(-1);

  if (current === undefined) {
    return createLiveBackgroundState(snapshot);
  }

  const sameSession =
    current.roomCode === snapshot.roomCode && current.viewerPlayerId === snapshot.viewerPlayerId;
  const sameMood = current.mood === snapshot.mood;
  const sameSource =
    LIVE_BACKGROUND_SOURCE_BY_MOOD[current.mood] === LIVE_BACKGROUND_SOURCE_BY_MOOD[snapshot.mood];

  if (sameSession && sameMood && (shouldAnimate || state.scenes.length === 1)) {
    return state;
  }

  const generation = state.generation + 1;
  const nextScene = { ...snapshot, id: generation };

  if (!sameSession || !shouldAnimate || sameSource || state.scenes.length >= MAX_TRANSIENT_SCENES) {
    return { generation, scenes: [nextScene] };
  }

  return { generation, scenes: [...state.scenes, nextScene] };
}

export function settleLiveBackgroundState(
  state: LiveBackgroundState,
  generation: number,
): LiveBackgroundState {
  const latestScene = state.scenes.at(-1);

  if (state.generation !== generation || latestScene === undefined || state.scenes.length === 1) {
    return state;
  }

  return { ...state, scenes: [latestScene] };
}

export function getLiveBackgroundSnapshot(
  mood: LiveMood,
  roomCode: string | null,
  viewerPlayerId: string | null,
): LiveBackgroundSnapshot {
  return { mood, roomCode, viewerPlayerId };
}

export function getUniqueLiveBackgroundSources(): readonly string[] {
  return [...new Set(Object.values(LIVE_BACKGROUND_SOURCE_BY_MOOD))];
}
