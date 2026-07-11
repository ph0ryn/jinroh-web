"use client";

import { useCallback, useRef, useState } from "react";

import {
  projectLiveEffectCues,
  type LiveEffectCue,
  type LiveRoleEffectCue,
} from "./liveEffectCues";

import type { RoomSummary } from "@/lib/shared/game";

export type LiveEffectQueue = {
  readonly acceptSummary: (summary: RoomSummary) => void;
  readonly activeCue: LiveEffectCue | null;
  readonly clearEffects: () => void;
  readonly completeActiveCue: (cueId?: string) => void;
  readonly replayRole: () => void;
};

export type ReconciledLiveEffectQueue = {
  readonly activeCue: LiveEffectCue | null;
  readonly pendingCues: readonly LiveEffectCue[];
};

export function appendPendingLiveEffectCue(
  pendingCues: readonly LiveEffectCue[],
  nextCue: LiveEffectCue,
): LiveEffectCue[] {
  if (isRoleReplayCue(nextCue)) {
    return pendingCues.some(isRoleReplayCue) ? [...pendingCues] : [...pendingCues, nextCue];
  }

  const automaticCues = pendingCues.filter((pendingCue) => !isRoleReplayCue(pendingCue));
  const retainedCues =
    nextCue.kind === "phase"
      ? automaticCues.filter((pendingCue) => pendingCue.kind !== "phase")
      : automaticCues;

  return [...retainedCues, nextCue];
}

export function reconcileLiveEffectQueueForSummary(
  activeCue: LiveEffectCue | null,
  pendingCues: readonly LiveEffectCue[],
  summary: RoomSummary,
  hasIncomingAutomaticCue: boolean,
  isDocumentVisible = true,
): ReconciledLiveEffectQueue {
  if (!isDocumentVisible) {
    return { activeCue: null, pendingCues: [] };
  }

  let retainedPendingCues = pendingCues.filter(
    (pendingCue) => pendingCue.kind !== "phase" || doesPhaseCueMatchSummary(pendingCue, summary),
  );

  if (hasIncomingAutomaticCue || isRoleReplayCue(activeCue)) {
    retainedPendingCues = retainedPendingCues.filter((pendingCue) => !isRoleReplayCue(pendingCue));
  }

  const shouldSupersedeActivePhase =
    activeCue?.kind === "phase" && !doesPhaseCueMatchSummary(activeCue, summary);
  const shouldSupersedeActiveReplay = hasIncomingAutomaticCue && isRoleReplayCue(activeCue);

  return {
    activeCue: shouldSupersedeActivePhase || shouldSupersedeActiveReplay ? null : activeCue,
    pendingCues: retainedPendingCues,
  };
}

