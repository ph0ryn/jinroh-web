"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type LiveToastState } from "./liveToastModel";
import styles from "./liveToastPresence.module.css";
import { useLiveToastAutoDismiss } from "./useLiveToastAutoDismiss";
import { useLiveToastPresence } from "./useLiveToastPresence";

import type { Localization } from "@/lib/i18n/localization";
import type { FocusEvent as ReactFocusEvent, RefObject } from "react";

type LiveToastRegionProps = {
  readonly state: LiveToastState;
  readonly t: Localization;
  readonly onDismiss: (toastId: number) => void;
  readonly onEntryComplete: (toastId: number) => void;
  readonly onExitComplete: (toastId: number) => void;
};

export function LiveToastRegion({
  state,
  t,
  onDismiss,
  onEntryComplete,
  onExitComplete,
}: LiveToastRegionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusRestorePendingRef = useRef(false);
  const focusRestoreReadyRef = useRef(false);
  const focusReturnTargetRef = useRef<HTMLElement | null>(null);
  const toastHadFocusRef = useRef(false);
  const hasActiveModal = useHasActiveLiveModal(viewportRef);
  const activeToast = state.active;
  const announcement =
    activeToast === null ? null : `${t.live.toast.tones[activeToast.tone]}: ${activeToast.message}`;
  const handleToastFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const previousTarget = event.relatedTarget;

    toastHadFocusRef.current = true;

    if (
      previousTarget instanceof HTMLElement &&
      previousTarget !== document.body &&
      !event.currentTarget.contains(previousTarget)
    ) {
      focusReturnTargetRef.current = previousTarget;
    }
  }, []);
  const handleToastBlurCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    focusReturnTargetRef.current = null;
    focusRestorePendingRef.current = false;
    toastHadFocusRef.current = false;
  }, []);
  const handleDismiss = useCallback(
    (toastId: number) => {
      const focusedElement = document.activeElement;

      toastHadFocusRef.current =
        focusedElement instanceof Node && viewportRef.current?.contains(focusedElement) === true;
      focusRestorePendingRef.current = toastHadFocusRef.current;
      onDismiss(toastId);
    },
    [onDismiss],
  );
  const handleExitComplete = useCallback(
    (toastId: number) => {
      focusRestorePendingRef.current ||= toastHadFocusRef.current;
      focusRestoreReadyRef.current = focusRestorePendingRef.current;
      onExitComplete(toastId);
    },
    [onExitComplete],
  );

  useLayoutEffect(() => {
    if (state.phase === "exiting" && toastHadFocusRef.current) {
      focusRestorePendingRef.current = true;
    }

    if (!focusRestoreReadyRef.current) {
      return;
    }

    focusRestoreReadyRef.current = false;

    if (!focusRestorePendingRef.current) {
      return;
    }

    const focusReturnTarget = focusReturnTargetRef.current;
    const focusedElement = document.activeElement;

    focusRestorePendingRef.current = false;
    toastHadFocusRef.current = false;

    if (
      focusReturnTarget !== null &&
      canRestoreToastFocus(focusReturnTarget) &&
      (focusedElement === document.body || viewportRef.current?.contains(focusedElement) === true)
    ) {
      focusReturnTarget.focus();
    }
  }, [activeToast?.id, state.phase]);

  useEffect(() => {
    if (activeToast === null) {
      focusReturnTargetRef.current = null;
    }
  }, [activeToast]);

  return (
    <div
      className={styles["viewport"]}
      data-live-modal-inert-exempt
      data-live-toast-viewport
      aria-label={t.live.aria.notifications}
      ref={viewportRef}
      role="region"
    >
      <p
        className="srOnly"
        data-live-toast-announcer="polite"
        aria-atomic="true"
        aria-live="polite"
        role="status"
      >
        {activeToast !== null && activeToast.tone !== "error" ? (
          <span key={activeToast.id}>{announcement}</span>
        ) : null}
      </p>
      <p
        className="srOnly"
        data-live-toast-announcer="assertive"
        aria-atomic="true"
        aria-live="assertive"
        role="alert"
      >
        {activeToast?.tone === "error" ? <span key={activeToast.id}>{announcement}</span> : null}
      </p>
      {activeToast === null ? null : (
        <LiveToastItem
          hasActiveModal={hasActiveModal}
          phase={state.phase}
          t={t}
          toast={activeToast}
          onDismiss={handleDismiss}
          onEntryComplete={onEntryComplete}
          onExitComplete={handleExitComplete}
          onToastBlurCapture={handleToastBlurCapture}
          onToastFocusCapture={handleToastFocusCapture}
        />
      )}
    </div>
  );
}

