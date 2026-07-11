"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { observeMeaningfulLiveElementResize } from "../liveResizeSettlement";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  createLiveRoundTableMotionSnapshot,
  getLiveRoundTableMotionSnapshotKey,
  hasLiveRoundTableMotionChanges,
  reconcileLiveRoundTableMotion,
  type LiveRoundTableMotionSnapshot,
} from "./liveRoundTableMotionModel";

import type { RoomSummary } from "@/lib/shared/game";
import type { RefObject } from "react";

type MotionKind =
  | "disconnect"
  | "empty"
  | "execution"
  | "materialize"
  | "move"
  | "reconnect"
  | "speaking";

type SeatMotionTarget = {
  readonly halo: HTMLElement | null;
  readonly wrapper: HTMLElement;
};

type GsapTimeline = ReturnType<typeof gsap.timeline>;

export function useLiveRoundTableMotion(summary: RoomSummary): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousSnapshotRef = useRef<LiveRoundTableMotionSnapshot | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const snapshot = createLiveRoundTableMotionSnapshot(summary);
  const snapshotKey = getLiveRoundTableMotionSnapshotKey(snapshot);

  useGSAP(
    (_, contextSafe) => {
      const root = rootRef.current;

      if (root === null) {
        previousSnapshotRef.current = snapshot;
        return;
      }

      clearMotionMarkers(root);

      const previousSnapshot = previousSnapshotRef.current;
      const reconciliation = reconcileLiveRoundTableMotion(
        previousSnapshot,
        snapshot,
        !reducedMotion && document.visibilityState === "visible",
      );

      previousSnapshotRef.current = reconciliation.snapshot;

      if (!hasLiveRoundTableMotionChanges(reconciliation.changes)) {
        return;
      }

      const playerTargets = getPlayerTargets(root);
      const emptyTargets = getEmptyTargets(root);
      const previousSeatByPlayerId = new Map(
        previousSnapshot?.seats.map((seat) => [seat.playerId, seat] as const) ?? [],
      );
      const nextSeatByPlayerId = new Map(
        snapshot.seats.map((seat) => [seat.playerId, seat] as const),
      );
      const tableSurface = root.querySelector<HTMLElement>("[data-live-table-surface]");
      const tableRect = tableSurface?.getBoundingClientRect() ?? null;
      const animatedElements = new Set<HTMLElement>();
      const markedTargets = new Set<HTMLElement>();
      let stopObservingResize: () => void = () => undefined;
      let settled = false;
      const settleMotion = () => {
        if (settled) {
          return;
        }

        settled = true;
        stopObservingResize();
        clearAnimatedProperties(animatedElements);
        clearMarkedTargets(markedTargets);
      };
      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: settleMotion,
      });
      for (const playerId of reconciliation.changes.movedPlayerIds) {
        const target = playerTargets.get(playerId);
        const previousSeat = previousSeatByPlayerId.get(playerId);
        const nextSeat = nextSeatByPlayerId.get(playerId);

        if (
          target === undefined ||
          previousSeat === undefined ||
          nextSeat === undefined ||
          tableRect === null
        ) {
          continue;
        }

        const x = ((previousSeat.x - nextSeat.x) / 100) * tableRect.width;
        const y = ((previousSeat.y - nextSeat.y) / 100) * tableRect.height;

        markMotion(target.wrapper, "move", markedTargets);
        animatedElements.add(target.wrapper);
        timeline.fromTo(
          target.wrapper,
          { willChange: "transform", x, y },
          { duration: 0.64, ease: "power3.inOut", x: 0, y: 0 },
          0,
        );
      }

      for (const playerId of reconciliation.changes.materializedPlayerIds) {
        const target = playerTargets.get(playerId);

        if (target === undefined) {
          continue;
        }

        markMotion(target.wrapper, "materialize", markedTargets);
        animatedElements.add(target.wrapper);
        timeline.fromTo(
          target.wrapper,
          { autoAlpha: 0, scale: 0.78, willChange: "transform, opacity", y: 14 },
          { autoAlpha: 1, duration: 0.58, ease: "back.out(1.65)", scale: 1, y: 0 },
          0,
        );
      }

      for (const seatNumber of reconciliation.changes.emptyMaterializedSeatNumbers) {
        const target = emptyTargets.get(seatNumber);

        if (target === undefined) {
          continue;
        }

        markMotion(target, "empty", markedTargets);
        animatedElements.add(target);
        timeline.fromTo(
          target,
          { autoAlpha: 0, scale: 0.9, willChange: "transform, opacity", y: 8 },
          { autoAlpha: 1, duration: 0.4, ease: "power2.out", scale: 1, y: 0 },
          0.08,
        );
      }

      for (const playerId of reconciliation.changes.disconnectedPlayerIds) {
        const target = playerTargets.get(playerId);

        if (target === undefined) {
          continue;
        }

        markMotion(target.wrapper, "disconnect", markedTargets);
        animatedElements.add(target.wrapper);
        timeline.fromTo(
          target.wrapper,
          { autoAlpha: 1, willChange: "opacity" },
          {
            autoAlpha: 0.58,
            duration: 0.18,
            ease: "power1.inOut",
            repeat: 1,
            yoyo: true,
          },
          0,
        );
      }

      for (const playerId of reconciliation.changes.reconnectedPlayerIds) {
        const target = playerTargets.get(playerId);

        if (target === undefined) {
          continue;
        }

        markMotion(target.wrapper, "reconnect", markedTargets);
        animatedElements.add(target.wrapper);
        timeline.fromTo(
          target.wrapper,
          { autoAlpha: 0.72, scale: 0.94, willChange: "transform, opacity" },
          { autoAlpha: 1, duration: 0.5, ease: "back.out(1.45)", scale: 1 },
          0,
        );
      }

      animateAttention(
        reconciliation.changes.speakingPlayerIds,
        "speaking",
        playerTargets,
        timeline,
        animatedElements,
        markedTargets,
      );
      animateAttention(
        reconciliation.changes.executionPlayerIds,
        "execution",
        playerTargets,
        timeline,
        animatedElements,
        markedTargets,
      );

      if (animatedElements.size === 0) {
        timeline.kill();
        settleMotion();
        return;
      }

      const settleForResizeCallback = () => {
        timeline.kill();
        settleMotion();
      };
      const settleForResize = contextSafe?.(settleForResizeCallback) ?? settleForResizeCallback;
      stopObservingResize = observeMeaningfulLiveElementResize(
        tableSurface === null ? [root] : [root, tableSurface],
        settleForResize,
      );

      return () => {
        timeline.kill();
        settleMotion();
      };
    },
    {
      dependencies: [reducedMotion, snapshotKey],
      revertOnUpdate: true,
      scope: rootRef,
    },
  );

  return rootRef;
}