export function useLiveEffectQueue(): LiveEffectQueue {
  const [activeCue, setActiveCue] = useState<LiveEffectCue | null>(null);
  const acceptedSummaryRef = useRef<RoomSummary | null>(null);
  const activeCueRef = useRef<LiveEffectCue | null>(null);
  const queuedCuesRef = useRef<LiveEffectCue[]>([]);
  const seenCueIdsRef = useRef(new Set<string>());
  const seenEventIdsRef = useRef(new Set<string>());
  const replaySequenceRef = useRef(0);

  const activateNextCue = useCallback(() => {
    if (activeCueRef.current !== null) {
      return;
    }

    const nextCue = queuedCuesRef.current.shift() ?? null;

    activeCueRef.current = nextCue;
    setActiveCue(nextCue);
  }, []);

  const resetQueue = useCallback(() => {
    acceptedSummaryRef.current = null;
    activeCueRef.current = null;
    queuedCuesRef.current = [];
    seenCueIdsRef.current.clear();
    seenEventIdsRef.current.clear();
    replaySequenceRef.current = 0;
    setActiveCue(null);
  }, []);

  const clearEffects = useCallback(() => {
    resetQueue();
  }, [resetQueue]);

  const acceptSummary = useCallback(
    (summary: RoomSummary) => {
      const acceptedSummary = acceptedSummaryRef.current;
      const changedEffectSession =
        acceptedSummary !== null &&
        (acceptedSummary.code !== summary.code ||
          acceptedSummary.currentPlayerId !== summary.currentPlayerId);

      if (changedEffectSession) {
        resetQueue();
      }

      const previous = changedEffectSession ? null : acceptedSummary;

      if (document.visibilityState !== "visible") {
        const settledQueue = reconcileLiveEffectQueueForSummary(
          activeCueRef.current,
          queuedCuesRef.current,
          summary,
          false,
          false,
        );

        acceptedSummaryRef.current = summary;
        activeCueRef.current = settledQueue.activeCue;
        queuedCuesRef.current = [...settledQueue.pendingCues];
        summary.game?.events.forEach((event) => seenEventIdsRef.current.add(event.id));
        setActiveCue(settledQueue.activeCue);
        return;
      }

      const projectedCues = projectLiveEffectCues(previous, summary);
      const incomingAutomaticCues: LiveEffectCue[] = [];

      acceptedSummaryRef.current = summary;

      for (const cue of projectedCues) {
        const hasOnlySeenEvents =
          cue.eventIds.length > 0 &&
          cue.eventIds.every((eventId) => seenEventIdsRef.current.has(eventId));

        if (seenCueIdsRef.current.has(cue.id) || hasOnlySeenEvents) {
          continue;
        }

        seenCueIdsRef.current.add(cue.id);
        cue.eventIds.forEach((eventId) => seenEventIdsRef.current.add(eventId));
        incomingAutomaticCues.push(cue);
      }

      const reconciledQueue = reconcileLiveEffectQueueForSummary(
        activeCueRef.current,
        queuedCuesRef.current,
        summary,
        incomingAutomaticCues.length > 0,
      );

      queuedCuesRef.current = [...reconciledQueue.pendingCues];

      if (reconciledQueue.activeCue !== activeCueRef.current) {
        activeCueRef.current = reconciledQueue.activeCue;
        setActiveCue(reconciledQueue.activeCue);
      }

      for (const cue of incomingAutomaticCues) {
        queuedCuesRef.current = appendPendingLiveEffectCue(queuedCuesRef.current, cue);
      }

      summary.game?.events.forEach((event) => seenEventIdsRef.current.add(event.id));
      activateNextCue();
    },
    [activateNextCue, resetQueue],
  );

  const completeActiveCue = useCallback(
    (cueId?: string) => {
      const currentCue = activeCueRef.current;

      if (currentCue === null || (cueId !== undefined && currentCue.id !== cueId)) {
        return;
      }

      activeCueRef.current = null;
      setActiveCue(null);
      activateNextCue();
    },
    [activateNextCue],
  );

  const replayRole = useCallback(() => {
    const summary = acceptedSummaryRef.current;
    const roleId = summary?.self?.roleId;
    const playerId = summary?.self?.playerId ?? summary?.currentPlayerId;

    if (
      summary === null ||
      roleId === null ||
      roleId === undefined ||
      playerId === null ||
      playerId === undefined
    ) {
      return;
    }

    if (isRoleReplayCue(activeCueRef.current) || queuedCuesRef.current.some(isRoleReplayCue)) {
      return;
    }

    replaySequenceRef.current += 1;

    const cue: LiveRoleEffectCue = {
      eventIds: [],
      id: `${summary.code}:role-replay:${playerId}:${roleId}:${replaySequenceRef.current}`,
      kind: "role",
      playerId,
      roleId,
      roomCode: summary.code,
      source: "replay",
    };

    seenCueIdsRef.current.add(cue.id);
    queuedCuesRef.current = appendPendingLiveEffectCue(queuedCuesRef.current, cue);
    activateNextCue();
  }, [activateNextCue]);

  return {
    acceptSummary,
    activeCue,
    clearEffects,
    completeActiveCue,
    replayRole,
  };
}

function isRoleReplayCue(cue: LiveEffectCue | null): cue is LiveRoleEffectCue {
  return cue?.kind === "role" && cue.source === "replay";
}

function doesPhaseCueMatchSummary(
  cue: Extract<LiveEffectCue, { readonly kind: "phase" }>,
  summary: RoomSummary,
): boolean {
  const currentPhase = summary.status === "playing" ? summary.game : null;

  return (
    currentPhase?.phase !== null &&
    currentPhase?.phase !== undefined &&
    cue.phase === currentPhase.phase &&
    cue.dayNumber === currentPhase.dayNumber &&
    cue.nightNumber === currentPhase.nightNumber
  );
}
