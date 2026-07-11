export type LiveToastTone = "error" | "info" | "success" | "warning";

export type LiveToastPageScope = {
  readonly kind: "page";
};

export type LiveToastRoomSessionScope = {
  readonly kind: "roomSession";
  readonly sessionId: number;
};

export type LiveToastScope = LiveToastPageScope | LiveToastRoomSessionScope;

export type LiveToastRequest = {
  readonly message: string;
  readonly scope: LiveToastScope;
  readonly timeoutMs: number | null;
  readonly tone: LiveToastTone;
};

export type LiveToast = LiveToastRequest & {
  readonly id: number;
};

type LiveToastIdleState = {
  readonly active: null;
  readonly nextId: number;
  readonly pending: null;
  readonly phase: null;
};

type LiveToastVisibleState = {
  readonly active: LiveToast;
  readonly nextId: number;
  readonly pending: null;
  readonly phase: "entered" | "entering";
};

type LiveToastExitingState = {
  readonly active: LiveToast;
  readonly exitReason: "dismiss" | "replacement" | "scopeClear";
  readonly nextId: number;
  readonly pending: LiveToast | null;
  readonly phase: "exiting";
};

export type LiveToastState = LiveToastExitingState | LiveToastIdleState | LiveToastVisibleState;

export type LiveToastAction =
  | {
      readonly request: LiveToastRequest;
      readonly type: "request";
    }
  | {
      readonly toastId: number;
      readonly type: "entryCompleted";
    }
  | {
      readonly toastId: number;
      readonly type: "dismiss";
    }
  | {
      readonly toastId: number;
      readonly type: "exitCompleted";
    }
  | {
      readonly scope: LiveToastScope;
      readonly type: "clearScope";
    };

export const LIVE_TOAST_PAGE_SCOPE: LiveToastPageScope = { kind: "page" };

export function createLiveToastState(): LiveToastState {
  return {
    active: null,
    nextId: 1,
    pending: null,
    phase: null,
  };
}

export function createLiveToastRoomSessionScope(sessionId: number): LiveToastRoomSessionScope {
  assertValidRoomSessionId(sessionId);

  return { kind: "roomSession", sessionId };
}

export function isSameLiveToastScope(first: LiveToastScope, second: LiveToastScope): boolean {
  if (first.kind === "page" || second.kind === "page") {
    return first.kind === second.kind;
  }

  return first.sessionId === second.sessionId;
}

export function reduceLiveToastState(
  state: LiveToastState,
  action: LiveToastAction,
): LiveToastState {
  switch (action.type) {
    case "request":
      return requestLiveToast(state, action.request);
    case "entryCompleted":
      return completeLiveToastEntry(state, action.toastId);
    case "dismiss":
      return dismissLiveToast(state, action.toastId);
    case "exitCompleted":
      return completeLiveToastExit(state, action.toastId);
    case "clearScope":
      return clearLiveToastScope(state, action.scope);
  }
}

function requestLiveToast(state: LiveToastState, request: LiveToastRequest): LiveToastState {
  assertValidLiveToastRequest(request);

  const latestRequestedToast = state.phase === "exiting" ? state.pending : state.active;

  if (isDuplicateLiveToastRequest(latestRequestedToast, request)) {
    return state;
  }

  const toast: LiveToast = { ...request, id: state.nextId };
  const nextId = state.nextId + 1;

  if (state.active === null) {
    return {
      active: toast,
      nextId,
      pending: null,
      phase: "entering",
    };
  }

  if (state.phase === "exiting") {
    return {
      ...state,
      nextId,
      pending: toast,
    };
  }

  return {
    active: state.active,
    exitReason: "replacement",
    nextId,
    pending: toast,
    phase: "exiting",
  };
}

function completeLiveToastEntry(state: LiveToastState, toastId: number): LiveToastState {
  if (state.active === null || state.phase !== "entering" || state.active.id !== toastId) {
    return state;
  }

  return {
    ...state,
    phase: "entered",
  };
}

function dismissLiveToast(state: LiveToastState, toastId: number): LiveToastState {
  if (state.active === null || state.phase === "exiting" || state.active.id !== toastId) {
    return state;
  }

  return {
    active: state.active,
    exitReason: "dismiss",
    nextId: state.nextId,
    pending: null,
    phase: "exiting",
  };
}

function completeLiveToastExit(state: LiveToastState, toastId: number): LiveToastState {
  if (state.active === null || state.phase !== "exiting" || state.active.id !== toastId) {
    return state;
  }

  if (state.pending === null) {
    return {
      active: null,
      nextId: state.nextId,
      pending: null,
      phase: null,
    };
  }

  return {
    active: state.pending,
    nextId: state.nextId,
    pending: null,
    phase: "entering",
  };
}

function clearLiveToastScope(state: LiveToastState, scope: LiveToastScope): LiveToastState {
  if (state.active === null) {
    return state;
  }

  if (state.phase !== "exiting") {
    if (!isSameLiveToastScope(state.active.scope, scope)) {
      return state;
    }

    return {
      active: state.active,
      exitReason: "scopeClear",
      nextId: state.nextId,
      pending: null,
      phase: "exiting",
    };
  }

  const clearsActive = isSameLiveToastScope(state.active.scope, scope);
  const clearsPending = state.pending !== null && isSameLiveToastScope(state.pending.scope, scope);

  if (!clearsActive && !clearsPending) {
    return state;
  }

  if (clearsActive) {
    return {
      ...state,
      exitReason: "scopeClear",
      pending: clearsPending ? null : state.pending,
    };
  }

  if (state.exitReason === "replacement") {
    return {
      active: state.active,
      nextId: state.nextId,
      pending: null,
      phase: "entering",
    };
  }

  return {
    ...state,
    pending: null,
  };
}

function isDuplicateLiveToastRequest(toast: LiveToast | null, request: LiveToastRequest): boolean {
  return (
    toast !== null &&
    toast.message === request.message &&
    toast.tone === request.tone &&
    isSameLiveToastScope(toast.scope, request.scope)
  );
}

function assertValidLiveToastRequest(request: LiveToastRequest): void {
  if (
    request.timeoutMs !== null &&
    (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)
  ) {
    throw new RangeError("Live toast timeoutMs must be a positive safe integer or null.");
  }

  if (request.scope.kind === "roomSession") {
    assertValidRoomSessionId(request.scope.sessionId);
  }
}

function assertValidRoomSessionId(sessionId: number): void {
  if (!Number.isSafeInteger(sessionId) || sessionId < 0) {
    throw new RangeError("Live toast room sessionId must be a non-negative safe integer.");
  }
}
