const MAX_ANIMATED_EVENT_ROWS = 6;

export type LiveEventLogMotionSnapshot = {
  readonly eventIds: readonly string[];
  readonly isObscured: boolean;
  readonly isOpen: boolean;
  readonly roomCode: string;
  readonly viewerPlayerId: string | null;
};

export type LiveEventLogMotionState = {
  readonly pendingEventIds: readonly string[];
  readonly snapshot: LiveEventLogMotionSnapshot | null;
};

export type LiveEventLogMotionReconciliation = {
  readonly animatedEventIds: readonly string[];
  readonly state: LiveEventLogMotionState;
};

export function createLiveEventLogMotionState(): LiveEventLogMotionState {
  return { pendingEventIds: [], snapshot: null };
}

export function reconcileLiveEventLogMotion(
  state: LiveEventLogMotionState,
  current: LiveEventLogMotionSnapshot,
  shouldAnimate: boolean,
): LiveEventLogMotionReconciliation {
  const previous = state.snapshot;
  const isBaseline =
    previous === null ||
    !shouldAnimate ||
    !previous.isOpen ||
    !current.isOpen ||
    previous.roomCode !== current.roomCode ||
    previous.viewerPlayerId !== current.viewerPlayerId;

  if (isBaseline) {
    return settledReconciliation(current);
  }

  const previousIds = new Set(previous.eventIds);
  const currentIds = new Set(current.eventIds);
  const addedEventIds = current.eventIds.filter((eventId) => !previousIds.has(eventId));
  const pendingEventIds = [...state.pendingEventIds, ...addedEventIds]
    .filter((eventId, index, eventIds) => eventIds.indexOf(eventId) === index)
    .filter((eventId) => currentIds.has(eventId))
    .slice(-MAX_ANIMATED_EVENT_ROWS);

  if (current.isObscured) {
    return {
      animatedEventIds: [],
      state: { pendingEventIds, snapshot: current },
    };
  }

  return {
    animatedEventIds: pendingEventIds,
    state: { pendingEventIds: [], snapshot: current },
  };
}

export function getLiveEventLogMotionSnapshotKey(snapshot: LiveEventLogMotionSnapshot): string {
  return [
    snapshot.isOpen ? "open" : "closed",
    snapshot.isObscured ? "obscured" : "visible",
    snapshot.roomCode,
    snapshot.viewerPlayerId ?? "spectator",
    ...snapshot.eventIds,
  ].join(":");
}

function settledReconciliation(
  snapshot: LiveEventLogMotionSnapshot,
): LiveEventLogMotionReconciliation {
  return {
    animatedEventIds: [],
    state: { pendingEventIds: [], snapshot },
  };
}
