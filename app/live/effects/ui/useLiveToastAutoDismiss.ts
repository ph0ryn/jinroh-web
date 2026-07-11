"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { readDocumentHidden, useDocumentHidden } from "../useDocumentHidden";

import type { FocusEventHandler, PointerEventHandler } from "react";

export type LiveToastTimerState = "paused" | "persistent" | "running" | "stopped";

type UseLiveToastAutoDismissOptions = {
  readonly isEnabled: boolean;
  readonly isExternallyPaused: boolean;
  readonly onDismiss: (toastId: number) => void;
  readonly timeoutMs: number | null;
  readonly toastId: number;
};

type LiveToastAutoDismiss = {
  readonly onBlurCapture: FocusEventHandler<HTMLElement>;
  readonly onFocusCapture: FocusEventHandler<HTMLElement>;
  readonly onPointerEnter: PointerEventHandler<HTMLElement>;
  readonly onPointerLeave: PointerEventHandler<HTMLElement>;
  readonly timerState: LiveToastTimerState;
};

type TimerConfiguration = {
  readonly timeoutMs: number | null;
  readonly toastId: number;
};

export function useLiveToastAutoDismiss({
  isEnabled,
  isExternallyPaused,
  onDismiss,
  timeoutMs,
  toastId,
}: UseLiveToastAutoDismissOptions): LiveToastAutoDismiss {
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isPointerWithin, setIsPointerWithin] = useState(false);
  const isDocumentHidden = useDocumentHidden();
  const configuredTimerRef = useRef<TimerConfiguration>({
    timeoutMs: normalizedTimeoutMs,
    toastId,
  });
  const remainingMsRef = useRef(normalizedTimeoutMs ?? 0);
  const scheduleVersionRef = useRef(0);
  const timerIdRef = useRef<number | null>(null);
  const isPaused = isDocumentHidden || isExternallyPaused || isFocusWithin || isPointerWithin;

  const dismissCurrentToast = useEffectEvent((scheduledToastId: number) => {
    if (
      scheduledToastId !== toastId ||
      !isEnabled ||
      isDocumentHidden ||
      isExternallyPaused ||
      isFocusWithin ||
      isPointerWithin ||
      readDocumentHidden()
    ) {
      return;
    }

    onDismiss(scheduledToastId);
  });

  useEffect(() => {
    const previousConfiguration = configuredTimerRef.current;

    if (
      previousConfiguration.toastId !== toastId ||
      previousConfiguration.timeoutMs !== normalizedTimeoutMs
    ) {
      configuredTimerRef.current = { timeoutMs: normalizedTimeoutMs, toastId };
      remainingMsRef.current = normalizedTimeoutMs ?? 0;
    }

    if (normalizedTimeoutMs === null || !isEnabled || isPaused) {
      return;
    }

    const scheduledToastId = toastId;
    const scheduleVersion = scheduleVersionRef.current + 1;
    const startedAt = performance.now();

    scheduleVersionRef.current = scheduleVersion;

    const timerId = window.setTimeout(() => {
      if (scheduleVersionRef.current !== scheduleVersion || timerIdRef.current !== timerId) {
        return;
      }

      timerIdRef.current = null;
      remainingMsRef.current = 0;
      dismissCurrentToast(scheduledToastId);
    }, remainingMsRef.current);

    timerIdRef.current = timerId;

    return () => {
      scheduleVersionRef.current += 1;

      if (timerIdRef.current !== timerId) {
        return;
      }

      window.clearTimeout(timerId);
      timerIdRef.current = null;
      remainingMsRef.current = Math.max(
        0,
        remainingMsRef.current - Math.max(0, performance.now() - startedAt),
      );
    };
  }, [isEnabled, isPaused, normalizedTimeoutMs, toastId]);

  const onPointerEnter = useCallback<PointerEventHandler<HTMLElement>>(() => {
    setIsPointerWithin(true);
  }, []);
  const onPointerLeave = useCallback<PointerEventHandler<HTMLElement>>(() => {
    setIsPointerWithin(false);
  }, []);
  const onFocusCapture = useCallback<FocusEventHandler<HTMLElement>>(() => {
    setIsFocusWithin(true);
  }, []);
  const onBlurCapture = useCallback<FocusEventHandler<HTMLElement>>((event) => {
    const nextFocusedTarget = event.relatedTarget;

    if (nextFocusedTarget instanceof Node && event.currentTarget.contains(nextFocusedTarget)) {
      return;
    }

    setIsFocusWithin(false);
  }, []);

  return {
    onBlurCapture,
    onFocusCapture,
    onPointerEnter,
    onPointerLeave,
    timerState: getTimerState(normalizedTimeoutMs, isEnabled, isPaused),
  };
}

function getTimerState(
  timeoutMs: number | null,
  isEnabled: boolean,
  isPaused: boolean,
): LiveToastTimerState {
  if (!isEnabled) {
    return "stopped";
  }

  if (timeoutMs === null) {
    return "persistent";
  }

  return isPaused ? "paused" : "running";
}

function normalizeTimeoutMs(timeoutMs: number | null): number | null {
  if (timeoutMs === null) {
    return null;
  }

  return Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
}