function LiveToastItem({
  hasActiveModal,
  phase,
  t,
  toast,
  onDismiss,
  onEntryComplete,
  onExitComplete,
  onToastBlurCapture,
  onToastFocusCapture,
}: {
  readonly hasActiveModal: boolean;
  readonly phase: Exclude<LiveToastState["phase"], null>;
  readonly t: Localization;
  readonly toast: NonNullable<LiveToastState["active"]>;
  readonly onDismiss: (toastId: number) => void;
  readonly onEntryComplete: (toastId: number) => void;
  readonly onExitComplete: (toastId: number) => void;
  readonly onToastBlurCapture: (event: ReactFocusEvent<HTMLElement>) => void;
  readonly onToastFocusCapture: (event: ReactFocusEvent<HTMLElement>) => void;
}) {
  const isOpen = phase !== "exiting";
  const isInteractionSuppressed = hasActiveModal || !isOpen;
  const { rootRef, phase: visualPhase } = useLiveToastPresence({
    isOpen,
    onEntered: onEntryComplete,
    onExited: onExitComplete,
    toastId: toast.id,
  });
  const { onBlurCapture, onFocusCapture, onPointerEnter, onPointerLeave, timerState } =
    useLiveToastAutoDismiss({
      isEnabled: phase === "entered",
      isExternallyPaused: hasActiveModal,
      onDismiss,
      timeoutMs: toast.timeoutMs,
      toastId: toast.id,
    });

  return (
    <div
      className={styles["toast"]}
      data-live-toast
      data-live-toast-id={toast.id}
      data-live-toast-interaction={isInteractionSuppressed ? "suppressed" : "enabled"}
      data-live-toast-phase={visualPhase}
      data-live-toast-timer-state={timerState}
      data-tone={toast.tone}
      ref={rootRef}
      onBlurCapture={(event) => {
        onToastBlurCapture(event);
        onBlurCapture(event);
      }}
      onFocusCapture={(event) => {
        onToastFocusCapture(event);
        onFocusCapture(event);
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <span className={styles["tone"]} data-live-toast-content aria-hidden="true">
        {t.live.toast.tones[toast.tone]}
      </span>
      <p className={styles["message"]} data-live-toast-content aria-hidden="true">
        {toast.message}
      </p>
      <button
        className={`secondaryButton ${styles["close"]}`}
        data-live-toast-content
        aria-label={t.live.buttons.dismissNotification}
        aria-disabled={isInteractionSuppressed}
        disabled={hasActiveModal}
        type="button"
        onClick={() => {
          if (!isInteractionSuppressed) {
            onDismiss(toast.id);
          }
        }}
      >
        <span aria-hidden="true">X</span>
      </button>
      <span className={styles["rail"]} data-live-toast-rail aria-hidden="true" />
      <span className={styles["sheen"]} data-live-toast-sheen aria-hidden="true" />
    </div>
  );
}

function useHasActiveLiveModal(viewportRef: RefObject<HTMLDivElement | null>): boolean {
  const [hasActiveModal, setHasActiveModal] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const shell = viewport?.parentElement;

    if (viewport === null || shell === null || shell === undefined) {
      return;
    }

    const update = () => setHasActiveModal(shell.querySelector("[data-live-modal-root]") !== null);
    const observer = new MutationObserver(update);

    update();
    observer.observe(shell, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [viewportRef]);

  return hasActiveModal;
}

function canRestoreToastFocus(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    !element.inert &&
    element.closest("[inert]") === null &&
    !element.matches(":disabled") &&
    element.getClientRects().length > 0
  );
}
