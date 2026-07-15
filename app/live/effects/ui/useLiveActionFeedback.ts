"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  createLiveActionFeedbackSnapshot,
  hasLiveActionFeedbackTarget,
  reconcileLiveActionFeedback,
  type LiveActionFeedbackCue,
  type LiveActionFeedbackSnapshot,
} from "./liveActionFeedbackModel";

import type { RoomSummary } from "@/lib/shared/game";

export type LiveActionFeedbackController = {
  readonly completeCue: (receiptId: string) => void;
  readonly cue: LiveActionFeedbackCue | null;
};

export function useLiveActionFeedback(summary: RoomSummary | null): LiveActionFeedbackController {
  const previousSnapshotRef = useRef<LiveActionFeedbackSnapshot | null>(null);
  const [cue, setCue] = useState<LiveActionFeedbackCue | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const nextSnapshot = createLiveActionFeedbackSnapshot(summary);
    const previousSnapshot = previousSnapshotRef.current;
    const sessionChanged =
      previousSnapshot !== null &&
      (previousSnapshot.roomCode !== nextSnapshot.roomCode ||
        previousSnapshot.viewerPlayerId !== nextSnapshot.viewerPlayerId ||
        previousSnapshot.gameId !== nextSnapshot.gameId);
    const reconciliation = reconcileLiveActionFeedback(
      previousSnapshot,
      nextSnapshot,
      !reducedMotion && document.visibilityState === "visible",
    );

    previousSnapshotRef.current = reconciliation.snapshot;
    setCue((currentCue) => {
      if (reducedMotion || sessionChanged) {
        return null;
      }

      if (reconciliation.cue !== null) {
        return reconciliation.cue;
      }

      if (
        currentCue !== null &&
        !hasLiveActionFeedbackTarget(reconciliation.snapshot, currentCue)
      ) {
        return null;
      }

      return currentCue;
    });
  }, [reducedMotion, summary]);

  const completeCue = useCallback((receiptId: string) => {
    setCue((currentCue) => (currentCue?.receipt.id === receiptId ? null : currentCue));
  }, []);

  return { completeCue, cue };
}
