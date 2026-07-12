"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  getLiveLobbyProgressRatio,
  getLiveLobbyProgressSnapshotKey,
  reconcileLiveLobbyProgress,
  type LiveLobbyProgressChange,
  type LiveLobbyProgressSnapshot,
} from "./liveLobbyProgressModel";

import type { RefObject } from "react";

export function useLiveLobbyProgressMotion(
  snapshot: LiveLobbyProgressSnapshot,
): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousSnapshotRef = useRef<LiveLobbyProgressSnapshot | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const snapshotKey = getLiveLobbyProgressSnapshotKey(snapshot);

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        previousSnapshotRef.current = snapshot;
        return;
      }

      delete root.dataset["liveLobbyProgressMotionKind"];

      const previousSnapshot = previousSnapshotRef.current;
      const reconciliation = reconcileLiveLobbyProgress(
        previousSnapshot,
        snapshot,
        !reducedMotion && document.visibilityState === "visible",
      );

      previousSnapshotRef.current = reconciliation.snapshot;

      if (reconciliation.change === null || previousSnapshot === null) {
        return;
      }

      return animateLobbyProgress(root, previousSnapshot, snapshot, reconciliation.change);
    },
    {
      dependencies: [reducedMotion, snapshotKey],
      revertOnUpdate: true,
      scope: rootRef,
    },
  );

  return rootRef;
}

function animateLobbyProgress(
  root: HTMLElement,
  previousSnapshot: LiveLobbyProgressSnapshot,
  nextSnapshot: LiveLobbyProgressSnapshot,
  change: LiveLobbyProgressChange,
): () => void {
  const fill = root.querySelector<HTMLElement>("[data-live-lobby-progress-fill]");
  const count = root.querySelector<HTMLElement>("[data-live-lobby-progress-count]");
  const message = root.querySelector<HTMLElement>("[data-live-lobby-progress-message]");
  const sheen = root.querySelector<HTMLElement>("[data-live-lobby-progress-sheen]");
  const glow = root.querySelector<HTMLElement>("[data-live-lobby-progress-glow]");
  const completion = root.querySelector<HTMLElement>("[data-live-lobby-progress-completion]");
  const animatedElements = [fill, count, message, sheen, glow, completion].filter(
    (element): element is HTMLElement => element !== null,
  );
  const previousRatio = getLiveLobbyProgressRatio(previousSnapshot);
  const nextRatio = getLiveLobbyProgressRatio(nextSnapshot);
  const entryOffset = change.direction === "increase" ? 48 : -38;

  root.dataset["liveLobbyProgressMotionKind"] = change.kind;
  const timeline = gsap.timeline({
    defaults: { overwrite: "auto" },
    onComplete: () => {
      clearLobbyProgressProperties(animatedElements);
      delete root.dataset["liveLobbyProgressMotionKind"];
    },
  });

  if (fill !== null && nextRatio > 0 && previousRatio !== nextRatio) {
    timeline.fromTo(
      fill,
      { scaleX: previousRatio / nextRatio, transformOrigin: "0 50%", willChange: "transform" },
      {
        duration: change.direction === "increase" ? 0.64 : 0.48,
        ease: change.direction === "increase" ? "power3.out" : "power2.inOut",
        scaleX: 1,
      },
      0,
    );
  }

  if (count !== null) {
    timeline.fromTo(
      count,
      { autoAlpha: 0.24, willChange: "transform, opacity", yPercent: entryOffset },
      { autoAlpha: 1, duration: 0.42, ease: "back.out(1.5)", yPercent: 0 },
      0.04,
    );
  }

  if (message !== null) {
    timeline.fromTo(
      message,
      { autoAlpha: 0.35, willChange: "transform, opacity", y: 6 },
      { autoAlpha: 1, duration: 0.4, ease: "power2.out", y: 0 },
      0.08,
    );
  }

  if (change.direction === "increase" && sheen !== null) {
    timeline
      .fromTo(
        sheen,
        { autoAlpha: 0, willChange: "transform, opacity", xPercent: -120 },
        { autoAlpha: 0.72, duration: 0.28, ease: "power2.out", xPercent: 80 },
        0.08,
      )
      .to(sheen, { autoAlpha: 0, duration: 0.28, ease: "power2.in", xPercent: 320 }, 0.36);
  }

  if (change.kind === "ready") {
    if (completion !== null) {
      timeline.fromTo(
        completion,
        { autoAlpha: 0, scale: 0.82, willChange: "transform, opacity", y: 8 },
        { autoAlpha: 1, duration: 0.48, ease: "back.out(1.9)", scale: 1, y: 0 },
        0.28,
      );
    }

    if (glow !== null) {
      timeline
        .fromTo(
          glow,
          { autoAlpha: 0, scale: 0.88, willChange: "transform, opacity" },
          { autoAlpha: 0.76, duration: 0.3, ease: "power2.out", scale: 1 },
          0.2,
        )
        .to(glow, { autoAlpha: 0, duration: 0.5, ease: "power2.in", scale: 1.08 }, 0.5);
    }
  }

  return () => {
    timeline.kill();
    delete root.dataset["liveLobbyProgressMotionKind"];
  };
}

function clearLobbyProgressProperties(elements: readonly HTMLElement[]): void {
  if (elements.length === 0) {
    return;
  }

  gsap.set(elements, {
    clearProps: "opacity,transform,transform-origin,visibility,will-change",
  });
}
