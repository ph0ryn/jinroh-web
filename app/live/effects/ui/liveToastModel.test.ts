import { describe, expect, it } from "vitest";

import {
  createLiveToastRoomSessionScope,
  createLiveToastState,
  isSameLiveToastScope,
  LIVE_TOAST_PAGE_SCOPE,
  reduceLiveToastState,
  type LiveToastRequest,
  type LiveToastScope,
  type LiveToastState,
} from "./liveToastModel";

describe("live toast model", () => {
  it("assigns monotonic identities and enters the first requested toast", () => {
    const first = requestToast(createLiveToastState(), {
      message: "Room synchronized.",
      timeoutMs: null,
      tone: "success",
    });

    expect(first).toEqual({
      active: {
        id: 1,
        message: "Room synchronized.",
        scope: LIVE_TOAST_PAGE_SCOPE,
        timeoutMs: null,
        tone: "success",
      },
      nextId: 2,
      pending: null,
      phase: "entering",
    });

    const entered = completeEntry(first, 1);
    const dismissed = dismissToast(entered, 1);
    const idle = completeExit(dismissed, 1);
    const second = requestToast(idle, { message: "Try again.", tone: "warning" });

    expect(entered.phase).toBe("entered");
    expect(dismissed.phase).toBe("exiting");
    expect(idle).toEqual({ active: null, nextId: 2, pending: null, phase: null });
    expect(second.active?.id).toBe(2);
    expect(second.nextId).toBe(3);
  });

  it("retains the active toast while replacing only the latest pending request", () => {
    const first = completeEntry(
      requestToast(createLiveToastState(), { message: "First", tone: "info" }),
      1,
    );
    const second = requestToast(first, { message: "Second", tone: "warning" });
    const third = requestToast(second, { message: "Third", tone: "error" });

    expect(second.phase).toBe("exiting");
    expect(second.active?.message).toBe("First");
    expect(second.pending).toMatchObject({ id: 2, message: "Second" });
    expect(third.active).toBe(second.active);
    expect(third.pending).toMatchObject({ id: 3, message: "Third" });
    expect(third.nextId).toBe(4);

    const promoted = completeExit(third, 1);

    expect(promoted).toMatchObject({
      active: { id: 3, message: "Third" },
      nextId: 4,
      pending: null,
      phase: "entering",
    });
  });

  it("restores the latest request when it matches the toast that is still exiting", () => {
    const first = completeEntry(
      requestToast(createLiveToastState(), { message: "First", tone: "info" }),
      1,
    );
    const second = requestToast(first, { message: "Second", tone: "warning" });
    const latestFirst = requestToast(second, { message: "First", tone: "info" });

    expect(latestFirst).toMatchObject({
      active: { id: 1, message: "First" },
      nextId: 4,
      pending: { id: 3, message: "First" },
      phase: "exiting",
    });
    expect(completeExit(latestFirst, 1)).toMatchObject({
      active: { id: 3, message: "First" },
      pending: null,
      phase: "entering",
    });
  });

  it("does not lose a repeated notification while its previous instance is dismissed", () => {
    const entered = completeEntry(
      requestToast(createLiveToastState(), { message: "Retry failed", tone: "error" }),
      1,
    );
    const dismissing = dismissToast(entered, 1);
    const repeated = requestToast(dismissing, { message: "Retry failed", tone: "error" });

    expect(repeated).toMatchObject({
      active: { id: 1 },
      pending: { id: 2, message: "Retry failed" },
      phase: "exiting",
    });
  });

  it("ignores duplicate tone, message, and scope without consuming an identity", () => {
    const roomScope = createLiveToastRoomSessionScope(7, "game-a");
    const first = requestToast(createLiveToastState(), {
      message: "Connection lost.",
      scope: roomScope,
      timeoutMs: 7_000,
      tone: "warning",
    });
    const duplicate = requestToast(first, {
      message: "Connection lost.",
      scope: createLiveToastRoomSessionScope(7, "game-a"),
      timeoutMs: null,
      tone: "warning",
    });

    expect(duplicate).toBe(first);

    const replacement = requestToast(duplicate, {
      message: "Connection restored.",
      scope: roomScope,
      tone: "success",
    });
    const pendingDuplicate = requestToast(replacement, {
      message: "Connection restored.",
      scope: roomScope,
      timeoutMs: null,
      tone: "success",
    });

    expect(pendingDuplicate).toBe(replacement);
    expect(replacement.pending?.id).toBe(2);
    expect(replacement.nextId).toBe(3);
  });

  it("treats the same copy in another room session as a distinct request", () => {
    const first = completeEntry(
      requestToast(createLiveToastState(), {
        message: "Room changed.",
        scope: createLiveToastRoomSessionScope(3, "game-a"),
        tone: "warning",
      }),
      1,
    );
    const nextSession = requestToast(first, {
      message: "Room changed.",
      scope: createLiveToastRoomSessionScope(4, "game-a"),
      tone: "warning",
    });

    expect(nextSession.phase).toBe("exiting");
    expect(nextSession.pending).toMatchObject({
      id: 2,
      scope: { kind: "roomSession", sessionId: 4 },
    });
  });

  it("guards entry, dismissal, and exit completion against stale identities and phases", () => {
    const entering = requestToast(createLiveToastState(), { message: "Current" });

    expect(completeEntry(entering, 99)).toBe(entering);
    expect(dismissToast(entering, 99)).toBe(entering);
    expect(completeExit(entering, 1)).toBe(entering);

    const entered = completeEntry(entering, 1);
    const exiting = requestToast(entered, { message: "Next" });

    expect(completeEntry(exiting, 1)).toBe(exiting);
    expect(dismissToast(exiting, 1)).toBe(exiting);
    expect(completeExit(exiting, 99)).toBe(exiting);

    const promoted = completeExit(exiting, 1);

    expect(completeExit(promoted, 1)).toBe(promoted);
    expect(completeEntry(promoted, 1)).toBe(promoted);
    expect(completeEntry(promoted, 2).phase).toBe("entered");
  });

  it("clears a visible scope through exit while preserving a different pending scope", () => {
    const firstScope = createLiveToastRoomSessionScope(1, "game-a");
    const secondScope = createLiveToastRoomSessionScope(2, "game-a");
    const visible = completeEntry(
      requestToast(createLiveToastState(), {
        message: "First room",
        scope: firstScope,
      }),
      1,
    );

    const unrelatedClear = clearScope(visible, secondScope);
    const clearingVisible = clearScope(visible, firstScope);

    expect(unrelatedClear).toBe(visible);
    expect(clearingVisible).toMatchObject({ active: { id: 1 }, pending: null, phase: "exiting" });

    const withNextScope = requestToast(visible, {
      message: "Second room",
      scope: secondScope,
    });
    const preservingNextScope = clearScope(withNextScope, firstScope);

    expect(preservingNextScope).toMatchObject({
      active: { id: 1 },
      exitReason: "scopeClear",
      pending: { id: 2, scope: secondScope },
      phase: "exiting",
    });
    expect(completeExit(preservingNextScope, 1)).toMatchObject({
      active: { id: 2, scope: secondScope },
      phase: "entering",
    });
  });

  it("restores an unrelated active toast when its pending replacement scope is cleared", () => {
    const roomScope = createLiveToastRoomSessionScope(8, "game-a");
    const visiblePageToast = completeEntry(
      requestToast(createLiveToastState(), { message: "Page notification" }),
      1,
    );
    const withPendingRoomToast = requestToast(visiblePageToast, {
      message: "Room notification",
      scope: roomScope,
    });
    const cleared = clearScope(withPendingRoomToast, roomScope);

    expect(cleared).toMatchObject({ active: { id: 1 }, pending: null, phase: "entering" });
    expect(completeEntry(cleared, 1)).toEqual({
      active: visiblePageToast.active,
      nextId: 3,
      pending: null,
      phase: "entered",
    });
  });

  it("keeps dismissing an active toast when a later pending scope is cleared", () => {
    const roomScope = createLiveToastRoomSessionScope(9, "game-a");
    const entered = completeEntry(
      requestToast(createLiveToastState(), { message: "Dismiss me" }),
      1,
    );
    const dismissing = dismissToast(entered, 1);
    const withPendingRoomToast = requestToast(dismissing, {
      message: "Room notification",
      scope: roomScope,
    });
    const cleared = clearScope(withPendingRoomToast, roomScope);

    expect(cleared).toMatchObject({
      active: { id: 1 },
      exitReason: "dismiss",
      pending: null,
      phase: "exiting",
    });
    expect(completeExit(cleared, 1)).toEqual({
      active: null,
      nextId: 3,
      pending: null,
      phase: null,
    });
  });

  it("discards an old Game scope immediately when the accepted Game detaches", () => {
    const oldGameScope = createLiveToastRoomSessionScope(9, "game-a");
    const cleanLobbyScope = createLiveToastRoomSessionScope(9, null);
    const visibleOldGame = completeEntry(
      requestToast(createLiveToastState(), {
        message: "Old game",
        scope: oldGameScope,
      }),
      1,
    );

    expect(discardScope(visibleOldGame, oldGameScope)).toEqual({
      active: null,
      nextId: 2,
      pending: null,
      phase: null,
    });

    const replacing = requestToast(visibleOldGame, {
      message: "Clean lobby",
      scope: cleanLobbyScope,
    });

    expect(discardScope(replacing, oldGameScope)).toMatchObject({
      active: { message: "Clean lobby", scope: cleanLobbyScope },
      pending: null,
      phase: "entering",
    });
  });

  it("uses null exclusively for sticky timeouts", () => {
    const sticky = requestToast(createLiveToastState(), {
      message: "Requires dismissal.",
      timeoutMs: null,
    });

    expect(sticky.active?.timeoutMs).toBeNull();
    expect(() =>
      requestToast(createLiveToastState(), { message: "Invalid", timeoutMs: 0 }),
    ).toThrowError(/positive safe integer or null/);
    expect(() =>
      requestToast(createLiveToastState(), { message: "Invalid", timeoutMs: Infinity }),
    ).toThrowError(/positive safe integer or null/);
  });

  it("validates and compares page and room-session scopes", () => {
    const roomScope = createLiveToastRoomSessionScope(0, "game-a");

    expect(isSameLiveToastScope(LIVE_TOAST_PAGE_SCOPE, { kind: "page" })).toBe(true);
    expect(isSameLiveToastScope(LIVE_TOAST_PAGE_SCOPE, roomScope)).toBe(false);
    expect(isSameLiveToastScope(roomScope, createLiveToastRoomSessionScope(0, "game-a"))).toBe(
      true,
    );
    expect(isSameLiveToastScope(roomScope, createLiveToastRoomSessionScope(1, "game-a"))).toBe(
      false,
    );
    expect(isSameLiveToastScope(roomScope, createLiveToastRoomSessionScope(0, "game-b"))).toBe(
      false,
    );
    expect(() => createLiveToastRoomSessionScope(-1, null)).toThrowError(
      /non-negative safe integer/,
    );
  });
});

type ToastRequestOverrides = Partial<LiveToastRequest> & Pick<LiveToastRequest, "message">;

function requestToast(
  state: LiveToastState,
  {
    message,
    scope = LIVE_TOAST_PAGE_SCOPE,
    timeoutMs = 4_800,
    tone = "info",
  }: ToastRequestOverrides,
): LiveToastState {
  return reduceLiveToastState(state, {
    request: { message, scope, timeoutMs, tone },
    type: "request",
  });
}

function completeEntry(state: LiveToastState, toastId: number): LiveToastState {
  return reduceLiveToastState(state, { toastId, type: "entryCompleted" });
}

function dismissToast(state: LiveToastState, toastId: number): LiveToastState {
  return reduceLiveToastState(state, { toastId, type: "dismiss" });
}

function completeExit(state: LiveToastState, toastId: number): LiveToastState {
  return reduceLiveToastState(state, { toastId, type: "exitCompleted" });
}

function clearScope(state: LiveToastState, scope: LiveToastScope): LiveToastState {
  return reduceLiveToastState(state, { scope, type: "clearScope" });
}

function discardScope(state: LiveToastState, scope: LiveToastScope): LiveToastState {
  return reduceLiveToastState(state, { scope, type: "discardScope" });
}
