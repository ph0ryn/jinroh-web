const MAX_ANIMATED_LIST_ITEMS = 6;

export type LiveListAdditionMotionSnapshot = {
  readonly isObscured: boolean;
  readonly isOpen: boolean;
  readonly itemIds: readonly string[];
  readonly sessionKey: string;
};

export type LiveListAdditionMotionState = {
  readonly pendingItemIds: readonly string[];
  readonly snapshot: LiveListAdditionMotionSnapshot | null;
};

export type LiveListAdditionMotionReconciliation = {
  readonly animatedItemIds: readonly string[];
  readonly state: LiveListAdditionMotionState;
};

export function createLiveListAdditionMotionState(): LiveListAdditionMotionState {
  return { pendingItemIds: [], snapshot: null };
}

export function reconcileLiveListAdditionMotion(
  state: LiveListAdditionMotionState,
  current: LiveListAdditionMotionSnapshot,
  shouldAnimate: boolean,
): LiveListAdditionMotionReconciliation {
  const previous = state.snapshot;
  const isBaseline =
    previous === null ||
    !shouldAnimate ||
    !previous.isOpen ||
    !current.isOpen ||
    previous.sessionKey !== current.sessionKey;

  if (isBaseline) {
    return settledReconciliation(current);
  }

  const previousIds = new Set(previous.itemIds);
  const currentIds = new Set(current.itemIds);
  const addedItemIds = current.itemIds.filter((itemId) => !previousIds.has(itemId));
  const pendingItemIds = [...new Set([...state.pendingItemIds, ...addedItemIds])]
    .filter((itemId) => currentIds.has(itemId))
    .slice(-MAX_ANIMATED_LIST_ITEMS);

  if (current.isObscured) {
    return {
      animatedItemIds: [],
      state: { pendingItemIds, snapshot: current },
    };
  }

  return {
    animatedItemIds: pendingItemIds,
    state: { pendingItemIds: [], snapshot: current },
  };
}

export function getLiveListAdditionMotionSnapshotKey(
  snapshot: LiveListAdditionMotionSnapshot,
): string {
  return [
    snapshot.isOpen ? "open" : "closed",
    snapshot.isObscured ? "obscured" : "visible",
    snapshot.sessionKey,
    ...snapshot.itemIds,
  ].join(":");
}

function settledReconciliation(
  snapshot: LiveListAdditionMotionSnapshot,
): LiveListAdditionMotionReconciliation {
  return {
    animatedItemIds: [],
    state: { pendingItemIds: [], snapshot },
  };
}