function animateAttention(
  playerIds: readonly string[],
  kind: Extract<MotionKind, "execution" | "speaking">,
  targets: ReadonlyMap<string, SeatMotionTarget>,
  timeline: GsapTimeline,
  animatedElements: Set<HTMLElement>,
  markedTargets: Set<HTMLElement>,
): void {
  for (const playerId of playerIds) {
    const target = targets.get(playerId);

    if (target?.halo === null || target?.halo === undefined) {
      continue;
    }

    markMotion(target.wrapper, kind, markedTargets);
    animatedElements.add(target.halo);
    timeline
      .fromTo(
        target.halo,
        { autoAlpha: 0, scale: 0.76, willChange: "transform, opacity" },
        { autoAlpha: 0.92, duration: 0.28, ease: "power2.out", scale: 1.05 },
        0.05,
      )
      .to(target.halo, { autoAlpha: 0, duration: 0.46, ease: "power2.in", scale: 1.2 }, 0.31);
  }
}

function getPlayerTargets(root: HTMLElement): Map<string, SeatMotionTarget> {
  return new Map(
    [
      ...root.querySelectorAll<HTMLElement>("[data-live-seat-motion][data-live-motion-player-id]"),
    ].flatMap((wrapper): readonly [string, SeatMotionTarget][] => {
      const playerId = wrapper.dataset["liveMotionPlayerId"];

      return playerId === undefined
        ? []
        : [
            [
              playerId,
              {
                halo: wrapper.querySelector<HTMLElement>("[data-live-seat-attention]"),
                wrapper,
              },
            ],
          ];
    }),
  );
}

function getEmptyTargets(root: HTMLElement): Map<number, HTMLElement> {
  return new Map(
    [
      ...root.querySelectorAll<HTMLElement>("[data-live-seat-motion][data-live-motion-empty-seat]"),
    ].flatMap((wrapper): readonly [number, HTMLElement][] => {
      const seatNumber = Number(wrapper.dataset["liveMotionEmptySeat"]);

      return Number.isSafeInteger(seatNumber) ? [[seatNumber, wrapper]] : [];
    }),
  );
}

function markMotion(target: HTMLElement, kind: MotionKind, markedTargets: Set<HTMLElement>): void {
  const kinds = new Set((target.dataset["liveSeatMotionKind"] ?? "").split(" ").filter(Boolean));

  kinds.add(kind);
  target.dataset["liveSeatMotionKind"] = [...kinds].join(" ");
  markedTargets.add(target);
}

function clearMotionMarkers(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-live-seat-motion-kind]").forEach((target) => {
    delete target.dataset["liveSeatMotionKind"];
  });
}

function clearMarkedTargets(targets: ReadonlySet<HTMLElement>): void {
  targets.forEach((target) => {
    delete target.dataset["liveSeatMotionKind"];
  });
}

function clearAnimatedProperties(elements: ReadonlySet<HTMLElement>): void {
  elements.forEach((element) => {
    gsap.set(element, {
      clearProps: "opacity,transform,visibility,will-change",
    });
  });
}
