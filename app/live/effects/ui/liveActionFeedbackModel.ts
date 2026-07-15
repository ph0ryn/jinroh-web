import { getLiveGameSessionIdentity } from "../../liveGameSession";

import type { ActionSubmissionReceipt, PublicActionStatus, RoomSummary } from "@/lib/shared/game";

export type LiveActionFeedbackAction = {
  readonly key: string;
  readonly phaseInstanceId: string;
  readonly status: PublicActionStatus;
};

export type LiveActionFeedbackSnapshot = {
  readonly actions: readonly LiveActionFeedbackAction[];
  readonly gameId: string | null;
  readonly latestReceipt: ActionSubmissionReceipt | null;
  readonly roomCode: string | null;
  readonly viewerPlayerId: string | null;
};

export type LiveActionFeedbackCue = {
  readonly receipt: ActionSubmissionReceipt;
};

export type ReconciledLiveActionFeedback = {
  readonly cue: LiveActionFeedbackCue | null;
  readonly snapshot: LiveActionFeedbackSnapshot;
};

export function createLiveActionFeedbackSnapshot(
  summary: RoomSummary | null,
): LiveActionFeedbackSnapshot {
  const session = getLiveGameSessionIdentity(summary);

  return {
    actions:
      summary?.self?.actions.map(({ key, phaseInstanceId, status }) => ({
        key,
        phaseInstanceId,
        status,
      })) ?? [],
    gameId: session.gameId,
    latestReceipt: summary?.self?.actionReceipts.at(-1) ?? null,
    roomCode: session.roomCode,
    viewerPlayerId: session.viewerPlayerId,
  };
}

export function getLiveActionFeedbackSnapshotKey(snapshot: LiveActionFeedbackSnapshot): string {
  return JSON.stringify(snapshot);
}

export function getLiveActionFeedbackCue(
  previousSnapshot: LiveActionFeedbackSnapshot | null,
  nextSnapshot: LiveActionFeedbackSnapshot,
): LiveActionFeedbackCue | null {
  const nextReceipt = nextSnapshot.latestReceipt;

  if (
    previousSnapshot === null ||
    previousSnapshot.roomCode !== nextSnapshot.roomCode ||
    previousSnapshot.viewerPlayerId !== nextSnapshot.viewerPlayerId ||
    previousSnapshot.gameId !== nextSnapshot.gameId ||
    nextReceipt === null ||
    previousSnapshot.latestReceipt?.id === nextReceipt.id ||
    !hasSubmittedAction(nextSnapshot, nextReceipt)
  ) {
    return null;
  }

  return { receipt: nextReceipt };
}

export function reconcileLiveActionFeedback(
  previousSnapshot: LiveActionFeedbackSnapshot | null,
  nextSnapshot: LiveActionFeedbackSnapshot,
  shouldAnimate: boolean,
): ReconciledLiveActionFeedback {
  return {
    cue: shouldAnimate ? getLiveActionFeedbackCue(previousSnapshot, nextSnapshot) : null,
    snapshot: nextSnapshot,
  };
}

export function hasLiveActionFeedbackTarget(
  snapshot: LiveActionFeedbackSnapshot,
  cue: LiveActionFeedbackCue,
): boolean {
  return hasSubmittedAction(snapshot, cue.receipt);
}

function hasSubmittedAction(
  snapshot: LiveActionFeedbackSnapshot,
  receipt: ActionSubmissionReceipt,
): boolean {
  return snapshot.actions.some(
    (action) =>
      action.key === receipt.actionKey &&
      action.phaseInstanceId === receipt.phaseInstanceId &&
      action.status === "submitted",
  );
}
